from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.auth.brain_auth import with_brain_auth_provider
from app.auth.interface import IAuthProvider
from app.auth.local_control import (
    LOCAL_CONTROL_CAPABILITY_HEADER,
    require_local_control_principal,
)
from app.controller import remote_command_controller, run_controller


class _VerifiedAuth(IAuthProvider):
    async def authenticate(self, scope):
        _ = scope
        return {"user_id": "user-1", "tenant_id": "tenant-1"}


class _UnexpectedCloudAuth(IAuthProvider):
    async def authenticate(self, scope):
        _ = scope
        raise AssertionError("Desktop capability must not invoke Cloud auth")


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/control")
    async def control(request: Request):
        return await require_local_control_principal(request)

    return app


def test_electron_control_requires_matching_loopback_capability(monkeypatch):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    client = TestClient(_app(), client=("127.0.0.1", 50000))

    assert client.get("/control").status_code == 401
    assert (
        client.get(
            "/control", headers={LOCAL_CONTROL_CAPABILITY_HEADER: "wrong"}
        ).status_code
        == 401
    )
    response = client.get(
        "/control", headers={LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"}
    )
    assert response.status_code == 200
    assert response.json()["kind"] == "desktop_renderer"


def test_device_and_link_identity_do_not_replace_renderer_capability(monkeypatch):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    client = TestClient(_app(), client=("127.0.0.1", 50000))

    response = client.get(
        "/control",
        headers={
            "Authorization": "Bearer cloud-user-token",
            "X-Desktop-Instance-ID": "device-1",
            "X-Remote-Control-Token": "link-1",
        },
    )

    assert response.status_code == 401


def test_desktop_capability_is_independent_from_cloud_auth(monkeypatch):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    client = TestClient(_app(), client=("127.0.0.1", 50000))

    with with_brain_auth_provider(_UnexpectedCloudAuth()):
        response = client.get(
            "/control",
            headers={LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"},
        )

    assert response.status_code == 200


def test_electron_control_fails_closed_when_capability_is_missing(monkeypatch):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.delenv("EIGENT_LOCAL_CONTROL_CAPABILITY", raising=False)

    response = TestClient(_app()).get(
        "/control", headers={"Authorization": "Bearer cloud-user-token"}
    )

    assert response.status_code == 503


def test_non_loopback_cannot_use_desktop_capability(monkeypatch):
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    client = TestClient(_app(), client=("203.0.113.8", 50000))

    response = client.get(
        "/control", headers={LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"}
    )

    assert response.status_code == 403


def test_rotated_desktop_capability_rejects_the_previous_process_token(
    monkeypatch,
):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "startup-1")
    client = TestClient(_app(), client=("127.0.0.1", 50000))
    assert (
        client.get(
            "/control",
            headers={LOCAL_CONTROL_CAPABILITY_HEADER: "startup-1"},
        ).status_code
        == 200
    )

    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "startup-2")

    assert (
        client.get(
            "/control",
            headers={LOCAL_CONTROL_CAPABILITY_HEADER: "startup-1"},
        ).status_code
        == 401
    )
    assert (
        client.get(
            "/control",
            headers={LOCAL_CONTROL_CAPABILITY_HEADER: "startup-2"},
        ).status_code
        == 200
    )


def test_non_electron_control_requires_brain_authorization(monkeypatch):
    monkeypatch.delenv("EIGENT_RUNTIME", raising=False)
    monkeypatch.delenv("EIGENT_LOCAL_CONTROL_CAPABILITY", raising=False)
    client = TestClient(_app())

    assert client.get("/control").status_code == 503
    assert (
        client.get(
            "/control", headers={"Authorization": "Bearer unverified-token"}
        ).status_code
        == 503
    )
    with with_brain_auth_provider(_VerifiedAuth()):
        assert client.get("/control").status_code == 401
        response = client.get(
            "/control", headers={"Authorization": "Bearer verified-token"}
        )
        assert response.status_code == 200
        assert response.json()["kind"] == "brain_user"


def test_run_and_command_routers_enforce_the_control_principal(monkeypatch):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    app = FastAPI()
    app.include_router(run_controller.router)
    app.include_router(remote_command_controller.router)
    client = TestClient(app, client=("127.0.0.1", 50000))
    journal = MagicMock()
    journal.get_run.return_value = None
    journal.list_reconcilable_commands.return_value = []

    assert client.get("/runs/missing").status_code == 401
    assert client.get("/remote-control/commands/inbox/pending").status_code == 401
    with (
        patch(
            "app.controller.run_controller.get_default_run_journal",
            return_value=journal,
        ),
        patch(
            "app.controller.remote_command_controller.get_default_run_journal",
            return_value=journal,
        ),
    ):
        headers = {LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"}
        assert client.get("/runs/missing", headers=headers).status_code == 404
        response = client.get(
            "/remote-control/commands/inbox/pending", headers=headers
        )
        assert response.status_code == 200
        assert response.json() == {"items": []}
