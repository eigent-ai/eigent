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

"""Durable Remote Control Inbox endpoints used by the Desktop renderer."""

from __future__ import annotations

import asyncio
import time
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_local_control_principal
from app.run_journal import (
    IdempotencyConflictError,
    InvalidRunTransitionError,
    RunJournalError,
    RunNotFoundError,
    get_default_run_journal,
)
from app.run_sync.runtime import (
    notify_default_cloud_sync_worker,
    persist_and_confirm_remote_command,
)

router = APIRouter(
    prefix="/remote-control/commands",
    dependencies=[Depends(require_local_control_principal)],
)

_HIGH_RISK_COMMAND_TYPES = {
    "stop",
    "stop_task",
    "remove_task",
    "space_apply_project_run",
    "space_discard_project_overlays",
}


def _raise_journal_http_error(exc: RunJournalError) -> None:
    if isinstance(exc, RunNotFoundError):
        raise HTTPException(
            status_code=404,
            detail={"code": "REMOTE_COMMAND_NOT_FOUND", "message": str(exc)},
        ) from exc
    if isinstance(exc, (IdempotencyConflictError, InvalidRunTransitionError)):
        raise HTTPException(
            status_code=409,
            detail={"code": "REMOTE_COMMAND_CONFLICT", "message": str(exc)},
        ) from exc
    raise HTTPException(
        status_code=503,
        detail={"code": "RUN_JOURNAL_UNAVAILABLE", "message": str(exc)},
    ) from exc


class RemoteCommandInboxIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    session_id: str = Field(min_length=1, max_length=64)
    user_id: int
    project_id: str | None = None
    target_project_id: str | None = None
    run_id: str | None = None
    target_task_id: str | None = None
    route_version: int = Field(default=1, ge=1)
    type: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    expires_at: datetime | None = None
    receipt_grace_until: datetime | None = None
    requires_online_receipt_confirmation: bool = False
    lease_token: str | None = Field(default=None, min_length=1, max_length=64)
    receipt_event_id: str | None = Field(default=None, max_length=64)


class CommandAdmissionIn(BaseModel):
    status: Literal["accepted", "rejected"]
    event_id: str | None = Field(default=None, max_length=64)
    reason: str | None = None


class CommandExecutionResultIn(BaseModel):
    status: Literal["completed", "failed"]
    event_id: str | None = Field(default=None, max_length=64)
    result: dict[str, Any] = Field(default_factory=dict)
    error_code: str | None = None
    error: str | None = None


def _normalized_command(body: RemoteCommandInboxIn) -> dict[str, Any]:
    now = datetime.now(UTC)
    expires_at = body.expires_at or now + timedelta(minutes=2)
    receipt_grace_until = body.receipt_grace_until or expires_at + timedelta(
        seconds=30
    )
    project_id = body.target_project_id or body.project_id
    if not project_id:
        raise HTTPException(status_code=422, detail="project_id is required")
    return {
        **body.model_dump(mode="json"),
        "project_id": project_id,
        "target_project_id": project_id,
        "run_id": body.target_task_id or body.run_id,
        "expires_at": expires_at.isoformat(),
        "receipt_grace_until": receipt_grace_until.isoformat(),
        "requires_online_receipt_confirmation": (
            body.requires_online_receipt_confirmation
            or body.type in _HIGH_RISK_COMMAND_TYPES
        ),
    }


@router.post("/inbox")
async def persist_command_inbox(body: RemoteCommandInboxIn):
    try:
        record, may_execute = await persist_and_confirm_remote_command(
            _normalized_command(body)
        )
    except RunJournalError as exc:
        _raise_journal_http_error(exc)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(
            status_code=422, detail=f"missing command field: {exc.args[0]}"
        ) from exc
    execution_event = await asyncio.to_thread(
        get_default_run_journal().get_latest_command_execution_result,
        record.command_id,
    )
    return {
        "command": asdict(record),
        "may_execute": may_execute,
        "execution_event": asdict(execution_event)
        if execution_event
        else None,
    }


@router.get("/inbox/pending")
async def list_pending_command_inbox(limit: int = 100):
    journal = get_default_run_journal()
    records = await asyncio.to_thread(
        journal.list_reconcilable_commands, limit=min(max(limit, 1), 500)
    )
    dispatched = []
    for record in records:
        dispatched.append(
            await asyncio.to_thread(
                journal.mark_command_dispatched, record.command_id
            )
        )
    return {"items": [asdict(record) for record in dispatched]}


@router.post("/{command_id}/admission")
async def record_command_admission(command_id: str, body: CommandAdmissionIn):
    journal = get_default_run_journal()
    record = await asyncio.to_thread(journal.get_remote_command, command_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Command not found")
    if body.status == "accepted" and record.receipt_status == "expired_late":
        raise HTTPException(
            status_code=409, detail="Expired command cannot be admitted"
        )
    try:
        event = await asyncio.to_thread(
            journal.append_command_result,
            command_id,
            event_type=f"admission.{body.status}",
            event_id=body.event_id,
            payload={"reason": body.reason} if body.reason else {},
            occurred_at=time.time(),
        )
    except RunJournalError as exc:
        _raise_journal_http_error(exc)
    notify_default_cloud_sync_worker()
    return asdict(event)


@router.post("/{command_id}/result")
async def record_command_result(
    command_id: str, body: CommandExecutionResultIn
):
    journal = get_default_run_journal()
    try:
        event = await asyncio.to_thread(
            journal.append_command_result,
            command_id,
            event_type=f"execution.{body.status}",
            event_id=body.event_id,
            payload={
                "result": body.result,
                "error_code": body.error_code,
                "error": body.error,
            },
            occurred_at=time.time(),
        )
    except RunJournalError as exc:
        _raise_journal_http_error(exc)
    notify_default_cloud_sync_worker()
    return asdict(event)
