"""Content-free tool/HITL boundaries alongside provider wait observations."""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Literal

from app.run_context.context import get_current_run_context

logger = logging.getLogger("provider_wait")
_ACTIVITY: ContextVar[str | None] = ContextVar(
    "execution_activity", default=None
)


@contextmanager
def execution_activity(
    phase: Literal["tool", "hitl"], *, tool_call_id: str | None = None
) -> Iterator[None]:
    """Record ownership boundaries; exit never claims tool/model success."""
    context = get_current_run_context()
    identity = {
        "activity_id": f"activity_{uuid.uuid4().hex}",
        "parent_activity_id": _ACTIVITY.get(),
        "run_id": context.run_id if context else None,
        "run_attempt_id": context.attempt_id if context else None,
        "tool_call_id": tool_call_id,
        "phase": phase,
    }
    started = time.monotonic()

    def emit(boundary: str) -> None:
        event = {
            **identity,
            "boundary": boundary,
            "elapsed_seconds": max(0.0, time.monotonic() - started),
        }
        try:
            logger.info(
                "provider_wait %s",
                json.dumps(event),
                extra={"provider_wait": event},
            )
        except Exception:
            pass

    token = _ACTIVITY.set(identity["activity_id"])
    emit("enter")
    try:
        yield
    finally:
        emit("exit")
        _ACTIVITY.reset(token)
