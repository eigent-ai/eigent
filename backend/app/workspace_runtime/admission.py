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

"""Durable, Project-scoped execution admission in the RunJournal database.

Only short database work belongs in these transactions. Workspace preparation,
credential resolution and runtime launch happen outside them. A heartbeat is
diagnostic evidence, never authority to steal a claim from another process.
"""

from __future__ import annotations

import hashlib
import json
import math
import ntpath
import sqlite3
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.run_journal.models import RunAttemptRecord
    from app.run_journal.store import SQLiteRunJournal


ADMISSION_TABLES = """
CREATE TABLE IF NOT EXISTS execution_requests (
    request_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('start','follow_up','resume')),
    envelope_json TEXT NOT NULL,
    envelope_digest TEXT NOT NULL,
    intent_digest TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('local','remote_control','scheduled')),
    source_command_id TEXT,
    source_follow_up_request_id TEXT UNIQUE REFERENCES follow_up_requests(request_id),
    source_message_digest TEXT,
    target_run_id TEXT REFERENCES runs(run_id),
    queue_seq INTEGER NOT NULL CHECK(queue_seq > 0),
    delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('wait','send_now')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','preparing','admitted','cancelled','rejected')),
    wait_reason TEXT,
    admitted_run_id TEXT REFERENCES runs(run_id),
    admitted_attempt_id TEXT REFERENCES run_attempts(attempt_id),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(project_id,queue_seq),
    CHECK ((kind = 'resume') = (target_run_id IS NOT NULL)),
    CHECK ((kind = 'follow_up') = (source_follow_up_request_id IS NOT NULL)),
    CHECK (kind != 'follow_up' OR source_follow_up_request_id = request_id),
    CHECK ((admitted_run_id IS NULL) = (admitted_attempt_id IS NULL)),
    CHECK (status != 'admitted' OR admitted_run_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS execution_requests_source_command
    ON execution_requests(source,source_command_id)
    WHERE source_command_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS execution_requests_pending
    ON execution_requests(project_id,status,queue_seq);
CREATE TABLE IF NOT EXISTS project_admission_claims (
    project_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES execution_requests(request_id),
    owner_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation > 0),
    state TEXT NOT NULL CHECK(state IN ('claimed','handed_off','released')),
    heartbeat_at REAL NOT NULL
);
"""


class AdmissionError(RuntimeError):
    """Admission was rejected without changing its durable state."""


class AdmissionConflict(AdmissionError):
    """An immutable intent or source identity was reused differently."""


class AdmissionFenceLost(AdmissionError):
    """A callback no longer owns the exact preparing generation."""


class InvalidExecutionEnvelope(AdmissionError, ValueError):
    pass


_STRING_FIELDS = frozenset(
    {
        "space_id",
        "project_id",
        "model_platform",
        "model_type",
        "thinking_effort",
        "session_mode",
        "workspace_policy_version",
        "configuration_revision",
        "credential_ref",
        "permission_profile_revision",
        "principal_ref",
        "hands_capability_ref",
        "source_revision",
        "prompt",
    }
)
_LIST_FIELDS = frozenset(
    {
        "attachment_ids",
        "review_handoff_ids",
        "tool_authorizations",
    }
)
_PARAMETERS = frozenset(
    {
        "temperature",
        "top_p",
        "max_tokens",
        "max_output_tokens",
        "seed",
        "frequency_penalty",
        "presence_penalty",
    }
)
_REQUIRED_CONFIGURATION = frozenset(
    {
        "space_id",
        "model_platform",
        "model_type",
        "session_mode",
        "workspace_policy_version",
        "configuration_revision",
        "credential_ref",
        "permission_profile_revision",
        "principal_ref",
    }
)


