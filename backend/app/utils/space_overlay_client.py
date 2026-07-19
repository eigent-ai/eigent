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

from __future__ import annotations

import hashlib
import logging
import threading
import weakref
from pathlib import Path, PurePosixPath
from typing import Literal

import httpx

from app.run_context import RunContext, get_current_run_context
from app.service.task import get_task_lock_if_exists

logger = logging.getLogger("space_overlay")

HASH_CHUNK_SIZE = 1024 * 1024

_PATH_LOCKS: weakref.WeakValueDictionary[
    tuple[str, str, str, str], threading.Lock
] = weakref.WeakValueDictionary()
_PATH_LOCKS_GUARD = threading.Lock()
_OVERLAY_SYNC_FAILURES = 0
_OVERLAY_SYNC_FAILURES_GUARD = threading.Lock()


def normalize_server_url(server_url: str | None) -> str:
    if not server_url:
        return ""
    trimmed = server_url.rstrip("/")
    if trimmed.endswith("/api/v1"):
        return trimmed
    return f"{trimmed}/api/v1"


def sha256_of_file(path: Path) -> str | None:
    if not path.exists():
        return None
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Cannot hash non-regular file: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(HASH_CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_relative_path(path: str) -> str:
    normalized = PurePosixPath(path.replace("\\", "/"))
    if (
        not normalized.parts
        or normalized.is_absolute()
        or ".." in normalized.parts
    ):
        raise ValueError("Invalid relative path")
    return str(normalized)


def path_write_lock(
    space_id: str,
    project_id: str,
    run_id: str,
    rel_path: str,
) -> threading.Lock:
    """Return the per-run/path writer lock.

    The lock cache is weakly held to avoid unbounded growth. Callers must keep
    the returned lock strongly referenced for the whole critical section,
    preferably as `with path_write_lock(...):`.
    """

    key = (space_id, project_id, run_id, rel_path)
    with _PATH_LOCKS_GUARD:
        lock = _PATH_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _PATH_LOCKS[key] = lock
        return lock


def overlay_sync_failure_count() -> int:
    with _OVERLAY_SYNC_FAILURES_GUARD:
        return _OVERLAY_SYNC_FAILURES


def _record_overlay_sync_failure(
    *,
    reason: str,
    context: RunContext,
    rel_path: str,
    error_message: str,
) -> None:
    global _OVERLAY_SYNC_FAILURES
    with _OVERLAY_SYNC_FAILURES_GUARD:
        _OVERLAY_SYNC_FAILURES += 1
        failure_count = _OVERLAY_SYNC_FAILURES
    logger.error(
        "space_overlay_sync_failed",
        extra={
            "overlay_reason": reason,
            "overlay_space_id": context.space_id,
            "overlay_project_id": context.project_id,
            "overlay_run_id": context.run_id,
            "overlay_path": rel_path,
            "overlay_failure_count": failure_count,
            "overlay_error_message": error_message,
        },
    )


def run_context_for_task(api_task_id: str) -> RunContext | None:
    context = get_current_run_context()
    if context is not None:
        return context
    task_lock = get_task_lock_if_exists(api_task_id)
    return getattr(task_lock, "run_context", None) if task_lock else None


def relative_to_workdir(
    context: RunContext, path: str | Path
) -> tuple[str, Path] | None:
    workdir = context.working_directory.expanduser().resolve()
    target = Path(path).expanduser()
    if not target.is_absolute():
        target = workdir / target
    target = target.resolve()
    try:
        rel = target.relative_to(workdir)
    except ValueError:
        return None
    return normalize_relative_path(rel.as_posix()), target


def should_record_overlay(context: RunContext, target: Path) -> bool:
    if not context.server_url or not context.auth_header:
        return False
    if context.workdir_mode in {"direct-write", "artifact-only"}:
        return False
    if (
        context.working_directory.resolve()
        == context.task_output_root.resolve()
    ):
        return False
    try:
        target.relative_to(context.task_output_root.expanduser().resolve())
        return False
    except ValueError:
        return True


def post_overlay_write(
    context: RunContext,
    rel_path: str,
    target_path: Path,
    *,
    base_hash: str | None,
    status: Literal["added", "modified", "deleted"],
    file_hash: str | None = None,
    size: int | None = None,
    mode: int | None = None,
) -> bool:
    if not should_record_overlay(context, target_path):
        return True

    server_url = normalize_server_url(context.server_url)
    if not server_url:
        return True

    if status == "deleted":
        file_hash = None
    elif file_hash is None:
        file_hash = sha256_of_file(target_path)
    if (size is None or mode is None) and target_path.exists():
        stat_result = target_path.stat()
        size = stat_result.st_size if size is None else size
        mode = stat_result.st_mode if mode is None else mode
    payload = {
        "run_id": context.run_id,
        "path": rel_path,
        "status": status,
        "hash": file_hash,
        "base_hash": base_hash,
        "base_snapshot_id": context.extra_env.get("baseSnapshotId"),
        "size": size,
        "mode": mode,
        "source_path": str(target_path),
        "source_root": str(context.working_directory.expanduser().resolve()),
        "metadata": {},
    }
    url = (
        f"{server_url}/spaces/{context.space_id}/projects/"
        f"{context.project_id}/overlays"
    )
    headers = {"Authorization": context.auth_header}
    if context.user_id:
        headers["X-User-ID"] = context.user_id

    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.post(url, json=payload, headers=headers)
            if response.is_error:
                _record_overlay_sync_failure(
                    reason=f"http_{response.status_code}",
                    context=context,
                    rel_path=rel_path,
                    error_message=response.text[:500],
                )
                return False
            return True
    except Exception as exc:  # noqa: BLE001 - overlay sync must not fail the tool write.
        _record_overlay_sync_failure(
            reason="exception",
            context=context,
            rel_path=rel_path,
            error_message=str(exc),
        )
        return False
