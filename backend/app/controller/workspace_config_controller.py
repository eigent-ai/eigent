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

"""Capability-protected local Workspace Configuration working-copy API."""

from __future__ import annotations

import asyncio
import hashlib
import os
from dataclasses import asdict
from pathlib import Path, PurePosixPath
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
    WorkspaceBundleManifest,
    WorkspaceConfigError,
    assert_bundle_asset_safe,
    canonical_digest,
)

router = APIRouter(dependencies=[Depends(require_local_control_principal)])
_MAX_BUNDLE_ASSET_BYTES = 16 * 1024 * 1024
_MAX_PREPARED_ASSETS = 512
_MAX_PREPARED_ASSET_BYTES = 64 * 1024 * 1024


class WorkspaceConfigDraftBody(BaseModel):
    expected_version: int = Field(ge=0)
    base_revision_id: str | None = Field(default=None, max_length=256)
    document: dict[str, Any]
    updated_by: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=1, max_length=512)
    user_id: str | int | None = None


class WorkspaceConfigPublishedBody(BaseModel):
    expected_version: int = Field(ge=0)
    revision_id: str = Field(pattern=r"^wbr_[0-9a-f]{32}$")
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


class WorkspaceConfigPreparedAssetsBody(BaseModel):
    expected_version: int = Field(ge=1)
    expected_manifest_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_review_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    email: str = Field(min_length=1, max_length=512)
    user_id: str | int | None = None


class WorkspaceConfigPreparedAssetUploadBody(
    WorkspaceConfigPreparedAssetsBody
):
    logical_path: str = Field(min_length=1, max_length=1024)
    content_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_old_digest: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{64}$",
    )


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


def _default_bundle_slug(space_id: str) -> str:
    return "bundle_space_" + hashlib.sha256(space_id.encode()).hexdigest()[:24]


