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

import pytest
from pydantic import ValidationError

from app.controller import workspace_bundle_controller
from app.run_journal import SQLiteRunJournal
from app.workspace_bundle import WorkspaceSecretVerification
from app.workspace_bundle.mcp_destination import (
    attestation_grant,
    secret_binding_attestation,
    secret_binding_grant,
)


def _mark_materialized(journal, proposal):
    if proposal.state == "proposed":
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="approved",
            decided_by="user-1",
        )
    proposal = journal.transition_workspace_bundle_install_proposal(
        proposal.proposal_id,
        expected_version=proposal.version,
        state="materializing",
    )
    return journal.transition_workspace_bundle_install_proposal(
        proposal.proposal_id,
        expected_version=proposal.version,
        state="materialized",
    )


def test_electron_generated_secret_reference_matches_brain_contract():
    electron_generated_ref = f"wsvault_{'A' * 32}"

    binding = (
        workspace_bundle_controller.BundleLocalValueBinding.model_validate(
            {
                "requirement_key": "environment:API_TOKEN",
                "requirement_kind": "environment",
                "secret_ref": electron_generated_ref,
                "account_scope_digest": "a" * 64,
            }
        )
    )

    assert binding.secret_ref == electron_generated_ref


def test_brain_rejects_noncanonical_vault_references():
    with pytest.raises(ValidationError):
        workspace_bundle_controller.BundleLocalValueBinding.model_validate(
            {
                "requirement_key": "environment:API_TOKEN",
                "requirement_kind": "environment",
                "secret_ref": f"wsvault_{'A' * 31}",
                "account_scope_digest": "a" * 64,
            }
        )


def test_install_payload_masks_vault_references(tmp_path, monkeypatch):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-1",
        request_id="proposal-request-1",
        space_id="space-1",
        bundle_id="bundle-1",
        revision_id="bundle-1@1",
        config_placement="sidecar",
        manifest={"spec": {}},
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
            "environment_requirements": [
                {
                    "requirement_key": "environment:API_TOKEN",
                    "name": "API_TOKEN",
                    "required": True,
                    "sensitive": True,
                    "description": "API token",
                    "example": None,
                }
            ],
            "mcp_secret_requirements": [],
        },
    )
    proposal = journal.transition_workspace_bundle_install_proposal(
        proposal.proposal_id,
        expected_version=proposal.version,
        state="approved",
        decided_by="user-1",
    )
    # Electron emits this exact opaque format: prefix plus 32 base64url chars.
    secret_ref = f"wsvault_{'A' * 32}"
    _, proposal = journal.put_workspace_bundle_secret_bindings(
        proposal_id=proposal.proposal_id,
        client_request_id="binding-request-1",
        expected_proposal_version=proposal.version,
        bindings=[
            {
                "requirement_key": "environment:API_TOKEN",
                "requirement_kind": "environment",
                "secret_ref": secret_ref,
                "account_scope_digest": "a" * 64,
            }
        ],
        authorized_by="user-1",
    )
    proposal = _mark_materialized(journal, proposal)

    class AvailableBroker:
        def __init__(self):
            self.batches = []

        def verify_many(self, identities):
            self.batches.append(tuple(identities))
            return tuple(
                WorkspaceSecretVerification(
                    identity=identity,
                    state="available",
                )
                for identity in identities
            )

    available_broker = AvailableBroker()

    monkeypatch.setattr(
        workspace_bundle_controller.WorkspaceSecretBroker,
        "from_environment",
        lambda: available_broker,
    )

    payload = workspace_bundle_controller._payload(proposal.proposal_id)

    assert payload["readiness"] == {
        "ready": True,
        "missing_requirements": [],
    }
    assert payload["runtime_readiness"] == "ready"
    assert payload["runtime_readiness_issues"] == []
    assert payload["value_requirements"][0]["configured"] is True
    assert payload["value_requirements"][0]["available"] is True
    assert payload["value_requirements"][0]["binding_version"] == 1
    assert secret_ref not in repr(payload)
    assert "account_scope_digest" not in repr(payload)
    assert len(available_broker.batches) == 1
    assert available_broker.batches[0][0].secret_ref == secret_ref
    journal.close()


