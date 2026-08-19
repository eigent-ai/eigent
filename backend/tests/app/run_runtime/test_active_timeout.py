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

from __future__ import annotations

import asyncio
import time

import pytest

from app.run_runtime.active_timeout import (
    ActiveExecutionTimeout,
    pause_active_execution_timeout,
    refresh_active_execution_timeout,
)


@pytest.mark.asyncio
async def test_human_wait_does_not_consume_active_execution_timeout():
    async with ActiveExecutionTimeout(0.02):
        async with pause_active_execution_timeout():
            await asyncio.sleep(0.04)
        await asyncio.sleep(0.001)


@pytest.mark.asyncio
async def test_active_execution_still_times_out_without_pause():
    with pytest.raises(TimeoutError):
        async with ActiveExecutionTimeout(0.01):
            await asyncio.sleep(0.03)


@pytest.mark.asyncio
async def test_sliding_timeout_refreshes_while_execution_makes_progress():
    async with ActiveExecutionTimeout(0.02, refresh_on_progress=True):
        for _ in range(3):
            await asyncio.sleep(0.012)
            refresh_active_execution_timeout()


@pytest.mark.asyncio
async def test_refresh_does_not_extend_a_hard_execution_timeout():
    with pytest.raises(TimeoutError):
        async with ActiveExecutionTimeout(0.02):
            await asyncio.sleep(0.012)
            refresh_active_execution_timeout()
            await asyncio.sleep(0.012)


@pytest.mark.asyncio
async def test_late_progress_cannot_resurrect_expired_sliding_timeout():
    with pytest.raises(TimeoutError):
        async with ActiveExecutionTimeout(0.01, refresh_on_progress=True):
            time.sleep(0.02)
            refresh_active_execution_timeout()
            await asyncio.sleep(0.001)


@pytest.mark.asyncio
async def test_human_wait_pauses_nested_hard_and_sliding_timeouts():
    async with ActiveExecutionTimeout(0.02):
        async with ActiveExecutionTimeout(0.02, refresh_on_progress=True):
            async with pause_active_execution_timeout():
                await asyncio.sleep(0.04)
            refresh_active_execution_timeout()
            await asyncio.sleep(0.001)
