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

"""Authenticated Desktop-local Lightweight Memory API.

Canonical History intentionally has no Renderer route. Agent History Search
uses the in-process service and cannot mutate RunJournal facts.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth import require_local_control_principal
from app.lightweight_memory import get_lightweight_memory_service
from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    OptimisticConcurrencyError,
    RunNotFoundError,
)
from app.run_sync.runtime import current_authenticated_account_owner_id

router = APIRouter(dependencies=[Depends(require_local_control_principal)])

ScopeType = Literal["project", "space", "user"]
MemoryKind = Literal[
    "fact", "decision", "constraint", "preference", "todo", "lesson"
]


class CreateMemoryBody(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=8192)
    kind: MemoryKind
    priority: Literal["normal", "high"] = "normal"
    reason: str = Field(min_length=1, max_length=1000)
    source_refs: list[str] = Field(default_factory=list, max_length=32)
    sensitivity: Literal["normal", "personal", "sensitive"] = "normal"
    actor_id: str | None = Field(default=None, max_length=200)


class UpdateMemoryBody(CreateMemoryBody):
    expected_version: int = Field(ge=1)


class TransitionMemoryBody(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)
    actor_id: str | None = Field(default=None, max_length=200)


class MemoryScopeSettingsBody(BaseModel):
    expected_revision: int = Field(ge=0)
    capture_enabled: bool | None = None
    use_enabled: bool | None = None


class MemoryScopeSummaryRef(BaseModel):
    scope_type: ScopeType
    scope_id: str = Field(min_length=1, max_length=200)


class MemoryScopeSummariesBody(BaseModel):
    scopes: list[MemoryScopeSummaryRef] = Field(max_length=250)


class ConsolidateMemoryBody(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=1, max_length=1000)


class ResolveMemoryReconciliationBody(BaseModel):
    decision: Literal["local", "cloud", "dismiss"]


def _serialize_result(result) -> dict:
    return {
        "mutation": asdict(result.mutation),
        "entry": asdict(result.entry) if result.entry is not None else None,
        "scope_state": asdict(result.scope_state),
    }


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, RunNotFoundError | KeyError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, OptimisticConcurrencyError | IdempotencyConflictError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, (InvalidRunTransitionError, PermissionError)):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


@router.get("/memory/scopes/{scope_type}/{scope_id}")
async def get_memory_scope(scope_type: ScopeType, scope_id: str):
    service = get_lightweight_memory_service()
    return asdict(service.scope(scope_type, scope_id))


@router.post("/memory/scopes/summaries")
async def list_memory_scope_summaries(body: MemoryScopeSummariesBody):
    """Return lightweight counts for the local Memory Center directory."""

    service = get_lightweight_memory_service()
    items: list[dict] = []
    seen: set[tuple[str, str]] = set()
    try:
        for requested_scope in body.scopes:
            key = (requested_scope.scope_type, requested_scope.scope_id)
            if key in seen:
                continue
            seen.add(key)
            state = service.scope(*key)
            entries = service.list_entries(*key)
            items.append(
                {
                    "scope_type": requested_scope.scope_type,
                    "scope_id": requested_scope.scope_id,
                    "entry_count": len(entries),
                    "scope_state": asdict(state),
                }
            )
    except Exception as exc:  # noqa: BLE001
        raise _translate_error(exc) from exc
    return {"items": items}


@router.patch("/memory/scopes/{scope_type}/{scope_id}/settings")
async def update_memory_scope_settings(
    scope_type: ScopeType,
    scope_id: str,
    body: MemoryScopeSettingsBody,
):
    service = get_lightweight_memory_service()
    try:
        result = service.journal.update_memory_scope_settings(
            scope_type,
            scope_id,
            expected_revision=body.expected_revision,
            capture_enabled=body.capture_enabled,
            use_enabled=body.use_enabled,
        )
    except Exception as exc:  # noqa: BLE001 - typed translation below
        raise _translate_error(exc) from exc
    return asdict(result)


@router.post("/memory/scopes/{scope_type}/{scope_id}/consolidate")
async def consolidate_memory_scope(
    scope_type: ScopeType,
    scope_id: str,
    body: ConsolidateMemoryBody,
):
    service = get_lightweight_memory_service()
    try:
        result = service.consolidate_scope(
            scope_type=scope_type,
            scope_id=scope_id,
            reason=body.reason,
            request_id=body.request_id,
            actor_type="user",
        )
    except Exception as exc:  # noqa: BLE001
        raise _translate_error(exc) from exc
    return {
        "scope_state": asdict(result.scope_state),
        "removed_memory_ids": list(result.removed_memory_ids),
        "retained_memory_ids": list(result.retained_memory_ids),
        "tokens_released": result.tokens_released,
    }


@router.get("/memory/entries")
async def list_memory_entries(
    scope_type: ScopeType,
    scope_id: str,
    include_deleted: bool = Query(default=False),
):
    service = get_lightweight_memory_service()
    try:
        state = service.scope(scope_type, scope_id)
        entries = service.list_entries(
            scope_type,
            scope_id,
            include_deleted=include_deleted,
        )
    except Exception as exc:  # noqa: BLE001
        raise _translate_error(exc) from exc
    return {
        "scope_state": asdict(state),
        "items": [asdict(item) for item in entries],
        "sync_status": service.journal.get_memory_sync_status(
            scope_type, scope_id
        ),
    }


@router.get("/memory/reconciliation")
async def list_memory_reconciliation(
    scope_type: ScopeType,
    scope_id: str,
):
    service = get_lightweight_memory_service()
    try:
        account_owner_id = await current_authenticated_account_owner_id()
        items = service.journal.list_memory_reconciliation_items(
            scope_type,
            scope_id,
            account_owner_id=account_owner_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise _translate_error(exc) from exc
    return {"items": [asdict(item) for item in items]}


@router.post("/memory/reconciliation/{reconciliation_id}/resolve")
async def resolve_memory_reconciliation(
    reconciliation_id: str,
    body: ResolveMemoryReconciliationBody,
):
    service = get_lightweight_memory_service()
    try:
        account_owner_id = await current_authenticated_account_owner_id()
        item = service.resolve_reconciliation(
            reconciliation_id,
            account_owner_id=account_owner_id,
            decision=body.decision,
        )
    except Exception as exc:  # noqa: BLE001
        raise _translate_error(exc) from exc
    return asdict(item)


@router.post("/memory/entries")
async def create_memory_entry(
    scope_type: ScopeType,
    scope_id: str,
    body: CreateMemoryBody,
):
    service = get_lightweight_memory_service()
    try:
        result = service.create_entry(
            scope_type=scope_type,
            scope_id=scope_id,
            kind=body.kind,
            content=body.content,
            actor_type="user",
            reason=body.reason,
            source_trust="user_confirmed",
            source_refs=tuple(body.source_refs),
            priority=body.priority,
            sensitivity=body.sensitivity,
            request_id=body.request_id,
            actor_id=body.actor_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise _translate_error(exc) from exc
    return _serialize_result(result)


@router.patch("/memory/entries/{memory_id}")
async def update_memory_entry(memory_id: str, body: UpdateMemoryBody):
    service = get_lightweight_memory_service()
    try:
        result = service.update_entry(
            memory_id=memory_id,
            expected_version=body.expected_version,
            content=body.content,
            kind=body.kind,
            actor_type="user",
            reason=body.reason,
            request_id=body.request_id,
            priority=body.priority,
            source_trust="user_confirmed",
            source_refs=tuple(body.source_refs),
            sensitivity=body.sensitivity,
            actor_id=body.actor_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise _translate_error(exc) from exc
    return _serialize_result(result)


async def _transition(
    memory_id: str, body: TransitionMemoryBody, operation: str
):
    service = get_lightweight_memory_service()
    try:
        result = service.transition_entry(
            memory_id=memory_id,
            expected_version=body.expected_version,
            operation=operation,
            actor_type="user",
            reason=body.reason,
            request_id=body.request_id,
            actor_id=body.actor_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise _translate_error(exc) from exc
    return _serialize_result(result)


@router.delete("/memory/entries/{memory_id}")
async def delete_memory_entry(memory_id: str, body: TransitionMemoryBody):
    return await _transition(memory_id, body, "remove")


@router.post("/memory/entries/{memory_id}/restore")
async def restore_memory_entry(memory_id: str, body: TransitionMemoryBody):
    return await _transition(memory_id, body, "restore")


@router.post("/memory/entries/{memory_id}/confirm")
async def confirm_memory_entry(memory_id: str, body: TransitionMemoryBody):
    return await _transition(memory_id, body, "confirm")


@router.post("/memory/entries/{memory_id}/pin")
async def pin_memory_entry(memory_id: str, body: TransitionMemoryBody):
    return await _transition(memory_id, body, "pin")
