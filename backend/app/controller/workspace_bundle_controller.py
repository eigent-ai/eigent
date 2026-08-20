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

"""Capability-protected local API for review-first Bundle installation."""

from __future__ import annotations

import os
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.auth import require_local_control_principal
from app.component.environment import env
from app.router_layer.hands_resolver import get_environment_hands
from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    OptimisticConcurrencyError,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.utils.workspace_resolver import get_workspace_resolver
from app.workspace_bundle import (
    HttpWorkspaceBundleCloudTransport,
    WorkspaceBundleBindingsIncomplete,
    WorkspaceBundleCloudError,
    WorkspaceBundleInstaller,
    WorkspaceBundleInstallError,
    WorkspaceSecretBroker,
    WorkspaceSecretBrokerError,
    WorkspaceSecretIdentity,
)
from app.workspace_bundle.mcp_destination import (
    attestation_from_grants,
    secret_binding_attestation,
    secret_binding_attestation_from_grants,
)
from app.workspace_config import ConfigPlacement
from app.workspace_git import ConfigurationRepositoryService

router = APIRouter(dependencies=[Depends(require_local_control_principal)])


class BundleProposalBody(BaseModel):
    proposal_id: str = Field(min_length=1, max_length=128)
    request_id: str = Field(min_length=1, max_length=128)
    space_id: str = Field(min_length=1, max_length=256)
    publisher_namespace: str = Field(
        min_length=1,
        max_length=80,
        pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$",
    )
    slug: str = Field(
        min_length=1,
        max_length=80,
        pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$",
    )
    version: int = Field(ge=1)
    config_placement: Literal["in_repo", "sidecar"] = "sidecar"


class BundleDecisionBody(BaseModel):
    expected_version: int = Field(ge=0)
    approved: bool
    actor_id: str = Field(min_length=1, max_length=200)


class BundleConnectorBindingBody(BaseModel):
    expected_version: int = Field(ge=0)
    slot_id: str = Field(min_length=1, max_length=255)
    connector_id: str = Field(min_length=1, max_length=255)
    connection_id: str = Field(min_length=1, max_length=255)
    actor_id: str = Field(min_length=1, max_length=200)


class BundleLocalPathBindingBody(BaseModel):
    expected_version: int = Field(ge=0)
    slot_id: str = Field(min_length=1, max_length=255)
    local_path: str = Field(min_length=1, max_length=4096)
    actor_id: str = Field(min_length=1, max_length=200)


class BundleScriptApprovalBody(BaseModel):
    expected_version: int = Field(ge=0)
    action_id: str = Field(min_length=1, max_length=1024)
    actor_id: str = Field(min_length=1, max_length=200)


class BundleMaterializeBody(BaseModel):
    expected_version: int = Field(ge=0)
    email: str = Field(min_length=1, max_length=512)
    user_id: str | int | None = None
    actor_id: str = Field(min_length=1, max_length=200)
    allow_content_repository_init: bool = False


class BundleLocalValueBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirement_key: str = Field(min_length=1, max_length=1024)
    requirement_kind: Literal["environment", "mcp_secret"]
    secret_ref: str = Field(pattern=r"^wsvault_[A-Za-z0-9_-]{32}$")
    account_scope_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_binding_version: int | None = Field(default=None, ge=1)


class BundleLocalValuesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_request_id: str = Field(min_length=1, max_length=200)
    expected_version: int = Field(ge=0)
    actor_id: str = Field(min_length=1, max_length=200)
    bindings: list[BundleLocalValueBinding] = Field(
        min_length=1,
        max_length=100,
    )


def _configuration_repository() -> ConfigurationRepositoryService:
    journal = get_default_run_journal()
    return ConfigurationRepositoryService(
        journal,
        state_root=configured_run_journal_path().parent / "workspace-git",
    )


def _installer(cloud=None) -> WorkspaceBundleInstaller:
    try:
        secret_broker = WorkspaceSecretBroker.from_environment()
    except WorkspaceSecretBrokerError:
        secret_broker = None
    return WorkspaceBundleInstaller(
        get_default_run_journal(),
        _configuration_repository(),
        cloud,
        secret_broker,
    )


