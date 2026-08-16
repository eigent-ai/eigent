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

import hashlib
import json
import stat
import subprocess

import pytest

from app.run_journal import InvalidRunTransitionError, SQLiteRunJournal
from app.workspace_bundle import (
    WorkspaceBundleBindingsIncomplete,
    WorkspaceBundleInstaller,
    WorkspaceBundleInstallError,
    WorkspaceSecretVerification,
)
from app.workspace_config import (
    ConfigPlacement,
    WorkspaceBundleManifest,
    canonical_digest,
)
from app.workspace_git import ConfigurationRepositoryService, GitBackend


def _manifest(revision: int = 1) -> dict:
    return {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkspaceBundle",
        "metadata": {
            "id": "bundle-research",
            "name": "Research Workforce",
            "revision": revision,
        },
        "spec": {
            "instructions": {
                "coordinator": "bundle://instructions/coordinator.md"
            },
            "context": [
                {
                    "id": "docs",
                    "kind": "local_path_slot",
                    "slot": "docs_folder",
                }
            ],
            "skills": [
                {
                    "ref": "bundle://skills/research.py",
                    "assignTo": ["lead"],
                }
            ],
            "connectors": [
                {
                    "id": "source",
                    "connector": "github",
                    "connectionSlot": "github_readonly",
                    "requiredGrants": ["repository.read"],
                }
            ],
            "mcpServers": [],
            "agents": [
                {
                    "id": "lead",
                    "role": "coordinator",
                    "modelProfile": "default",
                }
            ],
            "models": {
                "default": {
                    "modelRef": "provider://default",
                    "thinkingEffort": "high",
                }
            },
            "permissions": {"profile": "request_approval", "rules": []},
            "git": {
                "enabled": True,
                "checkpointPolicy": "user_and_run_terminal",
                "agentIsolation": "worktree",
                "remotePolicy": "prompt",
            },
        },
    }


