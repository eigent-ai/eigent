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

import re
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.run_journal import EventRecorder, SQLiteRunJournal
from app.run_journal.context_projection import build_project_execution_context
from app.run_journal.models import RunEventDraft
from app.run_policy import ToolSafetyClass
from app.service.single_agent_service import _build_single_agent_context

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["single_agent", "workforce"])
@pytest.mark.parametrize("hot", [False, True])
@pytest.mark.parametrize(
    "prior,memory",
    [(True, False), (False, True), (True, True), (False, False)],
)
async def test_resume_initial_context_keeps_current_run(
    journal, mode, hot, prior, memory
):
    from app.service import chat_service, single_agent_service

    recorder = EventRecorder(journal)
    if prior:
        journal.ensure_run(run_id="prior", project_id="project-1", now=1)
        await recorder.record_user_message(
            project_id="project-1",
            run_id="prior",
            request_id="prior",
            content="Prior instruction",
            source="chat",
        )
    journal.ensure_run(run_id="current", project_id="project-1", now=2)
    await recorder.record_user_message(
        project_id="project-1",
        run_id="current",
        request_id="current",
        content="Finish the quarterly report",
        source="chat",
    )
    for status in ("prepared", "dispatched", "completed"):
        journal.checkpoint_tool_call(
            run_id="current",
            attempt_id=None,
            tool_call_id="report-read",
            tool_name="read_report",
            safety_class=ToolSafetyClass.SAFE_READ,
            status=status,
            request={"path": "report.csv"},
            result={"rows": "current-ledger-evidence"}
            if status == "completed"
            else None,
            outcome="completed" if status == "completed" else None,
            now=3,
        )
    journal.reconcile_startup(now=4)
    attempt = journal.create_run_attempt(
        "current",
        request_id="resume-1",
        reason="explicit_resume",
        now=4,
    )
    lock = SimpleNamespace(
        run_context=SimpleNamespace(
            project_id="project-1",
            run_id="current",
            attempt_id=attempt.attempt_id,
        ),
        conversation_history=(
            [{"role": "user", "content": "HOT DUPLICATE"}] if hot else []
        ),
        agent_memory_history=[],
        memory_summary="",
        memory_service=None,
    )
    service = single_agent_service if mode == "single_agent" else chat_service
    with (
        patch.object(service, "get_default_run_journal", return_value=journal),
        patch.object(
            service,
            "build_durable_context_projection_for_task_lock",
            return_value=(
                SimpleNamespace(
                    text="Memory reference", source_memory_ids=("memory-1",)
                )
                if memory
                else None
            ),
        ),
    ):
        if mode == "single_agent":
            projected = service._build_single_agent_prompt(
                lock, "Resume unfinished work", [], "STALE BRIDGE"
            )
        else:
            projected = service.build_context_for_workforce(
                lock, SimpleNamespace()
            )
    assert projected.count("Finish the quarterly report") == 1
    assert projected.count("current-ledger-evidence") == 1
    assert "report-read" in projected
    assert "safe_read" in projected
    assert "HOT DUPLICATE" not in projected
    assert "STALE BRIDGE" not in projected
    assert ("Prior instruction" in projected) is prior
    assert ("Memory reference" in projected) is memory


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


def _resume(journal, *, request_id="resume-1", prompt="Keep working"):
    if journal.get_run("current") is None:
        journal.ensure_run(run_id="current", project_id="project-1", now=2)
        journal.append_event(
            "current",
            RunEventDraft(
                event_type="user.message",
                payload={"content": prompt},
            ),
        )
    journal.reconcile_startup()
    return journal.create_run_attempt(
        "current",
        request_id=request_id,
        reason="explicit_resume",
    )


def _recovery_projection(journal, attempt, **kwargs):
    from app.run_journal.context_projection import (
        build_project_execution_context_projection,
    )

    return build_project_execution_context_projection(
        journal,
        project_id="project-1",
        current_run_id="current",
        current_attempt_id=attempt.attempt_id,
        **kwargs,
    )


def _tool(
    journal,
    call_id,
    *,
    status="completed",
    safety=ToolSafetyClass.SAFE_READ,
    result=None,
):
    for state in ("prepared", "dispatched", status):
        journal.checkpoint_tool_call(
            run_id="current",
            attempt_id=None,
            tool_call_id=call_id,
            tool_name="inspect_report",
            safety_class=safety,
            status=state,
            idempotency_key="write-once"
            if safety == ToolSafetyClass.IDEMPOTENT_WRITE
            else None,
            request={
                "path": "report.csv",
                "password": "super-secret-password",
            },
            result=result if state == status else None,
            outcome=status
            if state == status and status not in {"prepared", "dispatched"}
            else None,
        )
        if state == status:
            break


