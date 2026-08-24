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

"""Canonical per-Run Artifact discovery and durable event recording.

SQLite is the source of truth for a finalized Run's Artifact manifest. The
filesystem is consulted once, before ``run.completed``; replay and Cloud
projection consume the committed events instead of reconstructing history.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.run_context import get_current_run_context
from app.run_journal.models import CommittedRunEvent, RunEventDraft, RunRecord
from app.run_journal.semantic_events import semantic_event_fields
from app.run_journal.store import SQLiteRunJournal
from app.utils.file_utils import list_files
from app.utils.workspace_paths import (
    get_eigent_root,
    runtime_owner_key,
    sanitize_identity,
)
from app.utils.workspace_resolver import TaskSnapshot, get_workspace_resolver

logger = logging.getLogger("artifacts")

MAX_ARTIFACTS_PER_RUN = 500
MAX_ARTIFACT_SCAN_SECONDS = 3.0
MAX_ARTIFACT_SCAN_ENTRIES = 100_000
_ACTIVE_RUN_STATUSES = {"pending", "running", "waiting_for_user"}
_AGENT_GENERATED_UPLOAD_POLICY = "agent_generated"
_METADATA_ONLY_UPLOAD_POLICY = "metadata_only"
_SPACE_INTERNAL_ARTIFACT_NAMES = {"todo.md"}
_SPACE_INTERNAL_ARTIFACT_ROOTS = {"terminal_logs"}


@dataclass(frozen=True)
class ArtifactScanResult:
    artifacts: list[dict[str, Any]]
    scan_status: str
    truncated: bool


def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class _ArtifactRoot:
    path: Path
    scan_all: bool
    upload_policy: str


def _task_change_roots(
    snapshot: TaskSnapshot,
    *,
    working_root_upload_policy: str = _METADATA_ONLY_UPLOAD_POLICY,
) -> list[_ArtifactRoot]:
    """Return the independently-scoped roots used by Artifact discovery.

    ``scan_all`` and ``upload_policy`` deliberately remain separate. A
    Brain-owned Space root is still scanned only inside the Run's mutation
    window, but files attributed to that Run may be uploaded. A user-bound
    folder keeps the same bounded scan while remaining metadata-only.
    """

    output_root = Path(snapshot.task_output_root).expanduser().resolve()
    working_root = Path(snapshot.working_directory).expanduser().resolve()
    roots: list[_ArtifactRoot] = []
    if output_root.is_dir():
        roots.append(
            _ArtifactRoot(
                path=output_root,
                scan_all=True,
                upload_policy=_AGENT_GENERATED_UPLOAD_POLICY,
            )
        )
    if working_root != output_root and working_root.is_dir():
        roots.append(
            _ArtifactRoot(
                path=working_root,
                scan_all=False,
                upload_policy=working_root_upload_policy,
            )
        )
    return roots


def _brain_owned_space_root(
    snapshot: TaskSnapshot,
    *,
    email: str,
    user_id: str | int | None,
) -> Path:
    safe_space_id = sanitize_identity(
        getattr(snapshot, "space_id", None)
    ).removeprefix("space_")
    return (
        get_eigent_root()
        / runtime_owner_key(email, user_id)
        / f"space_{safe_space_id or 'scratch'}"
    ).resolve()


def _working_root_upload_policy(
    snapshot: TaskSnapshot,
    *,
    email: str,
    user_id: str | int | None,
) -> str:
    """Return the upload boundary for one frozen Space working root."""

    try:
        working_root = Path(snapshot.working_directory).expanduser().resolve()
        managed_root = _brain_owned_space_root(
            snapshot,
            email=email,
            user_id=user_id,
        )
    except (OSError, RuntimeError, ValueError):
        return _METADATA_ONLY_UPLOAD_POLICY
    if working_root == managed_root:
        return _AGENT_GENERATED_UPLOAD_POLICY
    return _METADATA_ONLY_UPLOAD_POLICY


def _artifact_upload_policy(root: _ArtifactRoot, relative_path: str) -> str:
    """Keep execution internals out of the project-output upload lane."""

    path = Path(relative_path)
    if path.name in _SPACE_INTERNAL_ARTIFACT_NAMES:
        return _METADATA_ONLY_UPLOAD_POLICY
    if path.parts and path.parts[0] in _SPACE_INTERNAL_ARTIFACT_ROOTS:
        return _METADATA_ONLY_UPLOAD_POLICY
    return root.upload_policy


def _git_run_changed_artifacts(
    journal: SQLiteRunJournal,
    run: RunRecord,
) -> ArtifactScanResult | None:
    """Project exact committed Run changes from Git into Artifact metadata."""

    materialization = journal.get_run_git_materialization(run.run_id)
    if (
        materialization is None
        or materialization.workspace_base_commit is None
        or materialization.promoted_commit is None
        or materialization.materialization_state
        not in {"promoted", "archived"}
    ):
        return None
    repository = journal.get_git_repository(materialization.repository_id)
    project = journal.get_project_git_state(run.project_id)
    if repository is None or project is None:
        return None

    try:
        from app.workspace_git.backend import GitBackend

        git = GitBackend()
        changes = git.changed_paths_between(
            Path(repository.root_path),
            base_commit=materialization.workspace_base_commit,
            target_commit=materialization.promoted_commit,
        )
    except Exception:
        logger.exception(
            "Failed to derive authoritative Git Artifact changes",
            extra={"run_id": run.run_id},
        )
        return None

    visible_root = Path(repository.root_path).expanduser().resolve()
    if project.pending_apply:
        if project.worktree_path is None:
            return None
        visible_root = Path(project.worktree_path).expanduser().resolve()
    values: list[dict[str, Any]] = []
    truncated = len(changes) > MAX_ARTIFACTS_PER_RUN
    artifact_root = _ArtifactRoot(
        path=visible_root,
        scan_all=False,
        upload_policy=_AGENT_GENERATED_UPLOAD_POLICY,
    )
    for change in changes[:MAX_ARTIFACTS_PER_RUN]:
        if change.status in {"D", "T"}:
            continue
        path = visible_root / change.relative_path
        try:
            if path.is_symlink() or not path.is_file():
                continue
            stat_result = path.stat()
        except OSError:
            continue
        values.append(
            {
                "filename": path.name,
                "path": str(path.resolve()),
                "relativePath": change.relative_path,
                "changeType": (
                    "generated" if change.status == "A" else "changed"
                ),
                "size": stat_result.st_size,
                "modifiedAt": stat_result.st_mtime * 1000,
                "supportsRanges": True,
                "uploadPolicy": _artifact_upload_policy(
                    artifact_root, change.relative_path
                ),
            }
        )
    return ArtifactScanResult(
        artifacts=values,
        scan_status="partial" if truncated else "complete",
        truncated=truncated,
    )


def discover_task_changed_files(
    snapshot: TaskSnapshot,
    max_entries: int = MAX_ARTIFACTS_PER_RUN,
    modification_windows: tuple[tuple[float, float | None], ...] | None = None,
    *,
    working_root_upload_policy: str = _METADATA_ONLY_UPLOAD_POLICY,
    list_files_fn: Callable[..., list[str]] = list_files,
) -> ArtifactScanResult:
    """Discover files generated or modified by one Run within hard budgets."""

    result: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    remaining = max_entries
    windows = modification_windows or ((snapshot.task_start_time - 1.0, None),)
    deadline = time.perf_counter() + MAX_ARTIFACT_SCAN_SECONDS
    scanned_entries = 0
    scan_limited = False

    def bounded_list_files(
        root: Path, *, limit: int, **kwargs: Any
    ) -> list[str]:
        nonlocal scanned_entries, scan_limited
        seconds_left = deadline - time.perf_counter()
        entries_left = MAX_ARTIFACT_SCAN_ENTRIES - scanned_entries
        if seconds_left <= 0 or entries_left <= 0:
            scan_limited = True
            return []
        stats: dict[str, float | int] = {}
        values = list_files_fn(
            str(root),
            base=str(root),
            # Read one look-ahead result so an exact result cap is not confused
            # with a complete scan.
            max_entries=limit + 1,
            max_scanned_entries=entries_left,
            max_scan_seconds=seconds_left,
            stats=stats,
            **kwargs,
        )
        scanned_entries += int(stats.get("scanned_entries", 0))
        if bool(stats.get("scan_limited", 0)) or len(values) > limit:
            scan_limited = True
        return values[:limit]

    for artifact_root in _task_change_roots(
        snapshot,
        working_root_upload_policy=working_root_upload_policy,
    ):
        root = artifact_root.path
        if remaining <= 0:
            scan_limited = True
            break
        if artifact_root.scan_all:
            paths = bounded_list_files(root, limit=remaining)
        else:
            paths = []
            window_seen: set[str] = set()
            for modified_after, modified_before in windows:
                if len(paths) >= remaining:
                    break
                window_paths = bounded_list_files(
                    root,
                    limit=remaining - len(paths),
                    modified_after=modified_after,
                    modified_before=modified_before,
                )
                for window_path in window_paths:
                    if window_path in window_seen:
                        continue
                    window_seen.add(window_path)
                    paths.append(window_path)
        for absolute_path in paths:
            try:
                path = Path(absolute_path).resolve()
                if not path.is_file():
                    continue
                identity = str(path)
                if identity in seen_paths:
                    continue
                relative_path = path.relative_to(root).as_posix()
                stat_result = path.stat()
            except (OSError, ValueError):
                # A tool may atomically replace or remove a file while the
                # final scan runs. One vanished file cannot poison the Run.
                continue

            seen_paths.add(identity)
            remaining -= 1
            result.append(
                {
                    "filename": path.name,
                    "path": identity,
                    "relativePath": relative_path,
                    "changeType": (
                        "generated" if artifact_root.scan_all else "changed"
                    ),
                    "size": stat_result.st_size,
                    "modifiedAt": stat_result.st_mtime * 1000,
                    "supportsRanges": True,
                    "uploadPolicy": _artifact_upload_policy(
                        artifact_root, relative_path
                    ),
                }
            )
            if remaining <= 0:
                break

    return ArtifactScanResult(
        artifacts=sorted(result, key=lambda item: item["relativePath"]),
        scan_status="partial" if scan_limited else "complete",
        truncated=scan_limited,
    )


def scan_task_changed_files(
    snapshot: TaskSnapshot,
    max_entries: int = MAX_ARTIFACTS_PER_RUN,
    modification_windows: tuple[tuple[float, float | None], ...] | None = None,
    *,
    working_root_upload_policy: str = _METADATA_ONLY_UPLOAD_POLICY,
    list_files_fn: Callable[..., list[str]] = list_files,
) -> list[dict[str, Any]]:
    """Compatibility wrapper returning only the bounded Artifact list."""

    return discover_task_changed_files(
        snapshot,
        max_entries=max_entries,
        modification_windows=modification_windows,
        working_root_upload_policy=working_root_upload_policy,
        list_files_fn=list_files_fn,
    ).artifacts


def task_modification_windows(
    journal: SQLiteRunJournal,
    run_id: str,
    project_id: str,
) -> tuple[tuple[tuple[float, float | None], ...] | None, bool]:
    """Return filesystem mtime windows owned by this Run's attempts."""

    run = journal.get_run(run_id)
    if run is None or run.project_id != project_id:
        return None, False

    attempts = journal.list_run_attempts(run_id)
    windows: list[tuple[float, float | None]] = []
    for attempt in attempts:
        end = attempt.ended_at
        if end is None and run.status not in _ACTIVE_RUN_STATUSES:
            end = run.updated_at
        windows.append((attempt.started_at - 1.0, end))

    if not windows:
        end = (
            run.updated_at if run.status not in _ACTIVE_RUN_STATUSES else None
        )
        windows.append((run.created_at - 1.0, end))

    return tuple(windows), run.status in {"completed", "failed", "cancelled"}


