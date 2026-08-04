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

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.controller import workspace_controller


def workspace_store(*, snapshot=None, latest_snapshot=None, binding=None):
    return SimpleNamespace(
        get_snapshot=lambda *_args: snapshot,
        get_latest_project_snapshot=lambda *_args: latest_snapshot,
        get_binding=lambda *_args: binding,
    )


@pytest.mark.asyncio
async def test_effective_directory_returns_matching_task_snapshot(
    monkeypatch, tmp_path
):
    working_directory = tmp_path / "project-workdir"
    working_directory.mkdir()
    snapshot = SimpleNamespace(
        project_id="project-1",
        space_id="space-1",
        working_directory=str(working_directory),
        workdir_mode="copy",
    )
    resolver = SimpleNamespace(store=workspace_store(snapshot=snapshot))
    monkeypatch.setattr(
        workspace_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        workspace_controller, "get_task_lock_if_exists", lambda _id: None
    )

    result = await workspace_controller.workspace_effective_directory(
        space_id="space-1",
        project_id="project-1",
        email="user@example.com",
        user_id="7",
        task_id="task-1",
    )

    assert result["working_directory"] == str(working_directory)
    assert result["source"] == "task_snapshot"
    assert result["workdir_mode"] == "copy"


@pytest.mark.asyncio
async def test_effective_directory_falls_back_to_matching_active_run(
    monkeypatch, tmp_path
):
    working_directory = tmp_path / "active-run"
    working_directory.mkdir()
    resolver = SimpleNamespace(store=workspace_store())
    task_lock = SimpleNamespace(
        project_id="project-1",
        space_id="space-1",
        current_task_id="task-1",
        working_directory=str(working_directory),
        workdir_mode="direct-write",
    )
    monkeypatch.setattr(
        workspace_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        workspace_controller,
        "get_task_lock_if_exists",
        lambda _id: task_lock,
    )

    result = await workspace_controller.workspace_effective_directory(
        space_id="space-1",
        project_id="project-1",
        email="user@example.com",
        task_id="task-1",
    )

    assert result["working_directory"] == str(working_directory)
    assert result["source"] == "active_run"


@pytest.mark.asyncio
async def test_effective_directory_rejects_cross_project_snapshot(
    monkeypatch, tmp_path
):
    working_directory = tmp_path / "other-project"
    working_directory.mkdir()
    snapshot = SimpleNamespace(
        project_id="project-other",
        space_id="space-1",
        working_directory=str(working_directory),
        workdir_mode="copy",
    )
    resolver = SimpleNamespace(store=workspace_store(snapshot=snapshot))
    monkeypatch.setattr(
        workspace_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        workspace_controller, "get_task_lock_if_exists", lambda _id: None
    )

    with pytest.raises(HTTPException) as exc_info:
        await workspace_controller.workspace_effective_directory(
            space_id="space-1",
            project_id="project-1",
            email="user@example.com",
            task_id="task-1",
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail["code"] == "effective_workspace_unavailable"


@pytest.mark.asyncio
async def test_effective_directory_uses_latest_project_snapshot_when_idle(
    monkeypatch, tmp_path
):
    working_directory = tmp_path / "latest-project-workdir"
    working_directory.mkdir()
    latest_snapshot = SimpleNamespace(
        task_id="task-latest",
        project_id="project-1",
        space_id="space-1",
        working_directory=str(working_directory),
        workdir_mode="copy",
    )
    resolver = SimpleNamespace(
        store=workspace_store(latest_snapshot=latest_snapshot)
    )
    monkeypatch.setattr(
        workspace_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        workspace_controller, "get_task_lock_if_exists", lambda _id: None
    )

    result = await workspace_controller.workspace_effective_directory(
        space_id="space-1",
        project_id="project-1",
        email="user@example.com",
    )

    assert result["task_id"] == "task-latest"
    assert result["working_directory"] == str(working_directory)
    assert result["source"] == "task_snapshot"
    assert result["workdir_mode"] == "copy"


@pytest.mark.asyncio
@pytest.mark.parametrize("workdir_mode", [None, "direct-write"])
async def test_effective_directory_uses_binding_for_direct_write_idle_project(
    monkeypatch, tmp_path, workdir_mode
):
    workspace_root = tmp_path / "bound-space"
    workspace_root.mkdir()
    binding = SimpleNamespace(workspace_root=str(workspace_root))
    resolver = SimpleNamespace(store=workspace_store(binding=binding))
    monkeypatch.setattr(
        workspace_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        workspace_controller, "get_task_lock_if_exists", lambda _id: None
    )

    result = await workspace_controller.workspace_effective_directory(
        space_id="space-1",
        project_id="project-1",
        email="user@example.com",
        workdir_mode=workdir_mode,
    )

    assert result["working_directory"] == str(workspace_root)
    assert result["source"] == "binding"
    assert result["workdir_mode"] == workdir_mode


@pytest.mark.asyncio
async def test_effective_directory_does_not_use_binding_for_copy_project(
    monkeypatch, tmp_path
):
    workspace_root = tmp_path / "bound-space"
    workspace_root.mkdir()
    binding = SimpleNamespace(workspace_root=str(workspace_root))
    resolver = SimpleNamespace(store=workspace_store(binding=binding))
    monkeypatch.setattr(
        workspace_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        workspace_controller, "get_task_lock_if_exists", lambda _id: None
    )

    with pytest.raises(HTTPException) as exc_info:
        await workspace_controller.workspace_effective_directory(
            space_id="space-1",
            project_id="project-1",
            email="user@example.com",
            workdir_mode="copy",
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail["code"] == "effective_workspace_unavailable"
