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

"""Commit-addressed Project reads with a bounded User Worktree overlay."""

from __future__ import annotations

import hashlib
import os
import re
import stat
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from app.run_journal import (
    SQLiteRunJournal,
    WorkspaceOverlayEntryRecord,
    WorkspaceReadSnapshotRecord,
)
from app.workspace_config import canonical_digest
from app.workspace_git.backend import GitBackend, GitBackendError
from app.workspace_git.content import ContentRepositoryError

DEFAULT_READ_BYTES = 256 * 1024
MAX_READ_BYTES = 4 * 1024 * 1024
MAX_OVERLAY_MATERIALIZE_BYTES = 256 * 1024 * 1024
MAX_SOURCE_CHANGE_RETRIES = 2


class WorkspaceSnapshotError(ContentRepositoryError):
    code = "workspace_snapshot_error"
    retryable = False
    refresh_available = False
    automatic_retry_limit = 0


class WorkspaceSnapshotUnavailableError(WorkspaceSnapshotError):
    code = "workspace_snapshot_unavailable"


class WorkspaceSourceChangedError(WorkspaceSnapshotError):
    code = "workspace_source_changed"
    retryable = True
    refresh_available = True
    automatic_retry_limit = MAX_SOURCE_CHANGE_RETRIES


class WorkspaceOverlayConflictError(WorkspaceSnapshotError):
    code = "workspace_overlay_conflict"


class WorkspacePathNotFoundError(WorkspaceSnapshotError):
    code = "workspace_path_not_found"


@dataclass(frozen=True)
class WorkspaceSnapshotRead:
    snapshot: WorkspaceReadSnapshotRecord
    relative_path: str
    source_kind: str
    start_offset: int
    end_offset: int
    size_bytes: int
    content_digest: str
    content: bytes


@dataclass(frozen=True)
class MaterializedOverlay:
    snapshot: WorkspaceReadSnapshotRecord
    entry: WorkspaceOverlayEntryRecord
    relative_path: str
    content_digest: str
    size_bytes: int
    preimage_path: Path
    destination_path: Path


