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

"""Durable Run read and replay endpoints.

Live RuntimeHandle notifications are wake-ups only. Every event returned to a
client is reread from SQLite by sequence, so reconnect correctness never
depends on an in-memory queue.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from contextlib import suppress
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.run_journal import (
    CommittedRunEvent,
    IdempotencyConflictError,
    InvalidRunTransitionError,
    OptimisticConcurrencyError,
    RunNotFoundError,
    UnsafeResumeError,
    get_default_run_journal,
)
from app.run_policy import (
    RunTimeoutPolicy,
    TimeoutOutcome,
    TimeoutScope,
    ToolSafetyClass,
)
from app.run_runtime import (
    RunExecutionError,
    SubscriberLaggedError,
    get_default_run_coordinator,
)

router = APIRouter()

_EVENT_PAGE_SIZE = 500
_DEFAULT_HEARTBEAT_SECONDS = 15.0
_TERMINAL_EVENT_TYPES = {
    "run.completed",
    "run.failed",
    "run.cancelled",
    "run.timed_out",
}


class ResumeRunBody(BaseModel):
    request_id: str = Field(min_length=1)
    reason: str = Field(default="explicit_resume", min_length=1)


class ForkRunBody(BaseModel):
    request_id: str = Field(min_length=1)
    new_run_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()), min_length=1
    )


class CancelRunBody(BaseModel):
    request_id: str = Field(min_length=1)
    reason: str = Field(default="explicit_cancel", min_length=1)


class RunSignalBody(BaseModel):
    signal_type: str = Field(min_length=1)
    signal_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()), min_length=1
    )
    payload: dict[str, Any] = Field(default_factory=dict)


def _event_payload(event: CommittedRunEvent) -> dict[str, Any]:
    return {
        "event_id": event.event_id,
        "run_id": event.run_id,
        "sequence": event.sequence,
        "run_version": event.run_version,
        "event_type": event.event_type,
        "legacy_step": event.legacy_step,
        "payload": event.payload,
        "created_at": event.created_at,
    }


def _sse(
    event: str,
    data: dict[str, Any],
    *,
    event_id: int | None = None,
) -> str:
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    lines.append(
        "data: " + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    )
    return "\n".join(lines) + "\n\n"


def _is_terminal(event: CommittedRunEvent | None) -> bool:
    if event is None:
        return False
    return (
        event.legacy_step == "end" or event.event_type in _TERMINAL_EVENT_TYPES
    )


async def _read_events(
    run_id: str,
    *,
    after_sequence: int,
    limit: int,
) -> list[CommittedRunEvent]:
    return await asyncio.to_thread(
        get_default_run_journal().list_events,
        run_id,
        after_sequence=after_sequence,
        limit=limit,
    )


async def _durable_event_stream(
    run_id: str,
    *,
    after_sequence: int,
    heartbeat_seconds: float = _DEFAULT_HEARTBEAT_SECONDS,
):
    """Subscribe first, then drain SQLite; sequence is the dedupe boundary."""

    coordinator = get_default_run_coordinator()
    subscription = await coordinator.attach_if_running(run_id)
    pending_notification: asyncio.Task[str] | None = None
    cursor = after_sequence
    last_event: CommittedRunEvent | None = None
    runtime_error: str | None = None
    subscriber_lagged = False

    try:
        while True:
            while True:
                events = await _read_events(
                    run_id,
                    after_sequence=cursor,
                    limit=_EVENT_PAGE_SIZE,
                )
                if not events:
                    break
                for event in events:
                    cursor = event.sequence
                    last_event = event
                    yield _sse(
                        "run_event",
                        _event_payload(event),
                        event_id=event.sequence,
                    )
                if len(events) < _EVENT_PAGE_SIZE:
                    break

            if subscription is None:
                if subscriber_lagged:
                    yield _sse(
                        "replay_required",
                        {"run_id": run_id, "after_sequence": cursor},
                    )
                elif runtime_error is not None:
                    yield _sse(
                        "runtime_error",
                        {
                            "run_id": run_id,
                            "after_sequence": cursor,
                            "message": runtime_error,
                        },
                    )
                elif not _is_terminal(last_event):
                    yield _sse(
                        "runtime_detached",
                        {
                            "run_id": run_id,
                            "after_sequence": cursor,
                            "message": "No live consumer; explicit resume may be required.",
                        },
                    )
                return

            if pending_notification is None:
                pending_notification = asyncio.create_task(
                    subscription.__anext__()
                )
            done, _ = await asyncio.wait(
                {pending_notification},
                timeout=heartbeat_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                yield _sse(
                    "heartbeat",
                    {"run_id": run_id, "after_sequence": cursor},
                )
                continue

            try:
                pending_notification.result()
            except StopAsyncIteration:
                subscription = None
            except SubscriberLaggedError:
                subscriber_lagged = True
                subscription = None
            except RunExecutionError as exc:
                runtime_error = str(exc)
                subscription = None
            finally:
                pending_notification = None
    finally:
        if (
            pending_notification is not None
            and not pending_notification.done()
        ):
            pending_notification.cancel()
            with suppress(asyncio.CancelledError):
                await pending_notification
        if subscription is not None:
            await subscription.aclose()


async def _load_run_or_404(run_id: str):
    run = await asyncio.to_thread(get_default_run_journal().get_run, run_id)
    if run is None:
        raise HTTPException(
            status_code=404, detail=f"Run {run_id!r} not found"
        )
    return run


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    run = await _load_run_or_404(run_id)
    handle = await get_default_run_coordinator().get_handle(run_id)
    journal = get_default_run_journal()
    attempts, approvals, tool_calls = await asyncio.gather(
        asyncio.to_thread(journal.list_run_attempts, run_id),
        asyncio.to_thread(journal.list_approvals, run_id),
        asyncio.to_thread(journal.list_tool_calls, run_id),
    )
    return {
        **asdict(run),
        "attempts": [asdict(attempt) for attempt in attempts],
        "approvals": [asdict(approval) for approval in approvals],
        "tool_calls": [asdict(tool_call) for tool_call in tool_calls],
        "runtime": {
            "consumer_alive": bool(handle and handle.consumer_alive),
            "subscriber_count": handle.subscriber_count if handle else 0,
            "consumer_heartbeat_at": (
                handle.consumer_heartbeat_at if handle else None
            ),
        },
    }


@router.get("/runs/{run_id}/events")
async def get_run_events(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=5000),
):
    await _load_run_or_404(run_id)
    events = await _read_events(
        run_id,
        after_sequence=after_sequence,
        limit=limit + 1,
    )
    has_more = len(events) > limit
    page = events[:limit]
    return {
        "run_id": run_id,
        "after_sequence": after_sequence,
        "next_sequence": page[-1].sequence if page else after_sequence,
        "has_more": has_more,
        "events": [_event_payload(event) for event in page],
    }


@router.get("/runs/{run_id}/stream")
async def stream_run_events(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
):
    await _load_run_or_404(run_id)
    return StreamingResponse(
        _durable_event_stream(run_id, after_sequence=after_sequence),
        media_type="text/event-stream",
    )


def _control_error(exc: Exception) -> HTTPException:
    if isinstance(exc, RunNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, UnsafeResumeError):
        return HTTPException(
            status_code=409,
            detail={
                "code": "unsafe_resume_blocked",
                "tool_call_ids": list(exc.tool_call_ids),
            },
        )
    if isinstance(
        exc,
        (
            InvalidRunTransitionError,
            OptimisticConcurrencyError,
            IdempotencyConflictError,
        ),
    ):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, (ValueError, KeyError, TypeError)):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=500, detail="Run control failed")


@router.post("/runs/{run_id}/resume", status_code=202)
async def resume_run(run_id: str, body: ResumeRunBody):
    try:
        attempt = await get_default_run_coordinator().resume(
            run_id,
            request_id=body.request_id,
            reason=body.reason,
        )
    except Exception as exc:
        raise _control_error(exc) from exc
    return {
        "run_id": run_id,
        "attempt": asdict(attempt),
        "execution_state": "awaiting_execution_context",
        "message": "Attempt is durable; execution requires fresh credentials and workspace binding.",
    }


@router.post("/runs/{run_id}/fork", status_code=201)
async def fork_run(run_id: str, body: ForkRunBody):
    try:
        forked, checkpoint = await get_default_run_coordinator().fork(
            run_id,
            new_run_id=body.new_run_id,
            request_id=body.request_id,
        )
    except Exception as exc:
        raise _control_error(exc) from exc
    return {
        "run": asdict(forked),
        "checkpoint_attempt": asdict(checkpoint),
        "requires_resume": True,
    }


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, body: CancelRunBody):
    try:
        run = await get_default_run_coordinator().cancel_durable(
            run_id,
            request_id=body.request_id,
            reason=body.reason,
        )
    except Exception as exc:
        raise _control_error(exc) from exc
    return asdict(run)


@router.post("/runs/{run_id}/signals")
async def signal_run(run_id: str, body: RunSignalBody):
    journal = get_default_run_journal()
    payload = body.payload
    try:
        if body.signal_type == "runtime.heartbeat":
            result = await asyncio.to_thread(
                journal.heartbeat_attempt,
                str(payload["attempt_id"]),
                expected_run_id=run_id,
            )
        elif body.signal_type == "attempt.activated":
            result = await asyncio.to_thread(
                journal.activate_run_attempt,
                str(payload["attempt_id"]),
                expected_run_id=run_id,
            )
        elif body.signal_type == "timeout.policy_configured":
            result = await asyncio.to_thread(
                journal.set_timeout_policy,
                run_id,
                RunTimeoutPolicy.from_dict(payload),
            )
        elif body.signal_type == "approval.requested":
            result = await asyncio.to_thread(
                journal.create_approval,
                approval_id=str(payload["approval_id"]),
                run_id=run_id,
                attempt_id=payload.get("attempt_id"),
                prompt=dict(payload.get("prompt") or {}),
                expires_at=payload.get("expires_at"),
                expiry_action=str(
                    payload.get("expiry_action") or "keep_pending"
                ),
            )
        elif body.signal_type == "approval.decided":
            result = await asyncio.to_thread(
                journal.decide_approval,
                str(payload["approval_id"]),
                decision=str(payload["decision"]),
                details=dict(payload.get("details") or {}),
                expected_version=int(payload["expected_version"]),
                expected_run_id=run_id,
            )
        elif (
            "scope" in payload
            and "policy_version" in payload
            and (
                body.signal_type.endswith(".timed_out")
                or body.signal_type
                in {
                    "runtime.interrupted",
                    "run.deadline_reached",
                    "approval.expired",
                    "tool.outcome_unknown",
                }
            )
        ):
            scope = TimeoutScope(str(payload["scope"]))
            result = await asyncio.to_thread(
                journal.record_timeout_outcome,
                TimeoutOutcome(
                    scope=scope,
                    policy_version=str(payload["policy_version"]),
                    reason=str(payload["reason"]),
                    started_at=float(payload["started_at"]),
                    ended_at=float(payload.get("ended_at", time.time())),
                    run_id=run_id,
                    attempt_id=payload.get("attempt_id"),
                    activity_id=payload.get("activity_id"),
                    tool_call_id=payload.get("tool_call_id"),
                    approval_id=payload.get("approval_id"),
                ),
            )
        elif body.signal_type.startswith("tool."):
            result = await asyncio.to_thread(
                journal.checkpoint_tool_call,
                tool_call_id=str(payload["tool_call_id"]),
                run_id=run_id,
                attempt_id=payload.get("attempt_id"),
                tool_name=str(payload["tool_name"]),
                safety_class=ToolSafetyClass(str(payload["safety_class"])),
                status=body.signal_type.removeprefix("tool."),
                request=dict(payload.get("request") or {}),
                result=(
                    dict(payload["result"])
                    if payload.get("result") is not None
                    else None
                ),
                idempotency_key=payload.get("idempotency_key"),
                outcome=payload.get("outcome"),
                timeout_reason=payload.get("timeout_reason"),
            )
        else:
            raise ValueError(f"unsupported signal_type {body.signal_type!r}")
    except Exception as exc:
        raise _control_error(exc) from exc
    return {"signal_id": body.signal_id, "result": asdict(result)}
