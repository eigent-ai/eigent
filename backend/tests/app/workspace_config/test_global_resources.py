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
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import yaml
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.auth.local_control import (
    LOCAL_CONTROL_CAPABILITY_HEADER,
    LocalControlPrincipal,
)
from app.controller import workspace_config_controller as controller
from app.run_journal import SQLiteRunJournal
from app.service import mcp_config, skill_config_service, skill_service
from app.workspace_bundle.runtime import (
    EnvironmentSetupRequiredError,
    RuntimeEnvironmentAssembler,
    bundle_runtime_binding_digest,
)
from app.workspace_config import (
    EnvironmentConfigResolver,
    LocalMaterialization,
    WorkspaceBundleManifest,
)
from app.workspace_config.admission import LegacyEnvironmentImporter
from app.workspace_config.global_resources import (
    GlobalResourceUnavailable,
    discover_global_resources,
    global_resource_ref,
    resolve_global_mcp,
    resolve_global_skill,
)


@pytest.fixture
def global_configuration(tmp_path, monkeypatch):
    root = tmp_path / "global"
    skills = root / "skills"
    skills.mkdir(parents=True)
    skill = skills / "research" / "SKILL.md"
    skill.parent.mkdir()
    skill.write_text(
        "---\nname: Research\ndescription: Research safely\n---\nUse real sources."
    )
    account = root / "user_7" / "skills-config.json"
    account.parent.mkdir()
    account.write_text(json.dumps({"skills": {"Research": {"enabled": True}}}))
    other = root / "user_8" / "skills-config.json"
    other.parent.mkdir()
    other.write_text(json.dumps({"skills": {"Research": {"enabled": False}}}))
    mcp = root / "mcp.json"
    mcp.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "Configured MCP": {
                        "type": "streamable-http",
                        "url": "https://synthetic.invalid/mcp",
                        "headers": {
                            "Authorization": "synthetic-secret-never-export"
                        },
                    }
                }
            }
        )
    )
    monkeypatch.setattr(skill_service, "SKILLS_ROOT", skills)
    monkeypatch.setattr(skill_config_service, "EIGENT_ROOT", root)
    monkeypatch.setattr(mcp_config, "MCP_CONFIG_PATH", mcp)
    # Discovery must not call existing write-on-read / migration helpers.
    monkeypatch.setattr(
        skill_service,
        "skills_scan",
        Mock(side_effect=AssertionError("scan writes")),
    )
    monkeypatch.setattr(
        skill_config_service,
        "skill_config_load",
        Mock(side_effect=AssertionError("load writes")),
    )
    monkeypatch.setattr(
        mcp_config,
        "read_mcp_config",
        Mock(side_effect=AssertionError("read writes")),
    )
    return root, skill, account, mcp


@pytest.fixture
def global_api(tmp_path, monkeypatch, global_configuration):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    binding = SimpleNamespace(workspace_root=str(tmp_path / "space"))
    store = SimpleNamespace(get_binding=lambda *_: binding)
    monkeypatch.setattr(controller, "get_default_run_journal", lambda: journal)
    monkeypatch.setattr(
        controller,
        "get_workspace_resolver",
        lambda: SimpleNamespace(store=store),
    )
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv(
        "EIGENT_LOCAL_CONTROL_CAPABILITY", "synthetic-local-capability"
    )
    app = FastAPI()
    app.include_router(controller.router, prefix="/api/v1")
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        yield client, journal, store
    journal.close()


def headers():
    return {LOCAL_CONTROL_CAPABILITY_HEADER: "synthetic-local-capability"}


def snapshot(root):
    return {
        str(item.relative_to(root)): item.read_bytes()
        for item in root.rglob("*")
        if item.is_file()
    }


