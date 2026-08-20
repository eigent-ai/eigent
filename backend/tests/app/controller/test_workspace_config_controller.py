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

from __future__ import annotations

import json
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.local_control import LOCAL_CONTROL_CAPABILITY_HEADER
from app.controller import workspace_config_controller
from app.router import register_routers
from app.run_journal import SQLiteRunJournal
from app.workspace_bundle.agent_plugins import MCP_SCHEMA, PLUGIN_SCHEMA


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


class _TestHands:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def can_access_filesystem(self, path: str) -> bool:
        try:
            Path(path).expanduser().resolve().relative_to(self.root)
            return True
        except (OSError, RuntimeError, ValueError):
            return False


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
    monkeypatch.setattr(
        workspace_config_controller,
        "get_environment_hands",
        lambda: _TestHands(tmp_path),
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


def _agent_plugin(root: Path, *, schema: str = PLUGIN_SCHEMA) -> Path:
    root.mkdir()
    (root / "skills" / "research").mkdir(parents=True)
    (root / "bin").mkdir()
    (root / "plugin.json").write_text(
        json.dumps(
            {
                "$schema": schema,
                "name": "research-plugin",
                "version": "1.2.3",
                "author": {"name": "Example Author"},
                "extensions": {
                    "ai.eigent": {
                        "mcpSecretRequirements": [
                            {
                                "serverId": "local",
                                "location": "env",
                                "name": "API_TOKEN",
                                "slotId": "mcp.local.env.api_token",
                            }
                        ]
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    (root / "skills" / "research" / "SKILL.md").write_text(
        "---\nname: research\ndescription: Research safely\n---\nDo research.\n",
        encoding="utf-8",
    )
    executable = root / "bin" / "server"
    executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    executable.chmod(0o755)
    (root / "mcp.json").write_text(
        json.dumps(
            {
                "$schema": MCP_SCHEMA,
                "mcpServers": {
                    "local": {
                        "type": "stdio",
                        "command": "./bin/server",
                        "args": ["--root", "${PLUGIN_ROOT}"],
                        "env": {
                            "API_TOKEN": "source-only-value",
                            "LOG_LEVEL": "debug",
                        },
                        "cwd": "${PLUGIN_ROOT}",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    return root


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


def test_agent_plugin_inspect_and_convert_preserve_reviewed_assets(
    workspace_config_api,
    tmp_path,
):
    client, journal = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    request = {
        "source_path": str(source),
        "email": "user@example.com",
    }

    inspected = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json=request,
        headers=_headers(),
    )

    assert inspected.status_code == 200, inspected.text
    inspection = inspected.json()
    assert inspection["schema_version"] == "1.0.0"
    assert len(inspection["source_tree_digest"]) == 64
    assert inspection["skipped_skills"] == []
    assert inspection["skipped_mcp_servers"] == []
    assert inspection["skills"][0]["name"] == "research"
    mcp_server = inspection["mcp_servers"][0]
    assert mcp_server["id"] == "local"
    assert mcp_server["transport"] == "stdio"
    assert mcp_server["command"] == "./bin/server"
    assert mcp_server["args"] == ["--root", "${PLUGIN_ROOT}"]
    assert mcp_server["env_names"] == ["API_TOKEN", "LOG_LEVEL"]
    assert mcp_server["public_environment"][0]["name"] == "LOG_LEVEL"
    assert mcp_server["public_environment"][0]["value"] == "debug"
    assert mcp_server["credential_requirement_keys"] == [
        "mcp.local.env.api_token"
    ]
    assert "source-only-value" not in inspected.text
    executable = next(
        item
        for item in inspection["files"]
        if item["source_relative_path"] == "bin/server"
    )
    assert executable["executable"] is True

    conversion_request = {
        **request,
        "target_space_id": "space-1",
        "expected_review_digest": inspection["review_digest"],
        "expected_target_draft_version": 0,
        "client_request_id": "import-1",
        "updated_by": "user-1",
    }
    converted = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json=conversion_request,
        headers=_headers(),
    )
    assert converted.status_code == 200, converted.text
    payload = converted.json()
    assert payload == {
        "slug": "agent_plugin_research_plugin",
        "version": 1,
        "target_space_id": "space-1",
        "status": "draft",
    }
    draft = journal.get_workspace_config_draft("space-1")
    assert draft is not None
    assert draft.version == 1

    shutil.rmtree(source)
    replay = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json=conversion_request,
        headers=_headers(),
    )
    assert replay.status_code == 200, replay.text
    assert replay.json() == payload
    stored = journal.list_workspace_config_draft_assets(
        space_id="space-1",
        draft_version=1,
        document_digest=draft.document_digest,
    )
    stored_executable = next(
        item for item in stored if item.logical_path.endswith("/bin/server")
    )
    assert all(b"source-only-value" not in item.content for item in stored)
    assert b"source-only-value" not in journal.path.read_bytes()
    assert stored_executable.content == b"#!/bin/sh\nexit 0\n"
    assert stored_executable.executable is True

    edited_document = json.loads(json.dumps(draft.document))
    edited_document["metadata"]["name"] = "Edited imported plugin"
    autosaved = client.put(
        "/api/v1/spaces/space-1/workspace-configuration",
        json={
            "expected_version": 1,
            "base_revision_id": draft.base_revision_id,
            "document": edited_document,
            "updated_by": "user-1",
            "email": "user@example.com",
        },
        headers=_headers(),
    )
    assert autosaved.status_code == 200, autosaved.text
    edited = journal.get_workspace_config_draft("space-1")
    assert edited is not None
    carried = journal.list_workspace_config_draft_assets(
        space_id="space-1",
        draft_version=edited.version,
        document_digest=edited.document_digest,
    )
    assert [(item.logical_path, item.content_digest) for item in carried] == [
        (item.logical_path, item.content_digest) for item in stored
    ]

    revision_id = "wbr_22222222222222222222222222222222"
    _, rebased = journal.finalize_workspace_config_publish(
        space_id="space-1",
        expected_draft_version=edited.version,
        revision_id=revision_id,
        manifest_digest=edited.document_digest,
        published_manifest=edited.document,
        actor_id="user-1",
    )
    after_publish = journal.list_workspace_config_draft_assets(
        space_id="space-1",
        draft_version=rebased.version,
        document_digest=rebased.document_digest,
    )
    assert [
        (item.logical_path, item.content_digest) for item in after_publish
    ] == [(item.logical_path, item.content_digest) for item in stored]


def test_prepared_agent_plugin_assets_are_reviewed_preflighted_and_uploaded_from_sqlite(
    workspace_config_api,
    tmp_path,
    monkeypatch,
):
    client, journal = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    inspected = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    ).json()
    converted = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json={
            "source_path": str(source),
            "email": "user@example.com",
            "target_space_id": "space-1",
            "expected_review_digest": inspected["review_digest"],
            "expected_target_draft_version": 0,
            "client_request_id": "publish-import-1",
            "updated_by": "user-1",
        },
        headers=_headers(),
    )
    assert converted.status_code == 200, converted.text
    shutil.rmtree(source)

    review_response = client.get(
        "/api/v1/spaces/space-1/workspace-configuration/review",
        params={"email": "user@example.com"},
        headers=_headers(),
    )
    assert review_response.status_code == 200, review_response.text
    review_payload = review_response.json()
    review = review_payload["review"]
    prepared = review["prepared_assets"]
    assert {item["logical_path"].rsplit("/", 1)[-1] for item in prepared} == {
        "plugin.json",
        "SKILL.md",
        "server",
        "mcp.json",
    }
    assert all(
        "content" not in item and "source_path" not in item
        for item in prepared
    )
    executable = next(
        item
        for item in prepared
        if item["logical_path"].endswith("/bin/server")
    )
    assert executable["executable"] is True
    assert executable["provenance"] == "agent_plugin_import"

    draft = journal.get_workspace_config_draft("space-1")
    assert draft is not None
    pinned = {
        "expected_version": review_payload["draft_version"],
        "expected_manifest_digest": draft.document_digest,
        "expected_review_digest": review["review_digest"],
        "email": "user@example.com",
    }
    preflight = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/prepared-assets:preflight",
        json=pinned,
        headers=_headers(),
    )
    assert preflight.status_code == 200, preflight.text
    assert preflight.json()["assets"] == prepared
    assert "source-only-value" not in preflight.text

    uploaded: list[dict] = []
    cloud_receipts: list[dict] = []

    class _Cloud:
        async def resolve_owner_revision(self, slug, version):
            assert slug == draft.document["metadata"]["id"]
            assert version == 1
            return {
                "id": "wbr_11111111111111111111111111111111",
                "bundle_id": "wb_reviewed",
                "status": "published",
                "manifest_digest": draft.document_digest,
                "manifest": draft.document,
                "assets": cloud_receipts,
            }

        async def upload_asset(self, bundle_id, revision_id, **kwargs):
            content = kwargs.pop("content")
            descriptor = next(
                item
                for item in prepared
                if item["logical_path"] == kwargs["logical_path"]
            )
            assert bundle_id == "wb_reviewed"
            assert revision_id == "wbr_11111111111111111111111111111111"
            assert len(content) == descriptor["size_bytes"]
            assert kwargs["provenance"] == "agent_plugin_import"
            uploaded.append({"content": content, **kwargs})
            receipt = {
                "id": "asset_" + descriptor["content_digest"][:32],
                **descriptor,
                "logical_path": descriptor["logical_path"].removeprefix(
                    "bundle://"
                ),
            }
            cloud_receipts.append(receipt)
            return receipt

        async def get_owner_revision(self, bundle_id, revision_id):
            assert bundle_id == "wb_reviewed"
            assert revision_id == "wbr_11111111111111111111111111111111"
            return {
                "id": revision_id,
                "status": "published",
                "manifest_digest": draft.document_digest,
                "manifest": draft.document,
                "assets": cloud_receipts,
            }

        async def close(self):
            return None

    monkeypatch.setattr(
        workspace_config_controller,
        "_authoring_cloud",
        lambda _authorization: _Cloud(),
    )
    for descriptor in prepared:
        upload = client.post(
            "/api/v1/spaces/space-1/workspace-configuration/prepared-assets:upload",
            json={
                **pinned,
                "logical_path": descriptor["logical_path"],
                "content_digest": descriptor["content_digest"],
            },
            headers={**_headers(), "Authorization": "Bearer cloud-token"},
        )
        assert upload.status_code == 200, upload.text
        assert "content" not in upload.json()["asset"]
    assert [item["logical_path"] for item in uploaded] == [
        item["logical_path"] for item in prepared
    ]
    publish_payload = {
        "expected_version": draft.version,
        "revision_id": "wbr_11111111111111111111111111111111",
        "manifest_digest": draft.document_digest,
        "actor_id": "user-1",
        "email": "user@example.com",
    }
    original_executable = cloud_receipts[-1]["executable"]
    cloud_receipts[-1]["executable"] = not original_executable
    mismatched = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/published",
        json=publish_payload,
        headers={**_headers(), "Authorization": "Bearer cloud-token"},
    )
    assert mismatched.status_code == 409
    cloud_receipts[-1]["executable"] = original_executable
    recorded = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/published",
        json=publish_payload,
        headers={**_headers(), "Authorization": "Bearer cloud-token"},
    )
    assert recorded.status_code == 200, recorded.text


def test_prepared_asset_publish_recovery_matches_historical_snapshot_after_edit(
    workspace_config_api,
    tmp_path,
    monkeypatch,
):
    client, journal = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    inspected = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    ).json()
    converted = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json={
            "source_path": str(source),
            "email": "user@example.com",
            "target_space_id": "space-1",
            "expected_review_digest": inspected["review_digest"],
            "expected_target_draft_version": 0,
            "client_request_id": "recovery-import-1",
            "updated_by": "user-1",
        },
        headers=_headers(),
    )
    assert converted.status_code == 200, converted.text
    published_draft = journal.get_workspace_config_draft("space-1")
    assert published_draft is not None
    review = client.get(
        "/api/v1/spaces/space-1/workspace-configuration/review",
        params={"email": "user@example.com"},
        headers=_headers(),
    ).json()["review"]
    cloud_assets = [
        {
            "id": "asset_" + item["content_digest"][:32],
            **item,
            "logical_path": item["logical_path"].removeprefix("bundle://"),
        }
        for item in review["prepared_assets"]
    ]

    edited_document = json.loads(json.dumps(published_draft.document))
    edited_document["metadata"]["name"] = "Edited after Cloud publish"
    edited_response = client.put(
        "/api/v1/spaces/space-1/workspace-configuration",
        json={
            "expected_version": published_draft.version,
            "base_revision_id": published_draft.base_revision_id,
            "document": edited_document,
            "updated_by": "user-2",
            "email": "user@example.com",
        },
        headers=_headers(),
    )
    assert edited_response.status_code == 200, edited_response.text
    edited = journal.get_workspace_config_draft("space-1")
    assert edited is not None
    assert edited.document_digest != published_draft.document_digest

    class _Cloud:
        async def resolve_owner_revision(self, slug, version):
            assert slug == published_draft.document["metadata"]["id"]
            assert version == published_draft.document["metadata"]["revision"]
            return {
                "id": "wbr_33333333333333333333333333333333",
                "bundle_id": "wb_recovery",
                "status": "published",
                "manifest_digest": published_draft.document_digest,
                "manifest": published_draft.document,
                "assets": cloud_assets,
            }

        async def close(self):
            return None

    monkeypatch.setattr(
        workspace_config_controller,
        "_authoring_cloud",
        lambda _authorization: _Cloud(),
    )
    publish_payload = {
        "expected_version": edited.version,
        "revision_id": "wbr_33333333333333333333333333333333",
        "manifest_digest": published_draft.document_digest,
        "actor_id": "user-1",
        "email": "user@example.com",
    }

    original_digest = cloud_assets[-1]["content_digest"]
    cloud_assets[-1]["content_digest"] = "f" * 64
    mismatched = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/published",
        json=publish_payload,
        headers={**_headers(), "Authorization": "Bearer cloud-token"},
    )
    assert mismatched.status_code == 409

    cloud_assets[-1]["content_digest"] = original_digest
    recovered = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/published",
        json=publish_payload,
        headers={**_headers(), "Authorization": "Bearer cloud-token"},
    )
    assert recovered.status_code == 200, recovered.text
    rebased = recovered.json()["draft"]
    assert rebased["version"] == edited.version + 1
    assert rebased["document"]["metadata"]["name"] == (
        "Edited after Cloud publish"
    )
    assert rebased["document"]["metadata"]["revision"] == 2


