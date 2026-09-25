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

"""A bounded, trusted execution adapter; not the legacy Agent/Terminal runtime.

Only the sealed leaf worker below can write files. It accepts data operations,
never shell, arbitrary Python, plugins or child process commands. Its retained
direct-child handle can therefore prove all of its writers have exited. General
Terminal/MCP/browser adapters need their own descendant containment proof and
must not claim this capability. Trusted handlers may coordinate these operations
and other registered handlers, but may not launch unregistered writers/threads.

No application import, environment lookup, process-global cwd/env mutation, or
client-supplied stop assertion is used. Stop proofs are process-local capabilities
and cannot be reconstructed from a PID, a timeout or a serialized receipt.
"""

from __future__ import annotations

import asyncio
import base64
import math
import os
import stat
import sys
import uuid
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any

from .content import canonical_json, content_digest, relative_path
from .provider import WorkspaceHandle


class RuntimeBindingError(RuntimeError):
    pass


class RuntimeSealed(RuntimeBindingError):
    pass


class UnsettledWriters(RuntimeBindingError):
    pass


class WorkerExecutionError(RuntimeBindingError):
    pass


@dataclass(frozen=True)
class RuntimeBinding:
    run_id: str
    attempt_id: str
    generation: int
    workspace: WorkspaceHandle
    environment_spec_id: str
    env: Mapping[str, str] = field(repr=False)

    def __post_init__(self) -> None:
        if (
            not isinstance(self.run_id, str)
            or not self.run_id
            or not isinstance(self.attempt_id, str)
            or not self.attempt_id
            or not isinstance(self.environment_spec_id, str)
            or not self.environment_spec_id
            or not isinstance(self.workspace, WorkspaceHandle)
            or type(self.generation) is not int
            or self.generation < 1
            or self.workspace.owner != self.attempt_id
            or self.workspace.generation != self.generation
        ):
            raise RuntimeBindingError("immutable Attempt binding mismatch")
        values = dict(self.env)
        for key, value in values.items():
            if (
                not isinstance(key, str)
                or not isinstance(value, str)
                or not key
                or "=" in key
                or "\0" in key + value
                or key.upper().startswith(("LD_", "DYLD_", "PYTHON"))
            ):
                raise RuntimeBindingError("unsafe worker environment entry")
        object.__setattr__(self, "env", MappingProxyType(values))


@dataclass(frozen=True)
class WorkerOperation:
    action: str
    path: str = ""
    data: bytes = b""
    mode: int = 0o644
    seconds: float = 0
    environment_key: str | None = None

    def __post_init__(self) -> None:
        if self.action not in {"write", "delete", "mkdir", "chmod", "sleep"}:
            raise RuntimeBindingError("unsupported sealed worker operation")
        if self.action == "sleep":
            if self.path or self.data or self.environment_key is not None:
                raise RuntimeBindingError("sleep cannot name a mutation")
        else:
            relative_path(self.path)
        if (
            type(self.mode) is not int
            or self.mode < 0
            or self.mode > 0o777
            or not isinstance(self.data, bytes)
            or len(self.data) > 1024 * 1024
            or not isinstance(self.seconds, (int, float))
            or not math.isfinite(self.seconds)
            or not 0 <= self.seconds <= 300
            or (self.seconds and self.action != "sleep")
            or (self.data and self.action != "write")
            or (
                self.environment_key is not None
                and (
                    self.action != "write"
                    or not isinstance(self.environment_key, str)
                    or not self.environment_key
                    or self.data
                )
            )
        ):
            raise RuntimeBindingError("invalid bounded worker operation")

    def payload(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "path": self.path,
            "data": base64.b64encode(self.data).decode("ascii"),
            "mode": self.mode,
            "seconds": self.seconds,
            "environment_key": self.environment_key,
        }


@dataclass(frozen=True)
class MutationReceipt:
    receipt_id: str
    run_id: str
    attempt_id: str
    generation: int
    workspace_id: str
    paths: tuple[str, ...]
    program_digest: str
    outcome: str


@dataclass(frozen=True)
class VerifiedSettlement:
    """Accepted only by the live issuer's verify_settlement method."""

    runtime_id: str
    run_id: str
    attempt_id: str
    generation: int
    workspace_id: str
    process_instances: tuple[tuple[str, int], ...]


