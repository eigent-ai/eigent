"""Authoritative state-transition rules for durable RunJournal entities."""

from __future__ import annotations

from collections.abc import Mapping, Set

RUN_TERMINAL_STATES = frozenset({"completed", "failed", "cancelled"})
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
        }
    ),
    "interrupted": frozenset(
        {"interrupted", "pending", "running", "failed", "cancelled"}
    ),
    "completed": frozenset({"completed"}),
    "failed": frozenset({"failed"}),
    "cancelled": frozenset({"cancelled"}),
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