def test_plugin_relative_mcp_command_is_semantically_executable(
    workspace_config_api,
    tmp_path,
):
    client, journal = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    command = source / "bin" / "server"
    command.chmod(0o644)

    inspected = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )
    assert inspected.status_code == 200, inspected.text
    review = inspected.json()
    descriptor = next(
        item
        for item in review["files"]
        if item["source_relative_path"] == "bin/server"
    )
    assert descriptor["executable"] is True

    converted = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json={
            "source_path": str(source),
            "email": "user@example.com",
            "target_space_id": "space-1",
            "expected_review_digest": review["review_digest"],
            "expected_target_draft_version": 0,
            "client_request_id": "semantic-executable-import-1",
            "updated_by": "user-1",
        },
        headers=_headers(),
    )
    assert converted.status_code == 200, converted.text
    draft = journal.get_workspace_config_draft("space-1")
    assert draft is not None
    stored = journal.list_workspace_config_draft_assets(
        space_id="space-1",
        draft_version=draft.version,
        document_digest=draft.document_digest,
    )
    stored_command = next(
        item for item in stored if item.logical_path.endswith("/bin/server")
    )
    assert stored_command.executable is True


def test_prepared_asset_preflight_rejects_corrupted_sqlite_blob_before_cloud_write(
    workspace_config_api,
    tmp_path,
):
    client, journal = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    inspected = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    ).json()
    assert (
        client.post(
            "/api/v1/workspace-bundles/agent-plugins:convert",
            json={
                "source_path": str(source),
                "email": "user@example.com",
                "target_space_id": "space-1",
                "expected_review_digest": inspected["review_digest"],
                "expected_target_draft_version": 0,
                "client_request_id": "corrupt-import-1",
                "updated_by": "user-1",
            },
            headers=_headers(),
        ).status_code
        == 200
    )
    review_payload = client.get(
        "/api/v1/spaces/space-1/workspace-configuration/review",
        params={"email": "user@example.com"},
        headers=_headers(),
    ).json()
    review = review_payload["review"]
    descriptor = review["prepared_assets"][0]
    with journal._lock:
        journal._connection.execute(
            "UPDATE workspace_config_draft_asset_blobs SET content = ? "
            "WHERE content_digest = ?",
            (b"corrupt", descriptor["content_digest"]),
        )
        journal._connection.commit()
    response = client.post(
        "/api/v1/spaces/space-1/workspace-configuration/prepared-assets:preflight",
        json={
            "expected_version": review_payload["draft_version"],
            "expected_manifest_digest": journal.get_workspace_config_draft(
                "space-1"
            ).document_digest,
            "expected_review_digest": review["review_digest"],
            "email": "user@example.com",
        },
        headers=_headers(),
    )
    assert response.status_code == 409
    assert (
        response.json()["detail"]["code"] == "workspace_configuration_changed"
    )