def install_runtime_fixture(tmp_path, journal, manifest):
    """An explicit synthetic already-approved materialization; no Cloud calls."""
    journal.put_workspace_config_revision(
        revision_id=manifest.revision_id,
        bundle_id=manifest.metadata.id,
        revision_number=manifest.metadata.revision,
        manifest=manifest.canonical_payload(),
        created_by="fixture",
    )
    journal.put_workspace_config_materialization(
        materialization_id="global-materialization",
        space_id="space-global",
        revision_id=manifest.revision_id,
        config_placement="sidecar",
    )
    actions = [
        f"skill.script.execute:{item.ref}" for item in manifest.spec.skills
    ]
    actions += [
        f"mcp.server.start:{item.id}" for item in manifest.spec.mcp_servers
    ]
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="global-proposal",
        request_id="global-request",
        space_id="space-global",
        bundle_id=manifest.metadata.id,
        revision_id=manifest.revision_id,
        config_placement="sidecar",
        manifest=manifest.canonical_payload(),
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": actions,
            "environment_requirements": [],
            "mcp_secret_requirements": [],
        },
    )
    proposal = journal.transition_workspace_bundle_install_proposal(
        proposal.proposal_id,
        expected_version=proposal.version,
        state="approved",
        decided_by="fixture",
    )
    for action in actions:
        _, proposal = journal.put_workspace_bundle_local_binding(
            proposal_id=proposal.proposal_id,
            expected_proposal_version=proposal.version,
            slot_id=action,
            binding_kind="script_approval",
            connector_id=None,
            opaque_connection_id=None,
            local_path=None,
            required_grants=[],
            authorized_by="fixture",
        )
    for state in ("materializing", "materialized"):
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state=state,
        )
    state_root = tmp_path / "runtime"
    config_root = state_root / "spaces" / "space-global" / "configuration"
    config_root.mkdir(parents=True)
    (config_root / "workspace.yaml").write_text(
        yaml.safe_dump(manifest.canonical_payload())
    )
    (config_root / "workspace.lock").write_text(
        yaml.safe_dump(
            {
                "apiVersion": "eigent.ai/lock/v1alpha1",
                "bundleRevision": manifest.revision_id,
                "manifestDigest": manifest.digest,
                "assets": [],
                "skills": [],
                "mcpPackages": [],
            }
        )
    )
    local = LocalMaterialization(
        bundle_proposal_id=proposal.proposal_id,
        bundle_proposal_version=proposal.version,
        bundle_binding_digest=bundle_runtime_binding_digest(
            proposal,
            journal.list_workspace_bundle_local_bindings(proposal.proposal_id),
            (),
        ),
        configuration_root=str(config_root),
    )
    capability = (
        LegacyEnvironmentImporter()
        .build_template(
            model_platform="openai",
            model_type="gpt-5.5-codex",
            auth_source="codex_subscription",
            requested_effort="medium",
            allow_local_system=False,
        )
        .provider_capability
    )
    spec = EnvironmentConfigResolver().resolve(
        manifest=manifest,
        owner_type="run",
        owner_id="global-run",
        local_materialization=local,
        provider_capability=capability,
        runtime_capability_manifest={
            "workspace_bundle": {"revision_id": manifest.revision_id}
        },
    )
    return spec, RuntimeEnvironmentAssembler(journal, state_root=state_root)


