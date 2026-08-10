from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.controller import workspace_bundle_controller
from app.run_journal import SQLiteRunJournal
from app.workspace_bundle import WorkspaceSecretVerification


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
    journal.put_workspace_bundle_secret_bindings(
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
    journal.put_workspace_bundle_secret_bindings(
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

    payload = workspace_bundle_controller._payload(proposal.proposal_id)

    assert payload["readiness"] == {
        "ready": False,
        "missing_requirements": ["environment:API_TOKEN"],
    }
    assert payload["value_requirements"][0]["configured"] is True
    assert payload["value_requirements"][0]["available"] is False
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
