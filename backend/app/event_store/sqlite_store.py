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
"""SQLite-backed event log that duck-types CAMEL's TranscriptStore."""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from camel.societies.workforce.transcript import TranscriptEvent

from app.event_store.schema import (
    CREATE_EVENT_LOG_TABLE,
    CREATE_INDEXES,
    SCHEMA_VERSION,
    EventEnvelope,
)

logger = logging.getLogger("event_store")


class SQLiteTranscriptStore:
    """Append-only event log backed by a local SQLite database.

    Implements the same public interface as CAMEL's ``TranscriptStore``
    (``append``, ``read_all``) so it can be used as a drop-in replacement
    via the ``transcript_store`` parameter on ``Workforce.__init__``.
    """

    _write_lock = threading.Lock()

    def __init__(
        self,
        path: str | Path,
        run_id: str,
        project_id: str,
    ) -> None:
        self.path = Path(path)
        self.run_id = run_id
        self.project_id = project_id

        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(self.path),
            check_same_thread=False,
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA busy_timeout=5000;")
        self._ensure_schema()

    # ------------------------------------------------------------------
    # Schema bootstrap
    # ------------------------------------------------------------------

    def _ensure_schema(self) -> None:
        self._ensure_schema_on_conn(self._conn)

    @staticmethod
    def _ensure_schema_on_conn(conn: sqlite3.Connection) -> None:
        with conn:
            conn.execute(CREATE_EVENT_LOG_TABLE)
            for idx_ddl in CREATE_INDEXES:
                conn.execute(idx_ddl)

    # ------------------------------------------------------------------
    # TranscriptStore-compatible interface
    # ------------------------------------------------------------------

    def append(self, event: TranscriptEvent) -> dict[str, Any]:
        """Persist a CAMEL ``TranscriptEvent`` as a canonical event row.

        Returns the same dict shape as the JSONL ``TranscriptStore.append``
        for backward compatibility.
        """
        envelope = self._to_envelope(event)

        with self._write_lock:
            with self._conn:
                seq = self._next_seq(self._conn)
                envelope.seq = seq
                self._insert_envelope(self._conn, envelope)

        return event.to_dict()

    @classmethod
    def append_event(
        cls,
        db_path: str | Path,
        *,
        run_id: str,
        project_id: str,
        event_type: str,
        payload: Any,
        source: str,
        task_id: str | None = None,
        agent_id: str | None = None,
        agent_name: str | None = None,
        occurred_at: str | None = None,
    ) -> dict[str, Any]:
        """Append a non-CAMEL event into the canonical local event log."""
        path = Path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        conn = sqlite3.connect(str(path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")

        try:
            cls._ensure_schema_on_conn(conn)
            envelope = EventEnvelope(
                run_id=run_id,
                project_id=project_id,
                task_id=task_id,
                event_type=event_type,
                occurred_at=occurred_at or datetime.now(UTC).isoformat(),
                source=source,
                agent_id=agent_id,
                agent_name=agent_name,
                schema_version=SCHEMA_VERSION,
                payload=payload,
            )
            with cls._write_lock:
                with conn:
                    envelope.seq = cls._next_seq_for_run(conn, run_id)
                    cls._insert_envelope(conn, envelope)
            return envelope.to_dict()
        finally:
            conn.close()

    def read_all(self) -> list[dict[str, Any]]:
        """Read all events for this run, returning dicts in the same
        format as CAMEL's JSONL ``TranscriptStore``."""
        rows = self._conn.execute(
            "SELECT * FROM event_log WHERE run_id = ? ORDER BY seq",
            (self.run_id,),
        ).fetchall()
        return [self._row_to_compat_dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Extended API (for local reads, sync worker, etc.)
    # ------------------------------------------------------------------

    def read_all_canonical(self) -> list[dict[str, Any]]:
        """Read all events for this run as full canonical envelopes."""
        rows = self._conn.execute(
            "SELECT * FROM event_log WHERE run_id = ? ORDER BY seq",
            (self.run_id,),
        ).fetchall()
        return [self._row_to_canonical_dict(r) for r in rows]

    def read_unsynced(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return up to *limit* unsynced events ordered by (run_id, seq)."""
        rows = self._conn.execute(
            """\
            SELECT * FROM event_log
            WHERE synced_at IS NULL
            ORDER BY run_id, seq
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [self._row_to_canonical_dict(r) for r in rows]

    def mark_synced(self, event_ids: list[str]) -> None:
        """Mark the given events as synced."""
        if not event_ids:
            return
        now = datetime.now(UTC).isoformat()
        placeholders = ",".join("?" for _ in event_ids)
        with self._write_lock:
            with self._conn:
                self._conn.execute(
                    f"UPDATE event_log SET synced_at = ? "  # nosec B608
                    f"WHERE event_id IN ({placeholders})",
                    [now, *event_ids],
                )

    def increment_sync_attempts(self, event_ids: list[str]) -> None:
        """Bump the retry counter for the given events."""
        if not event_ids:
            return
        placeholders = ",".join("?" for _ in event_ids)
        with self._write_lock:
            with self._conn:
                self._conn.execute(
                    f"UPDATE event_log SET sync_attempts = sync_attempts + 1 "  # nosec B608
                    f"WHERE event_id IN ({placeholders})",
                    event_ids,
                )

    def close(self) -> None:
        """Close the underlying SQLite connection."""
        try:
            self._conn.close()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Class-level query helpers (for the local read API controller)
    # ------------------------------------------------------------------

    @staticmethod
    def query_events(
        db_path: str | Path,
        *,
        run_id: str | None = None,
        task_id: str | None = None,
        project_id: str | None = None,
        after_seq: int | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Query the event log with filters. Used by the local API."""
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            # Check if table exists (handles fresh/empty DBs)
            table_check = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='event_log'"
            ).fetchone()
            if not table_check:
                return []

            clauses: list[str] = []
            params: list[Any] = []
            if run_id:
                clauses.append("run_id = ?")
                params.append(run_id)
            if task_id:
                clauses.append("task_id = ?")
                params.append(task_id)
            if project_id:
                clauses.append("project_id = ?")
                params.append(project_id)
            if after_seq is not None:
                clauses.append("seq > ?")
                params.append(after_seq)

            where = " AND ".join(clauses) if clauses else "1=1"
            params.append(limit)

            rows = conn.execute(
                f"SELECT * FROM event_log WHERE {where} ORDER BY run_id, seq LIMIT ?",  # nosec B608
                params,
            ).fetchall()
            return [
                SQLiteTranscriptStore._row_to_canonical_dict(r) for r in rows
            ]
        finally:
            conn.close()

    @staticmethod
    def query_runs(
        db_path: str | Path,
        *,
        project_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """List runs with metadata. Used by the local API."""
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            table_check = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='event_log'"
            ).fetchone()
            if not table_check:
                return []

            params: list[Any] = []
            where_clause = ""
            if project_id:
                where_clause = "WHERE project_id = ?"
                params.append(project_id)

            rows = conn.execute(
                f"""\
                SELECT *
                FROM event_log
                {where_clause}
                ORDER BY run_id, seq
                """,
                params,
            ).fetchall()
            events = [SQLiteTranscriptStore._row_to_canonical_dict(r) for r in rows]
            return SQLiteTranscriptStore._summarize_runs(events)
        finally:
            conn.close()

    @staticmethod
    def query_projects(db_path: str | Path) -> list[dict[str, Any]]:
        """List projects with aggregated stats. Used by the local API."""
        runs = SQLiteTranscriptStore.query_runs(db_path)
        project_map: dict[str, dict[str, Any]] = {}

        for run in runs:
            project_id = run["project_id"]
            project = project_map.setdefault(
                project_id,
                {
                    "project_id": project_id,
                    "run_count": 0,
                    "task_count": 0,
                    "event_count": 0,
                    "first_event": run["first_event"],
                    "last_event": run["last_event"],
                    "last_prompt": run["question"],
                    "total_completed_tasks": 0,
                    "total_ongoing_tasks": 0,
                    "sync_status": "local",
                },
            )
            project["run_count"] += 1
            project["task_count"] += 1
            project["event_count"] += run["event_count"]
            project["first_event"] = min(
                project["first_event"], run["first_event"]
            )
            if run["last_event"] >= project["last_event"]:
                project["last_event"] = run["last_event"]
                project["last_prompt"] = run["question"]
            if run["status"] == 2:
                project["total_completed_tasks"] += 1
            else:
                project["total_ongoing_tasks"] += 1

            project.setdefault("_sync_states", []).append(run["sync_status"])

        for project in project_map.values():
            sync_states = set(project.pop("_sync_states", []))
            if sync_states == {"synced"}:
                project["sync_status"] = "synced"
            elif sync_states == {"local"}:
                project["sync_status"] = "local"
            else:
                project["sync_status"] = "partial"

        return sorted(
            project_map.values(),
            key=lambda item: item["last_event"],
            reverse=True,
        )

    @staticmethod
    def query_playback_steps(
        db_path: str | Path,
        *,
        run_id: str,
    ) -> list[dict[str, Any]]:
        """Return saved Eigent SSE steps for a run in playback order."""
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            table_check = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='event_log'"
            ).fetchone()
            if not table_check:
                return []

            rows = conn.execute(
                """\
                SELECT event_type, payload, task_id, occurred_at
                FROM event_log
                WHERE run_id = ? AND source = 'eigent_sse'
                ORDER BY seq
                """,
                (run_id,),
            ).fetchall()

            steps: list[dict[str, Any]] = []
            for row in rows:
                payload = row["payload"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
                steps.append(
                    {
                        "step": row["event_type"],
                        "data": payload,
                        "task_id": row["task_id"],
                        "created_at": row["occurred_at"],
                    }
                )
            return steps
        finally:
            conn.close()

    @staticmethod
    def query_sync_status(
        db_path: str | Path,
    ) -> list[dict[str, Any]]:
        """Return sync status per run. Used by the local API."""
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            table_check = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name='event_log'"
            ).fetchone()
            if not table_check:
                return []

            rows = conn.execute(
                """\
                SELECT run_id,
                       project_id,
                       COUNT(*) AS total_events,
                       SUM(CASE WHEN synced_at IS NOT NULL
                           THEN 1 ELSE 0 END) AS synced_events,
                       MAX(occurred_at) AS last_event
                FROM event_log
                GROUP BY run_id
                ORDER BY MAX(occurred_at) DESC
                """,
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _next_seq(self, conn: sqlite3.Connection) -> int:
        return self._next_seq_for_run(conn, self.run_id)

    @staticmethod
    def _next_seq_for_run(conn: sqlite3.Connection, run_id: str) -> int:
        row = conn.execute(
            "SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq "
            "FROM event_log WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        return row["next_seq"]

    @staticmethod
    def _insert_envelope(
        conn: sqlite3.Connection, envelope: EventEnvelope
    ) -> None:
        conn.execute(
            """\
            INSERT INTO event_log (
                event_id, run_id, project_id, task_id, seq,
                event_type, occurred_at, source,
                agent_id, agent_name, schema_version,
                payload, synced_at, sync_attempts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                envelope.event_id,
                envelope.run_id,
                envelope.project_id,
                envelope.task_id,
                envelope.seq,
                envelope.event_type,
                envelope.occurred_at,
                envelope.source,
                envelope.agent_id,
                envelope.agent_name,
                envelope.schema_version,
                json.dumps(envelope.payload, ensure_ascii=False),
                envelope.synced_at,
                envelope.sync_attempts,
            ),
        )

    def _to_envelope(self, event: TranscriptEvent) -> EventEnvelope:
        return EventEnvelope(
            event_id=str(uuid.uuid4()),
            run_id=self.run_id,
            project_id=self.project_id,
            task_id=event.task_id,
            event_type=event.event_type,
            occurred_at=event.timestamp.isoformat()
            if isinstance(event.timestamp, datetime)
            else str(event.timestamp),
            source=event.source,
            agent_id=event.agent_id,
            agent_name=event.agent_name,
            schema_version=SCHEMA_VERSION,
            payload=event.payload,
        )

    @staticmethod
    def _row_to_compat_dict(row: sqlite3.Row) -> dict[str, Any]:
        """Convert a DB row to the format expected by CAMEL consumers."""
        payload = row["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        return {
            "event_type": row["event_type"],
            "workforce_id": row["run_id"],
            "timestamp": row["occurred_at"],
            "task_id": row["task_id"],
            "agent_id": row["agent_id"],
            "agent_name": row["agent_name"],
            "source": row["source"],
            "payload": payload,
        }

    @staticmethod
    def _row_to_canonical_dict(row: sqlite3.Row) -> dict[str, Any]:
        """Convert a DB row to the full canonical envelope dict."""
        data = dict(row)
        if isinstance(data.get("payload"), str):
            data["payload"] = json.loads(data["payload"])
        return data

    @staticmethod
    def _summarize_runs(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        run_map: dict[str, list[dict[str, Any]]] = {}
        for event in events:
            run_map.setdefault(event["run_id"], []).append(event)

        summaries = [
            SQLiteTranscriptStore._summarize_run(run_events)
            for run_events in run_map.values()
            if run_events
        ]
        return sorted(
            summaries,
            key=lambda item: item["last_event"],
            reverse=True,
        )

    @staticmethod
    def _summarize_run(events: list[dict[str, Any]]) -> dict[str, Any]:
        first_event = events[0]
        last_event = events[-1]
        synced_events = sum(1 for event in events if event["synced_at"])
        total_events = len(events)

        if synced_events == total_events and total_events > 0:
            sync_status = "synced"
        elif synced_events == 0:
            sync_status = "local"
        else:
            sync_status = "pending"

        return {
            "id": f"local:{first_event['run_id']}",
            "run_id": first_event["run_id"],
            "project_id": first_event["project_id"],
            "task_id": first_event["run_id"],
            "event_count": total_events,
            "first_event": first_event["occurred_at"],
            "last_event": last_event["occurred_at"],
            "question": SQLiteTranscriptStore._extract_question(events),
            "summary": SQLiteTranscriptStore._extract_summary(events),
            "status": 2
            if SQLiteTranscriptStore._is_run_complete(events)
            else 1,
            "synced_events": synced_events,
            "sync_status": sync_status,
        }

    @staticmethod
    def _extract_question(events: list[dict[str, Any]]) -> str:
        for event in events:
            payload = event.get("payload")
            if not isinstance(payload, dict):
                continue
            if event["event_type"] == "confirmed":
                question = payload.get("question")
                if question:
                    return question
            if event["event_type"] in {"user_message", "task_created"}:
                question = payload.get("message") or payload.get(
                    "description"
                )
                if question:
                    return question
        return ""

    @staticmethod
    def _extract_summary(events: list[dict[str, Any]]) -> str:
        for event in reversed(events):
            payload = event.get("payload")
            if event["event_type"] == "end":
                if isinstance(payload, str):
                    return SQLiteTranscriptStore._strip_summary_tags(payload)
                if isinstance(payload, dict):
                    summary = (
                        payload.get("summary")
                        or payload.get("task_result")
                        or payload.get("result")
                    )
                    if summary:
                        return SQLiteTranscriptStore._strip_summary_tags(
                            str(summary)
                        )
            if event["event_type"] == "task_completed" and isinstance(
                payload, dict
            ):
                summary = payload.get("result_summary")
                if summary:
                    return str(summary)
            if event["event_type"] == "error" and isinstance(payload, dict):
                message = payload.get("message")
                if message:
                    return str(message)
        return ""

    @staticmethod
    def _is_run_complete(events: list[dict[str, Any]]) -> bool:
        terminal_events = {"end", "error", "all_tasks_completed"}
        return any(event["event_type"] in terminal_events for event in events)

    @staticmethod
    def _strip_summary_tags(value: str) -> str:
        if "<summary>" in value and "</summary>" in value:
            return value.split("<summary>", 1)[1].split("</summary>", 1)[0]
        return value
