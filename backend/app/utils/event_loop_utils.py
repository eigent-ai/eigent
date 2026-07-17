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

import asyncio
import concurrent.futures
import contextvars
import logging
from collections.abc import Coroutine
from threading import Lock
from typing import Any

# Thread-safe reference to main event loop using contextvars
# This ensures each request has its own event loop reference, avoiding race conditions
_main_event_loop_var: contextvars.ContextVar[
    asyncio.AbstractEventLoop | None
] = contextvars.ContextVar("_main_event_loop", default=None)

# Global fallback for main event loop reference
# Used when contextvars don't propagate to worker threads (e.g., asyncio.to_thread)
_GLOBAL_MAIN_LOOP: asyncio.AbstractEventLoop | None = None
_GLOBAL_MAIN_LOOP_LOCK = Lock()


def set_main_event_loop(loop: asyncio.AbstractEventLoop | None):
    """Set the main event loop reference for thread-safe task scheduling.

    This should be called from the main async context before spawning threads
    that need to schedule async tasks. Uses both contextvars (for request isolation)
    and a global fallback (for thread pool workers where contextvars may not propagate).
    """
    global _GLOBAL_MAIN_LOOP
    _main_event_loop_var.set(loop)
    with _GLOBAL_MAIN_LOOP_LOCK:
        _GLOBAL_MAIN_LOOP = loop


def _get_registered_main_loop() -> asyncio.AbstractEventLoop | None:
    main_loop = _main_event_loop_var.get()
    if main_loop is None:
        with _GLOBAL_MAIN_LOOP_LOCK:
            main_loop = _GLOBAL_MAIN_LOOP
    if main_loop is not None and main_loop.is_running():
        return main_loop
    return None


def _schedule_async_task(coro):
    """Schedule an async coroutine as a task, thread-safe.

    This function handles scheduling from both the main event loop thread
    and from worker threads (e.g., when using asyncio.to_thread).
    """
    main_loop = _get_registered_main_loop()
    try:
        # Try to get the running loop. If this is a secondary loop, schedule
        # back onto the registered main loop so TaskLock queue wakeups happen
        # on the consumer loop.
        loop = asyncio.get_running_loop()
        if main_loop is not None and main_loop is not loop:
            return asyncio.run_coroutine_threadsafe(coro, main_loop)
        return loop.create_task(coro)
    except RuntimeError:
        # No running loop in this thread (we're in a worker thread)
        if main_loop is not None:
            return asyncio.run_coroutine_threadsafe(coro, main_loop)
        else:
            # This should not happen in normal operation - log error and skip
            close = getattr(coro, "close", None)
            if callable(close):
                close()
            logging.error(
                "No event loop available for async task scheduling, task skipped. "
                "Ensure set_main_event_loop() is called before parallel agent creation."
            )
            return None


def schedule_async_task_from_worker(
    coro: Coroutine[Any, Any, Any],
    *,
    timeout: float = 5.0,
    description: str = "async task",
) -> Any:
    """Run a coroutine on the registered main loop from a sync worker.

    Sync FastAPI endpoints run in Starlette's thread pool, but TaskLock queues
    are consumed on the main event loop. Calling ``asyncio.run`` in those
    worker threads creates a temporary loop and can fail to wake the main-loop
    queue consumer. This helper schedules the coroutine on the registered main
    loop and waits briefly so callers get a real failure instead of a silent
    dropped event.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass
    else:
        close = getattr(coro, "close", None)
        if callable(close):
            close()
        raise RuntimeError(
            f"{description} must be awaited directly from async code"
        )

    future = _schedule_async_task(coro)
    if future is None:
        raise RuntimeError(f"Could not schedule {description}")

    try:
        return future.result(timeout=timeout)
    except concurrent.futures.TimeoutError as exc:
        raise TimeoutError(
            f"Timed out waiting for {description} after {timeout}s"
        ) from exc
