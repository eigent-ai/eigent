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

"""Every Run stop records one closed reason plus a free-form detail."""

import json
import sqlite3
from pathlib import Path

import pytest

from app.run_journal import (
    InvalidRunTransitionError,
    RunEventDraft,
    SQLiteRunJournal,
)
from app.run_journal.transitions import RunTerminalReason
from app.run_policy import TimeoutOutcome, TimeoutScope, ToolSafetyClass


def started(
    journal, run_id="run-1", *, deadline_at=None, project_id="project-1"
):
    journal.ensure_run(
        run_id=run_id,
        project_id=project_id,
        deadline_at=deadline_at,
        now=1,
    )
    return journal.create_run_attempt(
        run_id,
        request_id=f"initial:{run_id}",
        reason="initial_execution",
        activate=True,
        now=2,
    )


def waiting(journal, *, expires_at, deadline_at=None):
    attempt = started(journal, deadline_at=deadline_at)
    journal.create_approval(
        approval_id="approval-1",
        run_id="run-1",
        attempt_id=attempt.attempt_id,
        prompt={"question": "Allow write?"},
        action_digest="a" * 64,
        expires_at=expires_at,
        expiry_action="reject",
        now=3,
    )
    return attempt


def asking(journal, *, expires_at, deadline_at=None):
    attempt = started(journal, deadline_at=deadline_at)
    journal.create_human_interaction(
        interaction_id="question-1",
        run_id="run-1",
        attempt_id=attempt.attempt_id,
        interaction_type="question",
        request={"question": "Which file?"},
        expires_at=expires_at,
        now=3,
    )
    return attempt


def stop(journal, attempt, run_id="run-1"):
    run = journal.get_run(run_id)
    return (
        run.status,
        run.terminal_reason,
        run.terminal_detail,
        journal.get_run_attempt(attempt.attempt_id).terminal_reason,
    )


def timeout(scope, *, reason, ended_at, attempt_id=None):
    return TimeoutOutcome(
        scope=scope,
        policy_version="v1",
        reason=reason,
        started_at=2,
        ended_at=ended_at,
        run_id="run-1",
        attempt_id=attempt_id,
    )


