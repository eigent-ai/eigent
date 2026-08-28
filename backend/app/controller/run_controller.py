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
import logging
import time
import uuid
from contextlib import suppress
from dataclasses import asdict
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth import require_local_control_principal
from app.permission_policy import literal_resource_pattern
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
from app.workspace_git.content import ContentRepositoryError

router = APIRouter(dependencies=[Depends(require_local_control_principal)])
logger = logging.getLogger("run_controller")

_EVENT_PAGE_SIZE = 500
_DEFAULT_HEARTBEAT_SECONDS = 15.0
_TERMINAL_EVENT_TYPES = {
    "run.completed",
    "run.failed",
    "run.cancelled",
    "run.deadline_reached",
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


class InteractionDecisionBody(BaseModel):
    decision_request_id: str = Field(min_length=1)
    decision: dict[str, Any]
    expected_version: int = Field(ge=0)
    action_digest: str | None = None
    actor_type: str = "user"
    actor_id: str | None = None
    source: str = "desktop"
    continue_active_attempt: bool = True


def _event_payload(
    event: CommittedRunEvent,
    *,
    project_id: str,
    origin: str,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "event_id": event.event_id,
        "project_id": project_id,
        "run_id": event.run_id,
        # Keep the legacy key during the renderer migration while exposing the
        # transport-neutral contract consumed by RunDomainEventIngress.
        "sequence": event.sequence,
        "run_sequence": event.sequence,
        "run_version": event.run_version,
        "event_type": event.event_type,
        "legacy_step": event.legacy_step,
        "payload": event.payload,
        "created_at": event.created_at,
        "occurred_at": event.created_at,
        "origin": origin,
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
    if event.event_type == "assistant.final":
        # This typed result carries legacy_step=end only so old UI projectors
        # can render it. The Coordinator's run.completed event owns the
        # lifecycle transition and must remain observable on this stream.
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
    project_id: str,
    origin: str,
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
    replay_caught_up = False

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
                        _event_payload(
                            event,
                            project_id=project_id,
                            origin=origin,
                        ),
                        event_id=event.sequence,
                    )
                if len(events) < _EVENT_PAGE_SIZE:
                    break

            if not replay_caught_up:
                # This marker is deliberately not a canonical Run event. It
                # lets the application-owned ingress distinguish replayed
                # SQLite facts from subsequently arriving live facts without
                # guessing from timing. Legacy EventSource consumers ignore
                # unknown event names.
                replay_caught_up = True
                yield _sse(
                    "replay_caught_up",
                    {"run_id": run_id, "after_sequence": cursor},
                )

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
            except RunExecutionError:
                logger.warning(
                    "Run execution stream detached after runtime failure",
                    extra={"run_id": run_id},
                )
                runtime_error = "Run execution stopped unexpectedly."
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


def _total_attempt_elapsed_ms(attempts: list[Any], *, now: float) -> int:
    """Return Run execution wall time without counting gaps between attempts.

    Older/legacy attempts did not emit periodic heartbeat accounting, so their
    ``elapsed_active_ms`` remains zero. For those rows the durable started/end
    timestamps are the best available source. Summing each attempt separately
    deliberately excludes the offline interval between an interruption and a
    later Resume.
    """

    total = 0
    for attempt in attempts:
        ended_at = attempt.ended_at
        if ended_at is not None:
            total += max(0, round((ended_at - attempt.started_at) * 1000))
        elif attempt.status == "running":
            total += max(0, round((now - attempt.started_at) * 1000))
        else:
            total += max(0, int(attempt.elapsed_active_ms))
    return total


@router.get("/runs")
async def list_project_runs(
    project_id: str = Query(min_length=1),
    status: Annotated[list[str] | None, Query()] = None,
    limit: int = Query(default=20, ge=1, le=100),
):
    """Return canonical Run state for the main Desktop Project UI."""

    # Local SQLite is the Desktop read authority and must remain available
    # while the independent CloudSyncWorker repairs its replica in the
    # background. Awaiting the account-wide bootstrap here made the first
    # Project open wait on every Cloud Project (often for many seconds), even
    # when this Project was already fully durable on disk.
    from app.run_sync.runtime import (
        is_default_cloud_history_bootstrap_pending,
        notify_default_cloud_sync_worker,
    )

    notify_default_cloud_sync_worker()
    journal = get_default_run_journal()
    runs = await asyncio.to_thread(
        journal.list_runs,
        project_id=project_id,
        statuses=tuple(status) if status else None,
        limit=limit,
    )
    items: list[dict[str, Any]] = []
    now = time.time()
    for run in runs:
        attempts = await asyncio.to_thread(
            journal.list_run_attempts, run.run_id
        )
        items.append(
            {
                **asdict(run),
                "latest_attempt": (asdict(attempts[-1]) if attempts else None),
                "total_attempt_elapsed_ms": (
                    _total_attempt_elapsed_ms(attempts, now=now)
                    if attempts
                    else None
                ),
            }
        )
    return {
        "project_id": project_id,
        "runs": items,
        "cloud_restore_pending": (
            is_default_cloud_history_bootstrap_pending()
        ),
    }


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    run = await _load_run_or_404(run_id)
    handle = await get_default_run_coordinator().get_handle(run_id)
    journal = get_default_run_journal()
    attempts, approvals, interactions, tool_calls = await asyncio.gather(
        asyncio.to_thread(journal.list_run_attempts, run_id),
        asyncio.to_thread(journal.list_approvals, run_id),
        asyncio.to_thread(journal.list_human_interactions, run_id),
        asyncio.to_thread(journal.list_tool_calls, run_id),
    )
    return {
        **asdict(run),
        "attempts": [asdict(attempt) for attempt in attempts],
        "approvals": [asdict(approval) for approval in approvals],
        "interactions": [asdict(interaction) for interaction in interactions],
        "tool_calls": [asdict(tool_call) for tool_call in tool_calls],
        "runtime": {
            "consumer_alive": bool(handle and handle.consumer_alive),
            "subscriber_count": handle.subscriber_count if handle else 0,
            "consumer_heartbeat_at": (
                handle.consumer_heartbeat_at if handle else None
            ),
        },
    }


@router.get("/runs/{run_id}/interactions")
async def list_run_interactions(
    run_id: str,
    status: str = Query(default="pending"),
):
    await _load_run_or_404(run_id)
    if status not in {"pending", "all"}:
        raise HTTPException(
            status_code=422, detail="status must be 'pending' or 'all'"
        )
    journal = get_default_run_journal()
    interactions = await asyncio.to_thread(
        journal.list_human_interactions,
        run_id,
        pending_only=status == "pending",
    )
    items: list[dict[str, Any]] = []
    for interaction in interactions:
        options = await asyncio.to_thread(
            journal.list_human_interaction_options,
            interaction.interaction_id,
        )
        items.append(
            {
                **asdict(interaction),
                "options": [asdict(option) for option in options],
            }
        )
    return {"run_id": run_id, "interactions": items}


@router.post("/runs/{run_id}/interactions/{interaction_id}/decisions")
async def decide_run_interaction(
    run_id: str,
    interaction_id: str,
    body: InteractionDecisionBody,
):
    journal = get_default_run_journal()
    decision_applied = False
    try:
        interaction = await asyncio.to_thread(
            journal.get_human_interaction, interaction_id
        )
        if interaction is None:
            raise RunNotFoundError(
                f"interaction_id {interaction_id!r} does not exist"
            )
        if interaction.run_id != run_id:
            raise IdempotencyConflictError(
                f"interaction {interaction_id!r} does not belong to run "
                f"{run_id!r}"
            )
        if interaction.status not in {"requested", "presented"}:
            # Decision delivery is an idempotent convergence endpoint. A
            # restart, another client, or a lost response may leave a stale UI
            # holding a terminal interaction. Return its canonical state so
            # the client can replay the durable terminal event; never inject
            # the stale decision into a newly resumed live waiter.
            result = interaction
        elif interaction.interaction_type == "approval":
            if not body.action_digest:
                raise ValueError(
                    "action_digest is required for approval decisions"
                )
            approval_decision = str(body.decision.get("decision") or "")
            decision_scope = str(body.decision.get("scope") or "once")
            action = interaction.request.get("action")
            action = action if isinstance(action, dict) else {}
            target_resources = action.get("target_resources")
            target_resources = (
                target_resources if isinstance(target_resources, list) else []
            )
            allowed_scopes = interaction.request.get("allowed_scopes")
            allowed_scopes = (
                {str(item) for item in allowed_scopes}
                if isinstance(allowed_scopes, list)
                else {"once"}
            )
            if decision_scope not in allowed_scopes:
                raise ValueError(
                    f"approval scope {decision_scope!r} was not offered"
                )
            resource_pattern = (
                literal_resource_pattern(str(target_resources[0]))
                if decision_scope in {"run", "space"}
                and len(target_resources) == 1
                else None
            )
            if (
                approval_decision == "approved"
                and decision_scope in {"run", "space"}
                and resource_pattern is None
            ):
                raise ValueError(
                    "persistent approval requires one exact resource matcher"
                )
            rule_space_id = interaction.request.get("space_id")
            offered_matcher = interaction.request.get("rule_matcher")
            offered_action_pattern = (
                str(offered_matcher.get("action_pattern"))
                if isinstance(offered_matcher, dict)
                and offered_matcher.get("action_pattern") is not None
                else None
            )
            details = {
                key: value
                for key, value in body.decision.items()
                if key != "decision"
            }
            await asyncio.to_thread(
                journal.decide_approval,
                interaction_id,
                decision=approval_decision,
                details=details,
                expected_version=body.expected_version,
                expected_run_id=run_id,
                continue_active_attempt=body.continue_active_attempt,
                decision_request_id=body.decision_request_id,
                action_digest=body.action_digest,
                actor_type=body.actor_type,
                actor_id=body.actor_id,
                source=body.source,
                decision_scope=decision_scope,
                rule_space_id=(
                    str(rule_space_id) if rule_space_id is not None else None
                ),
                rule_id=(
                    f"approval-rule:{interaction_id}:{decision_scope}"
                    if approval_decision == "approved"
                    and decision_scope in {"run", "space"}
                    else None
                ),
                rule_action_pattern=(
                    offered_action_pattern
                    if decision_scope in {"run", "space"}
                    else None
                ),
                rule_resource_pattern=(resource_pattern),
            )
            result = await asyncio.to_thread(
                journal.get_human_interaction, interaction_id
            )
            assert result is not None
            decision_applied = True
        else:
            result = await asyncio.to_thread(
                journal.resolve_human_interaction,
                interaction_id,
                decision_request_id=body.decision_request_id,
                decision=body.decision,
                expected_version=body.expected_version,
                expected_run_id=run_id,
                actor_type=body.actor_type,
                actor_id=body.actor_id,
                source=body.source,
                continue_active_attempt=body.continue_active_attempt,
            )
            decision_applied = True
            if interaction.interaction_type == "merge_conflict":
                from app.workspace_git import (
                    get_default_workforce_git_service,
                )

                await asyncio.to_thread(
                    get_default_workforce_git_service().resolve_merge_conflict,
                    interaction_id,
                )
    except Exception as exc:
        raise _control_error(exc) from exc
    run = await asyncio.to_thread(journal.get_run, run_id)
    agent = interaction.request.get("agent")
    if (
        decision_applied
        and run is not None
        and isinstance(agent, str)
        and agent
    ):
        from app.service.task import get_task_lock_if_exists

        task_lock = get_task_lock_if_exists(run.project_id)
        if task_lock is not None:
            reply_value = body.decision.get("reply")
            if reply_value is None:
                reply_value = body.decision.get("decision")
            if reply_value is None and body.decision:
                reply_value = json.dumps(
                    body.decision,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                )
            if reply_value is not None:
                try:
                    await task_lock.put_human_input(agent, str(reply_value))
                except KeyError:
                    logger.info(
                        "Interaction decision persisted without a live waiter",
                        extra={
                            "run_id": run_id,
                            "interaction_id": interaction_id,
                        },
                    )
    return asdict(result)


@router.get("/runs/{run_id}/events")
async def get_run_events(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=5000),
):
    run = await _load_run_or_404(run_id)
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
        "events": [
            _event_payload(
                event,
                project_id=run.project_id,
                origin=run.origin,
            )
            for event in page
        ],
    }