def test_agent_plugin_convert_replays_before_current_draft_cas(
    workspace_config_api,
    tmp_path,
):
    client, journal = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    inspected = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )
    assert inspected.status_code == 200
    body = {
        "source_path": str(source),
        "email": "user@example.com",
        "target_space_id": "space-1",
        "expected_review_digest": inspected.json()["review_digest"],
        "expected_target_draft_version": 0,
        "client_request_id": "import-replay",
        "updated_by": "user-1",
    }
    first = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json=body,
        headers=_headers(),
    )
    assert first.status_code == 200
    draft = journal.get_workspace_config_draft("space-1")
    assert draft is not None
    advanced = dict(draft.document)
    advanced["metadata"] = {**draft.document["metadata"], "name": "Edited"}
    journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=1,
        base_revision_id=None,
        document=advanced,
        updated_by="user-1",
    )

    replay = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json=body,
        headers=_headers(),
    )

    assert replay.status_code == 200, replay.text
    assert replay.json() == first.json()
    assert journal.get_workspace_config_draft("space-1").version == 2


def test_agent_plugin_convert_rejects_reused_request_id_with_changed_parameters(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    inspected = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )
    assert inspected.status_code == 200
    body = {
        "source_path": str(source),
        "email": "user@example.com",
        "target_space_id": "space-1",
        "expected_review_digest": inspected.json()["review_digest"],
        "expected_target_draft_version": 0,
        "client_request_id": "import-reused-with-different-request",
        "updated_by": "user-1",
    }
    first = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json=body,
        headers=_headers(),
    )

    conflict = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json={**body, "updated_by": "other-user"},
        headers=_headers(),
    )

    assert first.status_code == 200
    assert conflict.status_code == 409
    assert (
        conflict.json()["detail"]["code"] == "workspace_configuration_changed"
    )


