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

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.auth import LocalControlPrincipal, require_local_control_principal
from app.controller import recording_controller as controller
from app.recording import runtime
from app.recording.models import RecordingScope
from app.recording.service import RecordingService
from app.recording.store import RecordingStore


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    space = tmp_path / "space"
    space.mkdir()
    spool = tmp_path / "spool"
    spool.mkdir()
    scope = RecordingScope(
        "desktop_renderer:local",
        "user_7",
        "space",
        "project",
        "run",
        "run",
        None,
        space,
        "v1",
    )
    service = RecordingService(
        RecordingStore(tmp_path / "catalog.sqlite3"),
        scope_resolver=lambda *args: scope,
        binding_check=lambda row: True,
        run_check=lambda run: (True, None),
    )
    monkeypatch.setattr(runtime, "_service", service)
    monkeypatch.setattr(runtime, "_bootstrap", "main-only-secret")
    api = FastAPI()
    api.include_router(controller.router)
    api.dependency_overrides[require_local_control_principal] = (
        lambda: LocalControlPrincipal("desktop_renderer", "local")
    )
    client = TestClient(api, client=("127.0.0.1", 50000))
    return client, service, spool, api


def test_direct_headless_api_start_status_stop_and_listing(fixture):
    client, service, spool, _ = fixture
    assert (
        client.get("/recordings/capabilities").json()["reason"]
        == "provider_unavailable"
    )
    main = {"X-Eigent-Recording-Bootstrap": "main-only-secret"}
    assert (
        client.post(
            "/recording-adapter/register",
            json={"instance": "fixture", "spool_root": str(spool)},
            headers=main,
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/recordings",
            json={
                "run_id": "run",
                "grant_id": "missing",
                "idempotency_key": "no-grant",
            },
        ).status_code
        == 412
    )
    assert service.store.all() == []
    grant = client.post(
        "/recording-adapter/grant", json={"run_id": "run"}, headers=main
    ).json()["grant_id"]
    response = client.post(
        "/recordings",
        json={"run_id": "run", "grant_id": grant, "idempotency_key": "yes"},
    )
    assert response.status_code == 200
    row = response.json()
    assert row["state"] == "starting"
    assert client.get("/recordings/" + row["id"]).json()["id"] == row["id"]
    assert (
        len(client.get("/recordings?space_id=space").json()["recordings"]) == 1
    )
    assert (
        client.get("/recordings?space_id=another").json()["recordings"] == []
    )
    assert (
        client.post("/recordings/" + row["id"] + "/stop").json()["state"]
        == "stopping"
    )
    assert (
        client.post("/recordings/" + row["id"] + "/stop").json()["state"]
        == "stopping"
    )
    serialized = json.dumps(row)
    assert "main-only-secret" not in serialized
    assert grant not in serialized


def test_adapter_credentials_are_separate_from_client_control(fixture):
    client, service, spool, _ = fixture
    assert (
        client.post(
            "/recording-adapter/grant", json={"run_id": "run"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/recording-adapter/register",
            json={"instance": "fixture", "spool_root": str(spool)},
            headers={"X-Eigent-Local-Capability": "main-only-secret"},
        ).status_code
        == 401
    )
    assert (
        client.get(
            "/recording-adapter/commands",
            headers={"X-Eigent-Recording-Provider": "forged"},
        ).status_code
        == 401
    )
    assert service.provider is None


def test_public_routes_require_real_control_auth(fixture):
    client, _, _, api = fixture
    api.dependency_overrides.clear()
    assert client.get("/recordings").status_code in {401, 503}
    assert client.get("/recordings/capabilities").status_code in {401, 503}
    assert client.post(
        "/recordings",
        json={"run_id": "run", "grant_id": "x", "idempotency_key": "x"},
    ).status_code in {401, 503}


@pytest.mark.asyncio
async def test_command_stream_leases_and_disconnect_fences_generation(fixture):
    _, service, spool, _ = fixture
    service.register("fixture", str(spool))
    provider = service.provider
    grant = service.authorize("run", "desktop_renderer:local")["grant_id"]
    row = service.start("run", "desktop_renderer:local", grant, "stream")
    request = Request(
        {"type": "http", "client": ("127.0.0.1", 1), "headers": []},
        receive=lambda: None,
    )

    async def not_disconnected():
        return False

    request.is_disconnected = not_disconnected
    response = await controller.commands(request, provider)
    payload = await response.body_iterator.__anext__()
    command = json.loads(payload.split("data: ", 1)[1])
    assert command["recording_id"] == row["id"]
    assert command["action"] == "start"
    assert "root" not in command and "token" not in command
    with pytest.raises(Exception, match="provider_stream_exists"):
        await controller.commands(request, provider)
    await response.body_iterator.aclose()
    assert service.provider is None
    assert service.store.get(row["id"])["state"] == "interrupted"
