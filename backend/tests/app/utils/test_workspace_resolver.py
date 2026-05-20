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

from pathlib import Path

import pytest

from app.utils.workspace_paths import project_task_root
from app.utils.workspace_resolver import WorkspaceResolver, WorkspaceStore


@pytest.mark.unit
def test_task_output_root_prefers_existing_old_task_over_binding(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("HOME", str(tmp_path))
    old_task = project_task_root("alice@example.com", "project-1", "task-1")
    old_task.mkdir(parents=True)
    bound_root = tmp_path / "selected"
    bound_root.mkdir()

    resolver = WorkspaceResolver(WorkspaceStore())
    resolver.store.save_binding(
        "alice@example.com",
        "project-1",
        str(bound_root),
    )

    assert (
        resolver.task_output_root("project-1", "task-1", "alice@example.com")
        == old_task
    )


@pytest.mark.unit
def test_frozen_task_snapshot_wins_for_bound_task(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("HOME", str(tmp_path))
    bound_root = tmp_path / "selected"
    bound_root.mkdir()

    resolver = WorkspaceResolver(WorkspaceStore())
    resolver.store.save_binding(
        "alice@example.com",
        "project-1",
        str(bound_root),
    )

    class TaskLock:
        pass

    frozen = resolver.freeze_task_directories_for(
        project_id="project-1",
        task_id="task-2",
        email="alice@example.com",
        task_lock=TaskLock(),
    )
    resolver.write_task_snapshot("alice@example.com", frozen.snapshot)

    assert (
        resolver.task_output_root("project-1", "task-2", "alice@example.com")
        == bound_root
    )
