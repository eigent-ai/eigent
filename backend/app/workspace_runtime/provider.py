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

"""Gitless snapshot/prepare/checkpoint provider with explicit journal fences.

The caller owns authorization, process settlement, fencing transactions and
durable retention. No application singleton, environment loader or Git import
is used here. External writers receive change detection, not OS strong CAS.
"""

from __future__ import annotations

import os
import shutil
import stat
import tempfile
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from .content import (
    ContentIntegrityError,
    ContentStore,
    InvalidWorkspacePath,
    ManifestEntry,
    WorkspaceContentError,
    WorkspaceManifest,
    canonical_json,
    content_digest,
    is_git_metadata_name,
    relative_path,
    sync_directory,
)


class SourceChangedError(WorkspaceContentError):
    code = "source_changed"


class SourceWaitingForSettlementError(WorkspaceContentError):
    code = "source_waiting_for_settlement"


class WorkspaceLimitError(WorkspaceContentError):
    code = "workspace_limit_exceeded"


class WorkspaceOwnerError(WorkspaceContentError):
    code = "workspace_owner_changed"


class RetentionUnavailableError(WorkspaceContentError):
    pass


@dataclass(frozen=True)
class SourceFence:
    physical_target_id: str
    physical_identity: str
    write_epoch: int
    settled_revision: str | None
    integration_receipt_cursor: int = 0
    state: str = "settled"
    owner: str | None = None
    binding_version: int = 0

    def require_settled(self) -> None:
        if (
            self.state != "settled"
            or self.owner is not None
            or not isinstance(self.physical_target_id, str)
            or not self.physical_target_id
            or not isinstance(self.physical_identity, str)
            or not self.physical_identity
            or type(self.write_epoch) is not int
            or self.write_epoch < 0
            or type(self.integration_receipt_cursor) is not int
            or self.integration_receipt_cursor < 0
            or type(self.binding_version) is not int
            or self.binding_version < 0
        ):
            raise SourceWaitingForSettlementError(
                "source is not safely settled"
            )


@dataclass(frozen=True)
class CaptureLimits:
    max_files: int = 10000
    max_entries: int = 20000
    max_file_bytes: int = 32 * 1024 * 1024
    max_total_bytes: int = 256 * 1024 * 1024
    max_depth: int = 64

    def __post_init__(self) -> None:
        if any(
            type(value) is not int or value < 1
            for value in asdict(self).values()
        ):
            raise ValueError("capture limits must be positive integers")


@dataclass(frozen=True)
class SnapshotRef:
    revision_id: str
    owner: str
    fence: SourceFence
    provider: str = "directory"


@dataclass(frozen=True)
class WorkspaceHandle:
    workspace_id: str
    local_root: Path
    owner: str
    generation: int
    input_revision: str
    provider: str = "directory"


@dataclass(frozen=True)
class PreparationIdentity:
    """In-process cleanup authority; never reconstruct it from an old marker."""

    root_identity: tuple[int, int]
    marker_token: tuple[int, ...]
    metadata: tuple[tuple[str, tuple[int, ...], str], ...] = ()


@dataclass(frozen=True)
class WorkspaceRevision:
    revision_id: str
    workspace_id: str
    owner: str
    generation: int
    input_revision: str
    changed_paths: tuple[str, ...]
    provider: str = "directory"


class RetentionBackend(Protocol):
    def retain(self, revision: str, owner: str) -> None: ...
    def release(self, revision: str, owner: str) -> None: ...


def _revision_id(value: str | SnapshotRef | WorkspaceRevision) -> str:
    return value if isinstance(value, str) else value.revision_id


def _stat_token(value: os.stat_result) -> tuple[int, ...]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


