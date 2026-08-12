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


class ActiveExecutionTimeout:
    """An ``asyncio.timeout`` whose deadline can be paused by nested code."""

    def __init__(self, seconds: float) -> None:
        self._seconds = seconds
        self._timeout: asyncio.Timeout | None = None
        self._token: Token[ActiveExecutionTimeout | None] | None = None
        self._pause_depth = 0
        self._remaining: float | None = None

    async def __aenter__(self) -> ActiveExecutionTimeout:
        self._timeout = asyncio.timeout(self._seconds)
        await self._timeout.__aenter__()
        self._token = _ACTIVE_EXECUTION_TIMEOUT.set(self)
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None:
        if self._token is not None:
            _ACTIVE_EXECUTION_TIMEOUT.reset(self._token)
            self._token = None
        assert self._timeout is not None
        return await self._timeout.__aexit__(exc_type, exc_value, traceback)

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


_ACTIVE_EXECUTION_TIMEOUT: ContextVar[ActiveExecutionTimeout | None] = (
    ContextVar("active_execution_timeout", default=None)
)


@asynccontextmanager
async def pause_active_execution_timeout() -> AsyncIterator[None]:
    """Exclude a durable human wait from the current Agent timeout budget."""

    timeout = _ACTIVE_EXECUTION_TIMEOUT.get()
    if timeout is None:
        yield
        return
    timeout.pause()
    try:
        yield
    finally:
        timeout.resume()