def test_discovery_is_read_only_global_without_space_binding(
    global_api, global_configuration
):
    client, journal, store = global_api
    root, _, _, _ = global_configuration
    before = snapshot(root)
    changes = journal._connection.total_changes
    store.get_binding = Mock(
        side_effect=AssertionError("must not require or create binding")
    )
    path = "/api/v1/workspace-configuration/global-resources"
    assert (
        client.get(
            path, params={"email": "fixture@example.test", "user_id": "7"}
        ).status_code
        == 401
    )
    response = client.get(
        path,
        params={"email": "fixture@example.test", "user_id": "7"},
        headers=headers(),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["skills"][0]["enabled"] is True
    assert payload["mcp_servers"][0]["enabled"] is True
    text = json.dumps(payload)
    for forbidden in (
        str(root),
        "synthetic-secret",
        "synthetic.invalid",
        "Authorization",
        "Use real sources",
    ):
        assert forbidden not in text
    assert snapshot(root) == before
    assert journal._connection.total_changes == changes
    other = client.get(
        path,
        params={"email": "other@example.test", "user_id": "8"},
        headers=headers(),
    ).json()
    assert other["skills"][0]["enabled"] is False
    assert (
        other["skills"][0]["unavailableReason"] == "global_resource_disabled"
    )


def test_actual_discover_save_reopen_and_runtime_resolution(
    global_api, global_configuration, tmp_path
):
    client, journal, _ = global_api
    root, skill, _, _ = global_configuration
    before = snapshot(root)
    params = {"email": "fixture@example.test", "user_id": "7"}
    options = client.get(
        "/api/v1/workspace-configuration/global-resources",
        params=params,
        headers=headers(),
    ).json()
    path = "/api/v1/spaces/space-global/workspace-configuration"
    initial = client.get(path, params=params, headers=headers()).json()
    document = initial["document"]
    document["spec"]["agents"] = [
        {
            "id": "single_agent",
            "role": "coordinator",
            "modelProfile": "default",
        }
    ]
    document["spec"]["skills"] = [
        {"ref": options["skills"][0]["ref"], "assignTo": ["single_agent"]}
    ]
    document["spec"]["mcpServers"] = [
        {
            "id": "custom-id",
            "definition": options["mcp_servers"][0]["definition"],
            "secretSlots": [],
        }
    ]
    saved = client.put(
        path,
        headers=headers(),
        json={
            **params,
            "document": document,
            "expected_version": 0,
            "updated_by": "fixture",
        },
    )
    assert saved.status_code == 200, saved.text
    reopened = client.get(path, params=params, headers=headers()).json()
    assert reopened["document"] == saved.json()["document"]
    manifest = WorkspaceBundleManifest.model_validate(reopened["document"])
    spec, assembler = install_runtime_fixture(tmp_path, journal, manifest)
    runtime = assembler.assemble(
        spec, space_id="space-global", space_root=tmp_path / "space", **params
    )
    assert runtime.pinned_skill_sources("single_agent") == {
        str(skill): skill.read_text()
    }
    assert runtime.pinned_skill_sources("other") == {
        str(skill): skill.read_text()
    }  # one agent alias
    assert (
        runtime.mcp_config_without_secrets()["mcpServers"]["custom-id"][
            "headers"
        ]["Authorization"]
        == "synthetic-secret-never-export"
    )
    assert "synthetic-secret" not in repr(runtime)
    assert "synthetic-secret" not in json.dumps(spec.model_dump(mode="json"))
    assert snapshot(root) == before
    # Another account's disabled configuration cannot resolve this reference.
    with pytest.raises(
        EnvironmentSetupRequiredError, match="global_resource_disabled"
    ):
        assembler.assemble(
            spec,
            space_id="space-global",
            space_root=tmp_path / "space",
            user_id="8",
            email="other@example.test",
        )
    # Existing in-memory Attempt snapshot survives later global edits.
    skill.write_text(skill.read_text().replace("real sources", "new sources"))
    assert "real sources" in next(
        iter(runtime.pinned_skill_sources().values())
    )


def test_global_mcp_manual_slots_rejected_before_save(global_api):
    client, journal, _ = global_api
    params = {"email": "fixture@example.test", "user_id": "7"}
    path = "/api/v1/spaces/space-global/workspace-configuration"
    document = client.get(path, params=params, headers=headers()).json()[
        "document"
    ]
    ref = global_resource_ref("mcp", "Configured MCP")
    document["spec"]["mcpServers"] = [
        {
            "id": "example",
            "definition": ref,
            "secretSlots": ["keep-user-input"],
        }
    ]
    response = client.put(
        path,
        headers=headers(),
        json={
            **params,
            "document": document,
            "expected_version": 0,
            "updated_by": "fixture",
        },
    )
    assert response.status_code == 422
    assert "global_mcp_secret_slots_unsupported" in response.text
    assert journal.get_workspace_config_draft("space-global") is None
    with pytest.raises(
        GlobalResourceUnavailable, match="global_mcp_secret_slots_unsupported"
    ):
        resolve_global_mcp(ref, secret_slots=("keep-user-input",))


def test_global_registry_preserves_disabled_invalid_and_all_entries(
    global_configuration,
):
    root, _, _, mcp = global_configuration
    mcp.write_text(
        json.dumps(
            {
                "mcpServers": {
                    **{
                        f"server-{index}": {"command": "fixture", "args": []}
                        for index in range(70)
                    },
                    "disabled": {"command": "fixture", "enabled": False},
                    "invalid": {
                        "headers": {"Authorization": "synthetic-secret"}
                    },
                }
            }
        )
    )
    result = discover_global_resources(
        user_id="7", email="fixture@example.test"
    )
    assert len(result["mcp_servers"]) == 72
    by_id = {item["id"]: item for item in result["mcp_servers"]}
    assert by_id["disabled"]["unavailableReason"] == "global_resource_disabled"
    assert by_id["invalid"]["unavailableReason"] == "global_mcp_invalid"
    mcp.write_text("{ invalid json")
    with pytest.raises(
        GlobalResourceUnavailable, match="global_configuration_invalid"
    ):
        discover_global_resources(user_id="7", email="fixture@example.test")


def test_global_skill_symlink_does_not_resolve_outside_root(
    global_configuration, tmp_path
):
    root, skill, _, _ = global_configuration
    outside = tmp_path / "outside.md"
    outside.write_text(
        "---\nname: Secret\ndescription: Secret\n---\nNever read."
    )
    skill.unlink()
    skill.symlink_to(outside)
    options = discover_global_resources(
        user_id="7", email="fixture@example.test"
    )
    assert options["skills"][0]["enabled"] is False
    assert options["skills"][0]["label"] == "research"
    with pytest.raises(
        GlobalResourceUnavailable, match="global_skill_invalid"
    ):
        resolve_global_skill(
            options["skills"][0]["ref"],
            user_id="7",
            email="fixture@example.test",
        )


def test_global_registry_missing_and_unknown_references_fail_closed(
    global_configuration,
):
    with pytest.raises(
        GlobalResourceUnavailable, match="global_skill_unavailable"
    ):
        resolve_global_skill(
            "registry://global/skills/unknown",
            user_id="7",
            email="fixture@example.test",
        )
    with pytest.raises(
        GlobalResourceUnavailable, match="global_mcp_unavailable"
    ):
        resolve_global_mcp("registry://mcp/old@1")


def test_missing_global_files_remain_absent(global_configuration):
    root, _, account, mcp = global_configuration
    account.unlink()
    mcp.unlink()
    before = snapshot(root)
    result = discover_global_resources(
        user_id="7", email="fixture@example.test"
    )
    assert result["skills"][0]["enabled"] is True
    assert result["mcp_servers"] == []
    assert snapshot(root) == before


def test_global_skill_legacy_merge_has_no_migration(global_configuration):
    root, _, account, _ = global_configuration
    previous = root / "fixture" / "skills-config.json"
    previous.parent.mkdir()
    previous.write_text(
        json.dumps({"skills": {"Research": {"enabled": False}}})
    )
    before = snapshot(root)
    assert (
        discover_global_resources(user_id="7", email="fixture@example.test")[
            "skills"
        ][0]["enabled"]
        is True
    )
    account.unlink()
    result = discover_global_resources(
        user_id="7", email="fixture@example.test"
    )
    assert result["skills"][0]["enabled"] is False
    assert previous.exists()
    assert snapshot(root) == {
        key: value
        for key, value in before.items()
        if key != "user_7/skills-config.json"
    }


@pytest.mark.parametrize(
    "kind", ["unknown_skill", "unknown_mcp", "manual_slots", "removed_mcp"]
)
def test_runtime_global_reference_failures_are_explicit(
    global_api, global_configuration, tmp_path, kind
):
    client, journal, _ = global_api
    params = {"email": "fixture@example.test", "user_id": "7"}
    document = client.get(
        "/api/v1/spaces/space-global/workspace-configuration",
        params=params,
        headers=headers(),
    ).json()["document"]
    if kind == "unknown_skill":
        document["spec"]["skills"] = [{"ref": "registry://skills/old@1"}]
        expected = "registry_skill_unmaterialized"
    else:
        document["spec"]["mcpServers"] = [
            {
                "id": "configured",
                "definition": global_resource_ref("mcp", "Configured MCP"),
            }
        ]
        expected = "global_mcp_unavailable"
        if kind == "unknown_mcp":
            document["spec"]["mcpServers"][0]["definition"] = (
                "registry://mcp/old@1"
            )
            expected = "registry_mcp_unmaterialized"
        elif kind == "manual_slots":
            document["spec"]["mcpServers"][0]["secretSlots"] = ["manual"]
            expected = "global_mcp_secret_slots_unsupported"
        else:
            global_configuration[3].unlink()
    spec, assembler = install_runtime_fixture(
        tmp_path, journal, WorkspaceBundleManifest.model_validate(document)
    )
    with pytest.raises(EnvironmentSetupRequiredError, match=expected):
        assembler.assemble(
            spec,
            space_id="space-global",
            space_root=tmp_path / "space",
            **params,
        )


@pytest.mark.asyncio
async def test_installer_reviews_configured_global_mcp_without_exporting_config(
    global_configuration, tmp_path
):
    from app.workspace_bundle.installer import WorkspaceBundleInstaller

    manifest = WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "global-review",
                "name": "Global review",
                "revision": 1,
            },
            "spec": {
                "models": {"default": {"modelRef": "provider://default"}},
                "mcpServers": [
                    {
                        "id": "configured",
                        "definition": global_resource_ref(
                            "mcp", "Configured MCP"
                        ),
                    }
                ],
            },
        }
    )
    journal = SQLiteRunJournal(tmp_path / "install.sqlite3")
    try:
        cloud = Mock()
        installer = WorkspaceBundleInstaller(journal, Mock(), cloud)
        destinations = await installer._inspect_mcp_destinations(manifest, [])
        assert destinations[0]["destination_kind"] == "global_configuration"
        assert destinations[0]["availability_issue"] is None
        assert "synthetic-secret" not in json.dumps(destinations)
        assert "synthetic.invalid" not in json.dumps(destinations)
        cloud.download_asset.assert_not_called()
    finally:
        journal.close()


