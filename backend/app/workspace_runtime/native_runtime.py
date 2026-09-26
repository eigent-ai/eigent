# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

"""Run-owned lifecycle for the ordinary Agent and its tool adapters.

This is separate from BoundRuntime's sealed file worker: a completed asyncio
waiter is not proof that a tool thread or Terminal process has exited. The
ordinary adapter retains its turn, drains OwnedTasks, and closes its concrete
resources before this runtime can issue a live settlement receipt.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Iterable
from contextvars import ContextVar
from dataclasses import dataclass

from app.run_runtime.owned_tasks import current_owned_tasks, owned_tasks_scope

from .bound_runtime import RuntimeBinding, RuntimeSealed, UnsettledWriters
from .content import canonical_json, content_digest, relative_path

NATIVE_POLICY_VERSION = "ordinary-single-v1"


@dataclass(frozen=True)
class NativeRunOwner:
    project_id: str
    run_id: str
    attempt_id: str


_current: ContextVar[NativeAgentRuntime | None] = ContextVar(
    "native_agent_runtime", default=None
)


def current_native_runtime():
    return _current.get()


@dataclass(frozen=True)
class NativeSettlement:
    runtime_id: str
    run_id: str
    attempt_id: str
    generation: int
    workspace_id: str
    process_instances: tuple = ()


class NativeAgentRuntime:
    """One live ordinary Run, never reconstructed from a persisted PID.

    stop_resources must fence new resource dispatch, stop the exact Run's
    Terminal sessions and close Browser/MCP handles. It must raise if a
    resource cannot settle. Turn cleanup drains retained tool work even when
    the model waiter was cancelled. No timeout releases this barrier.
    """

    def __init__(
        self,
        binding: RuntimeBinding,
        *,
        stop_resources: Callable[[], Awaitable[None]],
        close_resources: Callable[[], Awaitable[None]] | None = None,
    ):
        self.binding = binding
        self.runtime_id = uuid.uuid4().hex
        self.cancelled = asyncio.Event()
        self._stop_resources = stop_resources
        self._close_resources = close_resources
        self._turn: asyncio.Task | None = None
        self._stop_task: asyncio.Task | None = None
        self._sealed = False
        self._proof: NativeSettlement | None = None
        self._unknown_writer = False
        observed = binding.workspace.local_root.stat()
        self._root_identity = (observed.st_dev, observed.st_ino)

    def _check_root(self):
        observed = self.binding.workspace.local_root.stat()
        if (observed.st_dev, observed.st_ino) != self._root_identity:
            raise UnsettledWriters("private workspace identity changed")

    def require_dispatch(self):
        if self._sealed or self.cancelled.is_set():
            raise RuntimeSealed("Run tool dispatch is sealed")
        self._check_root()

    def attach_resources(self, *, stop_resources, close_resources):
        self.require_dispatch()
        if self._turn is not None:
            raise RuntimeSealed("Run resources are already dispatched")
        self._stop_resources = stop_resources
        self._close_resources = close_resources

    async def run(self, handler):
        self.require_dispatch()
        if self._turn is not None:
            raise RuntimeSealed("Run already dispatched its turn")

        async def owned_turn():
            token = _current.set(self)
            try:
                async with owned_tasks_scope():
                    return await handler(self)
            finally:
                _current.reset(token)

        self._turn = asyncio.create_task(owned_turn())
        try:
            return await asyncio.shield(self._turn)
        except asyncio.CancelledError:
            self.cancelled.set()
            if not self._turn.done() and not self._turn.cancelling():
                self._turn.cancel()
            raise

    async def run_tool(self, handler):
        self.require_dispatch()
        owner = current_owned_tasks()
        if owner is None:
            raise UnsettledWriters("native tool has no owning turn")
        # Async MCP/Browser requests need retention just as sync tool threads
        # do. Cancelling the model waiter must not abandon an in-flight write.
        if asyncio.get_running_loop() is owner.loop:
            return await asyncio.shield(owner.create_task(handler()))
        return await asyncio.shield(
            asyncio.wrap_future(owner.schedule(handler()))
        )

    async def wait_for_user(self, handler):
        """Cancel approval/input waiters, never a dispatched tool writer."""
        self.require_dispatch()
        wait = asyncio.create_task(handler())
        stopped = asyncio.create_task(self.cancelled.wait())
        try:
            await asyncio.wait(
                (wait, stopped), return_when=asyncio.FIRST_COMPLETED
            )
            if stopped.done():
                wait.cancel()
                await asyncio.gather(wait, return_exceptions=True)
                raise asyncio.CancelledError(
                    "Run stopped while waiting for input"
                )
            return await wait
        finally:
            stopped.cancel()
            if not wait.done():
                wait.cancel()
            await asyncio.gather(wait, stopped, return_exceptions=True)

    def note_uncontained_writer(self):
        self._unknown_writer = True

    async def stop(self):
        if asyncio.current_task() is self._turn:
            raise UnsettledWriters("a Run cannot certify its own completion")
        if self._stop_task is None:
            self._sealed = True
            self.cancelled.set()
            self._stop_task = asyncio.create_task(self._stop())
        # Repeated cancellation of a caller must not interrupt resource drain.
        return await asyncio.shield(self._stop_task)

    async def _stop(self):
        turn = self._turn
        if turn is not None and not turn.done() and not turn.cancelling():
            turn.cancel()
        # Stop background/foreground processes before joining a thread that
        # may be waiting for their exit. Only this Run's adapters are closed.
        await self._stop_resources()
        if turn is not None:
            await asyncio.gather(turn, return_exceptions=True)
        if self._close_resources is not None:
            await self._close_resources()
        if self._unknown_writer:
            raise UnsettledWriters("ordinary Run has an uncontained writer")
        self._check_root()
        self._proof = NativeSettlement(
            self.runtime_id,
            self.binding.run_id,
            self.binding.attempt_id,
            self.binding.generation,
            self.binding.workspace.workspace_id,
        )
        return self._proof

    def verify_settlement(self, proof):
        if (
            proof is None
            or proof is not self._proof
            or not self._sealed
            or self._unknown_writer
            or (self._turn is not None and not self._turn.done())
        ):
            raise UnsettledWriters("ordinary Run writers have not settled")
        self._check_root()
        return {
            "outcome": "stopped",
            "runtime_id": self.runtime_id,
            "run_id": self.binding.run_id,
            "attempt_id": self.binding.attempt_id,
            "generation": self.binding.generation,
            "workspace_id": self.binding.workspace.workspace_id,
            "environment_spec_id": self.binding.environment_spec_id,
            "evidence": "owned_turn_and_tool_tasks_drained_resources_closed",
        }

    @property
    def mutation_receipts(self):
        self.verify_settlement(self._proof)
        return (
            "native_"
            + content_digest(
                canonical_json(
                    [
                        self.runtime_id,
                        self.binding.run_id,
                        self.binding.attempt_id,
                        self.binding.generation,
                    ]
                )
            ),
        )

    def path_provenance(self, changed_paths: Iterable[str]):
        receipt = self.mutation_receipts[0]
        paths = tuple(changed_paths)
        if len(paths) != len(set(paths)):
            raise UnsettledWriters("duplicate output paths")
        for path in paths:
            relative_path(path)
        # Broad native tools own their private checkout's delta. The receipt
        # describes the complete settled turn, not fictional per-file syscalls.
        return {path: receipt for path in paths}
