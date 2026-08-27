"""Capability-protected local API for review-first Bundle installation."""

from __future__ import annotations

import os
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import require_local_control_principal
from app.component.environment import env
from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    OptimisticConcurrencyError,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.router_layer.hands_resolver import get_environment_hands
from app.utils.workspace_resolver import get_workspace_resolver
from app.workspace_bundle import (
    HttpWorkspaceBundleCloudTransport,
    WorkspaceBundleBindingsIncomplete,
    WorkspaceBundleCloudError,
    WorkspaceBundleInstallError,
    WorkspaceBundleInstaller,
)
from app.workspace_config import ConfigPlacement
from app.workspace_git import ConfigurationRepositoryService

router = APIRouter(dependencies=[Depends(require_local_control_principal)])


class BundleProposalBody(BaseModel):
    proposal_id: str = Field(min_length=1, max_length=128)
    request_id: str = Field(min_length=1, max_length=128)
    space_id: str = Field(min_length=1, max_length=256)
    bundle_id: str = Field(min_length=1, max_length=128)
    revision_id: str = Field(min_length=1, max_length=128)
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


def _configuration_repository() -> ConfigurationRepositoryService:
    journal = get_default_run_journal()
    return ConfigurationRepositoryService(
        journal,
        state_root=configured_run_journal_path().parent / "workspace-git",
    )


def _installer(cloud=None) -> WorkspaceBundleInstaller:
    return WorkspaceBundleInstaller(
        get_default_run_journal(),
        _configuration_repository(),
        cloud,
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
        desktop_instance_id=os.environ.get(
            "EIGENT_DESKTOP_INSTANCE_ID", ""
        ),
    )


def _payload(proposal_id: str) -> dict:
    journal = get_default_run_journal()
    proposal = journal.get_workspace_bundle_install_proposal(proposal_id)
    if proposal is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "bundle_install_proposal_not_found"},
        )
    return {
        "proposal": asdict(proposal),
        "bindings": [
            asdict(item)
            for item in journal.list_workspace_bundle_local_bindings(
                proposal_id
            )
        ],
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
            bundle_id=body.bundle_id,
            revision_id=body.revision_id,
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


@router.post(
    "/workspace-bundles/install-proposals/{proposal_id}/materialize"
)
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
            allow_content_repository_init=(
                body.allow_content_repository_init
            ),
        )
        return _payload(proposal_id)
    except Exception as exc:
        raise _error(exc) from exc
    finally:
        if cloud is not None:
            await cloud.close()