@pytest.mark.parametrize(
    ("event_type", "payload", "status", "reason", "detail"),
    [
        (
            "run.completed",
            {"reason": "run_turn_completed"},
            "completed",
            "completed",
            "run_turn_completed",
        ),
        (
            "run.failed",
            {"reason": "execution_backend_failure", "message": "boom"},
            "failed",
            "error",
            "execution_backend_failure: boom",
        ),
        (
            "run.failed",
            {"reason": "context_budget_exhausted"},
            "failed",
            "budget_exhausted",
            "context_budget_exhausted",
        ),
        (
            "runtime.interrupted",
            {"reason": "model_transport_error", "message": "reset"},
            "interrupted",
            "runtime_lost",
            "model_transport_error: reset",
        ),
        # A cancel is its own cause whatever reason its requester gave.
        (
            "run.cancelled",
            {"reason": "brain_restart"},
            "cancelled",
            "user_cancelled",
            "brain_restart",
        ),
    ],
)
def test_stopping_event_records_its_cause_on_run_attempt_and_event(
    tmp_path, event_type, payload, status, reason, detail
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = started(journal)
        draft = RunEventDraft(event_type=event_type, payload=payload)
        event = journal.append_event("run-1", draft)

        assert stop(journal, attempt) == (status, reason, detail, reason)
        assert event.payload["terminal_reason"] == reason
        assert event.payload["terminal_detail"] == detail
        stored = journal.list_events("run-1")[-1]
        assert stored.payload == event.payload
        # A retried delivery of the same draft is still the same fact.
        assert journal.append_event("run-1", draft).event_id == draft.event_id


def test_cancel_deadline_liveness_and_restart_paths_record_their_cause(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "cancel.sqlite3") as journal:
        attempt = started(journal)
        journal.request_cancel(
            "run-1", request_id="cancel-1", reason="user_request", now=3
        )
        journal.complete_cancel("run-1", request_id="cancel-1", now=4)
        assert stop(journal, attempt) == (
            "cancelled",
            "user_cancelled",
            "user_request",
            "user_cancelled",
        )

    # A cancel still pending at startup keeps its requester's reason too.
    with SQLiteRunJournal(tmp_path / "startup-cancel.sqlite3") as journal:
        attempt = started(journal)
        journal.request_cancel(
            "run-1", request_id="cancel-1", reason="user_request", now=3
        )
        journal.reconcile_startup(now=4)
        assert stop(journal, attempt) == (
            "cancelled",
            "user_cancelled",
            "user_request",
            "user_cancelled",
        )

    with SQLiteRunJournal(tmp_path / "deadline.sqlite3") as journal:
        attempt = started(journal, deadline_at=5)
        journal.record_timeout_outcome(
            timeout(
                TimeoutScope.RUN_DEADLINE,
                reason="persisted_run_deadline_reached",
                ended_at=5,
            )
        )
        assert stop(journal, attempt) == (
            "timed_out",
            "deadline_exceeded",
            "persisted_run_deadline_reached",
            "deadline_exceeded",
        )
        assert journal.get_run_attempt(attempt.attempt_id).status == (
            "timed_out"
        )
        assert journal.list_events("run-1")[-1].event_type == (
            "run.deadline_reached"
        )

    with SQLiteRunJournal(tmp_path / "liveness.sqlite3") as journal:
        attempt = started(journal)
        journal.record_timeout_outcome(
            timeout(
                TimeoutScope.RUNTIME_LIVENESS,
                reason="consumer_heartbeat_lost",
                ended_at=5,
                attempt_id=attempt.attempt_id,
            )
        )
        assert stop(journal, attempt) == (
            "interrupted",
            "runtime_lost",
            "consumer_heartbeat_lost",
            "runtime_lost",
        )

    with SQLiteRunJournal(tmp_path / "restart.sqlite3") as journal:
        attempt = started(journal)
        journal.reconcile_startup(now=5)
        assert stop(journal, attempt) == (
            "interrupted",
            "brain_restart",
            "brain_restart",
            "brain_restart",
        )


def test_reasons_are_written_once_and_resume_starts_a_new_stop(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        first = waiting(journal, expires_at=5)
        journal.reconcile_startup(now=6)
        assert stop(journal, first)[:2] == ("interrupted", "approval_expired")

        # Another stop event while already interrupted keeps the first cause.
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_type="runtime.interrupted",
                payload={"reason": "brain_restart"},
            ),
        )
        assert stop(journal, first) == (
            "interrupted",
            "approval_expired",
            "approval_expired",
            "approval_expired",
        )

        second = journal.create_run_attempt(
            "run-1",
            request_id="resume-1",
            reason="explicit_resume",
            activate=True,
            now=7,
        )
        assert journal.get_run("run-1").terminal_reason is None
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_type="run.failed",
                payload={"reason": "execution_backend_failure"},
            ),
        )
        assert stop(journal, second)[:2] == ("failed", "error")
        assert journal.get_run_attempt(first.attempt_id).terminal_reason == (
            "approval_expired"
        )