def _json(value: Any) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def _digest(value: Any) -> str:
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _identifier(value: str, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 512:
        raise ValueError(f"{field} must be a nonempty identifier")
    if value != value.strip() or "\x00" in value:
        raise ValueError(f"{field} contains invalid whitespace or NUL")
    return value


def _path_reference(value: str) -> bool:
    return value.startswith(("/", "~", "\\")) or ntpath.isabs(value)


def validate_envelope(
    envelope: Mapping[str, Any], *, project_id: str, kind: str
) -> dict[str, Any]:
    """Copy only the public intent schema; reject arbitrary serialized config.

    References are opaque identifiers, not secret values or absolute paths.
    The caller must resolve their ownership/permissions before handoff. Missing
    configuration is retained as a waiting request, never guessed from UI state.
    """
    if not isinstance(envelope, Mapping):
        raise InvalidExecutionEnvelope("execution envelope must be an object")
    allowed = _STRING_FIELDS | _LIST_FIELDS | {"model_parameters"}
    unknown = set(envelope) - allowed
    if unknown:
        # Do not include the provided values in errors or logs.
        raise InvalidExecutionEnvelope(
            "execution envelope contains unsupported fields"
        )
    result: dict[str, Any] = {}
    for key, value in envelope.items():
        if key in _STRING_FIELDS:
            if (
                not isinstance(value, str)
                or not value.strip()
                or "\x00" in value
            ):
                raise InvalidExecutionEnvelope(f"invalid envelope field {key}")
            if len(value) > (200_000 if key == "prompt" else 512):
                raise InvalidExecutionEnvelope(
                    f"oversized envelope field {key}"
                )
            if key.endswith("_ref") or key.endswith("_revision"):
                if _path_reference(value):
                    raise InvalidExecutionEnvelope(
                        "references cannot be filesystem paths"
                    )
            result[key] = value
        elif key in _LIST_FIELDS:
            if not isinstance(value, (list, tuple)) or len(value) > 128:
                raise InvalidExecutionEnvelope(f"invalid envelope field {key}")
            items = []
            for item in value:
                try:
                    _identifier(item, key)
                except ValueError as exc:
                    raise InvalidExecutionEnvelope(
                        f"invalid envelope field {key}"
                    ) from exc
                if _path_reference(item):
                    raise InvalidExecutionEnvelope(
                        "object references cannot be filesystem paths"
                    )
                items.append(item)
            result[key] = items
        else:
            if not isinstance(value, Mapping) or set(value) - _PARAMETERS:
                raise InvalidExecutionEnvelope("unsupported model parameters")
            parameters = {}
            for name, number in value.items():
                if (
                    isinstance(number, bool)
                    or not isinstance(number, (int, float))
                    or not math.isfinite(number)
                ):
                    raise InvalidExecutionEnvelope(
                        "model parameters must be finite numbers"
                    )
                parameters[name] = number
            result[key] = parameters
    if result.get("project_id", project_id) != project_id:
        raise InvalidExecutionEnvelope("envelope belongs to another Project")
    result["project_id"] = project_id
    if "session_mode" in result and result["session_mode"] not in {
        "single-agent",
        "workforce",
    }:
        raise InvalidExecutionEnvelope("unsupported Agent mode")
    if kind != "start" and "prompt" in result:
        raise InvalidExecutionEnvelope(
            "follow-up and Resume cannot duplicate prompt ownership"
        )
    if kind == "start" and "prompt" not in result:
        raise InvalidExecutionEnvelope("start requires its immutable prompt")
    return result


@dataclass(frozen=True)
class ExecutionRequest:
    request_id: str
    project_id: str
    kind: str
    envelope: dict[str, Any]
    envelope_digest: str
    intent_digest: str
    source: str
    source_command_id: str | None
    source_follow_up_request_id: str | None
    source_message_digest: str | None
    target_run_id: str | None
    queue_seq: int
    delivery_mode: str
    status: str
    wait_reason: str | None
    admitted_run_id: str | None
    admitted_attempt_id: str | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class AdmissionClaim:
    project_id: str
    request_id: str
    owner_id: str
    generation: int
    state: str
    heartbeat_at: float


PrepareAttempt = Callable[
    [sqlite3.Connection, ExecutionRequest, AdmissionClaim], "RunAttemptRecord"
]


class AdmissionStore:
    def __init__(self, journal: SQLiteRunJournal) -> None:
        self.journal = journal

    def _require_transaction(self, connection: sqlite3.Connection) -> None:
        if (
            connection is not self.journal._connection
            or not connection.in_transaction
        ):
            raise AdmissionError(
                "admission requires the owning writer transaction"
            )

    @staticmethod
    def _request(row: sqlite3.Row) -> ExecutionRequest:
        values = dict(row)
        values["envelope"] = json.loads(values.pop("envelope_json"))
        return ExecutionRequest(**values)

    @classmethod
    def _get(
        cls, connection: sqlite3.Connection, request_id: str
    ) -> ExecutionRequest:
        row = connection.execute(
            "SELECT * FROM execution_requests WHERE request_id=?",
            (request_id,),
        ).fetchone()
        if row is None:
            raise AdmissionError("execution request not found")
        return cls._request(row)

    def get(self, request_id: str) -> ExecutionRequest | None:
        with self.journal._lock:
            row = self.journal._connection.execute(
                "SELECT * FROM execution_requests WHERE request_id=?",
                (request_id,),
            ).fetchone()
            return self._request(row) if row is not None else None

    def get_claim(self, project_id: str) -> AdmissionClaim | None:
        with self.journal._lock:
            row = self.journal._connection.execute(
                "SELECT * FROM project_admission_claims WHERE project_id=?",
                (project_id,),
            ).fetchone()
            return AdmissionClaim(**dict(row)) if row is not None else None

    @staticmethod
    def _message_digest(row: sqlite3.Row) -> str:
        return _digest(
            {
                "project_id": row["project_id"],
                "content": row["content"],
                "attachment_paths": json.loads(row["attachment_paths_json"]),
                "review_handoff_ids": json.loads(
                    row["review_handoff_ids_json"]
                ),
                "source": row["source"],
                "source_command_id": row["source_command_id"],
            }
        )

    def submit(self, **kwargs: Any) -> ExecutionRequest:
        with self.journal._write_transaction() as connection:
            return self.submit_in_transaction(connection, **kwargs)

    def submit_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        request_id: str,
        project_id: str,
        kind: str,
        envelope: Mapping[str, Any],
        source: str = "local",
        source_command_id: str | None = None,
        source_follow_up_request_id: str | None = None,
        target_run_id: str | None = None,
        delivery_mode: str = "wait",
        now: float | None = None,
    ) -> ExecutionRequest:
        """Compose with message creation using the caller's writer transaction."""
        self._require_transaction(connection)
        _identifier(request_id, "request_id")
        _identifier(project_id, "project_id")
        if kind not in {"start", "follow_up", "resume"}:
            raise ValueError("unsupported execution kind")
        if source not in {"local", "remote_control", "scheduled"}:
            raise ValueError("unsupported execution source")
        if delivery_mode not in {"wait", "send_now"}:
            raise ValueError("unsupported delivery mode")
        if source_command_id is not None:
            _identifier(source_command_id, "source_command_id")
        if source == "remote_control" and source_command_id is None:
            raise ValueError("remote execution requires command identity")
        if (kind == "resume") != (target_run_id is not None):
            raise ValueError("only Resume targets an existing Run")
        if (kind == "follow_up") != (source_follow_up_request_id is not None):
            raise ValueError(
                "follow-up requires its canonical message reference"
            )
        if kind == "follow_up" and source_follow_up_request_id != request_id:
            raise ValueError(
                "follow-up request and new Run retain the message id"
            )
        payload = validate_envelope(envelope, project_id=project_id, kind=kind)
        message_digest = None
        message = None
        if source_follow_up_request_id is not None:
            message = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id=?",
                (source_follow_up_request_id,),
            ).fetchone()
            if message is None or message["project_id"] != project_id:
                raise AdmissionConflict(
                    "canonical follow-up belongs to another Project or is missing"
                )
            if (message["source"], message["source_command_id"]) != (
                source,
                source_command_id,
            ):
                raise AdmissionConflict("follow-up source identity differs")
            message_digest = self._message_digest(message)
        if target_run_id is not None:
            target = connection.execute(
                "SELECT project_id FROM runs WHERE run_id=?", (target_run_id,)
            ).fetchone()
            if target is None or target[0] != project_id:
                raise AdmissionConflict(
                    "Resume target belongs to another Project or is missing"
                )
        envelope_digest = _digest(payload)
        identity = _digest(
            {
                "project_id": project_id,
                "kind": kind,
                "envelope_digest": envelope_digest,
                "source": source,
                "source_command_id": source_command_id,
                "source_follow_up_request_id": source_follow_up_request_id,
                "source_message_digest": message_digest,
                "target_run_id": target_run_id,
            }
        )
        existing = connection.execute(
            "SELECT * FROM execution_requests WHERE request_id=?",
            (request_id,),
        ).fetchone()
        if existing is not None:
            if existing["intent_digest"] != identity:
                raise AdmissionConflict(
                    "request identity was reused with different intent"
                )
            return self._request(existing)
        if (
            source_command_id is not None
            and connection.execute(
                "SELECT 1 FROM execution_requests WHERE source=? AND source_command_id=?",
                (source, source_command_id),
            ).fetchone()
        ):
            raise AdmissionConflict(
                "source command already owns another request"
            )
        if message is not None and message["status"] != "pending":
            raise AdmissionConflict(
                "follow-up is already terminal or admitted"
            )
        sequence = connection.execute(
            "SELECT COALESCE(MAX(queue_seq),0)+1 FROM execution_requests WHERE project_id=?",
            (project_id,),
        ).fetchone()[0]
        timestamp = time.time() if now is None else now
        wait_reason = (
            None
            if _REQUIRED_CONFIGURATION <= payload.keys()
            else "configuration_required"
        )
        connection.execute(
            """INSERT INTO execution_requests
            (request_id,project_id,kind,envelope_json,envelope_digest,intent_digest,
             source,source_command_id,source_follow_up_request_id,source_message_digest,
             target_run_id,queue_seq,delivery_mode,status,wait_reason,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)""",
            (
                request_id,
                project_id,
                kind,
                _json(payload),
                envelope_digest,
                identity,
                source,
                source_command_id,
                source_follow_up_request_id,
                message_digest,
                target_run_id,
                sequence,
                delivery_mode,
                wait_reason,
                timestamp,
                timestamp,
            ),
        )
        self._set_delivery(
            connection, request_id, project_id, delivery_mode, timestamp
        )
        if delivery_mode == "send_now":
            self._record_delivery_operation(
                connection,
                operation_id="submit:" + _digest(request_id),
                request_id=request_id,
                project_id=project_id,
                delivery_mode=delivery_mode,
                now=timestamp,
            )
        return self._get(connection, request_id)

    def _record_delivery_operation(
        self,
        connection: sqlite3.Connection,
        *,
        operation_id: str,
        request_id: str,
        project_id: str,
        delivery_mode: str,
        now: float,
    ) -> None:
        """Bind the action to the currently admitted owner, including no owner.

        No process lookup or stop runs inside the transaction. The actual
        owner's scanner consumes the existing durable cancel intent; its
        finalizer alone can release the lease and barrier. A preparing claim
        is deliberately not a cancellation target.
        """
        self._require_transaction(connection)
        target = None
        cancel_request_id = None
        if delivery_mode == "send_now":
            target = connection.execute(
                """SELECT l.run_id,l.attempt_id,b.generation,r.cancel_request_id
                FROM project_run_execution_leases l
                JOIN runs r ON r.run_id=l.run_id AND r.project_id=l.project_id
                    AND (r.active_attempt_id=l.attempt_id
                         OR (r.active_attempt_id IS NULL AND r.status='interrupted'))
                JOIN execution_requests e ON e.admitted_run_id=l.run_id
                    AND e.admitted_attempt_id=l.attempt_id AND e.project_id=l.project_id
                    AND e.status='admitted'
                JOIN project_admission_claims c ON c.project_id=l.project_id
                    AND c.request_id=e.request_id AND c.state='handed_off'
                JOIN run_workspace_bindings b ON b.run_id=l.run_id
                    AND b.attempt_id=l.attempt_id AND b.generation=c.generation
                JOIN run_workspace_finalizations f ON f.run_id=l.run_id
                    AND f.owner_attempt_id=l.attempt_id AND f.generation=b.generation
                    AND f.state!='settled'
                WHERE l.project_id=? AND r.status NOT IN ('completed','failed','cancelled')""",
                (project_id,),
            ).fetchone()
            if target is not None:
                cancel_request_id = target["cancel_request_id"]
                if cancel_request_id is None:
                    cancel_request_id = "send-now:" + _digest(operation_id)
                    self.journal._request_cancel_in_transaction(
                        connection,
                        target["run_id"],
                        request_id=cancel_request_id,
                        reason="send_now",
                        now=now,
                    )
        connection.execute(
            """INSERT INTO execution_delivery_operations
            (operation_id,request_id,delivery_mode,target_run_id,target_attempt_id,
             target_generation,cancel_request_id,created_at)
            VALUES (?,?,?,?,?,?,?,?)""",
            (
                operation_id,
                request_id,
                delivery_mode,
                target["run_id"] if target else None,
                target["attempt_id"] if target else None,
                target["generation"] if target else None,
                cancel_request_id,
                now,
            ),
        )

    @staticmethod
    def _set_delivery(
        connection: sqlite3.Connection,
        request_id: str,
        project_id: str,
        delivery_mode: str,
        now: float,
    ) -> None:
        if delivery_mode == "send_now":
            # A preparing request retains its claim, but not an obsolete
            # priority. If preparation releases it, the latest user decision
            # must still determine the next head in both queue projections.
            connection.execute(
                """UPDATE execution_requests SET delivery_mode='wait',updated_at=?
                WHERE project_id=? AND status IN ('pending','preparing') AND request_id!=?""",
                (now, project_id, request_id),
            )
            connection.execute(
                """UPDATE follow_up_requests SET delivery_mode='wait',updated_at=?
                WHERE project_id=? AND status='pending' AND request_id!=?""",
                (now, project_id, request_id),
            )
        connection.execute(
            "UPDATE execution_requests SET delivery_mode=?,updated_at=? WHERE request_id=?",
            (delivery_mode, now, request_id),
        )
        connection.execute(
            """UPDATE follow_up_requests SET delivery_mode=?,updated_at=?
            WHERE request_id=(SELECT source_follow_up_request_id FROM execution_requests WHERE request_id=?)""",
            (delivery_mode, now, request_id),
        )

    def set_delivery_mode(
        self,
        request_id: str,
        delivery_mode: str,
        *,
        operation_id: str | None = None,
        now: float | None = None,
    ) -> ExecutionRequest:
        if delivery_mode not in {"wait", "send_now"}:
            raise ValueError("unsupported delivery mode")
        if operation_id is not None:
            _identifier(operation_id, "operation_id")
        operation_key = (
            "delivery:explicit:" + _digest(operation_id)
            if operation_id is not None
            else "delivery:compat:" + _digest([request_id, delivery_mode])
        )
        with self.journal._write_transaction() as connection:
            request = self._get(connection, request_id)
            previous = connection.execute(
                "SELECT request_id,delivery_mode FROM execution_delivery_operations WHERE operation_id=?",
                (operation_key,),
            ).fetchone()
            if previous is not None:
                if tuple(previous) != (request_id, delivery_mode):
                    raise AdmissionConflict(
                        "delivery operation identity was reused"
                    )
                return request
            if request.status != "pending":
                raise AdmissionConflict(
                    "only pending requests can change queue priority"
                )
            timestamp = time.time() if now is None else now
            self._set_delivery(
                connection,
                request_id,
                request.project_id,
                delivery_mode,
                timestamp,
            )
            self._record_delivery_operation(
                connection,
                operation_id=operation_key,
                request_id=request_id,
                project_id=request.project_id,
                delivery_mode=delivery_mode,
                now=timestamp,
            )
            return self._get(connection, request_id)

    @staticmethod
    def _head(connection: sqlite3.Connection, project_id: str) -> str | None:
        row = connection.execute(
            """SELECT request_id FROM execution_requests
            WHERE project_id=? AND status IN ('pending','preparing')
            ORDER BY CASE delivery_mode WHEN 'send_now' THEN 0 ELSE 1 END,queue_seq LIMIT 1""",
            (project_id,),
        ).fetchone()
        return str(row[0]) if row else None

    @staticmethod
    def _blocked(connection: sqlite3.Connection, project_id: str) -> bool:
        # Resume requires an explicit fenced-transfer adapter. Until that exists,
        # it observes the same fail-closed old-writer barriers as a normal start.
        return any(
            connection.execute(query, (project_id,)).fetchone() is not None
            for query in (
                "SELECT 1 FROM project_admission_claims WHERE project_id=? AND state!='released'",
                "SELECT 1 FROM project_run_execution_leases WHERE project_id=?",
                """SELECT 1 FROM run_workspace_finalizations f JOIN runs r ON r.run_id=f.run_id
            WHERE r.project_id=? AND f.state!='settled'""",
                "SELECT 1 FROM runs WHERE project_id=? AND status='interrupted'",
            )
        )

    def list_dispatch_candidates(
        self, *, after_project_id: str | None = None, limit: int = 100
    ) -> tuple[ExecutionRequest, ...]:
        """One eligible head per lane, rotating after the dispatcher's cursor.

        This is a snapshot, not a claim. claim() rechecks all guards atomically.
        A blocked/configuration-waiting head never permits FIFO overtaking.
        """
        if limit < 1:
            raise ValueError("candidate limit must be positive")
        with self.journal._lock:
            connection = self.journal._connection
            projects = [
                row[0]
                for row in connection.execute(
                    "SELECT DISTINCT project_id FROM execution_requests WHERE status='pending' ORDER BY project_id"
                )
            ]
            if after_project_id is not None:
                projects = [p for p in projects if p > after_project_id] + [
                    p for p in projects if p <= after_project_id
                ]
            candidates = []
            for project_id in projects:
                if self._blocked(connection, project_id):
                    continue
                head = self._head(connection, project_id)
                if head is None:
                    continue
                request = self._get(connection, head)
                if (
                    request.status == "pending"
                    and request.wait_reason != "configuration_required"
                ):
                    candidates.append(request)
                    if len(candidates) == limit:
                        break
            return tuple(candidates)

    def claim(
        self, request_id: str, *, owner_id: str, now: float | None = None
    ) -> AdmissionClaim | None:
        _identifier(owner_id, "owner_id")
        timestamp = time.time() if now is None else now
        with self.journal._write_transaction() as connection:
            request = self._get(connection, request_id)
            if (
                request.status != "pending"
                or request.wait_reason == "configuration_required"
                or self._head(connection, request.project_id) != request_id
                or self._blocked(connection, request.project_id)
            ):
                return None
            connection.execute(
                """INSERT INTO project_admission_claims
                (project_id,request_id,owner_id,generation,state,heartbeat_at)
                VALUES (?,?,?,1,'claimed',?)
                ON CONFLICT(project_id) DO UPDATE SET
                request_id=excluded.request_id,owner_id=excluded.owner_id,
                generation=project_admission_claims.generation+1,
                state='claimed',heartbeat_at=excluded.heartbeat_at""",
                (request.project_id, request_id, owner_id, timestamp),
            )
            connection.execute(
                "UPDATE execution_requests SET status='preparing',wait_reason=NULL,updated_at=? WHERE request_id=?",
                (timestamp, request_id),
            )
            row = connection.execute(
                "SELECT * FROM project_admission_claims WHERE project_id=?",
                (request.project_id,),
            ).fetchone()
            return AdmissionClaim(**dict(row))

    @staticmethod
    def require_claim_in_transaction(
        connection: sqlite3.Connection,
        claim: AdmissionClaim,
        *,
        state: str = "claimed",
    ) -> None:
        row = connection.execute(
            "SELECT * FROM project_admission_claims WHERE project_id=?",
            (claim.project_id,),
        ).fetchone()
        if row is None or (
            row["request_id"],
            row["owner_id"],
            row["generation"],
            row["state"],
        ) != (claim.request_id, claim.owner_id, claim.generation, state):
            raise AdmissionFenceLost("admission owner or generation changed")

    def heartbeat(
        self, claim: AdmissionClaim, *, now: float | None = None
    ) -> None:
        with self.journal._write_transaction() as connection:
            self.require_claim_in_transaction(connection, claim)
            connection.execute(
                "UPDATE project_admission_claims SET heartbeat_at=? WHERE project_id=?",
                (time.time() if now is None else now, claim.project_id),
            )

    def release(
        self,
        claim: AdmissionClaim,
        *,
        wait_reason: str | None = None,
        now: float | None = None,
    ) -> ExecutionRequest:
        """Release only this preparation owner; never expire or steal a lease."""
        with self.journal._write_transaction() as connection:
            self.require_claim_in_transaction(connection, claim)
            timestamp = time.time() if now is None else now
            connection.execute(
                "UPDATE project_admission_claims SET state='released',heartbeat_at=? WHERE project_id=?",
                (timestamp, claim.project_id),
            )
            connection.execute(
                "UPDATE execution_requests SET status='pending',wait_reason=?,updated_at=? WHERE request_id=? AND status='preparing'",
                (wait_reason, timestamp, claim.request_id),
            )
            return self._get(connection, claim.request_id)

    def cancel(
        self, request_id: str, *, now: float | None = None
    ) -> ExecutionRequest:
        """An admitted result redirects callers to exact Run/Attempt cancel."""
        with self.journal._write_transaction() as connection:
            request = self._get(connection, request_id)
            if request.status in {"admitted", "cancelled", "rejected"}:
                return request
            timestamp = time.time() if now is None else now
            connection.execute(
                "UPDATE execution_requests SET status='cancelled',wait_reason=NULL,updated_at=? WHERE request_id=?",
                (timestamp, request_id),
            )
            connection.execute(
                """UPDATE project_admission_claims SET state='released',heartbeat_at=?
                WHERE project_id=? AND request_id=? AND state='claimed'""",
                (timestamp, request.project_id, request_id),
            )
            connection.execute(
                """UPDATE follow_up_requests SET status='cancelled',updated_at=?
                WHERE request_id=? AND status='pending'""",
                (timestamp, request.source_follow_up_request_id),
            )
            return self._get(connection, request_id)

    def handoff(
        self,
        claim: AdmissionClaim,
        *,
        prepare_attempt: PrepareAttempt,
        now: float | None = None,
    ) -> ExecutionRequest:
        """Create Attempt, lease, binding and barrier in one database commit.

        prepare_attempt(connection, request, claim) is a PURE DATABASE callback.
        It must use the connection-taking journal helper (activate=False) and
        WorkspaceStateStore.bind_run_in_transaction; never call a public method
        that opens a nested transaction or do any filesystem/network work here.
        """
        with self.journal._write_transaction() as connection:
            request = self._get(connection, claim.request_id)
            if request.status == "admitted":
                self.require_claim_in_transaction(
                    connection, claim, state="handed_off"
                )
                return request
            self.require_claim_in_transaction(connection, claim)
            if request.status != "preparing":
                raise AdmissionFenceLost("request no longer accepts handoff")
            if request.source_follow_up_request_id is not None:
                message = connection.execute(
                    "SELECT * FROM follow_up_requests WHERE request_id=?",
                    (request.source_follow_up_request_id,),
                ).fetchone()
                if (
                    message is None
                    or message["status"] != "pending"
                    or self._message_digest(message)
                    != request.source_message_digest
                ):
                    raise AdmissionConflict(
                        "canonical follow-up changed or was cancelled"
                    )
            attempt = prepare_attempt(connection, request, claim)
            self.require_claim_in_transaction(connection, claim)
            expected_run = request.target_run_id or request.request_id
            row = connection.execute(
                """SELECT a.run_id,a.status,r.project_id,r.cancel_request_id
                FROM run_attempts a JOIN runs r ON r.run_id=a.run_id WHERE a.attempt_id=?""",
                (attempt.attempt_id,),
            ).fetchone()
            if row is None or (
                row["run_id"],
                row["project_id"],
                row["status"],
                row["cancel_request_id"],
            ) != (expected_run, request.project_id, "pending", None):
                raise AdmissionError(
                    "handoff requires the exact uncancelled pending Attempt"
                )
            lease = connection.execute(
                "SELECT run_id,attempt_id FROM project_run_execution_leases WHERE project_id=?",
                (request.project_id,),
            ).fetchone()
            if lease is None or tuple(lease) != (
                expected_run,
                attempt.attempt_id,
            ):
                raise AdmissionError(
                    "handoff requires its Project execution lease"
                )
            binding = connection.execute(
                """SELECT b.attempt_id,b.policy_version,f.owner_attempt_id,f.generation,f.state
                FROM run_workspace_bindings b JOIN run_workspace_finalizations f ON f.run_id=b.run_id
                WHERE b.run_id=? AND b.generation=?""",
                (expected_run, claim.generation),
            ).fetchone()
            if binding is None or tuple(binding) != (
                attempt.attempt_id,
                request.envelope["workspace_policy_version"],
                attempt.attempt_id,
                claim.generation,
                "pending",
            ):
                raise AdmissionError(
                    "handoff requires its workspace binding and pending finalization barrier"
                )
            timestamp = time.time() if now is None else now
            connection.execute(
                """UPDATE execution_requests SET status='admitted',admitted_run_id=?,
                admitted_attempt_id=?,wait_reason=NULL,updated_at=? WHERE request_id=?""",
                (
                    expected_run,
                    attempt.attempt_id,
                    timestamp,
                    request.request_id,
                ),
            )
            connection.execute(
                "UPDATE project_admission_claims SET state='handed_off',heartbeat_at=? WHERE project_id=?",
                (timestamp, request.project_id),
            )
            connection.execute(
                """UPDATE follow_up_requests SET status='admitted',admitted_run_id=?,last_error=NULL,updated_at=?
                WHERE request_id=? AND status='pending'""",
                (expected_run, timestamp, request.source_follow_up_request_id),
            )
            return self._get(connection, request.request_id)

    def release_settled_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        attempt_id: str,
        generation: int,
        now: float | None = None,
    ) -> None:
        """Finalizer composes this after settling and releasing its Run lease."""
        self._require_transaction(connection)
        row = connection.execute(
            """SELECT c.*,e.admitted_run_id,e.admitted_attempt_id FROM project_admission_claims c
            JOIN execution_requests e ON e.request_id=c.request_id
            WHERE e.admitted_run_id=? AND c.state IN ('handed_off','released')""",
            (run_id,),
        ).fetchone()
        if row is None:
            raise AdmissionFenceLost("no handed-off admission owns this Run")
        if (row["admitted_attempt_id"], row["generation"]) != (
            attempt_id,
            generation,
        ):
            raise AdmissionFenceLost(
                "finalizer cannot release another admission owner"
            )
        if row["state"] == "released":
            return
        barrier = connection.execute(
            "SELECT owner_attempt_id,generation,state FROM run_workspace_finalizations WHERE run_id=?",
            (run_id,),
        ).fetchone()
        if (
            barrier is None
            or tuple(barrier) != (attempt_id, generation, "settled")
            or connection.execute(
                "SELECT 1 FROM project_run_execution_leases WHERE project_id=?",
                (row["project_id"],),
            ).fetchone()
        ):
            raise AdmissionError(
                "admission remains blocked until finalization and execution lease release"
            )
        connection.execute(
            "UPDATE project_admission_claims SET state='released',heartbeat_at=? WHERE project_id=?",
            (time.time() if now is None else now, row["project_id"]),
        )
