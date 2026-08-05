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
import threading

import pytest

from app.run_journal import (
    SCHEMA_VERSION,
    EventRecorder,
    IdempotencyConflictError,
    OptimisticConcurrencyError,
    RunEventDraft,
    SQLiteRunJournal,
)


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def test_initializes_schema_and_durability_pragmas(journal):
    assert journal.schema_version == SCHEMA_VERSION
    assert journal.database_settings() == {
        "journal_mode": "wal",
        "foreign_keys": 1,
        "busy_timeout": 5000,
        "synchronous": 2,
    }

    with sqlite3.connect(journal.path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert {
        "runs",
        "run_attempts",
        "run_events",
        "run_event_sync_outbox",
        "tool_calls",
        "approvals",
    } <= tables


def test_event_and_outbox_commit_atomically(journal):
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        timeout_policy_version="timeouts-v3",
    )

    committed = journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="event-1",
            event_type="message.created",
            payload={"content": "hello"},
            created_at=10.0,
        ),
        expected_version=0,
    )

    assert committed.sequence == 1
    assert committed.run_version == 1
    assert journal.get_run("run-1").version == 1
    assert journal.list_events("run-1") == [committed]
    outbox = journal.list_pending_outbox(now=10.0)
    assert [(row.event_id, row.run_sequence) for row in outbox] == [
        ("event-1", 1)
    ]


def test_duplicate_event_id_returns_original_without_allocating_sequence(
    journal,
):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    draft = RunEventDraft(
        event_id="event-1",
        event_type="message.created",
        payload={"content": "hello"},
        created_at=10.0,
    )

    first = journal.append_event("run-1", draft)
    duplicate = journal.append_event("run-1", draft)

    assert duplicate == first
    assert [event.sequence for event in journal.list_events("run-1")] == [1]
    assert journal.get_run("run-1").version == 1


def test_replay_preserves_the_run_version_committed_with_each_event(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="event-1",
            event_type="message.created",
            payload={"index": 1},
        ),
    )
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="event-2",
            event_type="message.created",
            payload={"index": 2},
        ),
    )

    assert [event.run_version for event in journal.list_events("run-1")] == [
        1,
        2,
    ]


def test_duplicate_event_id_with_different_data_is_rejected(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="event-1",
            event_type="message.created",
            payload={"content": "hello"},
            created_at=10.0,
        ),
    )

    with pytest.raises(IdempotencyConflictError):
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="event-1",
                event_type="message.created",
                payload={"content": "different"},
                created_at=10.0,
            ),
        )


def test_version_conflict_rolls_back_event_and_outbox(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")

    with pytest.raises(OptimisticConcurrencyError):
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="event-1",
                event_type="message.created",
                payload={},
            ),
            expected_version=9,
        )

    assert journal.list_events("run-1") == []
    assert journal.list_pending_outbox() == []
    assert journal.get_run("run-1").version == 0


def test_concurrent_writers_allocate_contiguous_run_sequence(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    barrier = threading.Barrier(8)
    failures: list[BaseException] = []

    def append(index: int) -> None:
        try:
            barrier.wait()
            journal.append_event(
                "run-1",
                RunEventDraft(
                    event_id=f"event-{index}",
                    event_type="message.created",
                    payload={"index": index},
                ),
            )
        except BaseException as exc:
            failures.append(exc)

    threads = [
        threading.Thread(target=append, args=(index,)) for index in range(8)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert failures == []
    assert [event.sequence for event in journal.list_events("run-1")] == list(
        range(1, 9)
    )
    assert [row.run_sequence for row in journal.list_pending_outbox()] == list(
        range(1, 9)
    )


def test_database_reopens_without_reapplying_or_losing_migration(tmp_path):
    path = tmp_path / "run-journal.sqlite3"
    with SQLiteRunJournal(path) as first:
        first.ensure_run(run_id="run-1", project_id="project-1")
        assert first.schema_version == SCHEMA_VERSION

    with SQLiteRunJournal(path) as reopened:
        assert reopened.schema_version == SCHEMA_VERSION
        assert reopened.get_run("run-1") is not None


@pytest.mark.asyncio
async def test_event_recorder_compatibility_path_creates_run_and_event(
    journal,
):
    recorder = EventRecorder(journal)

    committed = await recorder.record_legacy_step(
        project_id="project-1",
        run_id="run-1",
        step="activate_agent",
        data={"agent": "browser"},
        event_id="event-1",
        created_at=10.0,
        timeout_policy_version="timeouts-v3",
    )

    run = journal.get_run("run-1")
    assert run is not None
    assert run.project_id == "project-1"
    assert run.timeout_policy_version == "timeouts-v3"
    assert committed.legacy_step == "activate_agent"
    assert committed.event_type == "legacy.activate_agent"
    assert committed.payload == {"agent": "browser"}
    assert journal.list_pending_outbox(now=10.0)[0].event_id == "event-1"
