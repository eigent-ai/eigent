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
        response.json()["detail"]["code"] == "workspace_configuration_invalid"
    )
    assert journal.get_workspace_config_draft("space-1") is None


def test_workspace_configuration_review_never_returns_local_secret_values(
    workspace_config_api, monkeypatch
):
    client, _ = workspace_config_api
    initial = _get(client).json()
    initial["document"]["spec"]["mcpServers"] = [
        {
            "id": "github",
            "definition": "registry://mcp/github@1",
            "secretSlots": [],
            "assignTo": [],
        }
    ]
    saved = client.put(
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
    assert saved.status_code == 200
    sentinel = "never-return-this-secret"
    monkeypatch.setattr(
        workspace_config_controller,
        "read_mcp_config",
        lambda: {
            "mcpServers": {"github": {"env": {"GITHUB_TOKEN": sentinel}}}
        },
    )

    response = client.get(
        "/api/v1/spaces/space-1/workspace-configuration/review",
        params={"email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 200
    assert sentinel not in response.text
    assert (
        response.json()["review"]["requirements"][
            "suggested_environment_variables"
        ][0]["name"]
        == "GITHUB_TOKEN"
    )


def test_workspace_configuration_asset_preflight_blocks_secret_before_cloud(
    workspace_config_api,
):
    client, _ = workspace_config_api

    rejected_assets = (
        ("bundle://config/.env", ".env", b"API_TOKEN=private"),
        (
            "bundle://config/settings.json",
            "settings.json",
            b'{"api_key":"low-entropy-real-secret"}',
        ),
        (
            "bundle://config/encoded.txt",
            "encoded.txt",
            b"QVBJX1RPS0VOPWxvdy1lbnRyb3B5LXJlYWwtc2VjcmV0",
        ),
    )
    rejected = [
        client.post(
            "/api/v1/spaces/space-1/workspace-configuration/asset-preflight",
            params={"email": "user@example.com"},
            data={"logical_path": logical_path},
            files={"file": (filename, content, "text/plain")},
            headers=_headers(),
        )
        for logical_path, filename, content in rejected_assets
    ]
    accepted = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/asset-preflight",
        params={"email": "user@example.com"},
        data={"logical_path": "bundle://instructions/coordinator.md"},
        files={
            "file": (
                "coordinator.md",
                b"Coordinate the research safely.",
                "text/markdown",
            )
        },
        headers=_headers(),
    )

    assert all(response.status_code == 422 for response in rejected)
    assert accepted.status_code == 200
    assert accepted.json()["content_digest"] == (
        "a613c9e20970b8e66d1d94fa12f1f1726e7a6099ddba830c2628d37b3541e984"
    )


def test_workspace_configuration_records_only_verified_cloud_publish(
    workspace_config_api, monkeypatch
):
    client, journal = workspace_config_api
    initial = _get(client).json()
    saved = client.put(
        "/api/v1/spaces/space-1/workspace-configuration",
        json={
            "expected_version": 0,
            "base_revision_id": initial["base_revision_id"],
            "document": initial["document"],
            "updated_by": "user-1",
            "email": "user@example.com",
        },
        headers=_headers(),
    ).json()

    class _Cloud:
        async def get_revision(self, bundle_id, revision_id):
            assert bundle_id == saved["document"]["metadata"]["id"]
            return {
                "id": revision_id,
                "status": "published",
                "manifest_digest": saved["document_digest"],
                "manifest": saved["document"],
            }

        async def close(self):
            return None

    monkeypatch.setattr(
        workspace_config_controller,
        "_authoring_cloud",
        lambda _authorization: _Cloud(),
    )
    response = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/published",
        json={
            "expected_version": saved["version"],
            "revision_id": (
                f"{saved['document']['metadata']['id']}@"
                f"{saved['document']['metadata']['revision']}"
            ),
            "manifest_digest": saved["document_digest"],
            "actor_id": "user-1",
            "email": "user@example.com",
        },
        headers={**_headers(), "Authorization": "Bearer cloud-token"},
    )

    assert response.status_code == 200
    assert response.json()["revision"]["status"] == "published"
    assert response.json()["draft"]["document"]["metadata"]["revision"] == 2
    assert (
        journal.get_latest_workspace_config_materialization("space-1") is None
    )


def test_workspace_configuration_recovers_cloud_publish_after_local_edit(
    workspace_config_api, monkeypatch
):
    client, journal = workspace_config_api
    initial = _get(client).json()
    first = client.put(
        "/api/v1/spaces/space-1/workspace-configuration",
        json={
            "expected_version": 0,
            "base_revision_id": initial["base_revision_id"],
            "document": initial["document"],
            "updated_by": "user-1",
            "email": "user@example.com",
        },
        headers=_headers(),
    ).json()
    edited_document = dict(first["document"])
    edited_document["metadata"] = {
        **first["document"]["metadata"],
        "name": "Edited while publish response was lost",
    }
    edited = client.put(
        "/api/v1/spaces/space-1/workspace-configuration",
        json={
            "expected_version": first["version"],
            "base_revision_id": first["base_revision_id"],
            "document": edited_document,
            "updated_by": "user-2",
            "email": "user@example.com",
        },
        headers=_headers(),
    ).json()
    revision_id = (
        f"{first['document']['metadata']['id']}@"
        f"{first['document']['metadata']['revision']}"
    )

    class _Cloud:
        async def get_revision(self, _bundle_id, _revision_id):
            return {
                "id": revision_id,
                "status": "published",
                "manifest_digest": first["document_digest"],
                "manifest": first["document"],
            }

        async def close(self):
            return None

    monkeypatch.setattr(
        workspace_config_controller,
        "_authoring_cloud",
        lambda _authorization: _Cloud(),
    )
    response = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/published",
        json={
            "expected_version": first["version"],
            "revision_id": revision_id,
            "manifest_digest": first["document_digest"],
            "actor_id": "user-1",
            "email": "user@example.com",
        },
        headers={**_headers(), "Authorization": "Bearer cloud-token"},
    )

    assert response.status_code == 200
    rebased = response.json()["draft"]
    assert rebased["version"] == edited["version"] + 1
    assert rebased["base_revision_id"] == revision_id
    assert rebased["document"]["metadata"] == {
        **edited_document["metadata"],
        "revision": 2,
    }
    assert (
        journal.get_workspace_config_revision(revision_id).manifest
        == first["document"]
    )