def test_remote_global_discovery_uses_authenticated_canonical_owner(
    global_api, global_configuration
):
    from app.auth import require_local_control_principal
    from app.auth.local_control import LocalControlPrincipal

    client, _, _ = global_api
    root, _, account, _ = global_configuration
    account.unlink()
    legacy = root / "another-account" / "skills-config.json"
    legacy.parent.mkdir()
    legacy.write_text(json.dumps({"skills": {"Research": {"enabled": False}}}))

    async def authenticated_owner(request: Request):
        principal = LocalControlPrincipal(kind="brain_user", user_id="7")
        request.state.local_control_principal = principal
        return principal

    client.app.dependency_overrides[require_local_control_principal] = (
        authenticated_owner
    )
    path = "/api/v1/workspace-configuration/global-resources"
    wrong = client.get(
        path, params={"email": "another-account@example.test", "user_id": "8"}
    )
    assert wrong.status_code == 403
    correct = client.get(
        path, params={"email": "another-account@example.test", "user_id": "7"}
    )
    assert correct.status_code == 200
    assert correct.json()["skills"][0]["enabled"] is True


@pytest.fixture
def global_chat_runtime(
    global_api, global_configuration, tmp_path, monkeypatch
):
    from app.controller import chat_controller

    _, journal, _ = global_api
    manifest = WorkspaceBundleManifest.model_validate(
        {
            "apiVersion": "eigent.ai/v1alpha1",
            "kind": "WorkspaceBundle",
            "metadata": {
                "id": "global-chat",
                "name": "Global chat",
                "revision": 1,
            },
            "spec": {
                "models": {"default": {"modelRef": "provider://default"}},
                "skills": [{"ref": global_resource_ref("skill", "research")}],
                "mcpServers": [
                    {
                        "id": "custom-id",
                        "definition": global_resource_ref(
                            "mcp", "Configured MCP"
                        ),
                    }
                ],
            },
        }
    )
    spec, assembler = install_runtime_fixture(tmp_path, journal, manifest)
    monkeypatch.setattr(
        chat_controller, "_space_root_for_run", lambda _: tmp_path / "space"
    )
    # Redirect only the physical test state root. Keep the actual assembler,
    # canonical manifest/lock checks, synthetic SQLite and global file readers.
    monkeypatch.setattr(
        chat_controller,
        "RuntimeEnvironmentAssembler",
        lambda journal, **_: RuntimeEnvironmentAssembler(
            journal, state_root=assembler.state_root
        ),
    )

    def assemble(principal, *, user_id="7", email="fixture@example.test"):
        context = SimpleNamespace(
            space_id="space-global", user_id=user_id, email=email
        )
        return chat_controller._assemble_runtime_environment(
            journal, spec, context, principal
        )

    return assemble


