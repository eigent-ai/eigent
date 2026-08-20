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
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app import api as brain_api
from app.auth.local_control import LOCAL_CONTROL_CAPABILITY_HEADER
from app.controller import file_controller


def test_brain_cors_exposes_file_preview_metadata_headers():
    cors = next(
        middleware
        for middleware in brain_api.user_middleware
        if middleware.cls is CORSMiddleware
    )
    exposed = {header.lower() for header in cors.kwargs["expose_headers"]}

    assert {
        "accept-ranges",
        "content-disposition",
        "content-length",
        "content-range",
        "last-modified",
    } <= exposed


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
    assert {item["path"]: item["size"] for item in files} == {
        str(copied_output.resolve()): 6,
        str(edited_workspace_file.resolve()): 3,
    }
    assert all(item["modifiedAt"] > 0 for item in files)


def test_task_changes_exclude_files_written_after_run_attempt(tmp_path):
    output_root = tmp_path / "outputs"
    working_root = tmp_path / "shared-space"
    output_root.mkdir()
    working_root.mkdir()
    started_at = time.time() - 120
    ended_at = started_at + 30

    current_run_file = working_root / "bank-transfer.csv"
    current_run_file.write_text("current", encoding="utf-8")
    os.utime(
        current_run_file,
        (started_at + 10, started_at + 10),
    )
    future_run_file = working_root / "long-horizon" / "report.md"
    future_run_file.parent.mkdir()
    future_run_file.write_text("future", encoding="utf-8")
    os.utime(
        future_run_file,
        (ended_at + 60, ended_at + 60),
    )

    files = file_controller._list_task_changed_files(
        SimpleNamespace(
            task_output_root=str(output_root),
            working_directory=str(working_root),
            task_start_time=started_at,
        ),
        modification_windows=((started_at - 1, ended_at),),
    )

    assert [item["relativePath"] for item in files] == ["bank-transfer.csv"]


