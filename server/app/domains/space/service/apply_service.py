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
import os
import shutil
import threading
import weakref
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4

from sqlalchemy import text
from sqlmodel import Session, select

from app.domains.space.service.space_service import SpaceService
from app.model.project import Project
from app.model.space import (
    AppliedPath,
    ApplyConflict,
    ApplyFailure,
    ApplyResolutionIn,
    ApplyWarning,
    OVERLAY_SOURCE_PATH_METADATA_KEY,
    OVERLAY_SOURCE_ROOT_METADATA_KEY,
    Space,
    SpaceFileIndex,
    SpaceFileIndexOverlay,
    SpaceProjectApplyIn,
    SpaceProjectApplyResponse,
    SpaceSourceType,
)

_HASH_CHUNK_SIZE = 1024 * 1024
_APPLY_LOCKS: weakref.WeakValueDictionary[str, threading.Lock] = (
    weakref.WeakValueDictionary()
)
_APPLY_LOCKS_GUARD = threading.Lock()
_LOGGER = logging.getLogger(__name__)


def _thread_space_lock(space_id: str) -> threading.Lock:
    with _APPLY_LOCKS_GUARD:
        lock = _APPLY_LOCKS.get(space_id)
        if lock is None:
            lock = threading.Lock()
            _APPLY_LOCKS[space_id] = lock
        return lock