# -I -S disables ambient Python paths, site, usercustomize and sitecustomize.
# This program has no eval/exec, shell or subprocess primitive. The executable
# and program are code-owned, and dynamic-loader environment injection is denied.
# Every workspace syscall is relative to a pinned directory fd, without following
# symlinks. No recursive deletion or implicit parent creation obscures provenance.
_LEAF_WORKER = r"""
import base64, json, os, stat, sys, time
root = int(sys.argv[1])
program = json.load(sys.stdin)
for op in program:
    action = op['action']
    if action == 'sleep':
        time.sleep(op['seconds'])
        continue
    parts = op['path'].split('/')
    parent = os.dup(root)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=parent)
            os.close(parent)
            parent = child
        name = parts[-1]
        if action == 'write':
            data = (os.environ[op['environment_key']].encode('utf-8')
                    if op['environment_key'] is not None
                    else base64.b64decode(op['data'], validate=True))
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW |
                         os.O_NONBLOCK, op['mode'], dir_fd=parent)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise RuntimeError('not an exclusively owned regular file')
                os.ftruncate(fd, 0)
                remaining = memoryview(data)
                while remaining:
                    remaining = remaining[os.write(fd, remaining):]
                os.fchmod(fd, op['mode'])
                os.fsync(fd)
            finally:
                os.close(fd)
        elif action == 'mkdir':
            os.mkdir(name, mode=op['mode'], dir_fd=parent)
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                         dir_fd=parent)
            try:
                os.fchmod(fd, op['mode'])
            finally:
                os.close(fd)
        elif action == 'delete':
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                os.rmdir(name, dir_fd=parent)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                os.unlink(name, dir_fd=parent)
            else:
                raise RuntimeError('unsupported delete target')
        elif action == 'chmod':
            fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW,
                         dir_fd=parent)
            try:
                info = os.fstat(fd)
                if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                    raise RuntimeError('unsupported mode target')
                if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                    raise RuntimeError('shared file cannot be mutated')
                os.fchmod(fd, op['mode'])
            finally:
                os.close(fd)
        else:
            raise RuntimeError('unsupported operation')
        os.fsync(parent)
    finally:
        os.close(parent)
"""


@dataclass
class _Process:
    instance_id: str
    process: asyncio.subprocess.Process


