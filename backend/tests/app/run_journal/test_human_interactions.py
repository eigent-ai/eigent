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
)
from app.run_runtime.step_coordinator import (
    PlanStepInput,
    RunStepCoordinator,
)


def _running_attempt(journal: SQLiteRunJournal):
    journal.ensure_run(run_id="run-1", project_id="project-1", now=1)
    return journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
        now=2,
    )


def test_question_interaction_is_not_an_approval_and_decision_is_idempotent(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = _running_attempt(journal)
        interaction = journal.create_human_interaction(
            interaction_id="question-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"question": "Which file?", "agent": "worker"},
            response_schema={"type": "string"},
            requested_by="agent:worker",
            now=3,
        )
        duplicate_request = journal.create_human_interaction(
            interaction_id="question-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"question": "Which file?", "agent": "worker"},
            response_schema={"type": "string"},
            requested_by="agent:worker",
            now=3.5,
        )

        assert interaction.status == "requested"
        assert duplicate_request == interaction
        assert journal.list_approvals("run-1") == []
        assert journal.get_run("run-1").status == "waiting_for_user"

        resolved = journal.resolve_human_interaction(
            "question-1",
            decision_request_id="decision-1",
            decision={"reply": "report.csv", "agent": "worker"},
            expected_version=0,
            expected_run_id="run-1",
            continue_active_attempt=True,
            now=4,
        )
        duplicate = journal.resolve_human_interaction(
            "question-1",
            decision_request_id="decision-1",
            decision={"reply": "report.csv", "agent": "worker"},
            expected_version=0,
            expected_run_id="run-1",
            continue_active_attempt=True,
            now=5,
        )

        assert resolved.status == "resolved"
        assert duplicate == resolved
        assert journal.get_run_attempt(attempt.attempt_id).status == "running"
        assert len(journal.list_human_interaction_decisions("question-1")) == 1
        assert [
            event.event_type for event in journal.list_events("run-1")
        ] == [
            "run.attempt_created",
            "interaction.requested",
            "interaction.resolved",
        ]

        with pytest.raises(IdempotencyConflictError, match="was reused"):
            journal.resolve_human_interaction(
                "question-1",
                decision_request_id="decision-1",
                decision={"reply": "other.csv", "agent": "worker"},
                expected_version=0,
            )


def test_approval_is_a_digest_bound_interaction_subtype(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = _running_attempt(journal)
        approval = journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"title": "Allow delete?"},
            action_digest="a" * 64,
            policy_revision="policy-7",
            safety_class="unsafe_write",
            now=3,
        )
        duplicate_request = journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"title": "Allow delete?"},
            action_digest="a" * 64,
            policy_revision="policy-7",
            safety_class="unsafe_write",
            now=3.5,
        )
        interaction = journal.get_human_interaction("approval-1")

        assert interaction is not None
        assert interaction.interaction_type == "approval"
        assert duplicate_request == approval
        assert approval.action_digest == "a" * 64

        with pytest.raises(IdempotencyConflictError, match="digest changed"):
            journal.decide_approval(
                "approval-1",
                decision="approved",
                expected_version=0,
                action_digest="b" * 64,
                decision_request_id="decision-bad",
            )

        decided = journal.decide_approval(
            "approval-1",
            decision="rejected",
            expected_version=0,
            action_digest="a" * 64,
            decision_request_id="decision-1",
            actor_type="user",
            actor_id="user-1",
            now=4,
        )
        assert decided.status == "rejected"
        assert journal.get_human_interaction("approval-1").status == "resolved"
        decision = journal.list_human_interaction_decisions("approval-1")[0]
        assert decision.action_digest == "a" * 64


def test_approval_blocks_and_resumes_its_authored_step(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = _running_attempt(journal)
        steps = RunStepCoordinator(journal)
        steps.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[
                PlanStepInput(
                    plan_item_id="pli-1",
                    title="Write the report",
                    active_form="Writing the report",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        step_id = steps.current_running_step_id("run-1")
        assert step_id is not None

        journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"title": "Allow write?"},
            action_digest="a" * 64,
            now=3,
        )

        assert steps.replay("run-1")[step_id].status == "blocked"
        requested = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "approval.requested"
        )
        assert requested.payload["step_id"] == step_id

        journal.decide_approval(
            "approval-1",
            decision="approved",
            expected_version=0,
            action_digest="a" * 64,
            decision_request_id="decision-1",
            continue_active_attempt=True,
            now=4,
        )

        assert steps.replay("run-1")[step_id].status == "running"
        decided = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "approval.decided"
        )
        assert decided.payload["step_id"] == step_id