def _cloud(authorization: str) -> HttpWorkspaceBundleCloudTransport:
    # The bearer credential may only be sent to the process-owned SERVER_URL.
    # Renderer input cannot choose or override its destination.
    server_url = env("SERVER_URL", "").strip()
    if not server_url:
        raise WorkspaceBundleInstallError("SERVER_URL is not configured")
    return HttpWorkspaceBundleCloudTransport(
        server_url=server_url,
        authorization=authorization,
        desktop_instance_id=os.environ.get("EIGENT_DESKTOP_INSTANCE_ID", ""),
    )


def _payload(proposal_id: str) -> dict:
    journal = get_default_run_journal()
    proposal = journal.get_workspace_bundle_install_proposal(proposal_id)
    if proposal is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "bundle_install_proposal_not_found"},
        )
    local_bindings = journal.list_workspace_bundle_local_bindings(proposal_id)
    secret_bindings = journal.list_workspace_bundle_secret_bindings(
        proposal_id
    )
    configured_values = {item.requirement_key for item in secret_bindings}
    available_values: set[str] = set()
    try:
        broker = WorkspaceSecretBroker.from_environment()
    except WorkspaceSecretBrokerError:
        broker = None
    if broker is not None and secret_bindings:
        identities = tuple(
            WorkspaceSecretIdentity(
                secret_ref=item.secret_ref,
                account_scope_digest=item.account_scope_digest,
                space_id=proposal.space_id,
                revision_id=proposal.revision_id,
                slot_id=item.requirement_key,
            )
            for item in secret_bindings
        )
        try:
            available_values.update(
                verification.identity.slot_id
                for verification in broker.verify_many(identities)
                if verification.state == "available"
            )
        except WorkspaceSecretBrokerError:
            # Availability is advisory in this payload, but must fail closed.
            available_values.clear()
    binding_versions = {
        item.requirement_key: item.binding_version for item in secret_bindings
    }
    install_plan = proposal.install_plan
    environment_requirements = install_plan.get("environment_requirements", [])
    mcp_secret_requirements = install_plan.get("mcp_secret_requirements", [])
    value_requirements = [
        {
            **item,
            "requirement_kind": "environment",
            "configured": item["requirement_key"] in configured_values,
            "available": item["requirement_key"] in available_values,
            "binding_version": binding_versions.get(item["requirement_key"]),
        }
        for item in environment_requirements
    ] + [
        {
            **item,
            "requirement_kind": "mcp_secret",
            "configured": item["requirement_key"] in configured_values,
            "available": item["requirement_key"] in available_values,
            "binding_version": binding_versions.get(item["requirement_key"]),
        }
        for item in mcp_secret_requirements
    ]
    required = {
        item["slot_id"] for item in install_plan.get("connector_slots", [])
    }
    required.update(install_plan.get("local_path_slots", []))
    required.update(install_plan.get("script_actions", []))
    required.update(
        item["requirement_key"]
        for item in environment_requirements
        if item.get("required")
    )
    required.update(
        item["requirement_key"] for item in mcp_secret_requirements
    )
    # Materialization verifies every binding, including optional values that
    # the user chose to configure. Do not show Ready while such a binding is
    # unreadable and would fail one step later.
    required.update(configured_values)
    destinations = {
        str(item.get("mcp_id")): item
        for item in install_plan.get("mcp_destinations", [])
        if isinstance(item, dict) and item.get("mcp_id")
    }
    mcp_secret_keys = {
        str(item.get("mcp_id")): {
            str(requirement.get("requirement_key"))
            for requirement in mcp_secret_requirements
            if requirement.get("mcp_id") == item.get("mcp_id")
        }
        for item in install_plan.get("mcp_destinations", [])
        if isinstance(item, dict) and item.get("mcp_id")
    }
    current_secret_approvals: dict[str, bool] = {}
    serialized_bindings: list[dict] = []
    for item in local_bindings:
        serialized = asdict(item)
        current = True
        prefix = "mcp.server.start:"
        if item.slot_id.startswith(prefix):
            server_id = item.slot_id.removeprefix(prefix)
            destination = destinations.get(server_id)
            if destination and destination.get("requires_secret_confirmation"):
                relevant = [
                    {
                        "requirement_key": secret.requirement_key,
                        "secret_ref": secret.secret_ref,
                        "binding_version": secret.binding_version,
                        "account_scope_digest": (secret.account_scope_digest),
                    }
                    for secret in secret_bindings
                    if secret.requirement_key
                    in mcp_secret_keys.get(server_id, set())
                ]
                current = bool(
                    destination.get("attestation_digest")
                    and destination.get("availability_issue") is None
                    and {value["requirement_key"] for value in relevant}
                    == mcp_secret_keys.get(server_id, set())
                    and attestation_from_grants(item.required_grants)
                    == destination.get("attestation_digest")
                    and secret_binding_attestation_from_grants(
                        item.required_grants
                    )
                    == secret_binding_attestation(
                        mcp_id=server_id,
                        bindings=relevant,
                    )
                )
                current_secret_approvals[server_id] = current
        serialized["current"] = current
        serialized_bindings.append(serialized)

    configured = {
        item.slot_id
        for item, serialized in zip(
            local_bindings, serialized_bindings, strict=True
        )
        if serialized["current"]
    }
    configured.update(available_values)
    missing = sorted(required - configured)
    runtime_issues: list[str] = []
    manifest_spec = proposal.manifest.get("spec", {})
    manifest_connectors = manifest_spec.get("connectors")
    manifest_mcp_servers = manifest_spec.get(
        "mcpServers",
        manifest_spec.get("mcp_servers"),
    )
    manifest_agents = manifest_spec.get("agents", [])
    manifest_skills = manifest_spec.get("skills", [])
    connector_slots = (
        manifest_connectors
        if isinstance(manifest_connectors, list)
        else install_plan.get("connector_slots", [])
    )
    agent_entries = (
        manifest_agents if isinstance(manifest_agents, list) else []
    )
    agent_ids = {
        str(agent.get("id", ""))
        for agent in agent_entries
        if isinstance(agent, dict)
    }
    # Portable Bundle agent ids are logical names. A single logical Agent is
    # mapped to Desktop's concrete ``single_agent`` runtime; only a true
    # multi-Agent graph requires the future workforce adapter.
    has_unsupported_agents = len(agent_ids) > 1
    has_unmaterialized_registry_dependencies = bool(
        isinstance(manifest_skills, list)
        and any(
            isinstance(skill, dict)
            and isinstance(skill.get("ref"), str)
            and not skill["ref"].startswith("bundle://")
            for skill in manifest_skills
        )
    ) or bool(
        isinstance(manifest_mcp_servers, list)
        and any(
            isinstance(server, dict)
            and isinstance(server.get("definition"), str)
            and not server["definition"].startswith("bundle://")
            for server in manifest_mcp_servers
        )
    )
    if connector_slots:
        runtime_issues.append("connector_runtime_adapter_unavailable")
    secret_mcp_ids = {
        str(item.get("mcp_id"))
        for item in mcp_secret_requirements
        if item.get("mcp_id")
    }
    if not secret_mcp_ids and isinstance(manifest_mcp_servers, list):
        secret_mcp_ids = {
            str(item.get("id"))
            for item in manifest_mcp_servers
            if isinstance(item, dict)
            and item.get("id")
            and item.get("secretSlots", item.get("secret_slots", []))
        }
    needs_mcp_confirmation = False
    has_unavailable_secret_mcp = False
    for server_id in sorted(secret_mcp_ids):
        destination = destinations.get(server_id)
        action_id = f"mcp.server.start:{server_id}"
        binding_exists = any(
            item.slot_id == action_id for item in local_bindings
        )
        if destination and destination.get("availability_issue"):
            runtime_issues.append(
                f"{destination['availability_issue']}:{server_id}"
            )
            has_unavailable_secret_mcp = True
        elif not binding_exists:
            runtime_issues.append(
                f"mcp_destination_confirmation_required:{server_id}"
            )
            needs_mcp_confirmation = True
        elif not current_secret_approvals.get(server_id, False):
            runtime_issues.append(
                f"mcp_destination_confirmation_stale:{server_id}"
            )
            needs_mcp_confirmation = True
        else:
            runtime_issues.append(
                f"mcp_secret_stdio_runtime_adapter_unavailable:{server_id}"
            )
            has_unavailable_secret_mcp = True
    if has_unsupported_agents:
        runtime_issues.append("multi_agent_runtime_adapter_unavailable")
    if has_unmaterialized_registry_dependencies:
        runtime_issues.append("registry_dependencies_unmaterialized")
    if missing:
        runtime_issues.append("local_setup_incomplete")
    is_materialized = proposal.state == "materialized"
    if not is_materialized:
        runtime_issues.append("workspace_bundle_not_materialized")

    if (
        connector_slots
        or has_unsupported_agents
        or has_unmaterialized_registry_dependencies
        or has_unavailable_secret_mcp
        or missing
        or not is_materialized
    ):
        runtime_readiness = "unavailable"
    elif needs_mcp_confirmation:
        runtime_readiness = "needs_confirmation"
    else:
        runtime_readiness = "ready"
    return {
        "proposal": asdict(proposal),
        "bindings": serialized_bindings,
        "value_requirements": value_requirements,
        "readiness": {
            "ready": not missing,
            "missing_requirements": missing,
        },
        # File materialization and runtime dispatch readiness are deliberately
        # separate. A materialized proposal may still require an MCP
        # destination attestation or an executable connector adapter.
        "runtime_readiness": runtime_readiness,
        "runtime_readiness_issues": runtime_issues,
    }


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, WorkspaceBundleCloudError):
        return HTTPException(
            status_code=exc.status_code,
            detail={"code": "bundle_cloud_error", "upstream": exc.detail},
        )
    if isinstance(exc, WorkspaceBundleBindingsIncomplete):
        return HTTPException(
            status_code=409,
            detail={
                "code": "bundle_bindings_incomplete",
                "missing_slots": list(exc.missing_slots),
            },
        )
    if isinstance(
        exc,
        (
            IdempotencyConflictError,
            InvalidRunTransitionError,
            OptimisticConcurrencyError,
        ),
    ):
        return HTTPException(
            status_code=409,
            detail={"code": "bundle_install_conflict", "message": str(exc)},
        )
    if isinstance(exc, (WorkspaceBundleInstallError, ValueError)):
        return HTTPException(
            status_code=422,
            detail={"code": "bundle_install_invalid", "message": str(exc)},
        )
    return HTTPException(
        status_code=500,
        detail={"code": "bundle_install_failed"},
    )


