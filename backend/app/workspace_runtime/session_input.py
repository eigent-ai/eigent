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

"""Compose immutable Session input from fixed target and unpublished Run deltas.

This is a read projection. It never writes the target, chooses a conflict side,
publishes a path receipt, or authorizes old mutations for the new Run.
"""

from __future__ import annotations

import unicodedata
from collections import OrderedDict
from dataclasses import replace
from pathlib import PurePosixPath

from .content import (
    ContentIntegrityError,
    ManifestEntry,
    WorkspaceContentError,
    WorkspaceManifest,
    relative_path,
)
from .merge import FileVersion, merge_file
from .provider import SourceFence, WorkspaceLimitError
from .store import WorkspaceFenceLost, WorkspaceStateError, WorkspaceStateStore


class SessionInputConflict(WorkspaceContentError):
    code = "session_input_conflict"


_DONE = {"integrated", "equivalent", "resolved"}
_ROWS = """
SELECT p.*,r.rowid AS request_order,r.run_id,r.project_id,r.target_id,
       r.input_revision,r.output_revision,r.target_binding_version,
       r.payload_digest,r.finalizer_receipt_json,
       f.generation,f.owner_attempt_id,f.checkpoint_revision,f.manifest_digest,
       f.receipt_json,b.snapshot_revision,b.attempt_id,
       b.target_id AS binding_target_id,
       b.target_binding_version AS binding_target_binding_version,
       run.project_id AS run_project_id
FROM workspace_integration_paths p
JOIN workspace_integration_requests r USING(request_id)
JOIN runs run ON run.run_id=r.run_id
JOIN run_workspace_finalizations f ON f.run_id=r.run_id
JOIN run_workspace_bindings b ON b.run_id=f.run_id AND b.generation=f.generation
WHERE r.project_id=? AND r.target_id=?
  AND run.status='completed' AND f.state='settled' AND f.outcome='completed'
ORDER BY r.rowid,p.relative_path
"""


def _rows(connection, project_id, target_id):
    return tuple(
        dict(row) for row in connection.execute(_ROWS, (project_id, target_id))
    )


def _entries(manifest):
    return {
        entry.path: entry
        for entry in manifest.entries
        if entry.kind != "tombstone"
    }


def _folded(path):
    return unicodedata.normalize("NFC", path).casefold()


def _not_covered(path, coverage, *, subtree=False):
    path = _folded(path)
    return any(
        path == _folded(excluded)
        or path.startswith(_folded(excluded) + "/")
        or (subtree and _folded(excluded).startswith(path + "/"))
        for excluded in coverage
    )


def _merge_entry(content, path, base, source, target):
    if source == base:
        return target
    if source == target:
        return target
    if target == base:
        return source
    if any(
        entry and entry.kind == "directory" for entry in (base, source, target)
    ):
        raise SessionInputConflict("session_input_path_type_conflict")

    def version(entry):
        if entry is None:
            return None
        value = content.read_blob(entry.digest)
        if len(value) != entry.size:
            raise ContentIntegrityError("Session input object size mismatch")
        return FileVersion("file", value, entry.mode)

    merged = merge_file(*(version(entry) for entry in (base, source, target)))
    if merged.outcome == "conflict":
        raise SessionInputConflict("session_input_content_conflict")
    value = merged.version
    return (
        None
        if value is None
        else ManifestEntry(
            path,
            "file",
            content.put_blob(value.content),
            len(value.content),
            value.mode,
        )
    )


def _plan_run(content, current, base, source, rows, coverage):
    """Plan every path against the same pre-Run map, then check the whole tree.

    Input composition is atomic at the manifest level. A conflict in any group
    withholds this input, so no partial group is incorporated into the new Run.
    """
    base_map, source_map = _entries(base), _entries(source)
    actual_delta = {
        path
        for path in base_map.keys() | source_map.keys()
        if base_map.get(path) != source_map.get(path)
    }
    if actual_delta != {row["relative_path"] for row in rows}:
        raise WorkspaceStateError("Session delta lacks complete path receipts")
    planned = {}
    for row in rows:
        path = relative_path(row["relative_path"])
        if row["status"] in _DONE or row["status"] == "discarded":
            continue
        if row["status"] == "needs_rebase":
            raise SessionInputConflict(
                "session_input_predecessor_needs_rebase"
            )
        if _not_covered(path, coverage):
            raise SessionInputConflict("session_input_path_not_covered")
        planned[path] = _merge_entry(
            content,
            path,
            base_map.get(path),
            source_map.get(path),
            current.get(path),
        )

    # A directory entry contains its mode, not a digest of its children.
    # Removing/replacing it must not silently drop a target-only descendant.
    for path, after in planned.items():
        before = current.get(path)
        if (
            before
            and before.kind == "directory"
            and (after is None or after.kind != "directory")
        ):
            if _not_covered(path, coverage, subtree=True) or any(
                child.startswith(path + "/")
                and (child not in planned or planned[child] is not None)
                for child in current
            ):
                raise SessionInputConflict(
                    "session_input_directory_dependency"
                )
    output = dict(current)
    for path, entry in planned.items():
        if entry is None:
            output.pop(path, None)
        else:
            output[path] = entry
    # A missing or replaced target parent is a conflict. Only an explicit
    # directory creation in this delta can create the parent; do not resurrect
    # old source directories merely to fit a newly added child beneath them.
    for path in output:
        for parent in PurePosixPath(path).parents:
            if str(parent) == ".":
                continue
            ancestor = output.get(str(parent))
            if ancestor is None or ancestor.kind != "directory":
                raise SessionInputConflict(
                    "session_input_parent_path_conflict"
                )
    return output