def _default_document(space_id: str, name: str | None) -> dict[str, Any]:
    display_name = (name or "Workspace").strip() or "Workspace"
    return {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkspaceBundle",
        "metadata": {
            "id": _default_bundle_slug(space_id),
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
    document = WorkspaceBundleManifest.model_validate(
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
            "document_digest": WorkspaceBundleManifest.model_validate(
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
        "slug": metadata["id"],
        "version": metadata["revision"],
        "target_space_id": target_space_id,
        "status": "draft",
    }


def _prepared_asset_payload(asset: Any) -> dict[str, Any]:
    if asset.provenance not in {
        "agent_plugins_v1_import",
        "agent_plugin_import",
    }:
        raise IdempotencyConflictError(
            "Prepared Workspace Bundle asset has invalid provenance"
        )
    return {
        "logical_path": asset.logical_path,
        "content_digest": asset.content_digest,
        "media_type": asset.media_type,
        "size_bytes": asset.size_bytes,
        "executable": asset.executable,
        "provenance": "agent_plugin_import",
    }


def _workspace_configuration_review(
    draft: WorkspaceConfigDraftRecord,
) -> dict[str, Any]:
    manifest = WorkspaceBundleManifest.model_validate(draft.document)
    base = WorkspaceBundleAuthoringService.review(
        manifest,
        mcp_config=read_mcp_config(),
    )
    prepared = _prepared_assets_for_document(
        space_id=draft.space_id,
        draft_version=draft.version,
        document_digest=draft.document_digest,
        direct_assets=set(base["assets"]),
    )
    payload = {
        key: value for key, value in base.items() if key != "review_digest"
    }
    payload["prepared_assets"] = prepared
    return {**payload, "review_digest": canonical_digest(payload)}


def _prepared_assets_for_document(
    *,
    space_id: str,
    draft_version: int,
    document_digest: str,
    direct_assets: set[str],
) -> list[dict[str, Any]]:
    descriptors = get_default_run_journal().list_workspace_config_draft_asset_descriptors(
        space_id=space_id,
        draft_version=draft_version,
        document_digest=document_digest,
    )
    return _prepared_assets_from_descriptors(
        direct_assets=direct_assets,
        descriptors=descriptors,
    )


def _prepared_assets_from_descriptors(
    *,
    direct_assets: set[str],
    descriptors: Any,
) -> list[dict[str, Any]]:
    active_plugin_roots: set[str] = set()
    for asset_ref in direct_assets:
        logical = asset_ref.removeprefix("bundle://")
        parts = PurePosixPath(logical).parts
        if len(parts) >= 2 and parts[0] == "agent-plugins":
            active_plugin_roots.add("/".join(parts[:2]) + "/")
    prepared = [
        _prepared_asset_payload(asset)
        for asset in descriptors
        if (
            asset.logical_path in direct_assets
            or any(
                asset.logical_path.removeprefix("bundle://").startswith(root)
                for root in active_plugin_roots
            )
        )
    ]
    return prepared


def _assert_cloud_prepared_assets_match(
    *,
    space_id: str,
    manifest_digest: str,
    cloud_revision: dict[str, Any],
) -> None:
    manifest = WorkspaceBundleManifest.model_validate(
        cloud_revision.get("manifest", {})
    )
    base = WorkspaceBundleAuthoringService.review(
        manifest,
        mcp_config=read_mcp_config(),
    )
    direct_assets = set(base["assets"])
    historical_snapshots = get_default_run_journal().list_workspace_config_draft_asset_descriptor_snapshots(
        space_id=space_id,
        document_digest=manifest_digest,
    )
    expected_snapshots = [
        _prepared_assets_from_descriptors(
            direct_assets=direct_assets,
            descriptors=snapshot,
        )
        for snapshot in historical_snapshots
    ]
    # A manifest without any persisted imported package is a valid manual-only
    # Bundle. Once a prepared snapshot exists, however, recovery must match one
    # exact historical set rather than silently falling back to an empty set.
    if not expected_snapshots:
        expected_snapshots = [[]]
    cloud_imported = [
        item
        for item in cloud_revision.get("assets", [])
        if item.get("provenance") == "agent_plugin_import"
    ]

    def comparable(item: dict[str, Any]) -> str:
        logical_path = item.get("logical_path")
        return canonical_digest(
            {
                "logical_path": (
                    logical_path.removeprefix("bundle://")
                    if isinstance(logical_path, str)
                    else None
                ),
                "content_digest": item.get("content_digest"),
                "media_type": item.get("media_type"),
                "size_bytes": item.get("size_bytes"),
                "provenance": item.get("provenance"),
                "executable": item.get("executable", False),
            }
        )

    cloud_comparable = sorted(map(comparable, cloud_imported))
    if not any(
        sorted(map(comparable, expected)) == cloud_comparable
        for expected in expected_snapshots
    ):
        raise IdempotencyConflictError(
            "Cloud prepared assets do not match the confirmed local package"
        )


def _verified_prepared_asset_review(
    *,
    space_id: str,
    body: WorkspaceConfigPreparedAssetsBody,
) -> tuple[WorkspaceConfigDraftRecord, dict[str, Any]]:
    draft = get_default_run_journal().get_workspace_config_draft(space_id)
    if draft is None:
        raise RunNotFoundError(
            "Save the Workspace Configuration before publishing assets"
        )
    if (
        draft.version != body.expected_version
        or draft.document_digest != body.expected_manifest_digest
    ):
        raise OptimisticConcurrencyError(
            f"workspace configuration for {space_id!r} changed"
        )
    review = _workspace_configuration_review(draft)
    if review["review_digest"] != body.expected_review_digest:
        raise IdempotencyConflictError(
            "Workspace Configuration review changed"
        )
    return draft, review


def _verified_prepared_asset(
    *,
    draft: WorkspaceConfigDraftRecord,
    descriptor: dict[str, Any],
) -> Any:
    asset = get_default_run_journal().get_workspace_config_draft_asset(
        space_id=draft.space_id,
        draft_version=draft.version,
        document_digest=draft.document_digest,
        logical_path=descriptor["logical_path"],
        content_digest=descriptor["content_digest"],
    )
    if asset is None:
        raise IdempotencyConflictError(
            "Prepared Workspace Bundle asset is no longer available"
        )
    if (
        asset.size_bytes != descriptor["size_bytes"]
        or len(asset.content) != descriptor["size_bytes"]
        or hashlib.sha256(asset.content).hexdigest()
        != descriptor["content_digest"]
        or asset.media_type != descriptor["media_type"]
        or asset.executable != descriptor["executable"]
    ):
        raise IdempotencyConflictError(
            "Prepared Workspace Bundle asset changed after review"
        )
    assert_bundle_asset_safe(asset.logical_path, asset.content)
    return asset


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
        manifest = WorkspaceBundleManifest.model_validate(body.document)
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
        return {
            "space_id": space_id,
            "draft_version": draft.version,
            "review": _workspace_configuration_review(draft),
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


@router.post(
    "/spaces/{space_id}/workspace-configuration/prepared-assets:preflight"
)
async def preflight_prepared_workspace_configuration_assets(
    space_id: str,
    body: WorkspaceConfigPreparedAssetsBody,
) -> dict[str, Any]:
    """Validate the complete prepared package before the first Cloud write."""

    _assert_space_binding(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    try:
        draft, review = _verified_prepared_asset_review(
            space_id=space_id,
            body=body,
        )
        descriptors = review["prepared_assets"]
        if len(descriptors) > _MAX_PREPARED_ASSETS:
            raise ValueError("Prepared Workspace Bundle has too many assets")
        if sum(item["size_bytes"] for item in descriptors) > (
            _MAX_PREPARED_ASSET_BYTES
        ):
            raise ValueError("Prepared Workspace Bundle assets are too large")
        for descriptor in descriptors:
            _verified_prepared_asset(
                draft=draft,
                descriptor=descriptor,
            )
        return {
            "space_id": space_id,
            "draft_version": draft.version,
            "manifest_digest": draft.document_digest,
            "review_digest": review["review_digest"],
            "assets": descriptors,
        }
    except Exception as exc:
        raise _configuration_error(exc) from exc


@router.post(
    "/spaces/{space_id}/workspace-configuration/prepared-assets:upload"
)
async def upload_prepared_workspace_configuration_asset(
    space_id: str,
    body: WorkspaceConfigPreparedAssetUploadBody,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> dict[str, Any]:
    """Upload one reviewed local asset without exposing bytes to renderer."""

    _assert_space_binding(
        space_id=space_id,
        email=body.email,
        user_id=body.user_id,
    )
    cloud = None
    try:
        draft, review = _verified_prepared_asset_review(
            space_id=space_id,
            body=body,
        )
        descriptor = next(
            (
                item
                for item in review["prepared_assets"]
                if item["logical_path"] == body.logical_path
                and item["content_digest"] == body.content_digest
            ),
            None,
        )
        if descriptor is None:
            raise IdempotencyConflictError(
                "Prepared Workspace Bundle asset was not in the confirmed review"
            )
        asset = _verified_prepared_asset(
            draft=draft,
            descriptor=descriptor,
        )
        manifest = WorkspaceBundleManifest.model_validate(draft.document)
        cloud = _authoring_cloud(authorization)
        cloud_revision = await cloud.resolve_owner_revision(
            manifest.metadata.id,
            manifest.metadata.revision,
        )
        bundle_id = cloud_revision.get("bundle_id")
        revision_id = cloud_revision.get("id")
        if (
            not isinstance(bundle_id, str)
            or not isinstance(revision_id, str)
            or cloud_revision.get("manifest_digest") != draft.document_digest
            or cloud_revision.get("manifest") != manifest.canonical_payload()
        ):
            raise IdempotencyConflictError(
                "Cloud revision does not match the reviewed Workspace Bundle"
            )
        receipt = await cloud.upload_asset(
            bundle_id,
            revision_id,
            logical_path=asset.logical_path,
            content=asset.content,
            media_type=asset.media_type,
            provenance=descriptor["provenance"],
            executable=asset.executable,
            expected_old_digest=body.expected_old_digest,
        )
        expected_receipt = {
            "logical_path": asset.logical_path.removeprefix("bundle://"),
            "content_digest": asset.content_digest,
            "media_type": asset.media_type,
            "size_bytes": asset.size_bytes,
            "provenance": descriptor["provenance"],
            "executable": asset.executable,
        }
        if any(
            receipt.get(key) != value
            for key, value in expected_receipt.items()
        ):
            raise IdempotencyConflictError(
                "Cloud asset receipt does not match the prepared asset"
            )
        return {"asset": receipt}
    except Exception as exc:
        raise _configuration_error(exc) from exc
    finally:
        if cloud is not None:
            await cloud.close()


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
        current_draft = get_default_run_journal().get_workspace_config_draft(
            space_id
        )
        if (
            current_draft is None
            or current_draft.version < body.expected_version
        ):
            raise IdempotencyConflictError(
                "Workspace configuration changed before publish finalization"
            )
        manifest = WorkspaceBundleManifest.model_validate(
            current_draft.document
        )
        cloud = _authoring_cloud(authorization)
        cloud_revision = await cloud.resolve_owner_revision(
            manifest.metadata.id,
            manifest.metadata.revision,
        )
        if (
            cloud_revision.get("status") != "published"
            or cloud_revision.get("id") != body.revision_id
            or cloud_revision.get("manifest_digest") != body.manifest_digest
        ):
            raise IdempotencyConflictError(
                "Cloud publish receipt does not match the local working copy"
            )
        _assert_cloud_prepared_assets_match(
            space_id=space_id,
            manifest_digest=body.manifest_digest,
            cloud_revision=cloud_revision,
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