def test_recovery_keeps_unknown_identity_and_order_after_restart(journal):
    attempt = _resume(journal)
    _tool(
        journal,
        "unsafe-old",
        status="dispatched",
        safety=ToolSafetyClass.UNSAFE_WRITE,
    )
    _tool(journal, "safe-next", result={"data": "observed-result"})
    decision = journal.append_event(
        "current",
        RunEventDraft(
            event_type="approval.decided",
            payload={"decision": "Do not send again"},
        ),
    )
    journal.reconcile_startup()
    from app.run_journal.store import UnsafeResumeError

    with pytest.raises(UnsafeResumeError):
        _resume(journal, request_id="resume-2")
    # Inspect the durable checkpoint without bypassing unsafe admission.
    projected = _recovery_projection(journal, attempt)
    assert projected.text.count("Assistant tool call: inspect_report") == 2
    assert '"tool_call_id": "unsafe-old"' in projected.text
    assert '"safety_class": "unsafe_write"' in projected.text
    assert '"external_effect_may_have_occurred": true' in projected.text
    assert "brain_restart_after_dispatch" in projected.text
    assert "Tool result [outcome_unknown]" in projected.text
    assert "super-secret-password" not in projected.text
    assert "[REDACTED]" in projected.text
    assert (
        projected.text.index("observed-result")
        < projected.text.index("Do not send again")
        < projected.text.index('"tool_call_id": "unsafe-old"')
    )
    assert decision.event_id in projected.source_event_ids
    assert len(projected.source_event_ids) == len(
        set(projected.source_event_ids)
    )
    # A real cold SQLite connection produces the identical projection.
    with SQLiteRunJournal(journal.path) as reopened:
        assert _recovery_projection(reopened, attempt) == projected


def test_repeated_resume_does_not_duplicate_intent_or_tool_outcomes(journal):
    attempt = _resume(journal)
    _tool(
        journal,
        "write-once-tool",
        safety=ToolSafetyClass.IDEMPOTENT_WRITE,
        result={"file": "unique-evidence"},
    )
    for index in range(3):
        attempt = _resume(journal, request_id=f"again-{index}")
        projection = _recovery_projection(journal, attempt)
        assert projection.text.count("Keep working") == 1
        assert projection.text.count("unique-evidence") == 1
        assert projection.text.count('"idempotency_key": "write-once"') == 1
        assert len(projection.text) <= 18000
        assert _recovery_projection(journal, attempt) == projection


def test_recovery_budget_reserves_current_before_whole_prior_runs(journal):
    journal.ensure_run(run_id="prior", project_id="project-1", now=1)
    prior = journal.append_event(
        "prior",
        RunEventDraft(
            event_type="user.message",
            payload={"content": "old evidence" * 500},
        ),
    )
    attempt = _resume(journal)
    _tool(journal, "read", result={"data": "X" * 5000})
    projection = _recovery_projection(journal, attempt, char_budget=2500)
    assert len(projection.text) <= 2500
    assert "Keep working" in projection.text
    assert "truncated" in projection.text
    assert "old evidence" not in projection.text
    assert prior.event_id not in projection.source_event_ids
    from app.run_journal.context_projection import ResumeContextError

    with pytest.raises(ResumeContextError) as exhausted:
        _recovery_projection(journal, attempt, char_budget=200)
    assert exhausted.value.reason == "context_budget_exhausted"


def test_recovery_omits_old_safe_reads_but_keeps_unsafe_checkpoint(journal):
    attempt = _resume(journal)
    _tool(journal, "read-0", result={"data": "first-read " + "r" * 1000})
    _tool(
        journal,
        "unsafe-send",
        status="dispatched",
        safety=ToolSafetyClass.UNSAFE_WRITE,
    )
    for index in range(1, 55):
        _tool(journal, f"read-{index}", result={"data": "r" * 1000})
    projection = _recovery_projection(journal, attempt)
    text = projection.text
    assert len(text) <= 18000
    assert "Keep working" in text
    assert '"tool_call_id": "unsafe-send"' in text
    assert '"safety_class": "unsafe_write"' in text
    assert "Tool result [dispatched]: no durable outcome" in text
    assert '"tool_call_id": "read-54"' in text
    assert "first-read" not in text
    marker = re.search(r"\.\.\. \[(\d+) earlier completed tool results", text)
    assert marker is not None
    kept = text.count('"safety_class": "safe_read"')
    assert int(marker.group(1)) + kept == 55
    # Omitted reads precede everything kept, and the marker sits in their place.
    assert text.index(marker.group(0)) < text.index('"tool_call_id": "unsafe')
    assert len(projection.source_event_ids) == 3 + kept


def test_recovery_keeps_completed_write_identity_without_its_evidence(journal):
    attempt = _resume(journal)
    _tool(
        journal,
        "write-report",
        safety=ToolSafetyClass.IDEMPOTENT_WRITE,
        result={"data": "write-evidence " + "w" * 1000},
    )
    for index in range(30):
        _tool(journal, f"read-{index}", result={"data": "r" * 1000})
    text = _recovery_projection(journal, attempt).text
    assert '"tool_call_id": "write-report"' in text
    assert '"idempotency_key": "write-once"' in text
    assert "write-evidence" not in text
    assert "earlier completed tool results or step updates omitted" in text


