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

"""Settle a sealed runtime and atomically publish its immutable Run outcome.

Filesystem/process work happens before the final journal transaction. Artifact
reads resolve only retained CAS objects; no mutable directory or legacy artifact
scanner is consulted. Both runtime adapters must supply their exact live settlement proof.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any

from .admission import ExecutionRequest
from .bound_runtime import BoundRuntime, VerifiedSettlement
from .content import ContentIntegrityError, canonical_json, content_digest
from .native_runtime import (
    NATIVE_POLICY_VERSION,
    NativeAgentRuntime,
    NativeRunOwner,
)
from .provider import (
    DirectoryWorkspaceProvider,
    WorkspaceHandle,
    WorkspaceRevision,
)
from .store import WorkspaceFenceLost, WorkspaceStateError, WorkspaceStateStore

if TYPE_CHECKING:
    from app.run_journal.store import SQLiteRunJournal


_OUTCOMES = {"completed", "failed", "cancelled", "interrupted"}
_TERMINAL = {"completed", "failed", "cancelled"}
_ARTIFACT_SCHEMA = "isolated_artifacts.v1"


class WorkspaceFinalizer:
    def __init__(self, journal: SQLiteRunJournal) -> None:
        self.journal = journal
        self.state = WorkspaceStateStore(journal)
        self._locks: dict[tuple[str, str, int], asyncio.Lock] = {}

    def _owner(
        self,
        connection: sqlite3.Connection,
        request: ExecutionRequest | NativeRunOwner,
        runtime: BoundRuntime | NativeAgentRuntime,
    ) -> sqlite3.Row:
        owner = runtime.binding
        if isinstance(request, NativeRunOwner):
            policy = connection.execute(
                """SELECT policy_version FROM run_workspace_bindings
                WHERE run_id=? AND attempt_id=? AND generation=?""",
                (owner.run_id, owner.attempt_id, owner.generation),
            ).fetchone()
            if (
                (request.run_id, request.attempt_id)
                != (owner.run_id, owner.attempt_id)
                or policy is None
                or policy[0] != NATIVE_POLICY_VERSION
            ):
                raise WorkspaceFenceLost(
                    "ordinary Run does not own finalization"
                )
        else:
            durable = connection.execute(
                """SELECT project_id,intent_digest,status,admitted_run_id,
                admitted_attempt_id FROM execution_requests WHERE request_id=?""",
                (request.request_id,),
            ).fetchone()
            if durable is None or tuple(durable) != (
                request.project_id,
                request.intent_digest,
                "admitted",
                owner.run_id,
                owner.attempt_id,
            ):
                raise WorkspaceFenceLost(
                    "execution request does not own finalization"
                )
        row = self.state._finalizer(
            connection, owner.run_id, owner.attempt_id, owner.generation
        )
        binding = connection.execute(
            """SELECT attempt_id,workspace_id,provider,snapshot_revision,
            root_path FROM run_workspace_bindings WHERE run_id=? AND generation=?""",
            (owner.run_id, owner.generation),
        ).fetchone()
        workspace = owner.workspace
        if binding is None or tuple(binding) != (
            owner.attempt_id,
            workspace.workspace_id,
            workspace.provider,
            workspace.input_revision,
            str(workspace.local_root),
        ):
            raise WorkspaceFenceLost(
                "runtime workspace does not own finalization"
            )
        run = connection.execute(
            "SELECT project_id FROM runs WHERE run_id=?", (owner.run_id,)
        ).fetchone()
        if run is None or run[0] != request.project_id:
            raise WorkspaceFenceLost("finalization Project changed")
        return row

    def _assert_owner(
        self,
        request: ExecutionRequest | NativeRunOwner,
        runtime: BoundRuntime | NativeAgentRuntime,
        proof: VerifiedSettlement,
        handle: WorkspaceHandle,
    ) -> None:
        if handle != runtime.binding.workspace:
            raise WorkspaceFenceLost("checkpoint changed workspace owner")
        runtime.verify_settlement(proof)
        with self.journal._lock:
            self._owner(self.journal._connection, request, runtime)

    async def finalize(
        self,
        request: ExecutionRequest | NativeRunOwner,
        runtime: BoundRuntime | NativeAgentRuntime,
        provider: DirectoryWorkspaceProvider,
        result: str,
        outcome: str,
    ) -> str:
        """Return the immutable checkpoint id after stop, capture and commit.

        A durable cancel wins over a proposed successful result. Existing Run
        terminal facts stay unchanged; recovery adds the settled manifest. Any
        failure retains the barrier and execution/admission ownership.
        """
        if outcome not in _OUTCOMES or not isinstance(result, str):
            raise ValueError(
                "finalization requires a result and supported outcome"
            )
        owner = runtime.binding
        key = (owner.run_id, owner.attempt_id, owner.generation)
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            try:
                with self.journal._lock:
                    previous = self._owner(
                        self.journal._connection, request, runtime
                    )
                if previous["state"] == "settled":
                    provider.store.read_blob(previous["manifest_digest"])
                    provider.store.get_manifest(
                        previous["checkpoint_revision"]
                    )
                    return str(previous["checkpoint_revision"])
                proof = await runtime.stop()
                receipt = runtime.verify_settlement(proof)
                await asyncio.to_thread(
                    self.state.record_writer_settlement,
                    run_id=owner.run_id,
                    attempt_id=owner.attempt_id,
                    generation=owner.generation,
                    process_receipt=receipt,
                )
                checkpoint, provenance = await asyncio.to_thread(
                    self._checkpoint, request, runtime, provider, proof
                )
                payload, manifest_digest = await asyncio.to_thread(
                    self._artifact_payload,
                    runtime,
                    provider,
                    checkpoint,
                    provenance,
                )
                # A child terminated by stop did not successfully complete its
                # program. Its partial bytes remain recovery artifacts only.
                if outcome == "completed" and any(
                    code != 0 for _, code in proof.process_instances
                ):
                    outcome = "failed"
                return await asyncio.to_thread(
                    self._commit,
                    request,
                    runtime,
                    checkpoint,
                    provenance,
                    payload,
                    manifest_digest,
                    result,
                    outcome,
                )
            except BaseException as exc:
                try:
                    self.mark_needs_attention(
                        run_id=owner.run_id,
                        attempt_id=owner.attempt_id,
                        generation=owner.generation,
                        reason=type(exc).__name__,
                    )
                except WorkspaceFenceLost:
                    pass
                raise

    def _checkpoint(
        self,
        request: ExecutionRequest | NativeRunOwner,
        runtime: BoundRuntime | NativeAgentRuntime,
        provider: DirectoryWorkspaceProvider,
        proof: VerifiedSettlement,
    ) -> tuple[WorkspaceRevision, dict[str, str]]:
        def verify(handle: WorkspaceHandle) -> None:
            self._assert_owner(request, runtime, proof, handle)

        output = DirectoryWorkspaceProvider.checkpoint(
            provider,
            runtime.binding.workspace,
            assert_owner=verify,
            mutation_receipts=runtime.mutation_receipts,
        )
        provenance = runtime.path_provenance(output.changed_paths)
        if runtime.binding.workspace.provider == "git":
            # Git records only exact receipt-backed changes, while the base
            # checkpoint retains the entire I/O directory in private CAS.
            from .git_provider import GitWorkspaceProvider

            if not isinstance(provider, GitWorkspaceProvider):
                raise WorkspaceStateError(
                    "Git workspace requires its Git provider"
                )
            managed = provider.checkpoint(
                runtime.binding.workspace,
                assert_owner=verify,
                mutation_receipts=runtime.mutation_receipts,
                path_provenance=provenance,
            )
            if (
                managed.revision_id != output.revision_id
                or managed.changed_paths != output.changed_paths
            ):
                raise WorkspaceStateError(
                    "workspace changed between checkpoint layers"
                )
            output = managed
        verify(runtime.binding.workspace)
        return output, provenance

    @staticmethod
    def _artifact_payload(
        runtime: BoundRuntime | NativeAgentRuntime,
        provider: DirectoryWorkspaceProvider,
        checkpoint: WorkspaceRevision,
        provenance: dict[str, str],
    ) -> tuple[dict[str, Any], str]:
        owner = runtime.binding
        manifest = provider.store.get_manifest(checkpoint.revision_id)
        artifacts = []
        for entry in manifest.entries:
            if entry.kind != "file" or entry.path not in provenance:
                continue
            # Verify retained bytes before exposing the finalized manifest.
            if len(provider.store.read_blob(entry.digest)) != entry.size:
                raise ContentIntegrityError("checkpoint artifact size changed")
            identity = content_digest(
                canonical_json(
                    [owner.run_id, checkpoint.revision_id, entry.path]
                )
            )
            artifacts.append(
                {
                    "artifact_id": "ia_" + identity[:61],
                    "filename": PurePosixPath(entry.path).name,
                    "relativePath": entry.path,
                    "size": entry.size,
                    "content_digest": entry.digest,
                    "checkpoint_revision": checkpoint.revision_id,
                    "storage": "workspace_cas",
                    "uploadPolicy": "agent_generated",
                    "mutation_receipt": provenance[entry.path],
                }
            )
        payload = {
            "schema": _ARTIFACT_SCHEMA,
            "run_id": owner.run_id,
            "attempt_id": owner.attempt_id,
            "generation": owner.generation,
            "checkpoint_revision": checkpoint.revision_id,
            "provider": checkpoint.provider,
            "artifacts": artifacts,
            "artifact_count": len(artifacts),
            "scan_status": "complete",
            "truncated": False,
        }
        if checkpoint.provider == "git":
            payload["git_checkpoint"] = {
                "base_commit": checkpoint.overlay_preimage_commit
                or owner.workspace.input_commit,
                "commit": checkpoint.git_commit,
                "tree": checkpoint.git_tree,
                "ref": checkpoint.git_ref,
            }
        return payload, provider.store.put_blob(canonical_json(payload))

    def _commit(
        self,
        request: ExecutionRequest | NativeRunOwner,
        runtime: BoundRuntime | NativeAgentRuntime,
        checkpoint: WorkspaceRevision,
        provenance: dict[str, str],
        payload: dict[str, Any],
        manifest_digest: str,
        result: str,
        outcome: str,
    ) -> str:
        from app.run_journal.models import RunEventDraft

        owner = runtime.binding
        with self.journal._write_transaction() as connection:
            final = self._owner(connection, request, runtime)
            if final["state"] == "settled":
                return str(final["checkpoint_revision"])
            run = connection.execute(
                "SELECT status,cancel_request_id FROM runs WHERE run_id=?",
                (owner.run_id,),
            ).fetchone()
            existing_terminal = run["status"] in _TERMINAL
            effective = (
                run["status"]
                if existing_terminal
                else "cancelled"
                if run["cancel_request_id"] is not None
                else outcome
            )
            manifest = self.journal._append_event_in_transaction(
                connection,
                owner.run_id,
                RunEventDraft(
                    event_id="am_" + manifest_digest[:61],
                    event_type="artifact.manifest.finalized",
                    payload={**payload, "manifest_digest": manifest_digest},
                ),
                expected_project_id=request.project_id,
            )
            identity = content_digest(
                canonical_json(
                    [owner.run_id, owner.attempt_id, owner.generation]
                )
            )[:48]
            if not existing_terminal:
                terminal = RunEventDraft(
                    event_id=f"wf_{identity}",
                    event_type="runtime.interrupted"
                    if effective == "interrupted"
                    else "run." + effective,
                    payload={
                        "attempt_id": owner.attempt_id,
                        "generation": owner.generation,
                        "reason": "isolated_workspace_finalized",
                    },
                )
                if effective == "completed":
                    self.journal._complete_successful_run_in_transaction(
                        connection,
                        owner.run_id,
                        assistant_final=RunEventDraft(
                            event_id=f"af_{identity}",
                            event_type="assistant.final",
                            payload={"message": result},
                            legacy_step="end",
                        ),
                        terminal=terminal,
                        artifact_manifest=manifest,
                        expected_project_id=request.project_id,
                    )
                elif effective == "interrupted":
                    self.journal._append_event_in_transaction(
                        connection,
                        owner.run_id,
                        RunEventDraft(
                            event_id=terminal.event_id,
                            event_type=terminal.event_type,
                            payload={
                                **terminal.payload,
                                "artifact_manifest_event_id": manifest.event_id,
                                "artifact_count": payload["artifact_count"],
                            },
                        ),
                        run_status="interrupted",
                        clear_active_attempt=True,
                        expected_project_id=request.project_id,
                    )
                    connection.execute(
                        """UPDATE run_attempts SET status='interrupted',
                        ended_at=COALESCE(ended_at,?),outcome=COALESCE(outcome,?)
                        WHERE attempt_id=?""",
                        (
                            terminal.created_at,
                            terminal.event_type,
                            owner.attempt_id,
                        ),
                    )
                else:
                    self.journal._append_terminal_with_latest_artifact_manifest_in_transaction(
                        connection,
                        owner.run_id,
                        terminal,
                        expected_project_id=request.project_id,
                    )
            self.state.finalize_in_transaction(
                connection,
                run_id=owner.run_id,
                attempt_id=owner.attempt_id,
                generation=owner.generation,
                checkpoint_revision=checkpoint.revision_id,
                manifest_digest=manifest_digest,
                outcome=effective,
                changed_paths=provenance,
            )
            return checkpoint.revision_id

    def mark_needs_attention(
        self,
        *,
        run_id: str,
        attempt_id: str,
        generation: int,
        reason: str = "finalization_failed",
    ) -> bool:
        """Keep the exact owner's barrier and leases; never downgrade settled."""
        from app.run_journal.models import RunEventDraft

        with self.journal._write_transaction() as connection:
            row = self.state._finalizer(
                connection, run_id, attempt_id, generation
            )
            if row["state"] == "settled":
                return False
            connection.execute(
                """UPDATE run_workspace_finalizations SET state='needs_attention'
                WHERE run_id=? AND owner_attempt_id=? AND generation=?""",
                (run_id, attempt_id, generation),
            )
            identity = content_digest(
                canonical_json([run_id, attempt_id, generation, reason])
            )[:60]
            self.journal._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id="wn_" + identity,
                    event_type="workspace.finalization.needs_attention",
                    payload={
                        "attempt_id": attempt_id,
                        "generation": generation,
                        "reason": reason,
                    },
                ),
            )
            return True

    def artifact_manifest(
        self, *, run_id: str, provider: DirectoryWorkspaceProvider
    ) -> dict:
        with self.journal._lock:
            final = self.journal._connection.execute(
                "SELECT * FROM run_workspace_finalizations WHERE run_id=?",
                (run_id,),
            ).fetchone()
        if final is None or final["state"] != "settled":
            raise WorkspaceStateError("Run artifacts are not finalized")
        payload = json.loads(
            provider.store.read_blob(final["manifest_digest"])
        )
        if (
            payload.get("schema") != _ARTIFACT_SCHEMA
            or payload.get("run_id") != run_id
            or payload.get("attempt_id") != final["owner_attempt_id"]
            or payload.get("generation") != final["generation"]
            or payload.get("checkpoint_revision")
            != final["checkpoint_revision"]
        ):
            raise ContentIntegrityError("artifact manifest owner differs")
        return payload

    def read_artifact(
        self,
        *,
        run_id: str,
        artifact_id: str,
        provider: DirectoryWorkspaceProvider,
        offset: int = 0,
        length: int | None = None,
    ) -> bytes:
        if offset < 0 or (length is not None and length < 0):
            raise ValueError("invalid artifact byte range")
        payload = self.artifact_manifest(run_id=run_id, provider=provider)
        artifact = next(
            (
                item
                for item in payload["artifacts"]
                if item["artifact_id"] == artifact_id
            ),
            None,
        )
        if artifact is None:
            raise FileNotFoundError(artifact_id)
        value = provider.read(
            payload["checkpoint_revision"], artifact["relativePath"]
        )
        if (
            len(value) != artifact["size"]
            or content_digest(value) != artifact["content_digest"]
        ):
            raise ContentIntegrityError(
                "artifact bytes differ from finalized content"
            )
        return (
            value[offset:]
            if length is None
            else value[offset : offset + length]
        )