def _artifact_projection(
    *, run_id: str, artifact: dict[str, Any]
) -> dict[str, Any]:
    relative_path = str(artifact.get("relativePath") or "")
    change_type = str(artifact.get("changeType") or "changed")
    artifact_id = (
        "art_"
        + hashlib.sha256(
            f"{run_id}\0{change_type}\0{relative_path}".encode()
        ).hexdigest()[:32]
    )
    return {"artifact_id": artifact_id, **dict(artifact)}


def record_artifact_manifest(
    journal: SQLiteRunJournal,
    *,
    run_id: str,
    project_id: str,
    artifacts: list[dict[str, Any]],
    scan_status: str = "complete",
    truncated: bool = False,
) -> CommittedRunEvent:
    """Commit Artifact lifecycle events followed by one manifest barrier."""

    step_by_path: dict[str, str] = {}
    for event in journal.list_events(run_id):
        relative_path = str(
            event.payload.get("relative_path")
            or event.payload.get("relativePath")
            or ""
        ).strip()
        step_id = str(event.payload.get("step_id") or "").strip()
        if relative_path and step_id:
            step_by_path[relative_path.replace("\\", "/")] = step_id
    projected: list[dict[str, Any]] = []
    for item in artifacts:
        relative_path = str(
            item.get("relativePath") or item.get("relative_path") or ""
        ).replace("\\", "/")
        attributed = dict(item)
        if relative_path in step_by_path:
            attributed["step_id"] = step_by_path[relative_path]
        projected.append(
            _artifact_projection(run_id=run_id, artifact=attributed)
        )
    drafts: list[RunEventDraft] = []
    for artifact in projected:
        event_type = (
            "artifact.created"
            if artifact.get("changeType") == "generated"
            else "artifact.modified"
        )
        event_digest = _canonical_digest(
            {
                "run_id": run_id,
                "event_type": event_type,
                "artifact": artifact,
            }
        )
        artifact_payload = {
            **semantic_event_fields(
                kind="file_change",
                subject_type="artifact",
                subject_id=str(artifact["artifact_id"]),
                phase="completed",
                status="completed",
                source="artifact_manifest",
                actor_type="agent",
                actor_id=str(artifact.get("agentId") or "") or None,
                correlation={
                    "run_id": run_id,
                    "task_id": artifact.get("taskId"),
                    "step_id": artifact.get("step_id"),
                },
            ),
            **artifact,
            "display_title": str(
                artifact.get("relativePath") or artifact.get("name") or "File"
            ),
            "display_summary": (
                "File created"
                if event_type == "artifact.created"
                else "File updated"
            ),
        }
        drafts.append(
            RunEventDraft(
                # Cloud canonical event ids are capped at 64 characters.
                event_id=f"ae_{event_digest[:61]}",
                event_type=event_type,
                payload=artifact_payload,
            )
        )

    manifest_body = {
        "artifacts": projected,
        "artifact_count": len(projected),
        "scan_status": scan_status,
        "truncated": truncated,
    }
    manifest_digest = _canonical_digest(
        {
            **manifest_body,
            # Absolute paths are machine-local transport data and should not
            # decide whether a logical manifest is the same across retries.
            "artifacts": [
                {key: value for key, value in item.items() if key != "path"}
                for item in projected
            ],
        }
    )
    manifest_payload = {**manifest_body, "manifest_digest": manifest_digest}
    # The durable id covers the local payload as stored. ``manifest_digest``
    # remains path-independent for logical comparison and Cloud projection.
    event_storage_digest = _canonical_digest(
        {"run_id": run_id, "payload": manifest_payload}
    )
    drafts.append(
        RunEventDraft(
            event_id=f"am_{event_storage_digest[:61]}",
            event_type="artifact.manifest.finalized",
            payload=manifest_payload,
        )
    )
    committed = journal.append_artifact_manifest_events(
        run_id,
        drafts,
        expected_project_id=project_id,
    )
    return committed


