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

"""Automatic, journaled file projection from immutable Run deltas.

Git and directory targets use the same byte projection: no Git commands,
index writes, commits or hooks. Managed writers share the physical target
owner. Checks against external writers are detection, NOT atomic filesystem
compare-and-replace. A process crash leaves its owner for explicit recovery.
"""

from __future__ import annotations

import logging
import os
import stat
import time
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

from .content import (
    ContentIntegrityError,
    InvalidWorkspacePath,
    ManifestEntry,
    WorkspaceManifest,
    relative_path,
)
from .execution import publication_execution
from .merge import MERGE_ALGORITHM_VERSION, FileVersion, merge_file
from .provider import (
    DirectoryWorkspaceProvider,
    SourceChangedError,
    SourceFence,
)
from .store import (
    TargetFence,
    WorkspaceBusy,
    WorkspaceFenceLost,
    WorkspaceStateError,
    WorkspaceStateStore,
    canonical_json,
    digest,
)

logger = logging.getLogger(__name__)


class IntegrationDeferred(WorkspaceStateError):
    """No target mutation is permitted for this attempt."""


class TargetProjectionChanged(SourceChangedError):
    def __init__(self, paths: tuple[str, ...]) -> None:
        super().__init__("target contains a third version")
        self.paths = paths


@dataclass(frozen=True)
class MergeCandidate:
    request_id: str
    worker_id: str
    worker_generation: int
    target_fence: TargetFence
    target_revision: str
    result_revision: str
    plan_json: str
    validation_json: str

    @property
    def candidate_digest(self) -> str:
        return digest([self.plan_json, self.validation_json])


@dataclass(frozen=True)
class IntegrationResult:
    request_id: str
    status: str
    operation_id: str | None = None
    revision: str | None = None
    wait_reason: str | None = None


_DONE = {"integrated", "equivalent", "resolved"}


def _decode(value: str) -> Any:
    import json

    return json.loads(value)


def _entry(value: dict[str, Any] | None) -> ManifestEntry | None:
    entry = ManifestEntry(**value) if value else None
    return None if entry is None or entry.kind == "tombstone" else entry


def _encoded(entry: ManifestEntry | None) -> dict[str, Any] | None:
    return asdict(entry) if entry is not None else None


def _entries(manifest: WorkspaceManifest) -> dict[str, ManifestEntry]:
    return {
        entry.path: entry
        for entry in manifest.entries
        if entry.kind != "tombstone"
    }


def _source_fence(fence: TargetFence) -> SourceFence:
    return SourceFence(
        fence.target_id,
        fence.physical_identity,
        fence.write_epoch,
        fence.settled_revision,
        fence.receipt_cursor,
        fence.state,
        fence.owner_id,
        binding_version=fence.binding_version,
    )


