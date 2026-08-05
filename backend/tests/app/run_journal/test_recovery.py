from __future__ import annotations

import pytest

from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    RunEventDraft,
    SQLiteRunJournal,
    UnsafeResumeError,
)
from app.run_policy import TimeoutOutcome, TimeoutScope, ToolSafetyClass


def test_attempt_admission_is_idempotent_and_startup_interrupts_it(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        first = journal.create_run_attempt(
            "run-1",
            request_id="initial:run-1",
            reason="initial_execution",
            activate=True,
            now=10,
        )
        duplicate = journal.create_run_attempt(
            "run-1",
            request_id="initial:run-1",
            reason="initial_execution",
            activate=True,
            now=11,
        )
        assert duplicate == first

    with SQLiteRunJournal(path) as reopened:
        result = reopened.reconcile_startup(now=20)
        assert result.interrupted_run_ids == ("run-1",)
        assert result.detached_attempt_ids == (first.attempt_id,)
        assert reopened.get_run("run-1").status == "interrupted"
        assert (
            reopened.get_run_attempt(first.attempt_id).status == "interrupted"
        )


def test_pending_approval_survives_restart_but_old_attempt_detaches(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Allow write?"},
            now=2,
        )

    with SQLiteRunJournal(path) as reopened:
        result = reopened.reconcile_startup(now=3)
        assert result.pending_approval_ids == ("approval-1",)
        assert reopened.get_run("run-1").status == "waiting_for_user"
        assert (
            reopened.get_run_attempt(attempt.attempt_id).status
            == "interrupted"
        )
        assert reopened.list_approvals("run-1", pending_only=True)[
            0
        ].prompt == {"question": "Allow write?"}
        with pytest.raises(
            InvalidRunTransitionError, match="pending approvals"
        ):
            reopened.create_run_attempt(
                "run-1",
                request_id="resume-before-decision",
                reason="explicit_resume",
                now=4,
            )


def test_dispatched_unsafe_tool_is_fail_closed_after_restart(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        values = dict(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="send_email",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"to": "user@example.com"},
        )
        journal.checkpoint_tool_call(status="prepared", now=2, **values)
        journal.checkpoint_tool_call(status="dispatched", now=3, **values)

        result = journal.reconcile_startup(now=4)
        assert result.outcome_unknown_tool_call_ids == ("tool-1",)
        assert journal.list_tool_calls("run-1")[0].status == "outcome_unknown"
        with pytest.raises(UnsafeResumeError) as error:
            journal.create_run_attempt(
                "run-1",
                request_id="resume-1",
                reason="explicit_resume",
                now=5,
            )
        assert error.value.tool_call_ids == ("tool-1",)


def test_safe_read_timeout_can_create_a_new_attempt(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        values = dict(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="read_page",
            safety_class=ToolSafetyClass.SAFE_READ,
            request={"url": "https://example.com"},
        )
        journal.checkpoint_tool_call(status="prepared", now=2, **values)
        journal.checkpoint_tool_call(status="dispatched", now=3, **values)
        journal.reconcile_startup(now=4)

        resumed = journal.create_run_attempt(
            "run-1",
            request_id="resume-1",
            reason="explicit_resume",
            now=5,
        )
        assert resumed.status == "pending"
        activated = journal.activate_run_attempt(resumed.attempt_id, now=6)
        assert activated.status == "running"


def test_dispatched_unsafe_tool_blocks_resume_before_restart_reconciliation(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        values = dict(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="publish_message",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"channel": "public"},
        )
        journal.checkpoint_tool_call(status="prepared", now=2, **values)
        journal.checkpoint_tool_call(status="dispatched", now=3, **values)
        journal.record_timeout_outcome(
            TimeoutOutcome(
                scope=TimeoutScope.RUNTIME_LIVENESS,
                policy_version="v1",
                reason="consumer_lost",
                started_at=1,
                ended_at=4,
                run_id="run-1",
                attempt_id=attempt.attempt_id,
            )
        )
        with pytest.raises(UnsafeResumeError):
            journal.create_run_attempt(
                "run-1",
                request_id="resume",
                reason="explicit_resume",
                now=5,
            )


def test_cancel_intent_is_completed_by_startup_reconciliation(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.request_cancel(
            "run-1", request_id="cancel-1", reason="user_request", now=2
        )

        result = journal.reconcile_startup(now=3)
        assert result.completed_cancel_run_ids == ("run-1",)
        assert journal.get_run("run-1").status == "cancelled"
        assert journal.list_events("run-1")[-1].event_type == "run.cancelled"


def test_persisted_deadline_is_the_only_timeout_that_terminates_run(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", deadline_at=10
        )
        result = journal.reconcile_startup(now=11)
        assert result.deadline_run_ids == ("run-1",)
        assert journal.get_run("run-1").status == "failed"
        assert (
            journal.list_events("run-1")[-1].event_type
            == "run.deadline_reached"
        )


def test_approval_decision_is_versioned_and_requires_new_attempt(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Continue?"},
            now=2,
        )
        decided = journal.decide_approval(
            "approval-1",
            decision="approved",
            details={"source": "desktop"},
            expected_version=0,
            now=3,
        )
        assert decided.version == 1
        assert journal.get_run("run-1").status == "interrupted"
        resumed = journal.create_run_attempt(
            "run-1",
            request_id="after-approval",
            reason="approval_decided",
            now=4,
        )
        assert resumed.attempt_number == 2


def test_live_approval_decision_continues_the_same_active_attempt(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Continue?", "agent": "assistant"},
            now=2,
        )
        journal.decide_approval(
            "approval-1",
            decision="approved",
            details={"reply": "yes"},
            expected_version=0,
            expected_run_id="run-1",
            continue_active_attempt=True,
            now=3,
        )
        assert journal.get_run("run-1").status == "running"
        assert journal.get_run("run-1").active_attempt_id == attempt.attempt_id
        assert journal.get_run_attempt(attempt.attempt_id).status == "running"


def test_timeout_outcome_is_typed_and_activity_timeout_is_non_terminal(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        event = journal.record_timeout_outcome(
            TimeoutOutcome(
                scope=TimeoutScope.ACTIVITY,
                policy_version="timeouts-v2",
                reason="model_provider_timeout",
                started_at=1,
                ended_at=5,
                run_id="run-1",
                attempt_id="attempt-1",
                activity_id="activity-1",
            )
        )
        assert event.event_type == "activity.timed_out"
        assert event.payload["scope"] == "activity_timeout"
        assert journal.get_run("run-1").status == "running"
        second = journal.record_timeout_outcome(
            TimeoutOutcome(
                scope=TimeoutScope.ACTIVITY,
                policy_version="timeouts-v2",
                reason="workforce_wait_timeout",
                started_at=6,
                ended_at=7,
                run_id="run-1",
                attempt_id="attempt-1",
                activity_id="activity-2",
            )
        )
        assert second.event_id != event.event_id


def test_fork_preserves_lineage_and_creates_explicit_checkpoint_attempt(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="source", project_id="project-1", deadline_at=5
        )
        forked, checkpoint = journal.fork_run(
            "source",
            new_run_id="forked",
            request_id="fork-request",
            now=2,
        )
        assert forked.parent_run_id == "source"
        assert forked.status == "interrupted"
        assert checkpoint.status == "interrupted"
        assert checkpoint.outcome == "fork_checkpoint"
        assert forked.deadline_at is None


def test_tool_result_is_part_of_canonical_event_idempotency(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        values = dict(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=None,
            tool_name="read_page",
            safety_class=ToolSafetyClass.SAFE_READ,
            request={"url": "https://example.com"},
        )
        journal.checkpoint_tool_call(status="prepared", now=1, **values)
        journal.checkpoint_tool_call(status="dispatched", now=2, **values)
        journal.checkpoint_tool_call(
            status="completed", result={"status": 200}, now=3, **values
        )
        with pytest.raises(IdempotencyConflictError):
            journal.checkpoint_tool_call(
                status="completed", result={"status": 500}, now=4, **values
            )


def test_startup_applies_explicit_approval_reject_expiry_policy(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Continue?"},
            expires_at=5,
            expiry_action="reject",
            now=2,
        )
        result = journal.reconcile_startup(now=6)
        assert result.pending_approval_ids == ()
        approval = journal.list_approvals("run-1")[0]
        assert approval.status == "rejected"
        assert approval.decision == {
            "decision": "rejected",
            "reason": "approval_expired",
        }


def test_terminal_event_closes_run_and_active_attempt_atomically(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_type="legacy.end",
                legacy_step="end",
                payload={"result": "done"},
                created_at=2,
            ),
        )
        assert journal.get_run("run-1").status == "completed"
        assert journal.get_run("run-1").active_attempt_id is None
        assert (
            journal.get_run_attempt(attempt.attempt_id).status == "completed"
        )