class BoundRuntime:
    """Run-owned coordination of registered handlers and sealed leaf writers.

    Handlers are trusted application code, not client callables. They must route
    every write through execute_worker and every asynchronous handler through run.
    A new general-purpose adapter must not reuse this stop proof for arbitrary
    shell/MCP code. Losing this object on restart requires recovery, not a claim
    that historical PIDs are dead.

    refresh_authorization is a trusted read-only, cancellation-cooperative
    operation. It must close its own async HTTP resources before terminating;
    it must not dispatch models, threads, files or other writers.
    """

    def __init__(
        self,
        binding: RuntimeBinding,
        *,
        stop_timeout: float = 5.0,
        authorize: Callable[
            [RuntimeBinding, tuple[WorkerOperation, ...]], bool
        ]
        | None = None,
        refresh_authorization: Callable[[], Awaitable[bool]] | None = None,
    ) -> None:
        if (
            os.name != "posix"
            or not hasattr(os, "O_NOFOLLOW")
            or not math.isfinite(stop_timeout)
            or stop_timeout <= 0
        ):
            raise RuntimeBindingError("unsupported runtime or stop timeout")
        self._binding = binding
        self._authorize = authorize
        self._refresh_authorization = refresh_authorization
        self.runtime_id = uuid.uuid4().hex
        self.stop_timeout = stop_timeout
        self.cancelled = asyncio.Event()
        self._lock = asyncio.Lock()
        self._mutation_lock = asyncio.Lock()
        self._stop_lock = asyncio.Lock()
        self._sealed = False
        self._unknown_writer = False
        self._proof: VerifiedSettlement | None = None
        self._tasks: set[asyncio.Task[Any]] = set()
        # Only the explicitly registered read-only authorization operation is
        # cancellation-safe. Its coroutine owns HTTP cleanup and may wait on a
        # shared registration lock; neither that lock's owner nor peer requests
        # belong to this runtime. Never put handlers/model/file writers here.
        self._authorization_tasks: set[asyncio.Task[bool]] = set()
        self._processes: list[_Process] = []
        self._mutations: dict[str, MutationReceipt] = {}
        self._programs: dict[str, tuple[str, asyncio.Task[Any]]] = {}
        root = Path(binding.workspace.local_root)
        if not root.is_absolute() or root.resolve(strict=True) != root:
            raise RuntimeBindingError("workspace must have a canonical root")
        self._root_fd = os.open(
            root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        )
        observed = os.fstat(self._root_fd)
        self._root_identity = (observed.st_dev, observed.st_ino)
        self._executable = str(Path(sys.executable).resolve(strict=True))

    @property
    def binding(self) -> RuntimeBinding:
        return self._binding

    @property
    def sealed(self) -> bool:
        return self._sealed

    def _check_root(self) -> None:
        current = os.stat(
            self.binding.workspace.local_root, follow_symlinks=False
        )
        if (
            not stat.S_ISDIR(current.st_mode)
            or (
                current.st_dev,
                current.st_ino,
            )
            != self._root_identity
        ):
            raise RuntimeBindingError("workspace physical identity changed")

    def _require_open(self) -> None:
        if self._sealed:
            raise RuntimeSealed("Attempt writer dispatch is sealed")
        self._check_root()

    def require_dispatch(self) -> None:
        """Check exact owner and live authorization before an Agent action."""
        self._require_open()
        try:
            allowed = (
                self._authorize is not None
                and self._authorize(self.binding, ()) is True
            )
        except Exception:
            allowed = False
        if not allowed:
            raise RuntimeBindingError("execution dispatch is not authorized")

    async def refresh_authorization(self) -> None:
        self._require_open()
        if self._refresh_authorization is not None:
            # Keep the concrete request through cancellation and HTTP cleanup.
            # Cancelling a waiter releases only this request's lock wait, not
            # the shared lock holder or another Run's authorization request.
            task = self._track(
                asyncio.create_task(self._refresh_authorization())
            )
            self._authorization_tasks.add(task)
            try:
                allowed = await asyncio.shield(task)
            except asyncio.CancelledError:
                self._cancel_authorization(task)
                raise
            if allowed is not True:
                raise RuntimeBindingError(
                    "execution authorization unavailable"
                )
        self.require_dispatch()

    @staticmethod
    def _cancel_authorization(task: asyncio.Task[bool]) -> None:
        # A repeated stop/cancel must not interrupt the first cancellation's
        # async cleanup. The task remains in _tasks until stop observes it done.
        if not task.done() and not task.cancelling():
            task.cancel()

    async def read_file(self, path: str) -> bytes:
        """Bounded read using the same pinned, no-follow workspace root."""
        relative_path(path)
        async with self._lock:
            await self.refresh_authorization()
            self.require_dispatch()
            parent = os.dup(self._root_fd)
            descriptor = None
            try:
                parts = path.split("/")
                for part in parts[:-1]:
                    child = os.open(
                        part,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=parent,
                    )
                    os.close(parent)
                    parent = child
                descriptor = os.open(
                    parts[-1],
                    os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                    dir_fd=parent,
                )
                info = os.fstat(descriptor)
                if (
                    not stat.S_ISREG(info.st_mode)
                    or info.st_size > 1024 * 1024
                ):
                    raise RuntimeBindingError(
                        "read requires a bounded regular file"
                    )
                result = bytearray()
                while len(result) <= 1024 * 1024:
                    block = os.read(descriptor, 65536)
                    if not block:
                        return bytes(result)
                    result.extend(block)
                raise RuntimeBindingError("file exceeded read limit")
            finally:
                if descriptor is not None:
                    os.close(descriptor)
                os.close(parent)

    def _track(self, task: asyncio.Task[Any]) -> asyncio.Task[Any]:
        self._tasks.add(task)
        # Observe abandoned handler exceptions without dropping the owned task.
        # A caller cancelling its wait must not cancel or orphan its writer.
        task.add_done_callback(
            lambda done: None if done.cancelled() else done.exception()
        )
        return task

    async def run(
        self, handler: Callable[[BoundRuntime], Awaitable[Any]]
    ) -> Any:
        async with self._lock:
            self._require_open()

            async def invoke() -> Any:
                self._require_open()
                return await handler(self)

            task = self._track(asyncio.create_task(invoke()))
        return await asyncio.shield(task)

    async def execute_worker(
        self,
        operations: Sequence[WorkerOperation],
        *,
        mutation_id: str,
    ) -> MutationReceipt:
        operations = tuple(operations)
        if not mutation_id or not operations or len(operations) > 1024:
            raise RuntimeBindingError("bounded mutation program is required")
        if any(not isinstance(op, WorkerOperation) for op in operations):
            raise RuntimeBindingError(
                "only sealed worker operations are accepted"
            )
        program = canonical_json([op.payload() for op in operations])
        if len(program) > 2 * 1024 * 1024:
            raise RuntimeBindingError("mutation program exceeds byte limit")
        digest = content_digest(program)
        async with self._lock:
            self._require_open()
            existing = self._programs.get(mutation_id)
            if existing is not None:
                if existing[0] != digest:
                    raise RuntimeBindingError(
                        "mutation id reused for different input"
                    )
                task = existing[1]
            else:
                task = self._track(
                    asyncio.create_task(
                        self._execute(program, digest, mutation_id, operations)
                    )
                )
                self._programs[mutation_id] = (digest, task)
        return await asyncio.shield(task)

    async def _execute(
        self,
        program: bytes,
        digest: str,
        mutation_id: str,
        operations: Sequence[WorkerOperation],
    ) -> MutationReceipt:
        # Broad programs in one directory serialize. Separate BoundRuntimes
        # have separate locks and can execute across Sessions concurrently.
        async with self._mutation_lock:
            return await self._execute_serial(
                program, digest, mutation_id, operations
            )

    async def _execute_serial(
        self,
        program: bytes,
        digest: str,
        mutation_id: str,
        operations: Sequence[WorkerOperation],
    ) -> MutationReceipt:
        # Stop cannot seal between spawn and registration. The task is private,
        # shielded from subscriber cancellation, and never cancelled by stop.
        async with self._lock:
            self._require_open()
            # Recheck at the actual spawn boundary, after waiting for the
            # directory mutation lock. Service-owned policy may have revoked
            # this Attempt while its program was queued. Policy exceptions
            # never disclose credential/reference details through this API.
            if self._refresh_authorization is not None:
                await self.refresh_authorization()
            if self._authorize is not None:
                try:
                    allowed = self._authorize(self.binding, tuple(operations))
                except Exception:
                    raise RuntimeBindingError(
                        "worker dispatch authorization unavailable"
                    ) from None
                if allowed is not True:
                    raise RuntimeBindingError(
                        "worker dispatch is not authorized"
                    )
            process = await asyncio.create_subprocess_exec(
                self._executable,
                "-I",
                "-S",
                "-c",
                _LEAF_WORKER,
                str(self._root_fd),
                cwd=self.binding.workspace.local_root,
                env=dict(self.binding.env),
                pass_fds=(self._root_fd,),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
            )
            self._processes.append(_Process(uuid.uuid4().hex, process))
        try:
            await process.communicate(program)
        finally:
            # A stopped/failed worker may already have written an authorized
            # prefix. Retain that scope so recovery checkpoints have provenance.
            code = process.returncode
            if code is not None:
                receipt = MutationReceipt(
                    receipt_id=f"mutation:{self.runtime_id}:{mutation_id}",
                    run_id=self.binding.run_id,
                    attempt_id=self.binding.attempt_id,
                    generation=self.binding.generation,
                    workspace_id=self.binding.workspace.workspace_id,
                    paths=tuple(
                        sorted({op.path for op in operations if op.path})
                    ),
                    program_digest=digest,
                    outcome="completed"
                    if code == 0
                    else "stopped"
                    if self._sealed
                    else "failed",
                )
                self._mutations[mutation_id] = receipt
        if process.returncode != 0:
            raise WorkerExecutionError("sealed worker did not complete")
        return self._mutations[mutation_id]

    def flag_unmanaged_writer(self) -> None:
        """Fail closed if a trusted adapter discovers an unowned writer.

        This cannot be cleared by TTL or stop retries. Recovery needs a separate
        verified ownership/containment protocol outside this bounded adapter.
        """
        self._unknown_writer = True

    async def stop(self) -> VerifiedSettlement:
        if asyncio.current_task() in self._tasks:
            raise UnsettledWriters(
                "a writer cannot certify its own completion"
            )
        async with self._stop_lock:
            self._sealed = True
            self.cancelled.set()
            for task in self._authorization_tasks:
                self._cancel_authorization(task)
            async with self._lock:
                # A read can hold _lock while awaiting authorization. Cancel
                # its owned request first so it can release the lock. In-flight
                # file dispatch still finishes recording its child under this
                # lock before we capture and terminate concrete process handles.
                processes = tuple(self._processes)
                if self._root_fd is not None:
                    # Every admitted child has inherited its own fd; queued
                    # programs now fail closed. Also release on failed stop.
                    os.close(self._root_fd)
                    self._root_fd = None
            # Never cancel arbitrary handler tasks and treat CancelledError as
            # proof: cancellation can abandon a to_thread writer. Trusted
            # handlers must finish after the cancellation signal or block finalization.
            for owned in processes:
                if owned.process.returncode is None:
                    try:
                        owned.process.terminate()
                    except ProcessLookupError:
                        pass
            pending = {task for task in self._tasks if not task.done()}
            if pending:
                _done, pending = await asyncio.wait(
                    pending, timeout=self.stop_timeout
                )
            if pending or any(p.process.returncode is None for p in processes):
                for owned in processes:
                    if owned.process.returncode is None:
                        try:
                            owned.process.kill()
                        except ProcessLookupError:
                            pass
                waits = [
                    asyncio.create_task(p.process.wait()) for p in processes
                ]
                if waits:
                    _done, waiting = await asyncio.wait(
                        waits, timeout=self.stop_timeout
                    )
                    if waiting:
                        raise UnsettledWriters("owned child did not exit")
                if pending:
                    _done, pending = await asyncio.wait(
                        pending, timeout=self.stop_timeout
                    )
            if pending or self._unknown_writer:
                raise UnsettledWriters("writer ownership has not settled")
            if any(p.process.returncode is None for p in self._processes):
                raise UnsettledWriters("owned process has not been reaped")
            self._check_root()
            if self._proof is None:
                self._proof = VerifiedSettlement(
                    runtime_id=self.runtime_id,
                    run_id=self.binding.run_id,
                    attempt_id=self.binding.attempt_id,
                    generation=self.binding.generation,
                    workspace_id=self.binding.workspace.workspace_id,
                    process_instances=tuple(
                        (p.instance_id, p.process.returncode)
                        for p in self._processes
                    ),
                )
            return self._proof

    def verify_settlement(self, proof: VerifiedSettlement) -> dict[str, Any]:
        if (
            proof is None
            or proof is not self._proof
            or not self._sealed
            or self._unknown_writer
            or any(not task.done() for task in self._tasks)
            or any(p.process.returncode is None for p in self._processes)
        ):
            raise UnsettledWriters("no live verified writer settlement")
        self._check_root()
        return {
            "outcome": "stopped",
            "runtime_id": proof.runtime_id,
            "run_id": proof.run_id,
            "attempt_id": proof.attempt_id,
            "generation": proof.generation,
            "workspace_id": proof.workspace_id,
            "environment_spec_id": self.binding.environment_spec_id,
            "worker_program_digest": content_digest(_LEAF_WORKER.encode()),
            "evidence": "retained_direct_child_handles_for_sealed_leaf_worker",
            "process_instances": [
                list(item) for item in proof.process_instances
            ],
        }

    @property
    def mutation_receipts(self) -> tuple[str, ...]:
        return tuple(
            receipt.receipt_id for receipt in self._mutations.values()
        )

    def path_provenance(self, changed_paths: Iterable[str]) -> dict[str, str]:
        if self._proof is None:
            raise UnsettledWriters(
                "checkpoint provenance requires stopped writers"
            )
        self.verify_settlement(self._proof)
        paths = tuple(changed_paths)
        if len(set(paths)) != len(paths):
            raise RuntimeBindingError("duplicate checkpoint paths")
        authorized = {}
        for receipt in self._mutations.values():
            if (
                receipt.run_id,
                receipt.attempt_id,
                receipt.generation,
                receipt.workspace_id,
            ) != (
                self.binding.run_id,
                self.binding.attempt_id,
                self.binding.generation,
                self.binding.workspace.workspace_id,
            ):
                raise RuntimeBindingError("mutation owner mismatch")
            authorized.update(
                {path: receipt.receipt_id for path in receipt.paths}
            )
        result = {}
        for path in paths:
            relative_path(path)
            if path not in authorized:
                raise RuntimeBindingError(
                    "checkpoint contains an unowned mutation"
                )
            result[path] = authorized[path]
        return result