@pytest.mark.parametrize(
    ("heartbeat_at", "status", "reason"),
    [
        (12, "timed_out", "deadline_exceeded"),
        # A Run past its deadline cannot resume, so it times out while the
        # earlier restart stays its cause.
        (8, "timed_out", "brain_restart"),
    ],
)
def test_startup_takes_the_earlier_of_deadline_and_restart(
    tmp_path, heartbeat_at, status, reason
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = started(journal, deadline_at=10)
        journal.heartbeat_attempt(attempt.attempt_id, now=heartbeat_at)
        journal.reconcile_startup(now=20)
        run_status, run_reason, _detail, attempt_reason = stop(
            journal, attempt
        )
        assert (run_status, run_reason, attempt_reason) == (
            status,
            reason,
            reason,
        )


@pytest.mark.parametrize(
    ("deadline_at", "status", "reason"),
    [
        (7, "interrupted", "approval_expired"),
        # A Run past its deadline cannot resume, so it times out while the
        # earlier expiry stays its cause.
        (5.5, "timed_out", "approval_expired"),
        (4, "timed_out", "deadline_exceeded"),
        (5, "timed_out", "deadline_exceeded"),
    ],
)
def test_startup_takes_the_earlier_of_deadline_and_approval_expiry(
    tmp_path, deadline_at, status, reason
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = waiting(journal, expires_at=5, deadline_at=deadline_at)
        journal.reconcile_startup(now=6)
        run_status, run_reason, _detail, attempt_reason = stop(
            journal, attempt
        )
        assert (run_status, run_reason, attempt_reason) == (
            status,
            reason,
            reason,
        )


@pytest.mark.parametrize(
    ("request_input", "detail"),
    [
        (waiting, "approval_expired"),
        (asking, "human_interaction_expired"),
    ],
)
def test_an_expiry_before_a_passed_deadline_times_out_without_resume(
    tmp_path, request_input, detail
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = request_input(journal, expires_at=5, deadline_at=5.5)
        journal.reconcile_startup(now=6)

        assert stop(journal, attempt) == (
            "timed_out",
            "approval_expired",
            detail,
            "approval_expired",
        )
        stopped = [
            event
            for event in journal.list_events("run-1")
            if event.payload.get("terminal_reason")
        ]
        assert [event.event_type for event in stopped] == [
            "run.deadline_reached"
        ]
        assert not journal.list_human_interactions("run-1", pending_only=True)
        with pytest.raises(InvalidRunTransitionError):
            journal.create_run_attempt(
                "run-1", request_id="resume", reason="explicit_resume", now=7
            )


def test_pending_cancel_beats_an_expiry_found_at_startup(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = waiting(journal, expires_at=5)
        journal.request_cancel(
            "run-1", request_id="cancel-1", reason="user_request", now=4
        )
        journal.reconcile_startup(now=6)
        assert stop(journal, attempt)[:2] == ("cancelled", "user_cancelled")
        assert journal.get_run_attempt(attempt.attempt_id).terminal_reason == (
            "user_cancelled"
        )


@pytest.mark.parametrize(
    ("restart", "reason", "detail"),
    [
        (False, "error", "tool_terminal_before_dispatch"),
        (True, "brain_restart", "brain_restart_before_dispatch"),
    ],
)
def test_an_approval_closed_before_its_tool_dispatched_names_why(
    tmp_path, restart, reason, detail
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = started(journal)
        tool = dict(
            tool_call_id="tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="send_message_to_user",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"message": "hello"},
        )
        journal.checkpoint_tool_call(status="prepared", now=3, **tool)
        journal.create_approval(
            approval_id="approval:tool-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Allow message?"},
            now=4,
        )
        if restart:
            journal.reconcile_startup(now=5)
        else:
            journal.checkpoint_tool_call(
                status="failed", outcome="failed", now=5, **tool
            )

        assert stop(journal, attempt) == (
            "interrupted",
            reason,
            detail,
            reason,
        )


@pytest.mark.parametrize(
    "scope", [TimeoutScope.RUN_DEADLINE, TimeoutScope.APPROVAL_EXPIRY]
)
def test_a_pending_cancel_beats_an_online_deadline_or_expiry(tmp_path, scope):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = waiting(journal, expires_at=5, deadline_at=5)
        journal.request_cancel(
            "run-1", request_id="cancel-1", reason="user_request", now=4
        )
        outcome = TimeoutOutcome(
            scope=scope,
            policy_version="v1",
            reason="expired",
            started_at=2,
            ended_at=5,
            run_id="run-1",
            approval_id=(
                "approval-1" if scope is TimeoutScope.APPROVAL_EXPIRY else None
            ),
        )
        with pytest.raises(InvalidRunTransitionError, match="cancel intent"):
            journal.record_timeout_outcome(outcome)

        journal.complete_cancel("run-1", request_id="cancel-1", now=6)
        assert stop(journal, attempt) == (
            "cancelled",
            "user_cancelled",
            "user_request",
            "user_cancelled",
        )


def test_a_malformed_payload_leaves_the_backfilled_cause_unknown(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        started(journal)
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="run-1-failed",
                event_type="run.failed",
                payload={"reason": "execution_backend_failure"},
            ),
        )

    with sqlite3.connect(path) as connection:
        connection.execute(
            "UPDATE run_events SET payload_json = '[]' "
            "WHERE event_id = 'run-1-failed'"
        )
        for table in ("runs", "run_attempts"):
            for column in ("terminal_reason", "terminal_detail"):
                connection.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 42"
        )
        connection.execute("PRAGMA user_version = 41")

    with SQLiteRunJournal(path) as upgraded:
        assert upgraded.schema_version == 42
        run = upgraded.get_run("run-1")
        assert (run.status, run.terminal_reason, run.terminal_detail) == (
            "failed",
            None,
            None,
        )


def test_v42_backfills_reasons_from_the_stopping_events(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        deadline = started(journal, "deadline", deadline_at=5)
        journal.record_timeout_outcome(
            TimeoutOutcome(
                scope=TimeoutScope.RUN_DEADLINE,
                policy_version="v1",
                reason="persisted_run_deadline_reached",
                started_at=2,
                ended_at=5,
                run_id="deadline",
            )
        )
        cancelled = started(journal, "cancelled")
        journal.request_cancel(
            "cancelled", request_id="cancel-1", reason="user_request", now=3
        )
        journal.complete_cancel("cancelled", request_id="cancel-1", now=4)
        restarted = started(journal, "restarted")
        startup_deadline = started(
            journal, "startup-deadline", deadline_at=5, project_id="project-2"
        )
        journal.reconcile_startup(now=6)
        running = started(journal, "running")

    with sqlite3.connect(path) as connection:
        # The v41 shape: a reached deadline failed the Run and no cause or
        # terminal fields existed yet.
        connection.execute(
            "UPDATE runs SET status = 'failed' WHERE status = 'timed_out'"
        )
        connection.execute(
            "UPDATE run_events SET payload_json = json_remove("
            "payload_json, '$.terminal_reason', '$.terminal_detail')"
        )
        for table in ("runs", "run_attempts"):
            for column in ("terminal_reason", "terminal_detail"):
                connection.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 42"
        )
        connection.execute("PRAGMA user_version = 41")

    with SQLiteRunJournal(path) as upgraded:
        assert upgraded.schema_version == 42
        assert {
            run_id: stop(upgraded, attempt, run_id)
            for run_id, attempt in [
                ("deadline", deadline),
                ("cancelled", cancelled),
                ("restarted", restarted),
                ("startup-deadline", startup_deadline),
                ("running", running),
            ]
        } == {
            "deadline": (
                "timed_out",
                "deadline_exceeded",
                "persisted_run_deadline_reached",
                "deadline_exceeded",
            ),
            "cancelled": (
                "cancelled",
                "user_cancelled",
                "user_request",
                "user_cancelled",
            ),
            "restarted": (
                "interrupted",
                "brain_restart",
                "brain_restart",
                "brain_restart",
            ),
            # Startup on main recorded this deadline with reason
            # brain_restart; its stopping event still makes it timed out.
            "startup-deadline": (
                "timed_out",
                "brain_restart",
                "brain_restart",
                "brain_restart",
            ),
            "running": ("running", None, None, None),
        }


def test_closed_reasons_match_the_localized_frontend_vocabulary():
    locale = (
        Path(__file__).resolve().parents[4]
        / "src/i18n/locales/en-us/chat.json"
    )
    prefix = "run-terminal-reason-"
    keys = {
        key.removeprefix(prefix)
        for key in json.loads(locale.read_text())
        if key.startswith(prefix)
    }
    assert keys == {reason.value for reason in RunTerminalReason}
