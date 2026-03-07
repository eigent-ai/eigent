# ========= Copyright 2025 @ EIGENT.AI. All Rights Reserved. =========
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
# ========= Copyright 2025 @ EIGENT.AI. All Rights Reserved. =========

"""Performance timing utilities for measuring setup and task execution durations.

Provides a context manager and decorator for capturing wall-clock timing of
critical code paths. All timing data is emitted through the traceroot logger
so it appears in production logs without extra dependencies.

Usage::

    from app.utils.perf_timer import PerfTimer, perf_measure

    # Context manager
    with PerfTimer("backend_startup") as t:
        do_startup()
    print(t.duration_ms)  # 1234.56

    # Decorator
    @perf_measure("my_function")
    async def my_function():
        ...
"""

import asyncio
import functools
import time
from typing import Any

import logging

logger = logging.getLogger("perf")


class PerfTimer:
    """High-resolution wall-clock timer as a context manager.

    Attributes:
        operation: Human-readable label for the timed block.
        start_time: Monotonic timestamp when the block was entered.
        end_time: Monotonic timestamp when the block was exited.
        duration_ms: Elapsed wall-clock time in milliseconds.
        context: Arbitrary key-value metadata included in the log line.
    """

    def __init__(self, operation: str, **context: Any) -> None:
        self.operation = operation
        self.context = context
        self.start_time: float = 0.0
        self.end_time: float = 0.0
        self.duration_ms: float = 0.0

    def __enter__(self) -> "PerfTimer":
        self.start_time = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.end_time = time.perf_counter()
        self.duration_ms = (self.end_time - self.start_time) * 1000.0

        extra = {
            "perf_operation": self.operation,
            "perf_duration_ms": round(self.duration_ms, 2),
            **self.context,
        }
        if exc_type is not None:
            extra["perf_error"] = str(exc_val)
            logger.warning(
                f"[PERF] {self.operation} completed with error in {self.duration_ms:.2f}ms",
                extra=extra,
            )
        else:
            logger.info(
                f"[PERF] {self.operation} completed in {self.duration_ms:.2f}ms",
                extra=extra,
            )
        # Do not suppress exceptions
        return None

    async def __aenter__(self) -> "PerfTimer":
        self.start_time = time.perf_counter()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        self.__exit__(exc_type, exc_val, exc_tb)


def perf_measure(_func=None, *, operation: str | None = None, **extra_context: Any):
    """Decorator that logs execution duration for sync and async functions.

    Supports both ``@perf_measure`` and ``@perf_measure(operation="label")``
    usage patterns.

    Args:
        _func: Internal; set automatically when used as ``@perf_measure``
            without parentheses.
        operation: Label for the timed operation. Defaults to the function name.
        **extra_context: Additional key-value pairs included in the log output.

    Returns:
        Decorated function that logs its execution time.
    """

    def decorator(func):
        label = operation or func.__qualname__

        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            with PerfTimer(label, **extra_context):
                return await func(*args, **kwargs)

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            with PerfTimer(label, **extra_context):
                return func(*args, **kwargs)

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    if _func is not None:
        # Called as @perf_measure without parentheses
        return decorator(_func)
    return decorator