def compose_session_input(state, provider, project_id, target, snapshot):
    expected_source = SourceFence(
        target.target_id,
        target.physical_identity,
        target.write_epoch,
        target.settled_revision,
        target.receipt_cursor,
        target.state,
        target.owner_id,
        target.binding_version,
    )
    if snapshot.fence != expected_source or not target.available:
        raise WorkspaceFenceLost(
            "Session input target boundary does not match snapshot"
        )
    with state.journal._lock:
        connection = state.journal._connection
        WorkspaceStateStore._require_fence(connection, target)
        rows = _rows(connection, project_id, target.target_id)
        # Validate skip receipts against this exact captured target boundary,
        # rather than using newer integration progress with older target bytes.
        for row in rows:
            if (
                row["checkpoint_revision"] != row["output_revision"]
                or row["snapshot_revision"] != row["input_revision"]
                or row["owner_attempt_id"] != row["attempt_id"]
                or row["receipt_json"] != row["finalizer_receipt_json"]
                or row["target_binding_version"] != target.binding_version
                or row["binding_target_binding_version"]
                != target.binding_version
                or row["binding_target_id"] != target.target_id
                or row["run_project_id"] != project_id
            ):
                raise WorkspaceStateError(
                    "Session delta finalization ownership changed"
                )
            if row["status"] in _DONE:
                cursor = row["receipt_cursor"]
                revision = row["target_after_revision"]
                history = (
                    connection.execute(
                        """SELECT revision FROM workspace_target_revisions
                        WHERE target_id=? AND receipt_cursor=?""",
                        (target.target_id, cursor),
                    ).fetchone()
                    if type(cursor) is int
                    and 0 <= cursor <= target.receipt_cursor
                    else None
                )
                if history is None or history[0] != revision:
                    raise WorkspaceFenceLost(
                        "Session delta receipt is outside target lineage"
                    )

    content = provider.store
    captured = content.get_manifest(snapshot.revision_id)
    current = _entries(captured)
    revisions = {snapshot.revision_id}
    cache = {snapshot.revision_id: captured}

    def manifest(revision):
        revisions.add(revision)
        if revision not in cache:
            cache[revision] = content.get_manifest(revision)
        return cache[revision]

    by_change = {row["change_id"]: row for row in rows}
    by_run = OrderedDict()
    for row in rows:
        by_run.setdefault(row["request_id"], []).append(row)
        if row["status"] in _DONE or row["status"] == "discarded":
            continue
        predecessor = row["predecessor_change_id"]
        if predecessor is None:
            continue
        previous = by_change.get(predecessor)
        if (
            previous is None
            or previous["relative_path"] != row["relative_path"]
            or previous["request_order"] >= row["request_order"]
        ):
            raise WorkspaceStateError(
                "Session delta predecessor is unavailable"
            )
        if previous["status"] in {"discarded", "needs_rebase"}:
            raise SessionInputConflict(
                "session_input_predecessor_needs_rebase"
            )
        if previous["status"] == "resolved":
            resolution = previous["resolution_revision"]
            if resolution is None or _entries(manifest(resolution)).get(
                row["relative_path"]
            ) != _entries(manifest(previous["output_revision"])).get(
                row["relative_path"]
            ):
                raise SessionInputConflict(
                    "session_input_predecessor_needs_rebase"
                )

    for run_rows in by_run.values():
        base = manifest(run_rows[0]["input_revision"])
        source = manifest(run_rows[0]["output_revision"])
        coverage = (*captured.coverage, *base.coverage, *source.coverage)
        current = _plan_run(content, current, base, source, run_rows, coverage)

    files = [entry for entry in current.values() if entry.kind == "file"]
    limits = provider.limits
    if (
        len(current) > limits.max_entries
        or len(files) > limits.max_files
        or any(entry.size > limits.max_file_bytes for entry in files)
        or sum(entry.size for entry in files) > limits.max_total_bytes
    ):
        raise WorkspaceLimitError("Session input exceeds workspace limits")
    # Validate every chosen object, including equality fast paths, before
    # publishing a ready input. Source object size is part of the manifest.
    for entry in files:
        if len(content.read_blob(entry.digest)) != entry.size:
            raise ContentIntegrityError("Session input object size mismatch")
    try:
        composed = WorkspaceManifest(
            entries=tuple(
                sorted(current.values(), key=lambda entry: entry.path)
            ),
            parent_revision=snapshot.revision_id,
            source_revision=rows[-1]["output_revision"]
            if rows
            else snapshot.revision_id,
            lineage=tuple(sorted(revisions)),
            coverage=captured.coverage,
            source_fence=captured.source_fence,
        )
    except ContentIntegrityError:
        raise SessionInputConflict(
            "session_input_ambiguous_path_tree"
        ) from None
    revision = (
        content.put_manifest(composed)
        if rows or captured.mutation_receipts
        else snapshot.revision_id
    )
    state.target(target.target_id)  # Recheck canonical physical root identity.
    with state.journal._write_transaction() as connection:
        WorkspaceStateStore._require_fence(connection, target)
        if _rows(connection, project_id, target.target_id) != rows:
            raise WorkspaceFenceLost("Session input path receipts changed")
        state.retain_in_transaction(
            connection, revision, "preparation:" + snapshot.owner
        )
    return replace(snapshot, revision_id=revision)
