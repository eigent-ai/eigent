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
from dataclasses import dataclass, field
from typing import Any

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
    execution_task: asyncio.Task[None] | None = None
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


class RunCoordinator:
    """Own live execution tasks separately from transport subscribers."""

    def __init__(self) -> None:
        self._handles: dict[str, RuntimeHandle] = {}
        self._lock = asyncio.Lock()

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

    async def cancel(self, run_id: str) -> bool:
        async with self._lock:
            handle = self._handles.get(run_id)
        if handle is None:
            return False
        await handle.cancel()
        return True

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
            error = RunExecutionError(
                f"run {handle.run_id!r} execution failed: {exc}"
            )
            logger.exception(
                "Detached Run execution failed",
                extra={"run_id": handle.run_id},
            )
        finally:
            handle.finish(error)
            async with self._lock:
                if self._handles.get(handle.run_id) is handle:
                    self._handles.pop(handle.run_id, None)