def test_agent_plugin_convert_rejects_source_changed_after_review(
    workspace_config_api,
    tmp_path,
):
    client, journal = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    inspected = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )
    assert inspected.status_code == 200
    (source / "skills" / "research" / "SKILL.md").write_text(
        "---\nname: research\ndescription: Changed after review\n---\n",
        encoding="utf-8",
    )

    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:convert",
        json={
            "source_path": str(source),
            "email": "user@example.com",
            "target_space_id": "space-1",
            "expected_review_digest": inspected.json()["review_digest"],
            "expected_target_draft_version": 0,
            "client_request_id": "changed-after-review",
            "updated_by": "user-1",
        },
        headers=_headers(),
    )

    assert response.status_code == 422
    assert journal.get_workspace_config_draft("space-1") is None


def test_agent_plugin_zip_import_rejects_traversal_and_accepts_one_root(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    archive = tmp_path / "portable-plugin.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        for path in source.rglob("*"):
            if path.is_file():
                handle.write(
                    path, Path("portable-plugin") / path.relative_to(source)
                )
    accepted = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(archive), "email": "user@example.com"},
        headers=_headers(),
    )

    traversal = tmp_path / "traversal.zip"
    with zipfile.ZipFile(traversal, "w") as handle:
        handle.writestr("../plugin.json", "{}")
    rejected = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(traversal), "email": "user@example.com"},
        headers=_headers(),
    )

    collision = tmp_path / "collision.zip"
    with zipfile.ZipFile(collision, "w") as handle:
        handle.writestr("plugin.json", "{}")
        handle.writestr("PLUGIN.JSON", "{}")
    collision_response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(collision), "email": "user@example.com"},
        headers=_headers(),
    )

    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["source"]["source_kind"] == "archive"
    assert rejected.status_code == 422
    assert collision_response.status_code == 422


