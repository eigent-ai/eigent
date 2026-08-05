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
import logging
import sqlite3
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from app.run_journal.models import (
    ApprovalRecord,
    CommandResultEvent,
    CommandResultSyncBatch,
    CommittedRunEvent,
    RemoteCommandInboxRecord,
    RunAttemptRecord,
    RunEventDraft,
    RunEventSyncBatch,
    RunEventSyncOutboxRecord,
    RunRecord,
    StartupReconciliationResult,
    ToolCallRecord,
)
from app.run_journal.paths import default_run_journal_path
from app.run_journal.transitions import (
    ATTEMPT_ACTIVE_STATES,
    ATTEMPT_TRANSITIONS,
    COMMAND_TRANSITIONS,
    RUN_TRANSITIONS,
    TOOL_TRANSITIONS,
    transition_allowed,
)
from app.run_policy import (
    RunTimeoutPolicy,
    TimeoutOutcome,
    TimeoutScope,
    ToolSafetyClass,
    automatic_tool_replay_allowed,
)

SCHEMA_VERSION = 4
logger = logging.getLogger("run_journal")

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

_MIGRATION_V4 = """
BEGIN IMMEDIATE;

ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(run_id);
ALTER TABLE runs ADD COLUMN timeout_policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE runs ADD COLUMN cancel_request_id TEXT;
ALTER TABLE runs ADD COLUMN cancel_requested_at REAL;

ALTER TABLE run_attempts ADD COLUMN resume_request_id TEXT;
ALTER TABLE run_attempts ADD COLUMN resume_reason TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE run_attempts ADD COLUMN policy_version TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE run_attempts ADD COLUMN elapsed_active_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_attempts ADD COLUMN last_consumer_heartbeat_at REAL;

CREATE UNIQUE INDEX run_attempts_resume_request_idx
ON run_attempts(run_id, resume_request_id)
WHERE resume_request_id IS NOT NULL;

ALTER TABLE tool_calls ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tool_calls ADD COLUMN result_json TEXT;
ALTER TABLE tool_calls ADD COLUMN prepared_at REAL;
ALTER TABLE tool_calls ADD COLUMN dispatched_at REAL;
ALTER TABLE tool_calls ADD COLUMN completed_at REAL;

ALTER TABLE approvals ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE approvals ADD COLUMN expires_at REAL;
ALTER TABLE approvals ADD COLUMN expiry_action TEXT NOT NULL DEFAULT 'keep_pending';

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (4, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 4;
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


class InvalidRunTransitionError(RunJournalError):
    pass


class UnsafeResumeError(RunJournalError):
    def __init__(self, tool_call_ids: list[str]) -> None:
        self.tool_call_ids = tuple(tool_call_ids)
        super().__init__(
            "resume is blocked by unresolved external side effects: "
            + ", ".join(tool_call_ids)
        )


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
            terminal_status = self._terminal_status_for_event(draft)
            event = self._append_event_in_transaction(
                connection,
                run_id,
                draft,
                payload_json=payload_json,
                expected_version=expected_version,
                expected_project_id=expected_project_id,
                run_status=terminal_status,
                clear_active_attempt=terminal_status is not None,
            )
            if terminal_status is not None:
                attempt_status = (
                    "completed"
                    if terminal_status == "completed"
                    else terminal_status
                )
                connection.execute(
                    """
                    UPDATE run_attempts
                    SET status = ?, ended_at = COALESCE(ended_at, ?),
                        outcome = COALESCE(outcome, ?)
                    WHERE run_id = ? AND status IN ('pending', 'running', 'waiting_for_user')
                    """,
                    (
                        attempt_status,
                        draft.created_at,
                        draft.event_type,
                        run_id,
                    ),
                )
            return event

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

    def set_timeout_policy(
        self,
        run_id: str,
        policy: RunTimeoutPolicy,
        *,
        now: float | None = None,
    ) -> RunRecord:
        timestamp = now if now is not None else time.time()
        encoded = json.dumps(
            policy.to_dict(),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            connection.execute(
                """
                UPDATE runs
                SET timeout_policy_json = ?, timeout_policy_version = ?,
                    deadline_at = ?, updated_at = ?
                WHERE run_id = ?
                """,
                (
                    encoded,
                    policy.policy_version,
                    policy.run_deadline_at,
                    timestamp,
                    run_id,
                ),
            )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"timeout-policy:{run_id}:{policy.policy_version}",
                    event_type="run.timeout_policy_configured",
                    payload=policy.to_dict(),
                    created_at=timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert row is not None
            return self._run_from_row(row)

    def create_run_attempt(
        self,
        run_id: str,
        *,
        request_id: str,
        reason: str,
        activate: bool = False,
        attempt_id: str | None = None,
        now: float | None = None,
    ) -> RunAttemptRecord:
        if not request_id.strip() or not reason.strip():
            raise ValueError("attempt request_id and reason are required")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["status"] in {"completed", "failed", "cancelled"}:
                raise InvalidRunTransitionError(
                    f"cannot create an attempt for terminal run {run_id!r}"
                )
            if run["cancel_request_id"] is not None:
                raise InvalidRunTransitionError(
                    f"run {run_id!r} has a persisted cancel intent"
                )
            duplicate = connection.execute(
                """
                SELECT * FROM run_attempts
                WHERE run_id = ? AND resume_request_id = ?
                """,
                (run_id, request_id),
            ).fetchone()
            if duplicate is not None:
                if duplicate["resume_reason"] != reason:
                    raise IdempotencyConflictError(
                        f"attempt request_id {request_id!r} was reused with a different reason"
                    )
                return self._attempt_from_row(duplicate)
            active = connection.execute(
                """
                SELECT attempt_id FROM run_attempts
                WHERE run_id = ? AND status IN ('pending', 'running', 'waiting_for_user')
                LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            if active is not None:
                raise InvalidRunTransitionError(
                    f"run {run_id!r} already has active attempt {active['attempt_id']!r}"
                )
            pending_approvals = connection.execute(
                """
                SELECT approval_id FROM approvals
                WHERE run_id = ? AND status = 'pending'
                ORDER BY created_at
                """,
                (run_id,),
            ).fetchall()
            if pending_approvals:
                raise InvalidRunTransitionError(
                    f"run {run_id!r} has pending approvals: "
                    + ", ".join(
                        row["approval_id"] for row in pending_approvals
                    )
                )
            blockers = self._unsafe_resume_blockers(connection, run_id)
            if blockers:
                raise UnsafeResumeError(blockers)
            number = int(
                connection.execute(
                    """
                    SELECT COALESCE(MAX(attempt_number), 0) + 1
                    FROM run_attempts WHERE run_id = ?
                    """,
                    (run_id,),
                ).fetchone()[0]
            )
            identifier = attempt_id or str(uuid.uuid4())
            status = "running" if activate else "pending"
            connection.execute(
                """
                INSERT INTO run_attempts(
                    attempt_id, run_id, attempt_number, status, started_at,
                    ended_at, outcome, timeout_reason, resume_request_id,
                    resume_reason, policy_version, elapsed_active_ms,
                    last_consumer_heartbeat_at
                ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 0, ?)
                """,
                (
                    identifier,
                    run_id,
                    number,
                    status,
                    timestamp,
                    request_id,
                    reason,
                    run["timeout_policy_version"],
                    timestamp if activate else None,
                ),
            )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"attempt:{identifier}:created",
                    event_type="run.attempt_created",
                    payload={
                        "attempt_id": identifier,
                        "attempt_number": number,
                        "reason": reason,
                        "status": status,
                        "policy_version": run["timeout_policy_version"],
                    },
                    created_at=timestamp,
                ),
                run_status=status,
                active_attempt_id=identifier,
            )
            row = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (identifier,),
            ).fetchone()
            assert row is not None
            return self._attempt_from_row(row)

    def get_run_attempt(self, attempt_id: str) -> RunAttemptRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            return self._attempt_from_row(row) if row is not None else None

    def list_run_attempts(self, run_id: str) -> list[RunAttemptRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM run_attempts
                WHERE run_id = ? ORDER BY attempt_number
                """,
                (run_id,),
            ).fetchall()
            return [self._attempt_from_row(row) for row in rows]

    def heartbeat_attempt(
        self,
        attempt_id: str,
        *,
        expected_run_id: str | None = None,
        now: float | None = None,
    ) -> RunAttemptRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE run_attempts
                SET elapsed_active_ms = elapsed_active_ms + CAST(
                        MAX(0, ? - COALESCE(last_consumer_heartbeat_at, ?)) * 1000
                        AS INTEGER
                    ),
                    last_consumer_heartbeat_at = ?
                WHERE attempt_id = ? AND status = 'running'
                """,
                (timestamp, timestamp, timestamp, attempt_id),
            )
            if updated.rowcount != 1:
                raise InvalidRunTransitionError(
                    f"attempt {attempt_id!r} is not running"
                )
            row = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            assert row is not None
            if (
                expected_run_id is not None
                and row["run_id"] != expected_run_id
            ):
                raise IdempotencyConflictError(
                    f"attempt {attempt_id!r} does not belong to run {expected_run_id!r}"
                )
            return self._attempt_from_row(row)

    def activate_run_attempt(
        self,
        attempt_id: str,
        *,
        expected_run_id: str | None = None,
        now: float | None = None,
    ) -> RunAttemptRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            attempt = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            if attempt is None:
                raise RunNotFoundError(
                    f"attempt_id {attempt_id!r} does not exist"
                )
            if (
                expected_run_id is not None
                and attempt["run_id"] != expected_run_id
            ):
                raise IdempotencyConflictError(
                    f"attempt {attempt_id!r} does not belong to run {expected_run_id!r}"
                )
            if attempt["status"] == "running":
                return self._attempt_from_row(attempt)
            if not transition_allowed(
                ATTEMPT_TRANSITIONS,
                str(attempt["status"]),
                "running",
            ):
                raise InvalidRunTransitionError(
                    f"attempt {attempt_id!r} is not pending"
                )
            connection.execute(
                """
                UPDATE run_attempts
                SET status = 'running', last_consumer_heartbeat_at = ?
                WHERE attempt_id = ? AND status = 'pending'
                """,
                (timestamp, attempt_id),
            )
            self._append_event_in_transaction(
                connection,
                attempt["run_id"],
                RunEventDraft(
                    event_id=f"attempt:{attempt_id}:started",
                    event_type="run.attempt_started",
                    payload={
                        "attempt_id": attempt_id,
                        "attempt_number": int(attempt["attempt_number"]),
                        "policy_version": attempt["policy_version"],
                    },
                    created_at=timestamp,
                ),
                run_status="running",
                active_attempt_id=attempt_id,
            )
            row = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            assert row is not None
            return self._attempt_from_row(row)

    def fork_run(
        self,
        source_run_id: str,
        *,
        new_run_id: str,
        request_id: str,
        now: float | None = None,
    ) -> tuple[RunRecord, RunAttemptRecord]:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (new_run_id,)
            ).fetchone()
            if existing is not None:
                if existing["parent_run_id"] != source_run_id:
                    raise IdempotencyConflictError(
                        f"fork target {new_run_id!r} already exists"
                    )
                attempts = connection.execute(
                    "SELECT * FROM run_attempts WHERE run_id = ? ORDER BY attempt_number",
                    (new_run_id,),
                ).fetchall()
                if not attempts:
                    raise IdempotencyConflictError(
                        "fork is missing its checkpoint attempt"
                    )
                if attempts[0]["resume_request_id"] != request_id:
                    raise IdempotencyConflictError(
                        f"fork target {new_run_id!r} was created by another request"
                    )
                return self._run_from_row(existing), self._attempt_from_row(
                    attempts[0]
                )
            source = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (source_run_id,)
            ).fetchone()
            if source is None:
                raise RunNotFoundError(
                    f"run_id {source_run_id!r} does not exist"
                )
            attempt_id = str(uuid.uuid4())
            inherited_policy = json.loads(
                source["timeout_policy_json"] or "{}"
            )
            inherited_policy["run_deadline_at"] = None
            connection.execute(
                """
                INSERT INTO runs(
                    run_id, project_id, status, version, active_attempt_id,
                    deadline_at, timeout_policy_version, created_at, updated_at,
                    parent_run_id, timeout_policy_json
                ) VALUES (?, ?, 'interrupted', 0, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_run_id,
                    source["project_id"],
                    None,
                    source["timeout_policy_version"],
                    timestamp,
                    timestamp,
                    source_run_id,
                    json.dumps(
                        inherited_policy,
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                ),
            )
            connection.execute(
                """
                INSERT INTO run_attempts(
                    attempt_id, run_id, attempt_number, status, started_at,
                    ended_at, outcome, timeout_reason, resume_request_id,
                    resume_reason, policy_version, elapsed_active_ms
                ) VALUES (?, ?, 1, 'interrupted', ?, ?, 'fork_checkpoint',
                          NULL, ?, 'fork', ?, 0)
                """,
                (
                    attempt_id,
                    new_run_id,
                    timestamp,
                    timestamp,
                    request_id,
                    source["timeout_policy_version"],
                ),
            )
            self._append_event_in_transaction(
                connection,
                new_run_id,
                RunEventDraft(
                    event_id=f"fork:{new_run_id}:{request_id}",
                    event_type="run.forked",
                    payload={
                        "source_run_id": source_run_id,
                        "checkpoint_attempt_id": attempt_id,
                        "requires_resume": True,
                    },
                    created_at=timestamp,
                ),
                run_status="interrupted",
            )
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (new_run_id,)
            ).fetchone()
            attempt = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            assert run is not None and attempt is not None
            return self._run_from_row(run), self._attempt_from_row(attempt)

    def request_cancel(
        self,
        run_id: str,
        *,
        request_id: str,
        reason: str,
        now: float | None = None,
    ) -> RunRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["status"] == "cancelled":
                return self._run_from_row(run)
            if run["status"] in {"completed", "failed"}:
                raise InvalidRunTransitionError(
                    f"cannot cancel terminal run {run_id!r}"
                )
            if run["cancel_request_id"] not in {None, request_id}:
                raise InvalidRunTransitionError(
                    f"run {run_id!r} already has another cancel intent"
                )
            if run["cancel_request_id"] is not None:
                event = connection.execute(
                    "SELECT payload_json FROM run_events WHERE event_id = ?",
                    (f"cancel:{request_id}:requested",),
                ).fetchone()
                if (
                    event is None
                    or json.loads(event["payload_json"]).get("reason")
                    != reason
                ):
                    raise IdempotencyConflictError(
                        f"cancel request_id {request_id!r} was reused with different data"
                    )
            else:
                connection.execute(
                    """
                    UPDATE runs SET cancel_request_id = ?, cancel_requested_at = ?
                    WHERE run_id = ?
                    """,
                    (request_id, timestamp, run_id),
                )
                self._append_event_in_transaction(
                    connection,
                    run_id,
                    RunEventDraft(
                        event_id=f"cancel:{request_id}:requested",
                        event_type="run.cancel_requested",
                        payload={"request_id": request_id, "reason": reason},
                        created_at=timestamp,
                    ),
                )
            row = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert row is not None
            return self._run_from_row(row)

    def complete_cancel(
        self,
        run_id: str,
        *,
        request_id: str,
        now: float | None = None,
    ) -> RunRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["status"] == "cancelled":
                return self._run_from_row(run)
            if run["cancel_request_id"] != request_id:
                raise InvalidRunTransitionError(
                    "cancel completion has no matching intent"
                )
            connection.execute(
                """
                UPDATE run_attempts
                SET status = 'cancelled', ended_at = COALESCE(ended_at, ?),
                    outcome = COALESCE(outcome, 'explicit_cancel')
                WHERE run_id = ? AND status IN ('pending', 'running', 'waiting_for_user')
                """,
                (timestamp, run_id),
            )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"cancel:{request_id}:completed",
                    event_type="run.cancelled",
                    payload={
                        "request_id": request_id,
                        "reason": "explicit_cancel",
                    },
                    created_at=timestamp,
                ),
                run_status="cancelled",
                clear_active_attempt=True,
            )
            row = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert row is not None
            return self._run_from_row(row)

    def checkpoint_tool_call(
        self,
        *,
        tool_call_id: str,
        run_id: str,
        attempt_id: str | None,
        tool_name: str,
        safety_class: ToolSafetyClass,
        status: str,
        request: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        outcome: str | None = None,
        timeout_reason: str | None = None,
        now: float | None = None,
    ) -> ToolCallRecord:
        if status not in {
            value for allowed in TOOL_TRANSITIONS.values() for value in allowed
        }:
            raise ValueError("unsupported tool checkpoint status")
        if (
            safety_class is ToolSafetyClass.IDEMPOTENT_WRITE
            and not idempotency_key
        ):
            raise ValueError("idempotent writes require an idempotency key")
        timestamp = now if now is not None else time.time()
        request_json = json.dumps(
            request or {},
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        result_json = (
            json.dumps(
                result,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            if result is not None
            else None
        )
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT run_id FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            existing = connection.execute(
                "SELECT * FROM tool_calls WHERE tool_call_id = ?",
                (tool_call_id,),
            ).fetchone()
            if attempt_id is not None:
                attempt = connection.execute(
                    "SELECT run_id FROM run_attempts WHERE attempt_id = ?",
                    (attempt_id,),
                ).fetchone()
                if attempt is None or attempt["run_id"] != run_id:
                    raise IdempotencyConflictError(
                        f"attempt {attempt_id!r} does not belong to run {run_id!r}"
                    )
            previous = existing["status"] if existing is not None else None
            if not transition_allowed(TOOL_TRANSITIONS, previous, status):
                raise InvalidRunTransitionError(
                    f"tool call {tool_call_id!r} cannot move from {previous!r} to {status!r}"
                )
            if (
                status == "timed_out"
                and safety_class is ToolSafetyClass.UNSAFE_WRITE
            ):
                raise InvalidRunTransitionError(
                    f"unsafe write tool {tool_call_id!r} must enter outcome_unknown, "
                    "not timed_out"
                )
            if existing is not None and (
                existing["run_id"] != run_id
                or existing["tool_name"] != tool_name
                or existing["safety_class"] != safety_class.value
                or existing["idempotency_key"] != idempotency_key
                or existing["request_json"] != request_json
            ):
                raise IdempotencyConflictError(
                    f"tool_call_id {tool_call_id!r} was reused with different data"
                )
            if existing is None:
                connection.execute(
                    """
                    INSERT INTO tool_calls(
                        tool_call_id, run_id, attempt_id, tool_name, status,
                        safety_class, idempotency_key, outcome, timeout_reason,
                        created_at, updated_at, request_json, result_json,
                        prepared_at, dispatched_at, completed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                    """,
                    (
                        tool_call_id,
                        run_id,
                        attempt_id,
                        tool_name,
                        status,
                        safety_class.value,
                        idempotency_key,
                        outcome,
                        timeout_reason,
                        timestamp,
                        timestamp,
                        request_json,
                        result_json,
                        timestamp,
                    ),
                )
            elif status != previous or result_json != existing["result_json"]:
                connection.execute(
                    """
                    UPDATE tool_calls
                    SET status = ?, result_json = COALESCE(?, result_json),
                        outcome = COALESCE(?, outcome),
                        timeout_reason = COALESCE(?, timeout_reason),
                        dispatched_at = CASE WHEN ? = 'dispatched'
                            THEN COALESCE(dispatched_at, ?) ELSE dispatched_at END,
                        completed_at = CASE WHEN ? IN ('completed', 'failed')
                            THEN COALESCE(completed_at, ?) ELSE completed_at END,
                        updated_at = ?
                    WHERE tool_call_id = ?
                    """,
                    (
                        status,
                        result_json,
                        outcome,
                        timeout_reason,
                        status,
                        timestamp,
                        status,
                        timestamp,
                        timestamp,
                        tool_call_id,
                    ),
                )
            event_type = f"tool.{status}"
            event_id = f"tool:{tool_call_id}:{status}"
            payload = {
                "tool_call_id": tool_call_id,
                "attempt_id": attempt_id,
                "tool_name": tool_name,
                "safety_class": safety_class.value,
                "status": status,
                "outcome": outcome,
                "timeout_reason": timeout_reason,
                "request": request or {},
                "result": result,
            }
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=event_id,
                    event_type=event_type,
                    payload=payload,
                    created_at=timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM tool_calls WHERE tool_call_id = ?",
                (tool_call_id,),
            ).fetchone()
            assert row is not None
            return self._tool_call_from_row(row)

    def list_tool_calls(self, run_id: str) -> list[ToolCallRecord]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM tool_calls WHERE run_id = ? ORDER BY created_at",
                (run_id,),
            ).fetchall()
            return [self._tool_call_from_row(row) for row in rows]

    def create_approval(
        self,
        *,
        approval_id: str,
        run_id: str,
        attempt_id: str | None,
        prompt: dict[str, Any],
        expires_at: float | None = None,
        expiry_action: str = "keep_pending",
        now: float | None = None,
    ) -> ApprovalRecord:
        if expiry_action not in {"keep_pending", "reject"}:
            raise ValueError("invalid approval expiry action")
        timestamp = now if now is not None else time.time()
        prompt_json = json.dumps(
            prompt, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        )
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT status, active_attempt_id FROM runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["status"] in {"completed", "failed", "cancelled"}:
                raise InvalidRunTransitionError(
                    f"terminal run {run_id!r} cannot request approval"
                )
            if attempt_id is not None:
                attempt = connection.execute(
                    "SELECT run_id, status FROM run_attempts WHERE attempt_id = ?",
                    (attempt_id,),
                ).fetchone()
                if attempt is None or attempt["run_id"] != run_id:
                    raise IdempotencyConflictError(
                        f"attempt {attempt_id!r} does not belong to run {run_id!r}"
                    )
                if not transition_allowed(
                    ATTEMPT_TRANSITIONS,
                    str(attempt["status"]),
                    "waiting_for_user",
                ) or run["active_attempt_id"] != attempt_id:
                    raise InvalidRunTransitionError(
                        f"approval attempt {attempt_id!r} must be the active running attempt"
                    )
            elif run["active_attempt_id"] is not None:
                raise InvalidRunTransitionError(
                    "approval for a Run with an active attempt must bind that attempt"
                )
            existing = connection.execute(
                "SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)
            ).fetchone()
            if existing is not None:
                if (
                    existing["run_id"] != run_id
                    or existing["prompt_json"] != prompt_json
                    or existing["expires_at"] != expires_at
                    or existing["expiry_action"] != expiry_action
                ):
                    raise IdempotencyConflictError(
                        f"approval_id {approval_id!r} was reused"
                    )
                return self._approval_from_row(existing)
            connection.execute(
                """
                INSERT INTO approvals(
                    approval_id, run_id, attempt_id, status, prompt_json,
                    decision_json, created_at, resolved_at, version,
                    expires_at, expiry_action
                ) VALUES (?, ?, ?, 'pending', ?, NULL, ?, NULL, 0, ?, ?)
                """,
                (
                    approval_id,
                    run_id,
                    attempt_id,
                    prompt_json,
                    timestamp,
                    expires_at,
                    expiry_action,
                ),
            )
            if attempt_id is not None:
                updated_attempt = connection.execute(
                    """
                    UPDATE run_attempts SET status = 'waiting_for_user'
                    WHERE attempt_id = ? AND status = 'running'
                    """,
                    (attempt_id,),
                )
                if updated_attempt.rowcount != 1:
                    raise InvalidRunTransitionError(
                        f"approval attempt {attempt_id!r} is no longer running"
                    )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"approval:{approval_id}:requested",
                    event_type="approval.requested",
                    payload={
                        "approval_id": approval_id,
                        "attempt_id": attempt_id,
                        "prompt": prompt,
                        "expires_at": expires_at,
                        "expiry_action": expiry_action,
                    },
                    created_at=timestamp,
                ),
                run_status="waiting_for_user",
                active_attempt_id=attempt_id,
            )
            row = connection.execute(
                "SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)
            ).fetchone()
            assert row is not None
            return self._approval_from_row(row)

    def decide_approval(
        self,
        approval_id: str,
        *,
        decision: str,
        details: dict[str, Any] | None = None,
        expected_version: int,
        expected_run_id: str | None = None,
        continue_active_attempt: bool = False,
        now: float | None = None,
    ) -> ApprovalRecord:
        if decision not in {"approved", "rejected"}:
            raise ValueError("approval decision must be approved or rejected")
        timestamp = now if now is not None else time.time()
        decision_value = {"decision": decision, **(details or {})}
        decision_json = json.dumps(
            decision_value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        with self._write_transaction() as connection:
            approval = connection.execute(
                "SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)
            ).fetchone()
            if approval is None:
                raise RunNotFoundError(
                    f"approval_id {approval_id!r} does not exist"
                )
            if (
                expected_run_id is not None
                and approval["run_id"] != expected_run_id
            ):
                raise IdempotencyConflictError(
                    f"approval {approval_id!r} does not belong to run {expected_run_id!r}"
                )
            if approval["status"] != "pending":
                if (
                    approval["status"] == decision
                    and approval["decision_json"] == decision_json
                ):
                    return self._approval_from_row(approval)
                raise InvalidRunTransitionError(
                    f"approval {approval_id!r} is already resolved"
                )
            if int(approval["version"]) != expected_version:
                raise OptimisticConcurrencyError(
                    f"approval {approval_id!r} expected version {expected_version}"
                )
            run = connection.execute(
                "SELECT status FROM runs WHERE run_id = ?",
                (approval["run_id"],),
            ).fetchone()
            if run is None:
                raise RunNotFoundError(
                    f"run_id {approval['run_id']!r} does not exist"
                )
            if run["status"] in {"completed", "failed", "cancelled"}:
                raise InvalidRunTransitionError(
                    f"terminal run {approval['run_id']!r} cannot accept an approval decision"
                )
            can_continue = False
            attempt_status: str | None = None
            if continue_active_attempt and approval["attempt_id"] is not None:
                attempt = connection.execute(
                    "SELECT status FROM run_attempts WHERE attempt_id = ?",
                    (approval["attempt_id"],),
                ).fetchone()
                can_continue = (
                    attempt is not None
                    and attempt["status"] == "waiting_for_user"
                )
                attempt_status = attempt["status"] if attempt is not None else None
            elif approval["attempt_id"] is not None:
                attempt = connection.execute(
                    "SELECT status FROM run_attempts WHERE attempt_id = ?",
                    (approval["attempt_id"],),
                ).fetchone()
                attempt_status = attempt["status"] if attempt is not None else None
            if (
                attempt_status in ATTEMPT_ACTIVE_STATES
                and attempt_status != "waiting_for_user"
            ):
                raise InvalidRunTransitionError(
                    f"approval {approval_id!r} is bound to active attempt state "
                    f"{attempt_status!r}, not waiting_for_user"
                )
            connection.execute(
                """
                UPDATE approvals
                SET status = ?, decision_json = ?, resolved_at = ?, version = version + 1
                WHERE approval_id = ? AND version = ? AND status = 'pending'
                """,
                (
                    decision,
                    decision_json,
                    timestamp,
                    approval_id,
                    expected_version,
                ),
            )
            if can_continue:
                connection.execute(
                    """
                    UPDATE run_attempts
                    SET status = 'running', last_consumer_heartbeat_at = ?
                    WHERE attempt_id = ? AND status = 'waiting_for_user'
                    """,
                    (timestamp, approval["attempt_id"]),
                )
            elif approval["attempt_id"] is not None:
                connection.execute(
                    """
                    UPDATE run_attempts
                    SET status = 'interrupted', ended_at = COALESCE(ended_at, ?),
                        outcome = 'approval_decision_persisted'
                    WHERE attempt_id = ? AND status = 'waiting_for_user'
                    """,
                    (timestamp, approval["attempt_id"]),
                )
            self._append_event_in_transaction(
                connection,
                approval["run_id"],
                RunEventDraft(
                    event_id=f"approval:{approval_id}:decision:{expected_version + 1}",
                    event_type="approval.decided",
                    payload={
                        "approval_id": approval_id,
                        "continued_attempt": can_continue,
                        **decision_value,
                    },
                    created_at=timestamp,
                ),
                run_status="running" if can_continue else "interrupted",
                active_attempt_id=(
                    approval["attempt_id"] if can_continue else None
                ),
                clear_active_attempt=not can_continue,
            )
            row = connection.execute(
                "SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)
            ).fetchone()
            assert row is not None
            return self._approval_from_row(row)

    def list_approvals(
        self, run_id: str, *, pending_only: bool = False
    ) -> list[ApprovalRecord]:
        query = "SELECT * FROM approvals WHERE run_id = ?"
        if pending_only:
            query += " AND status = 'pending'"
        query += " ORDER BY created_at"
        with self._lock:
            rows = self._connection.execute(query, (run_id,)).fetchall()
            return [self._approval_from_row(row) for row in rows]

    def record_timeout_outcome(
        self, outcome: TimeoutOutcome
    ) -> CommittedRunEvent:
        if outcome.scope in {
            TimeoutScope.TRANSPORT_IDLE,
            TimeoutScope.REMOTE_COMMAND_TTL,
            TimeoutScope.CLOUD_SYNC,
        }:
            raise ValueError(
                f"{outcome.scope.value} is not owned by RunJournal"
            )
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (outcome.run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(
                    f"run_id {outcome.run_id!r} does not exist"
                )
            event_type = {
                TimeoutScope.RUNTIME_LIVENESS: "runtime.interrupted",
                TimeoutScope.ACTIVITY: "activity.timed_out",
                TimeoutScope.TOOL: "tool.timed_out",
                TimeoutScope.RUN_DEADLINE: "run.deadline_reached",
                TimeoutScope.APPROVAL_EXPIRY: "approval.expired",
            }[outcome.scope]
            run_status: str | None = None
            clear_attempt = False
            if outcome.scope is TimeoutScope.RUNTIME_LIVENESS:
                run_status = "interrupted"
                clear_attempt = True
            elif outcome.scope is TimeoutScope.RUN_DEADLINE:
                if run["deadline_at"] is None or outcome.ended_at < float(
                    run["deadline_at"]
                ):
                    raise InvalidRunTransitionError(
                        "run deadline outcome does not match a reached persisted deadline"
                    )
                run_status = "failed"
                clear_attempt = True
            elif outcome.scope is TimeoutScope.TOOL:
                tool = connection.execute(
                    "SELECT * FROM tool_calls WHERE tool_call_id = ?",
                    (outcome.tool_call_id,),
                ).fetchone()
                if tool is None:
                    raise RunNotFoundError(
                        f"tool_call_id {outcome.tool_call_id!r} does not exist"
                    )
                if tool["status"] in {"completed", "failed"}:
                    raise InvalidRunTransitionError(
                        f"tool call {outcome.tool_call_id!r} is already {tool['status']}"
                    )
                if tool["status"] not in {
                    "dispatched",
                    "timed_out",
                    "outcome_unknown",
                }:
                    raise InvalidRunTransitionError(
                        f"tool call {outcome.tool_call_id!r} cannot time out from "
                        f"{tool['status']!r}"
                    )
                safety = ToolSafetyClass(tool["safety_class"])
                replayable = automatic_tool_replay_allowed(
                    safety, idempotency_key=tool["idempotency_key"]
                )
                tool_status = "timed_out" if replayable else "outcome_unknown"
                event_type = (
                    "tool.timed_out" if replayable else "tool.outcome_unknown"
                )
                connection.execute(
                    """
                    UPDATE tool_calls
                    SET status = ?, outcome = ?, timeout_reason = ?, updated_at = ?
                    WHERE tool_call_id = ?
                    """,
                    (
                        tool_status,
                        "retry_allowed" if replayable else "outcome_unknown",
                        outcome.reason,
                        outcome.ended_at,
                        outcome.tool_call_id,
                    ),
                )
            elif outcome.scope is TimeoutScope.APPROVAL_EXPIRY:
                approval = connection.execute(
                    "SELECT * FROM approvals WHERE approval_id = ?",
                    (outcome.approval_id,),
                ).fetchone()
                if approval is None:
                    raise RunNotFoundError(
                        f"approval_id {outcome.approval_id!r} does not exist"
                    )
                if approval["status"] != "pending":
                    raise InvalidRunTransitionError(
                        f"approval {outcome.approval_id!r} is already resolved"
                    )
                if approval["expiry_action"] == "reject":
                    event_type = "approval.expired_rejected"
                    connection.execute(
                        """
                        UPDATE approvals
                        SET status = 'rejected', decision_json = ?,
                            resolved_at = ?, version = version + 1
                        WHERE approval_id = ? AND status = 'pending'
                        """,
                        (
                            json.dumps(
                                {
                                    "decision": "rejected",
                                    "reason": "approval_expired",
                                },
                                separators=(",", ":"),
                                sort_keys=True,
                            ),
                            outcome.ended_at,
                            outcome.approval_id,
                        ),
                    )
                    run_status = "interrupted"
                    clear_attempt = True
                else:
                    event_type = "approval.expiry_observed"
            if clear_attempt:
                connection.execute(
                    """
                    UPDATE run_attempts
                    SET status = ?, ended_at = COALESCE(ended_at, ?),
                        timeout_reason = ?, outcome = ?
                    WHERE run_id = ? AND status IN ('pending', 'running', 'waiting_for_user')
                    """,
                    (
                        "timed_out"
                        if outcome.scope is TimeoutScope.RUN_DEADLINE
                        else "interrupted",
                        outcome.ended_at,
                        outcome.reason,
                        event_type,
                        outcome.run_id,
                    ),
                )
            identity = {
                TimeoutScope.RUNTIME_LIVENESS: outcome.attempt_id,
                TimeoutScope.ACTIVITY: outcome.activity_id,
                TimeoutScope.TOOL: outcome.tool_call_id,
                TimeoutScope.RUN_DEADLINE: outcome.run_id,
                TimeoutScope.APPROVAL_EXPIRY: outcome.approval_id,
            }[outcome.scope]
            return self._append_event_in_transaction(
                connection,
                outcome.run_id,
                RunEventDraft(
                    event_id=(
                        f"timeout:{outcome.scope.value}:{outcome.run_id}:"
                        f"{identity or outcome.ended_at}:{outcome.policy_version}"
                    ),
                    event_type=event_type,
                    payload=outcome.to_payload(),
                    created_at=outcome.ended_at,
                ),
                run_status=run_status,
                clear_active_attempt=clear_attempt,
            )

    def reconcile_startup(
        self, *, now: float | None = None
    ) -> StartupReconciliationResult:
        timestamp = now if now is not None else time.time()
        interrupted_runs: list[str] = []
        completed_cancels: list[str] = []
        deadline_runs: list[str] = []
        detached_attempts: list[str] = []
        unknown_tools: list[str] = []
        with self._write_transaction() as connection:
            runs = connection.execute(
                """
                SELECT * FROM runs
                WHERE status IN ('pending', 'running', 'waiting_for_user')
                   OR (status = 'interrupted' AND cancel_request_id IS NOT NULL)
                ORDER BY created_at
                """
            ).fetchall()
            for run in runs:
                run_interrupted = False
                run_cancelled = False
                run_deadline = False
                run_attempt_ids: list[str] = []
                try:
                    with self._savepoint(connection, "startup_run"):
                        active_attempts = connection.execute(
                            """
                            SELECT * FROM run_attempts
                            WHERE run_id = ?
                              AND status IN ('pending', 'running', 'waiting_for_user')
                            """,
                            (run["run_id"],),
                        ).fetchall()
                        if run["cancel_request_id"] is not None:
                            target_status = "cancelled"
                            event_type = "run.cancelled"
                            run_cancelled = True
                        elif (
                            run["deadline_at"] is not None
                            and float(run["deadline_at"]) <= timestamp
                        ):
                            target_status = "failed"
                            event_type = "run.deadline_reached"
                            run_deadline = True
                        elif (
                            run["status"] == "waiting_for_user"
                            and not active_attempts
                        ):
                            continue
                        else:
                            target_status = (
                                "waiting_for_user"
                                if run["status"] == "waiting_for_user"
                                else "interrupted"
                            )
                            event_type = "runtime.interrupted"
                            run_interrupted = True
                        run_attempt_ids = [
                            attempt["attempt_id"] for attempt in active_attempts
                        ]
                        connection.execute(
                            """
                            UPDATE run_attempts
                            SET status = ?, ended_at = COALESCE(ended_at, ?),
                                outcome = COALESCE(outcome, ?)
                            WHERE run_id = ?
                              AND status IN ('pending', 'running', 'waiting_for_user')
                            """,
                            (
                                "cancelled"
                                if target_status == "cancelled"
                                else (
                                    "timed_out"
                                    if event_type == "run.deadline_reached"
                                    else "interrupted"
                                ),
                                timestamp,
                                event_type,
                                run["run_id"],
                            ),
                        )
                        self._append_event_in_transaction(
                            connection,
                            run["run_id"],
                            RunEventDraft(
                                event_id=(
                                    f"startup:{event_type}:{run['run_id']}:"
                                    f"{run['version']}"
                                ),
                                event_type=event_type,
                                payload={
                                    "previous_status": run["status"],
                                    "reason": "brain_restart",
                                    "policy_version": run[
                                        "timeout_policy_version"
                                    ],
                                },
                                created_at=timestamp,
                            ),
                            run_status=target_status,
                            clear_active_attempt=True,
                        )
                except Exception:
                    logger.exception(
                        "Startup reconciliation skipped one Run",
                        extra={"run_id": run["run_id"]},
                    )
                    continue
                detached_attempts.extend(run_attempt_ids)
                if run_interrupted:
                    interrupted_runs.append(run["run_id"])
                if run_cancelled:
                    completed_cancels.append(run["run_id"])
                if run_deadline:
                    deadline_runs.append(run["run_id"])
            tool_rows = connection.execute(
                """
                SELECT * FROM tool_calls
                WHERE status = 'dispatched' AND outcome IS NULL
                """
            ).fetchall()
            for tool in tool_rows:
                try:
                    with self._savepoint(connection, "startup_tool"):
                        connection.execute(
                            """
                            UPDATE tool_calls
                            SET status = 'outcome_unknown',
                                outcome = 'outcome_unknown', updated_at = ?
                            WHERE tool_call_id = ? AND status = 'dispatched'
                            """,
                            (timestamp, tool["tool_call_id"]),
                        )
                        self._append_event_in_transaction(
                            connection,
                            tool["run_id"],
                            RunEventDraft(
                                event_id=(
                                    "startup:tool-outcome-unknown:"
                                    f"{tool['tool_call_id']}"
                                ),
                                event_type="tool.outcome_unknown",
                                payload={
                                    "tool_call_id": tool["tool_call_id"],
                                    "safety_class": tool["safety_class"],
                                    "reason": "brain_restart_after_dispatch",
                                },
                                created_at=timestamp,
                            ),
                        )
                except Exception:
                    logger.exception(
                        "Startup reconciliation skipped one ToolCall",
                        extra={"tool_call_id": tool["tool_call_id"]},
                    )
                    continue
                unknown_tools.append(tool["tool_call_id"])
            expired_approvals = connection.execute(
                """
                SELECT approvals.*, runs.status AS run_status
                FROM approvals
                JOIN runs ON runs.run_id = approvals.run_id
                WHERE approvals.status = 'pending'
                  AND approvals.expiry_action = 'reject'
                  AND approvals.expires_at IS NOT NULL
                  AND approvals.expires_at <= ?
                ORDER BY approvals.expires_at, approvals.approval_id
                """,
                (timestamp,),
            ).fetchall()
            for approval in expired_approvals:
                if approval["run_status"] in {
                    "completed",
                    "failed",
                    "cancelled",
                }:
                    continue
                try:
                    with self._savepoint(connection, "startup_approval"):
                        decision_json = json.dumps(
                            {
                                "decision": "rejected",
                                "reason": "approval_expired",
                            },
                            separators=(",", ":"),
                            sort_keys=True,
                        )
                        connection.execute(
                            """
                            UPDATE approvals
                            SET status = 'rejected', decision_json = ?,
                                resolved_at = ?, version = version + 1
                            WHERE approval_id = ? AND status = 'pending'
                            """,
                            (
                                decision_json,
                                timestamp,
                                approval["approval_id"],
                            ),
                        )
                        connection.execute(
                            """
                            UPDATE run_attempts
                            SET status = 'interrupted',
                                ended_at = COALESCE(ended_at, ?),
                                outcome = 'approval_expired'
                            WHERE attempt_id = ?
                              AND status = 'waiting_for_user'
                            """,
                            (timestamp, approval["attempt_id"]),
                        )
                        self._append_event_in_transaction(
                            connection,
                            approval["run_id"],
                            RunEventDraft(
                                event_id=(
                                    f"approval:{approval['approval_id']}:expired"
                                ),
                                event_type="approval.expired_rejected",
                                payload={
                                    "approval_id": approval["approval_id"],
                                    "expiry_action": "reject",
                                    "reason": "approval_expired",
                                },
                                created_at=timestamp,
                            ),
                            run_status="interrupted",
                            clear_active_attempt=True,
                        )
                except Exception:
                    logger.exception(
                        "Startup reconciliation skipped one Approval",
                        extra={"approval_id": approval["approval_id"]},
                    )
            approvals = connection.execute(
                "SELECT approval_id FROM approvals WHERE status = 'pending' ORDER BY created_at"
            ).fetchall()
            commands = connection.execute(
                """
                SELECT command_id FROM remote_command_inbox
                WHERE state IN ('received', 'dispatched') ORDER BY updated_at
                """
            ).fetchall()
        return StartupReconciliationResult(
            interrupted_run_ids=tuple(interrupted_runs),
            completed_cancel_run_ids=tuple(completed_cancels),
            deadline_run_ids=tuple(deadline_runs),
            detached_attempt_ids=tuple(detached_attempts),
            outcome_unknown_tool_call_ids=tuple(unknown_tools),
            pending_approval_ids=tuple(
                row["approval_id"] for row in approvals
            ),
            reconcilable_command_ids=tuple(
                row["command_id"] for row in commands
            ),
        )

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
            next_state = state_by_event.get(event_type)
            if next_state is not None and not transition_allowed(
                COMMAND_TRANSITIONS,
                str(inbox["state"]),
                next_state,
            ):
                raise InvalidRunTransitionError(
                    f"command {command_id!r} cannot move from "
                    f"{inbox['state']!r} to {next_state!r}"
                )
            if event_type == "execution.started" and inbox["state"] != "accepted":
                raise InvalidRunTransitionError(
                    f"command {command_id!r} cannot start execution from "
                    f"{inbox['state']!r}"
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

    @staticmethod
    def _terminal_status_for_event(draft: RunEventDraft) -> str | None:
        if draft.event_type == "run.completed" or draft.legacy_step == "end":
            return "completed"
        if draft.event_type in {"run.failed", "run.deadline_reached"}:
            return "failed"
        if draft.event_type == "run.cancelled":
            return "cancelled"
        if draft.event_type in {"run.interrupted", "runtime.interrupted"}:
            return "interrupted"
        return None

    def _append_event_in_transaction(
        self,
        connection: sqlite3.Connection,
        run_id: str,
        draft: RunEventDraft,
        *,
        payload_json: str | None = None,
        expected_version: int | None = None,
        expected_project_id: str | None = None,
        run_status: str | None = None,
        active_attempt_id: str | None = None,
        clear_active_attempt: bool = False,
    ) -> CommittedRunEvent:
        encoded_payload = payload_json or json.dumps(
            dict(draft.payload),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
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
                        f"{owner['project_id']!r}, not {expected_project_id!r}"
                    )
            return self._resolve_duplicate_event(
                connection,
                duplicate,
                run_id=run_id,
                draft=draft,
                payload_json=encoded_payload,
            )
        run = connection.execute(
            "SELECT * FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if run is None:
            raise RunNotFoundError(f"run_id {run_id!r} does not exist")
        if run_status is not None and not transition_allowed(
            RUN_TRANSITIONS,
            str(run["status"]),
            run_status,
        ):
            raise InvalidRunTransitionError(
                f"run {run_id!r} cannot move from {run['status']!r} to {run_status!r}"
            )
        if (
            expected_project_id is not None
            and run["project_id"] != expected_project_id
        ):
            raise IdempotencyConflictError(
                f"run_id {run_id!r} belongs to project {run['project_id']!r}, "
                f"not {expected_project_id!r}"
            )
        current_version = int(run["version"])
        if (
            expected_version is not None
            and current_version != expected_version
        ):
            raise OptimisticConcurrencyError(
                f"run_id {run_id!r} expected version {expected_version}, "
                f"found {current_version}"
            )
        sequence = int(
            connection.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = ?",
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
                encoded_payload,
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
        assignments = ["version = version + 1", "updated_at = ?"]
        parameters: list[Any] = [draft.created_at]
        if run_status is not None:
            assignments.append("status = ?")
            parameters.append(run_status)
        if clear_active_attempt:
            assignments.append("active_attempt_id = NULL")
        elif active_attempt_id is not None:
            assignments.append("active_attempt_id = ?")
            parameters.append(active_attempt_id)
        parameters.extend([run_id, current_version])
        updated = connection.execute(
            f"UPDATE runs SET {', '.join(assignments)} "
            "WHERE run_id = ? AND version = ?",
            parameters,
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
        if version < 4:
            self._connection.executescript(_MIGRATION_V4)

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

    @contextmanager
    def _savepoint(
        self,
        connection: sqlite3.Connection,
        prefix: str,
    ) -> Iterator[None]:
        name = f"{prefix}_{uuid.uuid4().hex}"
        connection.execute(f"SAVEPOINT {name}")
        try:
            yield
        except BaseException:
            connection.execute(f"ROLLBACK TO SAVEPOINT {name}")
            connection.execute(f"RELEASE SAVEPOINT {name}")
            raise
        else:
            connection.execute(f"RELEASE SAVEPOINT {name}")

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

    @staticmethod
    def _unsafe_resume_blockers(
        connection: sqlite3.Connection, run_id: str
    ) -> list[str]:
        rows = connection.execute(
            """
            SELECT tool_call_id, safety_class, idempotency_key
            FROM tool_calls
            WHERE run_id = ?
              AND status IN ('dispatched', 'timed_out', 'outcome_unknown')
            ORDER BY created_at
            """,
            (run_id,),
        ).fetchall()
        blockers: list[str] = []
        for row in rows:
            safety = ToolSafetyClass(row["safety_class"])
            if not automatic_tool_replay_allowed(
                safety, idempotency_key=row["idempotency_key"]
            ):
                blockers.append(row["tool_call_id"])
        return blockers

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
            parent_run_id=row["parent_run_id"],
            timeout_policy=json.loads(row["timeout_policy_json"] or "{}"),
            cancel_request_id=row["cancel_request_id"],
            cancel_requested_at=(
                float(row["cancel_requested_at"])
                if row["cancel_requested_at"] is not None
                else None
            ),
        )

    @staticmethod
    def _attempt_from_row(row: sqlite3.Row) -> RunAttemptRecord:
        return RunAttemptRecord(
            attempt_id=row["attempt_id"],
            run_id=row["run_id"],
            attempt_number=int(row["attempt_number"]),
            status=row["status"],
            started_at=float(row["started_at"]),
            ended_at=(
                float(row["ended_at"]) if row["ended_at"] is not None else None
            ),
            outcome=row["outcome"],
            timeout_reason=row["timeout_reason"],
            resume_request_id=row["resume_request_id"],
            resume_reason=row["resume_reason"],
            policy_version=row["policy_version"],
            elapsed_active_ms=int(row["elapsed_active_ms"]),
            last_consumer_heartbeat_at=(
                float(row["last_consumer_heartbeat_at"])
                if row["last_consumer_heartbeat_at"] is not None
                else None
            ),
        )

    @staticmethod
    def _tool_call_from_row(row: sqlite3.Row) -> ToolCallRecord:
        return ToolCallRecord(
            tool_call_id=row["tool_call_id"],
            run_id=row["run_id"],
            attempt_id=row["attempt_id"],
            tool_name=row["tool_name"],
            status=row["status"],
            safety_class=row["safety_class"],
            idempotency_key=row["idempotency_key"],
            request=json.loads(row["request_json"] or "{}"),
            result=(
                json.loads(row["result_json"]) if row["result_json"] else None
            ),
            outcome=row["outcome"],
            timeout_reason=row["timeout_reason"],
            prepared_at=(
                float(row["prepared_at"])
                if row["prepared_at"] is not None
                else None
            ),
            dispatched_at=(
                float(row["dispatched_at"])
                if row["dispatched_at"] is not None
                else None
            ),
            completed_at=(
                float(row["completed_at"])
                if row["completed_at"] is not None
                else None
            ),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _approval_from_row(row: sqlite3.Row) -> ApprovalRecord:
        return ApprovalRecord(
            approval_id=row["approval_id"],
            run_id=row["run_id"],
            attempt_id=row["attempt_id"],
            status=row["status"],
            prompt=json.loads(row["prompt_json"]),
            decision=(
                json.loads(row["decision_json"])
                if row["decision_json"] is not None
                else None
            ),
            version=int(row["version"]),
            expires_at=(
                float(row["expires_at"])
                if row["expires_at"] is not None
                else None
            ),
            expiry_action=row["expiry_action"],
            created_at=float(row["created_at"]),
            resolved_at=(
                float(row["resolved_at"])
                if row["resolved_at"] is not None
                else None
            ),
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
