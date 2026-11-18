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

"""Guards for deleting a Session's Eigent-created workdir copy."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.controller import workspace_controller
from app.model.enums import Status
from app.run_journal import SQLiteRunJournal
from app.utils.workspace_paths import project_workdir_root
from app.utils.workspace_resolver import (
    WORKDIR_MARKER,
    WorkspaceResolver,
)

EMAIL = "owner@example.com"
USER_ID = "42"


@pytest.fixture
def journal(tmp_path: Path, monkeypatch):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    monkeypatch.setattr(
        workspace_controller, "get_default_run_journal", lambda: journal
    )
    yield journal
    journal.close()


@pytest.fixture
def resolver(tmp_path: Path, monkeypatch, journal) -> WorkspaceResolver:
    monkeypatch.setenv("HOME", str(tmp_path))
    resolver = WorkspaceResolver()
    monkeypatch.setattr(
        workspace_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        workspace_controller, "get_task_lock_if_exists", lambda _id: None
    )
    return resolver


def _workdir(marker: bool = True) -> Path:
    workdir = project_workdir_root(EMAIL, "space-1", "project-1", USER_ID)
    workdir.mkdir(parents=True)
    (workdir / "draft.txt").write_text("unpublished", encoding="utf-8")
    if marker:
        (workdir / WORKDIR_MARKER).write_text(
            json.dumps({"base_snapshot_id": "snapshot_1"}), encoding="utf-8"
        )
    return workdir


async def _delete():
    return await workspace_controller.workspace_project_workdir_delete(
        "space-1", "project-1", email=EMAIL, user_id=USER_ID
    )


async def _exists():
    response = await workspace_controller.workspace_project_workdir(
        "space-1", "project-1", email=EMAIL, user_id=USER_ID
    )
    return response["exists"]


@pytest.mark.asyncio
async def test_deletes_marked_owner_workdir_and_retries_as_absent(resolver):
    workdir = _workdir()
    assert await _exists() is True

    assert (await _delete())["deleted"] is True
    assert not workdir.exists()
    assert workdir.parent.is_dir()
    assert await _exists() is False
    assert (await _delete())["deleted"] is False


@pytest.mark.asyncio
async def test_refuses_while_legacy_task_lock_is_running(
    resolver, monkeypatch
):
    workdir = _workdir()
    monkeypatch.setattr(
        workspace_controller,
        "get_task_lock_if_exists",
        lambda _id: SimpleNamespace(
            status=Status.processing, background_tasks=[]
        ),
    )

    with pytest.raises(HTTPException) as error:
        await _delete()

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "project_running"
    assert workdir.is_dir()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["pending", "running", "waiting_for_user"])
async def test_refuses_while_canonical_run_is_active(
    resolver, journal, status
):
    workdir = _workdir()
    journal.ensure_run(run_id="run-1", project_id="project-1", status=status)

    with pytest.raises(HTTPException) as error:
        await _delete()

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "project_running"
    assert workdir.is_dir()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
async def test_terminal_canonical_run_does_not_block_deletion(
    resolver, journal, status
):
    workdir = _workdir()
    journal.ensure_run(run_id="run-1", project_id="project-1", status=status)

    assert (await _delete())["deleted"] is True
    assert not workdir.exists()


@pytest.mark.asyncio
async def test_active_run_of_another_project_does_not_block_deletion(
    resolver, journal
):
    workdir = _workdir()
    journal.ensure_run(run_id="run-1", project_id="project-2")

    assert (await _delete())["deleted"] is True
    assert not workdir.exists()


@pytest.mark.asyncio
async def test_refresh_refuses_while_canonical_run_is_active(
    resolver, journal
):
    journal.ensure_run(run_id="run-1", project_id="project-1")

    with pytest.raises(HTTPException) as error:
        await workspace_controller.workspace_project_refresh(
            "space-1",
            "project-1",
            workspace_controller.WorkspaceProjectRefreshRequest(
                email=EMAIL, user_id=USER_ID, server_refresh_confirmed=True
            ),
        )

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "project_running"


@pytest.mark.asyncio
async def test_refuses_directory_without_eigent_marker(resolver):
    workdir = _workdir(marker=False)

    with pytest.raises(HTTPException) as error:
        await _delete()

    assert error.value.detail["code"] == "workspace_workdir_unsafe"
    assert (workdir / "draft.txt").is_file()


@pytest.mark.asyncio
async def test_refuses_symlinked_workdir(resolver, tmp_path: Path):
    target = tmp_path / "elsewhere"
    target.mkdir()
    (target / WORKDIR_MARKER).write_text(
        json.dumps({"base_snapshot_id": "snapshot_1"}), encoding="utf-8"
    )
    workdir = project_workdir_root(EMAIL, "space-1", "project-1", USER_ID)
    workdir.parent.mkdir(parents=True)
    workdir.symlink_to(target, target_is_directory=True)

    with pytest.raises(HTTPException):
        await _delete()

    assert (target / WORKDIR_MARKER).is_file()


@pytest.mark.asyncio
async def test_refuses_workdir_inside_a_bound_space_root(resolver):
    workdir = _workdir()
    resolver.store.save_binding(
        EMAIL, "space-2", str(workdir.parent), user_id=USER_ID
    )

    with pytest.raises(HTTPException) as error:
        await _delete()

    assert error.value.detail["code"] == "workspace_workdir_unsafe"
    assert workdir.is_dir()


@pytest.mark.asyncio
async def test_rejects_identifiers_that_escape_the_owner_root(resolver):
    with pytest.raises(HTTPException):
        await workspace_controller.workspace_project_workdir_delete(
            "space-1", "..", email=EMAIL, user_id=USER_ID
        )


@pytest.mark.asyncio
async def test_other_owner_workdir_is_not_visible(resolver):
    workdir = _workdir()

    response = await workspace_controller.workspace_project_workdir_delete(
        "space-1", "project-1", email=EMAIL, user_id="7"
    )

    assert response["deleted"] is False
    assert workdir.is_dir()
