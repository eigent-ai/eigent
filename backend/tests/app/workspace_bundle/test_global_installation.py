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

"""Exercise real discovery/save, installer HTTP APIs, Git/SQLite and runtime.

Only the published Cloud catalog and account data are fixtures. No positive
case pre-creates approvals or materialization records in the journal.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import Request

from app.auth import require_local_control_principal
from app.auth.local_control import LocalControlPrincipal
from app.controller import workspace_bundle_controller as controller
from app.run_journal import WorkspaceBundleLocalBindingRecord
from app.workspace_bundle import WorkspaceBundleInstaller
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
from app.workspace_git import ConfigurationRepositoryService, GitBackend


def _fixtures(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_TESTS = Path(__file__).resolve().parents[1]
_global = _fixtures(
    "global_install_resources",
    _TESTS / "workspace_config/test_global_resources.py",
)
_install = _fixtures(
    "global_install_cloud", Path(__file__).with_name("test_installer.py")
)
global_configuration = _global.global_configuration
global_api = _global.global_api


@pytest.fixture
def install_global(global_api, global_configuration, tmp_path, monkeypatch):
    client, journal, store = global_api
    identity = {"email": "fixture@example.test", "user_id": "7"}
    headers = {**_global.headers(), "Authorization": "Bearer synthetic-token"}
    client.app.include_router(controller.router, prefix="/api/v1")
    monkeypatch.setattr(controller, "get_default_run_journal", lambda: journal)
    monkeypatch.setattr(
        controller,
        "get_workspace_resolver",
        lambda: SimpleNamespace(store=store),
    )
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", "/dev/null")
    space = tmp_path / "space"
    space.mkdir()
    state_root = tmp_path / "runtime"

    def install(kind, *, legacy=False, unknown=False):
        discovered = client.get(
            "/api/v1/workspace-configuration/global-resources",
            params=identity,
            headers=headers,
        )
        assert discovered.status_code == 200
        options = discovered.json()
        path = "/api/v1/spaces/space-global/workspace-configuration"
        document = client.get(path, params=identity, headers=headers).json()[
            "document"
        ]
        ref = (
            options["skills"][0]["ref"]
            if kind == "skill"
            else options["mcp_servers"][0]["definition"]
        )
        if unknown:
            ref = f"registry://unknown/{kind}/resource@1"
        document["spec"]["skills"] = [{"ref": ref}] if kind == "skill" else []
        document["spec"]["mcpServers"] = (
            [{"id": "chosen", "definition": ref, "secretSlots": []}]
            if kind == "mcp"
            else []
        )
        saved = client.put(
            path,
            headers=headers,
            json={
                **identity,
                "document": document,
                "expected_version": 0,
                "updated_by": "fixture",
            },
        )
        assert saved.status_code == 200, saved.text
        reopened = client.get(path, params=identity, headers=headers)
        assert reopened.status_code == 200
        manifest = WorkspaceBundleManifest.model_validate(
            reopened.json()["document"]
        )

        class Cloud(_install.FakeCloud):
            async def get_catalog_revision(
                self, publisher_namespace, slug, version
            ):
                return {
                    "id": manifest.revision_id,
                    "bundle_id": manifest.metadata.id,
                    "revision_id": manifest.revision_id,
                    "publisher_namespace": publisher_namespace,
                    "slug": slug,
                    "version": version,
                    "status": "published",
                    "manifest": manifest.canonical_payload(),
                    "manifest_digest": manifest.digest,
                    "assets": [],
                }

        config = ConfigurationRepositoryService(
            journal,
            state_root=state_root,
            git_backend=GitBackend(hooks_path=tmp_path / "empty-hooks"),
        )
        cloud = Cloud()
        service = WorkspaceBundleInstaller(journal, config, cloud)
        if legacy:
            original_plan = service._install_plan

            def old_plan(*args, **kwargs):
                plan = original_plan(*args, **kwargs)
                plan["script_actions"] = []
                return plan

            monkeypatch.setattr(service, "_install_plan", old_plan)
        monkeypatch.setattr(controller, "_cloud", lambda _: cloud)
        monkeypatch.setattr(
            controller, "_installer", lambda cloud=None: service
        )
        base = "/api/v1/workspace-bundles/install-proposals"
        proposed = client.post(
            base,
            params=identity,
            headers=headers,
            json={
                "proposal_id": "actual",
                "request_id": "request",
                "space_id": "space-global",
                "publisher_namespace": "fixture",
                "slug": manifest.metadata.id,
                "version": manifest.metadata.revision,
            },
        )
        assert proposed.status_code == 200, proposed.text
        proposal = proposed.json()["proposal"]
        decided = client.post(
            base + "/actual/decision",
            params=identity,
            headers=headers,
            json={
                "expected_version": proposal["version"],
                "approved": True,
                "actor_id": "fixture",
            },
        )
        assert decided.status_code == 200, decided.text
        proposal = decided.json()["proposal"]
        actions = proposal["install_plan"]["script_actions"]
        if not legacy and not unknown:
            assert actions == [
                f"skill.script.execute:{ref}"
                if kind == "skill"
                else "mcp.server.start:chosen"
            ]
            unapproved = client.post(
                base + "/actual/materialize",
                headers=headers,
                json={
                    **identity,
                    "expected_version": proposal["version"],
                    "actor_id": "fixture",
                },
            )
            assert unapproved.status_code == 409, unapproved.text
            assert (
                journal.get_latest_workspace_config_materialization(
                    "space-global"
                )
                is None
            )
        for action in actions:
            approved = client.post(
                base + "/actual/script-approvals",
                params=identity,
                headers=headers,
                json={
                    "expected_version": proposal["version"],
                    "action_id": action,
                    "actor_id": "fixture",
                },
            )
            assert approved.status_code == 200, approved.text
            proposal = approved.json()["proposal"]
        installed = client.post(
            base + "/actual/materialize",
            headers=headers,
            json={
                **identity,
                "expected_version": proposal["version"],
                "actor_id": "fixture",
            },
        )
        assert installed.status_code == 200, installed.text
        assert installed.json()["proposal"]["state"] == "materialized"
        record = journal.get_workspace_bundle_install_proposal("actual")
        bindings = journal.list_workspace_bundle_local_bindings("actual")
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
            owner_id="fixture-run",
            local_materialization=LocalMaterialization(
                bundle_proposal_id=record.proposal_id,
                bundle_proposal_version=record.version,
                bundle_binding_digest=bundle_runtime_binding_digest(
                    record, bindings, ()
                ),
                configuration_root=str(
                    state_root / "spaces/space-global/configuration"
                ),
            ),
            provider_capability=capability,
            runtime_capability_manifest={
                "workspace_bundle": {"revision_id": manifest.revision_id}
            },
        )

        def assemble(**account):
            return RuntimeEnvironmentAssembler(
                journal, state_root=state_root
            ).assemble(
                spec,
                space_id="space-global",
                space_root=space,
                **(account or identity),
            )

        def readiness(params=None):
            responses = [
                client.get(
                    url,
                    params=identity if params is None else params,
                    headers=headers,
                )
                for url in (
                    base + "/actual",
                    "/api/v1/spaces/space-global/workspace-bundle-installation",
                )
            ]
            assert all(item.status_code == 200 for item in responses)
            assert responses[0].json() == responses[1].json()
            return responses[0].json()

        return SimpleNamespace(
            assemble=assemble,
            readiness=readiness,
            installed=installed.json(),
            ref=ref,
            journal=journal,
            client=client,
        )

    return install


@pytest.mark.parametrize("kind", ["skill", "mcp"])
def test_actual_global_install_and_status_agree(
    install_global, global_configuration, kind
):
    root, _, _, _ = global_configuration
    before = _global.snapshot(root)
    installation = install_global(kind)
    assert installation.assemble() is not None
    for response in (installation.installed, installation.readiness()):
        assert response["runtime_readiness"] == "ready"
        assert response["runtime_readiness_issues"] == []
        assert "synthetic-secret-never-export" not in json.dumps(response)
    assert _global.snapshot(root) == before


@pytest.mark.parametrize("kind", ["skill", "mcp"])
@pytest.mark.parametrize("change", ["disabled", "deleted", "invalid"])
def test_installed_global_status_tracks_live_runtime(
    install_global, global_configuration, kind, change
):
    _, skill, account, mcp = global_configuration
    installation = install_global(kind)
    assert installation.readiness()["runtime_readiness"] == "ready"
    if kind == "skill":
        if change == "disabled":
            account.write_text(
                json.dumps({"skills": {"Research": {"enabled": False}}})
            )
        elif change == "deleted":
            skill.unlink()
            skill.parent.rmdir()
        else:
            skill.write_text("Invalid frontmatter")
    else:
        value = json.loads(mcp.read_text())
        if change == "disabled":
            value["mcpServers"]["Configured MCP"]["disabled"] = True
        elif change == "deleted":
            value["mcpServers"].clear()
        else:
            value["mcpServers"]["Configured MCP"] = {}
        mcp.write_text(json.dumps(value))
    reason = (
        "global_resource_disabled"
        if change == "disabled"
        else f"global_{kind}_{'unavailable' if change == 'deleted' else 'invalid'}"
    )
    payload = installation.readiness()
    assert payload["runtime_readiness"] == "unavailable"
    assert reason in payload["runtime_readiness_issues"]
    with pytest.raises(EnvironmentSetupRequiredError, match=reason):
        installation.assemble()


@pytest.mark.parametrize("kind", ["skill", "mcp"])
def test_unknown_registry_stays_unavailable_after_actual_install(
    install_global, kind
):
    installation = install_global(kind, unknown=True)
    payload = installation.readiness()
    assert payload["runtime_readiness"] == "unavailable"
    assert (
        "registry_dependencies_unmaterialized"
        in payload["runtime_readiness_issues"]
    )
    with pytest.raises(EnvironmentSetupRequiredError):
        installation.assemble()


@pytest.mark.parametrize("principal_kind", ["desktop_renderer", "brain_user"])
@pytest.mark.parametrize("user_id", ["7", "8"])
def test_installed_skill_readiness_uses_authenticated_identity(
    install_global, principal_kind, user_id
):
    installation = install_global("skill")

    async def principal(request: Request):
        value = LocalControlPrincipal(kind=principal_kind, user_id=user_id)
        request.state.local_control_principal = value
        return value

    installation.client.app.dependency_overrides[
        require_local_control_principal
    ] = principal
    # Desktop passes the current renderer account; Brain ignores this spoofed
    # query and uses only its authenticated user, without a legacy email merge.
    query = {
        "email": "fixture@example.test",
        "user_id": "8" if user_id == "7" else "7",
    }
    effective = (
        query["user_id"] if principal_kind == "desktop_renderer" else user_id
    )
    payload = installation.readiness(query)
    if effective == "7":
        assert payload["runtime_readiness"] == "ready"
        assert installation.assemble(user_id=effective, email="") is not None
    else:
        assert payload["runtime_readiness"] == "unavailable"
        assert (
            "global_resource_disabled" in payload["runtime_readiness_issues"]
        )
        with pytest.raises(
            EnvironmentSetupRequiredError, match="global_resource_disabled"
        ):
            installation.assemble(user_id=effective, email="")


def test_installed_skill_requires_identity_and_ignores_untrusted_principal(
    install_global,
):
    installation = install_global("skill")
    assert (
        "global_skill_identity_required"
        in installation.readiness({})["runtime_readiness_issues"]
    )

    async def missing_principal():
        return None

    installation.client.app.dependency_overrides[
        require_local_control_principal
    ] = missing_principal
    payload = installation.readiness()
    assert payload["runtime_readiness"] == "unavailable"
    assert (
        "global_skill_identity_required" in payload["runtime_readiness_issues"]
    )


@pytest.mark.parametrize("wrong_binding_kind", [False, True])
def test_legacy_empty_plan_never_grants_global_skill_execution(
    install_global, monkeypatch, wrong_binding_kind
):
    installation = install_global("skill", legacy=True)
    action = f"skill.script.execute:{installation.ref}"
    assert (
        installation.installed["proposal"]["install_plan"]["script_actions"]
        == []
    )
    assert (
        installation.journal.list_workspace_bundle_local_bindings("actual")
        == ()
    )
    if wrong_binding_kind:
        # A negative historical/corrupt snapshot: matching slot ID alone is
        # not an execution approval. This is never used in a positive case.
        wrong = WorkspaceBundleLocalBindingRecord(
            binding_id="wrong-kind",
            proposal_id="actual",
            slot_id=action,
            binding_kind="local_path",
            connector_id=None,
            opaque_connection_id=None,
            local_path="/synthetic",
            required_grants=(),
            authorized_by="fixture",
            authorized_at=1.0,
        )
        monkeypatch.setattr(
            installation.journal,
            "list_workspace_bundle_local_bindings",
            lambda _: (wrong,),
        )
    payload = installation.readiness()
    assert payload["runtime_readiness"] == "unavailable"
    assert (
        f"script_approval_missing:{action}"
        in payload["runtime_readiness_issues"]
    )
    if not wrong_binding_kind:
        with pytest.raises(
            EnvironmentSetupRequiredError, match="script_approval_missing"
        ):
            installation.assemble()
