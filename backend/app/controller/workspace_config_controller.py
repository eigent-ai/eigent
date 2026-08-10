"""Capability-protected local Workspace Configuration working-copy API."""

from __future__ import annotations

import asyncio
import hashlib
import os
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from pydantic import BaseModel, Field, ValidationError

from app.auth import require_local_control_principal
from app.component.environment import env
from app.router_layer.hands_resolver import get_environment_hands
from app.run_journal import (
    IdempotencyConflictError,
    OptimisticConcurrencyError,
    RunNotFoundError,
    WorkspaceConfigDraftRecord,
    get_default_run_journal,
)
from app.service.mcp_config import read_mcp_config
from app.utils.workspace_resolver import get_workspace_resolver
from app.workspace_bundle import (
    AgentPluginImporter,
    AgentPluginImportError,
    HttpWorkspaceBundleCloudTransport,
    WorkspaceBundleAuthoringService,
    WorkspaceBundleCloudError,
)
from app.workspace_config import (
    WorkforceBundleManifest,
    WorkspaceConfigError,
    assert_bundle_asset_safe,
)

router = APIRouter(dependencies=[Depends(require_local_control_principal)])
_MAX_BUNDLE_ASSET_BYTES = 16 * 1024 * 1024


class WorkspaceConfigDraftBody(BaseModel):
    expected_version: int = Field(ge=0)
    base_revision_id: str | None = Field(default=None, max_length=256)
    document: dict[str, Any]
    updated_by: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=1, max_length=512)
    user_id: str | int | None = None


class WorkspaceConfigPublishedBody(BaseModel):
    expected_version: int = Field(ge=0)
    revision_id: str = Field(
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}@[1-9][0-9]*$"
    )
    manifest_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    actor_id: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=1, max_length=512)
    user_id: str | int | None = None


class AgentPluginInspectBody(BaseModel):
    source_path: str = Field(min_length=1, max_length=4096)
    email: str = Field(min_length=1, max_length=512)
    user_id: str | int | None = None


class AgentPluginConvertBody(AgentPluginInspectBody):
    target_space_id: str = Field(min_length=1, max_length=200)
    expected_review_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_target_draft_version: int = Field(ge=0)
    client_request_id: str = Field(min_length=1, max_length=200)
    updated_by: str = Field(min_length=1, max_length=200)


def _assert_space_binding(
    *, space_id: str, email: str, user_id: str | int | None
) -> None:
    binding = get_workspace_resolver().store.get_binding(
        email,
        space_id,
        user_id,
    )
    if binding is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "workspace_binding_not_found"},
        )


def _default_bundle_id(space_id: str) -> str:
    return "bundle_space_" + hashlib.sha256(space_id.encode()).hexdigest()[:24]


def _default_document(space_id: str, name: str | None) -> dict[str, Any]:
    display_name = (name or "Workspace").strip() or "Workspace"
    return {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkforceBundle",
        "metadata": {
            "id": _default_bundle_id(space_id),
            "name": display_name,
            "revision": 1,
        },
        "spec": {
            "instructions": {},
            "context": [],
            "skills": [],
            "connectors": [],
            "mcpServers": [],
            "environment": {"variables": []},
            "agents": [],
            "models": {
                "default": {
                    "modelRef": "provider://default",
                    "thinkingEffort": "medium",
                }
            },
            "permissions": {
                "profile": "request_approval",
                "rules": [],
            },
            "git": {
                "enabled": True,
                "checkpointPolicy": "user_and_run_terminal",
                "agentIsolation": "worktree",
                "remotePolicy": "prompt",
            },
        },
    }


def _base_document(space_id: str, name: str | None) -> tuple[dict, str | None]:
    journal = get_default_run_journal()
    materialization = journal.get_latest_workspace_config_materialization(
        space_id
    )
    if materialization is None:
        return _default_document(space_id, name), None
    revision = journal.get_workspace_config_revision(
        materialization.revision_id
    )
    if revision is None:
        return _default_document(space_id, name), None
    document = WorkforceBundleManifest.model_validate(
        revision.manifest
    ).canonical_payload()
    metadata = document.setdefault("metadata", {})
    metadata["revision"] = revision.revision_number + 1
    return document, revision.revision_id


def _payload(
    *,
    space_id: str,
    draft: WorkspaceConfigDraftRecord | None,
    name: str | None = None,
) -> dict[str, Any]:
    if draft is None:
        document, base_revision_id = _base_document(space_id, name)
        return {
            "space_id": space_id,
            "version": 0,
            "base_revision_id": base_revision_id,
            "document": document,
            "document_digest": WorkforceBundleManifest.model_validate(
                document
            ).digest,
            "persisted": False,
            "updated_at": None,
        }
    return {
        "space_id": draft.space_id,
        "version": draft.version,
        "base_revision_id": draft.base_revision_id,
        "document": draft.document,
        "document_digest": draft.document_digest,
        "persisted": True,
        "updated_at": draft.updated_at,
    }


