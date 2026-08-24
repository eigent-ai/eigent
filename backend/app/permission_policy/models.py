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

"""Trusted action descriptors and permission-policy contracts."""

from __future__ import annotations

import hashlib
import math
import re
import shlex
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
    re.compile(r"\bsk-[A-Za-z0-9]{32,}\b"),
    re.compile(r"\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{32,}\b"),
    re.compile(r"(?<![.\w])sk_(?:live|test)_[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b"),
)
_BEARER_CANDIDATE = re.compile(r"(?i)\bbearer\s+([A-Za-z0-9._~+/=-]{12,})")
_DASHED_SK_CANDIDATE = re.compile(
    r"(?<![.\w])sk-(live|test|ant)-([A-Za-z0-9_-]{20,})\b",
    re.IGNORECASE,
)
_URL_USERINFO = re.compile(
    r"(?i)\b([a-z][a-z0-9+.-]*://)([^\s/:@]+):([^\s/@]+)@"
)
_INLINE_SECRET_ASSIGNMENT = re.compile(
    r"(?i)(\b(?:access[_-]?token|api[_-]?key|client[_-]?secret|cookie|"
    r"credential|password|private[_-]?key|refresh[_-]?token|secret|"
    r"token)\b[ \t]*(?:=|:|\bis\b)[ \t]*['\"]?)([^\s,;'\"}]{4,})"
)
_SECRET_HEADER = re.compile(
    r"(?im)(^|[\r\n])([ \t]*)"
    r"(authorization|proxy-authorization|x-api-key|api-key|"
    r"x-auth-token|x-access-token)([ \t]*:[ \t]*)"
    r"(?:(bearer|basic|token|digest)[ \t]+)?"
    r"([^\s\r\n]{3,})"
)
_SECRET_ARGV_FLAGS = frozenset(
    {
        "--access-token",
        "--api-key",
        "--authorization",
        "--client-secret",
        "--cookie",
        "--http-password",
        "--oauth2-bearer",
        "--password",
        "--private-key",
        "--proxy-password",
        "--refresh-token",
        "--secret",
        "--secret-access-key",
        "--token",
        "--with-token",
    }
)
_SECRET_ARGV_FLAGS_BY_EXECUTABLE = {
    "curl": {"-u": "user", "--user": "user"},
    "wget": {"--user": "user"},
    "mysql": {"-p": "secret"},
    "mariadb": {"-p": "secret"},
    "mysqldump": {"-p": "secret"},
    "redis-cli": {"-a": "secret"},
}
_HEADER_ARGV_FLAGS_BY_EXECUTABLE = {
    "curl": frozenset({"-H", "--header"}),
    "wget": frozenset({"--header"}),
}
_ARGV_WRAPPERS = frozenset(
    {
        "command",
        "doas",
        "env",
        "flock",
        "nice",
        "nohup",
        "runuser",
        "setsid",
        "stdbuf",
        "su",
        "sudo",
        "time",
        "timeout",
        "xargs",
    }
)
_SHELL_EXECUTABLES = frozenset({"bash", "dash", "ksh", "sh", "zsh"})


def _normalized_key(value: object) -> str:
    # Preserve acronym runs: API_KEY -> api_key, DBPassword -> db_password.
    # Splitting before every capital produced a_p_i__k_e_y and let common
    # environment-style credential names bypass durable redaction.
    text = str(value).replace("-", "_")
    text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", text)
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text)
    return re.sub(r"_+", "_", text).strip("_").lower()


def _is_redacted_argument_key(value: object) -> bool:
    normalized = _normalized_key(value)
    return any(
        normalized == secret_key
        or normalized.endswith(f"_{secret_key}")
        or (normalized.endswith("s") and normalized[:-1] == secret_key)
        for secret_key in _REDACTED_ARGUMENT_KEYS
    )


def _redacted_string(value: str) -> str:
    redacted = _URL_USERINFO.sub(r"\1\2:[REDACTED]@", value)
    redacted = _SECRET_HEADER.sub(_redact_secret_header, redacted)
    redacted = _INLINE_SECRET_ASSIGNMENT.sub(
        lambda match: (
            match.group(0)
            if any(
                marker in match.group(2).lower().replace("-", "_")
                for marker in (
                    "example",
                    "placeholder",
                    "your_token",
                    "token_here",
                )
            )
            else f"{match.group(1)}[REDACTED]"
        ),
        redacted,
    )
    redacted = _BEARER_CANDIDATE.sub(_redact_bearer, redacted)
    redacted = _DASHED_SK_CANDIDATE.sub(_redact_dashed_sk, redacted)
    for pattern in _SECRET_VALUE_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def redact_sensitive_text(value: str) -> str:
    """Redact credentials embedded in otherwise unstructured model text."""

    return _redacted_string(value)