class FakeCloud:
    def __init__(self, *, lose_projection_response_once: bool = False):
        self.contents = {
            "asset-instruction": b"Coordinate the research.\n",
            "asset-skill": b"def run():\n    return 'ok'\n",
            "asset-instruction-v2": b"Coordinate the upgraded research.\n",
            "asset-skill-v2": b"def run():\n    return 'v2'\n",
        }
        self.installation_version = 0
        self.installed_bundle_id: str | None = None
        self.installed_revision_id: str | None = None
        self.binding: tuple[str, str] | None = None
        self.binding_payloads: list[dict] = []
        self.confirm_payloads: list[dict] = []
        self.projection: dict | None = None
        self.projections: dict[str, dict] = {}
        self.lose_projection_response_once = lose_projection_response_once
        self.protocol_capabilities = [
            "bundle.asset.integrity.v1",
            "bundle.install.review.v1",
        ]
        self.executable_asset_ids: set[str] = set()

    async def get_catalog_revision(self, publisher_namespace, slug, version):
        revision_number = int(version)
        bundle_id = slug
        revision_id = f"{slug}@{version}"
        manifest = WorkspaceBundleManifest.model_validate(
            _manifest(revision_number)
        ).canonical_payload()
        suffix = "" if revision_number == 1 else f"-v{revision_number}"
        return {
            "id": revision_id,
            "bundle_id": bundle_id,
            "revision_id": revision_id,
            "publisher_namespace": publisher_namespace,
            "slug": slug,
            "version": version,
            "status": "published",
            "manifest": manifest,
            "manifest_digest": canonical_digest(manifest),
            "assets": [
                self._asset(
                    f"asset-instruction{suffix}",
                    "instructions/coordinator.md",
                ),
                self._asset(f"asset-skill{suffix}", "skills/research.py"),
            ],
        }

    def _asset(self, asset_id: str, logical_path: str):
        content = self.contents[asset_id]
        return {
            "id": asset_id,
            "logical_path": logical_path,
            "content_digest": hashlib.sha256(content).hexdigest(),
            "media_type": "text/plain",
            "size_bytes": len(content),
            "provenance": "bundle_author",
            "executable": asset_id in self.executable_asset_ids,
        }

    async def install(self, space_id, bundle_id, revision_id):
        self.installed_bundle_id = bundle_id
        self.installed_revision_id = revision_id
        return {
            "space_id": space_id,
            "bundle_id": bundle_id,
            "installed_revision_id": revision_id,
            "state": "proposed",
            "version": self.installation_version,
        }

    async def confirm_install(self, space_id, payload):
        self.confirm_payloads.append(dict(payload))
        assert payload["bundle_id"] == self.installed_bundle_id
        assert payload["revision_id"] == self.installed_revision_id
        assert payload["expected_version"] == self.installation_version
        self.installation_version += 1
        return {
            "space_id": space_id,
            "bundle_id": self.installed_bundle_id,
            "installed_revision_id": self.installed_revision_id,
            "state": (
                "ready_to_materialize" if self.binding else "pending_bindings"
            ),
            "version": self.installation_version,
        }

    async def get_environment(self, space_id):
        if self.installed_revision_id is None:
            return {
                "installation": None,
                "bindings": {},
                "protocol_capabilities": self.protocol_capabilities,
            }
        return {
            "installation": {
                "space_id": space_id,
                "bundle_id": self.installed_bundle_id,
                "installed_revision_id": self.installed_revision_id,
                "state": "materialized"
                if self.projection
                else "pending_bindings",
                "version": self.installation_version,
            },
            "bindings": {},
            "protocol_capabilities": self.protocol_capabilities,
        }

    async def upgrade(
        self,
        space_id,
        *,
        revision_id,
        expected_installed_revision_id,
        expected_version,
    ):
        assert self.installed_revision_id == expected_installed_revision_id
        assert self.installation_version == expected_version
        self.installed_revision_id = revision_id
        self.installation_version += 1
        return {
            "space_id": space_id,
            "bundle_id": self.installed_bundle_id,
            "installed_revision_id": revision_id,
            "state": "proposed",
            "version": self.installation_version,
        }

    async def bind_connection(self, space_id, payload):
        self.binding_payloads.append(dict(payload))
        requested = (payload["slot_id"], payload["connection_id"])
        if self.binding != requested:
            self.binding = requested
            self.installation_version += 1
        return {
            "space_id": space_id,
            "state": "ready_to_materialize",
            "version": self.installation_version,
        }

    async def download_asset(self, bundle_id, revision_id, asset_id):
        return self.contents[asset_id]

    async def put_environment_projection(self, payload):
        projection_id = payload["projection_id"]
        if projection_id not in self.projections:
            self.projections[projection_id] = payload
            self.projection = payload
            self.installation_version += 1
            if self.lose_projection_response_once:
                self.lose_projection_response_once = False
                raise RuntimeError("response lost after Cloud commit")
        assert {
            key: value
            for key, value in self.projections[projection_id].items()
            if key != "installation_version"
        } == {
            key: value
            for key, value in payload.items()
            if key != "installation_version"
        }
        return self.projections[projection_id]

    async def close(self):
        return None


class FakeSecretBroker:
    def __init__(self):
        self.verified = []
        self.batches = []
        self.rejected: set[str] = set()

    def verify_many(self, identities):
        batch = tuple(identities)
        self.batches.append(batch)
        self.verified.extend(batch)
        return tuple(
            WorkspaceSecretVerification(
                identity=identity,
                state=(
                    "needs_rebind"
                    if identity.secret_ref in self.rejected
                    else "available"
                ),
            )
            for identity in batch
        )


@pytest.fixture
def installer(tmp_path):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir()
    config = ConfigurationRepositoryService(
        journal,
        state_root=tmp_path / "state",
        git_backend=GitBackend(hooks_path=hooks),
    )
    cloud = FakeCloud()
    value = WorkspaceBundleInstaller(journal, config, cloud)
    try:
        yield value, journal, cloud, tmp_path
    finally:
        journal.close()