def _advisory_lock_key(space_id: str) -> int:
    digest = hashlib.sha256(f"eigent-space:{space_id}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


class SpaceWriteLock:
    """Canonical Space write lock shared by overlay writers and Apply.

    The thread lock protects single-process local Electron runs. When the
    server uses Postgres, we also take a connection-scoped advisory lock so
    multiple API workers cannot write the same Space concurrently.
    """

    def __init__(self, space_id: str) -> None:
        self.space_id = space_id
        self._thread_lock: threading.Lock | None = None
        self._connection = None
        self._lock_key = _advisory_lock_key(space_id)

    def __enter__(self) -> "SpaceWriteLock":
        self._thread_lock = _thread_space_lock(self.space_id)
        self._thread_lock.acquire()
        try:
            self._acquire_postgres_advisory_lock()
        except Exception:
            self._thread_lock.release()
            self._thread_lock = None
            raise
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            self._release_postgres_advisory_lock()
        finally:
            if self._thread_lock is not None:
                self._thread_lock.release()
                self._thread_lock = None

    def _acquire_postgres_advisory_lock(self) -> None:
        from app.core.database import engine

        if engine.url.get_backend_name() not in {"postgresql", "postgres"}:
            return
        self._connection = engine.connect()
        self._connection.execute(
            text("SELECT pg_advisory_lock(:lock_key)"),
            {"lock_key": self._lock_key},
        )

    def _release_postgres_advisory_lock(self) -> None:
        if self._connection is None:
            return
        try:
            self._connection.execute(
                text("SELECT pg_advisory_unlock(:lock_key)"),
                {"lock_key": self._lock_key},
            )
        except Exception as exc:  # noqa: BLE001 - unlock failure should not mask caller errors.
            _LOGGER.warning(
                "Failed to release Space advisory lock",
                extra={"space_id": self.space_id, "lock_key": self._lock_key, "error": str(exc)},
            )
        finally:
            self._connection.close()
            self._connection = None


def space_write_lock(space_id: str) -> SpaceWriteLock:
    """Return the canonical Space write lock context manager."""

    return SpaceWriteLock(space_id)


def sha256_of_file(path: Path) -> str | None:
    """Hash raw on-disk bytes. Missing files are NULL, distinct from empty files."""

    if not path.exists():
        return None
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Cannot hash non-regular file: {path}")

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_HASH_CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def _normalize_relative_path(path: str) -> PurePosixPath:
    normalized = PurePosixPath(path.replace("\\", "/"))
    if not normalized.parts or normalized.is_absolute() or ".." in normalized.parts:
        raise ValueError("Invalid relative path")
    return normalized


def normalize_overlay_path(path: str) -> str:
    return str(_normalize_relative_path(path))


def _resolve_under(root: Path, rel_path: str) -> Path:
    normalized = _normalize_relative_path(rel_path)
    candidate = (root / Path(*normalized.parts)).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Path escapes Space root") from exc
    return candidate


def _fsync_file(path: Path) -> None:
    with path.open("rb") as handle:
        os.fsync(handle.fileno())


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class SpaceApplyService:
    """Apply run-scoped Project overlays back to a folder-backed Space."""

    @staticmethod
    def apply_project_run(
        space_id: str,
        project_id: str,
        data: SpaceProjectApplyIn,
        user_id: int | str,
        s: Session,
    ) -> SpaceProjectApplyResponse:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        space = SpaceService.get_space(space_id, canonical_user_id, s)
        project = s.exec(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == canonical_user_id,
            )
        ).first()
        if not project or project.space_id != space_id:
            raise ValueError("Project not found")
        if space.source_type != SpaceSourceType.FOLDER or not space.root_path:
            raise ValueError("Apply requires a folder-backed Space")

        root = Path(space.root_path).resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("Space root is not available")

        requested_paths = set(data.paths or [])
        query = select(SpaceFileIndexOverlay).where(
            SpaceFileIndexOverlay.space_id == space_id,
            SpaceFileIndexOverlay.project_id == project_id,
            SpaceFileIndexOverlay.run_id == data.run_id,
        )
        if requested_paths:
            query = query.where(SpaceFileIndexOverlay.path.in_(requested_paths))
        rows = s.exec(query.order_by(SpaceFileIndexOverlay.id)).all()

        response = SpaceProjectApplyResponse(
            kind="success",
            space_id=space_id,
            project_id=project_id,
            run_id=data.run_id,
        )
        if not rows:
            return response

        resolutions = {
            resolution.path: resolution
            for resolution in data.force_resolutions or []
        }

        with space_write_lock(space_id):
            actions: list[tuple[SpaceFileIndexOverlay, str, ApplyResolutionIn | None]] = []
            for row in rows:
                resolution = resolutions.get(row.path)
                try:
                    target = _resolve_under(root, row.path)
                    current_hash = sha256_of_file(target)
                except ValueError as exc:
                    response.conflicts.append(
                        ApplyConflict(
                            path=row.path,
                            status=row.status,
                            base_hash=row.base_hash,
                            mine_hash=row.hash,
                            message=str(exc),
                        )
                    )
                    continue

                if current_hash != row.base_hash:
                    action = resolution.action if resolution else ""
                    if action not in {"apply_mine", "keep_theirs", "write_chosen"}:
                        response.conflicts.append(
                            ApplyConflict(
                                path=row.path,
                                status=row.status,
                                base_hash=row.base_hash,
                                current_hash=current_hash,
                                mine_hash=row.hash,
                                message="Space file changed since this run started",
                            )
                        )
                        continue
                actions.append((row, resolution.action if resolution else "apply_mine", resolution))

            if response.conflicts:
                response.kind = "conflict"
                return response

            for row, action, resolution in actions:
                if action == "keep_theirs":
                    try:
                        live_hash = sha256_of_file(_resolve_under(root, row.path))
                        SpaceApplyService._update_index(space, row.path, live_hash, s)
                        s.delete(row)
                        s.commit()
                        response.applied.append(
                            AppliedPath(path=row.path, status="kept_theirs", hash=live_hash)
                        )
                    except Exception as exc:  # noqa: BLE001 - per-path failure must keep overlay.
                        s.rollback()
                        response.failed.append(
                            ApplyFailure(
                                path=row.path,
                                reason="keep_theirs_failed",
                                message=str(exc),
                            )
                        )
                    continue

                try:
                    applied_hash, warnings = SpaceApplyService._apply_row_to_disk(
                        root=root,
                        row=row,
                        action=action,
                        resolution=resolution,
                    )
                    response.warnings.extend(warnings)
                    SpaceApplyService._update_index(space, row.path, applied_hash, s)
                    s.delete(row)
                    s.commit()
                    response.applied.append(
                        AppliedPath(path=row.path, status=row.status, hash=applied_hash)
                    )
                except Exception as exc:  # noqa: BLE001 - per-path failure keeps overlay retryable.
                    s.rollback()
                    response.failed.append(
                        ApplyFailure(
                            path=row.path,
                            reason="apply_path_failed",
                            message=str(exc),
                        )
                    )

            response.kind = "partial" if response.failed else "success"
            return response

    @staticmethod
    def _apply_row_to_disk(
        *,
        root: Path,
        row: SpaceFileIndexOverlay,
        action: str,
        resolution: ApplyResolutionIn | None,
    ) -> tuple[str | None, list[ApplyWarning]]:
        target = _resolve_under(root, row.path)
        warnings: list[ApplyWarning] = []

        if row.status == "deleted":
            if target.exists() and (target.is_symlink() or not target.is_file()):
                raise ValueError("Cannot delete non-regular file")
            if target.exists():
                target.unlink()
                warnings.extend(SpaceApplyService._warn_parent_fsync(target.parent, row.path))
            return None, warnings

        source = SpaceApplyService._resolve_source_path(row, action, resolution)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.parent / f".{target.name}.apply-{uuid4().hex}.tmp"
        try:
            shutil.copyfile(source, tmp)
            if row.mode is not None:
                os.chmod(tmp, row.mode)
            _fsync_file(tmp)
            staged_hash = sha256_of_file(tmp)
            expected_hash = resolution.hash if action == "write_chosen" and resolution else row.hash
            if expected_hash and staged_hash != expected_hash:
                raise ValueError("hash_mismatch_before_swap")
            os.replace(tmp, target)
            warnings.extend(SpaceApplyService._warn_parent_fsync(target.parent, row.path))
            return staged_hash, warnings
        finally:
            if tmp.exists():
                tmp.unlink()

    @staticmethod
    def _resolve_source_path(
        row: SpaceFileIndexOverlay,
        action: str,
        resolution: ApplyResolutionIn | None,
    ) -> Path:
        metadata = row.metadata_json or {}
        if action == "write_chosen":
            raw_source = resolution.content_ref if resolution else None
        else:
            raw_source = (
                metadata.get(OVERLAY_SOURCE_PATH_METADATA_KEY)
                or metadata.get("workdir_path")
                or metadata.get("sourceFile")
            )
        if not raw_source:
            raise ValueError("Overlay row is missing source_path metadata")
        raw_source_root = (
            metadata.get(OVERLAY_SOURCE_ROOT_METADATA_KEY)
            or metadata.get("workdir_root")
            or metadata.get("project_workdir")
        )
        if not raw_source_root:
            raise ValueError("Overlay row is missing source_root metadata")
        source_root = Path(str(raw_source_root)).expanduser().resolve()
        source = Path(str(raw_source)).expanduser().resolve()
        try:
            source.relative_to(source_root)
        except ValueError as exc:
            raise ValueError("Overlay source escapes source_root") from exc
        if source.is_symlink() or not source.is_file():
            raise ValueError("Overlay source is not a regular file")
        return source

    @staticmethod
    def _warn_parent_fsync(parent: Path, path: str) -> list[ApplyWarning]:
        try:
            _fsync_dir(parent)
            return []
        except OSError as exc:
            return [
                ApplyWarning(
                    code="durability_warning",
                    path=path,
                    message=f"Parent directory fsync failed after commit: {exc}",
                )
            ]

    @staticmethod
    def _update_index(
        space: Space,
        rel_path: str,
        file_hash: str | None,
        s: Session,
    ) -> None:
        existing = s.exec(
            select(SpaceFileIndex).where(
                SpaceFileIndex.space_id == space.id,
                SpaceFileIndex.path == rel_path,
            )
        ).first()
        if file_hash is None:
            if existing:
                s.delete(existing)
            return

        target = _resolve_under(Path(space.root_path).resolve(), rel_path)
        stat_result = target.stat()
        if existing is None:
            existing = SpaceFileIndex(space_id=space.id, path=rel_path)
        existing.hash = file_hash
        existing.size = stat_result.st_size
        existing.mode = stat_result.st_mode
        existing.modified_at = datetime.fromtimestamp(stat_result.st_mtime, timezone.utc)
        existing.indexed_at = datetime.now(timezone.utc)
        existing.row_version = (existing.row_version or 0) + 1
        s.add(existing)