def test_recovery_collapses_step_progress_to_latest_snapshot(journal):
    attempt = _resume(journal)
    for event in ("created", "started", "progress", "completed"):
        journal.append_event(
            "current",
            RunEventDraft(
                event_type=f"step.{event}",
                payload={
                    "step": {"step_id": "step-1", "status": event},
                    "evidence_refs": ["e" * 5000],
                },
            ),
        )
    text = _recovery_projection(journal, attempt).text
    assert text.count("Checkpoint [step.") == 1
    assert "Checkpoint [step.completed]" in text
    assert "truncated" in text
    tight = _recovery_projection(journal, attempt, char_budget=500).text
    assert "Checkpoint [step." not in tight
    assert "1 earlier completed tool results or step updates omitted" in tight


@pytest.mark.parametrize("mode", ["single_agent", "workforce"])
def test_recovery_failure_does_not_fall_back_to_memory_or_hot_cache(
    journal, mode
):
    from app.run_journal.context_projection import ResumeContextError
    from app.service import chat_service, single_agent_service

    attempt = _resume(journal, prompt="critical constraint " * 2000)
    lock = SimpleNamespace(
        run_context=SimpleNamespace(
            project_id="project-1",
            run_id="current",
            attempt_id=attempt.attempt_id,
        ),
        conversation_history=[{"role": "user", "content": "unsafe fallback"}],
    )
    service = single_agent_service if mode == "single_agent" else chat_service
    with (
        patch.object(service, "get_default_run_journal", return_value=journal),
        patch.object(
            service, "build_durable_context_projection_for_task_lock"
        ) as memory,
    ):
        with pytest.raises(ResumeContextError) as exhausted:
            if mode == "single_agent":
                service._build_single_agent_prompt(
                    lock, "Resume", [], "fallback"
                )
            else:
                service.build_context_for_workforce(lock, SimpleNamespace())
        memory.assert_not_called()
    assert exhausted.value.reason == "context_budget_exhausted"


def test_ordinary_initial_attempt_still_excludes_current_run(journal):
    from app.run_journal.context_projection import (
        build_project_execution_context_projection,
    )

    journal.ensure_run(
        run_id="current", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "current", request_id="initial", reason="initial_execution"
    )
    journal.append_event(
        "current",
        RunEventDraft(
            event_type="user.message", payload={"content": "new instruction"}
        ),
    )
    projection = build_project_execution_context_projection(
        journal,
        project_id="project-1",
        current_run_id="current",
        current_attempt_id=attempt.attempt_id,
    )
    assert not projection.text


@pytest.mark.parametrize(
    "status,safety",
    [
        ("completed", ToolSafetyClass.SAFE_READ),
        ("failed", ToolSafetyClass.SAFE_READ),
        ("timed_out", ToolSafetyClass.SAFE_READ),
        ("outcome_unknown", ToolSafetyClass.UNSAFE_WRITE),
    ],
)
def test_recovery_preserves_outcome_with_oversized_result(
    journal, status, safety
):
    attempt = _resume(journal)
    _tool(
        journal,
        "result-call",
        status=status,
        safety=safety,
        result={"data": "x" * 5000},
    )
    projection = _recovery_projection(journal, attempt)
    assert f"Tool result [{status}]" in projection.text
    assert f'"outcome": "{status}"' in projection.text
    assert "truncated" in projection.text
    if status == "outcome_unknown":
        assert '"external_effect_may_have_occurred": true' in projection.text


@pytest.mark.parametrize("failure", ["intent", "events", "ledger", "identity"])
def test_recovery_missing_facts_never_returns_partial_context(
    journal, failure
):
    from app.run_journal.context_projection import ResumeContextError

    attempt = _resume(journal)
    target = {
        "intent": "list_events",
        "events": "list_events",
        "ledger": "list_tool_calls",
        "identity": "get_run_attempt",
    }[failure]
    if failure == "intent":
        mocked = patch.object(journal, target, return_value=[])
    elif failure == "identity":
        from dataclasses import replace

        mocked = patch.object(
            journal, target, return_value=replace(attempt, run_id="other-run")
        )
    else:
        mocked = patch.object(
            journal, target, side_effect=RuntimeError("unavailable")
        )
    with mocked, pytest.raises(ResumeContextError) as unavailable:
        _recovery_projection(journal, attempt)
    assert unavailable.value.reason == "resume_context_unavailable"


def test_unreadable_attempt_keeps_ordinary_projection(journal):
    attempt = _resume(journal)
    with patch.object(
        journal, "get_run_attempt", side_effect=RuntimeError("unavailable")
    ):
        projection = _recovery_projection(journal, attempt)
    assert "Keep working" not in projection.text
