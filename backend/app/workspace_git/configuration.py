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

"""Configuration Repository placement and durable bootstrap service."""

from __future__ import annotations

import os
import re
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from app.run_journal import (
    IdempotencyConflictError,
    SQLiteRunJournal,
    WorkspaceConfigMaterializationRecord,
    WorkspaceConfigRevisionRecord,
)
from app.workspace_config import (
    ConfigPlacement,
    WorkforceBundleManifest,
    WorkspaceLock,
    assert_manifest_secret_free,
    canonical_digest,
)
from app.workspace_git.backend import (
    GitBackend,
    NestedRepositoryError,
)

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback
    fcntl = None


class ConfigurationRepositoryError(RuntimeError):
    """Base error for configuration repository materialization."""


@dataclass(frozen=True)
class ConfigurationRepositoryResult:
    space_id: str
    placement: ConfigPlacement
    content_repository_root: Path | None
    configuration_repository_root: Path
    manifest_path: Path
    lock_path: Path
    commit_oid: str
    content_repository_initialized: bool
    configuration_repository_initialized: bool
    revision: WorkspaceConfigRevisionRecord
    materialization: WorkspaceConfigMaterializationRecord


class ConfigurationRepositoryService:
    """Materialize Bundle files without scanning or committing Space content."""

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        state_root: Path,
        git_backend: GitBackend | None = None,
    ) -> None:
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.git = git_backend or GitBackend()
        self._lock = threading.RLock()

    def bootstrap(
        self,
        *,
        space_id: str,
        space_root: Path,
        manifest: WorkforceBundleManifest,
        placement: ConfigPlacement,
        created_by: str,
        lock_payload: dict[str, Any] | None = None,
        allow_content_repository_init: bool = False,
    ) -> ConfigurationRepositoryResult:
        safe_space_id = self._validate_space_id(space_id)
        root = space_root.expanduser().resolve()
        if not root.is_dir():
            raise ConfigurationRepositoryError(
                f"Space root is not a directory: {space_root}"
            )
        existing = self.journal.get_workspace_config_revision(
            manifest.revision_id
        )
        if existing is not None and (
            existing.bundle_id != manifest.metadata.id
            or existing.revision_number != manifest.metadata.revision
            or existing.manifest_digest != manifest.digest
        ):
            raise IdempotencyConflictError(
                f"Bundle revision {manifest.revision_id!r} conflicts with "
                "its previously persisted materialization"
            )
        materialization_id = "configmat_" + canonical_digest(
            {
                "space_id": space_id,
                "revision_id": manifest.revision_id,
                "local_override_digest": "",
            }
        )
        existing_materialization = (
            self.journal.get_workspace_config_materialization(
                materialization_id
            )
        )
        if existing_materialization is not None and (
            existing_materialization.space_id != space_id
            or existing_materialization.revision_id != manifest.revision_id
            or existing_materialization.config_placement != placement.value
            or existing_materialization.local_override_digest != ""
        ):
            raise IdempotencyConflictError(
                f"Space {space_id!r} already materialized Bundle revision "
                f"{manifest.revision_id!r} with a different placement"
            )

        lock = (
            lock_payload
            if lock_payload is not None
            else self._default_lock(manifest)
        )
        assert_manifest_secret_free(lock)
        try:
            resolved_lock = WorkspaceLock.model_validate(lock)
        except ValidationError as exc:
            raise ConfigurationRepositoryError(
                "workspace.lock does not match the portable lock schema"
            ) from exc
        if (
            resolved_lock.bundle_revision != manifest.revision_id
            or resolved_lock.manifest_digest != manifest.digest
        ):
            raise ConfigurationRepositoryError(
                "workspace.lock does not match the selected Bundle revision"
            )
        lock = resolved_lock.canonical_payload()

        lock_path = (
            self.state_root
            / "git-operation-locks"
            / f"configuration-{safe_space_id}.lock"
        )
        with self._repository_lock(lock_path):
            before_content = self.git.probe(root)
            content_repository_root = (
                root
                if before_content.is_repository
                and before_content.owns_requested_root
                else None
            )
            content_initialized = False
            configuration_initialized = False
            if placement is ConfigPlacement.IN_REPO:
                if before_content.nested_in_parent:
                    raise NestedRepositoryError(
                        f"Space root is inside parent repository "
                        f"{before_content.repository_root}"
                    )
                if not before_content.is_repository:
                    if not allow_content_repository_init:
                        raise ConfigurationRepositoryError(
                            "in_repo placement requires an owned/adopted "
                            "Content Repository"
                        )
                    self.git.init_repository(root)
                    content_initialized = True
                    content_repository_root = root
                repository_root = root
                configuration_root = root / ".eigent"
            else:
                repository_root = (
                    self.state_root
                    / "spaces"
                    / safe_space_id
                    / "configuration"
                )
                before_configuration = (
                    self.git.probe(repository_root)
                    if repository_root.exists()
                    else None
                )
                self.git.init_repository(repository_root)
                configuration_initialized = not (
                    before_configuration
                    and before_configuration.is_repository
                    and before_configuration.owns_requested_root
                )
                configuration_root = repository_root

            manifest_path = configuration_root / "workspace.yaml"
            workspace_lock_path = configuration_root / "workspace.lock"
            desired_files = {
                manifest_path: manifest.canonical_payload(),
                workspace_lock_path: lock,
            }
            path_status = self.git.path_status(
                repository_root,
                tuple(desired_files),
            )
            if path_status and not self._recoverable_untracked_files(
                repository_root,
                desired_files,
                path_status,
            ):
                raise ConfigurationRepositoryError(
                    "configuration repository has uncommitted manifest/lock "
                    "changes; bootstrap will not stage or overwrite them"
                )
            self._write_new_or_equal_yaml(
                manifest_path,
                manifest.canonical_payload(),
            )
            self._write_new_or_equal_yaml(
                workspace_lock_path,
                lock,
            )
            commit_oid = self.git.commit_paths(
                repository_root,
                (manifest_path, workspace_lock_path),
                message=(
                    f"chore(eigent): configure {manifest.metadata.name} "
                    f"v{manifest.metadata.revision}"
                ),
            )
            revision = self.journal.put_workspace_config_revision(
                revision_id=manifest.revision_id,
                bundle_id=manifest.metadata.id,
                revision_number=manifest.metadata.revision,
                manifest=manifest.canonical_payload(),
                status="validated",
                created_by=created_by,
            )
            materialization = (
                self.journal.put_workspace_config_materialization(
                    materialization_id=materialization_id,
                    space_id=space_id,
                    revision_id=manifest.revision_id,
                    config_placement=placement.value,
                )
            )
            return ConfigurationRepositoryResult(
                space_id=space_id,
                placement=placement,
                content_repository_root=content_repository_root,
                configuration_repository_root=configuration_root,
                manifest_path=manifest_path,
                lock_path=workspace_lock_path,
                commit_oid=commit_oid,
                content_repository_initialized=content_initialized,
                configuration_repository_initialized=(
                    configuration_initialized
                ),
                revision=revision,
                materialization=materialization,
            )

    @staticmethod
    def _default_lock(
        manifest: WorkforceBundleManifest,
    ) -> dict[str, Any]:
        return {
            "apiVersion": "eigent.ai/lock/v1alpha1",
            "bundleRevision": manifest.revision_id,
            "manifestDigest": manifest.digest,
            "assets": [],
            "skills": [],
            "mcpPackages": [],
        }

    @staticmethod
    def _validate_space_id(space_id: str) -> str:
        if not space_id.strip():
            raise ValueError("space_id is required")
        sanitized = re.sub(r"[^A-Za-z0-9._-]", "_", space_id)
        if sanitized != space_id or sanitized in {".", ".."}:
            raise ValueError("space_id contains unsafe path characters")
        return sanitized

    @staticmethod
    def _atomic_write_text(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("w", encoding="utf-8") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            try:
                directory_fd = os.open(path.parent, os.O_RDONLY)
            except OSError:
                return
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if temporary.exists():
                temporary.unlink()

    @classmethod
    def _write_new_or_equal_yaml(
        cls,
        path: Path,
        payload: dict[str, Any],
    ) -> None:
        if path.exists():
            try:
                existing = yaml.safe_load(path.read_text(encoding="utf-8"))
            except (OSError, yaml.YAMLError) as exc:
                raise ConfigurationRepositoryError(
                    f"existing configuration file is unreadable: {path}"
                ) from exc
            if existing == payload:
                return
            raise ConfigurationRepositoryError(
                f"refusing to overwrite existing configuration file: {path}"
            )
        cls._atomic_write_text(
            path,
            yaml.safe_dump(
                payload,
                allow_unicode=True,
                sort_keys=False,
            ),
        )

    def _recoverable_untracked_files(
        self,
        repository_root: Path,
        desired_files: dict[Path, dict[str, Any]],
        path_status: dict[str, str],
    ) -> bool:
        root = repository_root.expanduser().resolve()
        for path, payload in desired_files.items():
            relative = path.expanduser().resolve().relative_to(root).as_posix()
            status = path_status.get(relative)
            if status is None:
                continue
            if status != "??" or self.git.is_tracked(repository_root, path):
                return False
            if not self._yaml_matches(path, payload):
                return False
        return True

    @staticmethod
    def _yaml_matches(path: Path, payload: dict[str, Any]) -> bool:
        if not path.is_file():
            return False
        try:
            return yaml.safe_load(path.read_text(encoding="utf-8")) == payload
        except (OSError, yaml.YAMLError):
            return False

    @contextmanager
    def _repository_lock(self, path: Path) -> Iterator[None]:
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            with path.open("a+", encoding="utf-8") as handle:
                if fcntl is not None:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                except (OSError, yaml.YAMLError) as exc:
                    raise ConfigurationRepositoryError(str(exc)) from exc
                finally:
                    if fcntl is not None:
                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
