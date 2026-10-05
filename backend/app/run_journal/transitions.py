"""Authoritative state-transition rules for durable RunJournal entities."""

from __future__ import annotations

from collections.abc import Mapping, Set
from enum import StrEnum
from typing import Any

RUN_ACTIVE_STATES = frozenset({"pending", "running", "waiting_for_user"})
RUN_TERMINAL_STATES = frozenset(
    {"completed", "failed", "cancelled", "timed_out"}
)
RUN_UNSUCCESSFUL_STATES = frozenset({"failed", "timed_out"})
# Interrupted Runs may resume, but they stopped for a recorded cause.
RUN_STOPPED_STATES = RUN_TERMINAL_STATES | {"interrupted"}
# The events that move a Run into each stopped status.
RUN_STOP_EVENT_TYPES: Mapping[str, Set[str]] = {
    "completed": frozenset({"run.completed"}),
    "failed": frozenset({"run.failed"}),
    "cancelled": frozenset({"run.cancelled"}),
    "timed_out": frozenset({"run.deadline_reached"}),
    "interrupted": frozenset({"run.interrupted", "runtime.interrupted"}),
}
ATTEMPT_ACTIVE_STATES = frozenset({"pending", "running", "waiting_for_user"})
ATTEMPT_TERMINAL_STATES = frozenset(
    {"completed", "failed", "cancelled", "interrupted", "timed_out"}
)
COMMAND_TERMINAL_STATES = frozenset({"rejected", "completed", "failed"})
TOOL_TERMINAL_STATES = frozenset(
    {"completed", "failed", "timed_out", "outcome_unknown"}
)

RUN_TRANSITIONS: Mapping[str, Set[str]] = {
    "pending": frozenset(
        {
            "pending",
            "running",
            "waiting_for_user",
            "interrupted",
            "completed",
            "failed",
            "cancelled",
            "timed_out",
        }
    ),
    "running": frozenset(
        {
            "running",
            "waiting_for_user",
            "interrupted",
            "completed",
            "failed",
            "cancelled",
            "timed_out",
        }
    ),
    "waiting_for_user": frozenset(
        {
            "waiting_for_user",
            "running",
            "interrupted",
            "completed",
            "failed",
            "cancelled",
            "timed_out",
        }
    ),
    "interrupted": frozenset(
        {
            "interrupted",
            "pending",
            "running",
            "failed",
            "cancelled",
            "timed_out",
        }
    ),
    "completed": frozenset({"completed"}),
    "failed": frozenset({"failed"}),
    "cancelled": frozenset({"cancelled"}),
    "timed_out": frozenset({"timed_out"}),
}

ATTEMPT_TRANSITIONS: Mapping[str | None, Set[str]] = {
    None: frozenset({"pending", "running"}),
    "pending": frozenset(
        {
            "running",
            "completed",
            "failed",
            "cancelled",
            "interrupted",
            "timed_out",
        }
    ),
    "running": frozenset(
        {
            "waiting_for_user",
            "completed",
            "failed",
            "cancelled",
            "interrupted",
            "timed_out",
        }
    ),
    "waiting_for_user": frozenset(
        {
            "running",
            "completed",
            "failed",
            "cancelled",
            "interrupted",
            "timed_out",
        }
    ),
    "completed": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
    "interrupted": frozenset(),
    "timed_out": frozenset(),
}

TOOL_TRANSITIONS: Mapping[str | None, Set[str]] = {
    None: frozenset({"prepared"}),
    "prepared": frozenset({"prepared", "dispatched", "failed"}),
    "dispatched": frozenset(
        {"dispatched", "completed", "failed", "timed_out", "outcome_unknown"}
    ),
    "timed_out": frozenset({"completed", "failed", "outcome_unknown"}),
    "outcome_unknown": frozenset({"completed", "failed"}),
    "completed": frozenset({"completed"}),
    "failed": frozenset({"failed"}),
}

COMMAND_TRANSITIONS: Mapping[str, Set[str]] = {
    "received": frozenset({"dispatched", "accepted", "rejected"}),
    "dispatched": frozenset({"dispatched", "accepted", "rejected"}),
    "accepted": frozenset({"completed", "failed"}),
    "rejected": frozenset(),
    "completed": frozenset(),
    "failed": frozenset(),
}


def transition_allowed(
    transitions: Mapping[str | None, Set[str]],
    current: str | None,
    target: str,
) -> bool:
    return target in transitions.get(current, frozenset())


class RunTerminalReason(StrEnum):
    """Why a Run or Attempt stopped, at the granularity UI and logic branch on.

    Everything more specific stays in the free-form terminal detail.
    """

    COMPLETED = "completed"
    USER_CANCELLED = "user_cancelled"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    APPROVAL_EXPIRED = "approval_expired"
    BRAIN_RESTART = "brain_restart"
    RUNTIME_LOST = "runtime_lost"
    ERROR = "error"
    BUDGET_EXHAUSTED = "budget_exhausted"


_TERMINAL_REASON_BY_EVENT: Mapping[str, RunTerminalReason] = {
    "run.completed": RunTerminalReason.COMPLETED,
    "run.cancelled": RunTerminalReason.USER_CANCELLED,
    "run.deadline_reached": RunTerminalReason.DEADLINE_EXCEEDED,
    "approval.expired_rejected": RunTerminalReason.APPROVAL_EXPIRED,
    "interaction.expired": RunTerminalReason.APPROVAL_EXPIRED,
    "run.failed": RunTerminalReason.ERROR,
    "run.interrupted": RunTerminalReason.RUNTIME_LOST,
    "runtime.interrupted": RunTerminalReason.RUNTIME_LOST,
    "approval.cancelled": RunTerminalReason.RUNTIME_LOST,
}


def run_terminal_cause(
    event_type: str, payload: Mapping[str, Any]
) -> tuple[RunTerminalReason, str | None] | None:
    """Classify the event that stops a Run; the payload keeps the detail.

    Events that only hand execution to a new Attempt, such as a persisted
    approval decision, have no terminal cause.
    """

    reason = _TERMINAL_REASON_BY_EVENT.get(event_type)
    if reason is None or not isinstance(payload, Mapping):
        return None
    code = payload.get("reason")
    code = code.strip() if isinstance(code, str) and code.strip() else None
    # A restart that stopped the Run first stays its cause, even when the
    # deadline has passed by the time the Brain is back.
    if reason in {
        RunTerminalReason.RUNTIME_LOST,
        RunTerminalReason.DEADLINE_EXCEEDED,
    } and (code or "").startswith("brain_restart"):
        reason = RunTerminalReason.BRAIN_RESTART
    elif (
        reason is RunTerminalReason.ERROR
        and code == "context_budget_exhausted"
    ):
        reason = RunTerminalReason.BUDGET_EXHAUSTED
    message = payload.get("message")
    message = message.strip() if isinstance(message, str) else ""
    detail = ": ".join(part for part in (code, message) if part) or None
    return reason, detail
