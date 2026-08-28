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


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (
            type("StatusError", (RuntimeError,), {"status_code": 499})(
                "closed"
            ),
            True,
        ),
        (RuntimeError("Client Closed Request"), True),
        (RuntimeError("invalid model configuration"), False),
    ],
)
def test_retryable_turn_error_classification(error, expected):
    from app.service.single_agent_service import _is_retryable_turn_error

    assert _is_retryable_turn_error(error) is expected


def test_write_file_sse_carries_portable_relative_identity():
    from app.service.single_agent_service import _action_to_sse
    from app.service.task import ActionWriteFileData

    line = _action_to_sse(
        ActionWriteFileData(
            process_task_id="task-1",
            data="/private/run/reports/summary.md",
            relative_path="reports/summary.md",
        )
    )

    assert line is not None
    assert _parse_sse(line) == (
        "write_file",
        {
            "file_path": "/private/run/reports/summary.md",
            "process_task_id": "task-1",
            "relative_path": "reports/summary.md",
        },
    )


def test_write_file_sse_omits_untrusted_relative_identity():
    from app.service.single_agent_service import _action_to_sse
    from app.service.task import ActionWriteFileData

    line = _action_to_sse(
        ActionWriteFileData(
            process_task_id="task-1",
            data="/outside/summary.md",
        )
    )

    assert line is not None
    assert _parse_sse(line) == (
        "write_file",
        {
            "file_path": "/outside/summary.md",
            "process_task_id": "task-1",
        },
    )


def test_notice_sse_carries_stable_tool_call_identity():
    from app.service.single_agent_service import _action_to_sse
    from app.service.task import ActionNoticeData

    line = _action_to_sse(
        ActionNoticeData(
            process_task_id="task-1",
            data="The report is ready.",
            title="Report ready",
            notice_id="notice:tool-call-1",
            tool_call_id="tool-call-1",
        )
    )

    assert line is not None
    assert _parse_sse(line) == (
        "notice",
        {
            "notice": "The report is ready.",
            "content": "The report is ready.",
            "message_description": "The report is ready.",
            "process_task_id": "task-1",
            "purpose": "progress",
            "severity": "info",
            "title": "Report ready",
            "message_title": "Report ready",
            "notice_id": "notice:tool-call-1",
            "tool_call_id": "tool-call-1",
        },
    )


@pytest.mark.asyncio
async def test_project_metadata_precedes_single_agent_end():
    from app.model.chat import Chat
    from app.service.single_agent_service import single_agent_solve
    from app.service.task import ActionImproveData, ImprovePayload

    fake_agent = MagicMock()
    fake_agent.astep = AsyncMock(return_value=object())
    fake_agent.agent_id = "fake_single_agent"
    fake_agent._observable_todo_toolkit = None

    queue: asyncio.Queue = asyncio.Queue()
    await queue.put(
        ActionImproveData(
            data=ImprovePayload(
                question="build an interactive ISS model",
                attaches=[],
                project_context=None,
            ),
            new_task_id="run-summary",
        )
    )

    task_lock = MagicMock()
    task_lock.id = "project-summary"
    task_lock.email = "u@example.com"
    task_lock.status = "OPEN"
    task_lock.conversation_history = []
    task_lock.agent_memory_history = []
    task_lock.memory_summary = ""
    task_lock.summary_generated = False
    task_lock.run_context = None
    task_lock.get_queue = queue.get
    task_lock.add_background_task = MagicMock()
    task_lock.add_conversation = MagicMock()

    options = MagicMock(spec=Chat)
    options.project_id = "project-summary"
    options.task_id = "run-summary"
    options.project_context = None
    summarize = AsyncMock(
        return_value="Interactive ISS Model|Build and verify the 3D experience."
    )

    with (
        patch(
            "app.service.single_agent_service.single_agent",
            new=AsyncMock(return_value=fake_agent),
        ),
        patch("app.service.single_agent_service.set_current_task_id"),
        patch("app.service.single_agent_service.record_agent_memory_snapshot"),
        patch("app.service.single_agent_service._finalize_memory_for_turn"),
        patch(
            "app.service.single_agent_service._build_single_agent_prompt",
            return_value="prompt",
        ),
        patch(
            "app.service.single_agent_service._response_content",
            new=AsyncMock(return_value=("finished", 3)),
        ),
    ):
        stream = single_agent_solve(
            options,
            MagicMock(),
            task_lock,
            summarize_task=summarize,
        )
        assert _parse_sse(await stream.__anext__())[0] == "confirmed"

        metadata_event, metadata = _parse_sse(await stream.__anext__())
        assert metadata_event == "project_metadata"
        assert metadata == {
            "project_id": "project-summary",
            "task_id": "run-summary",
            "summary_task": (
                "Interactive ISS Model|Build and verify the 3D experience."
            ),
            "project_name": "Interactive ISS Model",
            "project_summary": "Build and verify the 3D experience.",
        }

        end_event, end_payload = _parse_sse(await stream.__anext__())
        assert end_event == "end"
        assert end_payload == {"message": "finished", "tokens": 3}
        await stream.aclose()

    summarize.assert_awaited_once_with(
        "build an interactive ISS model",
        "run-summary",
    )
    assert task_lock.summary_generated is True
    assert task_lock.summary_task_content == (
        "Interactive ISS Model|Build and verify the 3D experience."
    )


