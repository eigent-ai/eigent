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
import json

import pytest

from app.controller.chat_controller import timeout_stream_wrapper
from app.run_runtime import RunCoordinator


def _decode_sse(value: str) -> dict:
    assert value.startswith("data: ")
    return json.loads(value[6:].strip())


@pytest.mark.asyncio
async def test_idle_heartbeat_does_not_cancel_detached_execution():
    coordinator = RunCoordinator()
    release = asyncio.Event()
    completed = asyncio.Event()

    async def source():
        await release.wait()
        completed.set()
        yield "event-after-idle"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    handle = subscription.handle
    stream = timeout_stream_wrapper(
        subscription,
        timeout_seconds=0.01,
        run_id="run-1",
    )

    heartbeat = _decode_sse(await stream.__anext__())
    assert heartbeat == {
        "step": "heartbeat",
        "data": {"scope": "transport", "run_id": "run-1"},
    }
    assert handle.consumer_alive is True

    await stream.aclose()
    assert handle.subscriber_count == 0
    assert handle.consumer_alive is True

    release.set()
    await handle.wait()
    assert completed.is_set()


@pytest.mark.asyncio
async def test_heartbeat_uses_rebound_follow_up_run_id():
    coordinator = RunCoordinator()

    async def source():
        await asyncio.Event().wait()
        yield "never"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    await coordinator.rebind_run("run-1", "run-2")
    stream = timeout_stream_wrapper(
        subscription,
        timeout_seconds=0.01,
        run_id="run-1",
    )

    heartbeat = _decode_sse(await stream.__anext__())
    assert heartbeat["data"]["run_id"] == "run-2"

    await stream.aclose()
    await coordinator.close()
