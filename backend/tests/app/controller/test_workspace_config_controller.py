from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.local_control import LOCAL_CONTROL_CAPABILITY_HEADER
from app.controller import workspace_config_controller
from app.router import register_routers
from app.run_journal import SQLiteRunJournal


@dataclass
class _Binding:
    workspace_root: str


class _BindingStore:
    def __init__(self, root: str) -> None:
        self.root = root

    def get_binding(self, _email, _space_id, _user_id):
        return _Binding(workspace_root=self.root)


class _Resolver:
    def __init__(self, root: str) -> None:
        self.store = _BindingStore(root)


@pytest.fixture
def workspace_config_api(tmp_path, monkeypatch):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    resolver = _Resolver(str(tmp_path / "space"))
    monkeypatch.setattr(
        workspace_config_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    monkeypatch.setattr(
        workspace_config_controller,
        "get_workspace_resolver",
        lambda: resolver,
    )
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "test-secret")
    app = FastAPI()
    register_routers(app, prefix="/api/v1")
    client = TestClient(app, client=("127.0.0.1", 50000))
    try:
        yield client, journal
    finally:
        client.close()
        journal.close()


def _headers() -> dict[str, str]:
    return {LOCAL_CONTROL_CAPABILITY_HEADER: "test-secret"}


def _get(client: TestClient):
    return client.get(
        "/api/v1/spaces/space-1/workspace-configuration",
        params={"email": "user@example.com", "name": "Research Space"},
        headers=_headers(),
    )


def test_workspace_configuration_requires_renderer_capability(
    workspace_config_api,
):
    client, _ = workspace_config_api

    response = client.get(
        "/api/v1/spaces/space-1/workspace-configuration",
        params={"email": "user@example.com"},
    )

    assert response.status_code == 401


def test_workspace_configuration_autosaves_with_version_cas(
    workspace_config_api,
):
    client, journal = workspace_config_api
    response = _get(client)
    assert response.status_code == 200
    initial = response.json()
    assert initial["version"] == 0
    assert initial["persisted"] is False
    assert initial["document"]["metadata"]["name"] == "Research Space"
    assert "/Users/" not in response.text

    document = initial["document"]
    document["metadata"]["name"] = "Research Team"
    body = {
        "expected_version": 0,
        "base_revision_id": initial["base_revision_id"],
        "document": document,
        "updated_by": "user-1",
        "email": "user@example.com",
    }
    saved = client.put(
        "/api/v1/spaces/space-1/workspace-configuration",
        json=body,
        headers=_headers(),
    )

    assert saved.status_code == 200
    assert saved.json()["version"] == 1
    assert saved.json()["persisted"] is True
    assert journal.get_workspace_config_draft("space-1") is not None

    stale = client.put(
        "/api/v1/spaces/space-1/workspace-configuration",
        json=body,
        headers=_headers(),
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "workspace_configuration_changed"


def test_workspace_configuration_rejects_invalid_manifest_without_persisting(
    workspace_config_api,
):
    client, journal = workspace_config_api
    initial = _get(client).json()
    initial["document"]["metadata"]["name"] = ""

    response = client.put(
        "/api/v1/spaces/space-1/workspace-configuration",
        json={
            "expected_version": 0,
            "base_revision_id": initial["base_revision_id"],
            "document": initial["document"],
            "updated_by": "user-1",
            "email": "user@example.com",
        },
        headers=_headers(),
    )

    assert response.status_code == 422
    assert (
        response.json()["detail"]["code"]
        == "workspace_configuration_invalid"
    )
    assert journal.get_workspace_config_draft("space-1") is None
