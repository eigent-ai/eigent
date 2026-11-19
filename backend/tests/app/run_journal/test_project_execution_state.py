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
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.run_journal import (
    SCHEMA_VERSION,
    InvalidRunTransitionError,
    RunEventDraft,
    SQLiteRunJournal,
)

pytestmark = pytest.mark.unit


def _complete_with_frontier(
    journal: SQLiteRunJournal,
    *,
    run_id: str,
    project_id: str,
    objective: str,
    completed: list[str],
    remaining: list[str],
    now: float,
) -> None:
    journal.ensure_run(
        run_id=run_id, project_id=project_id, status="pending", now=now
    )
    journal.append_event(
        run_id,
        RunEventDraft(
            event_id=f"user:{run_id}",
            event_type="user.message",
            payload={"content": objective},
            created_at=now + 0.1,
        ),
    )
    todos = [
        {"id": value, "content": value, "status": "completed"}
        for value in completed
    ] + [
        {
            "id": value,
            "content": value,
            "active_form": value,
            "status": "pending",
        }
        for value in remaining
    ]
    journal.append_event(
        run_id,
        RunEventDraft(
            event_id=f"todos:{run_id}",
            event_type="legacy.todo_state",
            legacy_step="todo_state",
            payload={"todos": todos},
            created_at=now + 0.2,
        ),
    )
    journal.append_event(
        run_id,
        RunEventDraft(
            event_id=f"completed:{run_id}",
            event_type="run.completed",
            payload={"reason": "test"},
            created_at=now + 0.3,
        ),
    )


def test_project_execution_lease_allows_only_one_run_across_connections(
    tmp_path,
):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as seed:
        seed.ensure_run(
            run_id="run-a", project_id="project-1", status="pending"
        )
        seed.ensure_run(
            run_id="run-b", project_id="project-1", status="pending"
        )

    def admit(run_id: str) -> str:
        with SQLiteRunJournal(path) as journal:
            try:
                journal.create_run_attempt(
                    run_id,
                    request_id=f"request:{run_id}",
                    reason="test",
                )
            except InvalidRunTransitionError:
                return "rejected"
            return "admitted"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(admit, ("run-a", "run-b")))

    assert sorted(outcomes) == ["admitted", "rejected"]
    with SQLiteRunJournal(path) as journal:
        owner = journal.get_active_project_run("project-1")
        assert owner is not None
        rejected = "run-b" if owner.run_id == "run-a" else "run-a"
        journal.append_event(
            owner.run_id,
            RunEventDraft(
                event_id=f"interrupted:{owner.run_id}",
                event_type="run.interrupted",
                payload={"reason": "test"},
            ),
        )
        journal.create_run_attempt(
            rejected,
            request_id=f"retry:{rejected}",
            reason="test_after_release",
        )
        assert journal.get_active_project_run("project-1").run_id == rejected