def test_local_review_decision_does_not_require_cloud(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        manifest = WorkspaceBundleManifest.model_validate(
            _manifest()
        ).canonical_payload()
        proposal = journal.put_workspace_bundle_install_proposal(
            proposal_id="offline-proposal",
            request_id="offline-request",
            space_id="space-1",
            bundle_id="bundle-research",
            revision_id="bundle-research@1",
            config_placement="sidecar",
            manifest=manifest,
            assets=[],
            install_plan={
                "connector_slots": [],
                "local_path_slots": [],
                "script_actions": [],
                "permission_profile": "request_approval",
                "git_policy": {},
                "automatic_grants": [],
            },
        )
        service = WorkspaceBundleInstaller(
            journal,
            ConfigurationRepositoryService(
                journal,
                state_root=tmp_path / "state",
                git_backend=GitBackend(hooks_path=tmp_path / "hooks"),
            ),
            cloud=None,
        )

        decided = service.decide(
            proposal.proposal_id,
            expected_version=proposal.version,
            approved=True,
            decided_by="user-1",
        )

        assert decided.state == "approved"


async def _approved_and_bound(installer, journal, tmp_path):
    proposal = await installer.propose(
        proposal_id="proposal-1",
        request_id="request-1",
        space_id="space-1",
        publisher_namespace="user-7",
        slug="bundle-research",
        version=1,
        config_placement=ConfigPlacement.SIDECAR,
    )
    assert proposal.state == "proposed"
    assert proposal.install_plan["automatic_grants"] == []
    with pytest.raises(InvalidRunTransitionError):
        installer.bind_connector(
            proposal.proposal_id,
            expected_version=proposal.version,
            slot_id="github_readonly",
            connector_id="github",
            opaque_connection_id="connection-1",
            authorized_by="user-1",
        )
    proposal = installer.decide(
        proposal.proposal_id,
        expected_version=proposal.version,
        approved=True,
        decided_by="user-1",
    )
    decision_replay = installer.decide(
        proposal.proposal_id,
        expected_version=0,
        approved=True,
        decided_by="user-1",
    )
    assert decision_replay == proposal
    with pytest.raises(WorkspaceBundleBindingsIncomplete) as missing:
        await installer.materialize(
            proposal.proposal_id,
            expected_version=proposal.version,
            space_root=tmp_path,
            actor_id="user-1",
        )
    assert set(missing.value.missing_slots) == {
        "docs_folder",
        "github_readonly",
        "skill.script.execute:bundle://skills/research.py",
    }
    connector_expected_version = proposal.version
    connector_binding, proposal = installer.bind_connector(
        proposal.proposal_id,
        expected_version=proposal.version,
        slot_id="github_readonly",
        connector_id="github",
        opaque_connection_id="connection-1",
        authorized_by="user-1",
    )
    replay_binding, replay_proposal = installer.bind_connector(
        proposal.proposal_id,
        expected_version=connector_expected_version,
        slot_id="github_readonly",
        connector_id="github",
        opaque_connection_id="connection-1",
        authorized_by="user-1",
    )
    assert replay_binding == connector_binding
    assert replay_proposal == proposal
    docs = tmp_path / "user-selected-docs"
    docs.mkdir()
    _, proposal = installer.bind_local_path(
        proposal.proposal_id,
        expected_version=proposal.version,
        slot_id="docs_folder",
        local_path=docs,
        authorized_by="user-1",
    )
    _, proposal = installer.approve_script_action(
        proposal.proposal_id,
        expected_version=proposal.version,
        action_id="skill.script.execute:bundle://skills/research.py",
        authorized_by="user-1",
    )
    assert len(journal.list_workspace_bundle_local_bindings("proposal-1")) == 3
    return proposal


@pytest.mark.asyncio
async def test_install_is_review_first_and_materializes_verified_assets(
    installer,
):
    service, journal, cloud, tmp_path = installer
    proposal = await _approved_and_bound(service, journal, tmp_path)

    result = await service.materialize(
        proposal.proposal_id,
        expected_version=proposal.version,
        space_root=tmp_path,
        actor_id="user-1",
    )
    replay = await service.materialize(
        proposal.proposal_id,
        expected_version=proposal.version,
        space_root=tmp_path,
        actor_id="user-1",
    )

    assert result.state == "materialized"
    assert replay == result
    assert cloud.binding == ("github_readonly", "connection-1")
    assert cloud.confirm_payloads[0]["reviewed_slots"] == [
        {
            "slot_id": "github_readonly",
            "connector_id": "github",
            "required_grants": ["repository.read"],
        }
    ]
    assert cloud.binding_payloads[0]["acknowledged_grants"] == [
        "repository.read"
    ]
    assert cloud.projection is not None
    assert cloud.projection["projection_id"] == (
        WorkspaceBundleInstaller._environment_projection_id(
            space_id="space-1",
            owner_type="space",
            owner_id="space-1",
            semantic_spec_digest=cloud.projection["semantic_spec_digest"],
            projection_digest=cloud.projection["projection_digest"],
            redaction_schema_version=1,
        )
    )
    serialized_projection = str(cloud.projection)
    assert "connection-1" not in serialized_projection
    assert str(tmp_path) not in serialized_projection
    config_root = tmp_path / "state/spaces/space-1/configuration"
    assert (config_root / "instructions/coordinator.md").is_file()
    assert (config_root / "skills/research.py").is_file()
    paths = subprocess.run(
        ("git", "-C", str(config_root), "show", "--name-only", "--format="),
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    assert set(paths) == {
        "instructions/coordinator.md",
        "skills/research.py",
        "workspace.lock",
        "workspace.yaml",
    }


@pytest.mark.asyncio
async def test_materialize_requires_cloud_protocol_before_mutation(installer):
    service, journal, cloud, tmp_path = installer
    proposal = await _approved_and_bound(service, journal, tmp_path)
    cloud.protocol_capabilities = []

    with pytest.raises(
        WorkspaceBundleInstallError,
        match="Cloud must be upgraded",
    ):
        await service.materialize(
            proposal.proposal_id,
            expected_version=proposal.version,
            space_root=tmp_path,
            actor_id="user-1",
        )

    assert cloud.installed_bundle_id is None
    assert cloud.projection is None


@pytest.mark.asyncio
async def test_materialize_treats_missing_protocol_field_as_legacy_cloud(
    installer,
):
    service, journal, cloud, tmp_path = installer
    proposal = await _approved_and_bound(service, journal, tmp_path)
    get_environment = cloud.get_environment

    async def legacy_environment(space_id):
        environment = await get_environment(space_id)
        environment.pop("protocol_capabilities", None)
        return environment

    cloud.get_environment = legacy_environment
    materialized = await service.materialize(
        proposal.proposal_id,
        expected_version=proposal.version,
        space_root=tmp_path,
        actor_id="user-1",
    )

    assert materialized.state == "materialized"
    assert cloud.projection is not None


@pytest.mark.asyncio
async def test_materialize_restores_reviewed_executable_asset_mode(installer):
    service, journal, cloud, tmp_path = installer
    cloud.executable_asset_ids.add("asset-skill")
    proposal = await _approved_and_bound(service, journal, tmp_path)

    materialized = await service.materialize(
        proposal.proposal_id,
        expected_version=proposal.version,
        space_root=tmp_path,
        actor_id="user-1",
    )

    assert materialized.state == "materialized"
    executable = (
        tmp_path / "state/spaces/space-1/configuration/skills/research.py"
    )
    assert stat.S_IMODE(executable.stat().st_mode) == 0o755
    lock = (
        tmp_path / "state/spaces/space-1/configuration/workspace.lock"
    ).read_text(encoding="utf-8")
    assert "executable: true" in lock


def test_asset_descriptor_rejects_non_boolean_executable_metadata():
    with pytest.raises(
        WorkspaceBundleInstallError,
        match="executable metadata is invalid",
    ):
        WorkspaceBundleInstaller._validate_asset_descriptor(
            {
                "id": "asset-1",
                "logical_path": "assets/tool",
                "content_digest": "a" * 64,
                "media_type": "application/octet-stream",
                "size_bytes": 1,
                "executable": "false",
            }
        )


@pytest.mark.asyncio
async def test_materialize_rejects_secret_bearing_downloaded_script(installer):
    service, journal, cloud, tmp_path = installer
    cloud.contents["asset-skill"] = (
        b"API_KEY = '"
        + b"sk-"
        + b"abcdefghijklmnopqrstuvwxyzABCDEF12345678'\n"
    )
    proposal = await _approved_and_bound(service, journal, tmp_path)

    with pytest.raises(
        WorkspaceBundleInstallError,
        match="failed the local safety scan",
    ):
        await service.materialize(
            proposal.proposal_id,
            expected_version=proposal.version,
            space_root=tmp_path,
            actor_id="user-1",
        )

    config_root = tmp_path / "state/spaces/space-1/configuration"
    assert not (config_root / "skills/research.py").exists()


@pytest.mark.asyncio
async def test_required_local_values_block_before_cloud_and_optional_env_does_not(
    installer,
):
    service, journal, cloud, tmp_path = installer
    manifest = _manifest()
    manifest["spec"].update(
        {
            "instructions": {},
            "context": [],
            "skills": [],
            "connectors": [],
            "environment": {
                "variables": [
                    {
                        "name": "API_TOKEN",
                        "required": True,
                        "sensitive": True,
                    },
                    {
                        "name": "LOG_LEVEL",
                        "required": False,
                        "sensitive": False,
                        "example": "info",
                    },
                ]
            },
            "mcpServers": [
                {
                    "id": "linear",
                    "definition": "bundle://mcp/linear.json",
                    "secretSlots": ["LINEAR_API_TOKEN"],
                    "assignTo": ["lead"],
                }
            ],
        }
    )

    async def get_catalog_revision(publisher_namespace, slug, version):
        bundle_id = slug
        revision_id = f"{slug}@{version}"
        canonical = WorkspaceBundleManifest.model_validate(
            manifest
        ).canonical_payload()
        definition = json.dumps(
            {
                "mcpServers": {
                    "linear": {
                        "command": "python",
                        "args": ["-c", "print('ready')"],
                        "env": {
                            "LINEAR_TOKEN": "slot://LINEAR_API_TOKEN",
                            "LOG_LEVEL": "info",
                        },
                    }
                }
            },
            sort_keys=True,
        ).encode()
        cloud.contents["asset-mcp-linear"] = definition
        return {
            "id": revision_id,
            "bundle_id": bundle_id,
            "revision_id": revision_id,
            "publisher_namespace": publisher_namespace,
            "slug": slug,
            "version": version,
            "status": "published",
            "manifest": canonical,
            "manifest_digest": canonical_digest(canonical),
            "assets": [
                {
                    "id": "asset-mcp-linear",
                    "logical_path": "mcp/linear.json",
                    "content_digest": hashlib.sha256(definition).hexdigest(),
                    "media_type": "application/json",
                    "size_bytes": len(definition),
                    "provenance": "bundle_author",
                    "executable": False,
                }
            ],
        }

    cloud.get_catalog_revision = get_catalog_revision
    broker = FakeSecretBroker()
    service.secret_broker = broker
    proposal = await service.propose(
        proposal_id="proposal-values",
        request_id="request-values",
        space_id="space-1",
        publisher_namespace="user-7",
        slug="bundle-research",
        version=1,
        config_placement=ConfigPlacement.SIDECAR,
    )
    assert proposal.install_plan["environment_requirements"] == [
        {
            "requirement_key": "environment:API_TOKEN",
            "name": "API_TOKEN",
            "required": True,
            "sensitive": True,
            "description": None,
            "example": None,
        },
        {
            "requirement_key": "environment:LOG_LEVEL",
            "name": "LOG_LEVEL",
            "required": False,
            "sensitive": False,
            "description": None,
            "example": "info",
        },
    ]
    assert proposal.install_plan["mcp_secret_requirements"] == [
        {
            "requirement_key": "mcp_secret:linear:LINEAR_API_TOKEN",
            "mcp_id": "linear",
            "slot_id": "LINEAR_API_TOKEN",
            "required": True,
        }
    ]
    destination = proposal.install_plan["mcp_destinations"][0]
    assert destination["destination_kind"] == "stdio"
    assert destination["cwd_scope"] == "bundle://mcp"
    assert destination["secret_environment_bindings"] == [
        {
            "slot_id": "LINEAR_API_TOKEN",
            "environment_variable": "LINEAR_TOKEN",
        }
    ]
    assert destination["public_environment"] == [
        {
            "name": "LOG_LEVEL",
            "value_digest": canonical_digest("info"),
        }
    ]
    assert "LINEAR_API_TOKEN" not in str(destination["public_environment"])
    proposal = service.decide(
        proposal.proposal_id,
        expected_version=proposal.version,
        approved=True,
        decided_by="user-1",
    )

    with pytest.raises(WorkspaceBundleBindingsIncomplete) as missing:
        await service.materialize(
            proposal.proposal_id,
            expected_version=proposal.version,
            space_root=tmp_path,
            actor_id="user-1",
        )
    assert set(missing.value.missing_slots) == {
        "environment:API_TOKEN",
        "mcp.server.start:linear",
        "mcp_secret:linear:LINEAR_API_TOKEN",
    }
    assert cloud.installed_bundle_id is None

    with pytest.raises(WorkspaceBundleBindingsIncomplete):
        service.approve_script_action(
            proposal.proposal_id,
            expected_version=proposal.version,
            action_id="mcp.server.start:linear",
            authorized_by="user-1",
        )

    _, proposal = service.bind_local_values(
        proposal.proposal_id,
        client_request_id="bind-values-1",
        expected_version=proposal.version,
        authorized_by="user-1",
        bindings=[
            {
                "requirement_key": "environment:API_TOKEN",
                "requirement_kind": "environment",
                "secret_ref": f"wsvault_{'E' * 32}",
                "account_scope_digest": "a" * 64,
            },
            {
                "requirement_key": "mcp_secret:linear:LINEAR_API_TOKEN",
                "requirement_kind": "mcp_secret",
                "secret_ref": f"wsvault_{'M' * 32}",
                "account_scope_digest": "a" * 64,
            },
        ],
    )
    approval, proposal = service.approve_script_action(
        proposal.proposal_id,
        expected_version=proposal.version,
        action_id="mcp.server.start:linear",
        authorized_by="user-1",
    )
    assert len(approval.required_grants) == 2
    result = await service.materialize(
        proposal.proposal_id,
        expected_version=proposal.version,
        space_root=tmp_path,
        actor_id="user-1",
    )

    assert result.state == "materialized"
    assert {item.slot_id for item in broker.verified} == {
        "environment:API_TOKEN",
        "mcp_secret:linear:LINEAR_API_TOKEN",
    }
    assert [len(batch) for batch in broker.batches] == [2, 2]


@pytest.mark.asyncio
async def test_registry_secret_mcp_cannot_be_approved_or_reported_ready(
    installer,
):
    service, _, cloud, _ = installer
    manifest = _manifest()
    manifest["spec"]["context"] = []
    manifest["spec"]["skills"] = []
    manifest["spec"]["connectors"] = []
    manifest["spec"]["mcpServers"] = [
        {
            "id": "private",
            "definition": "registry://mcp/private@1",
            "secretSlots": ["TOKEN"],
            "assignTo": ["lead"],
        }
    ]

    async def get_catalog_revision(publisher_namespace, slug, version):
        bundle_id = slug
        revision_id = f"{slug}@{version}"
        canonical = WorkspaceBundleManifest.model_validate(
            manifest
        ).canonical_payload()
        return {
            "id": revision_id,
            "bundle_id": bundle_id,
            "revision_id": revision_id,
            "publisher_namespace": publisher_namespace,
            "slug": slug,
            "version": version,
            "status": "published",
            "manifest": canonical,
            "manifest_digest": canonical_digest(canonical),
            "assets": [],
        }

    cloud.get_catalog_revision = get_catalog_revision
    proposal = await service.propose(
        proposal_id="proposal-registry-secret",
        request_id="request-registry-secret",
        space_id="space-1",
        publisher_namespace="user-7",
        slug="bundle-research",
        version=1,
        config_placement=ConfigPlacement.SIDECAR,
    )
    destination = proposal.install_plan["mcp_destinations"][0]
    assert destination["attestation_digest"] is None
    assert destination["availability_issue"] == "registry_mcp_unmaterialized"
    with pytest.raises(
        WorkspaceBundleInstallError,
        match="registry_mcp_unmaterialized",
    ):
        service.approve_script_action(
            proposal.proposal_id,
            expected_version=proposal.version,
            action_id="mcp.server.start:private",
            authorized_by="user-1",
        )
    assert cloud.installed_bundle_id is None


@pytest.mark.asyncio
async def test_proposal_rejects_mcp_definition_digest_mismatch(installer):
    service, _, cloud, _ = installer
    manifest = _manifest()
    manifest["spec"]["context"] = []
    manifest["spec"]["skills"] = []
    manifest["spec"]["connectors"] = []
    manifest["spec"]["mcpServers"] = [
        {
            "id": "private",
            "definition": "bundle://mcp/private.json",
            "secretSlots": ["TOKEN"],
            "assignTo": ["lead"],
        }
    ]
    content = json.dumps(
        {
            "mcpServers": {
                "private": {
                    "command": "python",
                    "env": {"TOKEN": "slot://TOKEN"},
                }
            }
        }
    ).encode()
    cloud.contents["asset-mcp-private"] = content

    async def get_catalog_revision(publisher_namespace, slug, version):
        bundle_id = slug
        revision_id = f"{slug}@{version}"
        canonical = WorkspaceBundleManifest.model_validate(
            manifest
        ).canonical_payload()
        return {
            "id": revision_id,
            "bundle_id": bundle_id,
            "revision_id": revision_id,
            "publisher_namespace": publisher_namespace,
            "slug": slug,
            "version": version,
            "status": "published",
            "manifest": canonical,
            "manifest_digest": canonical_digest(canonical),
            "assets": [
                {
                    "id": "asset-mcp-private",
                    "logical_path": "mcp/private.json",
                    "content_digest": "0" * 64,
                    "media_type": "application/json",
                    "size_bytes": len(content),
                    "provenance": "bundle_author",
                    "executable": False,
                }
            ],
        }

    cloud.get_catalog_revision = get_catalog_revision
    with pytest.raises(
        WorkspaceBundleInstallError,
        match="MCP destination review failed",
    ):
        await service.propose(
            proposal_id="proposal-digest-mismatch",
            request_id="request-digest-mismatch",
            space_id="space-1",
            publisher_namespace="user-7",
            slug="bundle-research",
            version=1,
            config_placement=ConfigPlacement.SIDECAR,
        )


@pytest.mark.asyncio
async def test_unreadable_bound_value_blocks_all_cloud_side_effects(installer):
    service, _, cloud, tmp_path = installer
    manifest = _manifest()
    manifest["spec"]["context"] = []
    manifest["spec"]["skills"] = []
    manifest["spec"]["connectors"] = []
    manifest["spec"]["environment"] = {
        "variables": [{"name": "API_TOKEN", "required": True}]
    }

    async def get_catalog_revision(publisher_namespace, slug, version):
        bundle_id = slug
        revision_id = f"{slug}@{version}"
        canonical = WorkspaceBundleManifest.model_validate(
            manifest
        ).canonical_payload()
        return {
            "id": revision_id,
            "bundle_id": bundle_id,
            "revision_id": revision_id,
            "publisher_namespace": publisher_namespace,
            "slug": slug,
            "version": version,
            "status": "published",
            "manifest": canonical,
            "manifest_digest": canonical_digest(canonical),
            "assets": [],
        }

    cloud.get_catalog_revision = get_catalog_revision
    broker = FakeSecretBroker()
    service.secret_broker = broker
    proposal = await service.propose(
        proposal_id="proposal-unreadable",
        request_id="request-unreadable",
        space_id="space-1",
        publisher_namespace="user-7",
        slug="bundle-research",
        version=1,
        config_placement=ConfigPlacement.SIDECAR,
    )
    proposal = service.decide(
        proposal.proposal_id,
        expected_version=proposal.version,
        approved=True,
        decided_by="user-1",
    )
    _, proposal = service.bind_local_values(
        proposal.proposal_id,
        client_request_id="bind-unreadable",
        expected_version=proposal.version,
        authorized_by="user-1",
        bindings=[
            {
                "requirement_key": "environment:API_TOKEN",
                "requirement_kind": "environment",
                "secret_ref": f"wsvault_{'U' * 32}",
                "account_scope_digest": "a" * 64,
            }
        ],
    )
    broker.rejected.add(f"wsvault_{'U' * 32}")

    with pytest.raises(WorkspaceBundleBindingsIncomplete):
        await service.materialize(
            proposal.proposal_id,
            expected_version=proposal.version,
            space_root=tmp_path,
            actor_id="user-1",
        )

    assert cloud.installed_bundle_id is None
    assert cloud.projection is None
    assert [len(batch) for batch in broker.batches] == [1, 1]


def test_legacy_install_plan_without_local_value_requirements_is_supported(
    installer,
):
    service, journal, _, _ = installer
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-legacy-plan",
        request_id="request-legacy-plan",
        space_id="space-1",
        bundle_id="bundle-research",
        revision_id="bundle-research@1",
        config_placement="sidecar",
        manifest=_manifest(),
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
        },
    )
    proposal = service.decide(
        proposal.proposal_id,
        expected_version=proposal.version,
        approved=True,
        decided_by="user-1",
    )

    service._require_complete_bindings(proposal, (), ())