class DirectoryWorkspaceProvider:
    def __init__(
        self,
        store: ContentStore,
        workspace_root: Path,
        *,
        limits: CaptureLimits | None = None,
        retention: RetentionBackend | None = None,
        exclude_path: Callable[[str, bool], bool] | None = None,
    ) -> None:
        workspace_root = Path(workspace_root).expanduser()
        if workspace_root.is_symlink():
            raise InvalidWorkspacePath("workspace storage cannot be a symlink")
        workspace_root.mkdir(parents=True, exist_ok=True)
        self.workspace_root = workspace_root.resolve(strict=True)
        self.store = store
        self.limits = limits or CaptureLimits()
        self.retention = retention
        self.exclude_path = exclude_path

    @staticmethod
    def _checked_fence(read_fence: Callable[[], SourceFence]) -> SourceFence:
        fence = read_fence()
        if not isinstance(fence, SourceFence):
            raise TypeError("read_fence must return SourceFence")
        fence.require_settled()
        return fence

    def capture_source(
        self,
        source_root: Path,
        *,
        owner: str,
        read_fence: Callable[[], SourceFence],
        expected_fence: SourceFence | None = None,
        commit_capture: Callable[[SnapshotRef, SourceFence], None]
        | None = None,
    ) -> SnapshotRef:
        """Capture a candidate; commit_capture atomically rechecks and retains it.

        Without commit_capture, the returned immutable candidate is not a
        durable ready binding. A rejected callback leaves only unreferenced
        immutable objects and does not return a SnapshotRef to the caller.
        """
        if not owner:
            raise WorkspaceOwnerError("snapshot owner is required")
        before = self._checked_fence(read_fence)
        if expected_fence is not None and before != expected_fence:
            raise SourceChangedError(
                "source fence differs from expected boundary"
            )
        root = self._source_root(source_root)
        identity = root.stat()
        physical_identity = content_digest(
            canonical_json([identity.st_dev, identity.st_ino])
        )
        if physical_identity != before.physical_identity:
            raise SourceChangedError(
                "source root does not match physical fence"
            )
        if self.store.root.is_relative_to(
            root
        ) or self.workspace_root.is_relative_to(root):
            raise InvalidWorkspacePath(
                "source cannot contain provider storage"
            )
        entries, tokens, coverage = self._scan(root, save_objects=True)
        verified, verified_tokens, verified_coverage = self._scan(
            root, save_objects=False
        )
        if (entries, tokens, coverage) != (
            verified,
            verified_tokens,
            verified_coverage,
        ):
            raise SourceChangedError("source changed during capture")
        if (
            content_digest(canonical_json(tokens[""][:2]))
            != before.physical_identity
        ):
            raise SourceChangedError(
                "source root changed after physical fence"
            )
        if self._checked_fence(read_fence) != before:
            raise SourceChangedError("source epoch or settled lineage changed")
        revision = self.store.put_manifest(
            WorkspaceManifest(
                entries=entries,
                coverage=coverage,
                source_fence=asdict(before),
            )
        )
        snapshot = SnapshotRef(revision, owner, before)
        if self._checked_fence(read_fence) != before:
            raise SourceChangedError("source changed before capture handoff")
        if commit_capture is not None:
            commit_capture(snapshot, before)
        return snapshot

    @staticmethod
    def _source_root(path: Path) -> Path:
        path = Path(path).expanduser()
        if path.is_symlink():
            raise InvalidWorkspacePath("source root cannot be a symlink")
        root = path.resolve(strict=True)
        if not root.is_dir():
            raise InvalidWorkspacePath("source root must be a directory")
        return root

    def _scan(
        self,
        root: Path,
        *,
        save_objects: bool,
    ) -> tuple[
        tuple[ManifestEntry, ...], dict[str, tuple[int, ...]], tuple[str, ...]
    ]:
        if (
            not hasattr(os, "O_NOFOLLOW")
            or not hasattr(os, "O_DIRECTORY")
            or not hasattr(os, "O_NONBLOCK")
            or os.open not in os.supports_dir_fd
            or os.scandir not in os.supports_fd
        ):
            raise WorkspaceContentError(
                "platform lacks safe directory-relative capture"
            )
        entries: list[ManifestEntry] = []
        tokens: dict[str, tuple[int, ...]] = {}
        excluded: list[str] = []
        counts = {"files": 0, "entries": 0, "bytes": 0}
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

        def walk(descriptor: int, prefix: str) -> None:
            before = os.fstat(descriptor)
            tokens[prefix] = _stat_token(before)
            if prefix and len(prefix.split("/")) > self.limits.max_depth:
                raise WorkspaceLimitError(
                    "source directory depth exceeds limit"
                )
            names = []
            with os.scandir(descriptor) as children:
                for child in children:
                    counts["entries"] += 1
                    if counts["entries"] > self.limits.max_entries:
                        raise WorkspaceLimitError(
                            "source entry count exceeds limit"
                        )
                    names.append(child.name)
            for name in sorted(names):
                path = f"{prefix}/{name}" if prefix else name
                observed = os.stat(
                    name, dir_fd=descriptor, follow_symlinks=False
                )
                is_directory = stat.S_ISDIR(observed.st_mode)
                if is_git_metadata_name(name) or (
                    self.exclude_path and self.exclude_path(path, is_directory)
                ):
                    excluded.append(path)
                    continue
                relative_path(path)
                if stat.S_ISLNK(observed.st_mode):
                    raise InvalidWorkspacePath("source contains a symlink")
                if is_directory:
                    child = os.open(name, directory_flags, dir_fd=descriptor)
                    try:
                        if _stat_token(os.fstat(child)) != _stat_token(
                            observed
                        ):
                            raise SourceChangedError(
                                "source directory changed before open"
                            )
                        entries.append(
                            ManifestEntry(
                                path,
                                "directory",
                                mode=stat.S_IMODE(observed.st_mode) & 0o777,
                            )
                        )
                        walk(child, path)
                    finally:
                        os.close(child)
                    continue
                if not stat.S_ISREG(observed.st_mode):
                    raise InvalidWorkspacePath(
                        "source contains an unsupported file type"
                    )
                counts["files"] += 1
                if counts["files"] > self.limits.max_files:
                    raise WorkspaceLimitError(
                        "source file count exceeds limit"
                    )
                if observed.st_size > self.limits.max_file_bytes:
                    raise WorkspaceLimitError("source file exceeds size limit")
                counts["bytes"] += observed.st_size
                if counts["bytes"] > self.limits.max_total_bytes:
                    raise WorkspaceLimitError(
                        "source total size exceeds limit"
                    )
                child = os.open(
                    name,
                    os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                    dir_fd=descriptor,
                )
                with os.fdopen(child, "rb") as reader:
                    opened = os.fstat(reader.fileno())
                    if not stat.S_ISREG(opened.st_mode) or _stat_token(
                        opened
                    ) != _stat_token(observed):
                        raise SourceChangedError(
                            "source file changed before open"
                        )
                    value = reader.read(self.limits.max_file_bytes + 1)
                    if _stat_token(os.fstat(reader.fileno())) != _stat_token(
                        observed
                    ):
                        raise SourceChangedError(
                            "source file changed while reading"
                        )
                if len(value) != observed.st_size:
                    raise SourceChangedError(
                        "source file changed size while reading"
                    )
                token = _stat_token(
                    os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                )
                if token != _stat_token(observed):
                    raise SourceChangedError(
                        "source file was replaced during capture"
                    )
                tokens[path] = token
                digest = (
                    self.store.put_blob(value)
                    if save_objects
                    else content_digest(value)
                )
                entries.append(
                    ManifestEntry(
                        path,
                        "file",
                        digest,
                        len(value),
                        stat.S_IMODE(observed.st_mode) & 0o777,
                    )
                )
            if _stat_token(os.fstat(descriptor)) != _stat_token(before):
                raise SourceChangedError(
                    "source directory changed during capture"
                )

        try:
            observed_root = root.lstat()
            descriptor = os.open(root, directory_flags)
            try:
                if _stat_token(os.fstat(descriptor)) != _stat_token(
                    observed_root
                ):
                    raise SourceChangedError(
                        "source root changed before capture"
                    )
                walk(descriptor, "")
                if _stat_token(root.lstat()) != tokens[""]:
                    raise SourceChangedError(
                        "source root changed during capture"
                    )
            finally:
                os.close(descriptor)
        except OSError as exc:
            raise SourceChangedError(
                "source became unavailable during capture"
            ) from exc
        return (
            tuple(sorted(entries, key=lambda entry: entry.path)),
            tokens,
            tuple(sorted(excluded)),
        )

    def prepare(
        self,
        snapshot: SnapshotRef,
        *,
        owner: str,
        generation: int,
        assert_owner: Callable[[str, int], None] | None = None,
    ) -> WorkspaceHandle:
        if (
            not owner
            or owner != snapshot.owner
            or type(generation) is not int
            or generation < 1
        ):
            raise WorkspaceOwnerError("invalid workspace owner/generation")
        if assert_owner is not None:
            assert_owner(owner, generation)
        manifest = self.store.get_manifest(snapshot.revision_id)
        files = [entry for entry in manifest.entries if entry.kind == "file"]
        if (
            len(manifest.entries) > self.limits.max_entries
            or len(files) > self.limits.max_files
            or any(entry.size > self.limits.max_file_bytes for entry in files)
            or sum(entry.size for entry in files) > self.limits.max_total_bytes
            or any(
                len(entry.path.split("/")) > self.limits.max_depth
                for entry in manifest.entries
                if entry.kind == "directory"
            )
        ):
            raise WorkspaceLimitError("snapshot exceeds preparation limits")
        workspace_id = "workspace_" + uuid.uuid4().hex
        final_root = self.workspace_root / workspace_id
        staging = Path(
            tempfile.mkdtemp(prefix=".prepare-", dir=self.workspace_root)
        )
        handle = WorkspaceHandle(
            workspace_id, final_root, owner, generation, snapshot.revision_id
        )
        try:
            for entry in manifest.entries:
                target = staging.joinpath(*entry.path.split("/"))
                if entry.kind == "directory":
                    target.mkdir(parents=True, exist_ok=True)
                elif entry.kind == "file":
                    value = self.store.read_blob(entry.digest)  # type: ignore[arg-type]
                    if len(value) != entry.size:
                        raise ContentIntegrityError(
                            "snapshot object size mismatch"
                        )
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open("xb") as writer:
                        writer.write(value)
                        writer.flush()
                        os.fchmod(writer.fileno(), entry.mode)
                        os.fsync(writer.fileno())
            for entry in sorted(
                manifest.entries,
                key=lambda item: item.path.count("/"),
                reverse=True,
            ):
                if entry.kind == "directory":
                    directory = staging.joinpath(*entry.path.split("/"))
                    descriptor = os.open(directory, os.O_RDONLY)
                    try:
                        os.fchmod(descriptor, entry.mode)
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
            sync_directory(staging)
            if assert_owner is not None:
                assert_owner(owner, generation)
            staging.rename(final_root)
            with self._marker(handle).open("xb") as marker:
                marker.write(self._handle_bytes(handle))
                marker.flush()
                os.fsync(marker.fileno())
            sync_directory(self.workspace_root)
            if assert_owner is not None:
                assert_owner(owner, generation)
            return handle
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            shutil.rmtree(final_root, ignore_errors=True)
            self._marker(handle).unlink(missing_ok=True)
            raise

    def _marker(self, handle: WorkspaceHandle) -> Path:
        if (
            not handle.workspace_id.startswith("workspace_")
            or not handle.workspace_id[10:].isalnum()
        ):
            raise WorkspaceOwnerError("invalid workspace identity")
        return self.workspace_root / (handle.workspace_id + ".json")

    @staticmethod
    def _handle_bytes(handle: WorkspaceHandle) -> bytes:
        return canonical_json(
            {**asdict(handle), "local_root": str(handle.local_root)}
        )

    def _require_handle(self, handle: WorkspaceHandle) -> None:
        expected_root = self.workspace_root / handle.workspace_id
        marker = self._marker(handle)
        if (
            handle.local_root != expected_root
            or expected_root.is_symlink()
            or not expected_root.is_dir()
            or marker.is_symlink()
            or not marker.is_file()
            or marker.read_bytes() != self._handle_bytes(handle)
        ):
            raise WorkspaceOwnerError(
                "workspace handle is not its recorded owner"
            )

    def preparation_identity(
        self, handle: WorkspaceHandle
    ) -> PreparationIdentity:
        """Record only a freshly returned, never-dispatched preparation."""
        self._require_handle(handle)
        root = handle.local_root.stat(follow_symlinks=False)
        marker = self._marker(handle).stat(follow_symlinks=False)
        if marker.st_nlink != 1:
            raise WorkspaceOwnerError("preparation marker is aliased")
        return PreparationIdentity(
            (root.st_dev, root.st_ino), _stat_token(marker)
        )

    def _verify_prepared_cleanup(
        self,
        handle: WorkspaceHandle,
        identity: PreparationIdentity,
        *,
        excluded: tuple[str, ...] = (),
    ):
        self._require_handle(handle)
        root = handle.local_root.stat(follow_symlinks=False)
        if (root.st_dev, root.st_ino) != identity.root_identity or _stat_token(
            self._marker(handle).stat(follow_symlinks=False)
        ) != identity.marker_token:
            raise WorkspaceOwnerError("preparation identity changed")
        scanned = self._scan(handle.local_root, save_objects=False)
        entries, tokens, coverage = scanned
        expected = tuple(
            entry
            for entry in self.store.get_manifest(handle.input_revision).entries
            if entry.kind != "tombstone"
        )
        if (
            entries != expected
            or coverage != excluded
            or scanned != self._scan(handle.local_root, save_objects=False)
        ):
            raise WorkspaceOwnerError("preparation contents changed")
        if any(
            handle.local_root.joinpath(*entry.path.split("/"))
            .stat(follow_symlinks=False)
            .st_nlink
            != 1
            for entry in entries
            if entry.kind == "file"
        ):
            raise WorkspaceOwnerError("preparation file is aliased")
        return entries, tokens

    def discard_prepared_workspace(
        self,
        handle: WorkspaceHandle,
        identity: PreparationIdentity,
        *,
        assert_unadmitted: Callable[[], None],
    ) -> None:
        """Delete only an unchanged, unadmitted private copy on POSIX.

        No recursive sweep removes newly appearing paths. Unexpected files,
        aliases or partial failure preserve the marker and CAS retention for
        recovery. External check/unlink races are not an OS strong CAS.
        """
        assert_unadmitted()
        entries, tokens = self._verify_prepared_cleanup(handle, identity)
        children: dict[str, list[ManifestEntry]] = {}
        for entry in entries:
            parent = entry.path.rpartition("/")[0]
            children.setdefault(parent, []).append(entry)
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        parent = os.open(self.workspace_root, flags)
        root = None
        try:
            root = os.open(handle.workspace_id, flags, dir_fd=parent)
            if _stat_token(os.fstat(root)) != tokens[""]:
                raise WorkspaceOwnerError("preparation root changed")
            assert_unadmitted()

            def remove_children(descriptor: int, relative: str) -> None:
                for entry in children.get(relative, ()):
                    name = entry.path.rsplit("/", 1)[-1]
                    observed = os.stat(
                        name, dir_fd=descriptor, follow_symlinks=False
                    )
                    if _stat_token(observed) != tokens[entry.path]:
                        raise WorkspaceOwnerError("preparation path changed")
                    if entry.kind == "directory":
                        child = os.open(name, flags, dir_fd=descriptor)
                        try:
                            if (
                                _stat_token(os.fstat(child))
                                != tokens[entry.path]
                            ):
                                raise WorkspaceOwnerError("directory changed")
                            remove_children(child, entry.path)
                            current = os.stat(
                                name, dir_fd=descriptor, follow_symlinks=False
                            )
                            if (current.st_dev, current.st_ino) != (
                                observed.st_dev,
                                observed.st_ino,
                            ):
                                raise WorkspaceOwnerError("directory replaced")
                            os.rmdir(name, dir_fd=descriptor)
                        finally:
                            os.close(child)
                    else:
                        if observed.st_nlink != 1:
                            raise WorkspaceOwnerError(
                                "preparation file is aliased"
                            )
                        os.unlink(name, dir_fd=descriptor)

            remove_children(root, "")
            current = os.stat(
                handle.workspace_id, dir_fd=parent, follow_symlinks=False
            )
            if (current.st_dev, current.st_ino) != identity.root_identity:
                raise WorkspaceOwnerError("preparation root replaced")
            os.rmdir(handle.workspace_id, dir_fd=parent)
            marker_name = self._marker(handle).name
            if (
                _stat_token(
                    os.stat(marker_name, dir_fd=parent, follow_symlinks=False)
                )
                != identity.marker_token
            ):
                raise WorkspaceOwnerError("preparation marker changed")
            os.unlink(marker_name, dir_fd=parent)
            os.fsync(parent)
        finally:
            if root is not None:
                os.close(root)
            os.close(parent)

    def checkpoint(
        self,
        handle: WorkspaceHandle,
        *,
        assert_owner: Callable[[WorkspaceHandle], None],
        mutation_receipts: tuple[str, ...] = (),
    ) -> WorkspaceRevision:
        """Call only after writers stop; callback verifies journal generation."""
        self._require_handle(handle)
        assert_owner(handle)
        entries, tokens, coverage = self._scan(
            handle.local_root, save_objects=True
        )
        if (entries, tokens, coverage) != self._scan(
            handle.local_root, save_objects=False
        ):
            raise SourceChangedError("workspace changed during checkpoint")
        parent = self.store.get_manifest(handle.input_revision)
        previous = {
            entry.path: entry
            for entry in parent.entries
            if entry.kind != "tombstone"
        }
        current = {entry.path: entry for entry in entries}
        if any(
            path == excluded or path.startswith(excluded + "/")
            for path in previous
            for excluded in coverage
        ):
            raise WorkspaceContentError(
                "checkpoint policy now excludes captured input"
            )
        changed = tuple(
            sorted(
                path
                for path in previous.keys() | current.keys()
                if previous.get(path) != current.get(path)
            )
        )
        tombstones = tuple(
            ManifestEntry(path, "tombstone")
            for path in previous
            if path not in current
        )
        manifest = WorkspaceManifest(
            entries=tuple(
                sorted((*entries, *tombstones), key=lambda entry: entry.path)
            ),
            parent_revision=handle.input_revision,
            source_revision=handle.input_revision,
            lineage=(handle.input_revision,),
            coverage=tuple(sorted(set((*parent.coverage, *coverage)))),
            source_fence=parent.source_fence,
            mutation_receipts=mutation_receipts,
        )
        revision = self.store.put_manifest(manifest)
        self._require_handle(handle)
        assert_owner(handle)
        return WorkspaceRevision(
            revision,
            handle.workspace_id,
            handle.owner,
            handle.generation,
            handle.input_revision,
            changed,
        )

    def read(
        self,
        revision: str | SnapshotRef | WorkspaceRevision,
        path: str,
        *,
        offset: int = 0,
        length: int | None = None,
    ) -> bytes:
        path = relative_path(path)
        manifest = self.store.get_manifest(_revision_id(revision))
        entry = next(
            (entry for entry in manifest.entries if entry.path == path), None
        )
        if entry is None or entry.kind == "tombstone":
            raise FileNotFoundError(path)
        if entry.kind != "file":
            raise IsADirectoryError(path)
        value = self.store.read_blob(entry.digest)  # type: ignore[arg-type]
        if len(value) != entry.size:
            raise ContentIntegrityError("manifest size differs from content")
        if offset < 0 or (length is not None and length < 0):
            raise ValueError("invalid content byte range")
        return (
            value[offset:]
            if length is None
            else value[offset : offset + length]
        )

    def retain(
        self,
        revision: str | SnapshotRef | WorkspaceRevision,
        reference_owner: str,
    ) -> None:
        if self.retention is None:
            raise RetentionUnavailableError(
                "durable retention backend is required"
            )
        self.store.references(_revision_id(revision))
        self.retention.retain(_revision_id(revision), reference_owner)

    def release(
        self,
        revision: str | SnapshotRef | WorkspaceRevision,
        reference_owner: str,
    ) -> None:
        if self.retention is None:
            raise RetentionUnavailableError(
                "durable retention backend is required"
            )
        self.retention.release(_revision_id(revision), reference_owner)
