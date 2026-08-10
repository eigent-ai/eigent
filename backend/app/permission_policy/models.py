"""Trusted action descriptors and permission-policy contracts."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.run_policy import ToolSafetyClass
from app.workspace_config import canonical_digest, canonical_json

_MAX_PERSISTED_ARGUMENT_BYTES = 16 * 1024
_MAX_ARGUMENT_PREVIEW_CHARS = 4000
_REDACTED_ARGUMENT_KEYS = frozenset(
    {
        "access_token",
        "api_key",
        "apikey",
        "authorization",
        "client_secret",
        "cookie",
        "credential",
        "credentials",
        "password",
        "private_key",
        "refresh_token",
        "secret",
        "secret_value",
        "token",
    }
)
_SECRET_VALUE_PATTERNS = (
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{12,}"),
    re.compile(r"\bsk-(?:live-|test-)?[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b"),
)


def _normalized_key(value: object) -> str:
    text = re.sub(r"(?<!^)(?=[A-Z])", "_", str(value))
    return text.replace("-", "_").lower()


def _canonical_action_value(value: Any) -> Any:
    """Make model-produced values digestible without weakening JSON manifests."""

    if isinstance(value, dict):
        return {
            str(key): _canonical_action_value(child)
            for key, child in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_canonical_action_value(child) for child in value]
    if isinstance(value, float) and not math.isfinite(value):
        return {"__eigent_non_finite_float__": repr(value)}
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return {"__eigent_python_repr__": repr(value)}


def _redacted_action_value(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, child in value.items():
            normalized = _normalized_key(key)
            if normalized in _REDACTED_ARGUMENT_KEYS or (
                normalized.endswith("s")
                and normalized[:-1] in _REDACTED_ARGUMENT_KEYS
            ):
                redacted[str(key)] = "[REDACTED]"
            elif normalized == "argv" and isinstance(child, (list, tuple)):
                encoded = json.dumps(
                    _canonical_action_value(child),
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode("utf-8")
                redacted[str(key)] = {
                    "argument_count": len(child),
                    "sha256": hashlib.sha256(encoded).hexdigest(),
                }
            else:
                redacted[str(key)] = _redacted_action_value(child)
        return redacted
    if isinstance(value, (list, tuple)):
        return [_redacted_action_value(child) for child in value]
    if isinstance(value, str):
        redacted = value
        for pattern in _SECRET_VALUE_PATTERNS:
            redacted = pattern.sub("[REDACTED]", redacted)
        return redacted
    return _canonical_action_value(value)


class PermissionProfileName(StrEnum):
    READ_ONLY = "read_only"
    REQUEST_APPROVAL = "request_approval"
    AUTO_REVIEWER = "auto_reviewer"
    FULL_ACCESS = "full_access"


class PolicyEffect(StrEnum):
    ALLOW = "allow"
    PROMPT = "prompt"
    DENY = "deny"


def literal_resource_pattern(value: str) -> str:
    """Escape a code-owned resource so fnmatch treats it literally."""

    return value.replace("[", "[[]").replace("*", "[*]").replace("?", "[?]")


ACTION_OPERATIONS = frozenset(
    {
        "filesystem.read",
        "filesystem.write",
        "filesystem.delete",
        "terminal.execute",
        "browser.read",
        "browser.interact",
        "connector.read",
        "connector.write",
        "connector.delete",
        "mcp.tool.read",
        "mcp.tool.write",
        "skill.script.execute",
        "git.read",
        "git.local_write",
        "git.integrate",
        "git.history_rewrite",
        "git.destructive",
        "git.remote_read",
        "git.remote_write",
        "git.config_sensitive",
        "permission.rule.create",
        "permission.profile.modify",
    }
)


@dataclass(frozen=True)
class ActionDescriptor:
    action_id: str
    tool_name: str
    operation: str
    safety_class: ToolSafetyClass
    normalized_arguments: dict[str, Any]
    target_resources: tuple[str, ...]
    external_side_effect: bool
    run_id: str
    attempt_id: str
    environment_spec_digest: str
    idempotency_key: str | None = None
    risk_tags: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.operation not in ACTION_OPERATIONS:
            raise ValueError(
                f"unsupported action operation {self.operation!r}"
            )
        required = {
            "action_id": self.action_id,
            "tool_name": self.tool_name,
            "run_id": self.run_id,
            "attempt_id": self.attempt_id,
            "environment_spec_digest": self.environment_spec_digest,
        }
        for field_name, value in required.items():
            if not value.strip():
                raise ValueError(f"{field_name} is required")
        if (
            self.safety_class is ToolSafetyClass.IDEMPOTENT_WRITE
            and not self.idempotency_key
        ):
            raise ValueError("idempotent writes require an idempotency key")

    def canonical_payload(self) -> dict[str, Any]:
        """Return the complete in-memory payload used for action binding.

        This payload is deliberately not a persistence contract. Policy must
        evaluate and bind the digest to the real arguments, even when a tool
        call contains a large body. Call ``persistence_payload`` before
        writing the descriptor into SQLite or a Cloud event.
        """

        return {
            "action_id": self.action_id,
            "tool_name": self.tool_name,
            "operation": self.operation,
            "safety_class": self.safety_class.value,
            "normalized_arguments": _canonical_action_value(
                self.normalized_arguments
            ),
            "target_resources": list(self.target_resources),
            "external_side_effect": self.external_side_effect,
            "idempotency_key": self.idempotency_key,
            "run_id": self.run_id,
            "attempt_id": self.attempt_id,
            "environment_spec_digest": self.environment_spec_digest,
            "risk_tags": sorted(self.risk_tags),
        }

    def persistence_payload(self) -> dict[str, Any]:
        """Return a bounded descriptor projection safe for durable display."""

        payload = self.canonical_payload()
        display_arguments = _redacted_action_value(self.normalized_arguments)
        encoded_text = canonical_json(display_arguments)
        encoded = encoded_text.encode("utf-8")
        payload["normalized_arguments"] = display_arguments
        if len(encoded) > _MAX_PERSISTED_ARGUMENT_BYTES:
            payload["normalized_arguments"] = {
                "truncated": True,
                "preview": encoded_text[:_MAX_ARGUMENT_PREVIEW_CHARS],
                "size_bytes": len(encoded),
                "sha256": hashlib.sha256(encoded).hexdigest(),
            }
        return payload

    @property
    def action_digest(self) -> str:
        return canonical_digest(self.canonical_payload())


@dataclass(frozen=True)
class PermissionProfile:
    name: PermissionProfileName
    sandbox_mode: str
    approval_mode: str
    reviewer_mode: str
    revision: str


@dataclass(frozen=True)
class PolicyRule:
    rule_id: str
    effect: PolicyEffect
    action_pattern: str
    resource_pattern: str | None = None
    scope: str = "space"
    run_id: str | None = None


@dataclass(frozen=True)
class PolicyDecision:
    effect: PolicyEffect
    reason: str
    profile: PermissionProfileName
    action_digest: str
    matched_rule_id: str | None = None
    auto_review_eligible: bool = False


PRESET_PROFILES: dict[PermissionProfileName, PermissionProfile] = {
    PermissionProfileName.READ_ONLY: PermissionProfile(
        name=PermissionProfileName.READ_ONLY,
        sandbox_mode="read-only",
        approval_mode="on-request",
        reviewer_mode="user",
        revision="preset:read_only:v1",
    ),
    PermissionProfileName.REQUEST_APPROVAL: PermissionProfile(
        name=PermissionProfileName.REQUEST_APPROVAL,
        sandbox_mode="workspace-write",
        approval_mode="on-request",
        reviewer_mode="user",
        revision="preset:request_approval:v1",
    ),
    PermissionProfileName.AUTO_REVIEWER: PermissionProfile(
        name=PermissionProfileName.AUTO_REVIEWER,
        sandbox_mode="workspace-write",
        approval_mode="on-request",
        reviewer_mode="auto_reviewer",
        revision="preset:auto_reviewer:v1",
    ),
    PermissionProfileName.FULL_ACCESS: PermissionProfile(
        name=PermissionProfileName.FULL_ACCESS,
        sandbox_mode="danger-full-access",
        approval_mode="never",
        reviewer_mode="none",
        revision="preset:full_access:v1",
    ),
}