class WorkspaceIntegrationCoordinator:
    """One durable publication worker; callbacks are trusted local policies.

    Missing/raising/false authorization never writes. A missing custom
    validator means built-in structural checks only (not_configured), not a
    fictional test pass. There is no automatic worker takeover or TTL lease.
    Recovery by a different worker identity is deliberately refused.
    """

    def __init__(
        self,
        state: WorkspaceStateStore,
        provider: DirectoryWorkspaceProvider,
        *,
        authorize: Callable[[Mapping[str, Any]], bool] | None = None,
        validator: Callable[[MergeCandidate], bool] | None = None,
        worker_id: str | None = None,
    ) -> None:
        self.state = state
        self.provider = provider
        self.content = provider.store
        self.authorize = authorize
        self.validator = validator
        self.worker_id = worker_id or "integration-worker-" + uuid.uuid4().hex
        self._validated: set[str] = set()

    @property
    def journal(self):
        return self.state.journal

    @staticmethod
    def _request(connection, request_id: str) -> dict[str, Any]:
        row = connection.execute(
            "SELECT * FROM workspace_integration_requests WHERE request_id=?",
            (request_id,),
        ).fetchone()
        if row is None:
            raise WorkspaceStateError("unknown integration request")
        return dict(row)

    def _owned(self, connection, request_id: str, generation: int):
        request = self._request(connection, request_id)
        if (request["worker_id"], request["worker_generation"]) != (
            self.worker_id,
            generation,
        ):
            raise WorkspaceFenceLost("integration worker generation changed")
        return request

    def _authorized(self, request: Mapping[str, Any]) -> None:
        try:
            allowed = (
                self.authorize is not None
                and self.authorize(MappingProxyType(dict(request))) is True
            )
        except Exception:
            allowed = False
        if not allowed:
            raise IntegrationDeferred("authorization_required")

    def result(self, request_id: str) -> IntegrationResult:
        with self.journal._lock:
            request = self._request(self.journal._connection, request_id)
            operation = self.journal._connection.execute(
                """SELECT * FROM workspace_publication_operations
                WHERE request_id=? ORDER BY rowid DESC LIMIT 1""",
                (request_id,),
            ).fetchone()
        return IntegrationResult(
            request_id,
            request["status"],
            operation["operation_id"] if operation else None,
            operation["result_revision"] if operation else None,
            request["wait_reason"],
        )

    def _claim(self, request_id: str) -> int:
        with self.journal._write_transaction() as connection:
            request = self._request(connection, request_id)
            if request["status"] == "integrated":
                raise IntegrationDeferred("already_integrated")
            if time.time() < request["retry_after_at"]:
                raise WorkspaceBusy("integration retry backoff is active")
            if request["worker_id"] is not None:
                raise WorkspaceBusy("integration worker still owns request")
            unfinished = connection.execute(
                """SELECT 1 FROM workspace_publication_operations
                WHERE request_id=? AND status NOT IN
                ('completed','aborted') LIMIT 1""",
                (request_id,),
            ).fetchone()
            if unfinished:
                raise WorkspaceBusy("publication requires explicit recovery")
            generation = request["worker_generation"] + 1
            connection.execute(
                """UPDATE workspace_integration_requests SET worker_id=?,
                worker_generation=?,status='preparing',wait_reason=NULL,
                retry_after_at=0
                WHERE request_id=?""",
                (self.worker_id, generation, request_id),
            )
            return generation

    def _wait(self, request_id: str, generation: int, reason: str) -> None:
        with self.journal._write_transaction() as connection:
            request = self._owned(connection, request_id, generation)
            retry_after = time.time() + min(
                60, 2 ** min(request["attempts"], 6)
            )
            connection.execute(
                """UPDATE workspace_integration_requests SET status=?,
                worker_id=NULL,wait_reason=?,retry_after_at=? WHERE request_id=?""",
                (
                    "waiting_target_stable"
                    if reason == "target_changed"
                    else "waiting",
                    reason,
                    retry_after,
                    request_id,
                ),
            )

    def process(self, request_id: str) -> IntegrationResult:
        """One wakeup: at most two candidate/validation/publish attempts."""
        try:
            generation = self._claim(request_id)
        except (WorkspaceBusy, IntegrationDeferred):
            return self.result(request_id)
        for _ in range(2):
            try:
                candidate = self._prepare(request_id, generation)
                return self.publish(candidate)
            except (SourceChangedError, WorkspaceFenceLost):
                # Only pre-owner changes are retried. publish retains its
                # owner and returns needs_attention after any dispatch error.
                with self.journal._lock:
                    request = self._request(
                        self.journal._connection, request_id
                    )
                if (request["worker_id"], request["worker_generation"]) != (
                    self.worker_id,
                    generation,
                ):
                    return self.result(request_id)
            except (WorkspaceBusy, IntegrationDeferred) as exc:
                self._wait(request_id, generation, str(exc))
                return self.result(request_id)
            except Exception:
                self._wait(request_id, generation, "preparation_failed")
                return self.result(request_id)
        self._wait(request_id, generation, "target_changed")
        return self.result(request_id)

    def prepare(self, request_id: str) -> MergeCandidate:
        generation = self._claim(request_id)
        try:
            return self._prepare(request_id, generation)
        except Exception:
            self._wait(request_id, generation, "preparation_failed")
            raise

    def _prepare(self, request_id: str, generation: int) -> MergeCandidate:
        with self.journal._write_transaction() as connection:
            request = self._owned(connection, request_id, generation)
            finalizer = connection.execute(
                "SELECT * FROM run_workspace_finalizations WHERE run_id=?",
                (request["run_id"],),
            ).fetchone()
            if (
                finalizer is None
                or finalizer["state"] != "settled"
                or finalizer["outcome"] != "completed"
                or finalizer["receipt_json"]
                != request["finalizer_receipt_json"]
                or finalizer["checkpoint_revision"]
                != request["output_revision"]
            ):
                raise IntegrationDeferred("source_finalization_unverified")
            paths = [
                dict(row)
                for row in connection.execute(
                    """SELECT * FROM workspace_integration_paths
                WHERE request_id=? ORDER BY relative_path""",
                    (request_id,),
                )
            ]
            predecessors: dict[str, dict[str, Any]] = {}
            for path in paths:
                if not path["predecessor_change_id"]:
                    continue
                predecessor = connection.execute(
                    """SELECT p.change_id,p.status,p.resolution_revision,
                    p.relative_path,p.operation_id,r.project_id,r.target_id,
                    r.output_revision
                    FROM workspace_integration_paths p
                    JOIN workspace_integration_requests r USING(request_id)
                    WHERE p.change_id=?""",
                    (path["predecessor_change_id"],),
                ).fetchone()
                if predecessor is None or (
                    predecessor["project_id"],
                    predecessor["target_id"],
                ) != (request["project_id"], request["target_id"]):
                    raise WorkspaceStateError("invalid path predecessor")
                if predecessor["relative_path"] != path["relative_path"]:
                    raise WorkspaceStateError("invalid predecessor path")
                predecessors[path["change_id"]] = dict(predecessor)
            connection.execute(
                "UPDATE workspace_integration_requests SET attempts=attempts+1 WHERE request_id=?",
                (request_id,),
            )
        self._authorized(request)
        before = self.state.capture_fence(request["target_id"])
        if before.binding_version != request["target_binding_version"]:
            raise IntegrationDeferred("target_binding_changed")
        snapshot = self.provider.capture_source(
            Path(before.root_path),
            owner=f"candidate:{request_id}:{generation}",
            expected_fence=_source_fence(before),
            read_fence=lambda: _source_fence(
                self.state.capture_fence(before.target_id)
            ),
            commit_capture=lambda value, fence: self.state.accept_capture(
                before, value.revision_id, value.owner
            ),
        )
        base = self.content.get_manifest(request["input_revision"])
        source = self.content.get_manifest(request["output_revision"])
        target = self.content.get_manifest(snapshot.revision_id)
        plan, output = self._plan(
            request,
            paths,
            predecessors,
            base,
            source,
            target,
        )
        for item in plan:
            after = _entry(item["post"])
            if (
                item["status"] in _DONE
                and item["pre"] is None
                and after is not None
                and after.kind == "directory"
                and after.mode & 0o700 != 0o700
            ):
                # Temporary directory permissions require a recoverable
                # step protocol; reject this slice before any target write.
                raise IntegrationDeferred("unsupported_directory_permissions")
        changes = [
            item
            for item in plan
            if item["status"] in _DONE and item["pre"] != item["post"]
        ]
        target_entries = _entries(target)
        if (
            changes
            and stat.S_IMODE(os.stat(before.root_path).st_mode) & 0o700
            != 0o700
        ):
            raise IntegrationDeferred("unsupported_directory_permissions")
        for item in changes:
            for ancestor in Path(item["path"]).parents:
                if str(ancestor) == ".":
                    continue
                directory = target_entries.get(str(ancestor)) or output.get(
                    str(ancestor)
                )
                if directory is not None and directory.mode & 0o700 != 0o700:
                    raise IntegrationDeferred(
                        "unsupported_directory_permissions"
                    )
        files = [entry for entry in output.values() if entry.kind == "file"]
        limits = self.provider.limits
        if (
            len(output) > limits.max_entries
            or len(files) > limits.max_files
            or any(entry.size > limits.max_file_bytes for entry in files)
            or sum(entry.size for entry in files) > limits.max_total_bytes
        ):
            raise IntegrationDeferred("candidate_exceeds_limits")
        result_revision = self.content.put_manifest(
            WorkspaceManifest(
                entries=tuple(
                    sorted(output.values(), key=lambda entry: entry.path)
                ),
                parent_revision=snapshot.revision_id,
                source_revision=request["output_revision"],
                lineage=(request["input_revision"],),
                coverage=target.coverage,
                source_fence=asdict(_source_fence(before)),
            )
        )
        body = {
            "schema_version": 1,
            "request_id": request_id,
            "payload_digest": request["payload_digest"],
            "worker_id": self.worker_id,
            "worker_generation": generation,
            "input_revision": request["input_revision"],
            "output_revision": request["output_revision"],
            "target_revision": snapshot.revision_id,
            "result_revision": result_revision,
            "target_fence": asdict(before),
            "paths": plan,
            "path_states": {
                row["change_id"]: {
                    key: row[key]
                    for key in (
                        "status",
                        "resolution_revision",
                        "operation_id",
                    )
                }
                for row in paths
            },
            "predecessors": predecessors,
            "merge_policy": MERGE_ALGORITHM_VERSION,
            "policy_version": request["policy_version"],
        }
        candidate = MergeCandidate(
            request_id,
            self.worker_id,
            generation,
            before,
            snapshot.revision_id,
            result_revision,
            canonical_json(body),
            "{}",
        )
        validation = "not_configured"
        if self.validator is not None:
            try:
                valid = self.validator(candidate) is True
            except Exception:
                valid = False
            if not valid:
                raise IntegrationDeferred("validation_failed")
            validation = "passed"
        candidate = MergeCandidate(
            request_id,
            self.worker_id,
            generation,
            before,
            snapshot.revision_id,
            result_revision,
            candidate.plan_json,
            canonical_json(
                {
                    "outcome": validation,
                    "plan_digest": digest(body),
                    "worker_id": self.worker_id,
                    "worker_generation": generation,
                }
            ),
        )
        with self.journal._write_transaction() as connection:
            self._owned(connection, request_id, generation)
            self.state._require_fence(connection, before)
            for revision in (snapshot.revision_id, result_revision):
                self.state.retain_in_transaction(
                    connection,
                    revision,
                    f"candidate:{request_id}:{generation}",
                )
        self._validated.add(candidate.candidate_digest)
        return candidate

    def _plan(self, request, paths, predecessors, base, source, target):
        maps = [_entries(manifest) for manifest in (base, source, target)]
        plan = []
        for row in paths:
            path = relative_path(row["relative_path"])
            if row["status"] in _DONE or row["status"] == "discarded":
                continue
            versions = [mapping.get(path) for mapping in maps]
            item = {
                "change_id": row["change_id"],
                "path": path,
                "group_id": row["group_id"],
                "base": _encoded(versions[0]),
                "source": _encoded(versions[1]),
                "pre": _encoded(versions[2]),
                "post": None,
                "status": "pending",
                "reason": None,
            }
            predecessor_row = predecessors.get(row["change_id"])
            predecessor = (
                predecessor_row["status"] if predecessor_row else None
            )
            if predecessor == "resolved":
                resolution = predecessor_row["resolution_revision"]
                original = _entries(
                    self.content.get_manifest(
                        predecessor_row["output_revision"]
                    )
                ).get(path)
                accepted = (
                    _entries(self.content.get_manifest(resolution)).get(path)
                    if resolution
                    else None
                )
                if resolution is None or accepted != original:
                    predecessor = "needs_rebase"
            if predecessor in {"discarded", "needs_rebase"}:
                item.update(
                    status="needs_rebase", reason="predecessor_discarded"
                )
            elif predecessor is not None and predecessor not in _DONE:
                item.update(status="waiting", reason="predecessor_pending")
            elif any(
                path == excluded or path.startswith(excluded + "/")
                for manifest in (base, source, target)
                for excluded in manifest.coverage
            ):
                item.update(status="conflict", reason="path_not_covered")
            else:
                status, post, reason = self._merge_path(path, *versions)
                item.update(status=status, post=_encoded(post), reason=reason)
            plan.append(item)

        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        by_path = {item["path"]: item for item in plan}
        for item in plan:
            groups[item["group_id"]].append(item)
        # Directory removals require an explicit complete dependency group.
        for item in plan:
            before, after = _entry(item["pre"]), _entry(item["post"])
            if (
                item["status"] == "integrated"
                and before
                and before.kind == "directory"
                and after is None
            ):
                members = {
                    member["path"]: member
                    for member in groups[item["group_id"]]
                }
                if any(
                    path.startswith(item["path"] + "/")
                    and (
                        path not in members
                        or members[path]["post"] is not None
                        or members[path]["status"] not in _DONE
                    )
                    for path in maps[2]
                ) or any(
                    excluded.startswith(item["path"] + "/")
                    for excluded in target.coverage
                ):
                    item.update(
                        status="conflict", reason="directory_dependency"
                    )
        changed = True
        while changed:
            changed = False
            for item in plan:
                if item["status"] not in _DONE or item["post"] is None:
                    continue
                parts = item["path"].split("/")
                for depth in range(1, len(parts)):
                    parent = "/".join(parts[:depth])
                    dependency = by_path.get(parent)
                    if dependency is not None:
                        accepted = _entry(dependency["post"])
                        valid = (
                            dependency["status"] in _DONE
                            and accepted
                            and accepted.kind == "directory"
                        )
                    else:
                        accepted = maps[2].get(parent) or maps[1].get(parent)
                        valid = accepted and accepted.kind == "directory"
                    if not valid:
                        item.update(
                            status="conflict",
                            reason="parent_path_conflict",
                        )
                        changed = True
                        break
            for group in groups.values():
                if any(item["status"] not in _DONE for item in group):
                    for item in group:
                        if item["status"] in _DONE:
                            item.update(
                                status="waiting", reason="group_blocked"
                            )
                            changed = True

        output = dict(maps[2])
        for item in plan:
            if item["status"] not in _DONE:
                continue
            post = _entry(item["post"])
            output[item["path"]] = post or ManifestEntry(
                item["path"], "tombstone"
            )
        # Parent creation is included in the exact write plan even if the
        # caller's mutation ledger named only its new file.
        for item in tuple(plan):
            if item["status"] not in _DONE or item["post"] is None:
                continue
            parts = item["path"].split("/")
            for depth in range(1, len(parts)):
                parent = "/".join(parts[:depth])
                existing = output.get(parent)
                if existing is not None and existing.kind == "directory":
                    continue
                source_parent = maps[1].get(parent)
                if (
                    existing is not None
                    or source_parent is None
                    or source_parent.kind != "directory"
                ):
                    raise IntegrationDeferred("parent_path_conflict")
                output[parent] = source_parent
                plan.append(
                    {
                        "change_id": None,
                        "path": parent,
                        "group_id": item["group_id"],
                        "base": None,
                        "source": _encoded(source_parent),
                        "pre": None,
                        "post": _encoded(source_parent),
                        "status": "integrated",
                        "reason": "implicit_parent",
                    }
                )
        return plan, output

    def _merge_path(self, path, base, source, target):
        if source == base:
            return "equivalent", target, None
        if source == target:
            return "equivalent", target, None
        if any(
            entry and entry.kind == "directory"
            for entry in (base, source, target)
        ):
            if target == base and (
                (base is None and source and source.kind == "directory")
                or (base and base.kind == "directory" and source is None)
            ):
                return "integrated", source, None
            return "conflict", None, "kind_conflict"

        def version(entry):
            if entry is None:
                return None
            content = self.content.read_blob(entry.digest)
            if len(content) != entry.size:
                raise ContentIntegrityError("merge object size mismatch")
            return FileVersion("file", content, entry.mode)

        result = merge_file(
            *(version(entry) for entry in (base, source, target))
        )
        if result.outcome == "conflict":
            return "conflict", None, [item.reason for item in result.conflicts]
        value = result.version
        after = (
            ManifestEntry(
                path,
                "file",
                self.content.put_blob(value.content),
                len(value.content),
                value.mode,
            )
            if value is not None
            else None
        )
        return "equivalent" if after == target else "integrated", after, None

    def _verify_target(self, root: Path, revision: str) -> None:
        entries, _, coverage = self.provider._scan(root, save_objects=False)
        expected = self.content.get_manifest(revision)
        if {entry.path: entry for entry in entries} != _entries(
            expected
        ) or coverage != expected.coverage:
            raise SourceChangedError("target_changed")

    def publish(self, candidate: MergeCandidate) -> IntegrationResult:
        operation_id = "publication_" + digest(
            [
                candidate.request_id,
                candidate.worker_generation,
                candidate.candidate_digest,
            ]
        )
        with publication_execution(self.journal.path, operation_id):
            with self.journal._lock:
                exists = self.journal._connection.execute(
                    "SELECT 1 FROM workspace_publication_operations "
                    "WHERE operation_id=?",
                    (operation_id,),
                ).fetchone()
            if exists:
                return self._reconcile(operation_id)
            return self._publish(candidate)

    def _publish(self, candidate: MergeCandidate) -> IntegrationResult:
        body = _decode(candidate.plan_json)
        validation = _decode(candidate.validation_json)
        if (
            candidate.candidate_digest not in self._validated
            or validation.get("plan_digest") != digest(body)
            or validation.get("worker_generation")
            != candidate.worker_generation
            or validation.get("worker_id") != self.worker_id
            or validation.get("outcome") not in {"passed", "not_configured"}
            or body["request_id"] != candidate.request_id
            or body["result_revision"] != candidate.result_revision
            or body["target_revision"] != candidate.target_revision
            or body["target_fence"] != asdict(candidate.target_fence)
        ):
            raise WorkspaceFenceLost(
                "candidate validation does not match plan"
            )
        with self.journal._lock:
            request = self._owned(
                self.journal._connection,
                candidate.request_id,
                candidate.worker_generation,
            )
        self._authorized(request)
        self.state.target(candidate.target_fence.target_id)
        self._verify_target(
            Path(candidate.target_fence.root_path), candidate.target_revision
        )
        operation_id = "publication_" + digest(
            [
                candidate.request_id,
                candidate.worker_generation,
                candidate.candidate_digest,
            ]
        )
        with self.journal._write_transaction() as connection:
            request = self._owned(
                connection, candidate.request_id, candidate.worker_generation
            )
            if (
                any(
                    request[key] != body[key]
                    for key in (
                        "payload_digest",
                        "input_revision",
                        "output_revision",
                        "policy_version",
                    )
                )
                or request["target_id"] != candidate.target_fence.target_id
            ):
                raise WorkspaceFenceLost("request payload changed")
            self.state._require_fence(connection, candidate.target_fence)
            self._require_path_states(connection, body)
            ready = [item for item in body["paths"] if item["status"] in _DONE]
            if not ready:
                self._record_paths(
                    connection, body, candidate.target_revision, None, None
                )
                self._finish_request(connection, candidate.request_id)
                return self.result(candidate.request_id)
            owner = self.state.acquire_target_in_transaction(
                connection,
                candidate.target_fence,
                owner_kind="integration",
                owner_id=operation_id,
            )
            data = {
                "candidate": body,
                "validation": validation,
                "owner": asdict(owner),
                "worker_id": self.worker_id,
                "candidate_digest": candidate.candidate_digest,
            }
            connection.execute(
                """INSERT INTO workspace_publication_operations
                (operation_id,request_id,target_id,owner_generation,
                 worker_generation,candidate_digest,candidate_json,status,created_at)
                VALUES (?,?,?,?,?,?,?,'prepared',?)""",
                (
                    operation_id,
                    candidate.request_id,
                    owner.target_id,
                    owner.owner_generation,
                    candidate.worker_generation,
                    candidate.candidate_digest,
                    canonical_json(data),
                    time.time(),
                ),
            )
            connection.execute(
                "UPDATE workspace_integration_requests SET status='publishing' WHERE request_id=?",
                (candidate.request_id,),
            )
        try:
            # This check is after the owner handoff and before dispatch.
            # No file mutation has occurred, so a mismatch can release this
            # prepared owner and consume the bounded reprepare attempt.
            self._verify_target(
                Path(owner.root_path),
                candidate.target_revision,
            )
            return self._apply(operation_id)
        except Exception as exc:
            operation, data = self._operation(operation_id)
            if operation["status"] == "prepared":
                self._abort_prepared(operation, data)
                raise
            return self._attention(operation_id, exc)

    @staticmethod
    def _require_path_states(connection, body):
        expected = dict(body["path_states"])
        for predecessor in body["predecessors"].values():
            expected[predecessor["change_id"]] = {
                key: predecessor[key]
                for key in (
                    "status",
                    "resolution_revision",
                    "operation_id",
                )
            }
        for change_id, state in expected.items():
            current = connection.execute(
                """SELECT status,resolution_revision,operation_id
                FROM workspace_integration_paths WHERE change_id=?""",
                (change_id,),
            ).fetchone()
            if current is None or dict(current) != state:
                raise WorkspaceFenceLost("path dependency changed")

    def _abort_prepared(self, operation, data):
        owner = self._operation_owner(operation, data)
        with self.journal._write_transaction() as connection:
            self._owned(
                connection,
                operation["request_id"],
                operation["worker_generation"],
            )
            self.state.abort_prepared_publication_in_transaction(
                connection,
                owner,
            )
            connection.execute(
                """UPDATE workspace_integration_requests
                SET status='preparing' WHERE request_id=?""",
                (operation["request_id"],),
            )

    def _operation(self, operation_id: str):
        with self.journal._lock:
            row = self.journal._connection.execute(
                "SELECT * FROM workspace_publication_operations WHERE operation_id=?",
                (operation_id,),
            ).fetchone()
        if row is None:
            raise WorkspaceStateError("unknown publication operation")
        return dict(row), _decode(row["candidate_json"])

    def _operation_owner(self, operation, data):
        owner = self.state.target(operation["target_id"])
        recorded = TargetFence(**data["owner"])
        if (
            owner.owner_id != operation["operation_id"]
            or owner.owner_kind != "integration"
            or owner.owner_generation != recorded.owner_generation
            or owner.binding_version != recorded.binding_version
            or owner.physical_identity != recorded.physical_identity
            or owner.root_path != recorded.root_path
            or owner.write_epoch != recorded.write_epoch
            or owner.receipt_cursor != recorded.receipt_cursor
        ):
            raise WorkspaceFenceLost("publication owner changed")
        return owner

    def reconcile(self, operation_id: str) -> IntegrationResult:
        with publication_execution(self.journal.path, operation_id):
            return self._reconcile(operation_id)

    def _reconcile(self, operation_id: str) -> IntegrationResult:
        operation, data = self._operation(operation_id)
        if operation["status"] in {"completed", "aborted"}:
            return self.result(operation["request_id"])
        if data["worker_id"] != self.worker_id:
            raise WorkspaceBusy(
                "explicit verified worker transfer is required"
            )
        try:
            return self._apply(operation_id)
        except Exception as exc:
            operation, data = self._operation(operation_id)
            if operation["status"] == "prepared":
                self._abort_prepared(operation, data)
                self._wait(
                    operation["request_id"],
                    operation["worker_generation"],
                    "target_changed",
                )
                return self.result(operation["request_id"])
            return self._attention(operation_id, exc)

    def _verify_mixed_target(self, owner, body, writes):
        """Preflight the complete tree, allowing only journaled postimages.

        Recovery must inspect unchanged/equivalent paths too; otherwise an
        unrelated third version would be discovered only after more writes.
        This is observation for recovery, never an accepted live snapshot.
        """
        entries, _, coverage = self.provider._scan(
            Path(owner.root_path),
            save_objects=False,
        )
        actual = {entry.path: entry for entry in entries}
        before = _entries(self.content.get_manifest(body["target_revision"]))
        changes = {item["path"]: item for item in writes}
        mismatches = []
        for path in sorted(actual.keys() | before.keys() | changes.keys()):
            item = changes.get(path)
            allowed = (
                (_entry(item["pre"]), _entry(item["post"]))
                if item
                else (before.get(path),)
            )
            if actual.get(path) not in allowed:
                mismatches.append(path)
        expected = self.content.get_manifest(body["target_revision"])
        if coverage != expected.coverage or mismatches:
            raise TargetProjectionChanged(tuple(mismatches))

    def _apply(self, operation_id: str) -> IntegrationResult:
        operation, data = self._operation(operation_id)
        body = data["candidate"]
        validation = data["validation"]
        if (
            operation["candidate_digest"]
            != digest(
                [
                    canonical_json(body),
                    canonical_json(validation),
                ]
            )
            or validation["plan_digest"] != digest(body)
            or validation["worker_generation"]
            != operation["worker_generation"]
            or validation["worker_id"] != self.worker_id
            or validation["outcome"] not in {"passed", "not_configured"}
            or data["owner"]["owner_generation"]
            != operation["owner_generation"]
        ):
            raise WorkspaceFenceLost("saved candidate receipt does not match")
        owner = self._operation_owner(operation, data)
        with self.journal._lock:
            request = self._owned(
                self.journal._connection,
                operation["request_id"],
                operation["worker_generation"],
            )
        self._authorized(request)
        # Validate ALL paths before rolling forward any one of them. A third
        # version on one path cannot silently allow more partial publication.
        writes = [
            item
            for item in body["paths"]
            if item["status"] in _DONE and item["pre"] != item["post"]
        ]
        self._recover_temporaries(owner, body)
        self._verify_mixed_target(owner, body, writes)
        for item in writes:
            observed, _ = self._observe(owner, item["path"])
            if observed not in (_entry(item["pre"]), _entry(item["post"])):
                raise SourceChangedError("recovery observed a third version")
        with self.journal._write_transaction() as connection:
            self.state._require_fence(connection, owner)
            self._owned(
                connection,
                operation["request_id"],
                operation["worker_generation"],
            )
            connection.execute(
                "UPDATE workspace_publication_operations SET status='dispatched' WHERE operation_id=?",
                (operation_id,),
            )

        def order(item):
            before, after = _entry(item["pre"]), _entry(item["post"])
            depth = item["path"].count("/")
            if after is not None and after.kind == "directory":
                return (0, depth, item["path"])
            if (
                after is None
                and before is not None
                and before.kind == "directory"
            ):
                return (2, -depth, item["path"])
            return (1, depth, item["path"])

        for item in sorted(writes, key=order):
            with self.journal._lock:
                self.state._require_fence(self.journal._connection, owner)
                self._owned(
                    self.journal._connection,
                    operation["request_id"],
                    operation["worker_generation"],
                )
            self._write_entry(owner, item)
        self._verify_target(Path(owner.root_path), body["result_revision"])
        with self.journal._write_transaction() as connection:
            self.state._require_fence(connection, owner)
            self._owned(
                connection,
                operation["request_id"],
                operation["worker_generation"],
            )
            settled = self.state._settled_revision(
                connection, owner, body["result_revision"]
            )
            self._record_paths(
                connection,
                body,
                body["result_revision"],
                settled.receipt_cursor,
                operation_id,
            )
            connection.execute(
                """UPDATE workspace_publication_operations SET status='completed',
                result_revision=? WHERE operation_id=?""",
                (body["result_revision"], operation_id),
            )
            self._finish_request(connection, operation["request_id"])
        return self.result(operation["request_id"])

    def _attention(
        self,
        operation_id: str,
        error: Exception | None = None,
    ) -> IntegrationResult:
        operation, data = self._operation(operation_id)
        owner = self._operation_owner(operation, data)
        evidence = []
        items = {item["path"]: item for item in data["candidate"]["paths"]}
        before = _entries(
            self.content.get_manifest(data["candidate"]["target_revision"])
        )
        for path in getattr(error, "paths", ()):
            items.setdefault(
                path,
                {
                    "change_id": None,
                    "path": path,
                    "pre": _encoded(before.get(path)),
                    "post": _encoded(before.get(path)),
                },
            )
        for item in items.values():
            evidence_stage = "observe"
            try:
                observed, token = self._observe(owner, item["path"])
                if observed in (_entry(item["pre"]), _entry(item["post"])):
                    continue
                # A diagnostic single-path collection, never a new settled
                # source snapshot. Keep captured third-version bytes even if
                # an external writer subsequently changes the live path.
                entry = (
                    ManifestEntry(
                        "observed",
                        observed.kind,
                        observed.digest,
                        observed.size,
                        observed.mode,
                    )
                    if observed
                    else ManifestEntry("observed", "tombstone")
                )
                evidence_stage = "manifest"
                revision = self.content.put_manifest(
                    WorkspaceManifest(
                        entries=(entry,),
                        source_revision=data["candidate"]["target_revision"],
                        source_fence={
                            "purpose": "recovery_evidence",
                            "path": item["path"],
                            "operation_id": operation_id,
                            "observed_token": token,
                        },
                    )
                )
                evidence.append((item, revision))
            except Exception:
                # Unsupported or unstable files remain untouched. Failure to
                # collect evidence must never release the publication owner.
                # Only log the stable operation ID and fixed stage; paths,
                # exception text and tracebacks can contain private content.
                logger.warning(
                    "Workspace recovery evidence capture failed: "
                    "operation_id=%s stage=%s",
                    operation_id,
                    evidence_stage,
                )
                continue
        with self.journal._write_transaction() as connection:
            self.state._require_fence(connection, owner)
            self._owned(
                connection,
                operation["request_id"],
                operation["worker_generation"],
            )
            for item, revision in evidence:
                self.state.retain_in_transaction(
                    connection,
                    revision,
                    f"recovery:{operation_id}",
                )
                if item["change_id"] is not None:
                    connection.execute(
                        """UPDATE workspace_integration_paths
                        SET evidence_json=? WHERE change_id=?""",
                        (
                            canonical_json(
                                dict(item, observed_revision=revision)
                            ),
                            item["change_id"],
                        ),
                    )
            connection.execute(
                "UPDATE workspace_physical_targets SET state='recovery_required' WHERE target_id=?",
                (owner.target_id,),
            )
            connection.execute(
                "UPDATE workspace_publication_operations SET status='needs_attention' WHERE operation_id=?",
                (operation_id,),
            )
            connection.execute(
                """UPDATE workspace_integration_requests SET status='needs_attention',
                wait_reason=? WHERE request_id=?""",
                (
                    str(error)
                    if isinstance(error, IntegrationDeferred)
                    else "publication_unsettled",
                    operation["request_id"],
                ),
            )
        return self.result(operation["request_id"])

    @staticmethod
    def _record_paths(connection, body, revision, cursor, operation_id):
        for item in body["paths"]:
            if item["change_id"] is None:
                continue
            status = item["status"]
            connection.execute(
                """UPDATE workspace_integration_paths SET status=?,evidence_json=?,
                target_before_revision=?,target_after_revision=?,receipt_cursor=?,
                operation_id=? WHERE change_id=? AND status NOT IN
                ('integrated','equivalent','resolved','discarded')""",
                (
                    status,
                    canonical_json(item),
                    body["target_revision"],
                    revision if status in _DONE else None,
                    cursor if status in _DONE else None,
                    operation_id if status in _DONE else None,
                    item["change_id"],
                ),
            )

    @staticmethod
    def _finish_request(connection, request_id):
        statuses = {
            row[0]
            for row in connection.execute(
                "SELECT status FROM workspace_integration_paths WHERE request_id=?",
                (request_id,),
            )
        }
        if statuses <= _DONE:
            status = "integrated"
        elif statuses & _DONE:
            status = "partially_integrated"
        elif "conflict" in statuses:
            status = "conflict"
        else:
            status = "waiting"
        attempts = connection.execute(
            "SELECT attempts FROM workspace_integration_requests "
            "WHERE request_id=?",
            (request_id,),
        ).fetchone()[0]
        retry_after = (
            0
            if status == "integrated"
            else time.time() + min(60, 2 ** min(attempts, 6))
        )
        connection.execute(
            """UPDATE workspace_integration_requests SET status=?,worker_id=NULL,
            wait_reason=?,retry_after_at=? WHERE request_id=?""",
            (
                status,
                None if status == "integrated" else "paths_pending",
                retry_after,
                request_id,
            ),
        )

    @contextmanager
    def _parent(
        self, owner: TargetFence, path: str
    ) -> Iterator[tuple[int, str]]:
        path = relative_path(path)
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        descriptor = os.open(owner.root_path, flags)
        try:
            root = os.fstat(descriptor)
            if digest([root.st_dev, root.st_ino]) != owner.physical_identity:
                raise WorkspaceFenceLost("physical root changed before write")
            for part in path.split("/")[:-1]:
                child = os.open(part, flags, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            yield descriptor, path.split("/")[-1]
        finally:
            os.close(descriptor)

    @staticmethod
    def _token(observed):
        return (
            observed.st_dev,
            observed.st_ino,
            observed.st_mode,
            observed.st_size,
            observed.st_mtime_ns,
            observed.st_ctime_ns,
        )

    def _observe_at(self, parent, name, path):
        try:
            observed = os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return None, None
        token = self._token(observed)
        mode = stat.S_IMODE(observed.st_mode) & 0o777
        if stat.S_ISDIR(observed.st_mode):
            return ManifestEntry(path, "directory", mode=mode), token
        if not stat.S_ISREG(observed.st_mode):
            raise InvalidWorkspacePath(
                "publication target has unsupported type"
            )
        if observed.st_size > self.provider.limits.max_file_bytes:
            raise IntegrationDeferred("target_file_exceeds_limit")
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=parent,
        )
        with os.fdopen(descriptor, "rb") as reader:
            opened = os.fstat(reader.fileno())
            if (
                not stat.S_ISREG(opened.st_mode)
                or self._token(opened) != token
            ):
                raise SourceChangedError("target changed before read")
            value = reader.read(self.provider.limits.max_file_bytes + 1)
            if (
                self._token(os.fstat(reader.fileno())) != token
                or len(value) != observed.st_size
            ):
                raise SourceChangedError("target changed during read")
        if (
            self._token(os.stat(name, dir_fd=parent, follow_symlinks=False))
            != token
        ):
            raise SourceChangedError("target changed after read")
        return ManifestEntry(
            path, "file", self.content.put_blob(value), len(value), mode
        ), token

    def _observe(self, owner, path):
        try:
            with self._parent(owner, path) as (parent, name):
                return self._observe_at(parent, name, path)
        except FileNotFoundError:
            return None, None

    def _require_temporary_owner(self, connection, owner):
        self.state._require_fence(connection, owner)
        operation = connection.execute(
            "SELECT request_id,worker_generation,status "
            "FROM workspace_publication_operations WHERE operation_id=?",
            (owner.owner_id,),
        ).fetchone()
        if operation is None or operation["status"] not in {
            "dispatched",
            "needs_attention",
        }:
            raise WorkspaceFenceLost("temporary has no dispatched owner")
        self._owned(
            connection,
            operation["request_id"],
            operation["worker_generation"],
        )

    def _create_temporary(self, owner, item, parent):
        after = _entry(item["post"])
        name = ".eigent-publish-" + uuid.uuid4().hex
        path = str(Path(item["path"]).with_name(name))
        with self.journal._write_transaction() as connection:
            self._require_temporary_owner(connection, owner)
            connection.execute(
                """INSERT INTO workspace_publication_temporaries
                (operation_id,temporary_path,relative_path,expected_json,state)
                VALUES (?,?,?,?,'reserved')""",
                (
                    owner.owner_id,
                    path,
                    item["path"],
                    canonical_json(item["post"]),
                ),
            )
        descriptor = os.open(
            name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=parent,
        )
        with os.fdopen(descriptor, "wb") as writer:
            created = os.fstat(writer.fileno())
            os.fsync(parent)
            with self.journal._write_transaction() as connection:
                self._require_temporary_owner(connection, owner)
                connection.execute(
                    """UPDATE workspace_publication_temporaries
                    SET state='created',identity_json=?
                    WHERE operation_id=? AND temporary_path=?""",
                    (
                        canonical_json([created.st_dev, created.st_ino]),
                        owner.owner_id,
                        path,
                    ),
                )
            writer.write(self.content.read_blob(after.digest))
            os.fchmod(writer.fileno(), after.mode)
            writer.flush()
            os.fsync(writer.fileno())
            ready = self._token(os.fstat(writer.fileno()))
            with self.journal._write_transaction() as connection:
                self._require_temporary_owner(connection, owner)
                connection.execute(
                    """UPDATE workspace_publication_temporaries
                    SET state='ready',ready_token_json=?
                    WHERE operation_id=? AND temporary_path=?""",
                    (canonical_json(ready), owner.owner_id, path),
                )
        return name, path

    def _retire_temporary(self, owner, row):
        """Delete only an exact journaled path with proven inode and bytes.

        A crash after O_EXCL but before the inode receipt is deliberately
        fail-closed: mere name/prefix resemblance is never proof of ownership.
        """
        with self.journal._lock:
            self._require_temporary_owner(self.journal._connection, owner)
        path = relative_path(row["temporary_path"])
        try:
            with self._parent(owner, path) as (parent, name):
                actual, token = self._observe_at(parent, name, path)
                if actual is not None:
                    identity = _decode(row["identity_json"] or "null")
                    expected = _entry(_decode(row["expected_json"]))
                    if identity is None or identity != list(token[:2]):
                        raise IntegrationDeferred(
                            "temporary_ownership_unverified"
                        )
                    if actual.kind != "file" or expected.kind != "file":
                        raise IntegrationDeferred("temporary_type_changed")
                    contents = self.content.read_blob(actual.digest)
                    wanted = self.content.read_blob(expected.digest)
                    if row["state"] == "ready":
                        valid = (
                            list(token) == _decode(row["ready_token_json"])
                            and contents == wanted
                            and actual.mode == expected.mode
                        )
                    else:
                        valid = (
                            row["state"] == "created"
                            and len(contents) <= len(wanted)
                            and contents == wanted[: len(contents)]
                            and actual.mode in {0o600, expected.mode}
                        )
                    if not valid:
                        raise IntegrationDeferred("temporary_content_changed")
                    current = os.stat(
                        name, dir_fd=parent, follow_symlinks=False
                    )
                    if self._token(current) != token or current.st_nlink != 1:
                        raise SourceChangedError("temporary identity changed")
                    os.unlink(name, dir_fd=parent)
                    os.fsync(parent)
        except FileNotFoundError:
            # Rename may already have consumed it, or its parent is absent.
            # Complete mixed-tree verification still precedes further writes.
            self.state.target(owner.target_id)
        with self.journal._write_transaction() as connection:
            self._require_temporary_owner(connection, owner)
            connection.execute(
                """UPDATE workspace_publication_temporaries SET state='retired'
                WHERE operation_id=? AND temporary_path=?""",
                (owner.owner_id, path),
            )

    def _recover_temporaries(self, owner, body):
        with self.journal._lock:
            rows = self.journal._connection.execute(
                """SELECT * FROM workspace_publication_temporaries
                WHERE operation_id=? AND state!='retired'
                ORDER BY temporary_path""",
                (owner.owner_id,),
            ).fetchall()
        paths = {item["path"]: item for item in body["paths"]}
        for row in rows:
            item = paths.get(row["relative_path"])
            if (
                item is None
                or item["status"] not in _DONE
                or row["expected_json"] != canonical_json(item["post"])
                or Path(row["temporary_path"]).parent
                != Path(item["path"]).parent
                or row["temporary_path"] in paths
            ):
                raise WorkspaceFenceLost(
                    "temporary receipt does not match plan"
                )
            self._retire_temporary(owner, row)

    def _write_entry(
        self, owner: TargetFence, item: Mapping[str, Any]
    ) -> None:
        path = item["path"]
        before, after = _entry(item["pre"]), _entry(item["post"])
        if after is None and self._observe(owner, path)[0] is None:
            # Only a tombstone may accept missing ancestors during replay.
            self.state.target(owner.target_id)
            return
        with self._parent(owner, path) as (parent, name):
            observed, token = self._observe_at(parent, name, path)
            if observed == after:
                return  # Safe retry after a write but before its receipt.
            if observed != before:
                raise SourceChangedError("target no longer matches preimage")
            temporary = None
            temporary_path = None
            try:
                if after is not None and after.kind == "file":
                    temporary, temporary_path = self._create_temporary(
                        owner,
                        item,
                        parent,
                    )
                # Honest B4: an uncooperative writer can still win the gap
                # between this check and replace/unlink. No strong CAS claim.
                if self._observe_at(parent, name, path) != (observed, token):
                    raise SourceChangedError("target changed before replace")
                if after is None:
                    if before is not None and before.kind == "directory":
                        os.rmdir(name, dir_fd=parent)
                    else:
                        os.unlink(name, dir_fd=parent)
                elif after.kind == "directory":
                    os.mkdir(name, after.mode, dir_fd=parent)
                    descriptor = os.open(
                        name,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=parent,
                    )
                    try:
                        os.fchmod(descriptor, after.mode)
                    finally:
                        os.close(descriptor)
                else:
                    os.replace(
                        temporary, name, src_dir_fd=parent, dst_dir_fd=parent
                    )
                    temporary = None
                os.fsync(parent)
                if self._observe_at(parent, name, path)[0] != after:
                    raise SourceChangedError("published postimage changed")
            finally:
                if temporary_path is not None:
                    with self.journal._lock:
                        receipt = self.journal._connection.execute(
                            "SELECT * FROM workspace_publication_temporaries "
                            "WHERE operation_id=? AND temporary_path=?",
                            (owner.owner_id, temporary_path),
                        ).fetchone()
                    self._retire_temporary(owner, receipt)
