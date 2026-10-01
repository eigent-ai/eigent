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

"""Local immutable directory revisions; no Git or application initialization.

Objects are verified on every read. This module deliberately does not collect
objects: durable reference ownership belongs to the RunJournal adapter.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import tempfile
import unicodedata
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Literal


class WorkspaceContentError(RuntimeError):
    """An immutable object or manifest cannot be safely used."""


class ContentIntegrityError(WorkspaceContentError):
    pass


class InvalidWorkspacePath(WorkspaceContentError):
    pass


def content_digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def require_digest(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ContentIntegrityError("expected a SHA-256 content identifier")
    return value


def is_git_metadata_name(value: str) -> bool:
    """Treat Git metadata aliases consistently on case-insensitive volumes."""
    return unicodedata.normalize("NFC", value).casefold() == ".git"


def relative_path(value: str) -> str:
    """Accept one canonical, portable, relative path without normalization."""
    if (
        not isinstance(value, str)
        or not value
        or "\\" in value
        or "\0" in value
        or ":" in value
        or value.startswith("/")
        or any(
            part in {"", ".", ".."} or is_git_metadata_name(part)
            for part in value.split("/")
        )
        or str(PurePosixPath(value)) != value
    ):
        raise InvalidWorkspacePath("invalid relative workspace path")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@dataclass(frozen=True)
class ManifestEntry:
    path: str
    kind: Literal["file", "directory", "tombstone"]
    digest: str | None = None
    size: int = 0
    mode: int = 0

    def __post_init__(self) -> None:
        relative_path(self.path)
        if self.kind not in {"file", "directory", "tombstone"}:
            raise ContentIntegrityError("unsupported manifest entry type")
        if type(self.size) is not int or self.size < 0:
            raise ContentIntegrityError("invalid manifest size")
        if type(self.mode) is not int or not 0 <= self.mode <= 0o777:
            raise ContentIntegrityError("invalid manifest mode")
        if self.kind == "file":
            require_digest(self.digest)  # type: ignore[arg-type]
        elif self.digest is not None or self.size != 0:
            raise ContentIntegrityError("non-file entry cannot contain bytes")
        if self.kind == "tombstone" and self.mode != 0:
            raise ContentIntegrityError("tombstone cannot have permissions")


@dataclass(frozen=True)
class WorkspaceManifest:
    entries: tuple[ManifestEntry, ...]
    parent_revision: str | None = None
    source_revision: str | None = None
    lineage: tuple[str, ...] = ()
    coverage: tuple[str, ...] = ()
    mutation_receipts: tuple[str, ...] = ()
    source_fence: Mapping[str, Any] = field(default_factory=dict)
    schema_version: int = 1

    def __post_init__(self) -> None:
        if type(self.schema_version) is not int or self.schema_version != 1:
            raise ContentIntegrityError("unsupported manifest schema")
        for revision in (
            self.parent_revision,
            self.source_revision,
            *self.lineage,
        ):
            if revision is not None:
                require_digest(revision)
        paths: dict[str, ManifestEntry] = {}
        folded: set[str] = set()
        for entry in self.entries:
            if not isinstance(entry, ManifestEntry):
                raise ContentIntegrityError("invalid manifest entry")
            name = unicodedata.normalize("NFC", entry.path).casefold()
            if entry.path in paths or name in folded:
                raise ContentIntegrityError("duplicate or ambiguous path")
            paths[entry.path] = entry
            folded.add(name)
        for entry in self.entries:
            if entry.kind == "tombstone":
                continue
            for parent in PurePosixPath(entry.path).parents:
                if str(parent) == ".":
                    continue
                ancestor = paths.get(str(parent))
                if ancestor is None or ancestor.kind != "directory":
                    raise ContentIntegrityError(
                        "manifest parent is not a directory"
                    )
        if any(
            not isinstance(path, str) or not path for path in self.coverage
        ):
            raise ContentIntegrityError("invalid coverage exclusions")
        if any(
            not isinstance(receipt, str) or not receipt
            for receipt in self.mutation_receipts
        ):
            raise ContentIntegrityError("invalid mutation receipt reference")

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "entries": [
                asdict(entry)
                for entry in sorted(self.entries, key=lambda entry: entry.path)
            ],
            "parent_revision": self.parent_revision,
            "source_revision": self.source_revision,
            "lineage": list(self.lineage),
            "coverage": sorted(set(self.coverage)),
            "mutation_receipts": list(self.mutation_receipts),
            "source_fence": dict(self.source_fence),
        }


class ContentStore:
    """Hash-addressed objects and canonical manifests in trusted local storage."""

    def __init__(
        self, root: Path, *, max_object_bytes: int = 64 * 1024 * 1024
    ):
        if type(max_object_bytes) is not int or max_object_bytes < 1:
            raise ValueError("max_object_bytes must be positive")
        root = Path(root).expanduser()
        if root.is_symlink():
            raise InvalidWorkspacePath("content root cannot be a symlink")
        root.mkdir(parents=True, exist_ok=True)
        self.root = root.resolve(strict=True)
        self.max_object_bytes = max_object_bytes

    def _path(
        self, category: str, digest: str, *, create: bool = False
    ) -> Path:
        require_digest(digest)
        parent = self.root
        for part in (category, digest[:2]):
            parent = parent / part
            if parent.is_symlink():
                raise ContentIntegrityError(
                    "content storage contains a symlink"
                )
            if create:
                try:
                    parent.mkdir()
                except FileExistsError:
                    pass
                else:
                    sync_directory(parent.parent)
        return parent / digest

    def _read(self, category: str, digest: str) -> bytes:
        path = self._path(category, digest)
        if path.is_symlink():
            raise ContentIntegrityError("content object cannot be a symlink")
        try:
            descriptor = os.open(
                path,
                os.O_RDONLY
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_NONBLOCK", 0),
            )
            with os.fdopen(descriptor, "rb") as reader:
                observed = os.fstat(reader.fileno())
                if not stat.S_ISREG(observed.st_mode):
                    raise ContentIntegrityError(
                        "content object is not a regular file"
                    )
                if observed.st_size > self.max_object_bytes:
                    raise ContentIntegrityError(
                        "content object exceeds read limit"
                    )
                value = reader.read(self.max_object_bytes + 1)
        except OSError as exc:
            raise ContentIntegrityError(
                "content object is unavailable"
            ) from exc
        if (
            len(value) > self.max_object_bytes
            or content_digest(value) != digest
        ):
            raise ContentIntegrityError("content object digest mismatch")
        return value

    def _put(self, category: str, value: bytes) -> str:
        if len(value) > self.max_object_bytes:
            raise WorkspaceContentError("content object exceeds size limit")
        digest = content_digest(value)
        temporary: str | None = None
        try:
            destination = self._path(category, digest, create=True)
            if destination.exists() or destination.is_symlink():
                self._read(category, digest)
                return digest
            descriptor, temporary = tempfile.mkstemp(
                prefix=".object-", dir=destination.parent
            )
            with os.fdopen(descriptor, "wb") as writer:
                writer.write(value)
                writer.flush()
                os.fchmod(writer.fileno(), 0o444)
                os.fsync(writer.fileno())
            os.replace(temporary, destination)
            temporary = None
            sync_directory(destination.parent)
        except OSError as exc:
            raise WorkspaceContentError(
                "failed to persist immutable content"
            ) from exc
        finally:
            if temporary is not None:
                Path(temporary).unlink(missing_ok=True)
        return digest

    def put_blob(self, value: bytes) -> str:
        if not isinstance(value, bytes):
            raise TypeError("content must be bytes")
        return self._put("objects", value)

    def read_blob(
        self, digest: str, *, offset: int = 0, length: int | None = None
    ) -> bytes:
        if offset < 0 or (length is not None and length < 0):
            raise ValueError("invalid content byte range")
        value = self._read("objects", digest)
        return (
            value[offset:]
            if length is None
            else value[offset : offset + length]
        )

    def put_manifest(self, manifest: WorkspaceManifest) -> str:
        for entry in manifest.entries:
            if entry.kind == "file":
                value = self.read_blob(entry.digest)  # type: ignore[arg-type]
                if len(value) != entry.size:
                    raise ContentIntegrityError(
                        "manifest object size mismatch"
                    )
        return self._put("manifests", canonical_json(manifest.to_dict()))

    def get_manifest(self, revision: str) -> WorkspaceManifest:
        try:
            value = json.loads(self._read("manifests", revision))
            expected = {
                "schema_version",
                "entries",
                "parent_revision",
                "source_revision",
                "lineage",
                "coverage",
                "source_fence",
                "mutation_receipts",
            }
            if not isinstance(value, dict) or set(value) != expected:
                raise ContentIntegrityError("invalid manifest fields")
            manifest = WorkspaceManifest(
                entries=tuple(
                    ManifestEntry(**entry) for entry in value["entries"]
                ),
                parent_revision=value["parent_revision"],
                source_revision=value["source_revision"],
                lineage=tuple(value["lineage"]),
                coverage=tuple(value["coverage"]),
                mutation_receipts=tuple(value["mutation_receipts"]),
                source_fence=value["source_fence"],
                schema_version=value["schema_version"],
            )
            if content_digest(canonical_json(manifest.to_dict())) != revision:
                raise ContentIntegrityError("manifest is not canonical")
            return manifest
        except (TypeError, ValueError, KeyError) as exc:
            raise ContentIntegrityError("invalid manifest content") from exc

    def references(self, revision: str) -> dict[str, tuple[str, ...]]:
        """Return transitive immutable refs for a durable retention adapter."""
        pending, manifests, objects = [require_digest(revision)], set(), set()
        while pending:
            current = pending.pop()
            if current in manifests:
                continue
            if len(manifests) >= 10000:
                raise ContentIntegrityError("manifest lineage exceeds limit")
            manifest = self.get_manifest(current)
            manifests.add(current)
            for entry in manifest.entries:
                if entry.kind == "file":
                    self.read_blob(entry.digest)  # type: ignore[arg-type]
                    objects.add(entry.digest)
            pending.extend(
                value
                for value in (
                    manifest.parent_revision,
                    manifest.source_revision,
                    *manifest.lineage,
                )
                if value is not None
            )
        return {
            "manifests": tuple(sorted(manifests)),
            "objects": tuple(sorted(objects)),
        }
