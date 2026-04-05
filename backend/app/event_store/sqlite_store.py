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

    def __init__(
        self,
        path: str | Path,
        run_id: str,
        project_id: str,
    ) -> None:
        self.path = Path(path)
        self.run_id = run_id
        self.project_id = project_id
        self._lock = threading.Lock()

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
        with self._conn:
            self._conn.execute(CREATE_EVENT_LOG_TABLE)
            for idx_ddl in CREATE_INDEXES:
                self._conn.execute(idx_ddl)

    # ------------------------------------------------------------------
    # TranscriptStore-compatible interface
    # ------------------------------------------------------------------

    def append(self, event: TranscriptEvent) -> dict[str, Any]:
        """Persist a CAMEL ``TranscriptEvent`` as a canonical event row.

        Returns the same dict shape as the JSONL ``TranscriptStore.append``
        for backward compatibility.
        """
        envelope = self._to_envelope(event)

        with self._lock:
            with self._conn:
                seq = self._next_seq(self._conn)
                envelope.seq = seq
                self._conn.execute(
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

        return event.to_dict()

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
        with self._lock:
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
        with self._lock:
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

            if project_id:
                rows = conn.execute(
                    """\
                    SELECT run_id, project_id,
                           MIN(task_id) AS task_id,
                           COUNT(*) AS event_count,
                           MIN(occurred_at) AS first_event,
                           MAX(occurred_at) AS last_event
                    FROM event_log
                    WHERE project_id = ?
                    GROUP BY run_id
                    ORDER BY MAX(occurred_at) DESC
                    """,
                    (project_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """\
                    SELECT run_id, project_id,
                           MIN(task_id) AS task_id,
                           COUNT(*) AS event_count,
                           MIN(occurred_at) AS first_event,
                           MAX(occurred_at) AS last_event
                    FROM event_log
                    GROUP BY run_id
                    ORDER BY MAX(occurred_at) DESC
                    """,
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def query_projects(db_path: str | Path) -> list[dict[str, Any]]:
        """List projects with aggregated stats. Used by the local API."""
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
                SELECT project_id,
                       COUNT(DISTINCT run_id) AS run_count,
                       COUNT(*) AS event_count,
                       MIN(occurred_at) AS first_event,
                       MAX(occurred_at) AS last_event
                FROM event_log
                GROUP BY project_id
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
        row = conn.execute(
            "SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq "
            "FROM event_log WHERE run_id = ?",
            (self.run_id,),
        ).fetchone()
        return row["next_seq"]

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
