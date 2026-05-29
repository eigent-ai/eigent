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

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.model.enums import Status
from app.router_layer.hands_resolver import get_environment_hands
from app.service.task import get_task_lock_if_exists
from app.utils.space_overlay_client import overlay_sync_failure_count
from app.utils.workspace_resolver import (
    _same_workspace_path,
    get_workspace_resolver,
)

router = APIRouter()
logger = logging.getLogger("workspace_controller")


class WorkspaceBindRequest(BaseModel):
    space_id: str | None = None
    project_id: str | None = None
    email: str
    user_id: str | int | None = None
    path: str


class WorkspaceReconcileRequest(BaseModel):
    email: str
    user_id: str | int | None = None
    active_space_ids: list[str]


class WorkspaceProjectRefreshRequest(BaseModel):
    email: str
    user_id: str | int | None = None
    force: bool = False
    server_refresh_confirmed: bool = False


def _manifest_from_request(request: Request) -> dict[str, Any]:
    hands = getattr(request.state, "hands", None) or get_environment_hands()
    get_manifest = getattr(hands, "get_capability_manifest", None)
    if get_manifest is None:
        return {}
    try:
        manifest = get_manifest()
    except Exception:
        logger.warning(
            "Failed to read hands capability manifest", exc_info=True
        )
        return {}
    return manifest if isinstance(manifest, dict) else {}


def _binding_enabled(manifest: dict[str, Any]) -> bool:
    return manifest.get("deployment") == "local"


def _project_has_active_run(project_id: str) -> bool:
    task_lock = get_task_lock_if_exists(project_id)
    if task_lock is None:
        return False
    if task_lock.status != Status.done:
        return True
    return any(not task.done() for task in task_lock.background_tasks)


def _capability_payload(manifest: dict[str, Any]) -> dict[str, Any]:
    binding_enabled = _binding_enabled(manifest)
    return {
        **manifest,
        "binding_enabled": binding_enabled,
        "binding_owner": "space",
        "label": "Local Brain" if binding_enabled else "Cloud workspace",
        "binding_persistence": "brain_local" if binding_enabled else "none",
    }


def _status_for_reason(reason: str | None) -> int:
    if reason in {
        "filesystem_capability_denied",
        "home_root_forbidden",
        "home_resolve_failed",
        "workspace_scope_denied",
    }:
        return 403
    if reason and reason.startswith("sensitive_path:"):
        return 403
    return 400


def _validate_bind_path(request: Request, path: str) -> Path:
    hands = getattr(request.state, "hands", None) or get_environment_hands()
    validator = getattr(hands, "validate_workspace_binding_path", None)
    if validator is not None:
        ok, reason = validator(path)
        if not ok:
            raise HTTPException(
                status_code=_status_for_reason(reason),
                detail={
                    "code": "invalid_workspace_path",
                    "reason": reason or "path_not_allowed",
                },
            )
    else:
        can_access = getattr(hands, "can_access_filesystem", None)
        if can_access is None or not can_access(path):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "invalid_workspace_path",
                    "reason": "filesystem_capability_denied",
                },
            )
        candidate = Path(path).expanduser()
        if not candidate.exists() or not candidate.is_dir():
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_workspace_path",
                    "reason": "path_not_directory",
                },
            )
    try:
        return Path(path).expanduser().resolve()
    except (OSError, RuntimeError) as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_workspace_path",
                "reason": "path_resolve_failed",
            },
        ) from exc


def _effective_space_id(payload: WorkspaceBindRequest) -> str:
    space_id = payload.space_id or payload.project_id
    if not space_id:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "space_id_required",
                "message": "space_id is required for workspace binding.",
            },
        )
    if not payload.space_id and payload.project_id:
        logger.warning(
            "Workspace bind received project_id without space_id; treating it as a legacy Space binding key",
            extra={"project_id": payload.project_id},
        )
    return space_id


@router.get("/workspace/capabilities")
async def workspace_capabilities(request: Request) -> dict[str, Any]:
    return _capability_payload(_manifest_from_request(request))


@router.get("/workspace/diagnostics")
async def workspace_diagnostics() -> dict[str, Any]:
    return {
        "overlay_sync_failures": overlay_sync_failure_count(),
    }


@router.get("/workspace/current")
async def workspace_current(
    space_id: str = Query(..., description="Space ID"),
    email: str = Query(..., description="User email"),
    user_id: str | None = Query(None, description="Canonical user ID"),
) -> dict[str, Any]:
    # TODO(brain-auth): Phase B should derive canonical user_id from
    # request.state.brain_auth and treat this email only as a legacy/display key.
    resolver = get_workspace_resolver()
    binding = resolver.store.get_binding(email, space_id, user_id)
    binding_active = (
        binding is not None
        and Path(binding.workspace_root).expanduser().is_dir()
    )
    return {
        "space_id": space_id,
        "email": email,
        "user_id": user_id,
        "bound": binding_active,
        "workspace_root": None if binding is None else binding.workspace_root,
        "binding": None if binding is None else binding.__dict__.copy(),
    }