def test_install_payload_marks_missing_vault_value_unready(
    tmp_path, monkeypatch
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-missing",
        request_id="proposal-request-missing",
        space_id="space-1",
        bundle_id="bundle-1",
        revision_id="bundle-1@1",
        config_placement="sidecar",
        manifest={"spec": {}},
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
            "environment_requirements": [
                {
                    "requirement_key": "environment:API_TOKEN",
                    "name": "API_TOKEN",
                    "required": True,
                }
            ],
            "mcp_secret_requirements": [],
        },
    )
    proposal = journal.transition_workspace_bundle_install_proposal(
        proposal.proposal_id,
        expected_version=proposal.version,
        state="approved",
        decided_by="user-1",
    )
    _, proposal = journal.put_workspace_bundle_secret_bindings(
        proposal_id=proposal.proposal_id,
        client_request_id="binding-request-missing",
        expected_proposal_version=proposal.version,
        bindings=[
            {
                "requirement_key": "environment:API_TOKEN",
                "requirement_kind": "environment",
                "secret_ref": f"wsvault_{'M' * 32}",
                "account_scope_digest": "a" * 64,
            }
        ],
        authorized_by="user-1",
    )
    proposal = _mark_materialized(journal, proposal)

    payload = workspace_bundle_controller._payload(proposal.proposal_id)

    assert payload["readiness"] == {
        "ready": False,
        "missing_requirements": ["environment:API_TOKEN"],
    }
    assert payload["runtime_readiness"] == "unavailable"
    assert payload["runtime_readiness_issues"] == ["local_setup_incomplete"]
    assert payload["value_requirements"][0]["configured"] is True
    assert payload["value_requirements"][0]["available"] is False
    journal.close()


def test_install_payload_reports_mcp_destination_confirmation(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-mcp-runtime",
        request_id="proposal-mcp-runtime-request",
        space_id="space-1",
        bundle_id="bundle-1",
        revision_id="bundle-1@1",
        config_placement="sidecar",
        manifest={
            "spec": {
                "mcpServers": [
                    {
                        "id": "private-mcp",
                        "secretSlots": ["API_TOKEN"],
                    }
                ]
            }
        },
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
            "environment_requirements": [],
            "mcp_secret_requirements": [],
        },
    )
    proposal = _mark_materialized(journal, proposal)

    payload = workspace_bundle_controller._payload(proposal.proposal_id)

    assert payload["runtime_readiness"] == "needs_confirmation"
    assert payload["runtime_readiness_issues"] == [
        "mcp_destination_confirmation_required:private-mcp"
    ]
    journal.close()


def test_install_payload_marks_rotated_secret_approval_stale(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    destination_digest = "a" * 64
    requirement_key = "mcp_secret:private-mcp:API_TOKEN"
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-mcp-stale",
        request_id="proposal-mcp-stale-request",
        space_id="space-1",
        bundle_id="bundle-1",
        revision_id="bundle-1@1",
        config_placement="sidecar",
        manifest={
            "spec": {
                "mcpServers": [
                    {
                        "id": "private-mcp",
                        "secretSlots": ["API_TOKEN"],
                    }
                ]
            }
        },
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": ["mcp.server.start:private-mcp"],
            "environment_requirements": [],
            "mcp_secret_requirements": [
                {
                    "requirement_key": requirement_key,
                    "mcp_id": "private-mcp",
                    "slot_id": "API_TOKEN",
                    "required": True,
                }
            ],
            "mcp_destinations": [
                {
                    "mcp_id": "private-mcp",
                    "attestation_digest": destination_digest,
                    "requires_secret_confirmation": True,
                    "availability_issue": None,
                }
            ],
        },
    )
    proposal = journal.transition_workspace_bundle_install_proposal(
        proposal.proposal_id,
        expected_version=proposal.version,
        state="approved",
        decided_by="user-1",
    )
    secrets, proposal = journal.put_workspace_bundle_secret_bindings(
        proposal_id=proposal.proposal_id,
        client_request_id="binding-mcp-stale-1",
        expected_proposal_version=proposal.version,
        bindings=[
            {
                "requirement_key": requirement_key,
                "requirement_kind": "mcp_secret",
                "secret_ref": "wsvault_" + "b" * 32,
                "account_scope_digest": "c" * 64,
            }
        ],
        authorized_by="user-1",
    )
    initial_binding_digest = secret_binding_attestation(
        mcp_id="private-mcp",
        bindings=[
            {
                "requirement_key": item.requirement_key,
                "secret_ref": item.secret_ref,
                "binding_version": item.binding_version,
                "account_scope_digest": item.account_scope_digest,
            }
            for item in secrets
        ],
    )
    _, proposal = journal.put_workspace_bundle_local_binding(
        proposal_id=proposal.proposal_id,
        expected_proposal_version=proposal.version,
        slot_id="mcp.server.start:private-mcp",
        binding_kind="script_approval",
        connector_id=None,
        opaque_connection_id=None,
        local_path=None,
        required_grants=[
            attestation_grant(destination_digest),
            secret_binding_grant(initial_binding_digest),
        ],
        authorized_by="user-1",
    )
    proposal = _mark_materialized(journal, proposal)
    _, proposal = journal.put_workspace_bundle_secret_bindings(
        proposal_id=proposal.proposal_id,
        client_request_id="binding-mcp-stale-2",
        expected_proposal_version=proposal.version,
        bindings=[
            {
                "requirement_key": requirement_key,
                "requirement_kind": "mcp_secret",
                "secret_ref": "wsvault_" + "d" * 32,
                "account_scope_digest": "e" * 64,
                "expected_binding_version": 1,
            }
        ],
        authorized_by="user-1",
    )

    class AvailableBroker:
        def verify_many(self, identities):
            return tuple(
                WorkspaceSecretVerification(
                    identity=item,
                    state="available",
                )
                for item in identities
            )

    monkeypatch.setattr(
        workspace_bundle_controller.WorkspaceSecretBroker,
        "from_environment",
        lambda: AvailableBroker(),
    )
    payload = workspace_bundle_controller._payload(proposal.proposal_id)

    approval = next(
        item
        for item in payload["bindings"]
        if item["slot_id"] == "mcp.server.start:private-mcp"
    )
    assert approval["current"] is False
    assert payload["runtime_readiness"] == "unavailable"
    assert (
        "mcp_destination_confirmation_stale:private-mcp"
        in payload["runtime_readiness_issues"]
    )
    journal.close()


