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

"""single_agent_service skip lifecycle regression tests."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.unit


def _parse_sse(line: str) -> tuple[str, object]:
    """Parse a `data: {...}\\n\\n` SSE line into (step, payload)."""

    assert line.startswith("data: "), line
    payload = json.loads(line[len("data: ") :].strip())
    return payload.get("step", ""), payload.get("data")


@pytest.mark.asyncio
async def test_skip_task_emits_end_without_blocking_on_cancellation():
    """R27-2 regression: pressing Skip while the turn is mid-flight in a
    non-cooperative coroutine (e.g. stuck inside a model HTTP call that does
    not propagate CancelledError) must still produce the user-facing "end"
    event promptly. The previous R26 fix added `await running_turn` after
    cancel(), which would block this generator until the turn actually
    finished cleaning up.
    """

    from app.model.chat import Chat
    from app.service.single_agent_service import single_agent_solve
    from app.service.task import (
        ActionImproveData,
        ActionSkipTaskData,
        ImprovePayload,
    )

    # A running_turn that ignores cancellation -- mimics a stuck model call.
    async def never_resolves():
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            # Pretend the underlying tool swallowed the cancel; keep sleeping.
            await asyncio.sleep(60)
            raise

    # Fake agent whose astep returns the never-resolving coroutine.
    fake_agent = MagicMock()
    fake_agent.astep = lambda prompt: never_resolves()
    fake_agent.agent_id = "fake_single_agent"
    fake_agent._observable_todo_toolkit = None

    # Queue: improve action first, then skip after the turn is in flight.
    queue: asyncio.Queue = asyncio.Queue()

    improve_item = ActionImproveData(
        data=ImprovePayload(
            question="do something slow",
            attaches=[],
            project_context=None,
        ),
        new_task_id="task_skip",
    )
    skip_item = ActionSkipTaskData(project_id="project_skip")
    await queue.put(improve_item)

    task_lock = MagicMock()
    task_lock.id = "task_skip"
    task_lock.email = "u@example.com"
    task_lock.status = "OPEN"
    task_lock.conversation_history = []
    task_lock.last_task_result = ""
    task_lock.agent_memory_history = []
    task_lock.memory_summary = ""
    task_lock.summary_generated = False
    task_lock.run_context = None  # disables durable read

    async def get_queue():
        return await queue.get()

    task_lock.get_queue = get_queue
    task_lock.add_background_task = MagicMock()

    request = MagicMock()
    request.is_disconnected = AsyncMock(return_value=False)

    options = MagicMock(spec=Chat)
    options.project_id = "project_skip"
    options.task_id = "task_skip"
    options.project_context = None

    with (
        patch(
            "app.service.single_agent_service.single_agent",
            new=AsyncMock(return_value=fake_agent),
        ),
        patch("app.service.single_agent_service.set_current_task_id"),
        patch("app.service.single_agent_service.record_agent_memory_snapshot"),
        patch(
            "app.service.single_agent_service.build_memory_context",
            return_value="",
        ),
        patch("app.service.single_agent_service._finalize_memory_for_turn"),
        patch(
            "app.service.single_agent_service._build_single_agent_context",
            return_value="",
        ),
    ):
        agen = single_agent_solve(options, request, task_lock)

        # First frame: "confirmed" after the improve action lands.
        confirmed = await asyncio.wait_for(agen.__anext__(), timeout=3.0)
        event, _ = _parse_sse(confirmed)
        assert event == "confirmed", confirmed

        # The turn is now running and stuck. Send skip.
        await queue.put(skip_item)

        # Critical assertion: the "end" event arrives quickly, even though
        # the running_turn would block for ~60s. Use a tight 3s timeout --
        # before R27-2 this would hang at `await running_turn` until the
        # never-resolving coroutine completed.
        end_frame = await asyncio.wait_for(agen.__anext__(), timeout=3.0)
        event, payload = _parse_sse(end_frame)
        assert event == "end", end_frame
        assert "stopped by user" in str(payload).lower(), payload

        # Cleanup: close the generator so the underlying task gets cancelled
        # and pytest does not warn about pending tasks.
        await agen.aclose()