def _configuration_error(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, (OptimisticConcurrencyError, IdempotencyConflictError)):
        return HTTPException(
            status_code=409,
            detail={"code": "workspace_configuration_changed"},
        )
    if isinstance(exc, WorkspaceBundleCloudError):
        return HTTPException(
            status_code=exc.status_code,
            detail={"code": "bundle_cloud_error", "upstream": exc.detail},
        )
    if isinstance(exc, RunNotFoundError):
        return HTTPException(
            status_code=404,
            detail={"code": "workspace_configuration_base_not_found"},
        )
    if isinstance(
        exc,
        (
            AgentPluginImportError,
            ValidationError,
            WorkspaceConfigError,
            ValueError,
        ),
    ):
        return HTTPException(
            status_code=422,
            detail={
                "code": "workspace_configuration_invalid",
                "message": str(exc),
            },
        )
    return HTTPException(
        status_code=500,
        detail={"code": "workspace_configuration_failed"},
    )


def _authoring_cloud(authorization: str) -> HttpWorkspaceBundleCloudTransport:
    server_url = env("SERVER_URL", "").strip()
    if not server_url:
        raise ValueError("SERVER_URL is not configured")
    return HttpWorkspaceBundleCloudTransport(
        server_url=server_url,
        authorization=authorization,
        desktop_instance_id=os.environ.get("EIGENT_DESKTOP_INSTANCE_ID", ""),
    )


def _authorized_agent_plugin_source(request: Request, value: str) -> Path:
    if not Path(value).expanduser().is_absolute():
        raise HTTPException(
            status_code=422,
            detail={"code": "agent_plugin_source_invalid"},
        )
    hands = getattr(request.state, "hands", None) or get_environment_hands()
    can_access = getattr(hands, "can_access_filesystem", None)
    if can_access is None or not can_access(value):
        raise HTTPException(
            status_code=403,
            detail={"code": "agent_plugin_source_not_allowed"},
        )
    try:
        source = Path(value).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "agent_plugin_source_invalid"},
        ) from exc
    if not source.is_dir() and not (
        source.is_file() and source.suffix.lower() == ".zip"
    ):
        raise HTTPException(
            status_code=422,
            detail={"code": "agent_plugin_source_invalid"},
        )
    return source


def _agent_plugin_conversion_payload(
    draft: WorkspaceConfigDraftRecord,
    target_space_id: str,
) -> dict[str, Any]:
    metadata = draft.document["metadata"]
    return {
        "bundle_id": metadata["id"],
        "revision_id": str(metadata["revision"]),
        "target_space_id": target_space_id,
        "status": "draft",
    }


@router.post("/workspace-bundles/agent-plugins:inspect")
async def inspect_agent_plugin(
    body: AgentPluginInspectBody,
    request: Request,
) -> dict[str, Any]:
    try:
        source = _authorized_agent_plugin_source(request, body.source_path)
        result = await asyncio.to_thread(
            AgentPluginImporter().import_plugin,
            source,
        )
        return result.review
    except Exception as exc:
        raise _configuration_error(exc) from exc


@router.post("/workspace-bundles/agent-plugins:convert")
async def convert_agent_plugin(
    body: AgentPluginConvertBody,
    request: Request,
) -> dict[str, Any]:
    _assert_space_binding(
        space_id=body.target_space_id,
        email=body.email,
        user_id=body.user_id,
    )
    journal = get_default_run_journal()
    try:
        replay = journal.replay_workspace_config_draft_import(
            client_request_id=body.client_request_id,
            space_id=body.target_space_id,
            expected_target_draft_version=body.expected_target_draft_version,
            expected_review_digest=body.expected_review_digest,
            updated_by=body.updated_by,
        )
        if replay is not None:
            return _agent_plugin_conversion_payload(
                replay,
                body.target_space_id,
            )
        source = _authorized_agent_plugin_source(request, body.source_path)
        conversion = await asyncio.to_thread(
            AgentPluginImporter().convert_to_draft,
            source,
            journal=journal,
            space_id=body.target_space_id,
            expected_target_draft_version=body.expected_target_draft_version,
            expected_review_digest=body.expected_review_digest,
            client_request_id=body.client_request_id,
            updated_by=body.updated_by,
        )
        return _agent_plugin_conversion_payload(
            conversion.draft,
            body.target_space_id,
        )
    except Exception as exc:
        raise _configuration_error(exc) from exc


@router.get("/spaces/{space_id}/workspace-configuration")
async def get_workspace_configuration(
    space_id: str,
    email: Annotated[str, Query(min_length=1, max_length=512)],
    user_id: str | None = Query(default=None),
    name: str | None = Query(default=None, max_length=255),
) -> dict[str, Any]:
    _assert_space_binding(space_id=space_id, email=email, user_id=user_id)
    try:
        return _payload(
            space_id=space_id,
            draft=get_default_run_journal().get_workspace_config_draft(
                space_id
            ),
            name=name,
        )
    except Exception as exc:
        raise _configuration_error(exc) from exc


