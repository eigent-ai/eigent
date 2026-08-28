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

"""Pause-aware timeout accounting for active Agent execution.

The CAMEL step timeout protects model/tool execution, but a durable
HumanInteraction can legitimately wait much longer than that timeout.  The
same task remains alive while the user decides, so a plain ``wait_for`` would
incorrectly charge human latency to the Agent execution budget.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar, Token
from types import TracebackType
from typing import Protocol


class ActiveExecutionPauseObserver(Protocol):
    """Receives pause accounting shared with an outer runtime watchdog."""

    def pause_active_execution_budget(self) -> None: ...

    def resume_active_execution_budget(self) -> None: ...


class ActiveExecutionTimeout:
    """An ``asyncio.timeout`` whose deadline can be paused by nested code."""

    def __init__(
        self,
        seconds: float,
        *,
        refresh_on_progress: bool = False,
    ) -> None:
        self._seconds = seconds
        self._refresh_on_progress = refresh_on_progress
        self._timeout: asyncio.Timeout | None = None
        self._token: Token[tuple[ActiveExecutionTimeout, ...]] | None = None
        self._pause_depth = 0
        self._remaining: float | None = None

    async def __aenter__(self) -> ActiveExecutionTimeout:
        self._timeout = asyncio.timeout(self._seconds)
        await self._timeout.__aenter__()
        active = _ACTIVE_EXECUTION_TIMEOUTS.get()
        self._token = _ACTIVE_EXECUTION_TIMEOUTS.set((*active, self))
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None:
        if self._token is not None:
            _ACTIVE_EXECUTION_TIMEOUTS.reset(self._token)
            self._token = None
        assert self._timeout is not None
        return await self._timeout.__aexit__(exc_type, exc_value, traceback)

    @property
    def expired(self) -> bool:
        return self._timeout is not None and self._timeout.expired()

    def refresh(self) -> None:
        """Renew a sliding deadline after observable execution progress."""

        if not self._refresh_on_progress:
            return
        if self._pause_depth:
            self._remaining = self._seconds
            return
        assert self._timeout is not None
        loop_time = asyncio.get_running_loop().time()
        deadline = self._timeout.when()
        # A synchronous provider/tool adapter can temporarily block the event
        # loop past the deadline. Do not let a late result resurrect an
        # already-stalled activity before asyncio delivers cancellation.
        if deadline is not None and loop_time >= deadline:
            return
        try:
            self._timeout.reschedule(loop_time + self._seconds)
        except RuntimeError:
            # The timeout may already be expiring on this event-loop tick.
            return

    def pause(self) -> None:
        self._pause_depth += 1
        if self._pause_depth != 1:
            return
        assert self._timeout is not None
        deadline = self._timeout.when()
        loop_time = asyncio.get_running_loop().time()
        self._remaining = (
            None if deadline is None else max(0.0, deadline - loop_time)
        )
        self._timeout.reschedule(None)

    def resume(self) -> None:
        if self._pause_depth <= 0:
            raise RuntimeError("active execution timeout is not paused")
        self._pause_depth -= 1
        if self._pause_depth != 0:
            return
        assert self._timeout is not None
        if self._remaining is None:
            self._timeout.reschedule(None)
        else:
            self._timeout.reschedule(
                asyncio.get_running_loop().time() + self._remaining
            )
        self._remaining = None


_ACTIVE_EXECUTION_TIMEOUTS: ContextVar[tuple[ActiveExecutionTimeout, ...]] = (
    ContextVar(
        "active_execution_timeouts",
        default=(),
    )
)


def refresh_active_execution_timeout() -> None:
    """Refresh every active sliding timeout after durable progress."""

    for timeout in _ACTIVE_EXECUTION_TIMEOUTS.get():
        timeout.refresh()


@asynccontextmanager
async def pause_active_execution_timeout(
    observer: ActiveExecutionPauseObserver | None = None,
) -> AsyncIterator[None]:
    """Exclude a durable human wait from the current Agent timeout budget."""

    timeouts = _ACTIVE_EXECUTION_TIMEOUTS.get()
    if observer is not None:
        observer.pause_active_execution_budget()
    for timeout in timeouts:
        timeout.pause()
    try:
        yield
    finally:
        for timeout in reversed(timeouts):
            timeout.resume()
        if observer is not None:
            observer.resume_active_execution_budget()
