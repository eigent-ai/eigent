"""Capability-protected local Workspace Configuration working-copy API."""

from __future__ import annotations

import hashlib
from copy import deepcopy
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError

from app.auth import require_local_control_principal
from app.run_journal import (
    IdempotencyConflictError,
    OptimisticConcurrencyError,
    RunNotFoundError,
    WorkspaceConfigDraftRecord,
    get_default_run_journal,
)
from app.utils.workspace_resolver import get_workspace_resolver
from app.workspace_config import WorkforceBundleManifest, WorkspaceConfigError

router = APIRouter(dependencies=[Depends(require_local_control_principal)])


class WorkspaceConfigDraftBody(BaseModel):
    expected_version: int = Field(ge=0)
    base_revision_id: str | None = Field(default=None, max_length=256)
    document: dict[str, Any]
    updated_by: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=1, max_length=512)
    user_id: str | int | None = None


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
    document = deepcopy(revision.manifest)
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
    if isinstance(exc, RunNotFoundError):
        return HTTPException(
            status_code=404,
            detail={"code": "workspace_configuration_base_not_found"},
        )
    if isinstance(exc, (ValidationError, WorkspaceConfigError, ValueError)):
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