@router.put("/spaces/{space_id}/workspace-configuration")
async def put_workspace_configuration(
    space_id: str,
    body: WorkspaceConfigDraftBody,
) -> dict[str, Any]:
    _assert_space_binding(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    journal = get_default_run_journal()
    try:
        manifest = WorkforceBundleManifest.model_validate(body.document)
        canonical = manifest.canonical_payload()
        existing = journal.get_workspace_config_draft(space_id)
        if existing is not None:
            current_metadata = existing.document["metadata"]
            if (
                manifest.metadata.id != current_metadata["id"]
                or manifest.metadata.revision != current_metadata["revision"]
            ):
                raise ValueError(
                    "Bundle id and draft revision are immutable during autosave"
                )
        else:
            base_document, expected_base = _base_document(space_id, None)
            if body.base_revision_id != expected_base:
                raise OptimisticConcurrencyError(
                    "workspace configuration base revision changed"
                )
            expected_metadata = base_document["metadata"]
            if (
                manifest.metadata.id != expected_metadata["id"]
                or manifest.metadata.revision != expected_metadata["revision"]
            ):
                raise ValueError(
                    "Bundle id and draft revision must match the Space working copy"
                )
        draft = journal.put_workspace_config_draft(
            space_id=space_id,
            expected_version=body.expected_version,
            base_revision_id=body.base_revision_id,
            document=canonical,
            updated_by=body.updated_by,
        )
        return _payload(space_id=space_id, draft=draft)
    except Exception as exc:
        raise _configuration_error(exc) from exc


@router.get("/spaces/{space_id}/workspace-configuration/review")
async def review_workspace_configuration(
    space_id: str,
    email: Annotated[str, Query(min_length=1, max_length=512)],
    user_id: str | None = Query(default=None),
) -> dict[str, Any]:
    _assert_space_binding(space_id=space_id, email=email, user_id=user_id)
    try:
        draft = get_default_run_journal().get_workspace_config_draft(space_id)
        if draft is None:
            raise RunNotFoundError(
                "Save the Workspace Configuration before reviewing it"
            )
        manifest = WorkforceBundleManifest.model_validate(draft.document)
        return {
            "space_id": space_id,
            "draft_version": draft.version,
            "review": WorkspaceBundleAuthoringService.review(
                manifest,
                mcp_config=read_mcp_config(),
            ),
        }
    except Exception as exc:
        raise _configuration_error(exc) from exc


@router.post("/spaces/{space_id}/workspace-configuration/asset-preflight")
async def preflight_workspace_configuration_asset(
    space_id: str,
    email: Annotated[str, Query(min_length=1, max_length=512)],
    logical_path: Annotated[str, Form(min_length=1, max_length=1024)],
    file: Annotated[UploadFile, File()],
    user_id: str | None = Query(default=None),
) -> dict[str, Any]:
    _assert_space_binding(space_id=space_id, email=email, user_id=user_id)
    content = await file.read(_MAX_BUNDLE_ASSET_BYTES + 1)
    if len(content) > _MAX_BUNDLE_ASSET_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"code": "bundle_asset_too_large"},
        )
    try:
        assert_bundle_asset_safe(logical_path, content)
    except Exception as exc:
        raise _configuration_error(exc) from exc
    return {
        "logical_path": logical_path.removeprefix("bundle://"),
        "content_digest": hashlib.sha256(content).hexdigest(),
        "size_bytes": len(content),
    }


@router.post("/spaces/{space_id}/workspace-configuration/published")
async def record_workspace_configuration_published(
    space_id: str,
    body: WorkspaceConfigPublishedBody,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> dict[str, Any]:
    _assert_space_binding(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    cloud = None
    try:
        cloud = _authoring_cloud(authorization)
        cloud_revision = await cloud.get_revision(
            body.revision_id.rsplit("@", 1)[0], body.revision_id
        )
        if (
            cloud_revision.get("status") != "published"
            or cloud_revision.get("id") != body.revision_id
            or cloud_revision.get("manifest_digest") != body.manifest_digest
        ):
            raise IdempotencyConflictError(
                "Cloud publish receipt does not match the local working copy"
            )
        revision, draft = (
            get_default_run_journal().finalize_workspace_config_publish(
                space_id=space_id,
                expected_draft_version=body.expected_version,
                revision_id=body.revision_id,
                manifest_digest=body.manifest_digest,
                published_manifest=cloud_revision.get("manifest", {}),
                actor_id=body.actor_id,
            )
        )
        return {
            "revision": asdict(revision),
            "draft": _payload(space_id=space_id, draft=draft),
        }
    except Exception as exc:
        raise _configuration_error(exc) from exc
    finally:
        if cloud is not None:
            await cloud.close()
