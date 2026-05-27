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

import json
import logging
import os
import shutil
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from app.model.chat import Chat
from app.router_layer.hands_resolver import get_environment_hands
from app.utils.workspace_paths import (
    camel_log_root,
    legacy_camel_log_root,
    legacy_task_root,
    project_root,
    project_task_root,
    project_workdir_root,
    run_output_root,
    workspace_state_root,
)

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback
    fcntl = None

logger = logging.getLogger("workspace_resolver")
BindingSource = Literal["space_local_brain", "default"]
WORKDIR_MARKER = ".eigent-workdir.json"
COPY_IGNORE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    ".cache",
    "__pycache__",
}
MAX_COPY_FILE_SIZE = 25 * 1024 * 1024


@contextmanager
def _filesystem_space_lock(source_root: Path):
    """Cooperate with server-side Apply while copying a live Space root.

    This uses an advisory lock on the root directory itself, so it does not add
    files to the user's repository. It only coordinates with processes that
    take the same lock; unsupported platforms fall back to no-op locking.
    """

    if fcntl is None:
        yield
        return

    fd: int | None = None
    try:
        fd = os.open(source_root, os.O_RDONLY)
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        if fd is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)


def _binding_enabled_for_current_environment() -> bool:
    hands = get_environment_hands()
    get_manifest = getattr(hands, "get_capability_manifest", None)
    if get_manifest is None:
        return False
    try:
        manifest = get_manifest()
    except Exception:
        logger.warning(
            "Failed to read hands capability manifest for workspace binding",
            exc_info=True,
        )
        return False
    if not isinstance(manifest, dict):
        return False
    return manifest.get("deployment") == "local"


def _same_workspace_path(left: str, right: str) -> bool:
    try:
        return (
            Path(left).expanduser().resolve()
            == Path(right).expanduser().resolve()
        )
    except (OSError, RuntimeError):
        return False


def _folder_fingerprint(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "kind": "local_folder",
        "path": str(path),
        "device": stat.st_dev,
        "inode": stat.st_ino,
        "mtime_ns": stat.st_mtime_ns,
        "ctime_ns": stat.st_ctime_ns,
    }