@pytest.mark.asyncio
async def test_retryable_model_error_emits_resume_metadata_and_interrupts():
    from app.model.chat import Chat
    from app.run_runtime import RunInterruptedError
    from app.service.single_agent_service import single_agent_solve
    from app.service.task import ActionImproveData, ImprovePayload

    class ClientClosedRequest(RuntimeError):
        status_code = 499

    fake_agent = MagicMock()
    fake_agent.astep = AsyncMock(
        side_effect=ClientClosedRequest("Client Closed Request")
    )
    fake_agent.agent_id = "fake_single_agent"
    fake_agent._observable_todo_toolkit = None

    queue: asyncio.Queue = asyncio.Queue()
    await queue.put(
        ActionImproveData(
            data=ImprovePayload(
                question="finish the response",
                attaches=[],
                project_context=None,
            ),
            new_task_id="run_retryable",
        )
    )

    task_lock = MagicMock()
    task_lock.id = "project_retryable"
    task_lock.email = "u@example.com"
    task_lock.status = "OPEN"
    task_lock.conversation_history = []
    task_lock.agent_memory_history = []
    task_lock.memory_summary = ""
    task_lock.summary_generated = False
    task_lock.run_context = None

    async def get_queue():
        return await queue.get()

    task_lock.get_queue = get_queue
    task_lock.add_background_task = MagicMock()

    options = MagicMock(spec=Chat)
    options.project_id = "project_retryable"
    options.task_id = "run_retryable"
    options.project_context = None

    with (
        patch(
            "app.service.single_agent_service.single_agent",
            new=AsyncMock(return_value=fake_agent),
        ),
        patch("app.service.single_agent_service.set_current_task_id"),
        patch("app.service.single_agent_service.record_agent_memory_snapshot"),
        patch("app.service.single_agent_service._finalize_memory_for_turn"),
        patch(
            "app.service.single_agent_service._build_single_agent_context",
            return_value="",
        ),
        patch(
            "app.service.single_agent_service.delete_task_lock",
            new=AsyncMock(),
        ) as delete_task_lock,
    ):
        agen = single_agent_solve(options, MagicMock(), task_lock)
        confirmed = await agen.__anext__()
        assert _parse_sse(confirmed)[0] == "confirmed"

        error_frame = await agen.__anext__()
        event, payload = _parse_sse(error_frame)
        assert event == "error"
        assert payload == {
            "message": "Client Closed Request",
            "retryable": True,
            "reason": "model_transport_error",
        }

        with pytest.raises(RunInterruptedError) as error:
            await agen.__anext__()
        assert error.value.reason == "model_transport_error"
        delete_task_lock.assert_awaited_once_with("project_retryable")


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


