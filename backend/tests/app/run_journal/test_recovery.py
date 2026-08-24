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

import sqlite3

import pytest

from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    RunEventDraft,
    SQLiteRunJournal,
    UnsafeResumeError,
)
from app.run_policy import TimeoutOutcome, TimeoutScope, ToolSafetyClass
from app.run_runtime.step_coordinator import (
    PlanStepInput,
    RunStepCoordinator,
)


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


def test_startup_interruption_ends_attempt_at_last_consumer_heartbeat(
    tmp_path,
):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial:run-1",
            reason="initial_execution",
            activate=True,
            now=10,
        )
        journal.heartbeat_attempt(attempt.attempt_id, now=12)

    with SQLiteRunJournal(path) as reopened:
        reopened.reconcile_startup(now=20 * 60 * 60)
        recovered = reopened.get_run_attempt(attempt.attempt_id)

    assert recovered is not None
    assert recovered.status == "interrupted"
    assert recovered.ended_at == 12
    assert recovered.elapsed_active_ms == 2000


def test_attempt_replay_precedes_terminal_and_cancel_guards(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.request_cancel(
            "run-1", request_id="cancel-1", reason="user_cancel", now=2
        )

        assert (
            journal.create_run_attempt(
                "run-1",
                request_id="initial",
                reason="initial_execution",
                now=3,
            )
            == attempt
        )
        with pytest.raises(InvalidRunTransitionError, match="cancel intent"):
            journal.create_run_attempt(
                "run-1",
                request_id="new-attempt",
                reason="explicit_resume",
                now=3,
            )


def test_terminal_run_rejects_late_assistant_final_without_poisoning_index(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-failed", project_id="project-1")
        journal.append_event(
            "run-failed",
            RunEventDraft(
                event_id="failed:run-failed",
                event_type="run.failed",
                payload={"reason": "test"},
            ),
        )

        with pytest.raises(InvalidRunTransitionError, match="assistant.final"):
            journal.append_event(
                "run-failed",
                RunEventDraft(
                    event_id="assistant-final:run-failed",
                    event_type="assistant.final",
                    payload={"message": "not a successful result"},
                    legacy_step="end",
                ),
            )

        assert journal.get_run_final_result_event("run-failed") is None
        assert [
            event.event_type for event in journal.list_events("run-failed")
        ] == ["run.failed"]


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
        active = reopened.get_active_project_run("project-1")
        assert active is not None
        assert active.run_id == "run-1"
        with pytest.raises(
            InvalidRunTransitionError, match="pending approvals"
        ):
            reopened.create_run_attempt(
                "run-1",
                request_id="resume-before-decision",
                reason="explicit_resume",
                now=4,
            )


def test_terminal_tool_before_dispatch_cancels_its_pending_approval(tmp_path):
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
            tool_name="send_message_to_user",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"message": "hello"},
        )
        journal.checkpoint_tool_call(status="prepared", now=2, **values)
        journal.create_approval(
            approval_id="approval:tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Allow message?"},
            now=3,
        )

        journal.checkpoint_tool_call(
            status="failed",
            outcome="failed",
            result={"error": "tool execution cancelled or timed out"},
            now=4,
            **values,
        )

        approval = journal.list_approvals("run-1")[0]
        interaction = journal.get_human_interaction("approval:tool-1")
        assert approval.status == "rejected"
        assert approval.decision == {
            "decision": "rejected",
            "reason": "tool_terminal_before_dispatch",
        }
        assert interaction is not None
        assert interaction.status == "cancelled"
        assert journal.get_run_attempt(attempt.attempt_id).status == (
            "interrupted"
        )
        assert journal.get_run("run-1").status == "interrupted"
        assert journal.get_active_project_run("project-1") is None
        assert "approval.cancelled" in {
            event.event_type for event in journal.list_events("run-1")
        }

        resumed = journal.create_run_attempt(
            "run-1",
            request_id="resume-1",
            reason="explicit_resume",
            now=5,
        )
        assert resumed.status == "pending"