def test_agent_plugin_rejects_archive_entry_exhaustion_bad_crc_and_deep_directory(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    too_many = tmp_path / "too-many.zip"
    with zipfile.ZipFile(too_many, "w") as handle:
        for index in range(4_001):
            handle.writestr(f"empty-{index}/", b"")

    plugin_payload = json.dumps(
        {"$schema": PLUGIN_SCHEMA, "name": "crc-plugin"}
    ).encode()
    bad_crc = tmp_path / "bad-crc.zip"
    with zipfile.ZipFile(bad_crc, "w") as handle:
        handle.writestr("plugin.json", plugin_payload)
    corrupted = bytearray(bad_crc.read_bytes())
    payload_index = corrupted.find(plugin_payload)
    assert payload_index >= 0
    corrupted[payload_index] ^= 0x01
    bad_crc.write_bytes(corrupted)

    deep_source = _agent_plugin(tmp_path / "deep-plugin")
    directory = deep_source
    for index in range(33):
        directory = directory / f"level-{index}"
        directory.mkdir()

    too_many_directory = _agent_plugin(tmp_path / "too-many-directory")
    for index in range(4_001):
        (too_many_directory / f"empty-{index}").mkdir()

    responses = [
        client.post(
            "/api/v1/workspace-bundles/agent-plugins:inspect",
            json={"source_path": str(path), "email": "user@example.com"},
            headers=_headers(),
        )
        for path in (too_many, bad_crc, deep_source, too_many_directory)
    ]

    assert [response.status_code for response in responses] == [
        422,
        422,
        422,
        422,
    ]


def test_agent_plugin_rejects_archive_entry_count_before_opening_central_directory(
    workspace_config_api,
    tmp_path,
    monkeypatch,
):
    client, _ = workspace_config_api
    archive = tmp_path / "entry-bomb.zip"
    entry_count = 4_001
    archive.write_bytes(
        b"PK\x05\x06"
        + (0).to_bytes(2, "little")
        + (0).to_bytes(2, "little")
        + entry_count.to_bytes(2, "little")
        + entry_count.to_bytes(2, "little")
        + (0).to_bytes(4, "little")
        + (0).to_bytes(4, "little")
        + (0).to_bytes(2, "little")
    )

    def fail_if_zipfile_is_opened(*_args, **_kwargs):
        raise AssertionError("unsafe central directory was opened")

    monkeypatch.setattr(zipfile, "ZipFile", fail_if_zipfile_is_opened)
    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(archive), "email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 422


def test_agent_plugin_skips_invalid_optional_components_and_warns_on_unknown_manifest_field(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    plugin = json.loads((source / "plugin.json").read_text(encoding="utf-8"))
    plugin["futureStandardField"] = {"keptByFutureHosts": True}
    (source / "plugin.json").write_text(json.dumps(plugin), encoding="utf-8")
    invalid_skill = source / "skills" / "invalid-skill"
    invalid_skill.mkdir()
    (invalid_skill / "SKILL.md").write_text(
        "---\nname: does-not-match\ndescription: Invalid\n---\n",
        encoding="utf-8",
    )
    mcp = json.loads((source / "mcp.json").read_text(encoding="utf-8"))
    mcp["mcpServers"]["unsupported"] = {
        "type": "future-transport",
        "url": "https://example.invalid/mcp",
    }
    (source / "mcp.json").write_text(json.dumps(mcp), encoding="utf-8")

    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["id"] for item in payload["skills"]] == ["research"]
    assert [item["id"] for item in payload["mcp_servers"]] == ["local"]
    assert (
        payload["skipped_skills"][0]["reason_code"] == "invalid_skill_skipped"
    )
    assert payload["skipped_mcp_servers"][0]["reason_code"] == (
        "invalid_mcp_server_skipped"
    )
    assert any(
        item["code"] == "unknown_manifest_field_ignored"
        for item in payload["warnings"]
    )


def test_agent_plugin_invalid_mcp_component_does_not_discard_valid_skills(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    plugin = json.loads((source / "plugin.json").read_text(encoding="utf-8"))
    plugin["extensions"] = {}
    (source / "plugin.json").write_text(json.dumps(plugin), encoding="utf-8")
    (source / "mcp.json").write_text(
        json.dumps({"$schema": MCP_SCHEMA, "unexpected": {}}),
        encoding="utf-8",
    )

    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["skills"]] == ["research"]
    assert response.json()["mcp_servers"] == []
    assert response.json()["skipped_mcp_servers"][0]["reason_code"] == (
        "invalid_mcp_component"
    )


def test_agent_plugin_rejects_undeclared_secret_without_echoing_it(
    workspace_config_api,
    tmp_path,
):
    client, journal = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    plugin = json.loads((source / "plugin.json").read_text(encoding="utf-8"))
    plugin["extensions"] = {}
    (source / "plugin.json").write_text(json.dumps(plugin), encoding="utf-8")
    secret = "sk-ant-api03-" + "abcdefghijklmnopqrstuvwx1234567890"
    mcp = json.loads((source / "mcp.json").read_text(encoding="utf-8"))
    mcp["mcpServers"]["local"]["env"]["API_TOKEN"] = secret
    (source / "mcp.json").write_text(json.dumps(mcp), encoding="utf-8")

    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 200
    assert response.json()["mcp_servers"] == []
    assert secret not in response.text
    assert journal.get_workspace_config_draft("space-1") is None


def test_agent_plugin_requires_secret_slot_for_sensitive_mcp_field_name(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    plugin = json.loads((source / "plugin.json").read_text(encoding="utf-8"))
    plugin["extensions"] = {}
    (source / "plugin.json").write_text(json.dumps(plugin), encoding="utf-8")
    mcp = json.loads((source / "mcp.json").read_text(encoding="utf-8"))
    mcp["mcpServers"]["local"]["env"]["API_TOKEN"] = "not-high-entropy"
    (source / "mcp.json").write_text(json.dumps(mcp), encoding="utf-8")

    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 200
    assert response.json()["mcp_servers"] == []
    assert response.json()["skipped_mcp_servers"][0]["reason_code"] == (
        "invalid_mcp_server_skipped"
    )


def test_agent_plugin_allows_contained_symlinks_but_rejects_escapes_and_sources_outside_hands_scope(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    (source / "linked-skill").symlink_to(source / "skills" / "research")

    contained = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )
    (source / "linked-skill").unlink()
    (source / "escaped").symlink_to(Path.home())
    escaped = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )
    outside_scope = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(Path.home()), "email": "user@example.com"},
        headers=_headers(),
    )

    assert contained.status_code == 200, contained.text
    assert escaped.status_code == 422
    assert outside_scope.status_code == 403