def _redact_bearer(match: re.Match[str]) -> str:
    normalized = match.group(1).lower().replace("-", "_")
    if any(
        marker in normalized
        for marker in ("example", "placeholder", "your_token", "token_here")
    ):
        return match.group(0)
    return "Bearer [REDACTED]"


def _redact_secret_header(match: re.Match[str]) -> str:
    """Keep explicit documentation placeholders readable, redact real values."""

    header_name = match.group(3)
    scheme = match.group(5)
    raw_value = match.group(6).strip()
    # Authorization prose is not a credential unless it uses a credential
    # scheme. Key-specific headers have no scheme and remain protected.
    if (
        header_name.lower() in {"authorization", "proxy-authorization"}
        and not scheme
    ):
        return match.group(0)
    normalized = raw_value.lower().replace("-", "_")
    if any(
        marker in normalized
        for marker in ("example", "placeholder", "your_token", "token_here")
    ):
        return match.group(0)
    scheme_prefix = f"{scheme} " if scheme else ""
    return (
        f"{match.group(1)}{match.group(2)}{header_name}{match.group(4)}"
        f"{scheme_prefix}[REDACTED]"
    )


def _redact_dashed_sk(match: re.Match[str]) -> str:
    """Redact credential-shaped sk-* values without matching CSS words."""

    prefix = match.group(1).lower()
    body = match.group(2)
    if prefix in {"live", "test"}:
        # A random token may contain only letters. Hyphenated prose/CSS needs
        # stronger distribution evidence than a single trailing digit.
        credential_shaped = (
            "-" not in body or sum(c.isdigit() for c in body) >= 4
        )
    else:
        # Anthropic keys include structured api03-* prefixes.
        credential_shaped = any(c.isdigit() for c in body) and any(
            c.isalpha() for c in body
        )
    return "[REDACTED]" if credential_shaped else match.group(0)


