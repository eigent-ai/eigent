from __future__ import annotations

import sqlite3

import pytest

from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    SQLiteRunJournal,
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
