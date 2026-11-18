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

"""Real SQLite lifecycle evidence consumed by approval receipts and Resume."""

import pytest

from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    OptimisticConcurrencyError,
    SQLiteRunJournal,
)
from app.run_policy import TimeoutOutcome, TimeoutScope


def waiting(journal, *, deadline_at=None):
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        deadline_at=deadline_at,
        now=1,
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
        now=2,
    )
    journal.create_approval(
        approval_id="old-approval",
        run_id="run-1",
        attempt_id=attempt.attempt_id,
        prompt={"question": "Allow write?"},
        action_digest="a" * 64,
        expires_at=5,
        expiry_action="reject",
        now=3,
    )
    return attempt


def expire(journal, attempt):
    return journal.record_timeout_outcome(
        TimeoutOutcome(
            scope=TimeoutScope.APPROVAL_EXPIRY,
            policy_version="v1",
            reason="tool_approval_expired",
            started_at=3,
            ended_at=5,
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            approval_id="old-approval",
        )
    )


@pytest.mark.parametrize("offline", [False, True])
def test_expiry_receipt_survives_restart_and_resume_rejects_old_authority(
    tmp_path, offline
):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        attempt = waiting(journal)
        if not offline:
            expire(journal, attempt)
    with SQLiteRunJournal(path) as journal:
        journal.reconcile_startup(now=6)
        run = journal.get_run("run-1")
        assert (run.status, run.terminal_reason) == (
            "interrupted",
            "approval_expired",
        )
        latest = journal.list_run_attempts("run-1")[-1]
        assert latest.terminal_reason == "approval_expired"
        if offline:
            assert latest.outcome == "approval_expired"
        old = journal.list_approvals("run-1")[0]
        assert old.decision["reason"] == "approval_expired"
        assert (
            journal.get_human_interaction("old-approval").status == "expired"
        )
        events = [
            e
            for e in journal.list_events("run-1")
            if e.event_type == "approval.expired_rejected"
        ]
        assert len(events) == 1
        journal.reconcile_startup(now=7)
        assert (
            len(
                [
                    e
                    for e in journal.list_events("run-1")
                    if e.event_type == "approval.expired_rejected"
                ]
            )
            == 1
        )
        resumed = journal.create_run_attempt(
            "run-1",
            request_id="resume-1",
            reason="explicit_resume",
            activate=True,
            now=8,
        )
        assert resumed.attempt_id != attempt.attempt_id
        assert journal.get_run("run-1").terminal_reason is None
        journal.create_approval(
            approval_id="new-approval",
            run_id="run-1",
            attempt_id=resumed.attempt_id,
            prompt={"question": "Allow reevaluated write?"},
            action_digest="b" * 64,
            expires_at=20,
            expiry_action="reject",
            now=9,
        )
        for approval_id, version, digest in [
            ("old-approval", 0, "a" * 64),
            ("new-approval", 0, "a" * 64),
            ("new-approval", 1, "b" * 64),
        ]:
            with pytest.raises(
                (
                    InvalidRunTransitionError,
                    IdempotencyConflictError,
                    OptimisticConcurrencyError,
                )
            ):
                journal.decide_approval(
                    approval_id,
                    decision="approved",
                    expected_version=version,
                    action_digest=digest,
                    decision_request_id=f"stale:{approval_id}:{version}",
                    now=10,
                )
        assert not journal.approval_decision_is_trusted(
            "old-approval", version=0, action_digest="a" * 64
        )
        approved = journal.decide_approval(
            "new-approval",
            decision="approved",
            expected_version=0,
            action_digest="b" * 64,
            decision_request_id="new-decision",
            actor_type="user",
            now=10,
        )
        assert approved.status == "approved"
        assert (
            journal.get_human_interaction("old-approval").status == "expired"
        )


def test_offline_expiry_after_the_run_deadline_keeps_the_deadline_outcome(
    tmp_path,
):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        waiting(journal, deadline_at=4)
    with SQLiteRunJournal(path) as journal:
        result = journal.reconcile_startup(now=6)
        assert result.deadline_run_ids == ("run-1",)
        run = journal.get_run("run-1")
        assert (run.status, run.terminal_reason) == (
            "timed_out",
            "deadline_exceeded",
        )
        assert journal.list_run_attempts("run-1")[-1].outcome == (
            "run.deadline_reached"
        )
        assert not [
            e
            for e in journal.list_events("run-1")
            if e.event_type == "approval.expired_rejected"
        ]


@pytest.mark.parametrize("expiry_first", [False, True])
def test_manual_cancel_and_expiry_keep_the_winning_approval_reason(
    tmp_path, expiry_first
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = waiting(journal)
        if expiry_first:
            expire(journal, attempt)
        journal.request_cancel(
            "run-1", request_id="cancel-1", reason="user_request", now=6
        )
        journal.complete_cancel("run-1", request_id="cancel-1", now=7)
        if not expiry_first:
            with pytest.raises(InvalidRunTransitionError):
                expire(journal, attempt)
        journal.reconcile_startup(now=8)
        run = journal.get_run("run-1")
        assert (run.status, run.terminal_reason) == (
            "cancelled",
            "user_cancelled",
        )
        assert journal.get_run_attempt(attempt.attempt_id).terminal_reason == (
            "approval_expired" if expiry_first else "user_cancelled"
        )
        approval = journal.list_approvals("run-1")[0]
        assert approval.decision["reason"] == (
            "approval_expired" if expiry_first else "run_terminal:cancelled"
        )
        assert journal.get_human_interaction("old-approval").status == (
            "expired" if expiry_first else "cancelled"
        )
        with pytest.raises(InvalidRunTransitionError):
            journal.create_run_attempt(
                "run-1", request_id="resume", reason="explicit_resume", now=9
            )
