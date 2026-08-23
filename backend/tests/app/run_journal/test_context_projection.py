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

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.run_journal import EventRecorder, SQLiteRunJournal
from app.run_journal.context_projection import build_project_execution_context
from app.run_journal.models import RunEventDraft
from app.run_policy import ToolSafetyClass
from app.service.single_agent_service import _build_single_agent_context

pytestmark = pytest.mark.unit


def _complete_run(journal, run_id: str, project_id: str, data):
    manifest = journal.append_artifact_manifest_events(
        run_id,
        [
            RunEventDraft(
                event_id=f"artifact-manifest:{run_id}:test",
                event_type="artifact.manifest.finalized",
                payload={
                    "artifacts": [],
                    "artifact_count": 0,
                    "scan_status": "complete",
                },
                created_at=8.0,
            )
        ],
        expected_project_id=project_id,
    )
    payload = dict(data) if isinstance(data, dict) else {"message": str(data)}
    return journal.complete_successful_run(
        run_id,
        assistant_final=RunEventDraft(
            event_id=f"assistant-final:{run_id}",
            event_type="assistant.final",
            payload=payload,
            legacy_step="end",
            created_at=8.0,
        ),
        terminal=RunEventDraft(
            event_id=f"run-completed:{run_id}",
            event_type="run.completed",
            payload={"reason": "test"},
            created_at=8.0,
        ),
        artifact_manifest=manifest,
        expected_project_id=project_id,
    )


@pytest.fixture
def journal(tmp_path):
    value = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    try:
        yield value
    finally:
        value.close()


@pytest.mark.asyncio
async def test_projection_keeps_user_assistant_and_success_and_error_tools(
    journal,
):
    recorder = EventRecorder(journal)
    journal.ensure_run(run_id="run-1", project_id="project-1", now=1)
    await recorder.record_user_message(
        project_id="project-1",
        run_id="run-1",
        request_id="request-1",
        content="Check my calendar",
        source="chat",
    )

    common = {
        "run_id": "run-1",
        "attempt_id": None,
        "safety_class": ToolSafetyClass.SAFE_READ,
    }
    journal.checkpoint_tool_call(
        tool_call_id="run-1:calendar",
        tool_name="calendar_list",
        status="prepared",
        request={"date": "today"},
        now=2,
        **common,
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:calendar",
        tool_name="calendar_list",
        status="dispatched",
        request={"date": "today"},
        now=3,
        **common,
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:calendar",
        tool_name="calendar_list",
        status="completed",
        request={"date": "today"},
        result={"events": ["Design review"]},
        outcome="completed",
        now=4,
        **common,
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:gmail",
        tool_name="gmail_unread",
        status="prepared",
        request={"folder": "inbox"},
        now=5,
        **common,
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:gmail",
        tool_name="gmail_unread",
        status="dispatched",
        request={"folder": "inbox"},
        now=6,
        **common,
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:gmail",
        tool_name="gmail_unread",
        status="failed",
        request={"folder": "inbox"},
        result={"error": "connector token expired"},
        outcome="failed",
        now=7,
        **common,
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:search",
        tool_name="search_web",
        status="prepared",
        request={"query": "current pricing"},
        now=7.1,
        **common,
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:search",
        tool_name="search_web",
        status="dispatched",
        request={"query": "current pricing"},
        now=7.2,
        **common,
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:search",
        tool_name="search_web",
        status="timed_out",
        request={"query": "current pricing"},
        outcome="timed_out",
        timeout_reason="provider deadline exceeded",
        now=7.3,
        **common,
    )
    unsafe = {
        "run_id": "run-1",
        "attempt_id": None,
        "safety_class": ToolSafetyClass.UNSAFE_WRITE,
    }
    journal.checkpoint_tool_call(
        tool_call_id="run-1:send",
        tool_name="send_email",
        status="prepared",
        request={"to": "team@example.com"},
        now=7.4,
        **unsafe,
    )
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="approval:send-email:decision:1",
            event_type="approval.decided",
            payload={
                "approval_id": "approval:send-email",
                "decision": "rejected",
                "reason": "use a draft instead",
            },
            created_at=7.7,
        ),
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:send",
        tool_name="send_email",
        status="dispatched",
        request={"to": "team@example.com"},
        now=7.5,
        **unsafe,
    )
    journal.checkpoint_tool_call(
        tool_call_id="run-1:send",
        tool_name="send_email",
        status="outcome_unknown",
        request={"to": "team@example.com"},
        result={"error": "connection dropped after dispatch"},
        outcome="outcome_unknown",
        now=7.6,
        **unsafe,
    )
    journal.ensure_run(run_id="run-assistant", project_id="project-1", now=7.8)
    _complete_run(
        journal,
        "run-assistant",
        "project-1",
        "Calendar checked; Gmail needs reconnection.",
    )
    journal.ensure_run(run_id="run-2", project_id="project-1", now=9)

    projected = build_project_execution_context(
        journal,
        project_id="project-1",
        current_run_id="run-2",
    )

    assert "User: Check my calendar" in projected
    assert "calendar_list" in projected
    assert "Design review" in projected
    assert "gmail_unread" in projected
    assert "connector token expired" in projected
    assert "Tool result [failed]" in projected
    assert "provider deadline exceeded" in projected
    assert "Tool result [timed_out]" in projected
    assert "connection dropped after dispatch" in projected
    assert "external_effect_may_have_occurred" in projected
    assert "User approval decision" in projected
    assert "use a draft instead" in projected
    assert (
        "Assistant: Calendar checked; Gmail needs reconnection." in projected
    )
    # Only the latest state of each tool is projected, not prepared/dispatched
    # duplicates from the execution ledger.
    assert projected.count("Assistant tool call:") == 4


