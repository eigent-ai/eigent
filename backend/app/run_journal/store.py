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
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from app.run_journal.models import (
    CommandResultEvent,
    CommandResultSyncBatch,
    CommittedRunEvent,
    RemoteCommandInboxRecord,
    RunEventDraft,
    RunEventSyncBatch,
    RunEventSyncOutboxRecord,
    RunRecord,
)
from app.run_journal.paths import default_run_journal_path

SCHEMA_VERSION = 3

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

_MIGRATION_V2 = """
BEGIN IMMEDIATE;

ALTER TABLE run_event_sync_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE run_event_sync_outbox ADD COLUMN lease_until REAL;

DROP INDEX IF EXISTS run_event_sync_pending_idx;
CREATE INDEX run_event_sync_pending_idx
ON run_event_sync_outbox(
    status, next_attempt_at, lease_until, run_id, run_sequence
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (2, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 2;
COMMIT;
"""

_MIGRATION_V3 = """
BEGIN IMMEDIATE;

CREATE TABLE remote_command_inbox (
    command_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    run_id TEXT,
    route_version INTEGER NOT NULL CHECK (route_version > 0),
    command_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    expires_at REAL NOT NULL,
    receipt_grace_until REAL NOT NULL CHECK (receipt_grace_until >= expires_at),
    requires_online_receipt_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (
        requires_online_receipt_confirmation IN (0, 1)
    ),
    receipt_event_id TEXT NOT NULL UNIQUE,
    receipt_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        receipt_status IN ('pending', 'confirmed', 'expired_late')
    ),
    state TEXT NOT NULL DEFAULT 'received' CHECK (
        state IN ('received', 'dispatched', 'accepted', 'rejected', 'completed', 'failed')
    ),
    dispatch_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempt_count >= 0),
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX remote_command_inbox_dispatch_idx
ON remote_command_inbox(state, updated_at, command_id);

CREATE TABLE command_result_events (
    event_id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL REFERENCES remote_command_inbox(command_id) ON DELETE CASCADE,
    command_event_sequence INTEGER NOT NULL CHECK (command_event_sequence > 0),
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at REAL NOT NULL,
    UNIQUE(command_id, command_event_sequence)
);

CREATE INDEX command_result_events_replay_idx
ON command_result_events(command_id, command_event_sequence);

CREATE TABLE command_result_outbox (
    event_id TEXT PRIMARY KEY REFERENCES command_result_events(event_id) ON DELETE CASCADE,
    command_id TEXT NOT NULL,
    command_event_sequence INTEGER NOT NULL CHECK (command_event_sequence > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'sending', 'sent', 'dead_letter')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at REAL NOT NULL,
    lease_token TEXT,
    lease_until REAL,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(command_id, command_event_sequence)
);

CREATE INDEX command_result_outbox_pending_idx
ON command_result_outbox(
    status, next_attempt_at, lease_until, command_id, command_event_sequence
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (3, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 3;
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


class OutboxLeaseLostError(RunJournalError):
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

    def persist_remote_command(
        self,
        *,
        command_id: str,
        session_id: str,
        user_id: int,
        project_id: str,
        run_id: str | None,
        route_version: int,
        command_type: str,
        payload: dict[str, Any],
        expires_at: float,
        receipt_grace_until: float,
        requires_online_receipt_confirmation: bool,
        receipt_event_id: str | None = None,
        now: float | None = None,
    ) -> RemoteCommandInboxRecord:
        """Commit the Inbox row and receipt event/outbox in one transaction."""

        if route_version < 1:
            raise ValueError("route_version must be positive")
        if receipt_grace_until < expires_at:
            raise ValueError("receipt grace must not precede expiry")
        timestamp = now if now is not None else time.time()
        receipt_id = receipt_event_id or str(uuid.uuid4())
        payload_json = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            if existing is not None:
                canonical = (
                    existing["session_id"] == session_id
                    and int(existing["user_id"]) == user_id
                    and existing["project_id"] == project_id
                    and existing["run_id"] == run_id
                    and int(existing["route_version"]) == route_version
                    and existing["command_type"] == command_type
                    and existing["payload_json"] == payload_json
                    and float(existing["expires_at"]) == expires_at
                    and float(existing["receipt_grace_until"])
                    == receipt_grace_until
                    and bool(existing["requires_online_receipt_confirmation"])
                    == requires_online_receipt_confirmation
                )
                if not canonical:
                    raise IdempotencyConflictError(
                        f"command_id {command_id!r} was reused with different data"
                    )
                return self._command_from_row(existing)

            connection.execute(
                """
                INSERT INTO remote_command_inbox(
                    command_id, session_id, user_id, project_id, run_id,
                    route_version, command_type, payload_json, expires_at,
                    receipt_grace_until,
                    requires_online_receipt_confirmation, receipt_event_id,
                    receipt_status, state, dispatch_attempt_count, last_error,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                          'pending', 'received', 0, NULL, ?, ?)
                """,
                (
                    command_id,
                    session_id,
                    user_id,
                    project_id,
                    run_id,
                    route_version,
                    command_type,
                    payload_json,
                    expires_at,
                    receipt_grace_until,
                    int(requires_online_receipt_confirmation),
                    receipt_id,
                    timestamp,
                    timestamp,
                ),
            )
            receipt_payload = "{}"
            connection.execute(
                """
                INSERT INTO command_result_events(
                    event_id, command_id, command_event_sequence, event_type,
                    payload_json, occurred_at
                ) VALUES (?, ?, 1, 'receipt.durably_received', ?, ?)
                """,
                (receipt_id, command_id, receipt_payload, timestamp),
            )
            connection.execute(
                """
                INSERT INTO command_result_outbox(
                    event_id, command_id, command_event_sequence, status,
                    attempt_count, next_attempt_at, lease_token, lease_until,
                    last_error, created_at, updated_at
                ) VALUES (?, ?, 1, 'pending', 0, ?, NULL, NULL, NULL, ?, ?)
                """,
                (receipt_id, command_id, timestamp, timestamp, timestamp),
            )
            row = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            assert row is not None
            return self._command_from_row(row)

    def get_remote_command(
        self, command_id: str
    ) -> RemoteCommandInboxRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            return self._command_from_row(row) if row is not None else None

    def list_reconcilable_commands(
        self, *, limit: int = 100
    ) -> list[RemoteCommandInboxRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM remote_command_inbox
                WHERE state IN ('received', 'dispatched', 'accepted')
                ORDER BY updated_at, command_id
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [self._command_from_row(row) for row in rows]

    def mark_command_dispatched(
        self, command_id: str, *, now: float | None = None
    ) -> RemoteCommandInboxRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE remote_command_inbox
                SET state = 'dispatched',
                    dispatch_attempt_count = dispatch_attempt_count + 1,
                    updated_at = ?
                WHERE command_id = ? AND state IN ('received', 'dispatched')
                """,
                (timestamp, command_id),
            )
            if updated.rowcount != 1:
                row = connection.execute(
                    "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                    (command_id,),
                ).fetchone()
                if row is None:
                    raise RunNotFoundError(
                        f"command_id {command_id!r} does not exist"
                    )
                return self._command_from_row(row)
            row = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            assert row is not None
            return self._command_from_row(row)

    def set_command_receipt_status(
        self,
        command_id: str,
        status: str,
        *,
        error: str | None = None,
        now: float | None = None,
    ) -> RemoteCommandInboxRecord:
        if status not in {"confirmed", "expired_late"}:
            raise ValueError("invalid command receipt status")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE remote_command_inbox
                SET receipt_status = ?, last_error = ?, updated_at = ?
                WHERE command_id = ?
                """,
                (status, error, timestamp, command_id),
            )
            if updated.rowcount != 1:
                raise RunNotFoundError(
                    f"command_id {command_id!r} does not exist"
                )
            row = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            assert row is not None
            return self._command_from_row(row)

    def append_command_result(
        self,
        command_id: str,
        *,
        event_type: str,
        payload: dict[str, Any] | None = None,
        event_id: str | None = None,
        occurred_at: float | None = None,
    ) -> CommandResultEvent:
        state_by_event = {
            "admission.accepted": "accepted",
            "admission.rejected": "rejected",
            "execution.completed": "completed",
            "execution.failed": "failed",
        }
        if (
            event_type not in state_by_event
            and event_type != "execution.started"
        ):
            raise ValueError("unsupported command result event type")
        timestamp = occurred_at if occurred_at is not None else time.time()
        result_event_id = event_id or str(uuid.uuid4())
        payload_value = payload or {}
        payload_json = json.dumps(
            payload_value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        with self._write_transaction() as connection:
            duplicate = connection.execute(
                "SELECT * FROM command_result_events WHERE event_id = ?",
                (result_event_id,),
            ).fetchone()
            if duplicate is not None:
                if (
                    duplicate["command_id"] != command_id
                    or duplicate["event_type"] != event_type
                    or duplicate["payload_json"] != payload_json
                ):
                    raise IdempotencyConflictError(
                        f"command event {result_event_id!r} was reused"
                    )
                return self._command_event_from_row(duplicate)
            inbox = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            if inbox is None:
                raise RunNotFoundError(
                    f"command_id {command_id!r} does not exist"
                )
            sequence = int(
                connection.execute(
                    """
                    SELECT COALESCE(MAX(command_event_sequence), 0) + 1
                    FROM command_result_events WHERE command_id = ?
                    """,
                    (command_id,),
                ).fetchone()[0]
            )
            connection.execute(
                """
                INSERT INTO command_result_events(
                    event_id, command_id, command_event_sequence, event_type,
                    payload_json, occurred_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    result_event_id,
                    command_id,
                    sequence,
                    event_type,
                    payload_json,
                    timestamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO command_result_outbox(
                    event_id, command_id, command_event_sequence, status,
                    attempt_count, next_attempt_at, lease_token, lease_until,
                    last_error, created_at, updated_at
                ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?)
                """,
                (
                    result_event_id,
                    command_id,
                    sequence,
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )
            next_state = state_by_event.get(event_type)
            if next_state is not None:
                connection.execute(
                    """
                    UPDATE remote_command_inbox
                    SET state = ?, last_error = ?, updated_at = ?
                    WHERE command_id = ?
                    """,
                    (
                        next_state,
                        payload_value.get("error"),
                        timestamp,
                        command_id,
                    ),
                )
            return CommandResultEvent(
                event_id=result_event_id,
                command_id=command_id,
                command_event_sequence=sequence,
                event_type=event_type,
                payload=payload_value,
                occurred_at=timestamp,
            )

    def claim_command_result_batches(
        self,
        *,
        now: float | None = None,
        max_commands: int = 8,
        batch_size: int = 100,
        lease_seconds: float = 30.0,
    ) -> list[CommandResultSyncBatch]:
        if max_commands < 1 or batch_size < 1 or lease_seconds <= 0:
            raise ValueError("command outbox claim limits must be positive")
        timestamp = now if now is not None else time.time()
        batches: list[CommandResultSyncBatch] = []
        with self._write_transaction() as connection:
            connection.execute(
                """
                UPDATE command_result_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE status = 'sending'
                  AND (lease_until IS NULL OR lease_until <= ?)
                """,
                (timestamp, timestamp),
            )
            candidates = connection.execute(
                """
                SELECT command_id, MIN(command_event_sequence) AS head_sequence
                FROM command_result_outbox
                WHERE status != 'sent'
                GROUP BY command_id
                HAVING SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) = 0
                   AND MIN(CASE WHEN status = 'pending' THEN next_attempt_at END) <= ?
                ORDER BY MIN(updated_at), command_id
                LIMIT ?
                """,
                (timestamp, max_commands),
            ).fetchall()
            for candidate in candidates:
                rows = connection.execute(
                    """
                    SELECT e.*, o.status, o.attempt_count, o.next_attempt_at
                    FROM command_result_outbox AS o
                    JOIN command_result_events AS e ON e.event_id = o.event_id
                    WHERE o.command_id = ? AND o.command_event_sequence >= ?
                      AND o.status != 'sent'
                    ORDER BY o.command_event_sequence
                    LIMIT ?
                    """,
                    (
                        candidate["command_id"],
                        candidate["head_sequence"],
                        batch_size,
                    ),
                ).fetchall()
                ready: list[sqlite3.Row] = []
                expected = int(candidate["head_sequence"])
                for row in rows:
                    if (
                        int(row["command_event_sequence"]) != expected
                        or row["status"] != "pending"
                        or float(row["next_attempt_at"]) > timestamp
                    ):
                        break
                    ready.append(row)
                    expected += 1
                if not ready:
                    continue
                token = uuid.uuid4().hex
                event_ids = [row["event_id"] for row in ready]
                placeholders = ",".join("?" for _ in event_ids)
                updated = connection.execute(
                    f"""
                    UPDATE command_result_outbox
                    SET status = 'sending', lease_token = ?, lease_until = ?,
                        updated_at = ?
                    WHERE status = 'pending' AND event_id IN ({placeholders})
                    """,
                    (
                        token,
                        timestamp + lease_seconds,
                        timestamp,
                        *event_ids,
                    ),
                )
                if updated.rowcount != len(event_ids):
                    raise OutboxLeaseLostError(
                        f"failed to lease command lane {candidate['command_id']!r}"
                    )
                batches.append(
                    CommandResultSyncBatch(
                        command_id=candidate["command_id"],
                        lease_token=token,
                        attempt_count=int(ready[0]["attempt_count"]),
                        events=tuple(
                            self._command_event_from_row(row) for row in ready
                        ),
                    )
                )
        return batches

    def mark_command_result_batch_sent(
        self,
        batch: CommandResultSyncBatch,
        *,
        now: float | None = None,
    ) -> None:
        self._finish_command_result_batch(batch, "sent", now=now)

    def retry_command_result_batch(
        self,
        batch: CommandResultSyncBatch,
        *,
        error: str,
        next_attempt_at: float,
        now: float | None = None,
    ) -> None:
        self._finish_command_result_batch(
            batch,
            "pending",
            error=error,
            next_attempt_at=next_attempt_at,
            increment_attempt=True,
            now=now,
        )

    def block_command_result_batch(
        self,
        batch: CommandResultSyncBatch,
        *,
        failed_event_id: str,
        error: str,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        if failed_event_id not in event_ids:
            raise ValueError("failed event must belong to command batch")
        with self._write_transaction() as connection:
            self._assert_command_batch_lease(connection, batch, event_ids)
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE command_result_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (timestamp, *event_ids),
            )
            connection.execute(
                """
                UPDATE command_result_outbox
                SET status = 'dead_letter', attempt_count = attempt_count + 1,
                    last_error = ?, updated_at = ?
                WHERE event_id = ?
                """,
                (error[:4000], timestamp, failed_event_id),
            )

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

    def claim_ready_outbox_batches(
        self,
        *,
        now: float | None = None,
        max_runs: int = 4,
        batch_size: int = 100,
        lease_seconds: float = 30.0,
    ) -> list[RunEventSyncBatch]:
        """Lease one consecutive FIFO batch from each ready Run.

        A dead-letter row remains the earliest non-sent row and therefore blocks
        only its own Run. Expired ``sending`` rows are reclaimed after a crash.
        """

        if max_runs < 1 or batch_size < 1 or lease_seconds <= 0:
            raise ValueError("outbox claim limits and lease must be positive")
        timestamp = now if now is not None else time.time()
        lease_until = timestamp + lease_seconds
        batches: list[RunEventSyncBatch] = []
        with self._write_transaction() as connection:
            connection.execute(
                """
                UPDATE run_event_sync_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE status = 'sending'
                  AND (lease_until IS NULL OR lease_until <= ?)
                """,
                (timestamp, timestamp),
            )
            candidates = connection.execute(
                """
                SELECT o.run_id, r.project_id, o.run_sequence
                FROM run_event_sync_outbox AS o
                JOIN runs AS r ON r.run_id = o.run_id
                WHERE o.status = 'pending'
                  AND o.next_attempt_at <= ?
                  AND o.run_sequence = (
                      SELECT MIN(head.run_sequence)
                      FROM run_event_sync_outbox AS head
                      WHERE head.run_id = o.run_id
                        AND head.status != 'sent'
                  )
                ORDER BY o.updated_at, o.run_id
                LIMIT ?
                """,
                (timestamp, max_runs),
            ).fetchall()
            for candidate in candidates:
                rows = connection.execute(
                    """
                    SELECT e.event_id, e.run_id, e.sequence, e.run_version,
                           e.event_type, e.payload_json, e.legacy_step,
                           e.created_at, o.status, o.attempt_count,
                           o.next_attempt_at
                    FROM run_event_sync_outbox AS o
                    JOIN run_events AS e ON e.event_id = o.event_id
                    WHERE o.run_id = ? AND o.run_sequence >= ?
                      AND o.status != 'sent'
                    ORDER BY o.run_sequence
                    LIMIT ?
                    """,
                    (
                        candidate["run_id"],
                        candidate["run_sequence"],
                        batch_size,
                    ),
                ).fetchall()
                ready: list[sqlite3.Row] = []
                expected = int(candidate["run_sequence"])
                for row in rows:
                    if (
                        int(row["sequence"]) != expected
                        or row["status"] != "pending"
                        or float(row["next_attempt_at"]) > timestamp
                    ):
                        break
                    ready.append(row)
                    expected += 1
                if not ready:
                    continue
                lease_token = uuid.uuid4().hex
                event_ids = [row["event_id"] for row in ready]
                placeholders = ",".join("?" for _ in event_ids)
                claimed = connection.execute(
                    f"""
                    UPDATE run_event_sync_outbox
                    SET status = 'sending', lease_token = ?, lease_until = ?,
                        updated_at = ?
                    WHERE status = 'pending' AND event_id IN ({placeholders})
                    """,
                    (lease_token, lease_until, timestamp, *event_ids),
                )
                if claimed.rowcount != len(event_ids):
                    raise OutboxLeaseLostError(
                        f"failed to lease all events for {candidate['run_id']!r}"
                    )
                batches.append(
                    RunEventSyncBatch(
                        project_id=candidate["project_id"],
                        run_id=candidate["run_id"],
                        lease_token=lease_token,
                        attempt_count=int(ready[0]["attempt_count"]),
                        events=tuple(
                            self._event_from_row(row) for row in ready
                        ),
                    )
                )
        return batches

    def mark_outbox_batch_sent(
        self,
        batch: RunEventSyncBatch,
        *,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        with self._write_transaction() as connection:
            self._assert_batch_lease(connection, batch, event_ids)
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE run_event_sync_outbox
                SET status = 'sent', lease_token = NULL, lease_until = NULL,
                    last_error = NULL, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (timestamp, *event_ids),
            )

    def retry_outbox_batch(
        self,
        batch: RunEventSyncBatch,
        *,
        error: str,
        next_attempt_at: float,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        with self._write_transaction() as connection:
            self._assert_batch_lease(connection, batch, event_ids)
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE run_event_sync_outbox
                SET status = 'pending', attempt_count = attempt_count + 1,
                    next_attempt_at = ?, last_error = ?, lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (next_attempt_at, error[:4000], timestamp, *event_ids),
            )

    def block_outbox_batch(
        self,
        batch: RunEventSyncBatch,
        *,
        failed_event_id: str,
        error: str,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        if failed_event_id not in event_ids:
            raise ValueError("failed event must belong to the leased batch")
        with self._write_transaction() as connection:
            self._assert_batch_lease(connection, batch, event_ids)
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE run_event_sync_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (timestamp, *event_ids),
            )
            connection.execute(
                """
                UPDATE run_event_sync_outbox
                SET status = 'dead_letter', attempt_count = attempt_count + 1,
                    last_error = ?, updated_at = ?
                WHERE event_id = ?
                """,
                (error[:4000], timestamp, failed_event_id),
            )

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
        if version < 2:
            self._connection.executescript(_MIGRATION_V2)
        if version < 3:
            self._connection.executescript(_MIGRATION_V3)

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
    def _assert_batch_lease(
        connection: sqlite3.Connection,
        batch: RunEventSyncBatch,
        event_ids: list[str],
    ) -> None:
        if not event_ids:
            raise ValueError("outbox batch must contain events")
        placeholders = ",".join("?" for _ in event_ids)
        count = int(
            connection.execute(
                f"""
                SELECT COUNT(*)
                FROM run_event_sync_outbox
                WHERE status = 'sending' AND lease_token = ?
                  AND event_id IN ({placeholders})
                """,
                (batch.lease_token, *event_ids),
            ).fetchone()[0]
        )
        if count != len(event_ids):
            raise OutboxLeaseLostError(
                f"outbox lease for {batch.run_id!r} is stale"
            )

    @staticmethod
    def _assert_command_batch_lease(
        connection: sqlite3.Connection,
        batch: CommandResultSyncBatch,
        event_ids: list[str],
    ) -> None:
        placeholders = ",".join("?" for _ in event_ids)
        count = int(
            connection.execute(
                f"""
                SELECT COUNT(*) FROM command_result_outbox
                WHERE status = 'sending' AND lease_token = ?
                  AND event_id IN ({placeholders})
                """,
                (batch.lease_token, *event_ids),
            ).fetchone()[0]
        )
        if count != len(event_ids):
            raise OutboxLeaseLostError(
                f"command outbox lease for {batch.command_id!r} is stale"
            )

    def _finish_command_result_batch(
        self,
        batch: CommandResultSyncBatch,
        status: str,
        *,
        error: str | None = None,
        next_attempt_at: float | None = None,
        increment_attempt: bool = False,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        with self._write_transaction() as connection:
            self._assert_command_batch_lease(connection, batch, event_ids)
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE command_result_outbox
                SET status = ?,
                    attempt_count = attempt_count + ?,
                    next_attempt_at = COALESCE(?, next_attempt_at),
                    lease_token = NULL, lease_until = NULL,
                    last_error = ?, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (
                    status,
                    int(increment_attempt),
                    next_attempt_at,
                    error[:4000] if error else None,
                    timestamp,
                    *event_ids,
                ),
            )

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
    def _command_from_row(row: sqlite3.Row) -> RemoteCommandInboxRecord:
        return RemoteCommandInboxRecord(
            command_id=row["command_id"],
            session_id=row["session_id"],
            user_id=int(row["user_id"]),
            project_id=row["project_id"],
            run_id=row["run_id"],
            route_version=int(row["route_version"]),
            command_type=row["command_type"],
            payload=json.loads(row["payload_json"]),
            expires_at=float(row["expires_at"]),
            receipt_grace_until=float(row["receipt_grace_until"]),
            requires_online_receipt_confirmation=bool(
                row["requires_online_receipt_confirmation"]
            ),
            receipt_event_id=row["receipt_event_id"],
            receipt_status=row["receipt_status"],
            state=row["state"],
            dispatch_attempt_count=int(row["dispatch_attempt_count"]),
            last_error=row["last_error"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _command_event_from_row(row: sqlite3.Row) -> CommandResultEvent:
        return CommandResultEvent(
            event_id=row["event_id"],
            command_id=row["command_id"],
            command_event_sequence=int(row["command_event_sequence"]),
            event_type=row["event_type"],
            payload=json.loads(row["payload_json"]),
            occurred_at=float(row["occurred_at"]),
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
            lease_token=row["lease_token"],
            lease_until=(
                float(row["lease_until"])
                if row["lease_until"] is not None
                else None
            ),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )
