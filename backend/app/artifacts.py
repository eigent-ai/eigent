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
from app.run_journal.store import SQLiteRunJournal
from app.utils.file_utils import list_files
from app.utils.workspace_resolver import TaskSnapshot, get_workspace_resolver

logger = logging.getLogger("artifacts")

MAX_ARTIFACTS_PER_RUN = 500
MAX_ARTIFACT_SCAN_SECONDS = 3.0
MAX_ARTIFACT_SCAN_ENTRIES = 100_000
_ACTIVE_RUN_STATUSES = {"pending", "running", "waiting_for_user"}


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


def _task_change_roots(snapshot: TaskSnapshot) -> list[tuple[Path, bool]]:
    """Return Run roots as ``(path, include_all)`` tuples."""

    output_root = Path(snapshot.task_output_root).expanduser().resolve()
    working_root = Path(snapshot.working_directory).expanduser().resolve()
    roots: list[tuple[Path, bool]] = []
    if output_root.is_dir():
        roots.append((output_root, True))
    if working_root != output_root and working_root.is_dir():
        roots.append((working_root, False))
    return roots


def discover_task_changed_files(
    snapshot: TaskSnapshot,
    max_entries: int = MAX_ARTIFACTS_PER_RUN,
    modification_windows: tuple[tuple[float, float | None], ...] | None = None,
    *,
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

    for root, include_all in _task_change_roots(snapshot):
        if remaining <= 0:
            scan_limited = True
            break
        if include_all:
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
                    "changeType": "generated" if include_all else "changed",
                    "size": stat_result.st_size,
                    "modifiedAt": stat_result.st_mtime * 1000,
                    "supportsRanges": True,
                    # Files copied/generated in the Run-owned output root may
                    # be uploaded by the existing explicit upload pipeline.
                    # Edited files from a selected user folder are metadata-only.
                    "uploadPolicy": (
                        "agent_generated" if include_all else "metadata_only"
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
    list_files_fn: Callable[..., list[str]] = list_files,
) -> list[dict[str, Any]]:
    """Compatibility wrapper returning only the bounded Artifact list."""

    return discover_task_changed_files(
        snapshot,
        max_entries=max_entries,
        modification_windows=modification_windows,
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

    projected = [
        _artifact_projection(run_id=run_id, artifact=item)
        for item in artifacts
    ]
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
        drafts.append(
            RunEventDraft(
                # Cloud canonical event ids are capped at 64 characters.
                event_id=f"ae_{event_digest[:61]}",
                event_type=event_type,
                payload=artifact,
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
            snapshot, modification_windows=windows
        )
        artifacts = scan_result.artifacts
        scan_status = scan_result.scan_status
        truncated = scan_result.truncated

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