@pytest.mark.asyncio
async def test_projection_response_loss_retries_without_duplicate_grants(
    tmp_path,
):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir()
    cloud = FakeCloud(lose_projection_response_once=True)
    service = WorkspaceBundleInstaller(
        journal,
        ConfigurationRepositoryService(
            journal,
            state_root=tmp_path / "state",
            git_backend=GitBackend(hooks_path=hooks),
        ),
        cloud,
    )
    try:
        proposal = await _approved_and_bound(service, journal, tmp_path)
        with pytest.raises(RuntimeError, match="response lost"):
            await service.materialize(
                proposal.proposal_id,
                expected_version=proposal.version,
                space_root=tmp_path,
                actor_id="user-1",
            )
        failed = journal.get_workspace_bundle_install_proposal("proposal-1")
        assert failed is not None and failed.state == "needs_attention"
        installed = await service.materialize(
            proposal.proposal_id,
            expected_version=failed.version,
            space_root=tmp_path,
            actor_id="user-1",
        )
        assert installed.state == "materialized"
        assert cloud.installation_version == 3
    finally:
        journal.close()


@pytest.mark.asyncio
async def test_upgrade_reviews_again_and_commits_new_configuration(installer):
    service, journal, cloud, tmp_path = installer
    first = await _approved_and_bound(service, journal, tmp_path)
    first = await service.materialize(
        first.proposal_id,
        expected_version=first.version,
        space_root=tmp_path,
        actor_id="user-1",
    )
    assert first.state == "materialized"

    second = await service.propose(
        proposal_id="proposal-2",
        request_id="request-2",
        space_id="space-1",
        publisher_namespace="user-7",
        slug="bundle-research",
        version=2,
        config_placement=ConfigPlacement.SIDECAR,
    )
    assert second.state == "proposed"
    second = service.decide(
        second.proposal_id,
        expected_version=second.version,
        approved=True,
        decided_by="user-1",
    )
    _, second = service.bind_connector(
        second.proposal_id,
        expected_version=second.version,
        slot_id="github_readonly",
        connector_id="github",
        opaque_connection_id="connection-1",
        authorized_by="user-1",
    )
    docs = tmp_path / "user-selected-docs"
    _, second = service.bind_local_path(
        second.proposal_id,
        expected_version=second.version,
        slot_id="docs_folder",
        local_path=docs,
        authorized_by="user-1",
    )
    _, second = service.approve_script_action(
        second.proposal_id,
        expected_version=second.version,
        action_id="skill.script.execute:bundle://skills/research.py",
        authorized_by="user-1",
    )
    second = await service.materialize(
        second.proposal_id,
        expected_version=second.version,
        space_root=tmp_path,
        actor_id="user-1",
    )

    assert second.state == "materialized"
    assert cloud.installed_revision_id == "bundle-research@2"
    assert len(cloud.projections) == 2
    config_root = tmp_path / "state/spaces/space-1/configuration"
    assert (config_root / "instructions/coordinator.md").read_bytes() == (
        b"Coordinate the upgraded research.\n"
    )
    assert (
        int(
            subprocess.run(
                ("git", "-C", str(config_root), "rev-list", "--count", "HEAD"),
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        )
        == 2
    )


@pytest.mark.asyncio
async def test_materialized_local_rebind_requires_and_completes_cloud_resync(
    installer,
):
    service, journal, cloud, tmp_path = installer
    proposal = await _approved_and_bound(service, journal, tmp_path)
    installed = await service.materialize(
        proposal.proposal_id,
        expected_version=proposal.version,
        space_root=tmp_path,
        actor_id="user-1",
    )
    first_projection_id = cloud.projection["projection_id"]
    replacement = tmp_path / "replacement-docs"
    replacement.mkdir()

    _, pending = service.bind_connector(
        installed.proposal_id,
        expected_version=installed.version,
        slot_id="github_readonly",
        connector_id="github",
        opaque_connection_id="connection-2",
        authorized_by="user-1",
    )
    _, pending = service.bind_local_path(
        installed.proposal_id,
        expected_version=pending.version,
        slot_id="docs_folder",
        local_path=replacement,
        authorized_by="user-1",
    )

    assert pending.state == "needs_attention"
    assert pending.error_code == "bundle_reconfiguration_pending"
    resynced = await service.materialize(
        pending.proposal_id,
        expected_version=pending.version,
        space_root=tmp_path,
        actor_id="user-1",
    )
    assert resynced.state == "materialized"
    assert cloud.projection["projection_id"] != first_projection_id
    assert len(cloud.projections) == 2
    assert cloud.binding == ("github_readonly", "connection-2")


def test_startup_reconciliation_exposes_interrupted_materialization(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        proposal = journal.put_workspace_bundle_install_proposal(
            proposal_id="proposal-crash",
            request_id="request-crash",
            space_id="space-1",
            bundle_id="bundle-research",
            revision_id="bundle-research@1",
            config_placement="sidecar",
            manifest=WorkspaceBundleManifest.model_validate(
                _manifest()
            ).canonical_payload(),
            assets=[],
            install_plan={
                "connector_slots": [],
                "local_path_slots": [],
                "script_actions": [],
                "permission_profile": "request_approval",
                "git_policy": {},
                "automatic_grants": [],
            },
        )
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="approved",
            decided_by="user-1",
        )
        journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="materializing",
        )

    with SQLiteRunJournal(path) as reopened:
        result = reopened.reconcile_startup(now=10)
        proposal = reopened.get_workspace_bundle_install_proposal(
            "proposal-crash"
        )

        assert result.reconcilable_bundle_install_ids == ("proposal-crash",)
        assert proposal is not None and proposal.state == "needs_attention"
        assert proposal.error_code == (
            "desktop_restarted_during_materialization"
        )