def _read_workdir_marker(workdir: Path) -> dict[str, Any] | None:
    marker = workdir / WORKDIR_MARKER
    if not marker.exists():
        return None
    try:
        return json.loads(marker.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Failed to read Project workdir marker: %s", marker)
        return None


def _copy_space_baseline(source_root: Path, workdir: Path) -> str:
    with _filesystem_space_lock(source_root):
        existing_marker = _read_workdir_marker(workdir)
        if existing_marker and existing_marker.get("base_snapshot_id"):
            return str(existing_marker["base_snapshot_id"])

        workdir.mkdir(parents=True, exist_ok=True)
        _copy_tree_limited(source_root, workdir)

        base_snapshot_id = f"snapshot_{uuid4().hex}"
        marker = workdir / WORKDIR_MARKER
        marker.write_text(
            json.dumps(
                {
                    "base_snapshot_id": base_snapshot_id,
                    "source_root": str(source_root),
                    "created_at": datetime.now(UTC).isoformat(),
                    "copy_ignore_dirs": sorted(COPY_IGNORE_DIRS),
                    "max_copy_file_size": MAX_COPY_FILE_SIZE,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return base_snapshot_id


def _copy_tree_limited(source_root: Path, target_root: Path) -> None:
    target_root.mkdir(parents=True, exist_ok=True)
    for item in source_root.iterdir():
        if item.name in COPY_IGNORE_DIRS or item.name == WORKDIR_MARKER:
            continue
        target = target_root / item.name
        try:
            if item.is_symlink():
                continue
            if item.is_dir():
                _copy_tree_limited(item, target)
                continue
            if item.is_file() and item.stat().st_size <= MAX_COPY_FILE_SIZE:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)
        except OSError:
            logger.warning(
                "Failed to copy Space baseline item into Project workdir: %s",
                item,
                exc_info=True,
            )


@dataclass(frozen=True)
class WorkspaceBinding:
    space_id: str
    workspace_root: str
    source: str
    created_at: str
    updated_at: str
    root_fingerprint: dict[str, Any] | None = None
    version: int = 2


@dataclass(frozen=True)
class TaskSnapshot:
    task_id: str
    project_id: str
    space_id: str
    user_id: str | int | None
    working_directory: str
    task_output_root: str
    task_start_time: float
    binding_source: BindingSource
    created_at: str
    workdir_mode: str | None = None
    base_snapshot_id: str | None = None
    version: int = 2


class WorkspaceStore:
    def _state_roots(
        self, email: str, user_id: str | int | None = None
    ) -> tuple[Path, ...]:
        primary = workspace_state_root(email, user_id)
        legacy = workspace_state_root(email)
        if user_id is not None and primary != legacy:
            return (primary, legacy)
        return (primary,)

    def _space_path(
        self, email: str, space_id: str, user_id: str | int | None = None
    ) -> Path:
        return (
            self._state_roots(email, user_id)[0]
            / "spaces"
            / f"{space_id}.json"
        )

    def _space_paths(
        self, email: str, space_id: str, user_id: str | int | None = None
    ) -> tuple[Path, ...]:
        return tuple(
            root / "spaces" / f"{space_id}.json"
            for root in self._state_roots(email, user_id)
        )

    def _task_path(
        self, email: str, task_id: str, user_id: str | int | None = None
    ) -> Path:
        return (
            self._state_roots(email, user_id)[0] / "tasks" / f"{task_id}.json"
        )

    def _task_paths(
        self, email: str, task_id: str, user_id: str | int | None = None
    ) -> tuple[Path, ...]:
        return tuple(
            root / "tasks" / f"{task_id}.json"
            for root in self._state_roots(email, user_id)
        )

    def get_binding(
        self, email: str, space_id: str, user_id: str | int | None = None
    ) -> WorkspaceBinding | None:
        for path in self._space_paths(email, space_id, user_id):
            if not path.exists():
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if "space_id" not in data and "project_id" in data:
                    data["space_id"] = data.pop("project_id")
                return WorkspaceBinding(**data)
            except Exception:
                logger.warning("Failed to read workspace binding: %s", path)
        return None

    def save_binding(
        self,
        email: str,
        space_id: str,
        workspace_root: str,
        *,
        user_id: str | int | None = None,
        root_fingerprint: dict[str, Any] | None = None,
    ) -> WorkspaceBinding:
        now = datetime.now(UTC).isoformat()
        existing = self.get_binding(email, space_id, user_id)
        binding = WorkspaceBinding(
            space_id=space_id,
            workspace_root=workspace_root,
            source="space_local_brain",
            created_at=existing.created_at if existing else now,
            updated_at=now,
            root_fingerprint=root_fingerprint,
        )
        primary_path = self._space_path(email, space_id, user_id)
        self._atomic_write(primary_path, asdict(binding))
        for legacy_path in self._space_paths(email, space_id, user_id)[1:]:
            if legacy_path != primary_path and legacy_path.exists():
                legacy_path.unlink()
        return binding

    def _promote_binding_to_user_path(
        self,
        email: str,
        user_id: str | int | None,
        binding: WorkspaceBinding,
    ) -> None:
        if user_id is None:
            return
        primary_path = self._space_path(email, binding.space_id, user_id)
        self._atomic_write(primary_path, asdict(binding))
        for legacy_path in self._space_paths(email, binding.space_id, user_id)[
            1:
        ]:
            if legacy_path != primary_path and legacy_path.exists():
                legacy_path.unlink()

    def delete_binding(
        self, email: str, space_id: str, user_id: str | int | None = None
    ) -> None:
        for path in self._space_paths(email, space_id, user_id):
            if path.exists():
                path.unlink()

    def reconcile_bindings(
        self,
        email: str,
        active_space_ids: set[str],
        user_id: str | int | None = None,
    ) -> list[WorkspaceBinding]:
        if not active_space_ids:
            logger.warning(
                "Skipping workspace binding reconciliation with no active Space ids",
                extra={"email": email},
            )
            return []

        removed: list[WorkspaceBinding] = []
        for binding in self.list_bindings(email, user_id):
            if binding.space_id in active_space_ids:
                self._promote_binding_to_user_path(email, user_id, binding)
                continue
            self.delete_binding(email, binding.space_id, user_id)
            removed.append(binding)
        return removed

    def list_bindings(
        self, email: str, user_id: str | int | None = None
    ) -> list[WorkspaceBinding]:
        bindings_by_space: dict[str, WorkspaceBinding] = {}
        for root in self._state_roots(email, user_id):
            spaces_dir = root / "spaces"
            if not spaces_dir.exists():
                continue
            for path in spaces_dir.glob("*.json"):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    if "space_id" not in data and "project_id" in data:
                        data["space_id"] = data.pop("project_id")
                    binding = WorkspaceBinding(**data)
                    bindings_by_space.setdefault(binding.space_id, binding)
                except Exception:
                    logger.warning(
                        "Failed to read workspace binding: %s", path
                    )
        return list(bindings_by_space.values())

    def get_snapshot(
        self, email: str, task_id: str, user_id: str | int | None = None
    ) -> TaskSnapshot | None:
        for path in self._task_paths(email, task_id, user_id):
            if not path.exists():
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if "space_id" not in data:
                    data["space_id"] = data.get("project_id", "")
                data.setdefault("user_id", None)
                data.setdefault("workdir_mode", None)
                data.setdefault("base_snapshot_id", None)
                return TaskSnapshot(**data)
            except Exception:
                logger.warning("Failed to read task snapshot: %s", path)
        return None

    def save_snapshot(self, email: str, snapshot: TaskSnapshot) -> None:
        self._atomic_write(
            self._task_path(email, snapshot.task_id, snapshot.user_id),
            asdict(snapshot),
        )

    def _atomic_write(self, path: Path, data: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(path)


@dataclass(frozen=True)
class FrozenTaskDirectories:
    working_directory: Path
    task_output_root: Path
    task_start_time: float
    binding_source: BindingSource
    workdir_mode: str | None
    base_snapshot_id: str | None
    snapshot: TaskSnapshot


class WorkspaceResolver:
    def __init__(self, store: WorkspaceStore | None = None) -> None:
        self.store = store or WorkspaceStore()

    def ensure_space_binding(
        self,
        email: str,
        space_id: str,
        root_path: str,
        user_id: str | int | None = None,
    ) -> WorkspaceBinding:
        if not _binding_enabled_for_current_environment():
            raise ValueError(
                "Workspace folder binding is disabled in this deployment"
            )

        resolved = Path(root_path).expanduser().resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise ValueError("Space root_path is not a readable directory")

        existing = self.store.get_binding(email, space_id, user_id)
        if existing is not None:
            if _same_workspace_path(existing.workspace_root, str(resolved)):
                return existing
            raise ValueError("Space is already bound to a different folder")

        return self.store.save_binding(
            email,
            space_id,
            str(resolved),
            user_id=user_id,
            root_fingerprint=_folder_fingerprint(resolved),
        )

    def space_root(
        self,
        space_id: str,
        project_id: str,
        email: str,
        user_id: str | int | None = None,
    ) -> Path | None:
        binding = self.store.get_binding(email, space_id, user_id)
        if binding:
            bound_path = Path(binding.workspace_root).expanduser()
            if bound_path.is_dir():
                return bound_path

        legacy_project = project_root(email, project_id, user_id)
        if user_id is not None and not legacy_project.exists():
            legacy_project = project_root(email, project_id)
        if legacy_project.exists():
            return legacy_project
        return None

    def task_output_root(
        self,
        space_id: str,
        project_id: str,
        task_id: str,
        email: str,
        user_id: str | int | None = None,
    ) -> Path:
        snapshot = self.store.get_snapshot(email, task_id, user_id)
        if snapshot:
            return Path(snapshot.task_output_root).expanduser()

        old_project_task = project_task_root(
            email, project_id, task_id, user_id
        )
        if old_project_task.exists():
            return old_project_task
        if user_id is not None:
            legacy_project_task = project_task_root(email, project_id, task_id)
            if legacy_project_task.exists():
                return legacy_project_task

        old_legacy_task = legacy_task_root(email, task_id, user_id)
        if old_legacy_task.exists():
            return old_legacy_task
        if user_id is not None:
            legacy_email_task = legacy_task_root(email, task_id)
            if legacy_email_task.exists():
                return legacy_email_task

        binding = self.store.get_binding(email, space_id, user_id)
        if binding:
            bound_path = Path(binding.workspace_root).expanduser()
            if bound_path.is_dir():
                return run_output_root(
                    email, space_id, project_id, task_id, user_id
                )

        return old_project_task

    def log_root(
        self,
        project_id: str,
        task_id: str,
        email: str,
        user_id: str | int | None = None,
    ) -> Path:
        root = camel_log_root(email, project_id, task_id, user_id)
        if root.exists():
            return root
        if user_id is not None:
            legacy_project_root = camel_log_root(email, project_id, task_id)
            if legacy_project_root.exists():
                return legacy_project_root
        legacy = legacy_camel_log_root(email, task_id, user_id)
        if legacy.exists():
            return legacy
        if user_id is not None:
            legacy_email = legacy_camel_log_root(email, task_id)
            if legacy_email.exists():
                return legacy_email
        return root

    def freeze_task_directories(
        self, options: Chat, task_lock
    ) -> FrozenTaskDirectories:
        space_id = options.space_id or options.project_id
        task_lock.workdir_mode = options.workdir_mode
        if options.space_root_path:
            self.ensure_space_binding(
                options.email,
                space_id,
                options.space_root_path,
                user_id=options.user_id,
            )
        return self.freeze_task_directories_for(
            space_id=space_id,
            project_id=options.project_id,
            task_id=options.task_id,
            email=options.email,
            task_lock=task_lock,
            fallback_task_root=options.file_save_path(),
            user_id=options.user_id,
        )

    def freeze_task_directories_for(
        self,
        space_id: str,
        project_id: str,
        task_id: str,
        email: str,
        task_lock,
        fallback_task_root: str | Path | None = None,
        user_id: str | int | None = None,
    ) -> FrozenTaskDirectories:
        binding = self.store.get_binding(email, space_id, user_id)
        if binding and Path(binding.workspace_root).expanduser().is_dir():
            source_root = Path(binding.workspace_root).expanduser().resolve()
            task_output = run_output_root(
                email, space_id, project_id, task_id, user_id
            )
            workdir_mode = getattr(task_lock, "workdir_mode", None)
            if workdir_mode == "artifact-only":
                working_directory = task_output
                base_snapshot_id = None
            elif workdir_mode == "direct-write":
                working_directory = source_root
                base_snapshot_id = None
            else:
                working_directory = project_workdir_root(
                    email,
                    space_id,
                    project_id,
                    user_id,
                )
                base_snapshot_id = _copy_space_baseline(
                    source_root, working_directory
                )
                workdir_mode = workdir_mode or "copy"
            binding_source: BindingSource = "space_local_brain"
        elif fallback_task_root is not None:
            working_directory = Path(fallback_task_root).expanduser()
            task_output = working_directory
            binding_source = "default"
            workdir_mode = getattr(task_lock, "workdir_mode", None)
            base_snapshot_id = None
        else:
            working_directory = project_task_root(
                email, project_id, task_id, user_id
            )
            task_output = working_directory
            binding_source = "default"
            workdir_mode = getattr(task_lock, "workdir_mode", None)
            base_snapshot_id = None

        working_directory.mkdir(parents=True, exist_ok=True)
        task_output.mkdir(parents=True, exist_ok=True)
        task_start_time = time.time()
        snapshot = TaskSnapshot(
            task_id=task_id,
            project_id=project_id,
            space_id=space_id,
            user_id=user_id,
            working_directory=str(working_directory),
            task_output_root=str(task_output),
            task_start_time=task_start_time,
            binding_source=binding_source,
            workdir_mode=workdir_mode,
            base_snapshot_id=base_snapshot_id,
            created_at=datetime.now(UTC).isoformat(),
        )

        task_lock.working_directory = str(working_directory)
        task_lock.task_output_root = str(task_output)
        task_lock.task_start_time = task_start_time
        task_lock.email = email
        task_lock.user_id = user_id
        task_lock.project_id = project_id
        task_lock.space_id = space_id
        task_lock.current_task_id = task_id
        task_lock.workdir_mode = workdir_mode
        task_lock.base_snapshot_id = base_snapshot_id

        return FrozenTaskDirectories(
            working_directory=working_directory,
            task_output_root=task_output,
            task_start_time=task_start_time,
            binding_source=binding_source,
            workdir_mode=workdir_mode,
            base_snapshot_id=base_snapshot_id,
            snapshot=snapshot,
        )

    def write_task_snapshot(self, email: str, snapshot: TaskSnapshot) -> None:
        self.store.save_snapshot(email, snapshot)

    def refresh_project_workdir(
        self,
        *,
        space_id: str,
        project_id: str,
        email: str,
        user_id: str | int | None = None,
    ) -> str:
        binding = self.store.get_binding(email, space_id, user_id)
        if binding is None:
            raise ValueError("Space is not bound in this Brain")
        source_root = Path(binding.workspace_root).expanduser().resolve()
        if not source_root.is_dir():
            raise ValueError("Bound Space root is not available")
        workdir = project_workdir_root(email, space_id, project_id, user_id)
        if workdir.exists():
            shutil.rmtree(workdir)
        return _copy_space_baseline(source_root, workdir)


_resolver: WorkspaceResolver | None = None


def get_workspace_resolver() -> WorkspaceResolver:
    global _resolver
    if _resolver is None:
        _resolver = WorkspaceResolver()
    return _resolver