@pytest.mark.parametrize(
    ("authenticated_user", "body_user", "disabled"),
    [("8", "7", True), ("7", "8", False)],
)
def test_chat_global_runtime_uses_authenticated_owner_not_body_user(
    global_chat_runtime,
    global_configuration,
    authenticated_user,
    body_user,
    disabled,
):
    root, skill, _, _ = global_configuration
    before = snapshot(root)
    principal = LocalControlPrincipal(
        kind="brain_user", user_id=authenticated_user
    )
    if disabled:
        with pytest.raises(
            EnvironmentSetupRequiredError, match="global_resource_disabled"
        ):
            global_chat_runtime(principal, user_id=body_user)
    else:
        runtime = global_chat_runtime(principal, user_id=body_user)
        assert runtime.pinned_skill_sources() == {
            str(skill): skill.read_text()
        }
        assert (
            "custom-id" in runtime.mcp_config_without_secrets()["mcpServers"]
        )
        assert "synthetic-secret" not in repr(runtime)
    assert snapshot(root) == before


@pytest.mark.parametrize("kind", ["brain_user", "desktop_renderer"])
def test_chat_global_runtime_allows_legacy_email_only_for_desktop_capability(
    global_chat_runtime, global_configuration, kind
):
    root, skill, account, _ = global_configuration
    account.write_text(json.dumps({"skills": {}}))
    legacy = root / "another-account" / "skills-config.json"
    legacy.parent.mkdir()
    legacy.write_text(json.dumps({"skills": {"Research": {"enabled": False}}}))
    before = snapshot(root)
    principal = LocalControlPrincipal(
        kind=kind, user_id="7" if kind == "brain_user" else "local"
    )
    if kind == "desktop_renderer":
        with pytest.raises(
            EnvironmentSetupRequiredError, match="global_resource_disabled"
        ):
            global_chat_runtime(
                principal, email="another-account@example.test"
            )
    else:
        runtime = global_chat_runtime(
            principal, email="another-account@example.test"
        )
        assert runtime.pinned_skill_sources() == {
            str(skill): skill.read_text()
        }
    assert snapshot(root) == before


@pytest.mark.parametrize(
    "principal", [None, SimpleNamespace(kind="brain_user", user_id="7")]
)
def test_chat_global_runtime_cannot_infer_authority_from_body_without_principal(
    global_chat_runtime, principal
):
    with pytest.raises(
        EnvironmentSetupRequiredError, match="global_skill_identity_required"
    ):
        global_chat_runtime(
            principal, user_id="7", email="fixture@example.test"
        )