@pytest.mark.parametrize(
    ("cloud_status", "cloud_id", "cloud_digest"),
    [
        ("validated", None, None),
        ("published", "other_bundle@1", None),
        ("published", None, "f" * 64),
    ],
)
def test_workspace_configuration_rejects_unverified_cloud_publish_receipt(
    workspace_config_api,
    monkeypatch,
    cloud_status,
    cloud_id,
    cloud_digest,
):
    client, journal = workspace_config_api
    initial = _get(client).json()
    saved = client.put(
        "/api/v1/spaces/space-1/workspace-configuration",
        json={
            "expected_version": 0,
            "base_revision_id": initial["base_revision_id"],
            "document": initial["document"],
            "updated_by": "user-1",
            "email": "user@example.com",
        },
        headers=_headers(),
    ).json()
    revision_id = (
        f"{saved['document']['metadata']['id']}@"
        f"{saved['document']['metadata']['revision']}"
    )

    class _Cloud:
        async def get_revision(self, _bundle_id, _revision_id):
            return {
                "id": cloud_id or revision_id,
                "status": cloud_status,
                "manifest_digest": cloud_digest or saved["document_digest"],
                "manifest": saved["document"],
            }

        async def close(self):
            return None

    monkeypatch.setattr(
        workspace_config_controller,
        "_authoring_cloud",
        lambda _authorization: _Cloud(),
    )
    response = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/published",
        json={
            "expected_version": saved["version"],
            "revision_id": revision_id,
            "manifest_digest": saved["document_digest"],
            "actor_id": "user-1",
            "email": "user@example.com",
        },
        headers={**_headers(), "Authorization": "Bearer cloud-token"},
    )

    assert response.status_code == 409
    assert journal.get_workspace_config_revision(revision_id) is None
    assert journal.get_workspace_config_draft("space-1").version == 1
    assert (
        journal.get_latest_workspace_config_materialization("space-1") is None
    )