@pytest.mark.asyncio
async def test_follow_up_rebuilds_agent_when_environment_spec_changes():
    from app.model.chat import Chat
    from app.service.single_agent_service import single_agent_solve
    from app.service.task import ActionImproveData, ImprovePayload

    def fake_agent(name: str, cleanup_toolkit=None):
        value = MagicMock()
        value.agent_id = name
        value._observable_todo_toolkit = None
        value._cdp_release_callback = None
        value._runtime_cleanup_toolkits = (
            (cleanup_toolkit,) if cleanup_toolkit is not None else ()
        )
        value.astep = AsyncMock(return_value=object())
        return value

    stale_toolkit = MagicMock()
    stale_toolkit.disconnect = AsyncMock()
    agent_a = fake_agent("agent-a", stale_toolkit)
    release_stale_browser = MagicMock()
    agent_a._cdp_release_callback = release_stale_browser
    agent_b = fake_agent("agent-b")
    runtime_a = object()
    runtime_b = object()
    queue: asyncio.Queue = asyncio.Queue()
    await queue.put(
        ActionImproveData(
            data=ImprovePayload(question="first", attaches=[]),
            new_task_id="run-a",
        )
    )

    task_lock = MagicMock()
    task_lock.id = "project-runtime-switch"
    task_lock.email = "u@example.com"
    task_lock.status = "OPEN"
    task_lock.environment_spec_id = "env-a"
    task_lock.resolved_runtime_environment = runtime_a
    task_lock.registered_toolkits = [stale_toolkit]
    task_lock.conversation_history = []
    task_lock.agent_memory_history = []
    task_lock.memory_summary = ""
    task_lock.summary_generated = False
    task_lock.run_context = None
    task_lock.processed_improve_request_ids = set()
    task_lock.get_queue = queue.get
    task_lock.add_background_task = MagicMock()
    task_lock.add_conversation = MagicMock()

    options = MagicMock(spec=Chat)
    options.project_id = "project-runtime-switch"
    options.task_id = "run-a"
    options.project_context = None

    create_agent = AsyncMock(side_effect=[agent_a, agent_b])
    with (
        patch(
            "app.service.single_agent_service.single_agent",
            new=create_agent,
        ),
        patch("app.service.single_agent_service.set_current_task_id"),
        patch("app.service.single_agent_service.record_agent_memory_snapshot"),
        patch("app.service.single_agent_service._finalize_memory_for_turn"),
        patch(
            "app.service.single_agent_service._build_single_agent_prompt",
            return_value="prompt",
        ),
        patch(
            "app.service.single_agent_service._response_content",
            new=AsyncMock(
                side_effect=[("first result", 1), ("second result", 1)]
            ),
        ),
    ):
        stream = single_agent_solve(options, MagicMock(), task_lock)
        assert _parse_sse(await stream.__anext__())[0] == "confirmed"
        assert _parse_sse(await stream.__anext__())[0] == "end"

        task_lock.environment_spec_id = "env-b"
        task_lock.resolved_runtime_environment = runtime_b
        await queue.put(
            ActionImproveData(
                data=ImprovePayload(question="second", attaches=[]),
                new_task_id="run-b",
            )
        )
        assert _parse_sse(await stream.__anext__())[0] == "confirmed"
        assert _parse_sse(await stream.__anext__())[0] == "end"
        await stream.aclose()

    assert create_agent.await_count == 2
    assert (
        create_agent.await_args_list[0].kwargs["runtime_environment"]
        is runtime_a
    )
    assert (
        create_agent.await_args_list[1].kwargs["runtime_environment"]
        is runtime_b
    )
    stale_toolkit.disconnect.assert_awaited_once()
    release_stale_browser.assert_called_once_with(agent_a)
    assert agent_a._cdp_release_callback is None
    assert stale_toolkit not in task_lock.registered_toolkits