def test_agent_plugin_isolates_escaping_skill_symlinks_and_excludes_git_aliases(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    (source / "skills" / "escaped-skill").symlink_to(Path.home())
    git_directory = source / ".git"
    git_directory.mkdir()
    (git_directory / "config").write_text("private git data", encoding="utf-8")
    (source / "linked-git").symlink_to(git_directory)

    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["id"] for item in payload["skills"]] == ["research"]
    assert payload["skipped_skills"][0]["reason_code"] == (
        "invalid_skill_skipped"
    )
    assert all(
        "linked-git" not in item["logical_path"] for item in payload["files"]
    )
    assert "private git data" not in response.text


def test_agent_plugin_excludes_nested_git_administration_directories(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    nested_git = source / "vendor" / "dependency" / ".git"
    nested_git.mkdir(parents=True)
    (nested_git / "config").write_text(
        "nested private git data", encoding="utf-8"
    )

    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    assert all(
        "/.git/" not in item["logical_path"]
        for item in response.json()["files"]
    )
    assert "nested private git data" not in response.text


def test_agent_plugin_skips_an_escaping_skills_component_without_losing_mcp(
    workspace_config_api,
    tmp_path,
):
    client, _ = workspace_config_api
    source = _agent_plugin(tmp_path / "portable-plugin")
    shutil.rmtree(source / "skills")
    (source / "skills").symlink_to(Path.home())

    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={"source_path": str(source), "email": "user@example.com"},
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    assert response.json()["skills"] == []
    assert response.json()["skipped_skills"][0]["reason_code"] == (
        "invalid_skills_component"
    )
    assert [item["id"] for item in response.json()["mcp_servers"]] == ["local"]


def test_agent_plugin_rejects_unsupported_schema_without_network_fetch(
    workspace_config_api,
    tmp_path,
):
    client, journal = workspace_config_api
    source = _agent_plugin(
        tmp_path / "portable-plugin",
        schema="https://agent-plugins.org/schemas/9.9.9/plugin.schema.json",
    )

    response = client.post(
        "/api/v1/workspace-bundles/agent-plugins:inspect",
        json={
            "source_path": str(source),
            "email": "user@example.com",
        },
        headers=_headers(),
    )

    assert response.status_code == 422
    assert (
        response.json()["detail"]["code"] == "workspace_configuration_invalid"
    )
    assert journal.get_workspace_config_draft("space-1") is None


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
    revision_id = "wbr_44444444444444444444444444444444"

    class _Cloud:
        async def resolve_owner_revision(self, slug, version):
            assert slug == saved["document"]["metadata"]["id"]
            assert version == saved["document"]["metadata"]["revision"]
            return {
                "id": revision_id,
                "bundle_id": "wb_verified",
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
            "revision_id": revision_id,
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
    revision_id = "wbr_55555555555555555555555555555555"

    class _Cloud:
        async def resolve_owner_revision(self, _slug, _version):
            return {
                "id": revision_id,
                "bundle_id": "wb_recovered",
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
        ("published", "wbr_77777777777777777777777777777777", None),
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
    revision_id = "wbr_66666666666666666666666666666666"

    class _Cloud:
        async def resolve_owner_revision(self, _slug, _version):
            return {
                "id": cloud_id or revision_id,
                "bundle_id": "wb_unverified",
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