def test_install_payload_aggregates_all_runtime_readiness_issues(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-runtime-issues",
        request_id="proposal-runtime-issues-request",
        space_id="space-1",
        bundle_id="bundle-1",
        revision_id="bundle-1@1",
        config_placement="sidecar",
        manifest={
            "spec": {
                "connectors": [{"id": "github"}],
                "mcpServers": [
                    {
                        "id": "private-mcp",
                        "secretSlots": ["API_TOKEN"],
                    }
                ],
                "agents": [
                    {"id": "coordinator"},
                    {"id": "researcher"},
                ],
            }
        },
        assets=[],
        install_plan={
            "connector_slots": [
                {
                    "slot_id": "github_connection",
                    "connector_id": "github",
                }
            ],
            "local_path_slots": ["documents"],
            "script_actions": [],
            "environment_requirements": [],
            "mcp_secret_requirements": [],
        },
    )
    proposal = _mark_materialized(journal, proposal)

    payload = workspace_bundle_controller._payload(proposal.proposal_id)

    assert payload["runtime_readiness"] == "unavailable"
    assert payload["runtime_readiness_issues"] == [
        "connector_runtime_adapter_unavailable",
        "mcp_destination_confirmation_required:private-mcp",
        "multi_agent_runtime_adapter_unavailable",
        "local_setup_incomplete",
    ]
    journal.close()


def test_install_payload_accepts_single_portable_agent_id(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-single-agent",
        request_id="proposal-single-agent-request",
        space_id="space-1",
        bundle_id="bundle-1",
        revision_id="bundle-1@1",
        config_placement="sidecar",
        manifest={"spec": {"agents": [{"id": "coordinator"}]}},
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
            "environment_requirements": [],
            "mcp_secret_requirements": [],
        },
    )
    proposal = _mark_materialized(journal, proposal)

    payload = workspace_bundle_controller._payload(proposal.proposal_id)

    assert payload["runtime_readiness"] == "ready"
    assert payload["runtime_readiness_issues"] == []
    journal.close()


def test_install_payload_rejects_unmaterialized_registry_dependencies(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-registry-dependency",
        request_id="proposal-registry-dependency-request",
        space_id="space-1",
        bundle_id="bundle-1",
        revision_id="bundle-1@1",
        config_placement="sidecar",
        manifest={
            "spec": {
                "skills": [{"ref": "registry://skills/research@1"}],
                "mcpServers": [
                    {
                        "id": "issues",
                        "definition": "registry://mcp/issues@1",
                    }
                ],
            }
        },
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
            "environment_requirements": [],
            "mcp_secret_requirements": [],
        },
    )
    proposal = _mark_materialized(journal, proposal)

    payload = workspace_bundle_controller._payload(proposal.proposal_id)

    assert payload["runtime_readiness"] == "unavailable"
    assert payload["runtime_readiness_issues"] == [
        "registry_dependencies_unmaterialized"
    ]
    journal.close()


def test_install_payload_never_marks_proposed_bundle_runtime_ready(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-not-materialized",
        request_id="proposal-not-materialized-request",
        space_id="space-1",
        bundle_id="bundle-1",
        revision_id="bundle-1@1",
        config_placement="sidecar",
        manifest={"spec": {}},
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
            "environment_requirements": [],
            "mcp_secret_requirements": [],
        },
    )

    payload = workspace_bundle_controller._payload(proposal.proposal_id)

    assert payload["readiness"] == {
        "ready": True,
        "missing_requirements": [],
    }
    assert payload["runtime_readiness"] == "unavailable"
    assert payload["runtime_readiness_issues"] == [
        "workspace_bundle_not_materialized"
    ]
    journal.close()