class WorkspaceSnapshotService:
    """Resolve one Run's filesystem reads against a stable logical view.

    Project data comes from a pinned Git commit. User dirty/untracked content
    is admitted path-by-path and cached by digest only after a stable bounded
    read. No local file content is written to SQLite or uploaded.
    """

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        state_root: Path,
        git_backend: GitBackend | None = None,
        max_read_bytes: int = MAX_READ_BYTES,
    ) -> None:
        if max_read_bytes < 1:
            raise ValueError("max_read_bytes must be positive")
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.cache_root = self.state_root / "snapshots" / "cache"
        self.git = git_backend or GitBackend()
        self.max_read_bytes = max_read_bytes

    def get_snapshot(self, run_id: str) -> WorkspaceReadSnapshotRecord | None:
        return self.journal.get_active_workspace_read_snapshot(run_id)

    def pin_path(
        self,
        *,
        run_id: str,
        relative_path: str,
    ) -> WorkspaceOverlayEntryRecord:
        """Pin one path without reading its bytes into memory."""

        path = self._normalize_path(relative_path)
        snapshot = self._ensure_snapshot(run_id)
        entry = self.journal.get_workspace_overlay_entry(
            snapshot.snapshot_id,
            path,
        )
        return entry or self._expand_path(snapshot, path)

    def materialize_user_overlay(
        self,
        *,
        run_id: str,
        relative_path: str,
        destination_root: Path,
        max_bytes: int = MAX_OVERLAY_MATERIALIZE_BYTES,
    ) -> MaterializedOverlay:
        """Copy one pinned User overlay into an Eigent-owned worktree.

        The copy is streaming and stable-token checked. The content-addressed
        preimage stays local so a later Agent modification can checkpoint the
        exact User preimage without rereading a mutable User Worktree source.
        """

        if max_bytes < 1:
            raise ValueError("max_bytes must be positive")
        path = self._normalize_path(relative_path)
        snapshot = self._ensure_snapshot(run_id)
        entry = self.journal.get_workspace_overlay_entry(
            snapshot.snapshot_id,
            path,
        )
        if entry is None:
            entry = self._expand_path(snapshot, path)
        if entry.source_kind != "user_overlay":
            raise WorkspaceSnapshotError(
                f"Workspace path {path!r} is not a User overlay"
            )
        if entry.entry_state in {"imported_preimage", "agent_modified"}:
            if (
                entry.materialized_content_digest is None
                or entry.preimage_cache_key is None
            ):
                raise WorkspaceSnapshotUnavailableError(
                    f"User overlay {path!r} is missing its pinned preimage"
                )
            preimage = (
                self.cache_root
                / "preimages"
                / entry.preimage_cache_key[:2]
                / entry.preimage_cache_key
            )
            if (
                not preimage.is_file()
                or self._digest_file(preimage)
                != entry.materialized_content_digest
            ):
                raise WorkspaceSnapshotUnavailableError(
                    f"User overlay {path!r} preimage cache is unavailable"
                )
            destination_root = destination_root.expanduser().resolve()
            destination = self._safe_destination(destination_root, path)
            if entry.entry_state == "imported_preimage":
                self._copy_file(preimage, destination)
            return MaterializedOverlay(
                snapshot=snapshot,
                entry=entry,
                relative_path=path,
                content_digest=entry.materialized_content_digest,
                size_bytes=entry.size_bytes,
                preimage_path=preimage,
                destination_path=destination,
            )
        if entry.size_bytes > max_bytes:
            raise WorkspaceSnapshotUnavailableError(
                f"User overlay {path!r} exceeds the materialization limit"
            )
        repository = self.journal.get_git_repository(snapshot.repository_id)
        if repository is None:
            raise WorkspaceSnapshotUnavailableError(
                "Snapshot Content Repository is unavailable"
            )
        user_root = Path(repository.root_path).expanduser().resolve()
        source = self._safe_user_path(user_root, path)
        if source is None:
            raise WorkspaceSourceChangedError(
                f"User source {path!r} is no longer available"
            )
        if (
            self._path_token(
                source,
                head_oid=entry.source_token.get("head_oid"),
            )
            != entry.source_token
        ):
            raise WorkspaceSourceChangedError(
                f"User source {path!r} changed after pin"
            )
        destination_root = destination_root.expanduser().resolve()
        destination = self._safe_destination(destination_root, path)
        temporary = (
            self.cache_root
            / "imports"
            / (f".{snapshot.snapshot_id}.{uuid.uuid4().hex}.tmp")
        )
        temporary.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        try:
            with (
                source.open("rb", buffering=0) as reader,
                temporary.open("wb", buffering=0) as writer,
            ):
                opened_before = self._stat_token(
                    os.fstat(reader.fileno()),
                    head_oid=entry.source_token.get("head_oid"),
                )
                if opened_before != entry.source_token:
                    raise WorkspaceSourceChangedError(
                        f"User source {path!r} changed before import"
                    )
                while True:
                    chunk = reader.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise WorkspaceSnapshotUnavailableError(
                            f"User overlay {path!r} grew past the limit"
                        )
                    digest.update(chunk)
                    writer.write(chunk)
                opened_after = self._stat_token(
                    os.fstat(reader.fileno()),
                    head_oid=entry.source_token.get("head_oid"),
                )
            if opened_after != opened_before or size != entry.size_bytes:
                raise WorkspaceSourceChangedError(
                    f"User source {path!r} changed during import"
                )
            content_digest = digest.hexdigest()
            preimage = (
                self.cache_root
                / "preimages"
                / content_digest[:2]
                / (content_digest)
            )
            preimage.parent.mkdir(parents=True, exist_ok=True)
            if preimage.exists():
                if self._digest_file(preimage) != content_digest:
                    raise WorkspaceSnapshotUnavailableError(
                        "Overlay preimage cache digest collision"
                    )
                temporary.unlink(missing_ok=True)
            else:
                temporary.chmod(0o600)
                os.replace(temporary, preimage)
            self._copy_file(preimage, destination)
        finally:
            temporary.unlink(missing_ok=True)
        self.journal.complete_workspace_overlay_materialization(
            snapshot_id=snapshot.snapshot_id,
            relative_path=path,
            content_digest=content_digest,
            preimage_cache_key=content_digest,
        )
        persisted = self.journal.get_workspace_overlay_entry(
            snapshot.snapshot_id,
            path,
        )
        assert persisted is not None
        return MaterializedOverlay(
            snapshot=snapshot,
            entry=persisted,
            relative_path=path,
            content_digest=content_digest,
            size_bytes=size,
            preimage_path=preimage,
            destination_path=destination,
        )

    def refresh_snapshot(
        self,
        run_id: str,
        *,
        expected_user_working_state_digest: str,
    ) -> WorkspaceReadSnapshotRecord:
        """Explicitly discard the active logical view and pin a new one."""

        run = self.journal.get_run_git_materialization(run_id)
        if run is None:
            raise WorkspaceSnapshotUnavailableError(
                f"Run {run_id!r} has no admitted Content Repository"
            )
        repository = self.journal.get_git_repository(run.repository_id)
        if repository is None:
            raise WorkspaceSnapshotUnavailableError(
                "Snapshot Content Repository is unavailable"
            )
        current = self.git.repo_state_token(Path(repository.root_path))
        if current.digest != expected_user_working_state_digest:
            raise WorkspaceSourceChangedError(
                "User working state changed before snapshot refresh"
            )
        self.journal.replace_active_workspace_read_snapshot(run_id)
        return self._ensure_snapshot(run_id)

    def read_range(
        self,
        *,
        run_id: str,
        relative_path: str,
        start_offset: int = 0,
        max_bytes: int = DEFAULT_READ_BYTES,
    ) -> WorkspaceSnapshotRead:
        path = self._normalize_path(relative_path)
        if start_offset < 0:
            raise ValueError("start_offset must be non-negative")
        if max_bytes < 1 or max_bytes > self.max_read_bytes:
            raise ValueError(
                f"max_bytes must be between 1 and {self.max_read_bytes}"
            )
        snapshot = self._ensure_snapshot(run_id)
        entry = self.journal.get_workspace_overlay_entry(
            snapshot.snapshot_id,
            path,
        )
        if entry is None:
            entry = self._expand_path(snapshot, path)
            snapshot = (
                self.journal.get_workspace_read_snapshot(snapshot.snapshot_id)
                or snapshot
            )
        end_offset = min(entry.size_bytes, start_offset + max_bytes)
        if start_offset >= entry.size_bytes:
            end_offset = start_offset
        persisted_range = self.journal.get_workspace_snapshot_range(
            snapshot_id=snapshot.snapshot_id,
            relative_path=path,
            start_offset=start_offset,
            end_offset=end_offset,
        )
        if persisted_range is not None:
            cached = self._read_cache(persisted_range.cache_key)
            if cached is not None:
                return WorkspaceSnapshotRead(
                    snapshot=snapshot,
                    relative_path=path,
                    source_kind=entry.source_kind,
                    start_offset=start_offset,
                    end_offset=end_offset,
                    size_bytes=entry.size_bytes,
                    content_digest=persisted_range.content_digest,
                    content=cached,
                )

        if end_offset == start_offset:
            content = b""
        else:
            content = self._read_entry(
                snapshot,
                entry,
                start_offset=start_offset,
                max_bytes=end_offset - start_offset,
            )
        if len(content) != end_offset - start_offset:
            raise WorkspaceSnapshotUnavailableError(
                f"Snapshot source for {path!r} ended unexpectedly"
            )
        content_digest = hashlib.sha256(content).hexdigest()
        cache_key = self._write_cache(content_digest, content)
        self.journal.record_workspace_snapshot_range(
            snapshot_id=snapshot.snapshot_id,
            relative_path=path,
            start_offset=start_offset,
            end_offset=end_offset,
            content_digest=content_digest,
            cache_key=cache_key,
        )
        return WorkspaceSnapshotRead(
            snapshot=snapshot,
            relative_path=path,
            source_kind=entry.source_kind,
            start_offset=start_offset,
            end_offset=end_offset,
            size_bytes=entry.size_bytes,
            content_digest=content_digest,
            content=content,
        )

    def _ensure_snapshot(self, run_id: str) -> WorkspaceReadSnapshotRecord:
        active = self.journal.get_active_workspace_read_snapshot(run_id)
        if active is not None:
            self._ensure_snapshot_ref(active)
            return active
        run = self.journal.get_run_git_materialization(run_id)
        if run is None:
            raise WorkspaceSnapshotUnavailableError(
                f"Run {run_id!r} has no admitted Content Repository"
            )
        project = self.journal.get_project_git_state(run.project_id)
        repository = self.journal.get_git_repository(run.repository_id)
        if project is None or repository is None:
            raise WorkspaceSnapshotUnavailableError(
                "Run snapshot owner is unavailable"
            )
        root = Path(repository.root_path)
        token = self.git.repo_state_token(root)
        snapshot_id = f"wss_{uuid.uuid4().hex}"
        snapshot_ref = (
            "refs/eigent/snapshot/"
            + canonical_digest(
                {
                    "repository_id": repository.repository_id,
                    "run_id": run_id,
                    "snapshot_id": snapshot_id,
                }
            )[:32]
            if run.workspace_base_commit is not None
            else None
        )
        snapshot = self.journal.create_workspace_read_snapshot(
            snapshot_id=snapshot_id,
            run_id=run_id,
            project_id=run.project_id,
            repository_id=run.repository_id,
            project_base_commit=run.workspace_base_commit,
            common_base_commit=project.last_synced_user_head,
            project_state_version=project.version,
            snapshot_ref=snapshot_ref,
            user_head=token.head_oid,
            user_working_state_digest=token.digest,
        )
        self._ensure_snapshot_ref(snapshot)
        return snapshot

    def _ensure_snapshot_ref(
        self,
        snapshot: WorkspaceReadSnapshotRecord,
    ) -> None:
        if (
            snapshot.snapshot_ref is None
            or snapshot.project_base_commit is None
        ):
            return
        repository = self.journal.get_git_repository(snapshot.repository_id)
        if repository is None:
            raise WorkspaceSnapshotUnavailableError(
                "Snapshot Content Repository is unavailable"
            )
        root = Path(repository.root_path)
        observed = self.git.ref_oid(root, snapshot.snapshot_ref)
        if observed is None:
            self.git.update_eigent_ref(
                root,
                snapshot.snapshot_ref,
                snapshot.project_base_commit,
            )
        elif observed != snapshot.project_base_commit:
            raise WorkspaceSnapshotUnavailableError(
                "Snapshot ref no longer points at its pinned commit"
            )

    def _expand_path(
        self,
        snapshot: WorkspaceReadSnapshotRecord,
        relative_path: str,
    ) -> WorkspaceOverlayEntryRecord:
        repository = self.journal.get_git_repository(snapshot.repository_id)
        if repository is None:
            raise WorkspaceSnapshotUnavailableError(
                "Snapshot Content Repository is unavailable"
            )
        root = Path(repository.root_path).expanduser().resolve()
        current_head = self.git.current_head(root)
        project_blob = self._blob_at(
            root,
            snapshot.project_base_commit,
            relative_path,
        )
        baseline_blob = self._blob_at(
            root,
            snapshot.common_base_commit,
            relative_path,
        )
        user_blob = self._blob_at(root, current_head, relative_path)
        candidate = self._safe_user_path(root, relative_path)
        dirty = bool(self.git.path_status(root, (root / relative_path,)))
        user_commit_changed = user_blob != baseline_blob
        user_changed = dirty or user_commit_changed
        project_changed = project_blob != baseline_blob
        same_project_content = False
        if user_changed and project_blob is not None and candidate is not None:
            try:
                same_project_content = (
                    self.git.hash_worktree_file(root, candidate)
                    == project_blob
                )
            except GitBackendError as exc:
                raise WorkspaceSnapshotUnavailableError(
                    f"Could not compare Workspace path {relative_path!r} "
                    "with its pinned Project blob"
                ) from exc

        if user_changed and project_changed:
            if not same_project_content:
                raise WorkspaceOverlayConflictError(
                    f"Both Project and User sources changed {relative_path!r}"
                )

        # Project projection intentionally leaves the visible Space dirty
        # relative to User ``main``. When its actual bytes already equal the
        # pinned Project blob, use that immutable blob rather than treating
        # the projection as a competing User edit or pinning an ephemeral
        # Worktree file.
        if same_project_content:
            user_changed = False

        if user_changed:
            if candidate is None:
                raise WorkspacePathNotFoundError(
                    f"Workspace path {relative_path!r} was deleted"
                )
            source_token = self._path_token(candidate, head_oid=current_head)
            return self.journal.put_workspace_overlay_entry(
                snapshot_id=snapshot.snapshot_id,
                relative_path=relative_path,
                source_kind="user_overlay",
                entry_state="read_only",
                source_token=source_token,
                project_blob_oid=project_blob,
                size_bytes=int(source_token["size"]),
            )
        if project_blob is not None:
            size = self.git.object_size(root, project_blob)
            return self.journal.put_workspace_overlay_entry(
                snapshot_id=snapshot.snapshot_id,
                relative_path=relative_path,
                source_kind="project_blob",
                entry_state="read_only",
                source_token={"blob_oid": project_blob, "size": size},
                project_blob_oid=project_blob,
                size_bytes=size,
            )
        if candidate is not None:
            source_token = self._path_token(candidate, head_oid=current_head)
            return self.journal.put_workspace_overlay_entry(
                snapshot_id=snapshot.snapshot_id,
                relative_path=relative_path,
                source_kind="user_overlay",
                entry_state="read_only",
                source_token=source_token,
                project_blob_oid=None,
                size_bytes=int(source_token["size"]),
            )
        raise WorkspacePathNotFoundError(
            f"Workspace path {relative_path!r} does not exist"
        )

    def _read_entry(
        self,
        snapshot: WorkspaceReadSnapshotRecord,
        entry: WorkspaceOverlayEntryRecord,
        *,
        start_offset: int,
        max_bytes: int,
    ) -> bytes:
        repository = self.journal.get_git_repository(snapshot.repository_id)
        if repository is None:
            raise WorkspaceSnapshotUnavailableError(
                "Snapshot Content Repository is unavailable"
            )
        root = Path(repository.root_path).expanduser().resolve()
        if entry.source_kind == "project_blob":
            if entry.project_blob_oid is None:
                raise WorkspaceSnapshotUnavailableError(
                    "Project snapshot entry has no blob"
                )
            return self.git.read_blob_range(
                root,
                entry.project_blob_oid,
                start_offset=start_offset,
                max_bytes=max_bytes,
            )
        if entry.source_kind != "user_overlay":
            raise WorkspaceSnapshotUnavailableError(
                f"Unsupported snapshot source {entry.source_kind!r}"
            )
        candidate = self._safe_user_path(root, entry.relative_path)
        if candidate is None:
            raise WorkspaceSourceChangedError(
                f"User source {entry.relative_path!r} is no longer available"
            )
        before = self._path_token(
            candidate,
            head_oid=entry.source_token.get("head_oid"),
        )
        if before != entry.source_token:
            raise WorkspaceSourceChangedError(
                f"User source {entry.relative_path!r} changed after pin"
            )
        with candidate.open("rb", buffering=0) as stream:
            opened_before = self._stat_token(
                os.fstat(stream.fileno()),
                head_oid=entry.source_token.get("head_oid"),
            )
            if opened_before != entry.source_token:
                raise WorkspaceSourceChangedError(
                    f"User source {entry.relative_path!r} changed before read"
                )
            stream.seek(start_offset)
            content = stream.read(max_bytes)
            opened_after = self._stat_token(
                os.fstat(stream.fileno()),
                head_oid=entry.source_token.get("head_oid"),
            )
        if opened_after != opened_before:
            raise WorkspaceSourceChangedError(
                f"User source {entry.relative_path!r} changed during read"
            )
        return content

    def _read_cache(self, cache_key: str) -> bytes | None:
        if not re.fullmatch(r"[0-9a-f]{64}", cache_key):
            raise WorkspaceSnapshotUnavailableError(
                "Snapshot cache key is invalid"
            )
        path = self.cache_root / cache_key[:2] / cache_key
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            return None
        if hashlib.sha256(data).hexdigest() != cache_key:
            return None
        return data

    def _write_cache(self, content_digest: str, content: bytes) -> str:
        target = self.cache_root / content_digest[:2] / content_digest
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            existing = target.read_bytes()
            if hashlib.sha256(existing).hexdigest() == content_digest:
                return content_digest
            raise WorkspaceSnapshotUnavailableError(
                "Snapshot cache digest collision"
            )
        temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_bytes(content)
            temporary.chmod(0o600)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        return content_digest

    @staticmethod
    def _digest_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb", buffering=0) as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _copy_file(source: Path, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(
            f".{destination.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with (
                source.open("rb", buffering=0) as reader,
                temporary.open("wb", buffering=0) as writer,
            ):
                while chunk := reader.read(1024 * 1024):
                    writer.write(chunk)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def _blob_at(
        self,
        root: Path,
        commit_oid: str | None,
        relative_path: str,
    ) -> str | None:
        if commit_oid is None:
            return None
        try:
            return self.git.blob_oid_at_path(root, commit_oid, relative_path)
        except GitBackendError as exc:
            raise WorkspaceSnapshotUnavailableError(
                "Pinned Git snapshot is unavailable"
            ) from exc

    @staticmethod
    def _safe_user_path(root: Path, relative_path: str) -> Path | None:
        candidate = root / relative_path
        try:
            if candidate.is_symlink():
                return None
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(root)
            mode = resolved.stat().st_mode
        except (FileNotFoundError, OSError, ValueError):
            return None
        return resolved if stat.S_ISREG(mode) else None

    @staticmethod
    def _safe_destination(root: Path, relative_path: str) -> Path:
        destination = root / relative_path
        current = root
        for part in PurePosixPath(relative_path).parts[:-1]:
            current = current / part
            if current.is_symlink():
                raise WorkspaceSnapshotUnavailableError(
                    "Overlay destination contains a symlink"
                )
        if destination.is_symlink():
            raise WorkspaceSnapshotUnavailableError(
                "Overlay destination is a symlink"
            )
        try:
            destination.parent.resolve().relative_to(root)
        except ValueError as exc:
            raise WorkspaceSnapshotUnavailableError(
                "Overlay destination escapes the Run worktree"
            ) from exc
        return destination

    @classmethod
    def _path_token(
        cls,
        path: Path,
        *,
        head_oid: str | None,
    ) -> dict[str, Any]:
        return cls._stat_token(path.stat(), head_oid=head_oid)

    @staticmethod
    def _stat_token(
        value: os.stat_result,
        *,
        head_oid: str | None,
    ) -> dict[str, Any]:
        return {
            "device": value.st_dev,
            "inode": value.st_ino,
            "mode": value.st_mode,
            "size": value.st_size,
            "mtime_ns": value.st_mtime_ns,
            "head_oid": head_oid,
        }

    @staticmethod
    def _normalize_path(value: str) -> str:
        path = PurePosixPath(value)
        if (
            not value
            or path.is_absolute()
            or ".." in path.parts
            or value.startswith(("~/", "\\\\"))
            or (len(value) > 1 and value[1] == ":")
        ):
            raise ValueError("workspace path must stay inside the Space")
        normalized = path.as_posix()
        if normalized in {"", "."}:
            raise ValueError("workspace path must name a file")
        return normalized