def _argv_command_index(value: list[Any] | tuple[Any, ...]) -> int | None:
    index = 0
    while index < len(value):
        item = value[index]
        if not isinstance(item, str):
            return None
        executable = item.replace("\\", "/").rsplit("/", 1)[-1].lower()
        if executable not in _ARGV_WRAPPERS:
            return index
        index += 1
        value_options: set[str] = set()
        if executable == "env":
            value_options = {"-u", "--unset", "-C", "--chdir"}
            while index < len(value) and isinstance(value[index], str):
                token = value[index]
                if "=" in token and not token.startswith("-"):
                    index += 1
                    continue
                if not token.startswith("-"):
                    break
                option = token.split("=", 1)[0]
                index += 1
                if option in value_options and "=" not in token:
                    index += 1
        elif executable in {"sudo", "runuser"}:
            value_options = {
                "-u",
                "--user",
                "-U",
                "--other-user",
                "-g",
                "--group",
                "-h",
                "--host",
                "-C",
                "--close-from",
                "-T",
                "--command-timeout",
            }
            while index < len(value) and isinstance(value[index], str):
                token = value[index]
                if token == "--":
                    index += 1
                    break
                if not token.startswith("-"):
                    break
                option = token.split("=", 1)[0]
                index += 1
                if option in value_options and "=" not in token:
                    index += 1
        elif executable in {"doas", "su"}:
            value_options = {"-u", "-c", "--command", "-s", "--shell"}
            while index < len(value) and isinstance(value[index], str):
                token = value[index]
                if token == "--":
                    index += 1
                    break
                if not token.startswith("-"):
                    break
                option = token.split("=", 1)[0]
                index += 1
                if option in value_options and "=" not in token:
                    index += 1
        elif executable == "nice":
            if index < len(value) and str(value[index]).lstrip("+-").isdigit():
                index += 1
            elif index < len(value) and value[index] in {"-n", "--adjustment"}:
                index += 2
        elif executable == "timeout":
            value_options = {"-k", "--kill-after", "-s", "--signal"}
            while index < len(value) and isinstance(value[index], str):
                token = value[index]
                if not token.startswith("-"):
                    break
                option = token.split("=", 1)[0]
                index += 1
                if option in value_options and "=" not in token:
                    index += 1
            if index < len(value):
                index += 1
        elif executable == "stdbuf":
            value_options = {
                "-i",
                "--input",
                "-o",
                "--output",
                "-e",
                "--error",
            }
            while index < len(value) and isinstance(value[index], str):
                token = value[index]
                if not token.startswith("-"):
                    break
                option = (
                    token[:2]
                    if token[:2] in {"-i", "-o", "-e"}
                    else token.split("=", 1)[0]
                )
                index += 1
                if option in value_options and len(token) == len(option):
                    index += 1
        elif executable == "time":
            value_options = {"-f", "--format", "-o", "--output"}
            while index < len(value) and isinstance(value[index], str):
                token = value[index]
                if token == "--":
                    index += 1
                    break
                if not token.startswith("-"):
                    break
                option = token.split("=", 1)[0]
                index += 1
                if option in value_options and "=" not in token:
                    index += 1
        elif executable == "flock":
            value_options = {
                "-E",
                "--conflict-exit-code",
                "-w",
                "--wait",
                "--timeout",
            }
            while index < len(value) and isinstance(value[index], str):
                token = value[index]
                if token == "--":
                    index += 1
                    break
                if not token.startswith("-"):
                    break
                option = token.split("=", 1)[0]
                index += 1
                if option in value_options and "=" not in token:
                    index += 1
            if index < len(value):
                index += 1
        elif executable == "xargs":
            value_options = {
                "-a",
                "--arg-file",
                "-E",
                "--eof",
                "-I",
                "--replace",
                "-L",
                "--max-lines",
                "-n",
                "--max-args",
                "-P",
                "--max-procs",
                "-s",
                "--max-chars",
            }
            while index < len(value) and isinstance(value[index], str):
                token = value[index]
                if token == "--":
                    index += 1
                    break
                if not token.startswith("-"):
                    break
                option = token.split("=", 1)[0]
                index += 1
                if option in value_options and "=" not in token:
                    index += 1
        else:
            while (
                index < len(value)
                and isinstance(value[index], str)
                and value[index].startswith("-")
            ):
                index += 1
    return None


def _shell_payload_index(
    value: list[Any] | tuple[Any, ...],
    command_index: int | None,
) -> int | None:
    # su/runuser carry a shell program in an option even when the positional
    # account name means there is no conventional executable index.
    for index, item in enumerate(value[:-1]):
        if not isinstance(item, str):
            continue
        executable = item.replace("\\", "/").rsplit("/", 1)[-1].lower()
        if executable not in {"su", "runuser"}:
            continue
        for option_index in range(index + 1, len(value) - 1):
            option = value[option_index]
            if option in {"-c", "--command"} and isinstance(
                value[option_index + 1], str
            ):
                return option_index + 1
    if command_index is None or not isinstance(value[command_index], str):
        return None
    executable = (
        value[command_index].replace("\\", "/").rsplit("/", 1)[-1].lower()
    )
    if executable not in _SHELL_EXECUTABLES:
        return None
    for index in range(command_index + 1, len(value) - 1):
        option = value[index]
        if (
            isinstance(option, str)
            and option.startswith("-")
            and "c" in option[1:]
            and isinstance(value[index + 1], str)
        ):
            return index + 1
    return None