def finalize_run_artifacts(
    journal: SQLiteRunJournal,
    run: RunRecord,
) -> CommittedRunEvent:
    """Discover and commit a Run manifest exactly before its terminal event."""

    current_run = journal.get_run(run.run_id) or run
    existing = journal.get_run_artifact_manifest_event(run.run_id)
    if existing is not None and current_run.status in {
        "completed",
        "failed",
        "cancelled",
    }:
        return existing

    email: str | None = None
    user_id: str | int | None = None
    run_context = get_current_run_context()
    if run_context is not None and run_context.run_id == run.run_id:
        email = run_context.email
        user_id = run_context.user_id
    resolver = get_workspace_resolver()
    snapshot = (
        resolver.store.get_snapshot(email, run.run_id, user_id)
        if email
        else None
    )
    if snapshot is None:
        located = resolver.store.find_snapshot(run.run_id)
        if located is not None:
            email, snapshot = located
            user_id = snapshot.user_id
    if snapshot is None:
        return record_artifact_manifest(
            journal,
            run_id=run.run_id,
            project_id=run.project_id,
            artifacts=[],
            scan_status="workspace_unavailable",
        )
    if snapshot.project_id != run.project_id:
        return record_artifact_manifest(
            journal,
            run_id=run.run_id,
            project_id=run.project_id,
            artifacts=[],
            scan_status="workspace_mismatch",
        )

    if snapshot.artifact_manifest is not None and current_run.status in {
        "completed",
        "failed",
        "cancelled",
    }:
        artifacts = [dict(item) for item in snapshot.artifact_manifest]
        scan_status = "complete"
        truncated = False
    else:
        windows, _ = task_modification_windows(
            journal, run.run_id, run.project_id
        )
        scan_result = discover_task_changed_files(
            snapshot,
            modification_windows=windows,
            working_root_upload_policy=_working_root_upload_policy(
                snapshot,
                email=email,
                user_id=user_id,
            ),
        )
        git_result = _git_run_changed_artifacts(journal, run)
        if git_result is None:
            artifacts = scan_result.artifacts
            scan_status = scan_result.scan_status
            truncated = scan_result.truncated
        else:
            # Git owns Project output attribution. Keep direct Space internals
            # (todo/terminal logs) discovered outside the Git workspace, while
            # exact committed changes win for matching relative paths.
            git_by_path = {
                item["relativePath"]: item for item in git_result.artifacts
            }
            direct_only = [
                item
                for item in scan_result.artifacts
                if item["relativePath"] not in git_by_path
            ]
            ordered = sorted(
                git_by_path.values(), key=lambda item: item["relativePath"]
            ) + sorted(direct_only, key=lambda item: item["relativePath"])
            artifacts = ordered[:MAX_ARTIFACTS_PER_RUN]
            truncated = (
                scan_result.truncated
                or git_result.truncated
                or len(ordered) > MAX_ARTIFACTS_PER_RUN
            )
            scan_status = "partial" if truncated else "complete"

    manifest = record_artifact_manifest(
        journal,
        run_id=run.run_id,
        project_id=run.project_id,
        artifacts=artifacts,
        scan_status=scan_status,
        truncated=truncated,
    )
    try:
        resolver.store.freeze_artifact_manifest(email, snapshot, artifacts)
    except Exception:
        # The sidecar snapshot is a compatibility cache. SQLite is already
        # authoritative and must not be rolled back by a cache write failure.
        logger.exception(
            "Failed to cache finalized Artifact manifest",
            extra={"run_id": run.run_id},
        )
    return manifest


def finalize_recoverable_run_artifacts(
    journal: SQLiteRunJournal,
) -> tuple[str, ...]:
    """Finalize crash-surviving manifests before startup changes Run status."""

    finalized: list[str] = []
    for run in journal.list_recoverable_runs():
        try:
            finalize_run_artifacts(journal, run)
        except Exception:  # noqa: BLE001 - isolate one damaged workspace
            logger.exception(
                "Artifact recovery skipped one Run",
                extra={"run_id": run.run_id},
            )
            continue
        finalized.append(run.run_id)
    return tuple(finalized)
