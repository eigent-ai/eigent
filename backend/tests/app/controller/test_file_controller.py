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

import os
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.local_control import LOCAL_CONTROL_CAPABILITY_HEADER
from app.controller import file_controller


def test_resolve_project_root_prefers_user_id_root(
    monkeypatch, tmp_path, caplog
):
    eigent_root = tmp_path / "eigent"
    user_project = eigent_root / "user_20" / "project_p1"
    user_project.mkdir(parents=True)
    (eigent_root / "other_user" / "project_p1").mkdir(parents=True)

    monkeypatch.setattr(
        file_controller, "_get_eigent_root", lambda: eigent_root
    )

    resolved = file_controller._resolve_project_root(
        "yueming.lai@example.com", "p1", "20"
    )

    assert resolved == user_project
    assert "Resolved project root via fallback lookup" not in caplog.text


def test_resolve_project_root_falls_back_to_legacy_email_root(
    monkeypatch, tmp_path
):
    eigent_root = tmp_path / "eigent"
    legacy_project = eigent_root / "yueming.lai" / "project_p1"
    legacy_project.mkdir(parents=True)

    monkeypatch.setattr(
        file_controller, "_get_eigent_root", lambda: eigent_root
    )

    resolved = file_controller._resolve_project_root(
        "yueming.lai@example.com", "p1", "20"
    )

    assert resolved == legacy_project


def test_resolve_project_root_does_not_fallback_to_other_user_root(
    monkeypatch, tmp_path
):
    eigent_root = tmp_path / "eigent"
    (eigent_root / "user_20" / "project_p1").mkdir(parents=True)
    expected = eigent_root / "user_42" / "project_p1"

    monkeypatch.setattr(
        file_controller, "_get_eigent_root", lambda: eigent_root
    )

    resolved = file_controller._resolve_project_root(
        "yueming.lai@example.com", "p1", "42"
    )

    assert resolved == expected


def test_resolve_project_root_without_user_id_stays_email_scoped(
    monkeypatch, tmp_path
):
    eigent_root = tmp_path / "eigent"
    (eigent_root / "user_20" / "project_p1").mkdir(parents=True)
    expected = eigent_root / "yueming.lai" / "project_p1"

    monkeypatch.setattr(
        file_controller, "_get_eigent_root", lambda: eigent_root
    )

    resolved = file_controller._resolve_project_root(
        "yueming.lai@example.com", "p1"
    )

    assert resolved == expected


def test_task_changes_include_all_outputs_but_only_recent_workspace_edits(
    tmp_path,
):
    output_root = tmp_path / "outputs"
    working_root = tmp_path / "workspace"
    output_root.mkdir()
    working_root.mkdir()
    started_at = time.time()

    copied_output = output_root / "copied-report.csv"
    copied_output.write_text("output", encoding="utf-8")
    old_workspace_file = working_root / "existing.md"
    old_workspace_file.write_text("old", encoding="utf-8")
    old_time = started_at - 60
    os.utime(copied_output, (old_time, old_time))
    os.utime(old_workspace_file, (old_time, old_time))
    # Old files must be filtered before the 500-item result bound. Otherwise
    # a large selected folder can hide a recent artifact later in the walk.
    for index in range(510):
        old_file = working_root / f"old-{index:03d}.txt"
        old_file.write_text("old", encoding="utf-8")
        os.utime(old_file, (old_time, old_time))
    edited_workspace_file = working_root / "reports" / "final.md"
    edited_workspace_file.parent.mkdir()
    edited_workspace_file.write_text("new", encoding="utf-8")

    files = file_controller._list_task_changed_files(
        SimpleNamespace(
            task_output_root=str(output_root),
            working_directory=str(working_root),
            task_start_time=started_at,
        )
    )

    assert {item["path"] for item in files} == {
        str(copied_output.resolve()),
        str(edited_workspace_file.resolve()),
    }
    assert {item["relativePath"] for item in files} == {
        "copied-report.csv",
        "reports/final.md",
    }
    assert {item["path"]: item["changeType"] for item in files} == {
        str(copied_output.resolve()): "generated",
        str(edited_workspace_file.resolve()): "changed",
    }


def test_task_changes_endpoint_requires_local_capability(monkeypatch, tmp_path):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    snapshot = SimpleNamespace(
        project_id="project-1",
        task_output_root=str(tmp_path),
        working_directory=str(tmp_path),
        task_start_time=time.time(),
    )
    resolver = MagicMock()
    resolver.store.get_snapshot.return_value = snapshot
    monkeypatch.setattr(
        file_controller, "get_workspace_resolver", lambda: resolver
    )

    app = FastAPI()
    app.include_router(file_controller.router)
    client = TestClient(app, client=("127.0.0.1", 50000))
    params = {
        "task_id": "task-1",
        "project_id": "project-1",
        "email": "user@example.com",
    }

    assert client.get("/files/changes", params=params).status_code == 401
    response = client.get(
        "/files/changes",
        params=params,
        headers={LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"},
    )
    assert response.status_code == 200
    assert response.json() == []
