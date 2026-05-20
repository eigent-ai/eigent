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

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import app.utils.workspace_resolver as workspace_resolver_module
from app.controller.workspace_controller import router
from app.model.chat import Status
from app.service.task import get_or_create_task_lock, task_locks


class DummyHands:
    def __init__(
        self,
        deployment: str = "local",
        validation: tuple[bool, str | None] = (True, None),
    ) -> None:
        self.deployment = deployment
        self.validation = validation

    def get_capability_manifest(self) -> dict[str, Any]:
        return {
            "deployment": self.deployment,
            "filesystem": "full",
            "workspace_root": "/tmp/workspace",
        }

    def validate_workspace_binding_path(
        self, path: str
    ) -> tuple[bool, str | None]:
        return self.validation

    def can_access_filesystem(self, path: str) -> bool:
        return self.validation[0]


def _client(hands: DummyHands) -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def _inject_state(request: Request, call_next):
        request.state.hands = hands
        request.state.session_id = "sess_test"
        return await call_next(request)

    app.include_router(router)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_workspace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[None]:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(workspace_resolver_module, "_resolver", None)
    task_locks.clear()
    yield
    task_locks.clear()
    monkeypatch.setattr(workspace_resolver_module, "_resolver", None)


@pytest.mark.unit
def test_capabilities_do_not_advertise_folder_chooser():
    response = _client(DummyHands()).get("/workspace/capabilities")

    assert response.status_code == 200
    data = response.json()
    assert data["binding_enabled"] is True
    assert data["label"] == "Local Brain"
    assert "folder_chooser" not in data


@pytest.mark.unit
def test_bind_disabled_for_cloud_workspace(tmp_path: Path):
    folder = tmp_path / "project"
    folder.mkdir()

    response = _client(DummyHands(deployment="cloud_vm")).post(
        "/workspace/bind",
        json={
            "project_id": "project-1",
            "email": "alice@example.com",
            "path": str(folder),
        },
    )

    assert response.status_code == 412
    assert response.json()["detail"]["code"] == "workspace_binding_disabled"


@pytest.mark.unit
def test_bind_rejects_active_task(tmp_path: Path):
    folder = tmp_path / "project"
    folder.mkdir()
    lock = get_or_create_task_lock("project-1")
    lock.status = Status.processing

    response = _client(DummyHands()).post(
        "/workspace/bind",
        json={
            "project_id": "project-1",
            "email": "alice@example.com",
            "path": str(folder),
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "active_task_exists"


@pytest.mark.unit
def test_bind_maps_sensitive_path_to_forbidden(tmp_path: Path):
    folder = tmp_path / "project"
    folder.mkdir()

    response = _client(
        DummyHands(validation=(False, f"sensitive_path:{folder}"))
    ).post(
        "/workspace/bind",
        json={
            "project_id": "project-1",
            "email": "alice@example.com",
            "path": str(folder),
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"]["reason"].startswith("sensitive_path:")


@pytest.mark.unit
def test_bind_maps_invalid_folder_to_bad_request(tmp_path: Path):
    missing = tmp_path / "missing"

    response = _client(DummyHands(validation=(False, "path_not_found"))).post(
        "/workspace/bind",
        json={
            "project_id": "project-1",
            "email": "alice@example.com",
            "path": str(missing),
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["reason"] == "path_not_found"


@pytest.mark.unit
def test_bind_current_and_delete_is_not_allowed(tmp_path: Path):
    folder = tmp_path / "project"
    folder.mkdir()
    client = _client(DummyHands())

    bind_response = client.post(
        "/workspace/bind",
        json={
            "project_id": "project-1",
            "email": "alice@example.com",
            "path": str(folder),
        },
    )
    assert bind_response.status_code == 200
    assert bind_response.json()["workspace_root"] == str(folder.resolve())

    current_response = client.get(
        "/workspace/current",
        params={"project_id": "project-1", "email": "alice@example.com"},
    )
    assert current_response.status_code == 200
    assert current_response.json()["bound"] is True

    delete_response = client.delete(
        "/workspace/bind",
        params={"project_id": "project-1", "email": "alice@example.com"},
    )
    assert delete_response.status_code == 405

    current_after_delete_response = client.get(
        "/workspace/current",
        params={"project_id": "project-1", "email": "alice@example.com"},
    )
    assert current_after_delete_response.status_code == 200
    assert current_after_delete_response.json()["bound"] is True


@pytest.mark.unit
def test_bind_same_project_to_new_folder_is_rejected(tmp_path: Path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    client = _client(DummyHands())

    bind_response = client.post(
        "/workspace/bind",
        json={
            "project_id": "project-1",
            "email": "alice@example.com",
            "path": str(first),
        },
    )
    assert bind_response.status_code == 200

    same_response = client.post(
        "/workspace/bind",
        json={
            "project_id": "project-1",
            "email": "alice@example.com",
            "path": str(first),
        },
    )
    assert same_response.status_code == 200

    changed_response = client.post(
        "/workspace/bind",
        json={
            "project_id": "project-1",
            "email": "alice@example.com",
            "path": str(second),
        },
    )

    assert changed_response.status_code == 409
    assert (
        changed_response.json()["detail"]["code"] == "workspace_already_bound"
    )