def test_task_changes_skip_file_deleted_between_walk_and_stat(
    monkeypatch, tmp_path
):
    output_root = tmp_path / "outputs"
    output_root.mkdir()
    disappearing = output_root / "ephemeral.txt"
    disappearing.write_text("temporary", encoding="utf-8")
    original_stat = Path.stat
    target_stat_calls = 0

    monkeypatch.setattr(
        file_controller,
        "list_files",
        lambda *_args, **_kwargs: [str(disappearing)],
    )

    def disappearing_stat(path, *args, **kwargs):
        nonlocal target_stat_calls
        if path == disappearing:
            target_stat_calls += 1
            if target_stat_calls >= 2:
                raise FileNotFoundError(path)
        return original_stat(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", disappearing_stat)

    files = file_controller._list_task_changed_files(
        SimpleNamespace(
            task_output_root=str(output_root),
            working_directory=str(output_root),
            task_start_time=time.time() - 10,
        )
    )

    assert files == []


def test_task_changes_endpoint_freezes_completed_run_manifest(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    started_at = time.time() - 120
    ended_at = started_at + 30
    changed_file = tmp_path / "report.csv"
    changed_file.write_text("report", encoding="utf-8")
    os.utime(changed_file, (started_at + 10, started_at + 10))
    snapshot = SimpleNamespace(
        project_id="project-1",
        task_output_root=str(tmp_path / "outputs"),
        working_directory=str(tmp_path),
        task_start_time=started_at,
        artifact_manifest=None,
    )
    resolver = MagicMock()
    resolver.store.get_snapshot.return_value = snapshot
    journal = MagicMock()
    journal.get_run.return_value = SimpleNamespace(
        project_id="project-1",
        status="completed",
        created_at=started_at,
        updated_at=ended_at,
    )
    journal.list_run_attempts.return_value = [
        SimpleNamespace(started_at=started_at, ended_at=ended_at)
    ]
    monkeypatch.setattr(
        file_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        file_controller, "get_default_run_journal", lambda: journal
    )

    app = FastAPI()
    app.include_router(file_controller.router)
    client = TestClient(app, client=("127.0.0.1", 50000))
    response = client.get(
        "/files/changes",
        params={
            "task_id": "task-1",
            "project_id": "project-1",
            "email": "user@example.com",
        },
        headers={LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert [item["relativePath"] for item in body["artifacts"]] == [
        "report.csv"
    ]
    assert body["scan_status"] == "complete"
    assert body["truncated"] is False
    resolver.store.freeze_artifact_manifest.assert_called_once_with(
        "user@example.com", snapshot, body["artifacts"]
    )


def test_task_changes_endpoint_reads_canonical_manifest_without_filesystem_scan(
    monkeypatch,
):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    resolver = MagicMock()
    journal = MagicMock()
    journal.get_run_artifact_manifest_event.return_value = SimpleNamespace(
        payload={
            "scan_status": "complete",
            "artifacts": [
                {
                    "artifact_id": "art-1",
                    "filename": "report.csv",
                    "path": "/workspace/report.csv",
                    "relativePath": "report.csv",
                    "changeType": "generated",
                    "size": 12,
                    "modifiedAt": 1234,
                    "supportsRanges": True,
                }
            ],
        }
    )
    monkeypatch.setattr(
        file_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        file_controller, "get_default_run_journal", lambda: journal
    )
    monkeypatch.setattr(
        file_controller,
        "_list_task_changed_files",
        MagicMock(side_effect=AssertionError("filesystem scan must not run")),
    )

    app = FastAPI()
    app.include_router(file_controller.router)
    client = TestClient(app, client=("127.0.0.1", 50000))
    response = client.get(
        "/files/changes",
        params={
            "task_id": "task-1",
            "project_id": "project-1",
            "email": "user@example.com",
        },
        headers={LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"},
    )

    assert response.status_code == 200
    assert response.json()["artifacts"][0]["artifact_id"] == "art-1"
    assert response.json()["scan_status"] == "complete"
    assert response.json()["truncated"] is False
    resolver.store.get_snapshot.assert_not_called()


def test_task_changes_treats_unavailable_manifest_as_finalized_history(
    monkeypatch,
):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    resolver = MagicMock()
    journal = MagicMock()
    journal.get_run_artifact_manifest_event.return_value = SimpleNamespace(
        payload={
            "scan_status": "workspace_unavailable",
            "artifacts": [],
        }
    )
    monkeypatch.setattr(
        file_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        file_controller, "get_default_run_journal", lambda: journal
    )

    app = FastAPI()
    app.include_router(file_controller.router)
    client = TestClient(app, client=("127.0.0.1", 50000))
    response = client.get(
        "/files/changes",
        params={
            "task_id": "task-1",
            "project_id": "project-1",
            "email": "user@example.com",
        },
        headers={LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "artifacts": [],
        "scan_status": "workspace_unavailable",
        "truncated": False,
    }
    resolver.store.get_snapshot.assert_not_called()


def test_stream_file_supports_byte_ranges(monkeypatch, tmp_path):
    project_root = tmp_path / "project"
    project_root.mkdir()
    payload = b"0123456789"
    (project_root / "report.pdf").write_bytes(payload)
    monkeypatch.setattr(
        file_controller,
        "_resolve_file_root",
        lambda *_args, **_kwargs: project_root,
    )

    app = FastAPI()
    app.include_router(file_controller.router)
    client = TestClient(app)
    response = client.get(
        "/files/stream",
        params={
            "path": "report.pdf",
            "project_id": "project-1",
            "email": "user@example.com",
        },
        headers={"Range": "bytes=2-5"},
    )

    assert response.status_code == 206
    assert response.content == b"2345"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-range"] == "bytes 2-5/10"

    head = client.head(
        "/files/stream",
        params={
            "path": "report.pdf",
            "project_id": "project-1",
            "email": "user@example.com",
        },
    )
    assert head.status_code == 200
    assert head.content == b""
    assert head.headers["content-length"] == str(len(payload))
    assert head.headers["accept-ranges"] == "bytes"


def test_task_changes_endpoint_requires_local_capability(
    monkeypatch, tmp_path
):
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
    journal = MagicMock()
    journal.get_run.return_value = None
    monkeypatch.setattr(
        file_controller, "get_workspace_resolver", lambda: resolver
    )
    monkeypatch.setattr(
        file_controller, "get_default_run_journal", lambda: journal
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
    assert response.json() == {
        "artifacts": [],
        "scan_status": "complete",
        "truncated": False,
    }