def test_frontier_advances_version_and_deduplicates_continue(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _complete_with_frontier(
            journal,
            run_id="run-1",
            project_id="project-1",
            objective="Build the report",
            completed=["Collect data"],
            remaining=["Write summary"],
            now=1,
        )
        state = journal.get_project_execution_state("project-1")
        assert state.state_version == 1
        assert state.frontier == {
            "artifact_ids": [],
            "blocked_by": None,
            "completed": ["Collect data"],
            "in_progress": None,
            "next_action": "Write summary",
            "objective": "Build the report",
            "remaining": ["Write summary"],
        }

        first, created = journal.claim_continuation(
            request_id="continue-1",
            project_id="project-1",
            intent="continue_project",
            base_run_id="run-1",
            next_action="Write summary",
        )
        duplicate, duplicate_created = journal.claim_continuation(
            request_id="continue-2",
            project_id="project-1",
            intent="continue_project",
            base_run_id="run-1",
            next_action="Write summary",
        )
        assert created is True
        assert duplicate_created is False
        assert duplicate.fingerprint == first.fingerprint
        assert duplicate.request_id == "continue-1"

        _complete_with_frontier(
            journal,
            run_id="run-noop",
            project_id="project-1",
            objective="Build the report",
            completed=["Collect data"],
            remaining=["Write summary"],
            now=1.5,
        )
        unchanged = journal.get_project_execution_state("project-1")
        assert unchanged.state_version == 1
        assert unchanged.frontier_run_id == "run-1"

        _complete_with_frontier(
            journal,
            run_id="run-2",
            project_id="project-1",
            objective="Build the report",
            completed=["Collect data", "Write summary"],
            remaining=[],
            now=2,
        )
        advanced = journal.get_project_execution_state("project-1")
        assert advanced.state_version == 2
        next_claim, next_created = journal.claim_continuation(
            request_id="continue-3",
            project_id="project-1",
            intent="continue_project",
            base_run_id="run-2",
            next_action=None,
        )
        assert next_created is True
        assert next_claim.fingerprint != first.fingerprint


def test_failed_preflight_releases_only_an_unadmitted_continuation(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        first, created = journal.claim_continuation(
            request_id="run-unadmitted",
            project_id="project-1",
            intent="continue_project",
            base_run_id=None,
            next_action="Write summary",
        )
        assert created is True
        assert journal.release_unadmitted_continuation(
            request_id=first.request_id
        )
        _, replacement_created = journal.claim_continuation(
            request_id="run-retry",
            project_id="project-1",
            intent="continue_project",
            base_run_id=None,
            next_action="Write summary",
        )
        assert replacement_created is True

        journal.ensure_run(
            run_id="run-retry", project_id="project-1", status="pending"
        )
        journal.create_run_attempt(
            "run-retry", request_id="admitted", reason="test"
        )
        assert not journal.release_unadmitted_continuation(
            request_id="run-retry"
        )


def test_successful_continuation_advances_claimed_frontier_action(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _complete_with_frontier(
            journal,
            run_id="run-base",
            project_id="project-1",
            objective="Build the report",
            completed=["Collect data"],
            remaining=["Generate charts", "Write summary"],
            now=1,
        )
        journal.claim_continuation(
            request_id="run-continue",
            project_id="project-1",
            intent="continue_project",
            base_run_id="run-base",
            next_action="Generate charts",
        )
        journal.ensure_run(
            run_id="run-continue",
            project_id="project-1",
            status="pending",
            now=2,
        )
        journal.append_event(
            "run-continue",
            RunEventDraft(
                event_id="user:run-continue",
                event_type="user.message",
                payload={"content": "continue"},
                created_at=2.1,
            ),
        )
        journal.append_event(
            "run-continue",
            RunEventDraft(
                event_id="completed:run-continue",
                event_type="run.completed",
                payload={"reason": "turn_completed"},
                created_at=2.2,
            ),
        )

        state = journal.get_project_execution_state("project-1")
        assert state.state_version == 2
        assert state.frontier is not None
        assert state.frontier["completed"] == [
            "Collect data",
            "Generate charts",
        ]
        assert state.frontier["remaining"] == ["Write summary"]
        assert state.frontier["next_action"] == "Write summary"


def test_v20_terminal_history_lazily_backfills_project_frontier(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        _complete_with_frontier(
            journal,
            run_id="run-v20",
            project_id="project-v20",
            objective="Prepare migration report",
            completed=["Inspect history"],
            remaining=["Write report"],
            now=1,
        )
        # A real schema-v20 database has terminal events but no v21 frontier
        # row. Removing only the derived row reproduces that upgrade shape.
        with journal._write_transaction() as connection:  # noqa: SLF001
            connection.execute(
                "DELETE FROM project_execution_states WHERE project_id = ?",
                ("project-v20",),
            )

    with SQLiteRunJournal(path) as reopened:
        state = reopened.get_project_execution_state("project-v20")
        assert state.state_version == 1
        assert state.frontier_run_id == "run-v20"
        assert state.frontier is not None
        assert state.frontier["next_action"] == "Write report"


def test_v20_schema_migrates_execution_lease_and_follow_up_source(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        journal.ensure_run(
            run_id="run-v20", project_id="project-v20", status="pending"
        )
        journal.create_run_attempt(
            "run-v20", request_id="request-v20", reason="legacy"
        )
        journal.put_follow_up_request(
            request_id="follow-v20",
            project_id="project-v20",
            content="Keep going",
        )

    # Recreate the exact v20 follow-up table shape instead of lowering only
    # PRAGMA user_version on a database that already contains v21 columns.
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("DROP INDEX follow_up_requests_source_command_idx")
        connection.execute(
            "ALTER TABLE follow_up_requests RENAME TO follow_up_requests_v21"
        )
        connection.execute(
            """CREATE TABLE follow_up_requests(
                request_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                content TEXT NOT NULL CHECK(length(trim(content)) > 0),
                attachment_paths_json TEXT NOT NULL DEFAULT '[]',
                delivery_mode TEXT NOT NULL DEFAULT 'wait'
                    CHECK(delivery_mode IN ('wait', 'send_now')),
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'admitted', 'cancelled')),
                admitted_run_id TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
                last_error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )"""
        )
        connection.execute(
            """INSERT INTO follow_up_requests(
                request_id, project_id, content, attachment_paths_json,
                delivery_mode, status, admitted_run_id, last_error,
                created_at, updated_at
            ) SELECT request_id, project_id, content, attachment_paths_json,
                     delivery_mode, status, admitted_run_id, last_error,
                     created_at, updated_at
              FROM follow_up_requests_v21"""
        )
        connection.execute("DROP TABLE follow_up_requests_v21")
        connection.execute(
            """CREATE INDEX follow_up_requests_pending_idx
            ON follow_up_requests(project_id, delivery_mode DESC, created_at)
            WHERE status = 'pending'"""
        )
        connection.execute("DROP TABLE context_projection_diagnostics")
        connection.execute("DROP TABLE continuation_claims")
        connection.execute("DROP TABLE project_execution_states")
        connection.execute("DROP TABLE project_run_execution_leases")
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 21"
        )
        connection.execute("PRAGMA user_version = 20")

    with SQLiteRunJournal(path) as upgraded:
        assert upgraded.schema_version == SCHEMA_VERSION
        assert upgraded.get_active_project_run("project-v20").run_id == (
            "run-v20"
        )
        pending = upgraded.list_follow_up_requests(project_id="project-v20")
        assert len(pending) == 1
        assert pending[0].source == "local"
        assert pending[0].source_command_id is None


def test_projection_diagnostic_contains_ids_and_digest_but_not_prompt(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        record = journal.put_context_projection_diagnostic(
            projection_id="ctxproj_1",
            project_id="project-1",
            run_id="run-1",
            source_event_ids=["event-2", "event-1", "event-1"],
            source_memory_ids=["fact-1"],
            project_state_version=0,
            projection_digest="a" * 64,
            token_count=12,
        )
        assert record.source_event_ids == ("event-1", "event-2")
        assert record.source_memory_ids == ("fact-1",)
        columns = {
            row[1]
            for row in journal._connection.execute(  # noqa: SLF001
                "PRAGMA table_info(context_projection_diagnostics)"
            )
        }
        assert "prompt" not in " ".join(columns)
        assert "text" not in columns
