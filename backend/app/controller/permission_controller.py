"""Authenticated local permission-profile endpoints."""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_local_control_principal
from app.permission_policy import PRESET_PROFILES, PermissionProfileName
from app.run_journal import (
    IdempotencyConflictError,
    OptimisticConcurrencyError,
    get_default_run_journal,
)

router = APIRouter(dependencies=[Depends(require_local_control_principal)])


class PermissionProfileBody(BaseModel):
    profile_name: PermissionProfileName
    request_id: str = Field(min_length=1, max_length=128)
    updated_by: str = Field(min_length=1, max_length=200)
    expected_revision: int | None = Field(default=None, ge=0)


def _default_profile_payload(space_id: str) -> dict:
    profile = PRESET_PROFILES[PermissionProfileName.REQUEST_APPROVAL]
    return {
        "space_id": space_id,
        "profile_name": profile.name.value,
        "sandbox_mode": profile.sandbox_mode,
        "approval_mode": profile.approval_mode,
        "reviewer_mode": profile.reviewer_mode,
        "revision": 0,
        "updated_by": "system_default",
        "created_at": None,
        "updated_at": None,
    }


@router.get("/spaces/{space_id}/permission-profile")
async def get_permission_profile(space_id: str):
    journal = get_default_run_journal()
    record = journal.get_space_permission_profile(space_id)
    return (
        asdict(record)
        if record is not None
        else _default_profile_payload(space_id)
    )


@router.put("/spaces/{space_id}/permission-profile")
async def put_permission_profile(space_id: str, body: PermissionProfileBody):
    journal = get_default_run_journal()
    preset = PRESET_PROFILES[body.profile_name]
    try:
        record = journal.put_space_permission_profile(
            space_id=space_id,
            profile_name=preset.name.value,
            sandbox_mode=preset.sandbox_mode,
            approval_mode=preset.approval_mode,
            reviewer_mode=preset.reviewer_mode,
            updated_by=body.updated_by,
            expected_revision=body.expected_revision,
            audit_request_id=body.request_id,
        )
    except (OptimisticConcurrencyError, IdempotencyConflictError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return asdict(record)
