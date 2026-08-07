"""Typed timeout and external-side-effect recovery policies."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class TimeoutScope(StrEnum):
    TRANSPORT_IDLE = "transport_idle"
    RUNTIME_LIVENESS = "runtime_liveness"
    ACTIVITY = "activity_timeout"
    TOOL = "tool_timeout"
    RUN_DEADLINE = "run_deadline"
    APPROVAL_EXPIRY = "approval_expiry"
    REMOTE_COMMAND_TTL = "remote_command_ttl"
    CLOUD_SYNC = "cloud_sync_timeout"


class ToolSafetyClass(StrEnum):
    SAFE_READ = "safe_read"
    IDEMPOTENT_WRITE = "idempotent_write"
    UNSAFE_WRITE = "unsafe_write"


@dataclass(frozen=True)
class RunTimeoutPolicy:
    policy_version: str = "v1"
    run_deadline_at: float | None = None
    active_execution_budget_ms: int | None = None
    default_activity_timeout_ms: int = 300_000
    activity_timeout_by_type: dict[str, int] = field(default_factory=dict)
    tool_timeout_by_class: dict[str, int] = field(default_factory=dict)
    approval_expires_at: float | None = None
    approval_expiry_action: str = "keep_pending"

    def __post_init__(self) -> None:
        if not self.policy_version.strip():
            raise ValueError("timeout policy version must not be empty")
        positive = {
            "active_execution_budget_ms": self.active_execution_budget_ms,
            "default_activity_timeout_ms": self.default_activity_timeout_ms,
            **{
                f"activity_timeout_by_type.{key}": value
                for key, value in self.activity_timeout_by_type.items()
            },
            **{
                f"tool_timeout_by_class.{key}": value
                for key, value in self.tool_timeout_by_class.items()
            },
        }
        for name, value in positive.items():
            if value is not None and value <= 0:
                raise ValueError(f"{name} must be positive")
        if self.approval_expiry_action not in {"keep_pending", "reject"}:
            raise ValueError(
                "approval expiry action must be keep_pending or reject"
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any] | None) -> RunTimeoutPolicy:
        return cls(**(value or {}))


@dataclass(frozen=True)
class TimeoutOutcome:
    scope: TimeoutScope
    policy_version: str
    reason: str
    started_at: float
    ended_at: float
    run_id: str
    attempt_id: str | None = None
    activity_id: str | None = None
    tool_call_id: str | None = None
    approval_id: str | None = None

    def __post_init__(self) -> None:
        if self.ended_at < self.started_at:
            raise ValueError("timeout outcome cannot end before it starts")
        if not self.reason.strip():
            raise ValueError("timeout outcome reason must not be empty")
        if self.scope is TimeoutScope.TOOL and not self.tool_call_id:
            raise ValueError("tool timeout requires tool_call_id")
        if self.scope is TimeoutScope.ACTIVITY and not self.activity_id:
            raise ValueError("activity timeout requires activity_id")
        if self.scope is TimeoutScope.APPROVAL_EXPIRY and not self.approval_id:
            raise ValueError("approval timeout requires approval_id")

    def to_payload(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["scope"] = self.scope.value
        return payload


def automatic_tool_replay_allowed(
    safety_class: ToolSafetyClass,
    *,
    idempotency_key: str | None,
) -> bool:
    if safety_class is ToolSafetyClass.SAFE_READ:
        return True
    if safety_class is ToolSafetyClass.IDEMPOTENT_WRITE:
        return bool(idempotency_key)
    return False
