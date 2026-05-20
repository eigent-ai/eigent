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

import asyncio
import json
import os
import time
from pathlib import Path

import pytest

from app.service.upload.service import (
    BrainUploadService,
    FullUploadContext,
    SkippedUploadContext,
    UploadState,
)


@pytest.mark.unit
def test_skipped_upload_state_is_pruned(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("WORKSPACE_UPLOAD_STATE_TTL_SECONDS", "1")
    service = BrainUploadService()
    service.register_and_start(
        SkippedUploadContext(
            task_id="task-1",
            project_id="project-1",
            email="alice@example.com",
            session_id="sess_ok",
            skip_reason="no_authorization",
        ),
        "task-1",
    )

    state = service.get_state("task-1")
    assert state is not None
    state.completed_at = time.time() - 5

    assert service.get_state("task-1") is None


@pytest.mark.unit
def test_workspace_file_mtime_uses_epsilon(tmp_path: Path):
    service = BrainUploadService()
    root = tmp_path / "workspace"
    root.mkdir()
    task_start = time.time()
    recent = root / "recent.txt"
    recent.write_text("recent", encoding="utf-8")
    old = root / "old.txt"
    old.write_text("old", encoding="utf-8")
    internal_note = root / ".note_register"
    internal_note.write_text("internal", encoding="utf-8")
    os.utime(recent, (task_start - 1, task_start - 1))
    os.utime(old, (task_start - 10, task_start - 10))
    os.utime(internal_note, (task_start - 1, task_start - 1))
    ctx = FullUploadContext(
        task_id="task-1",
        project_id="project-1",
        email="alice@example.com",
        session_id="sess_ok",
        server_url="http://localhost:3001/api/v1",
        authorization="Bearer token",
        task_output_root=root,
        task_start_time=task_start,
        camel_log_dir=tmp_path / "logs",
        user_upload_ids=(),
    )
    state = UploadState.from_context(ctx)

    paths = list(service._enumerate_workspace_files(ctx, state))

    assert recent in paths
    assert old not in paths
    assert internal_note not in paths


@pytest.mark.unit
def test_http_client_is_reused():
    service = BrainUploadService()

    first = service._get_http_client()
    second = service._get_http_client()

    assert first is second
    asyncio.run(service.close())


@pytest.mark.unit
def test_workspace_upload_uses_task_id(tmp_path: Path):
    class _Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {"s3_key": "remote/key.txt"}

    class _Client:
        def __init__(self) -> None:
            self.data: dict[str, str] | None = None

        async def post(self, *_args, data=None, **_kwargs):
            self.data = data
            return _Response()

    service = BrainUploadService()
    client = _Client()
    service._get_http_client = lambda: client  # type: ignore[method-assign]
    source = tmp_path / "report.py"
    source.write_text("print('hello')", encoding="utf-8")
    ctx = FullUploadContext(
        task_id="task-1",
        project_id="project-1",
        email="alice@example.com",
        session_id="sess_ok",
        server_url="http://localhost:3001/api/v1",
        authorization="Bearer token",
        task_output_root=tmp_path,
        task_start_time=time.time(),
        camel_log_dir=tmp_path / "logs",
        user_upload_ids=(),
    )

    remote_key = asyncio.run(
        service._upload_to_server(ctx, source, source.name)
    )

    assert client.data == {"task_id": "task-1"}
    assert remote_key == "remote/key.txt"


@pytest.mark.unit
def test_artifact_manifest_is_written_and_uploaded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    class _Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {"s3_key": "remote/manifest.json"}

    class _Client:
        async def post(self, *_args, **_kwargs):
            return _Response()

    monkeypatch.setattr(
        "app.service.upload.service.workspace_state_root",
        lambda _email: tmp_path / "state",
    )
    service = BrainUploadService()
    service._get_http_client = lambda: _Client()  # type: ignore[method-assign]
    ctx = FullUploadContext(
        task_id="task-1",
        project_id="project-1",
        email="alice@example.com",
        session_id="sess_ok",
        server_url="http://localhost:3001/api/v1",
        authorization="Bearer token",
        task_output_root=tmp_path / "workspace",
        task_start_time=time.time(),
        camel_log_dir=tmp_path / "logs",
        user_upload_ids=(),
    )
    state = UploadState.from_context(ctx)

    asyncio.run(service._upload_artifact_manifest(ctx, state))

    manifest_path = tmp_path / "state" / "tasks" / "task-1.artifacts.json"
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert data["task_id"] == "task-1"
    assert data["project_id"] == "project-1"
    assert data["items"][0]["kind"] == "artifact_manifest"
    assert data["items"][0]["remote_key"] == "remote/manifest.json"
