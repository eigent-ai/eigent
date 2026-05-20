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
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.model.chat import Chat
from app.utils.workspace_paths import (
    camel_log_root,
    legacy_camel_log_root,
    legacy_task_root,
    project_root,
    project_task_root,
    workspace_state_root,
)

logger = logging.getLogger("workspace_resolver")


@dataclass(frozen=True)
class WorkspaceBinding:
    project_id: str
    workspace_root: str
    source: str
    created_at: str
    updated_at: str
    version: int = 1


@dataclass(frozen=True)
class TaskSnapshot:
    task_id: str
    project_id: str
    working_directory: str
    task_output_root: str
    task_start_time: float
    binding_source: str
    created_at: str
    version: int = 1


class WorkspaceStore:
    def _project_path(self, email: str, project_id: str) -> Path:
        return workspace_state_root(email) / "projects" / f"{project_id}.json"

    def _task_path(self, email: str, task_id: str) -> Path:
        return workspace_state_root(email) / "tasks" / f"{task_id}.json"

    def get_binding(
        self, email: str, project_id: str
    ) -> WorkspaceBinding | None:
        path = self._project_path(email, project_id)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return WorkspaceBinding(**data)
        except Exception:
            logger.warning("Failed to read workspace binding: %s", path)
            return None

    def save_binding(
        self, email: str, project_id: str, workspace_root: str
    ) -> WorkspaceBinding:
        now = datetime.now(UTC).isoformat()
        existing = self.get_binding(email, project_id)
        binding = WorkspaceBinding(
            project_id=project_id,
            workspace_root=workspace_root,
            source="local_brain",
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        path = self._project_path(email, project_id)
        self._atomic_write(path, asdict(binding))
        return binding

    def delete_binding(self, email: str, project_id: str) -> None:
        path = self._project_path(email, project_id)
        if path.exists():
            path.unlink()

    def get_snapshot(self, email: str, task_id: str) -> TaskSnapshot | None:
        path = self._task_path(email, task_id)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return TaskSnapshot(**data)
        except Exception:
            logger.warning("Failed to read task snapshot: %s", path)
            return None

    def save_snapshot(self, email: str, snapshot: TaskSnapshot) -> None:
        self._atomic_write(
            self._task_path(email, snapshot.task_id), asdict(snapshot)
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
    binding_source: str
    snapshot: TaskSnapshot


class WorkspaceResolver:
    def __init__(self, store: WorkspaceStore | None = None) -> None:
        self.store = store or WorkspaceStore()

    def project_root(self, project_id: str, email: str) -> Path:
        binding = self.store.get_binding(email, project_id)
        if binding:
            bound_path = Path(binding.workspace_root).expanduser()
            if bound_path.is_dir():
                return bound_path

        legacy_project = project_root(email, project_id)
        if legacy_project.exists():
            return legacy_project
        return legacy_project

    def task_output_root(
        self, project_id: str, task_id: str, email: str
    ) -> Path:
        snapshot = self.store.get_snapshot(email, task_id)
        if snapshot:
            return Path(snapshot.task_output_root).expanduser()

        old_project_task = project_task_root(email, project_id, task_id)
        if old_project_task.exists():
            return old_project_task

        old_legacy_task = legacy_task_root(email, task_id)
        if old_legacy_task.exists():
            return old_legacy_task

        binding = self.store.get_binding(email, project_id)
        if binding:
            bound_path = Path(binding.workspace_root).expanduser()
            if bound_path.is_dir():
                return bound_path

        return old_project_task

    def log_root(self, project_id: str, task_id: str, email: str) -> Path:
        root = camel_log_root(email, project_id, task_id)
        if root.exists():
            return root
        legacy = legacy_camel_log_root(email, task_id)
        if legacy.exists():
            return legacy
        return root

    def freeze_task_directories(
        self, options: Chat, task_lock
    ) -> FrozenTaskDirectories:
        return self.freeze_task_directories_for(
            project_id=options.project_id,
            task_id=options.task_id,
            email=options.email,
            task_lock=task_lock,
            fallback_task_root=options.file_save_path(),
        )

    def freeze_task_directories_for(
        self,
        project_id: str,
        task_id: str,
        email: str,
        task_lock,
        fallback_task_root: str | Path | None = None,
    ) -> FrozenTaskDirectories:
        binding = self.store.get_binding(email, project_id)
        if binding and Path(binding.workspace_root).expanduser().is_dir():
            directory = Path(binding.workspace_root).expanduser()
            binding_source = "local_brain"
        elif fallback_task_root is not None:
            directory = Path(fallback_task_root).expanduser()
            binding_source = "default"
        else:
            directory = project_task_root(email, project_id, task_id)
            binding_source = "default"

        directory.mkdir(parents=True, exist_ok=True)
        task_start_time = time.time()
        snapshot = TaskSnapshot(
            task_id=task_id,
            project_id=project_id,
            working_directory=str(directory),
            task_output_root=str(directory),
            task_start_time=task_start_time,
            binding_source=binding_source,
            created_at=datetime.now(UTC).isoformat(),
        )

        task_lock.working_directory = str(directory)
        task_lock.task_output_root = str(directory)
        task_lock.task_start_time = task_start_time
        task_lock.email = email
        task_lock.project_id = project_id
        task_lock.current_task_id = task_id

        return FrozenTaskDirectories(
            working_directory=directory,
            task_output_root=directory,
            task_start_time=task_start_time,
            binding_source=binding_source,
            snapshot=snapshot,
        )

    def write_task_snapshot(self, email: str, snapshot: TaskSnapshot) -> None:
        self.store.save_snapshot(email, snapshot)


_resolver: WorkspaceResolver | None = None


def get_workspace_resolver() -> WorkspaceResolver:
    global _resolver
    if _resolver is None:
        _resolver = WorkspaceResolver()
    return _resolver
