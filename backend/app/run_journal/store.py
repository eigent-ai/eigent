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

"""SQLite implementation of the Desktop-owned RunJournal.

The store owns one connection and serializes every transaction with a process
lock. SQLite still provides the durable cross-process writer lock; the local
lock makes the intended single-writer boundary explicit when async callers use
``asyncio.to_thread``.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from app.run_journal.models import (
    CommittedRunEvent,
    RunEventDraft,
    RunEventSyncOutboxRecord,
    RunRecord,
)
from app.run_journal.paths import default_run_journal_path

SCHEMA_VERSION = 1

_MIGRATION_V1 = """
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS run_journal_migrations (
    version INTEGER PRIMARY KEY,
    applied_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN (
            'pending', 'running', 'waiting_for_user', 'interrupted',
            'completed', 'failed', 'cancelled'
        )
    ),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    active_attempt_id TEXT,
    deadline_at REAL,
    timeout_policy_version TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS runs_project_updated_idx
ON runs(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS run_attempts (
    attempt_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    status TEXT NOT NULL,
    started_at REAL NOT NULL,
    ended_at REAL,
    outcome TEXT,
    timeout_reason TEXT,
    UNIQUE(run_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS run_events (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    run_version INTEGER NOT NULL CHECK (run_version > 0),
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    legacy_step TEXT,
    created_at REAL NOT NULL,
    UNIQUE(run_id, sequence)
);

CREATE INDEX IF NOT EXISTS run_events_replay_idx
ON run_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS run_event_sync_outbox (
    event_id TEXT PRIMARY KEY REFERENCES run_events(event_id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    run_sequence INTEGER NOT NULL CHECK (run_sequence > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'sending', 'sent', 'dead_letter')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at REAL NOT NULL,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(run_id, run_sequence)
);

CREATE INDEX IF NOT EXISTS run_event_sync_pending_idx
ON run_event_sync_outbox(status, next_attempt_at, run_id, run_sequence);

CREATE TABLE IF NOT EXISTS tool_calls (
    tool_call_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_id TEXT REFERENCES run_attempts(attempt_id) ON DELETE SET NULL,
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL,
    safety_class TEXT NOT NULL,
    idempotency_key TEXT,
    outcome TEXT,
    timeout_reason TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS tool_calls_run_idx
ON tool_calls(run_id, created_at);

CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_id TEXT REFERENCES run_attempts(attempt_id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    prompt_json TEXT NOT NULL,
    decision_json TEXT,
    created_at REAL NOT NULL,
    resolved_at REAL
);

CREATE INDEX IF NOT EXISTS approvals_run_idx
ON approvals(run_id, created_at);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (1, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 1;
COMMIT;
"""


class RunJournalError(RuntimeError):
    """Base error for local RunJournal operations."""


class RunNotFoundError(RunJournalError):
    pass


class OptimisticConcurrencyError(RunJournalError):
    pass


class IdempotencyConflictError(RunJournalError):
    pass


class UnsupportedSchemaVersionError(RunJournalError):
    pass


class SQLiteRunJournal:
    """Short-transaction SQLite store for Desktop-owned Run facts."""

    def __init__(
        self,
        path: Path | None = None,
        *,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self.path = path or default_run_journal_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(
            str(self.path),
            timeout=busy_timeout_ms / 1000,
            isolation_level=None,
            check_same_thread=False,
        )
        self._connection.row_factory = sqlite3.Row
        with self._lock:
            self._connection.execute("PRAGMA foreign_keys = ON")
            self._connection.execute(
                f"PRAGMA busy_timeout = {busy_timeout_ms}"
            )
            self._connection.execute("PRAGMA journal_mode = WAL")
            self._connection.execute("PRAGMA synchronous = FULL")
            self._migrate()

    def __enter__(self) -> SQLiteRunJournal:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    @property
    def schema_version(self) -> int:
        with self._lock:
            row = self._connection.execute("PRAGMA user_version").fetchone()
            return int(row[0])

    def database_settings(self) -> dict[str, Any]:
        with self._lock:
            return {
                "journal_mode": self._connection.execute(
                    "PRAGMA journal_mode"
                ).fetchone()[0],
                "foreign_keys": self._connection.execute(
                    "PRAGMA foreign_keys"
                ).fetchone()[0],
                "busy_timeout": self._connection.execute(
                    "PRAGMA busy_timeout"
                ).fetchone()[0],
                "synchronous": self._connection.execute(
                    "PRAGMA synchronous"
                ).fetchone()[0],
            }

    def ensure_run(
        self,
        *,
        run_id: str,
        project_id: str,
        status: str = "running",
        timeout_policy_version: str = "v1",
        deadline_at: float | None = None,
        now: float | None = None,
    ) -> RunRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO runs(
                    run_id, project_id, status, version, active_attempt_id,
                    deadline_at, timeout_policy_version, created_at, updated_at
                ) VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    project_id,
                    status,
                    deadline_at,
                    timeout_policy_version,
                    timestamp,
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert row is not None
            if row["project_id"] != project_id:
                raise IdempotencyConflictError(
                    f"run_id {run_id!r} already belongs to another project"
                )
            return self._run_from_row(row)

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            return self._run_from_row(row) if row is not None else None

    def append_event(
        self,
        run_id: str,
        draft: RunEventDraft,
        *,
        expected_version: int | None = None,
        expected_project_id: str | None = None,
    ) -> CommittedRunEvent:
        payload_json = json.dumps(
            dict(draft.payload),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )

        with self._write_transaction() as connection:
            duplicate = connection.execute(
                "SELECT * FROM run_events WHERE event_id = ?",
                (draft.event_id,),
            ).fetchone()
            if duplicate is not None:
                if expected_project_id is not None:
                    owner = connection.execute(
                        "SELECT project_id FROM runs WHERE run_id = ?",
                        (duplicate["run_id"],),
                    ).fetchone()
                    if (
                        owner is not None
                        and owner["project_id"] != expected_project_id
                    ):
                        raise IdempotencyConflictError(
                            f"event_id {draft.event_id!r} belongs to project "
                            f"{owner['project_id']!r}, not "
                            f"{expected_project_id!r}"
                        )
                return self._resolve_duplicate_event(
                    connection,
                    duplicate,
                    run_id=run_id,
                    draft=draft,
                    payload_json=payload_json,
                )

            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if (
                expected_project_id is not None
                and run["project_id"] != expected_project_id
            ):
                raise IdempotencyConflictError(
                    f"run_id {run_id!r} belongs to project "
                    f"{run['project_id']!r}, not {expected_project_id!r}"
                )

            current_version = int(run["version"])
            if (
                expected_version is not None
                and expected_version != current_version
            ):
                raise OptimisticConcurrencyError(
                    f"run_id {run_id!r} expected version "
                    f"{expected_version}, found {current_version}"
                )

            sequence = int(
                connection.execute(
                    """
                    SELECT COALESCE(MAX(sequence), 0) + 1
                    FROM run_events
                    WHERE run_id = ?
                    """,
                    (run_id,),
                ).fetchone()[0]
            )
            connection.execute(
                """
                INSERT INTO run_events(
                    event_id, run_id, sequence, run_version, event_type,
                    payload_json, legacy_step, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    draft.event_id,
                    run_id,
                    sequence,
                    current_version + 1,
                    draft.event_type,
                    payload_json,
                    draft.legacy_step,
                    draft.created_at,
                ),
            )
            connection.execute(
                """
                INSERT INTO run_event_sync_outbox(
                    event_id, run_id, run_sequence, status, attempt_count,
                    next_attempt_at, last_error, created_at, updated_at
                ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?, ?)
                """,
                (
                    draft.event_id,
                    run_id,
                    sequence,
                    draft.created_at,
                    draft.created_at,
                    draft.created_at,
                ),
            )
            updated = connection.execute(
                """
                UPDATE runs
                SET version = version + 1, updated_at = ?
                WHERE run_id = ? AND version = ?
                """,
                (draft.created_at, run_id, current_version),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    f"run_id {run_id!r} changed while appending event"
                )

            return CommittedRunEvent(
                event_id=draft.event_id,
                run_id=run_id,
                sequence=sequence,
                event_type=draft.event_type,
                payload=dict(draft.payload),
                legacy_step=draft.legacy_step,
                created_at=draft.created_at,
                run_version=current_version + 1,
            )

    def list_events(
        self,
        run_id: str,
        *,
        after_sequence: int = 0,
        limit: int | None = None,
    ) -> list[CommittedRunEvent]:
        if limit is not None and limit < 1:
            raise ValueError("event query limit must be positive")
        query = """
            SELECT event_id, run_id, sequence, run_version, event_type,
                   payload_json, legacy_step, created_at
            FROM run_events
            WHERE run_id = ? AND sequence > ?
            ORDER BY sequence
        """
        parameters: list[Any] = [run_id, after_sequence]
        if limit is not None:
            query += " LIMIT ?"
            parameters.append(limit)
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._event_from_row(row) for row in rows]

    def list_pending_outbox(
        self, *, now: float | None = None, limit: int = 100
    ) -> list[RunEventSyncOutboxRecord]:
        timestamp = now if now is not None else time.time()
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT *
                FROM run_event_sync_outbox
                WHERE status = 'pending' AND next_attempt_at <= ?
                ORDER BY run_id, run_sequence
                LIMIT ?
                """,
                (timestamp, limit),
            ).fetchall()
            return [self._outbox_from_row(row) for row in rows]

    def _migrate(self) -> None:
        version = int(
            self._connection.execute("PRAGMA user_version").fetchone()[0]
        )
        if version > SCHEMA_VERSION:
            raise UnsupportedSchemaVersionError(
                f"RunJournal schema {version} is newer than supported "
                f"version {SCHEMA_VERSION}"
            )
        if version < 1:
            self._connection.executescript(_MIGRATION_V1)

    @contextmanager
    def _write_transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                yield self._connection
            except BaseException:
                self._connection.rollback()
                raise
            else:
                self._connection.commit()

    def _resolve_duplicate_event(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        *,
        run_id: str,
        draft: RunEventDraft,
        payload_json: str,
    ) -> CommittedRunEvent:
        if (
            row["run_id"] != run_id
            or row["event_type"] != draft.event_type
            or row["payload_json"] != payload_json
            or row["legacy_step"] != draft.legacy_step
        ):
            raise IdempotencyConflictError(
                f"event_id {draft.event_id!r} was reused with different data"
            )
        return self._event_from_row(row)

    @staticmethod
    def _run_from_row(row: sqlite3.Row) -> RunRecord:
        return RunRecord(
            run_id=row["run_id"],
            project_id=row["project_id"],
            status=row["status"],
            version=int(row["version"]),
            active_attempt_id=row["active_attempt_id"],
            deadline_at=row["deadline_at"],
            timeout_policy_version=row["timeout_policy_version"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _event_from_row(row: sqlite3.Row) -> CommittedRunEvent:
        return CommittedRunEvent(
            event_id=row["event_id"],
            run_id=row["run_id"],
            sequence=int(row["sequence"]),
            event_type=row["event_type"],
            payload=json.loads(row["payload_json"]),
            legacy_step=row["legacy_step"],
            created_at=float(row["created_at"]),
            run_version=int(row["run_version"]),
        )

    @staticmethod
    def _outbox_from_row(row: sqlite3.Row) -> RunEventSyncOutboxRecord:
        return RunEventSyncOutboxRecord(
            event_id=row["event_id"],
            run_id=row["run_id"],
            run_sequence=int(row["run_sequence"]),
            status=row["status"],
            attempt_count=int(row["attempt_count"]),
            next_attempt_at=float(row["next_attempt_at"]),
            last_error=row["last_error"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )
