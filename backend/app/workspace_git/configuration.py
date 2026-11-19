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
from pathlib import Path, PurePosixPath
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
    WorkspaceBundleManifest,
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
        manifest: WorkspaceBundleManifest,
        placement: ConfigPlacement,
        created_by: str,
        lock_payload: dict[str, Any] | None = None,
        assets: dict[str, bytes] | None = None,
        executable_assets: set[str] | None = None,
        expected_previous_revision_id: str | None = None,
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
            desired_files: dict[Path, dict[str, Any] | bytes] = {
                manifest_path: manifest.canonical_payload(),
                workspace_lock_path: lock,
            }
            executable_paths: set[Path] = set()
            executable_refs = executable_assets or set()
            unknown_executable_refs = executable_refs - set(assets or {})
            if unknown_executable_refs:
                raise ConfigurationRepositoryError(
                    "Executable Bundle asset metadata references a missing asset"
                )
            for logical_path, content in sorted((assets or {}).items()):
                relative = self._validate_asset_path(logical_path)
                target = configuration_root / relative
                try:
                    target.resolve(strict=False).relative_to(
                        configuration_root.resolve()
                    )
                except ValueError as exc:
                    raise ConfigurationRepositoryError(
                        "Bundle asset escapes the configuration repository"
                    ) from exc
                if target in desired_files:
                    raise ConfigurationRepositoryError(
                        "Bundle asset conflicts with a reserved configuration file"
                    )
                desired_files[target] = bytes(content)
                if logical_path in executable_refs:
                    executable_paths.add(target)
            obsolete_asset_paths: set[Path] = set()
            upgrade_mode = False
            if manifest_path.exists() or workspace_lock_path.exists():
                if (
                    not manifest_path.is_file()
                    or not workspace_lock_path.is_file()
                ):
                    raise ConfigurationRepositoryError(
                        "existing Bundle configuration is incomplete"
                    )
                try:
                    current_manifest_payload = yaml.safe_load(
                        manifest_path.read_text(encoding="utf-8")
                    )
                    current_lock_payload = yaml.safe_load(
                        workspace_lock_path.read_text(encoding="utf-8")
                    )
                    current_manifest = WorkspaceBundleManifest.model_validate(
                        current_manifest_payload
                    )
                    current_lock = WorkspaceLock.model_validate(
                        current_lock_payload
                    )
                except (OSError, yaml.YAMLError, ValidationError) as exc:
                    raise ConfigurationRepositoryError(
                        "existing Bundle configuration is invalid"
                    ) from exc
                exact_current = (
                    current_manifest.canonical_payload()
                    == manifest.canonical_payload()
                    and current_lock.canonical_payload() == lock
                )
                if not exact_current:
                    if expected_previous_revision_id is None:
                        raise ConfigurationRepositoryError(
                            "Bundle revision upgrade requires an expected previous revision"
                        )
                    if (
                        current_manifest.metadata.id != manifest.metadata.id
                        or current_manifest.revision_id
                        != expected_previous_revision_id
                        or current_lock.bundle_revision
                        != expected_previous_revision_id
                    ):
                        raise ConfigurationRepositoryError(
                            "existing Bundle revision changed before upgrade"
                        )
                    upgrade_mode = True
                    for dependency in current_lock.assets:
                        relative = self._validate_asset_path(dependency.ref)
                        old_path = configuration_root / relative
                        if old_path not in desired_files:
                            obsolete_asset_paths.add(old_path)
            managed_paths = tuple(
                sorted(
                    (*desired_files, *obsolete_asset_paths),
                    key=lambda path: path.as_posix(),
                )
            )
            path_status = self.git.path_status(
                repository_root,
                managed_paths,
            )
            recoverable = (
                self._recoverable_upgrade_changes(
                    repository_root,
                    desired_files,
                    obsolete_asset_paths,
                    path_status,
                )
                if upgrade_mode
                else self._recoverable_untracked_files(
                    repository_root,
                    desired_files,
                    path_status,
                )
            )
            if path_status and not recoverable:
                raise ConfigurationRepositoryError(
                    "configuration repository has uncommitted manifest/lock "
                    "changes; bootstrap will not stage or overwrite them"
                )
            if upgrade_mode:
                self._atomic_write_yaml(
                    manifest_path, manifest.canonical_payload()
                )
                self._atomic_write_yaml(workspace_lock_path, lock)
            else:
                self._write_new_or_equal_yaml(
                    manifest_path,
                    manifest.canonical_payload(),
                )
                self._write_new_or_equal_yaml(
                    workspace_lock_path,
                    lock,
                )
            for path, content in desired_files.items():
                if isinstance(content, bytes):
                    if upgrade_mode:
                        self._atomic_write_bytes(path, content)
                    else:
                        self._write_new_or_equal_bytes(path, content)
                    if path in executable_paths:
                        path.chmod(0o755)
                    else:
                        path.chmod(0o644)
            for path in obsolete_asset_paths:
                if path.exists():
                    path.unlink()
            commit_oid = self.git.commit_paths(
                repository_root,
                managed_paths,
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
        manifest: WorkspaceBundleManifest,
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

    @staticmethod
    def _atomic_write_bytes(path: Path, content: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("wb") as handle:
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
    def _atomic_write_yaml(cls, path: Path, payload: dict[str, Any]) -> None:
        cls._atomic_write_text(
            path,
            yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
        )

    @staticmethod
    def _validate_asset_path(value: str) -> Path:
        logical = value.removeprefix("bundle://")
        path = PurePosixPath(logical)
        if (
            not logical
            or path.is_absolute()
            or ".." in path.parts
            or "\\" in logical
            or ".git" in path.parts
            or path.as_posix() in {"workspace.yaml", "workspace.lock"}
            or any(part in {"", "."} for part in path.parts)
        ):
            raise ConfigurationRepositoryError(
                "Bundle asset path must be a safe logical path"
            )
        return Path(*path.parts)

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

    @classmethod
    def _write_new_or_equal_bytes(cls, path: Path, content: bytes) -> None:
        if path.exists():
            try:
                if path.is_file() and path.read_bytes() == content:
                    return
            except OSError as exc:
                raise ConfigurationRepositoryError(
                    f"existing Bundle asset is unreadable: {path}"
                ) from exc
            raise ConfigurationRepositoryError(
                f"refusing to overwrite existing Bundle asset: {path}"
            )
        cls._atomic_write_bytes(path, content)

    def _recoverable_untracked_files(
        self,
        repository_root: Path,
        desired_files: dict[Path, dict[str, Any] | bytes],
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
            if not self._content_matches(path, payload):
                return False
        return True

    def _recoverable_upgrade_changes(
        self,
        repository_root: Path,
        desired_files: dict[Path, dict[str, Any] | bytes],
        obsolete_paths: set[Path],
        path_status: dict[str, str],
    ) -> bool:
        """Recognize only writes/deletes from an interrupted prior upgrade."""

        root = repository_root.expanduser().resolve()
        for relative in path_status:
            path = root / relative
            if path in obsolete_paths:
                if path.exists():
                    return False
                continue
            payload = desired_files.get(path)
            if payload is None or not self._content_matches(path, payload):
                return False
        return True

    @staticmethod
    def _content_matches(
        path: Path,
        payload: dict[str, Any] | bytes,
    ) -> bool:
        if isinstance(payload, bytes):
            try:
                return path.is_file() and path.read_bytes() == payload
            except OSError:
                return False
        return ConfigurationRepositoryService._yaml_matches(path, payload)

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