def _redacted_argv(value: list[Any] | tuple[Any, ...]) -> list[Any]:
    """Keep approvals readable while removing credential-bearing argv values."""

    result: list[Any] = []
    command_index = _argv_command_index(value)
    executable = ""
    if command_index is not None and isinstance(value[command_index], str):
        executable = (
            value[command_index].replace("\\", "/").rsplit("/", 1)[-1].lower()
        )
    executable_secret_flags = _SECRET_ARGV_FLAGS_BY_EXECUTABLE.get(
        executable,
        {},
    )
    header_flags = _HEADER_ARGV_FLAGS_BY_EXECUTABLE.get(
        executable,
        frozenset(),
    )
    shell_payload_index = _shell_payload_index(value, command_index)
    redact_next: str | None = None
    for item_index, item in enumerate(value):
        canonical = _canonical_action_value(item)
        if not isinstance(canonical, str):
            result.append(_redacted_action_value(canonical))
            redact_next = None
            continue
        if item_index == shell_payload_index:
            try:
                nested = shlex.split(canonical)
            except ValueError:
                nested = canonical.split()
            result.append(
                shlex.join(str(item) for item in _redacted_argv(nested))
            )
            continue
        if redact_next is not None:
            # A missing option value must not make the following option vanish
            # from the approval card (for example ``--token --verbose``).
            if canonical.startswith("-"):
                redact_next = None
            else:
                if redact_next == "user":
                    username, separator, _ = canonical.partition(":")
                    result.append(
                        f"{username}:[REDACTED]" if separator else "[REDACTED]"
                    )
                elif redact_next == "header":
                    result.append(_redacted_string(canonical))
                else:
                    result.append("[REDACTED]")
                redact_next = None
                continue
        lowered = canonical.strip().lower()
        if (
            executable_secret_flags.get("-p") == "secret"
            and lowered.startswith("-p")
            and not lowered.startswith("--")
            and len(canonical) > 2
        ):
            result.append(f"{canonical[:2]}[REDACTED]")
            continue
        if (
            executable_secret_flags.get("-u") == "user"
            and lowered.startswith("-u")
            and not lowered.startswith("--")
            and len(canonical) > 2
        ):
            username, separator, _ = canonical[2:].partition(":")
            result.append(
                f"{canonical[:2]}{username}:[REDACTED]"
                if separator
                else f"{canonical[:2]}[REDACTED]"
            )
            continue
        if (
            executable_secret_flags.get("-a") == "secret"
            and lowered.startswith("-a")
            and not lowered.startswith("--")
            and len(canonical) > 2
        ):
            result.append(f"{canonical[:2]}[REDACTED]")
            continue
        flag, separator, _ = canonical.partition("=")
        normalized_flag = flag.strip().lower().replace("_", "-")
        executable_mode = executable_secret_flags.get(normalized_flag)
        if normalized_flag in _SECRET_ARGV_FLAGS or executable_mode:
            if separator:
                if executable_mode == "user":
                    assigned = canonical.partition("=")[2]
                    username, user_separator, _ = assigned.partition(":")
                    result.append(
                        f"{flag}={username}:[REDACTED]"
                        if user_separator
                        else f"{flag}=[REDACTED]"
                    )
                else:
                    result.append(f"{flag}=[REDACTED]")
            else:
                result.append(flag)
                redact_next = executable_mode or "secret"
            continue
        if flag in header_flags or normalized_flag in header_flags:
            result.append(flag)
            redact_next = "header"
            continue
        assignment_key, assignment_separator, _ = canonical.partition("=")
        if assignment_separator and _is_redacted_argument_key(assignment_key):
            result.append(f"{assignment_key}=[REDACTED]")
            continue
        result.append(_redacted_string(canonical))
    return result


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
            if _is_redacted_argument_key(key):
                redacted[str(key)] = "[REDACTED]"
            elif normalized == "argv" and isinstance(child, (list, tuple)):
                redacted[str(key)] = _redacted_argv(child)
            else:
                redacted[str(key)] = _redacted_action_value(child)
        return redacted
    if isinstance(value, (list, tuple)):
        return [_redacted_action_value(child) for child in value]
    if isinstance(value, str):
        return _redacted_string(value)
    return _canonical_action_value(value)


def redact_action_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    """Return the shared secret-safe, human-readable argument projection.

    Permission cards, execution checkpoints, and model context must not grow
    independent redaction rules.  Keeping one projection also lets the
    RunJournal retain useful tool-call semantics without persisting raw
    credentials.
    """

    redacted = _redacted_action_value(arguments)
    assert isinstance(redacted, dict)
    return redacted


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
        "agent.control",
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

    @property
    def persistent_rule_action_pattern(self) -> str:
        """Bind durable ALLOW rules to the reviewed action semantics.

        Operation-only rules are suitable for administrator-authored DENY and
        PROMPT policy, but are too broad for a user's "always allow this tool"
        decision.  Keep arguments and Run identity out of the matcher while
        binding the tool, safety class, side-effect shape, and risk tags that
        the user actually reviewed.
        """

        identity = canonical_digest(
            {
                "operation": self.operation,
                "tool_name": self.tool_name,
                "safety_class": self.safety_class.value,
                "external_side_effect": self.external_side_effect,
                "risk_tags": sorted(self.risk_tags),
            }
        )
        return f"action-identity:sha256:{identity}"


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
