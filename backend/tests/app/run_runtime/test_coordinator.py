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

import pytest

from app.run_runtime import RunCoordinator, RunExecutionError


@pytest.mark.asyncio
async def test_initial_subscriber_is_registered_before_first_publish():
    coordinator = RunCoordinator()

    async def source():
        yield "first"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )

    assert await subscription.__anext__() == "first"
    with pytest.raises(StopAsyncIteration):
        await subscription.__anext__()


@pytest.mark.asyncio
async def test_terminal_marker_has_reserved_capacity():
    coordinator = RunCoordinator()

    async def source():
        yield "only-event"

    subscription = await coordinator.start_with_subscription(
        run_id="run-small-buffer",
        stream_factory=source,
        subscriber_buffer=1,
    )
    await subscription.handle.wait()

    assert await subscription.__anext__() == "only-event"
    with pytest.raises(StopAsyncIteration):
        await subscription.__anext__()


@pytest.mark.asyncio
async def test_detaching_last_subscriber_does_not_cancel_execution():
    coordinator = RunCoordinator()
    release = asyncio.Event()
    continued = asyncio.Event()

    async def source():
        yield "first"
        await release.wait()
        continued.set()
        yield "second"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    handle = subscription.handle
    assert await subscription.__anext__() == "first"

    await subscription.aclose()
    assert handle.subscriber_count == 0
    assert handle.consumer_alive is True

    release.set()
    await handle.wait()
    assert continued.is_set()


@pytest.mark.asyncio
async def test_execution_failure_is_forwarded_without_unhandled_task_error():
    coordinator = RunCoordinator()

    async def source():
        yield "first"
        raise ValueError("boom")

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    assert await subscription.__anext__() == "first"
    with pytest.raises(RunExecutionError, match="boom"):
        await subscription.__anext__()


@pytest.mark.asyncio
async def test_explicit_coordinator_close_cancels_execution():
    coordinator = RunCoordinator()
    started = asyncio.Event()

    async def source():
        started.set()
        await asyncio.Event().wait()
        yield "never"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    handle = subscription.handle
    await started.wait()

    await coordinator.close()

    assert handle.execution_task is not None
    assert handle.execution_task.cancelled()
    assert handle.completed_at is not None
