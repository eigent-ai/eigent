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
"""Turn Run events into readable terminal lines.

Uses the display fields the Brain already writes (``display_title``,
``display_summary``) rather than re-implementing the desktop projector.
``--json`` output bypasses this module entirely.
"""

from __future__ import annotations

import time
from typing import Any

# Lifecycle bookkeeping that adds nothing to a readable timeline.
_QUIET_EVENT_PREFIXES = (
    "legacy.",
    "model.invocation.",
    "run.environment_",
    "run.attempt_",
    "artifact.manifest.",
    "workspace.writer.",
)
_QUIET_EVENT_TYPES = {
    "tool.prepared",
    "tool.dispatched",
    "activity.progress",
    "agent.registered",
}

_STATUS_WORDS = {
    "pending": "Waiting to start",
    "running": "Running",
    "waiting_for_user": "Waiting for you",
    "interrupted": "Interrupted",
    "completed": "Completed",
    "failed": "Failed",
    "cancelled": "Stopped",
    "timed_out": "Deadline reached",
}

_TERMINAL_EVENT_WORDS = {
    "run.completed": "Task completed",
    "run.failed": "Task failed",
    "run.cancelled": "Task stopped",
    "run.deadline_reached": "Task reached its deadline",
    "run.interrupted": "Task interrupted",
    "runtime.interrupted": "Task interrupted",
}


def status_word(status: str | None) -> str:
    return _STATUS_WORDS.get(str(status or ""), str(status or "unknown"))


def format_time(timestamp: Any) -> str:
    if not isinstance(timestamp, int | float):
        return "-"
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp))


def _text(value: Any, limit: int = 400) -> str:
    text = " ".join(str(value).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _prompt_text(prompt: Any) -> str | None:
    if isinstance(prompt, str):
        return prompt
    if isinstance(prompt, dict):
        for key in ("summary", "title", "message", "question", "text"):
            if prompt.get(key):
                return str(prompt[key])
    return None


def interaction_summary(interaction: dict[str, Any]) -> str:
    """One line for a pending question or approval."""

    request = interaction.get("request") or {}
    kind = interaction.get("interaction_type") or "question"
    text = None
    if isinstance(request, dict):
        text = (
            request.get("question")
            or _prompt_text(request.get("prompt"))
            or _prompt_text(request.get("action"))
        )
    label = "Approval needed" if kind == "approval" else "Question"
    line = f"{label} [{interaction.get('interaction_id')}]"
    if text:
        line += f": {_text(text)}"
    options = interaction.get("options") or []
    if options:
        names = [
            str(option.get("label") or option.get("option_id"))
            for option in options
            if isinstance(option, dict)
        ]
        line += f" (options: {', '.join(names)})"
    scopes = (
        request.get("allowed_scopes") if isinstance(request, dict) else None
    )
    if kind == "approval" and isinstance(scopes, list) and scopes:
        line += f" (scopes: {', '.join(str(scope) for scope in scopes)})"
    return line


def render_event(
    event: dict[str, Any], *, verbose: bool = False
) -> str | None:
    """Return one line for a Run event, or None to skip it."""

    event_type = str(event.get("event_type") or "")
    payload = event.get("payload")
    payload = payload if isinstance(payload, dict) else {}
    sequence = event.get("sequence")
    prefix = f"{sequence:>5} " if isinstance(sequence, int) else ""

    if event_type == "user.message":
        return f"{prefix}You: {_text(payload.get('content', ''))}"
    if event_type == "assistant.final":
        message = payload.get("message") or payload.get("content") or ""
        return f"{prefix}Eigent: {str(message).strip()}"
    if event_type in _TERMINAL_EVENT_WORDS:
        line = f"{prefix}{_TERMINAL_EVENT_WORDS[event_type]}"
        reason = payload.get("terminal_reason") or payload.get("reason")
        detail = payload.get("message") or payload.get("terminal_detail")
        if reason and reason != "completed":
            line += f" ({reason})"
        if detail and event_type != "run.completed":
            line += f": {_text(detail)}"
        return line
    if event_type == "interaction.requested":
        return f"{prefix}{interaction_summary(payload)}"
    if event_type == "approval.requested":
        text = _prompt_text(payload.get("prompt"))
        line = f"{prefix}Approval needed [{payload.get('approval_id')}]"
        return f"{line}: {_text(text)}" if text else line
    if event_type in {"interaction.resolved", "approval.decided"}:
        decision = payload.get("decision")
        if isinstance(decision, dict):
            decision = decision.get("decision") or decision.get("reply")
        who = payload.get("actor_id") or payload.get("source") or "someone"
        line = f"{prefix}Answered by {who}"
        return f"{line}: {_text(decision)}" if decision else line

    if not verbose and (
        event_type in _QUIET_EVENT_TYPES
        or event_type.startswith(_QUIET_EVENT_PREFIXES)
    ):
        return None

    title = payload.get("display_title")
    summary = payload.get("display_summary")
    if title or summary:
        marker = ""
        if event_type in {"tool.failed", "step.failed", "agent.failed"}:
            marker = " (failed)"
        elif event_type == "tool.outcome_unknown":
            marker = " (outcome unknown)"
        line = f"{prefix}{_text(title or summary)}{marker}"
        if title and summary and summary != title:
            line += f" — {_text(summary, 200)}"
        return line
    if verbose:
        return f"{prefix}[{event_type}]"
    return None