def test_resume_repairs_legacy_terminal_tool_with_pending_approval(tmp_path):
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
        journal.checkpoint_tool_call(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="send_message_to_user",
            status="prepared",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"message": "hello"},
            now=2,
        )
        journal.create_approval(
            approval_id="approval:tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Allow message?"},
            now=3,
        )

    # Reproduce a pre-fix row: the waiter was cancelled and the ToolCall was
    # closed, but its durable Approval/interaction remained pending.
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            UPDATE tool_calls
            SET status = 'failed', outcome = 'failed', completed_at = 4,
                updated_at = 4
            WHERE tool_call_id = 'tool-1'
            """
        )

    with SQLiteRunJournal(path) as reopened:
        resumed = reopened.create_run_attempt(
            "run-1",
            request_id="resume-legacy",
            reason="explicit_resume",
            now=5,
        )

        assert resumed.status == "pending"
        assert reopened.list_approvals("run-1")[0].status == "rejected"
        assert (
            reopened.get_human_interaction("approval:tool-1").status
            == "cancelled"
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


def test_dispatched_internal_control_is_recoverable_after_restart(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.checkpoint_tool_call(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="agent_run_subagent",
            status="prepared",
            safety_class=ToolSafetyClass.INTERNAL_CONTROL,
            request={"description": "Research references", "wait": False},
            now=2,
        )
        journal.checkpoint_tool_call(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="agent_run_subagent",
            status="dispatched",
            safety_class=ToolSafetyClass.INTERNAL_CONTROL,
            request={"description": "Research references", "wait": False},
            now=3,
        )

        result = journal.reconcile_startup(now=4)

        assert result.outcome_unknown_tool_call_ids == ()
        recovered = journal.list_tool_calls("run-1")[0]
        assert recovered.status == "failed"
        assert recovered.outcome == "interrupted_by_restart"
        assert recovered.result == {
            "error": "In-process delegated work stopped when Eigent restarted",
            "delegated_work_may_still_be_running": False,
            "safe_to_resume": True,
        }
        assert any(
            event.event_type == "tool.failed"
            and event.payload.get("outcome") == "interrupted_by_restart"
            for event in journal.list_events("run-1")
        )

        resumed = journal.create_run_attempt(
            "run-1",
            request_id="resume-1",
            reason="explicit_resume",
            now=5,
        )
        assert resumed.status == "pending"


def test_resume_admission_repairs_legacy_unknown_internal_control(tmp_path):
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
            tool_name="agent_run_subagent",
            safety_class=ToolSafetyClass.INTERNAL_CONTROL,
            request={"description": "Research references", "wait": False},
        )
        journal.checkpoint_tool_call(status="prepared", now=2, **values)
        journal.checkpoint_tool_call(status="dispatched", now=3, **values)
        journal.checkpoint_tool_call(
            status="outcome_unknown",
            outcome="outcome_unknown",
            timeout_reason="brain_restart_after_dispatch",
            now=4,
            **values,
        )
        journal.record_timeout_outcome(
            TimeoutOutcome(
                scope=TimeoutScope.RUNTIME_LIVENESS,
                policy_version="v1",
                reason="consumer_lost",
                started_at=1,
                ended_at=5,
                run_id="run-1",
                attempt_id=attempt.attempt_id,
            )
        )

        resumed = journal.create_run_attempt(
            "run-1",
            request_id="resume-legacy",
            reason="explicit_resume",
            now=6,
        )

        assert resumed.status == "pending"
        recovered = journal.list_tool_calls("run-1")[0]
        assert recovered.status == "failed"
        assert recovered.outcome == "interrupted_by_restart"
        repairs = [
            event
            for event in journal.list_events("run-1")
            if event.event_id == "recovery:internal-control-interrupted:tool-1"
        ]
        assert len(repairs) == 1


def test_dispatched_internal_control_blocks_resume_before_restart(tmp_path):
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
            tool_name="agent_run_subagent",
            safety_class=ToolSafetyClass.INTERNAL_CONTROL,
            request={"description": "Research references", "wait": False},
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

        with pytest.raises(UnsafeResumeError) as error:
            journal.create_run_attempt(
                "run-1",
                request_id="resume-before-restart",
                reason="explicit_resume",
                now=5,
            )

        assert error.value.tool_call_ids == ("tool-1",)
        assert journal.list_tool_calls("run-1")[0].status == "dispatched"


def test_prepared_tool_and_approval_are_closed_before_startup_resume(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.checkpoint_tool_call(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="send_email",
            status="prepared",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"to": "user@example.com"},
            now=2,
        )
        journal.create_approval(
            approval_id="approval:tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Allow send_email?"},
            now=3,
        )

        journal.reconcile_startup(now=4)

        tool = journal.list_tool_calls("run-1")[0]
        assert tool.status == "failed"
        assert tool.outcome == "failed_before_dispatch"
        assert journal.list_approvals("run-1")[0].status == "rejected"
        interaction = journal.get_human_interaction("approval:tool-1")
        assert interaction is not None
        assert interaction.status == "cancelled"
        assert not journal.list_approvals("run-1", pending_only=True)
        cancellation = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "approval.cancelled"
        )
        assert cancellation.payload["interaction_id"] == "approval:tool-1"
        assert cancellation.payload["reason"] == (
            "brain_restart_before_dispatch"
        )

        resumed = journal.create_run_attempt(
            "run-1",
            request_id="resume-1",
            reason="explicit_resume",
            now=5,
        )
        assert resumed.status == "pending"


def test_startup_cancels_subagent_step_that_never_crossed_dispatch(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        steps = RunStepCoordinator(journal)
        steps.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="single_agent",
            items=[
                PlanStepInput(
                    plan_item_id="root",
                    title="Build the report",
                    active_form="Building the report",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        parent_step_id = steps.current_running_step_id("run-1")
        child_step_id = steps.create_child_step(
            project_id="project-1",
            run_id="run-1",
            parent_step_id=parent_step_id,
            task_identity="tool-1",
            title="Review references",
            agent_id="research",
            start=False,
        )
        journal.checkpoint_tool_call(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="agent_run_subagent",
            status="prepared",
            safety_class=ToolSafetyClass.INTERNAL_CONTROL,
            request={"description": "Review references"},
            step_id=child_step_id,
            now=2,
        )
        journal.create_approval(
            approval_id="approval:tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Allow delegation?"},
            step_id=child_step_id,
            now=3,
        )

        journal.reconcile_startup(now=4)

        assert steps.replay("run-1")[child_step_id].status == "cancelled"
        cancellation = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "approval.cancelled"
        )
        assert cancellation.payload["step_id"] == child_step_id
        failed_tool = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "tool.failed"
        )
        assert failed_tool.payload["step_id"] == child_step_id


def test_startup_backfills_missing_cancelled_approval_event(tmp_path):
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
        values = dict(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="send_email",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"to": "user@example.com"},
        )
        journal.checkpoint_tool_call(status="prepared", now=2, **values)
        journal.create_approval(
            approval_id="approval:tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Allow send_email?"},
            now=3,
        )
        journal.checkpoint_tool_call(
            status="failed",
            outcome="failed_before_dispatch",
            result={"error": "restart"},
            now=4,
            **values,
        )

    # Reproduce the historical recovery gap: canonical rows are terminal but
    # the event-native projection has no terminal lifecycle fact to consume.
    with sqlite3.connect(path) as connection:
        connection.execute(
            "DELETE FROM run_events WHERE event_type = 'approval.cancelled'"
        )

    with SQLiteRunJournal(path) as reopened:
        reopened.reconcile_startup(now=5)
        cancellations = [
            event
            for event in reopened.list_events("run-1")
            if event.event_type == "approval.cancelled"
        ]
        assert len(cancellations) == 1
        assert cancellations[0].payload == {
            "approval_id": "approval:tool-1",
            "interaction_id": "approval:tool-1",
            "attempt_id": attempt.attempt_id,
            "decision": "rejected",
            "reason": "tool_terminal_before_dispatch",
            "source": "recovery",
            "continued_attempt": False,
            "backfilled": True,
        }

        reopened.reconcile_startup(now=6)
        assert (
            len(
                [
                    event
                    for event in reopened.list_events("run-1")
                    if event.event_type == "approval.cancelled"
                ]
            )
            == 1
        )


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
        result = journal.reconcile_startup(now=4)

        assert result.outcome_unknown_tool_call_ids == ()
        recovered_tool = journal.list_tool_calls("run-1")[0]
        assert recovered_tool.status == "timed_out"
        assert recovered_tool.outcome == "retry_allowed"
        assert recovered_tool.timeout_reason == "brain_restart_after_dispatch"
        assert journal.list_events("run-1")[-1].event_type == "tool.timed_out"

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


def test_legacy_end_is_transport_only_and_cannot_close_run(tmp_path):
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
        assert journal.get_run("run-1").status == "running"
        assert journal.get_run("run-1").active_attempt_id == attempt.attempt_id
        assert journal.get_run_attempt(attempt.attempt_id).status == "running"


def test_terminal_run_expired_approval_does_not_abort_other_startup_recovery(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="terminal", project_id="project-1")
        terminal_attempt = journal.create_run_attempt(
            "terminal",
            request_id="terminal-initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.create_approval(
            approval_id="stale-approval",
            run_id="terminal",
            attempt_id=terminal_attempt.attempt_id,
            prompt={"question": "Continue?"},
            expires_at=2,
            expiry_action="reject",
            now=1,
        )
        journal.append_event(
            "terminal",
            RunEventDraft(
                event_id="terminal-completed",
                event_type="run.completed",
                payload={},
                created_at=1.5,
            ),
        )
        journal.ensure_run(run_id="recoverable", project_id="project-1")
        recoverable_attempt = journal.create_run_attempt(
            "recoverable",
            request_id="recoverable-initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )

        result = journal.reconcile_startup(now=3)

        assert result.interrupted_run_ids == ("recoverable",)
        assert journal.get_run("terminal").status == "completed"
        assert journal.list_approvals("terminal")[0].status == "rejected"
        assert (
            journal.get_human_interaction("stale-approval").status
            == "cancelled"
        )
        assert journal.get_run("recoverable").status == "interrupted"
        assert (
            journal.get_run_attempt(recoverable_attempt.attempt_id).status
            == "interrupted"
        )


def test_startup_reconciliation_isolates_one_run_failure(
    tmp_path, monkeypatch
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        for run_id in ("bad", "good"):
            journal.ensure_run(
                run_id=run_id, project_id=f"project-{run_id}", now=1
            )
            journal.create_run_attempt(
                run_id,
                request_id=f"initial:{run_id}",
                reason="initial_execution",
                activate=True,
                now=1,
            )

        append = journal._append_event_in_transaction

        def fail_one_run(connection, run_id, draft, **kwargs):
            if run_id == "bad" and draft.event_type == "runtime.interrupted":
                raise RuntimeError("corrupt run")
            return append(connection, run_id, draft, **kwargs)

        monkeypatch.setattr(
            journal, "_append_event_in_transaction", fail_one_run
        )

        result = journal.reconcile_startup(now=2)

        assert result.interrupted_run_ids == ("good",)
        assert journal.get_run("bad").status == "running"
        assert journal.get_run("good").status == "interrupted"


def test_interrupted_cancel_intent_blocks_resume_and_is_completed_on_startup(
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
        journal.record_timeout_outcome(
            TimeoutOutcome(
                scope=TimeoutScope.RUNTIME_LIVENESS,
                policy_version="v1",
                reason="consumer_lost",
                started_at=1,
                ended_at=2,
                run_id="run-1",
                attempt_id=attempt.attempt_id,
            )
        )
        journal.request_cancel(
            "run-1", request_id="cancel-1", reason="user_request", now=3
        )

        with pytest.raises(InvalidRunTransitionError, match="cancel intent"):
            journal.create_run_attempt(
                "run-1",
                request_id="resume-after-cancel",
                reason="explicit_resume",
                now=4,
            )

        result = journal.reconcile_startup(now=5)
        assert result.completed_cancel_run_ids == ("run-1",)
        assert journal.get_run("run-1").status == "cancelled"


def test_approval_rejects_non_running_attempt_without_orphaning_it(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="interrupted"
        )
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="pending-attempt",
            reason="explicit_resume",
            activate=False,
            now=1,
        )

        with pytest.raises(
            InvalidRunTransitionError,
            match="must be the active running attempt",
        ):
            journal.create_approval(
                approval_id="approval-1",
                run_id="run-1",
                attempt_id=attempt.attempt_id,
                prompt={"question": "Continue?"},
                now=2,
            )

        assert journal.get_run("run-1").status == "pending"
        assert journal.get_run_attempt(attempt.attempt_id).status == "pending"
        assert journal.list_approvals("run-1") == []


def test_late_tool_timeout_cannot_overwrite_completed_outcome(tmp_path):
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
        journal.checkpoint_tool_call(
            status="completed",
            result={"message_id": "m-1"},
            outcome="completed",
            now=4,
            **values,
        )

        with pytest.raises(InvalidRunTransitionError, match="completed"):
            journal.record_timeout_outcome(
                TimeoutOutcome(
                    scope=TimeoutScope.TOOL,
                    policy_version="v1",
                    reason="late_timer",
                    started_at=2,
                    ended_at=5,
                    run_id="run-1",
                    attempt_id=attempt.attempt_id,
                    tool_call_id="tool-1",
                )
            )

        tool = journal.list_tool_calls("run-1")[0]
        assert tool.status == "completed"
        assert tool.outcome == "completed"


def test_tool_timeout_cannot_mutate_a_tool_owned_by_another_run(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.ensure_run(run_id="run-2", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        values = dict(
            tool_call_id="tool-owned-by-run-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="publish_message",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"channel": "public"},
        )
        journal.checkpoint_tool_call(status="prepared", now=2, **values)
        journal.checkpoint_tool_call(status="dispatched", now=3, **values)

        with pytest.raises(
            InvalidRunTransitionError, match="belongs to run 'run-1'"
        ):
            journal.record_timeout_outcome(
                TimeoutOutcome(
                    scope=TimeoutScope.TOOL,
                    policy_version="v1",
                    reason="cross_run_timer",
                    started_at=2,
                    ended_at=4,
                    run_id="run-2",
                    tool_call_id="tool-owned-by-run-1",
                )
            )

        tool = journal.list_tool_calls("run-1")[0]
        assert tool.status == "dispatched"
        assert tool.outcome is None


def test_unsafe_write_cannot_enter_replayable_timed_out_state(tmp_path):
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

        with pytest.raises(
            InvalidRunTransitionError, match="unsafe write.*outcome_unknown"
        ):
            journal.checkpoint_tool_call(status="timed_out", now=4, **values)


def test_approval_timeout_cannot_mutate_approval_owned_by_another_run(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.ensure_run(run_id="run-2", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.create_approval(
            approval_id="approval-owned-by-run-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Continue?"},
            expires_at=3,
            expiry_action="reject",
            now=2,
        )

        with pytest.raises(
            InvalidRunTransitionError, match="belongs to run 'run-1'"
        ):
            journal.record_timeout_outcome(
                TimeoutOutcome(
                    scope=TimeoutScope.APPROVAL_EXPIRY,
                    policy_version="v1",
                    reason="cross_run_timer",
                    started_at=2,
                    ended_at=4,
                    run_id="run-2",
                    approval_id="approval-owned-by-run-1",
                )
            )

        approval = journal.list_approvals("run-1")[0]
        assert approval.status == "pending"
