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
from contextlib import suppress
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.run_journal import CommittedRunEvent, get_default_run_journal
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
    return {
        **asdict(run),
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
