from __future__ import annotations

import pytest

from app.run_journal import EventRecorder, SQLiteRunJournal
from app.run_journal.models import RunEventDraft
from app.run_journal.context_projection import build_project_execution_context
from app.run_policy import ToolSafetyClass

pytestmark = pytest.mark.unit


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
    await recorder.record_assistant_final(
        project_id="project-1",
        run_id="run-1",
        data="Calendar checked; Gmail needs reconnection.",
        created_at=8,
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
    assert "Assistant: Calendar checked; Gmail needs reconnection." in projected
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
    final = await recorder.record_assistant_final(
        project_id="project-1",
        run_id="run-1",
        data={"message": "Done"},
    )

    assert replay == first
    assert journal.get_run_final_result_event("run-1") == final
    assert [event.event_type for event in journal.list_events("run-1")] == [
        "user.message",
        "assistant.final",
    ]
