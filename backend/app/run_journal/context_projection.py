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

"""Deterministic RunJournal -> model context projection.

The RunJournal is the canonical recent-execution source.  Project Memory adds
long-lived summaries, facts, and artifact references, but must not duplicate
the same conversation turns.  This projector deliberately excludes hidden
reasoning and display-only token deltas while retaining user instructions,
assistant outcomes, tool calls, successful results, observed errors, and
unknown-outcome markers.
"""

from __future__ import annotations

import json
from typing import Any

from app.run_journal.models import CommittedRunEvent
from app.run_journal.store import SQLiteRunJournal

_TERMINAL_TOOL_EVENT_TYPES = frozenset(
    {
        "tool.completed",
        "tool.failed",
        "tool.timed_out",
        "tool.outcome_unknown",
    }
)
_TOOL_EVENT_PREFIX = "tool."
_DEFAULT_MAX_RUNS = 8
_DEFAULT_CHAR_BUDGET = 18_000
_MAX_EVENT_VALUE_CHARS = 3_000


def _json(value: Any, *, limit: int = _MAX_EVENT_VALUE_CHARS) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        default=repr,
    )
    if len(encoded) <= limit:
        return encoded
    return encoded[:limit] + f"... [truncated, {len(encoded)} chars]"


def _message(payload: dict[str, Any]) -> str:
    for key in ("message", "content", "result", "error"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return _json(payload)


def _latest_tool_events(
    events: list[CommittedRunEvent],
) -> dict[str, CommittedRunEvent]:
    """Collapse prepared/dispatched/outcome events to one latest tool state."""

    latest: dict[str, CommittedRunEvent] = {}
    for event in events:
        if not event.event_type.startswith(_TOOL_EVENT_PREFIX):
            continue
        tool_call_id = event.payload.get("tool_call_id")
        if isinstance(tool_call_id, str) and tool_call_id:
            latest[tool_call_id] = event
    return latest


def _render_tool(event: CommittedRunEvent) -> list[str]:
    payload = event.payload
    name = str(payload.get("tool_name") or "unknown")
    status = str(payload.get("status") or event.event_type.removeprefix("tool."))
    request = payload.get("request")
    result = payload.get("result")
    lines = [f"Assistant tool call: {name}({_json(request or {})})"]
    if event.event_type in _TERMINAL_TOOL_EVENT_TYPES or result is not None:
        outcome: dict[str, Any] = {"result": result}
        if payload.get("outcome") is not None:
            outcome["outcome"] = payload["outcome"]
        if payload.get("timeout_reason") is not None:
            outcome["timeout_reason"] = payload["timeout_reason"]
        if event.event_type == "tool.outcome_unknown":
            outcome["external_effect_may_have_occurred"] = True
        lines.append(f"Tool result [{status}]: {_json(outcome)}")
    else:
        lines.append(
            f"Tool result [{status}]: no durable outcome was observed"
        )
    return lines


def _render_run(events: list[CommittedRunEvent], run_id: str) -> list[str]:
    latest_tools = _latest_tool_events(events)
    has_typed_user = any(event.event_type == "user.message" for event in events)
    has_typed_final = any(
        event.event_type == "assistant.final" for event in events
    )
    lines = [f"Run {run_id}:"]
    for event in events:
        event_type = event.event_type
        payload = event.payload
        if event_type == "user.message":
            lines.append(f"User: {_message(payload)}")
        elif (
            not has_typed_user
            and event_type == "legacy.confirmed"
            and isinstance(payload.get("question"), str)
        ):
            lines.append(f"User: {payload['question'].strip()}")
        elif event_type.startswith(_TOOL_EVENT_PREFIX):
            tool_call_id = payload.get("tool_call_id")
            if (
                isinstance(tool_call_id, str)
                and latest_tools.get(tool_call_id) is event
            ):
                lines.extend(_render_tool(event))
        elif event_type == "interaction.resolved":
            decision = payload.get("decision")
            if decision is not None:
                lines.append(f"User interaction response: {_json(decision)}")
        elif event_type == "approval.decided":
            lines.append(f"User approval decision: {_json(payload)}")
        elif event_type == "assistant.final":
            lines.append(f"Assistant: {_message(payload)}")
        elif (
            not has_typed_final
            and event.legacy_step == "end"
            and event_type != "assistant.final"
        ):
            lines.append(f"Assistant: {_message(payload)}")
        elif event_type in {
            "run.failed",
            "run.cancelled",
            "run.deadline_reached",
        }:
            lines.append(f"Run outcome [{event_type}]: {_json(payload)}")
    return lines if len(lines) > 1 else []


def build_project_execution_context(
    journal: SQLiteRunJournal,
    *,
    project_id: str,
    current_run_id: str,
    max_runs: int = _DEFAULT_MAX_RUNS,
    char_budget: int = _DEFAULT_CHAR_BUDGET,
) -> str:
    """Build a bounded, oldest-to-newest projection of prior Project Runs."""

    if max_runs < 1 or char_budget < 1:
        return ""
    recent_runs = [
        run
        for run in journal.list_runs(project_id=project_id, limit=max_runs + 1)
        if run.run_id != current_run_id
    ][:max_runs]
    rendered_runs: list[list[str]] = []
    for run in reversed(recent_runs):
        rendered = _render_run(journal.list_events(run.run_id), run.run_id)
        if rendered:
            rendered_runs.append(rendered)
    if not rendered_runs:
        return ""

    # Prefer the newest complete Runs.  If the budget is exhausted, discard
    # older Runs as a unit so a tool call is not separated from its result.
    selected: list[list[str]] = []
    used = 0
    for rendered in reversed(rendered_runs):
        cost = sum(len(line) + 1 for line in rendered)
        if selected and used + cost > char_budget:
            break
        if not selected and cost > char_budget:
            # The newest Run alone is oversized. Keep its tail, which contains
            # the most recent tool outcome and final answer.
            body = "\n".join(rendered[1:])
            selected.append(
                [
                    rendered[0],
                    "... [older execution context truncated]",
                    body[-max(1, char_budget - len(rendered[0]) - 80) :],
                ]
            )
            used = char_budget
            break
        selected.append(rendered)
        used += cost
    selected.reverse()
    lines = ["=== Canonical Project Execution Context ==="]
    for rendered in selected:
        lines.extend(rendered)
    lines.append("=== End Canonical Project Execution Context ===")
    return "\n".join(lines)
