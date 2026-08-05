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

"""Process-local RunCoordinator and disposable RuntimeHandle.

The coordinator deliberately owns only live process resources. Canonical Run
facts remain in RunJournal; losing every handle on Brain restart is expected.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.run_journal.store import SQLiteRunJournal

logger = logging.getLogger("run_runtime.coordinator")

_STREAM_CLOSED = object()
_DEFAULT_SUBSCRIBER_BUFFER = 256

StreamFactory = Callable[[], AsyncIterator[str]]


class RunRuntimeError(RuntimeError):
    pass


class RunExecutionError(RunRuntimeError):
    pass


class SubscriberLaggedError(RunRuntimeError):
    pass


class RuntimeSubscription(AsyncIterator[str]):
    """One detachable live subscriber; closing it never cancels execution."""

    def __init__(
        self,
        handle: RuntimeHandle,
        subscriber_id: str,
        queue: asyncio.Queue[Any],
    ) -> None:
        self.handle = handle
        self.subscriber_id = subscriber_id
        self._queue = queue
        self._closed = False

    def __aiter__(self) -> RuntimeSubscription:
        return self

    async def __anext__(self) -> str:
        if self._closed:
            raise StopAsyncIteration
        item = await self._queue.get()
        if item is _STREAM_CLOSED:
            await self.aclose()
            raise StopAsyncIteration
        if isinstance(item, Exception):
            await self.aclose()
            raise item
        return str(item)

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.handle.detach_subscriber(self.subscriber_id)


@dataclass
class RuntimeHandle:
    """Disposable resources for one currently executing Run."""

    run_id: str
    command_queue: asyncio.Queue[Any] | None = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    deadline_changed_event: asyncio.Event = field(default_factory=asyncio.Event)
    execution_task: asyncio.Task[None] | None = None
    deadline_task: asyncio.Task[None] | None = None
    started_at: float = field(default_factory=time.time)
    consumer_heartbeat_at: float = field(default_factory=time.time)
    completed_at: float | None = None
    _subscribers: dict[str, asyncio.Queue[Any]] = field(
        default_factory=dict, init=False, repr=False
    )

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    @property
    def consumer_alive(self) -> bool:
        task = self.execution_task
        return task is not None and not task.done()

    def subscribe(
        self, *, max_buffer: int = _DEFAULT_SUBSCRIBER_BUFFER
    ) -> RuntimeSubscription:
        if max_buffer < 1:
            raise ValueError("subscriber max_buffer must be positive")
        subscriber_id = str(uuid.uuid4())
        # Reserve one slot for the terminal marker. Otherwise a source that
        # fills the data buffer and immediately completes would be reported as
        # lagged even though the subscriber has not exceeded its allowance.
        queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=max_buffer + 1)
        self._subscribers[subscriber_id] = queue
        if self.completed_at is not None:
            queue.put_nowait(_STREAM_CLOSED)
        return RuntimeSubscription(self, subscriber_id, queue)

    def detach_subscriber(self, subscriber_id: str) -> None:
        self._subscribers.pop(subscriber_id, None)

    def publish(self, data: str) -> None:
        self.consumer_heartbeat_at = time.time()
        for subscriber_id, queue in list(self._subscribers.items()):
            try:
                if queue.qsize() >= queue.maxsize - 1:
                    raise asyncio.QueueFull
                queue.put_nowait(data)
            except asyncio.QueueFull:
                self._terminate_queue(
                    queue,
                    SubscriberLaggedError(
                        f"subscriber for run {self.run_id!r} fell behind"
                    ),
                )
                self._subscribers.pop(subscriber_id, None)

    def finish(self, error: Exception | None = None) -> None:
        if self.completed_at is not None:
            return
        self.completed_at = time.time()
        deadline_task = self.deadline_task
        if (
            deadline_task is not None
            and deadline_task is not asyncio.current_task()
        ):
            deadline_task.cancel()
        for queue in list(self._subscribers.values()):
            terminal = error if error is not None else _STREAM_CLOSED
            try:
                queue.put_nowait(terminal)
            except asyncio.QueueFull:
                self._terminate_queue(
                    queue,
                    SubscriberLaggedError(
                        f"subscriber for run {self.run_id!r} fell behind"
                    ),
                )
        self._subscribers.clear()

    async def wait(self) -> None:
        task = self.execution_task
        if task is not None and task is not asyncio.current_task():
            await asyncio.shield(task)

    async def cancel(self) -> None:
        self.cancel_event.set()
        task = self.execution_task
        if task is None or task.done():
            return
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    @staticmethod
    def _terminate_queue(queue: asyncio.Queue[Any], item: Any) -> None:
        while not queue.empty():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        queue.put_nowait(item)


@dataclass
class _AdmissionGate:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    users: int = 0


class RunCoordinator:
    """Own live execution tasks separately from transport subscribers."""

    def __init__(self, journal: SQLiteRunJournal | None = None) -> None:
        self._handles: dict[str, RuntimeHandle] = {}
        self._admission_gates: dict[str, _AdmissionGate] = {}
        self._lock = asyncio.Lock()
        self._journal = journal

    def _run_journal(self) -> SQLiteRunJournal:
        if self._journal is not None:
            return self._journal
        from app.run_journal.runtime import get_default_run_journal

        return get_default_run_journal()

    def bind_journal(self, journal: SQLiteRunJournal) -> None:
        """Bind the production store before admitting execution.

        Tests and read-only coordinator uses stay lazy and never create a
        database merely by constructing the process singleton.
        """

        if self._journal is None:
            self._journal = journal
        elif self._journal is not journal:
            if self._handles:
                raise RunRuntimeError(
                    "cannot replace RunJournal while Runs are active"
                )
            self._journal = journal

    @asynccontextmanager
    async def admission_scope(self, run_id: str) -> AsyncIterator[None]:
        """Serialize admission side effects for one Run, not all Runs.

        The controller must enter this scope before creating durable memory,
        mutating compatibility TaskLock state, or queueing the initial command.
        A concurrent retry can then attach to the first consumer without
        repeating any of those effects.
        """

        async with self._lock:
            gate = self._admission_gates.get(run_id)
            if gate is None:
                gate = _AdmissionGate()
                self._admission_gates[run_id] = gate
            gate.users += 1

        acquired = False
        try:
            await gate.lock.acquire()
            acquired = True
            yield
        finally:
            if acquired:
                gate.lock.release()
            async with self._lock:
                gate.users -= 1
                if (
                    gate.users == 0
                    and self._admission_gates.get(run_id) is gate
                ):
                    self._admission_gates.pop(run_id, None)

    async def attach_if_running(
        self,
        run_id: str,
        *,
        max_buffer: int = _DEFAULT_SUBSCRIBER_BUFFER,
    ) -> RuntimeSubscription | None:
        """Attach to a live consumer without admitting a second execution."""

        async with self._lock:
            handle = self._handles.get(run_id)
            if handle is None or not handle.consumer_alive:
                return None
            return handle.subscribe(max_buffer=max_buffer)

    async def start_with_subscription(
        self,
        *,
        run_id: str,
        stream_factory: StreamFactory,
        command_queue: asyncio.Queue[Any] | None = None,
        subscriber_buffer: int = _DEFAULT_SUBSCRIBER_BUFFER,
    ) -> RuntimeSubscription:
        """Register the initial subscriber before execution can publish."""

        async with self._lock:
            existing = self._handles.get(run_id)
            if existing is not None and existing.consumer_alive:
                return existing.subscribe(max_buffer=subscriber_buffer)

            handle = RuntimeHandle(
                run_id=run_id,
                command_queue=command_queue,
            )
            subscription = handle.subscribe(max_buffer=subscriber_buffer)
            self._handles[run_id] = handle
            handle.execution_task = asyncio.create_task(
                self._pump(handle, stream_factory),
                name=f"run:{run_id}",
            )
            if self._journal is not None:
                handle.deadline_task = asyncio.create_task(
                    self._watch_deadline(handle),
                    name=f"run-deadline:{run_id}",
                )
            return subscription

    async def subscribe(
        self, run_id: str, *, max_buffer: int = _DEFAULT_SUBSCRIBER_BUFFER
    ) -> RuntimeSubscription:
        async with self._lock:
            handle = self._handles.get(run_id)
            if handle is None:
                raise RunRuntimeError(f"run {run_id!r} has no live handle")
            return handle.subscribe(max_buffer=max_buffer)

    async def get_handle(self, run_id: str) -> RuntimeHandle | None:
        async with self._lock:
            return self._handles.get(run_id)

    async def rebind_run(self, previous_run_id: str, run_id: str) -> bool:
        """Move a compatibility consumer to a newly admitted follow-up Run."""

        async with self._lock:
            handle = self._handles.get(previous_run_id)
            if handle is None or not handle.consumer_alive:
                return False
            if previous_run_id == run_id:
                return True

            target = self._handles.get(run_id)
            if target is not None and target is not handle:
                raise RunRuntimeError(
                    f"run {run_id!r} already has a live consumer"
                )

            self._handles.pop(previous_run_id, None)
            handle.run_id = run_id
            handle.deadline_changed_event.set()
            self._handles[run_id] = handle
            return True

    async def notify_deadline_changed(self, run_id: str) -> bool:
        async with self._lock:
            handle = self._handles.get(run_id)
            if handle is None or not handle.consumer_alive:
                return False
            handle.deadline_changed_event.set()
            return True

    async def cancel(self, run_id: str) -> bool:
        async with self._lock:
            handle = self._handles.get(run_id)
        if handle is None:
            return False
        await handle.cancel()
        return True

    async def resume(
        self,
        run_id: str,
        *,
        request_id: str,
        reason: str = "explicit_resume",
    ):
        """Create a durable pending Attempt after fail-closed safety checks.

        Reconstructing an EmbeddedExecutionBackend requires fresh credentials
        and workspace bindings from the caller. The Attempt therefore remains
        pending until an execution adapter explicitly activates it; this API
        never pretends that a Python coroutine was restored.
        """

        async with self.admission_scope(run_id):
            handle = await self.get_handle(run_id)
            if handle is not None and handle.consumer_alive:
                raise RunRuntimeError(
                    f"run {run_id!r} already has a live consumer"
                )
            return await asyncio.to_thread(
                self._run_journal().create_run_attempt,
                run_id,
                request_id=request_id,
                reason=reason,
                activate=False,
            )

    async def fork(
        self,
        run_id: str,
        *,
        new_run_id: str,
        request_id: str,
    ):
        async with self.admission_scope(new_run_id):
            return await asyncio.to_thread(
                self._run_journal().fork_run,
                run_id,
                new_run_id=new_run_id,
                request_id=request_id,
            )

    async def cancel_durable(
        self,
        run_id: str,
        *,
        request_id: str,
        reason: str = "explicit_cancel",
    ):
        """Persist cancel intent, stop the process resource, then commit terminal state."""

        async with self.admission_scope(run_id):
            journal = self._run_journal()
            await asyncio.to_thread(
                journal.request_cancel,
                run_id,
                request_id=request_id,
                reason=reason,
            )
            await self.cancel(run_id)
            return await asyncio.to_thread(
                journal.complete_cancel,
                run_id,
                request_id=request_id,
            )

    async def close(self) -> None:
        async with self._lock:
            handles = list(self._handles.values())
            self._handles.clear()
        await asyncio.gather(
            *(handle.cancel() for handle in handles),
            return_exceptions=True,
        )

    async def _pump(
        self, handle: RuntimeHandle, stream_factory: StreamFactory
    ) -> None:
        error: Exception | None = None
        try:
            async for data in stream_factory():
                handle.publish(data)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._commit_execution_terminal(
                handle,
                event_type="run.failed",
                payload={
                    "reason": "execution_backend_failure",
                    "error_type": type(exc).__name__,
                    "message": str(exc)[:4000],
                },
            )
            error = RunExecutionError(
                f"run {handle.run_id!r} execution failed: {exc}"
            )
            logger.exception(
                "Detached Run execution failed",
                extra={"run_id": handle.run_id},
            )
        else:
            await self._commit_execution_terminal(
                handle,
                event_type="run.completed",
                payload={"reason": "execution_backend_completed"},
            )
        finally:
            handle.finish(error)
            async with self._lock:
                if self._handles.get(handle.run_id) is handle:
                    self._handles.pop(handle.run_id, None)

    async def _commit_execution_terminal(
        self,
        handle: RuntimeHandle,
        *,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        if self._journal is None:
            return
        from app.run_journal.models import RunEventDraft

        run = await asyncio.to_thread(self._journal.get_run, handle.run_id)
        if run is None or run.status in {"completed", "failed", "cancelled"}:
            return
        try:
            await asyncio.to_thread(
                self._journal.append_event,
                handle.run_id,
                RunEventDraft(
                    event_id=(
                        f"runtime-terminal:{handle.run_id}:"
                        f"{int(handle.started_at * 1_000_000)}:{event_type}"
                    ),
                    event_type=event_type,
                    payload=payload,
                ),
            )
            from app.run_sync.runtime import notify_default_cloud_sync_worker

            notify_default_cloud_sync_worker()
        except Exception:
            logger.exception(
                "Failed to commit execution terminal outcome",
                extra={"run_id": handle.run_id, "event_type": event_type},
            )

    async def _watch_deadline(self, handle: RuntimeHandle) -> None:
        if self._journal is None:
            return
        from app.run_journal import InvalidRunTransitionError
        from app.run_policy import TimeoutOutcome, TimeoutScope

        try:
            while True:
                # Clear before reading SQLite. A concurrent policy change either
                # becomes visible in this read or sets the Event afterwards.
                handle.deadline_changed_event.clear()
                current = await asyncio.to_thread(
                    self._journal.get_run, handle.run_id
                )
                if current is None or current.status in {
                    "completed",
                    "failed",
                    "cancelled",
                }:
                    return
                if current.deadline_at is None:
                    try:
                        await asyncio.wait_for(
                            handle.deadline_changed_event.wait(),
                            timeout=1.0,
                        )
                    except TimeoutError:
                        pass
                    continue
                remaining = current.deadline_at - time.time()
                if remaining > 0:
                    try:
                        await asyncio.wait_for(
                            handle.deadline_changed_event.wait(),
                            timeout=remaining,
                        )
                    except TimeoutError:
                        pass
                    else:
                        continue
                    # Re-read after the timer. An extension that missed the
                    # notification must reschedule instead of disabling the
                    # watcher permanently.
                    current = await asyncio.to_thread(
                        self._journal.get_run, handle.run_id
                    )
                    if (
                        current is None
                        or current.deadline_at is None
                        or current.status
                        in {"completed", "failed", "cancelled"}
                    ):
                        return
                    if time.time() < current.deadline_at:
                        continue
                attempt = (
                    await asyncio.to_thread(
                        self._journal.get_run_attempt,
                        current.active_attempt_id,
                    )
                    if current.active_attempt_id
                    else None
                )
                try:
                    await asyncio.to_thread(
                        self._journal.record_timeout_outcome,
                        TimeoutOutcome(
                            scope=TimeoutScope.RUN_DEADLINE,
                            policy_version=current.timeout_policy_version,
                            reason="persisted_run_deadline_reached",
                            started_at=(
                                attempt.started_at
                                if attempt
                                else current.created_at
                            ),
                            ended_at=current.deadline_at,
                            run_id=current.run_id,
                            attempt_id=attempt.attempt_id if attempt else None,
                        ),
                    )
                except InvalidRunTransitionError:
                    # A policy update won the SQLite transaction race. Re-read
                    # and schedule the new authoritative deadline.
                    continue
                try:
                    from app.run_sync.runtime import (
                        notify_default_cloud_sync_worker,
                    )

                    notify_default_cloud_sync_worker()
                except Exception:
                    logger.exception(
                        "Failed to wake cloud sync after Run deadline",
                        extra={"run_id": handle.run_id},
                    )
                handle.cancel_event.set()
                execution = handle.execution_task
                if execution is not None and not execution.done():
                    execution.cancel()
                    await asyncio.gather(execution, return_exceptions=True)
                return
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Failed to enforce persisted Run deadline",
                extra={"run_id": handle.run_id},
            )