def _authorized_local_path(request: Request, value: str) -> Path:
    hands = getattr(request.state, "hands", None) or get_environment_hands()
    validator = getattr(hands, "validate_workspace_binding_path", None)
    if validator is not None:
        ok, reason = validator(value)
        if not ok:
            raise WorkspaceBundleInstallError(
                f"Local path is not allowed: {reason or 'path_not_allowed'}"
            )
    else:
        can_access = getattr(hands, "can_access_filesystem", None)
        if can_access is None or not can_access(value):
            raise WorkspaceBundleInstallError(
                "Local path is outside the Desktop filesystem capability"
            )
    return Path(value)


@router.post("/workspace-bundles/install-proposals")
async def propose_bundle_install(
    body: BundleProposalBody,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> dict:
    cloud = None
    try:
        cloud = _cloud(authorization)
        await _installer(cloud).propose(
            proposal_id=body.proposal_id,
            request_id=body.request_id,
            space_id=body.space_id,
            publisher_namespace=body.publisher_namespace,
            slug=body.slug,
            version=body.version,
            config_placement=ConfigPlacement(body.config_placement),
        )
        return _payload(body.proposal_id)
    except Exception as exc:
        raise _error(exc) from exc
    finally:
        if cloud is not None:
            await cloud.close()


@router.get("/workspace-bundles/install-proposals/{proposal_id}")
async def get_bundle_install_proposal(proposal_id: str) -> dict:
    return _payload(proposal_id)


@router.get("/spaces/{space_id}/workspace-bundle-installation")
async def get_space_bundle_installation(space_id: str) -> dict:
    proposal = (
        get_default_run_journal().get_latest_workspace_bundle_install_proposal(
            space_id=space_id
        )
    )
    if proposal is None:
        # A locally-authored Space normally has no Bundle installation. This
        # endpoint is an optional relationship lookup, so absence is a normal
        # empty state rather than a missing-resource error. Keep the 404 on
        # the proposal-id endpoint, where the caller asked for a concrete
        # resource that does not exist.
        return {"proposal": None}
    return _payload(proposal.proposal_id)


@router.post("/workspace-bundles/install-proposals/{proposal_id}/decision")
async def decide_bundle_install(
    proposal_id: str, body: BundleDecisionBody
) -> dict:
    try:
        _installer().decide(
            proposal_id,
            expected_version=body.expected_version,
            approved=body.approved,
            decided_by=body.actor_id,
        )
        return _payload(proposal_id)
    except Exception as exc:
        raise _error(exc) from exc


@router.post(
    "/workspace-bundles/install-proposals/{proposal_id}/connector-bindings"
)
async def bind_bundle_connector(
    proposal_id: str, body: BundleConnectorBindingBody
) -> dict:
    try:
        _installer().bind_connector(
            proposal_id,
            expected_version=body.expected_version,
            slot_id=body.slot_id,
            connector_id=body.connector_id,
            opaque_connection_id=body.connection_id,
            authorized_by=body.actor_id,
        )
        return _payload(proposal_id)
    except Exception as exc:
        raise _error(exc) from exc


@router.post(
    "/workspace-bundles/install-proposals/{proposal_id}/local-path-bindings"
)
async def bind_bundle_local_path(
    proposal_id: str, body: BundleLocalPathBindingBody, request: Request
) -> dict:
    try:
        _installer().bind_local_path(
            proposal_id,
            expected_version=body.expected_version,
            slot_id=body.slot_id,
            local_path=_authorized_local_path(request, body.local_path),
            authorized_by=body.actor_id,
        )
        return _payload(proposal_id)
    except Exception as exc:
        raise _error(exc) from exc


@router.post(
    "/workspace-bundles/install-proposals/{proposal_id}/script-approvals"
)
async def approve_bundle_script(
    proposal_id: str, body: BundleScriptApprovalBody
) -> dict:
    try:
        _installer().approve_script_action(
            proposal_id,
            expected_version=body.expected_version,
            action_id=body.action_id,
            authorized_by=body.actor_id,
        )
        return _payload(proposal_id)
    except Exception as exc:
        raise _error(exc) from exc


@router.post("/workspace-bundles/install-proposals/{proposal_id}/materialize")
async def materialize_bundle(
    proposal_id: str,
    body: BundleMaterializeBody,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> dict:
    proposal = get_default_run_journal().get_workspace_bundle_install_proposal(
        proposal_id
    )
    if proposal is None:
        return _payload(proposal_id)
    binding = get_workspace_resolver().store.get_binding(
        body.email,
        proposal.space_id,
        body.user_id,
    )
    if binding is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "workspace_binding_not_found"},
        )
    space_root = Path(binding.workspace_root).expanduser().resolve()
    if not space_root.is_dir():
        raise HTTPException(
            status_code=409,
            detail={"code": "workspace_binding_unavailable"},
        )
    cloud = None
    try:
        cloud = _cloud(authorization)
        await _installer(cloud).materialize(
            proposal_id,
            expected_version=body.expected_version,
            space_root=space_root,
            actor_id=body.actor_id,
            allow_content_repository_init=(body.allow_content_repository_init),
        )
        return _payload(proposal_id)
    except Exception as exc:
        raise _error(exc) from exc
    finally:
        if cloud is not None:
            await cloud.close()


@router.put("/workspace-bundles/install-proposals/{proposal_id}/local-values")
async def bind_bundle_local_values(
    proposal_id: str,
    body: BundleLocalValuesBody,
) -> dict:
    try:
        journal = get_default_run_journal()
        previous_refs = {
            item.requirement_key: item.secret_ref
            for item in journal.list_workspace_bundle_secret_bindings(
                proposal_id
            )
        }
        updated, _ = _installer().bind_local_values(
            proposal_id,
            client_request_id=body.client_request_id,
            expected_version=body.expected_version,
            bindings=[item.model_dump() for item in body.bindings],
            authorized_by=body.actor_id,
        )
        payload = _payload(proposal_id)
        payload["cleanup_secret_refs"] = sorted(
            {
                previous_refs[item.requirement_key]
                for item in updated
                if item.requirement_key in previous_refs
                and previous_refs[item.requirement_key] != item.secret_ref
            }
        )
        return payload
    except Exception as exc:
        raise _error(exc) from exc
