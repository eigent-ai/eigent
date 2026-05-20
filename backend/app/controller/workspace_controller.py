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

from app.model.chat import Status
from app.service.task import get_task_lock_if_exists
from app.service.upload.service import BrainUploadService
from app.utils.workspace_resolver import get_workspace_resolver

router = APIRouter()
logger = logging.getLogger("workspace_controller")


class WorkspaceBindRequest(BaseModel):
    project_id: str
    email: str
    path: str


def _manifest_from_request(request: Request) -> dict[str, Any]:
    hands = getattr(request.state, "hands", None)
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


def _capability_payload(manifest: dict[str, Any]) -> dict[str, Any]:
    binding_enabled = _binding_enabled(manifest)
    return {
        **manifest,
        "binding_enabled": binding_enabled,
        "label": "Local Brain" if binding_enabled else "Cloud workspace",
        "binding_persistence": "brain_local" if binding_enabled else "none",
    }


def _has_active_task(project_id: str) -> bool:
    task_lock = get_task_lock_if_exists(project_id)
    if task_lock is None:
        return False
    return task_lock.status in {Status.confirmed, Status.processing}


def _validate_bind_path(request: Request, path: str) -> Path:
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

    hands = getattr(request.state, "hands", None)
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


def _same_workspace_path(left: str, right: str) -> bool:
    try:
        return (
            Path(left).expanduser().resolve()
            == Path(right).expanduser().resolve()
        )
    except (OSError, RuntimeError):
        return False


@router.get("/workspace/capabilities")
async def workspace_capabilities(request: Request) -> dict[str, Any]:
    return _capability_payload(_manifest_from_request(request))


@router.get("/workspace/current")
async def workspace_current(
    project_id: str = Query(..., description="Project ID"),
    email: str = Query(..., description="User email"),
) -> dict[str, Any]:
    resolver = get_workspace_resolver()
    binding = resolver.store.get_binding(email, project_id)
    binding_active = (
        binding is not None
        and Path(binding.workspace_root).expanduser().is_dir()
    )
    root = resolver.project_root(project_id, email)
    return {
        "project_id": project_id,
        "email": email,
        "bound": binding_active,
        "workspace_root": str(root),
        "binding": None if binding is None else binding.__dict__.copy(),
    }


@router.post("/workspace/bind")
async def workspace_bind(
    payload: WorkspaceBindRequest, request: Request
) -> dict[str, Any]:
    manifest = _manifest_from_request(request)
    if not _binding_enabled(manifest):
        raise HTTPException(
            status_code=412,
            detail={
                "code": "workspace_binding_disabled",
                "capabilities": _capability_payload(manifest),
            },
        )
    if _has_active_task(payload.project_id):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "active_task_exists",
                "message": "Cannot change workspace while a task is running.",
            },
        )

    resolver = get_workspace_resolver()
    existing = resolver.store.get_binding(payload.email, payload.project_id)
    if existing is not None:
        if _same_workspace_path(existing.workspace_root, payload.path):
            return {
                "project_id": payload.project_id,
                "email": payload.email,
                "bound": Path(existing.workspace_root).expanduser().is_dir(),
                "workspace_root": existing.workspace_root,
                "binding": existing.__dict__.copy(),
            }
        raise HTTPException(
            status_code=409,
            detail={
                "code": "workspace_already_bound",
                "message": (
                    "This project already has a workspace folder. "
                    "Create a new project to select another folder."
                ),
            },
        )

    resolved = _validate_bind_path(request, payload.path)
    binding = resolver.store.save_binding(
        payload.email,
        payload.project_id,
        str(resolved),
    )
    return {
        "project_id": payload.project_id,
        "email": payload.email,
        "bound": True,
        "workspace_root": binding.workspace_root,
        "binding": binding.__dict__.copy(),
    }


@router.get("/upload/status")
async def upload_status(
    request: Request,
    task_id: str = Query(..., description="Task ID"),
) -> dict[str, Any]:
    state = BrainUploadService.singleton().get_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Upload state not found")
    request_session_id = getattr(request.state, "session_id", None)
    if request_session_id and state.session_id != request_session_id:
        raise HTTPException(status_code=403, detail="Session mismatch")
    return state.to_dict()
