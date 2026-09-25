"""Workspace facts in the same SQLite transactions as the Run journal.

This adapter deliberately uses the journal's connection and transaction lock.
Connection-taking helpers allow admission/finalization to compose one commit;
they never open a nested transaction or infer OS process death from a timeout.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.run_journal.store import SQLiteRunJournal


class WorkspaceStateError(RuntimeError):
    pass


class WorkspaceFenceLost(WorkspaceStateError):
    pass


class WorkspaceBusy(WorkspaceStateError):
    pass


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


@dataclass(frozen=True)
class TargetFence:
    target_id: str
    root_path: str
    physical_identity: str
    binding_version: int
    write_epoch: int
    receipt_cursor: int
    settled_revision: str | None
    state: str
    owner_kind: str | None
    owner_id: str | None
    owner_generation: int

    @property
    def available(self) -> bool:
        return self.state == "settled" and self.owner_id is None


class WorkspaceStateStore:
    def __init__(self, journal: SQLiteRunJournal) -> None:
        self.journal = journal

    def _require_transaction(self, connection: sqlite3.Connection) -> None:
        if (
            connection is not self.journal._connection
            or not connection.in_transaction
        ):
            raise WorkspaceStateError(
                "workspace mutation requires the journal write transaction"
            )

    @staticmethod
    def physical_identity(root: Path) -> tuple[str, str]:
        canonical = root.expanduser().resolve(strict=True)
        if not canonical.is_dir():
            raise WorkspaceStateError("workspace target is not a directory")
        stat = canonical.stat()
        return str(canonical), digest([stat.st_dev, stat.st_ino])

    @staticmethod
    def _target(connection: sqlite3.Connection, target_id: str) -> TargetFence:
        row = connection.execute(
            "SELECT * FROM workspace_physical_targets WHERE target_id = ?",
            (target_id,),
        ).fetchone()
        if row is None:
            raise WorkspaceStateError("unknown physical target")
        return TargetFence(**dict(row))

    @staticmethod
    def _require_fence(
        connection: sqlite3.Connection, expected: TargetFence
    ) -> TargetFence:
        current = WorkspaceStateStore._target(connection, expected.target_id)
        if current != expected:
            raise WorkspaceFenceLost("physical target boundary changed")
        return current

    def register_target(self, root: Path) -> TargetFence:
        root_path, identity = self.physical_identity(root)
        target_id = "physical_" + identity
        # Resolve aliases outside the writer transaction; recheck the exact
        # binding rows inside it before admitting any publisher.
        query = """SELECT repository_id,checkout_id,worktree_path,version
            FROM project_workspace_bindings ORDER BY project_id"""
        with self.journal._lock:
            bindings = [
                tuple(row) for row in self.journal._connection.execute(query)
            ]
        aliases = []
        for repository, checkout, path, _version in bindings:
            try:
                _canonical, observed = self.physical_identity(Path(path))
            except (OSError, WorkspaceStateError):
                continue
            if observed == identity:
                aliases.append((repository, checkout))
        with self.journal._write_transaction() as connection:
            if bindings != [tuple(row) for row in connection.execute(query)]:
                raise WorkspaceFenceLost(
                    "legacy bindings changed during discovery"
                )
            connection.execute(
                """INSERT OR IGNORE INTO workspace_physical_targets
                (target_id,root_path,physical_identity) VALUES (?,?,?)""",
                (target_id, root_path, identity),
            )
            target = self._target(connection, target_id)
            if target.root_path != root_path:
                raise WorkspaceFenceLost(
                    "target moved; explicit rebind required"
                )
            for repository, checkout in aliases:
                connection.execute(
                    """INSERT INTO workspace_legacy_targets VALUES (?,?,?)
                    ON CONFLICT(repository_id,checkout_id) DO UPDATE
                    SET target_id=excluded.target_id""",
                    (repository, checkout, target_id),
                )
            owners = connection.execute(
                """SELECT r.request_id FROM workspace_writer_requests r
                JOIN workspace_legacy_targets t USING(repository_id,checkout_id)
                WHERE t.target_id=? AND (r.status='acquired'
                    OR (r.status='interrupted' AND r.acquired_at IS NOT NULL))
                ORDER BY r.request_id""",
                (target_id,),
            ).fetchall()
            owner_ids = tuple(row[0] for row in owners)
            if owner_ids:
                if (
                    len(owner_ids) == 1
                    and target.owner_kind == "legacy"
                    and target.owner_id == owner_ids[0]
                ):
                    return target
                if len(owner_ids) == 1 and target.available:
                    return self.acquire_target_in_transaction(
                        connection,
                        target,
                        owner_kind="legacy",
                        owner_id=owner_ids[0],
                    )
                # Conflicting legacy owners must not be silently selected.
                connection.execute(
                    """UPDATE workspace_physical_targets
                    SET state='recovery_required',owner_kind='recovery',
                    owner_id=?,owner_generation=owner_generation+1,
                    write_epoch=write_epoch+1 WHERE target_id=?""",
                    ("legacy-ambiguity:" + digest(owner_ids), target_id),
                )
            return self._target(connection, target_id)

    @staticmethod
    def legacy_acquire_in_transaction(
        connection: sqlite3.Connection, request: sqlite3.Row
    ) -> bool:
        mapping = connection.execute(
            """SELECT target_id FROM workspace_legacy_targets
            WHERE repository_id=? AND checkout_id=?""",
            (request["repository_id"], request["checkout_id"]),
        ).fetchone()
        if mapping is None:
            return True  # Existing policy outside the registered capability.
        target = WorkspaceStateStore._target(connection, mapping[0])
        if not target.available:
            return False
        connection.execute(
            """UPDATE workspace_physical_targets SET state='writing',
            owner_kind='legacy',owner_id=?,owner_generation=owner_generation+1,
            write_epoch=write_epoch+1 WHERE target_id=?""",
            (request["request_id"], target.target_id),
        )
        return True

    def map_registered_legacy_binding(self, project_id: str) -> None:
        """Bring newly bound aliases into an already enabled target domain."""
        with self.journal._lock:
            binding = self.journal._connection.execute(
                "SELECT worktree_path FROM project_workspace_bindings WHERE project_id=?",
                (project_id,),
            ).fetchone()
        if binding is None:
            return
        root = Path(binding[0])
        try:
            _, identity = self.physical_identity(root)
        except (OSError, WorkspaceStateError):
            return
        with self.journal._lock:
            registered = self.journal._connection.execute(
                "SELECT 1 FROM workspace_physical_targets WHERE physical_identity=?",
                (identity,),
            ).fetchone()
        if registered:
            self.register_target(root)

    @staticmethod
    def legacy_requires_settlement(
        connection: sqlite3.Connection, request_id: str
    ) -> bool:
        return (
            connection.execute(
                """SELECT 1 FROM workspace_physical_targets
            WHERE owner_kind='legacy' AND owner_id=?
              AND state IN ('writing','recovery_required')""",
                (request_id,),
            ).fetchone()
            is not None
        )

    def settle_legacy_writer(
        self,
        owner: TargetFence,
        revision: str,
        *,
        process_receipt: dict[str, Any],
    ) -> TargetFence:
        """Release legacy lease only after the runtime confirms real stop.

        The old finish_task path cannot assert this receipt. Migration callers
        must reconcile process/tool/checkpoint state first, just like finalizers.
        """
        if (
            owner.owner_kind != "legacy"
            or process_receipt.get("outcome") != "stopped"
        ):
            raise WorkspaceStateError("legacy settlement needs verified stop")
        with self.journal._write_transaction() as connection:
            self._require_fence(connection, owner)
            connection.execute(
                "DELETE FROM workspace_writer_leases WHERE request_id=?",
                (owner.owner_id,),
            )
            connection.execute(
                """UPDATE workspace_writer_requests SET status='released',
                finished_at=?,updated_at=? WHERE request_id=?""",
                (time.time(), time.time(), owner.owner_id),
            )
            return self._settled_revision(connection, owner, revision)

    def target(self, target_id: str) -> TargetFence:
        with self.journal._lock:
            target = self._target(self.journal._connection, target_id)
        if self.physical_identity(Path(target.root_path)) != (
            target.root_path,
            target.physical_identity,
        ):
            raise WorkspaceFenceLost("target directory was replaced")
        return target

    def capture_fence(self, target_id: str) -> TargetFence:
        target = self.target(target_id)
        if not target.available:
            raise WorkspaceBusy("source_waiting_for_settlement")
        return target

    def retain_in_transaction(
        self, connection: sqlite3.Connection, revision: str, owner: str
    ) -> None:
        self._require_transaction(connection)
        if not revision or not owner:
            raise ValueError("retention requires revision and owner")
        connection.execute(
            """INSERT OR IGNORE INTO workspace_revision_references
            (revision,owner) VALUES (?,?)""",
            (revision, owner),
        )

    def retain(self, revision: str, owner: str) -> None:
        with self.journal._write_transaction() as connection:
            self.retain_in_transaction(connection, revision, owner)

    def release(self, revision: str, owner: str) -> None:
        with self.journal._write_transaction() as connection:
            connection.execute(
                "DELETE FROM workspace_revision_references WHERE revision=? AND owner=?",
                (revision, owner),
            )

    def references(self, revision: str) -> tuple[str, ...]:
        with self.journal._lock:
            return tuple(
                row[0]
                for row in self.journal._connection.execute(
                    "SELECT owner FROM workspace_revision_references WHERE revision=? ORDER BY owner",
                    (revision,),
                )
            )

    def accept_capture(
        self, expected: TargetFence, revision: str, owner: str
    ) -> None:
        """Commit the final source fence and retention in one transaction."""
        self.target(
            expected.target_id
        )  # Detect a replaced root before commit.
        with self.journal._write_transaction() as connection:
            current = self._require_fence(connection, expected)
            if not current.available:
                raise WorkspaceBusy("source_waiting_for_settlement")
            self.retain_in_transaction(connection, revision, owner)

    def record_observed_revision(
        self, expected: TargetFence, revision: str
    ) -> TargetFence:
        """Record a captured, settled live source; not an external-write CAS."""
        with self.journal._write_transaction() as connection:
            current = self._require_fence(connection, expected)
            if not current.available:
                raise WorkspaceBusy("source_waiting_for_settlement")
            if current.settled_revision == revision:
                return current
            return self._settled_revision(connection, current, revision)

    def acquire_target(
        self, expected: TargetFence, *, owner_kind: str, owner_id: str
    ) -> TargetFence:
        if (
            owner_kind not in {"integration", "legacy", "recovery"}
            or not owner_id
        ):
            raise ValueError("invalid target owner")
        self.target(expected.target_id)
        with self.journal._write_transaction() as connection:
            return self.acquire_target_in_transaction(
                connection, expected, owner_kind=owner_kind, owner_id=owner_id
            )

    def acquire_target_in_transaction(
        self,
        connection: sqlite3.Connection,
        expected: TargetFence,
        *,
        owner_kind: str,
        owner_id: str,
    ) -> TargetFence:
        self._require_transaction(connection)
        if (
            owner_kind not in {"integration", "legacy", "recovery"}
            or not owner_id
        ):
            raise ValueError("invalid target owner")
        current = self._require_fence(connection, expected)
        if not current.available:
            raise WorkspaceBusy("physical target is not settled")
        connection.execute(
            """UPDATE workspace_physical_targets SET state='writing',
            owner_kind=?,owner_id=?,owner_generation=owner_generation+1,
            write_epoch=write_epoch+1 WHERE target_id=?""",
            (owner_kind, owner_id, current.target_id),
        )
        return self._target(connection, current.target_id)

    def require_recovery(self, owner: TargetFence) -> TargetFence:
        with self.journal._write_transaction() as connection:
            self._require_fence(connection, owner)
            if owner.owner_id is None:
                raise WorkspaceStateError("recovery requires an owner")
            connection.execute(
                """UPDATE workspace_physical_targets SET state='recovery_required'
                WHERE target_id=?""",
                (owner.target_id,),
            )
            return self._target(connection, owner.target_id)

    def settle_target(self, owner: TargetFence, revision: str) -> TargetFence:
        with self.journal._write_transaction() as connection:
            current = self._require_fence(connection, owner)
            if current.owner_id is None:
                raise WorkspaceStateError("settlement requires an owner")
            return self._settled_revision(connection, current, revision)

    def abort_prepared_publication_in_transaction(
        self, connection: sqlite3.Connection, owner: TargetFence
    ) -> TargetFence:
        """Release an exact journaled owner before any filesystem dispatch.

        A dispatched or uncertain operation requires reconciliation; it can
        never use this shortcut. The last settled content boundary is kept,
        while the epoch changes so earlier live captures cannot be accepted.
        """
        self._require_transaction(connection)
        current = self._require_fence(connection, owner)
        operation = connection.execute(
            """SELECT target_id,owner_generation,status
            FROM workspace_publication_operations WHERE operation_id=?""",
            (owner.owner_id,),
        ).fetchone()
        if (
            current.owner_kind != "integration"
            or current.state != "writing"
            or operation is None
            or tuple(operation)
            != (current.target_id, current.owner_generation, "prepared")
        ):
            raise WorkspaceStateError(
                "only an undispatched publication can be aborted"
            )
        connection.execute(
            "UPDATE workspace_publication_operations SET status='aborted' WHERE operation_id=?",
            (current.owner_id,),
        )
        connection.execute(
            """UPDATE workspace_physical_targets SET state='settled',
            owner_kind=NULL,owner_id=NULL,write_epoch=write_epoch+1 WHERE target_id=?""",
            (current.target_id,),
        )
        self._promote_legacy_in_transaction(connection, current.target_id)
        return self._target(connection, current.target_id)

    def _settled_revision(
        self,
        connection: sqlite3.Connection,
        current: TargetFence,
        revision: str,
    ) -> TargetFence:
        self._require_transaction(connection)
        if not revision:
            raise ValueError("settled revision is required")
        cursor = current.receipt_cursor + 1
        epoch = current.write_epoch + 1
        connection.execute(
            """INSERT INTO workspace_target_revisions
            (target_id,receipt_cursor,write_epoch,revision) VALUES (?,?,?,?)""",
            (current.target_id, cursor, epoch, revision),
        )
        self.retain_in_transaction(
            connection, revision, f"target:{current.target_id}:{cursor}"
        )
        connection.execute(
            """UPDATE workspace_physical_targets SET state='settled',
            owner_kind=NULL,owner_id=NULL,write_epoch=?,receipt_cursor=?,
            settled_revision=? WHERE target_id=?""",
            (epoch, cursor, revision, current.target_id),
        )
        if current.owner_id is not None:
            self._promote_legacy_in_transaction(connection, current.target_id)
        return self._target(connection, current.target_id)

    def _promote_legacy_in_transaction(
        self, connection: sqlite3.Connection, target_id: str
    ) -> None:
        self._require_transaction(connection)
        queued = connection.execute(
            """SELECT r.request_id FROM workspace_writer_requests r
            JOIN workspace_legacy_targets t USING(repository_id,checkout_id)
            WHERE t.target_id=? AND r.status='queued'
            ORDER BY r.created_at,r.request_id LIMIT 1""",
            (target_id,),
        ).fetchone()
        if queued is not None:
            self.journal._acquire_workspace_writer_in_transaction(
                connection, request_id=queued[0], now=time.time()
            )

    def revision_at(self, target_id: str, cursor: int) -> str:
        with self.journal._lock:
            row = self.journal._connection.execute(
                """SELECT revision FROM workspace_target_revisions
                WHERE target_id=? AND receipt_cursor=?""",
                (target_id, cursor),
            ).fetchone()
        if row is None:
            raise WorkspaceStateError("target history is unavailable")
        return str(row[0])

    def bind_run_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        attempt_id: str,
        generation: int,
        workspace_id: str,
        provider: str,
        snapshot_revision: str,
        root_path: str,
        target: TargetFence,
        policy_version: str,
    ) -> None:
        """Admission must call this before committing its Attempt/lease."""
        self._require_transaction(connection)
        attempt = connection.execute(
            """SELECT a.run_id,a.status,r.active_attempt_id,l.attempt_id
            FROM run_attempts a JOIN runs r ON r.run_id=a.run_id
            LEFT JOIN project_run_execution_leases l ON l.project_id=r.project_id
            WHERE a.attempt_id=?""",
            (attempt_id,),
        ).fetchone()
        if (
            attempt is None
            or tuple(attempt) != (run_id, "pending", attempt_id, attempt_id)
            or generation < 1
        ):
            raise WorkspaceStateError("workspace owner does not match Attempt")
        if connection.execute(
            "SELECT 1 FROM run_workspace_finalizations WHERE run_id=?",
            (run_id,),
        ).fetchone():
            raise WorkspaceStateError("existing Run requires fenced transfer")
        current = self._target(connection, target.target_id)
        if current.binding_version != target.binding_version:
            raise WorkspaceFenceLost("target binding changed")
        connection.execute(
            """INSERT INTO run_workspace_bindings
            (run_id,generation,attempt_id,workspace_id,provider,
             snapshot_revision,root_path,target_id,target_binding_version,
             policy_version) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                run_id,
                generation,
                attempt_id,
                workspace_id,
                provider,
                snapshot_revision,
                root_path,
                target.target_id,
                target.binding_version,
                policy_version,
            ),
        )
        connection.execute(
            """INSERT INTO run_workspace_finalizations
            (run_id,owner_attempt_id,generation) VALUES (?,?,?)""",
            (run_id, attempt_id, generation),
        )
        self.retain_in_transaction(
            connection, snapshot_revision, f"run:{run_id}:input"
        )

    @staticmethod
    def _finalizer(
        connection: sqlite3.Connection,
        run_id: str,
        attempt_id: str,
        generation: int,
    ) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM run_workspace_finalizations WHERE run_id=?",
            (run_id,),
        ).fetchone()
        if row is None or (row["owner_attempt_id"], row["generation"]) != (
            attempt_id,
            generation,
        ):
            raise WorkspaceFenceLost("finalizer owner is stale or absent")
        return row

    def record_writer_settlement(
        self,
        *,
        run_id: str,
        attempt_id: str,
        generation: int,
        process_receipt: dict[str, Any],
    ) -> None:
        """Persist the runtime's verified stop receipt, never a TTL inference.

        This method is an internal capability boundary. The runtime must verify
        process birth identities and all tool outcomes before issuing a receipt.
        It is not exposed as a client assertion or automatic startup shortcut.
        """
        if not process_receipt or process_receipt.get("outcome") != "stopped":
            raise WorkspaceStateError("verified writer stop receipt required")
        encoded = canonical_json(process_receipt)
        with self.journal._write_transaction() as connection:
            row = self._finalizer(connection, run_id, attempt_id, generation)
            if row["writer_settlement_json"] not in (None, encoded):
                raise WorkspaceStateError("writer settlement receipt changed")
            if row["state"] == "settled":
                return
            connection.execute(
                """UPDATE run_workspace_finalizations SET state='settling',
                writer_settlement_json=? WHERE run_id=?""",
                (encoded, run_id),
            )

    def finalize_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        attempt_id: str,
        generation: int,
        checkpoint_revision: str,
        manifest_digest: str,
        outcome: str,
        changed_paths: dict[str, str],
    ) -> str | None:
        """Settle the barrier and outbox with the caller's terminal event.

        changed_paths maps each affected relative path to an explicit atomic
        publication group. Only successful finalization creates publication.
        Caller validates checkpoint and immutable artifact content first.
        """
        self._require_transaction(connection)
        if outcome not in {"completed", "failed", "cancelled", "interrupted"}:
            raise ValueError("invalid finalization outcome")
        if not checkpoint_revision or not manifest_digest:
            raise ValueError("immutable checkpoint and manifest are required")
        run = connection.execute(
            "SELECT status,cancel_request_id FROM runs WHERE run_id=?",
            (run_id,),
        ).fetchone()
        if run is None or run["status"] != outcome:
            raise WorkspaceStateError(
                "finalization must match the committed Run outcome"
            )
        if outcome == "completed" and run["cancel_request_id"] is not None:
            raise WorkspaceStateError(
                "cancelled intent cannot publish successful output"
            )
        row = self._finalizer(connection, run_id, attempt_id, generation)
        receipt = canonical_json(
            {
                "run_id": run_id,
                "attempt_id": attempt_id,
                "generation": generation,
                "checkpoint_revision": checkpoint_revision,
                "manifest_digest": manifest_digest,
                "outcome": outcome,
                "changed_paths": changed_paths,
            }
        )
        if row["state"] == "settled":
            if row["receipt_json"] != receipt:
                raise WorkspaceStateError(
                    "settled finalization cannot be rewritten"
                )
        elif row["state"] != "settling" or not row["writer_settlement_json"]:
            raise WorkspaceBusy(
                "writer must stop before checkpoint publication"
            )
        binding = connection.execute(
            "SELECT * FROM run_workspace_bindings WHERE run_id=? AND generation=?",
            (run_id, generation),
        ).fetchone()
        assert binding is not None
        connection.execute(
            """UPDATE run_workspace_finalizations SET state='settled',
            checkpoint_revision=?,manifest_digest=?,outcome=?,receipt_json=?
            WHERE run_id=?""",
            (checkpoint_revision, manifest_digest, outcome, receipt, run_id),
        )
        self.retain_in_transaction(
            connection, checkpoint_revision, f"run:{run_id}:output"
        )
        self.retain_in_transaction(
            connection, manifest_digest, f"run:{run_id}:artifact"
        )
        request_id = None
        if outcome == "completed" and changed_paths:
            request_id = self._enqueue_in_transaction(
                connection,
                binding=binding,
                receipt=receipt,
                checkpoint_revision=checkpoint_revision,
                changed_paths=changed_paths,
            )
        connection.execute(
            "DELETE FROM project_run_execution_leases WHERE run_id=? AND attempt_id=?",
            (run_id, attempt_id),
        )
        if connection.execute(
            """SELECT 1 FROM project_admission_claims c
            JOIN execution_requests e USING(request_id)
            WHERE e.admitted_run_id=? AND c.state='handed_off'""",
            (run_id,),
        ).fetchone():
            from .admission import AdmissionStore

            AdmissionStore(self.journal).release_settled_in_transaction(
                connection,
                run_id=run_id,
                attempt_id=attempt_id,
                generation=generation,
            )
        return request_id

    def _enqueue_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        binding: sqlite3.Row,
        receipt: str,
        checkpoint_revision: str,
        changed_paths: dict[str, str],
    ) -> str:
        self._require_transaction(connection)
        from .content import relative_path

        identity = [
            binding["run_id"],
            checkpoint_revision,
            binding["target_binding_version"],
            binding["policy_version"],
        ]
        request_id = "integration_" + digest(identity)
        project_id = connection.execute(
            "SELECT project_id FROM runs WHERE run_id=?", (binding["run_id"],)
        ).fetchone()[0]
        payload_digest = digest([dict(binding), receipt, changed_paths])
        duplicate = connection.execute(
            "SELECT payload_digest FROM workspace_integration_requests WHERE request_id=?",
            (request_id,),
        ).fetchone()
        if duplicate:
            if duplicate[0] != payload_digest:
                raise WorkspaceStateError(
                    "integration idempotency key was reused"
                )
            return request_id
        for path, group in changed_paths.items():
            relative_path(path)
            if not isinstance(group, str) or not group or "\x00" in group:
                raise ValueError("invalid publication path or group")
        connection.execute(
            """INSERT INTO workspace_integration_requests
            (request_id,run_id,project_id,target_id,target_binding_version,
             policy_version,input_revision,output_revision,
             finalizer_receipt_json,payload_digest,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                request_id,
                binding["run_id"],
                project_id,
                binding["target_id"],
                binding["target_binding_version"],
                binding["policy_version"],
                binding["snapshot_revision"],
                checkpoint_revision,
                receipt,
                payload_digest,
                time.time(),
            ),
        )
        for path, group in sorted(changed_paths.items()):
            predecessor = connection.execute(
                """SELECT p.change_id FROM workspace_integration_paths p
                JOIN workspace_integration_requests r USING(request_id)
                WHERE r.project_id=? AND r.target_id=? AND p.relative_path=?
                  AND r.request_id != ?
                ORDER BY r.rowid DESC LIMIT 1""",
                (project_id, binding["target_id"], path, request_id),
            ).fetchone()
            connection.execute(
                """INSERT INTO workspace_integration_paths
                (change_id,request_id,relative_path,group_id,predecessor_change_id)
                VALUES (?,?,?,?,?)""",
                (
                    digest([request_id, path]),
                    request_id,
                    path,
                    group,
                    predecessor[0] if predecessor else None,
                ),
            )
        for revision in (binding["snapshot_revision"], checkpoint_revision):
            self.retain_in_transaction(connection, revision, request_id)
        return request_id