@router.post("/workspace/bind")
async def workspace_bind(
    payload: WorkspaceBindRequest, request: Request
) -> dict[str, Any]:
    # TODO(brain-auth): Phase B must cross-check payload.email against
    # request.state.brain_auth.user_id before writing any binding mirror.
    manifest = _manifest_from_request(request)
    if not _binding_enabled(manifest):
        raise HTTPException(
            status_code=412,
            detail={
                "code": "workspace_binding_disabled",
                "capabilities": _capability_payload(manifest),
            },
        )

    space_id = _effective_space_id(payload)
    resolver = get_workspace_resolver()
    existing = resolver.store.get_binding(
        payload.email, space_id, payload.user_id
    )
    if existing is not None:
        if _same_workspace_path(existing.workspace_root, payload.path):
            return {
                "space_id": space_id,
                "email": payload.email,
                "user_id": payload.user_id,
                "bound": Path(existing.workspace_root).expanduser().is_dir(),
                "workspace_root": existing.workspace_root,
                "binding": existing.__dict__.copy(),
            }
        raise HTTPException(
            status_code=409,
            detail={
                "code": "workspace_already_bound",
                "message": (
                    "This Space already has a workspace folder. "
                    "Create a new Space to select another folder."
                ),
            },
        )

    resolved = _validate_bind_path(request, payload.path)

    conflict = next(
        (
            b
            for b in resolver.store.list_bindings(
                payload.email, payload.user_id
            )
            if b.space_id != space_id
            and _same_workspace_path(b.workspace_root, str(resolved))
        ),
        None,
    )
    if conflict is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "folder_already_bound_to_other_space",
                "other_space_id": conflict.space_id,
                "workspace_root": conflict.workspace_root,
                "message": (
                    "This folder is already used by another Space. "
                    "Open that Space to continue, or pick a different folder."
                ),
            },
        )

    binding = resolver.ensure_space_binding(
        payload.email,
        space_id,
        str(resolved),
        user_id=payload.user_id,
    )
    return {
        "space_id": space_id,
        "email": payload.email,
        "user_id": payload.user_id,
        "bound": True,
        "workspace_root": binding.workspace_root,
        "binding": binding.__dict__.copy(),
    }


@router.delete("/workspace/{space_id}")
async def workspace_unbind(
    space_id: str,
    email: str = Query(..., description="User email"),
    user_id: str | None = Query(None, description="Canonical user ID"),
) -> dict[str, Any]:
    # TODO(brain-auth): Phase B must derive the binding owner from
    # request.state.brain_auth.user_id instead of trusting the email query.
    resolver = get_workspace_resolver()
    resolver.store.delete_binding(email, space_id, user_id)
    return {
        "space_id": space_id,
        "email": email,
        "user_id": user_id,
        "bound": False,
        "workspace_root": None,
        "binding": None,
    }


@router.post("/workspace/reconcile")
async def workspace_reconcile(
    payload: WorkspaceReconcileRequest,
) -> dict[str, Any]:
    # TODO(brain-auth): Phase B should enforce auth-context ownership here
    # first; reconcile is destructive and must not trust payload.email.
    resolver = get_workspace_resolver()
    removed = resolver.store.reconcile_bindings(
        payload.email,
        set(payload.active_space_ids),
        payload.user_id,
    )
    return {
        "email": payload.email,
        "user_id": payload.user_id,
        "active_space_ids": payload.active_space_ids,
        "removed_space_ids": [binding.space_id for binding in removed],
        "removed_count": len(removed),
    }


@router.post("/workspace/{space_id}/projects/{project_id}/refresh")
async def workspace_project_refresh(
    space_id: str,
    project_id: str,
    payload: WorkspaceProjectRefreshRequest,
) -> dict[str, Any]:
    # TODO(brain-auth): Phase B must derive the binding owner from
    # request.state.brain_auth.user_id instead of trusting payload.email.
    # TODO(cloud-brain): replace the client-provided boolean with a short-lived
    # server-signed refresh token that Brain verifies before deleting workdirs.
    if not payload.server_refresh_confirmed:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "server_refresh_precondition_required",
                "message": (
                    "Brain workdir refresh must be called only after the "
                    "control server has checked pending overlays."
                ),
            },
        )
    if _project_has_active_run(project_id):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "project_running",
                "message": "Project workdir cannot be refreshed while a run is active.",
            },
        )
    resolver = get_workspace_resolver()
    try:
        base_snapshot_id = resolver.refresh_project_workdir(
            space_id=space_id,
            project_id=project_id,
            email=payload.email,
            user_id=payload.user_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "workspace_refresh_failed",
                "message": str(exc),
            },
        ) from exc
    return {
        "space_id": space_id,
        "project_id": project_id,
        "base_snapshot_id": base_snapshot_id,
    }