@router.get("/runs/{run_id}/stream")
async def stream_run_events(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
):
    run = await _load_run_or_404(run_id)
    reconnect_sequence = after_sequence
    if isinstance(last_event_id, str):
        try:
            parsed_last_event_id = int(last_event_id)
        except ValueError:
            parsed_last_event_id = -1
        if parsed_last_event_id >= 0:
            reconnect_sequence = max(reconnect_sequence, parsed_last_event_id)
    return StreamingResponse(
        _durable_event_stream(
            run_id,
            project_id=run.project_id,
            origin=run.origin,
            after_sequence=reconnect_sequence,
        ),
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
    if isinstance(exc, ContentRepositoryError):
        return HTTPException(
            status_code=409,
            detail={"code": "git_needs_attention", "message": str(exc)},
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
            await get_default_run_coordinator().notify_deadline_changed(run_id)
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
                action_digest=payload.get("action_digest"),
                policy_revision=str(
                    payload.get("policy_revision") or "legacy"
                ),
                safety_class=str(payload.get("safety_class") or "unknown"),
                decision_scope=str(payload.get("decision_scope") or "once"),
            )
        elif body.signal_type == "approval.decided":
            result = await asyncio.to_thread(
                journal.decide_approval,
                str(payload["approval_id"]),
                decision=str(payload["decision"]),
                details=dict(payload.get("details") or {}),
                expected_version=int(payload["expected_version"]),
                expected_run_id=run_id,
                decision_request_id=payload.get("decision_request_id"),
                action_digest=payload.get("action_digest"),
                actor_type=str(payload.get("actor_type") or "user"),
                actor_id=payload.get("actor_id"),
                source=str(payload.get("source") or "desktop"),
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
