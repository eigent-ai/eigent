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
"""Unit tests for the SQLite-backed event store."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

import pytest
from camel.societies.workforce.transcript import (
    TranscriptEvent,
    TranscriptEventType,
)

from app.event_store.schema import EventEnvelope
from app.event_store.sqlite_store import SQLiteTranscriptStore


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test_event_log.db"


@pytest.fixture
def store(db_path: Path) -> SQLiteTranscriptStore:
    s = SQLiteTranscriptStore(
        path=db_path,
        run_id="run-001",
        project_id="proj-001",
    )
    yield s
    s.close()


def _make_event(
    event_type: str = TranscriptEventType.LOG,
    task_id: str | None = None,
    agent_id: str | None = None,
    agent_name: str | None = None,
    payload: dict | None = None,
) -> TranscriptEvent:
    return TranscriptEvent(
        event_type=event_type,
        workforce_id="run-001",
        task_id=task_id,
        agent_id=agent_id,
        agent_name=agent_name,
        payload=payload or {},
    )


class TestSchemaCreation:
    def test_tables_created_on_init(
        self, db_path: Path, store: SQLiteTranscriptStore
    ):
        conn = sqlite3.connect(str(db_path))
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        conn.close()
        table_names = [t[0] for t in tables]
        assert "event_log" in table_names

    def test_idempotent_schema_creation(self, db_path: Path):
        """Creating two stores on the same DB should not error."""
        s1 = SQLiteTranscriptStore(path=db_path, run_id="r1", project_id="p1")
        s2 = SQLiteTranscriptStore(path=db_path, run_id="r2", project_id="p1")
        s1.close()
        s2.close()

    def test_wal_mode(self, store: SQLiteTranscriptStore):
        mode = store._conn.execute("PRAGMA journal_mode;").fetchone()[0]
        assert mode == "wal"


class TestAppendAndRead:
    def test_append_returns_compat_dict(self, store: SQLiteTranscriptStore):
        event = _make_event(payload={"message": "hello"})
        result = store.append(event)
        assert result["event_type"] == TranscriptEventType.LOG
        assert result["payload"] == {"message": "hello"}
        assert "workforce_id" in result

    def test_read_all_returns_compat_format(
        self, store: SQLiteTranscriptStore
    ):
        store.append(
            _make_event(
                event_type=TranscriptEventType.TASK_CREATED, task_id="t1"
            )
        )
        store.append(
            _make_event(
                event_type=TranscriptEventType.TASK_COMPLETED, task_id="t1"
            )
        )

        events = store.read_all()
        assert len(events) == 2
        # Check CAMEL-compatible keys
        for ev in events:
            assert set(ev.keys()) == {
                "event_type",
                "workforce_id",
                "timestamp",
                "task_id",
                "agent_id",
                "agent_name",
                "source",
                "payload",
            }
        assert events[0]["event_type"] == TranscriptEventType.TASK_CREATED
        assert events[1]["event_type"] == TranscriptEventType.TASK_COMPLETED

    def test_read_all_canonical(self, store: SQLiteTranscriptStore):
        store.append(_make_event())
        events = store.read_all_canonical()
        assert len(events) == 1
        ev = events[0]
        assert "event_id" in ev
        assert "run_id" in ev
        assert "seq" in ev
        assert "schema_version" in ev
        assert ev["run_id"] == "run-001"
        assert ev["project_id"] == "proj-001"

    def test_append_event_for_sse_payload(self, db_path: Path):
        event = SQLiteTranscriptStore.append_event(
            db_path,
            run_id="run-sse",
            project_id="proj-001",
            task_id="task-001",
            event_type="confirmed",
            payload={"question": "Summarize the local task"},
            source="eigent_sse",
        )

        assert event["run_id"] == "run-sse"
        assert event["event_type"] == "confirmed"
        assert event["payload"]["question"] == "Summarize the local task"


class TestSequencing:
    def test_seq_starts_at_zero(self, store: SQLiteTranscriptStore):
        store.append(_make_event())
        events = store.read_all_canonical()
        assert events[0]["seq"] == 0

    def test_seq_increments(self, store: SQLiteTranscriptStore):
        for _ in range(5):
            store.append(_make_event())
        events = store.read_all_canonical()
        seqs = [e["seq"] for e in events]
        assert seqs == [0, 1, 2, 3, 4]

    def test_per_run_isolation(self, db_path: Path):
        """Two stores with different run_ids get independent sequences."""
        s1 = SQLiteTranscriptStore(
            path=db_path, run_id="run-A", project_id="p1"
        )
        s2 = SQLiteTranscriptStore(
            path=db_path, run_id="run-B", project_id="p1"
        )

        s1.append(_make_event())
        s1.append(_make_event())
        s2.append(_make_event())

        events_a = s1.read_all_canonical()
        events_b = s2.read_all_canonical()

        assert [e["seq"] for e in events_a] == [0, 1]
        assert [e["seq"] for e in events_b] == [0]

        s1.close()
        s2.close()


class TestSyncMetadata:
    def test_new_events_are_unsynced(self, store: SQLiteTranscriptStore):
        store.append(_make_event())
        events = store.read_all_canonical()
        assert events[0]["synced_at"] is None
        assert events[0]["sync_attempts"] == 0

    def test_read_unsynced(self, store: SQLiteTranscriptStore):
        for _ in range(3):
            store.append(_make_event())
        unsynced = store.read_unsynced(limit=10)
        assert len(unsynced) == 3

    def test_mark_synced(self, store: SQLiteTranscriptStore):
        for _ in range(3):
            store.append(_make_event())

        events = store.read_all_canonical()
        ids_to_sync = [events[0]["event_id"], events[1]["event_id"]]
        store.mark_synced(ids_to_sync)

        unsynced = store.read_unsynced(limit=10)
        assert len(unsynced) == 1
        assert unsynced[0]["event_id"] == events[2]["event_id"]

    def test_increment_sync_attempts(self, store: SQLiteTranscriptStore):
        store.append(_make_event())
        events = store.read_all_canonical()
        eid = events[0]["event_id"]

        store.increment_sync_attempts([eid])
        store.increment_sync_attempts([eid])

        events = store.read_all_canonical()
        assert events[0]["sync_attempts"] == 2

    def test_mark_synced_empty_list(self, store: SQLiteTranscriptStore):
        """Should not error on empty list."""
        store.mark_synced([])

    def test_increment_empty_list(self, store: SQLiteTranscriptStore):
        """Should not error on empty list."""
        store.increment_sync_attempts([])


class TestThreadSafety:
    def test_concurrent_appends(self, db_path: Path):
        """Multiple threads appending should produce no gaps or dupes."""
        store = SQLiteTranscriptStore(
            path=db_path, run_id="run-mt", project_id="p1"
        )
        errors: list[Exception] = []
        n_threads = 4
        n_per_thread = 25

        def worker():
            try:
                for _ in range(n_per_thread):
                    store.append(_make_event())
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Thread errors: {errors}"

        events = store.read_all_canonical()
        assert len(events) == n_threads * n_per_thread
        seqs = sorted(e["seq"] for e in events)
        assert seqs == list(range(n_threads * n_per_thread))
        store.close()


class TestStaticQueries:
    def test_query_events_by_run_id(
        self, db_path: Path, store: SQLiteTranscriptStore
    ):
        store.append(_make_event(task_id="t1"))
        store.append(_make_event(task_id="t2"))

        results = SQLiteTranscriptStore.query_events(db_path, run_id="run-001")
        assert len(results) == 2

    def test_query_events_by_task_id(
        self, db_path: Path, store: SQLiteTranscriptStore
    ):
        store.append(_make_event(task_id="t1"))
        store.append(_make_event(task_id="t2"))
        store.append(_make_event(task_id="t1"))

        results = SQLiteTranscriptStore.query_events(db_path, task_id="t1")
        assert len(results) == 2

    def test_query_events_after_seq(
        self, db_path: Path, store: SQLiteTranscriptStore
    ):
        for _ in range(5):
            store.append(_make_event())

        results = SQLiteTranscriptStore.query_events(
            db_path, run_id="run-001", after_seq=2
        )
        seqs = [r["seq"] for r in results]
        assert seqs == [3, 4]

    def test_query_events_limit(
        self, db_path: Path, store: SQLiteTranscriptStore
    ):
        for _ in range(10):
            store.append(_make_event())

        results = SQLiteTranscriptStore.query_events(
            db_path, run_id="run-001", limit=3
        )
        assert len(results) == 3

    def test_query_runs(self, db_path: Path):
        s1 = SQLiteTranscriptStore(path=db_path, run_id="r1", project_id="p1")
        s2 = SQLiteTranscriptStore(path=db_path, run_id="r2", project_id="p1")
        s1.append(_make_event(task_id="t1"))
        s1.append(_make_event(task_id="t1"))
        s2.append(_make_event(task_id="t2"))

        runs = SQLiteTranscriptStore.query_runs(db_path)
        assert len(runs) == 2

        runs_p1 = SQLiteTranscriptStore.query_runs(db_path, project_id="p1")
        assert len(runs_p1) == 2

        s1.close()
        s2.close()

    def test_query_runs_extracts_question_summary_and_sync_status(
        self, db_path: Path
    ):
        SQLiteTranscriptStore.append_event(
            db_path,
            run_id="run-1",
            project_id="proj-1",
            task_id="run-1",
            event_type="confirmed",
            payload={"question": "Write a changelog"},
            source="eigent_sse",
        )
        SQLiteTranscriptStore.append_event(
            db_path,
            run_id="run-1",
            project_id="proj-1",
            task_id="run-1",
            event_type="end",
            payload="<summary>Done</summary>",
            source="eigent_sse",
        )

        runs = SQLiteTranscriptStore.query_runs(db_path)
        assert len(runs) == 1
        assert runs[0]["question"] == "Write a changelog"
        assert runs[0]["summary"] == "Done"
        assert runs[0]["status"] == 2
        assert runs[0]["sync_status"] == "local"

    def test_query_projects(self, db_path: Path):
        s1 = SQLiteTranscriptStore(
            path=db_path, run_id="r1", project_id="proj-A"
        )
        s2 = SQLiteTranscriptStore(
            path=db_path, run_id="r2", project_id="proj-B"
        )
        s1.append(_make_event())
        s2.append(_make_event())
        s2.append(_make_event())

        projects = SQLiteTranscriptStore.query_projects(db_path)
        assert len(projects) == 2

        proj_map = {p["project_id"]: p for p in projects}
        assert proj_map["proj-A"]["event_count"] == 1
        assert proj_map["proj-B"]["event_count"] == 2

        s1.close()
        s2.close()

    def test_query_playback_steps_filters_to_eigent_sse(
        self, db_path: Path
    ):
        SQLiteTranscriptStore.append_event(
            db_path,
            run_id="run-1",
            project_id="proj-1",
            task_id="task-1",
            event_type="confirmed",
            payload={"question": "Use local replay"},
            source="eigent_sse",
        )
        SQLiteTranscriptStore.append_event(
            db_path,
            run_id="run-1",
            project_id="proj-1",
            task_id="task-1",
            event_type="task_created",
            payload={"description": "raw camel event"},
            source="camel",
        )
        SQLiteTranscriptStore.append_event(
            db_path,
            run_id="run-1",
            project_id="proj-1",
            task_id="task-1",
            event_type="end",
            payload="<summary>Done</summary>",
            source="eigent_sse",
        )

        steps = SQLiteTranscriptStore.query_playback_steps(
            db_path, run_id="run-1"
        )
        assert [step["step"] for step in steps] == ["confirmed", "end"]
        assert steps[0]["data"]["question"] == "Use local replay"
        assert steps[1]["data"] == "<summary>Done</summary>"

    def test_query_events_empty_db(self, tmp_path: Path):
        """Query on a non-existent DB path should handle gracefully."""
        db_path = tmp_path / "nonexistent.db"
        # The static method creates its own connection, which creates the file
        results = SQLiteTranscriptStore.query_events(db_path, run_id="x")
        assert results == []


class TestEventEnvelope:
    def test_to_dict(self):
        env = EventEnvelope(
            event_id="e1",
            run_id="r1",
            project_id="p1",
            event_type="log",
            payload={"key": "value"},
        )
        d = env.to_dict()
        assert d["event_id"] == "e1"
        assert d["payload"] == {"key": "value"}

    def test_to_compat_dict(self):
        env = EventEnvelope(
            event_id="e1",
            run_id="r1",
            project_id="p1",
            event_type="log",
            occurred_at="2026-01-01T00:00:00+00:00",
            payload={"key": "value"},
        )
        d = env.to_compat_dict()
        assert d["workforce_id"] == "r1"
        assert d["timestamp"] == "2026-01-01T00:00:00+00:00"
        assert "event_id" not in d