def test_parallel_approvals_share_wait_and_resume_after_last_decision(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = _running_attempt(journal)
        steps = RunStepCoordinator(journal)
        steps.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[
                PlanStepInput(
                    plan_item_id="pli-1",
                    title="Write the report",
                    active_form="Writing the report",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        step_id = steps.current_running_step_id("run-1")
        assert step_id is not None
        for index in (1, 2):
            journal.create_approval(
                approval_id=f"approval-{index}",
                run_id="run-1",
                attempt_id=attempt.attempt_id,
                prompt={"title": f"Allow action {index}?"},
                action_digest=str(index) * 64,
                policy_revision="policy-1",
                safety_class="unsafe_write",
                now=2 + index,
            )

        requests = [
            event
            for event in journal.list_events("run-1")
            if event.event_type == "approval.requested"
        ]
        assert [event.payload["step_id"] for event in requests] == [
            step_id,
            step_id,
        ]
        assert (
            sum(
                event.event_type == "step.blocked"
                for event in journal.list_events("run-1")
            )
            == 1
        )

        assert journal.get_run("run-1").status == "waiting_for_user"
        assert journal.get_run("run-1").active_attempt_id == attempt.attempt_id
        assert journal.get_run_attempt(attempt.attempt_id).status == (
            "waiting_for_user"
        )

        journal.decide_approval(
            "approval-1",
            decision="approved",
            expected_version=0,
            action_digest="1" * 64,
            decision_request_id="decision-1",
            continue_active_attempt=True,
            now=5,
        )

        assert journal.get_run("run-1").status == "waiting_for_user"
        assert journal.get_run("run-1").active_attempt_id == attempt.attempt_id
        assert journal.get_run_attempt(attempt.attempt_id).status == (
            "waiting_for_user"
        )
        first_decision = next(
            event
            for event in journal.list_events("run-1")
            if event.event_id == "approval:approval-1:decision:1"
        )
        assert first_decision.payload["continued_attempt"] is False
        assert first_decision.payload["remaining_interaction_count"] == 1

        journal.decide_approval(
            "approval-2",
            decision="approved",
            expected_version=0,
            action_digest="2" * 64,
            decision_request_id="decision-2",
            continue_active_attempt=True,
            now=6,
        )

        assert journal.get_run("run-1").status == "running"
        assert journal.get_run("run-1").active_attempt_id == attempt.attempt_id
        assert journal.get_run_attempt(attempt.attempt_id).status == "running"
        second_decision = next(
            event
            for event in journal.list_events("run-1")
            if event.event_id == "approval:approval-2:decision:1"
        )
        assert second_decision.payload["continued_attempt"] is True
        assert second_decision.payload["remaining_interaction_count"] == 0
        assert second_decision.payload["step_id"] == step_id
        assert steps.replay("run-1")[step_id].status == "running"


def test_approval_without_step_id_does_not_guess_between_parent_and_child(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = _running_attempt(journal)
        steps = RunStepCoordinator(journal)
        steps.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[
                PlanStepInput(
                    plan_item_id="pli-1",
                    title="Write the report",
                    active_form="Writing the report",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        parent_step_id = steps.current_running_step_id(
            "run-1", agent_id="agent-1"
        )
        assert parent_step_id is not None
        child_step_id = steps.create_child_step(
            project_id="project-1",
            run_id="run-1",
            parent_step_id=parent_step_id,
            task_identity="parallel-child",
            title="Review the report",
            agent_id="reviewer",
        )

        journal.create_approval(
            approval_id="approval-with-ambiguous-step",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"title": "Allow write?"},
            action_digest="a" * 64,
            now=3,
        )

        requested = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "approval.requested"
        )
        assert requested.payload["step_id"] is None
        snapshots = steps.replay("run-1")
        assert snapshots[parent_step_id].status == "running"
        assert snapshots[child_step_id].status == "running"


def test_approval_with_explicit_pending_child_step_blocks_that_child(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = _running_attempt(journal)
        steps = RunStepCoordinator(journal)
        steps.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[
                PlanStepInput(
                    plan_item_id="pli-1",
                    title="Write the report",
                    active_form="Writing the report",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        parent_step_id = steps.current_running_step_id(
            "run-1", agent_id="agent-1"
        )
        assert parent_step_id is not None
        child_step_id = steps.create_child_step(
            project_id="project-1",
            run_id="run-1",
            parent_step_id=parent_step_id,
            task_identity="approval-child",
            title="Review the report",
            agent_id="reviewer",
            start=False,
        )

        journal.create_approval(
            approval_id="approval-for-child",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"title": "Allow delegation?"},
            action_digest="b" * 64,
            step_id=child_step_id,
            now=3,
        )

        requested = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "approval.requested"
        )
        assert requested.payload["step_id"] == child_step_id
        snapshots = steps.replay("run-1")
        assert snapshots[parent_step_id].status == "running"
        assert snapshots[child_step_id].status == "blocked"


def test_generic_interaction_blocks_resume_after_restart(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        attempt = _running_attempt(journal)
        journal.create_human_interaction(
            interaction_id="question-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"question": "Continue?"},
            now=3,
        )

    with SQLiteRunJournal(path) as reopened:
        reopened.reconcile_startup(now=4)
        with pytest.raises(
            InvalidRunTransitionError, match="pending human interactions"
        ):
            reopened.create_run_attempt(
                "run-1",
                request_id="resume-1",
                reason="explicit_resume",
                now=5,
            )


def test_terminal_run_cancels_open_human_interaction_atomically(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = _running_attempt(journal)
        journal.create_human_interaction(
            interaction_id="question-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"question": "Continue?"},
            requested_by="agent:worker",
            now=3,
        )

        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="run-1-failed",
                event_type="run.failed",
                payload={"reason": "execution_backend_failure"},
                created_at=4,
            ),
        )

        interaction = journal.get_human_interaction("question-1")
        assert interaction is not None
        assert interaction.status == "cancelled"
        assert interaction.resolved_at == 4
        assert journal.get_run("run-1").status == "failed"
        assert [
            event.event_type for event in journal.list_events("run-1")
        ] == [
            "run.attempt_created",
            "interaction.requested",
            "interaction.cancelled",
            "run.failed",
        ]
        decisions = journal.list_human_interaction_decisions("question-1")
        assert len(decisions) == 1
        assert decisions[0].actor_type == "system"


def test_terminal_run_rejects_open_approval_and_cancels_interaction(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = _running_attempt(journal)
        journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"title": "Allow write?"},
            action_digest="a" * 64,
            policy_revision="policy-1",
            safety_class="unsafe_write",
            now=3,
        )

        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="run-1-failed",
                event_type="run.failed",
                payload={"reason": "execution_backend_failure"},
                created_at=4,
            ),
        )

        approval = journal.list_approvals("run-1")[0]
        interaction = journal.get_human_interaction("approval-1")
        assert approval.status == "rejected"
        assert interaction is not None and interaction.status == "cancelled"
        decisions = journal.list_human_interaction_decisions("approval-1")
        assert decisions[0].decision == {
            "decision": "rejected",
            "reason": "run_terminal:failed",
        }
        assert "approval.cancelled" in {
            event.event_type for event in journal.list_events("run-1")
        }


def test_startup_cancels_historical_interaction_on_terminal_run(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        attempt = _running_attempt(journal)
        journal.create_human_interaction(
            interaction_id="question-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"question": "Continue?"},
            requested_by="agent:worker",
            now=3,
        )

    # Reproduce a row written by an older terminal path that did not close its
    # still-requested HumanInteraction.
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            UPDATE runs
            SET status = 'failed', active_attempt_id = NULL, updated_at = 4
            WHERE run_id = 'run-1'
            """
        )
        connection.execute(
            """
            UPDATE run_attempts
            SET status = 'failed', ended_at = 4, outcome = 'run.failed'
            WHERE attempt_id = ?
            """,
            (attempt.attempt_id,),
        )

    with SQLiteRunJournal(path) as reopened:
        reopened.reconcile_startup(now=5)

        interaction = reopened.get_human_interaction("question-1")
        assert interaction is not None
        assert interaction.status == "cancelled"
        assert interaction.resolved_at == 5
        assert reopened.get_run("run-1").status == "failed"
        assert "interaction.cancelled" in {
            event.event_type for event in reopened.list_events("run-1")
        }


def test_v10_approval_is_backfilled_with_the_same_interaction_id(tmp_path):
    from app.run_journal import store as store_module

    path = tmp_path / "journal.sqlite3"
    migrations = [
        getattr(store_module, f"_MIGRATION_V{version}")
        for version in range(1, 11)
    ]
    with sqlite3.connect(path, isolation_level=None) as connection:
        for migration in migrations:
            connection.executescript(migration)
        connection.execute(
            """
            INSERT INTO runs(
                run_id, project_id, status, version, deadline_at,
                timeout_policy_version, created_at, updated_at
            ) VALUES ('run-1', 'project-1', 'waiting_for_user', 0, NULL, 'v1', 1, 1)
            """
        )
        connection.execute(
            """
            INSERT INTO approvals(
                approval_id, run_id, attempt_id, status, prompt_json,
                decision_json, created_at, resolved_at, version,
                expires_at, expiry_action
            ) VALUES (
                'approval-legacy', 'run-1', NULL, 'pending',
                '{"question":"Continue?"}', NULL, 2, NULL, 0, NULL,
                'keep_pending'
            )
            """
        )

    with SQLiteRunJournal(path) as upgraded:
        interaction = upgraded.get_human_interaction("approval-legacy")
        assert interaction is not None
        assert interaction.interaction_id == "approval-legacy"
        assert interaction.interaction_type == "approval"
        assert interaction.status == "requested"