def test_local_value_contract_rejects_plaintext_fields():
    with pytest.raises(ValidationError):
        workspace_bundle_controller.BundleLocalValuesBody.model_validate(
            {
                "client_request_id": "request-1",
                "expected_version": 1,
                "actor_id": "user-1",
                "bindings": [
                    {
                        "requirement_key": "environment:API_TOKEN",
                        "requirement_kind": "environment",
                        "secret_ref": f"wsvault_{'P' * 32}",
                        "account_scope_digest": "a" * 64,
                        "value": "plaintext-must-never-enter-brain",
                    }
                ],
            }
        )


def test_space_installation_lookup_resumes_latest_non_rejected_proposal(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    rejected = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-rejected",
        request_id="request-rejected",
        space_id="space-1",
        bundle_id="bundle-old",
        revision_id="bundle-old@1",
        config_placement="sidecar",
        manifest={"spec": {}},
        assets=[],
        install_plan={},
        now=1,
    )
    journal.transition_workspace_bundle_install_proposal(
        rejected.proposal_id,
        expected_version=rejected.version,
        state="rejected",
        decided_by="user-1",
        now=2,
    )
    active = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-active",
        request_id="request-active",
        space_id="space-1",
        bundle_id="bundle-current",
        revision_id="bundle-current@2",
        config_placement="sidecar",
        manifest={"spec": {}},
        assets=[],
        install_plan={},
        now=3,
    )

    found = journal.get_latest_workspace_bundle_install_proposal(
        space_id="space-1"
    )

    assert found is not None
    assert found.proposal_id == active.proposal_id
    journal.close()


@pytest.mark.asyncio
async def test_space_installation_lookup_returns_successful_empty_state(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )

    payload = await workspace_bundle_controller.get_space_bundle_installation(
        "space-without-bundle"
    )

    assert payload == {"proposal": None}
    journal.close()


@pytest.mark.asyncio
async def test_local_value_put_returns_only_the_exact_ref_replaced_by_cas(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "run-journal.sqlite3")
    monkeypatch.setattr(
        workspace_bundle_controller,
        "get_default_run_journal",
        lambda: journal,
    )
    proposal = journal.put_workspace_bundle_install_proposal(
        proposal_id="proposal-cleanup",
        request_id="proposal-cleanup-request",
        space_id="space-1",
        bundle_id="bundle-1",
        revision_id="bundle-1@1",
        config_placement="sidecar",
        manifest={"spec": {}},
        assets=[],
        install_plan={
            "connector_slots": [],
            "local_path_slots": [],
            "script_actions": [],
            "environment_requirements": [],
            "mcp_secret_requirements": [],
        },
    )
    proposal = journal.transition_workspace_bundle_install_proposal(
        proposal.proposal_id,
        expected_version=proposal.version,
        state="approved",
        decided_by="user-1",
    )
    old_ref = f"wsvault_{'O' * 32}"
    stored, proposal = journal.put_workspace_bundle_secret_bindings(
        proposal_id=proposal.proposal_id,
        client_request_id="old-binding",
        expected_proposal_version=proposal.version,
        bindings=[
            {
                "requirement_key": "environment:API_TOKEN",
                "requirement_kind": "environment",
                "secret_ref": old_ref,
                "account_scope_digest": "a" * 64,
            }
        ],
        authorized_by="user-1",
    )
    new_ref = f"wsvault_{'N' * 32}"

    class Installer:
        def bind_local_values(self, proposal_id, **kwargs):
            return journal.put_workspace_bundle_secret_bindings(
                proposal_id=proposal_id,
                client_request_id=kwargs["client_request_id"],
                expected_proposal_version=kwargs["expected_version"],
                bindings=kwargs["bindings"],
                authorized_by=kwargs["authorized_by"],
            )

    monkeypatch.setattr(
        workspace_bundle_controller,
        "_installer",
        lambda: Installer(),
    )
    response = await workspace_bundle_controller.bind_bundle_local_values(
        proposal.proposal_id,
        workspace_bundle_controller.BundleLocalValuesBody.model_validate(
            {
                "client_request_id": "replace-binding",
                "expected_version": proposal.version,
                "actor_id": "user-1",
                "bindings": [
                    {
                        "requirement_key": "environment:API_TOKEN",
                        "requirement_kind": "environment",
                        "secret_ref": new_ref,
                        "account_scope_digest": "a" * 64,
                        "expected_binding_version": stored[0].binding_version,
                    }
                ],
            }
        ),
    )

    assert response["cleanup_secret_refs"] == [old_ref]
    assert new_ref not in response["cleanup_secret_refs"]
    journal.close()