@pytest.mark.asyncio
async def test_typed_events_are_idempotent_and_final_result_is_discoverable(
    journal,
):
    recorder = EventRecorder(journal)
    journal.ensure_run(run_id="run-1", project_id="project-1")

    first = await recorder.record_user_message(
        project_id="project-1",
        run_id="run-1",
        request_id="request-1",
        content="Do the next thing",
        source="improve",
    )
    replay = await recorder.record_user_message(
        project_id="project-1",
        run_id="run-1",
        request_id="request-1",
        content="Do the next thing",
        source="improve",
    )
    final, _ = _complete_run(
        journal, "run-1", "project-1", {"message": "Done"}
    )

    assert replay == first
    assert journal.get_run_final_result_event("run-1") == final
    assert [event.event_type for event in journal.list_events("run-1")] == [
        "user.message",
        "artifact.manifest.finalized",
        "assistant.final",
        "run.completed",
    ]


@pytest.mark.asyncio
async def test_model_context_persists_secret_free_projection_diagnostics(
    journal,
):
    recorder = EventRecorder(journal)
    journal.ensure_run(
        run_id="run-previous", project_id="project-1", status="pending"
    )
    user_event = await recorder.record_user_message(
        project_id="project-1",
        run_id="run-previous",
        request_id="request-previous",
        content="Prior durable instruction",
        source="chat",
        review_handoff_ids=["review-handoff-1"],
    )
    assert user_event.payload["review_handoff_ids"] == ["review-handoff-1"]
    _complete_run(
        journal,
        "run-previous",
        "project-1",
        "Prior durable answer",
    )
    journal.ensure_run(
        run_id="run-current", project_id="project-1", status="pending"
    )
    task_lock = SimpleNamespace(
        run_context=SimpleNamespace(
            project_id="project-1",
            run_id="run-current",
        ),
        memory_service=None,
    )

    with patch(
        "app.service.single_agent_service.get_default_run_journal",
        return_value=journal,
    ):
        projected = _build_single_agent_context(task_lock)

    assert "Prior durable answer" in projected
    diagnostics = journal.list_context_projection_diagnostics(
        run_id="run-current"
    )
    assert len(diagnostics) == 1
    assert user_event.event_id in diagnostics[0].source_event_ids
    assert diagnostics[0].project_state_version == 1
    assert not hasattr(diagnostics[0], "prompt")