@pytest.mark.asyncio
async def test_follow_up_reuses_runtime_but_resets_camel_conversation():
    from app.model.chat import Chat
    from app.service.single_agent_service import single_agent_solve
    from app.service.task import ActionImproveData, ImprovePayload

    lifecycle: list[str] = []
    agent = MagicMock()
    agent.agent_id = "warm-agent"
    agent._observable_todo_toolkit = None
    agent._cdp_release_callback = None
    agent._runtime_cleanup_toolkits = ()
    agent.reset = MagicMock(side_effect=lambda: lifecycle.append("reset"))

    async def astep(_prompt):
        lifecycle.append("astep")
        return object()

    agent.astep = AsyncMock(side_effect=astep)
    queue: asyncio.Queue = asyncio.Queue()
    await queue.put(
        ActionImproveData(
            data=ImprovePayload(question="first question", attaches=[]),
            new_task_id="run-a",
        )
    )

    task_lock = MagicMock()
    task_lock.id = "project-warm-agent"
    task_lock.email = "u@example.com"
    task_lock.status = "OPEN"
    task_lock.environment_spec_id = "env-stable"
    task_lock.permission_profile_revision = "profile-1"
    task_lock.resolved_runtime_environment = object()
    task_lock.registered_toolkits = []
    task_lock.conversation_history = []
    task_lock.agent_memory_history = []
    task_lock.memory_summary = ""
    task_lock.summary_generated = False
    task_lock.run_context = None
    task_lock.processed_improve_request_ids = set()
    task_lock.get_queue = queue.get
    task_lock.add_background_task = MagicMock()
    task_lock.add_conversation = MagicMock()

    options = MagicMock(spec=Chat)
    options.project_id = "project-warm-agent"
    options.task_id = "run-a"
    options.project_context = None

    create_agent = AsyncMock(return_value=agent)
    with (
        patch(
            "app.service.single_agent_service.single_agent",
            new=create_agent,
        ),
        patch(
            "app.service.single_agent_service.get_working_directory",
            return_value="/workspace",
        ),
        patch("app.service.single_agent_service.set_current_task_id"),
        patch("app.service.single_agent_service.record_agent_memory_snapshot"),
        patch("app.service.single_agent_service._finalize_memory_for_turn"),
        patch(
            "app.service.single_agent_service._build_single_agent_prompt",
            side_effect=lambda _lock, question, *_args: question,
        ),
        patch(
            "app.service.single_agent_service._response_content",
            new=AsyncMock(side_effect=[("answer-a", 1), ("answer-b", 1)]),
        ),
    ):
        stream = single_agent_solve(options, MagicMock(), task_lock)
        assert _parse_sse(await stream.__anext__())[0] == "confirmed"
        assert _parse_sse(await stream.__anext__())[1]["message"] == "answer-a"

        await queue.put(
            ActionImproveData(
                data=ImprovePayload(question="second question", attaches=[]),
                new_task_id="run-b",
            )
        )
        assert _parse_sse(await stream.__anext__())[0] == "confirmed"
        assert _parse_sse(await stream.__anext__())[1]["message"] == "answer-b"
        await stream.aclose()

    assert create_agent.await_count == 1
    assert lifecycle == ["astep", "reset", "astep"]
    assert agent.process_task_id == "run-b"


def test_current_user_question_is_appended_exactly_once():
    from app.service.single_agent_service import _build_single_agent_prompt

    with patch(
        "app.service.single_agent_service._build_single_agent_context",
        return_value="Previous answer: A\n\n",
    ):
        prompt = _build_single_agent_prompt(
            MagicMock(),
            "check unread email",
            [],
        )

    assert prompt.count("check unread email") == 1
    assert prompt.endswith("User task:\ncheck unread email")


@pytest.mark.asyncio
async def test_stale_runtime_cleanup_failure_blocks_replacement():
    from app.service.single_agent_service import _dispose_stale_agent_runtime

    stale_toolkit = MagicMock()
    stale_toolkit.disconnect = AsyncMock(
        side_effect=RuntimeError("adapter shutdown failed")
    )
    agent = MagicMock()
    agent._cdp_release_callback = None
    agent._runtime_cleanup_toolkits = (stale_toolkit,)
    task_lock = MagicMock()
    task_lock.registered_toolkits = [stale_toolkit]

    with pytest.raises(RuntimeError, match="replacement blocked"):
        await _dispose_stale_agent_runtime(
            agent,
            task_lock,
            task_id="run-runtime-switch",
        )

    assert stale_toolkit in task_lock.registered_toolkits
    assert agent._runtime_cleanup_toolkits == (stale_toolkit,)
