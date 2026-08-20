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

import hashlib
import json
import logging
from dataclasses import dataclass
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
logger = logging.getLogger("run_journal.context_projection")


@dataclass(frozen=True)
class ExecutionContextProjection:
    text: str
    source_event_ids: tuple[str, ...]
    projection_digest: str
    token_count: int


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
    status = str(
        payload.get("status") or event.event_type.removeprefix("tool.")
    )
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


def _render_run(
    events: list[CommittedRunEvent], run_id: str
) -> tuple[list[str], list[str]]:
    latest_tools = _latest_tool_events(events)
    has_typed_user = any(
        event.event_type == "user.message" for event in events
    )
    has_typed_final = any(
        event.event_type == "assistant.final" for event in events
    )
    lines = [f"Run {run_id}:"]
    source_event_ids: list[str] = []
    for event in events:
        event_type = event.event_type
        payload = event.payload
        if event_type == "user.message":
            lines.append(f"User: {_message(payload)}")
            source_event_ids.append(event.event_id)
        elif (
            not has_typed_user
            and event_type == "legacy.confirmed"
            and isinstance(payload.get("question"), str)
        ):
            lines.append(f"User: {payload['question'].strip()}")
            source_event_ids.append(event.event_id)
        elif event_type.startswith(_TOOL_EVENT_PREFIX):
            tool_call_id = payload.get("tool_call_id")
            if (
                isinstance(tool_call_id, str)
                and latest_tools.get(tool_call_id) is event
            ):
                lines.extend(_render_tool(event))
                source_event_ids.append(event.event_id)
        elif event_type == "interaction.resolved":
            decision = payload.get("decision")
            if decision is not None:
                lines.append(f"User interaction response: {_json(decision)}")
                source_event_ids.append(event.event_id)
        elif event_type == "approval.decided":
            lines.append(f"User approval decision: {_json(payload)}")
            source_event_ids.append(event.event_id)
        elif event_type == "assistant.final":
            lines.append(f"Assistant: {_message(payload)}")
            source_event_ids.append(event.event_id)
        elif (
            not has_typed_final
            and event.legacy_step == "end"
            and event_type != "assistant.final"
        ):
            lines.append(f"Assistant: {_message(payload)}")
            source_event_ids.append(event.event_id)
        elif event_type in {
            "run.failed",
            "run.cancelled",
            "run.deadline_reached",
        }:
            lines.append(f"Run outcome [{event_type}]: {_json(payload)}")
            source_event_ids.append(event.event_id)
    if len(lines) <= 1:
        return [], []
    return lines, source_event_ids


def build_project_execution_context_projection(
    journal: SQLiteRunJournal,
    *,
    project_id: str,
    current_run_id: str,
    max_runs: int = _DEFAULT_MAX_RUNS,
    char_budget: int = _DEFAULT_CHAR_BUDGET,
) -> ExecutionContextProjection:
    """Build a bounded, oldest-to-newest projection of prior Project Runs."""

    if max_runs < 1 or char_budget < 1:
        return ExecutionContextProjection(
            text="",
            source_event_ids=(),
            projection_digest=hashlib.sha256(b"").hexdigest(),
            token_count=0,
        )
    recent_runs = [
        run
        for run in journal.list_runs(project_id=project_id, limit=max_runs + 1)
        if run.run_id != current_run_id
    ][:max_runs]
    rendered_runs: list[tuple[list[str], list[str]]] = []
    for run in reversed(recent_runs):
        rendered, event_ids = _render_run(
            journal.list_events(run.run_id), run.run_id
        )
        if rendered:
            rendered_runs.append((rendered, event_ids))
    if not rendered_runs:
        return ExecutionContextProjection(
            text="",
            source_event_ids=(),
            projection_digest=hashlib.sha256(b"").hexdigest(),
            token_count=0,
        )

    # Prefer the newest complete Runs.  If the budget is exhausted, discard
    # older Runs as a unit so a tool call is not separated from its result.
    selected: list[tuple[list[str], list[str]]] = []
    used = 0
    for rendered, event_ids in reversed(rendered_runs):
        cost = sum(len(line) + 1 for line in rendered)
        if selected and used + cost > char_budget:
            break
        if not selected and cost > char_budget:
            # The newest Run alone is oversized. Keep its tail, which contains
            # the most recent tool outcome and final answer.
            body = "\n".join(rendered[1:])
            selected.append(
                (
                    [
                        rendered[0],
                        "... [older execution context truncated]",
                        body[-max(1, char_budget - len(rendered[0]) - 80) :],
                    ],
                    event_ids,
                )
            )
            used = char_budget
            break
        selected.append((rendered, event_ids))
        used += cost
    selected.reverse()
    lines = ["=== Canonical Project Execution Context ==="]
    selected_event_ids: list[str] = []
    for rendered, event_ids in selected:
        lines.extend(rendered)
        selected_event_ids.extend(event_ids)
    lines.append("=== End Canonical Project Execution Context ===")
    text = "\n".join(lines)
    return ExecutionContextProjection(
        text=text,
        source_event_ids=tuple(selected_event_ids),
        projection_digest=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        token_count=(len(text) + 3) // 4,
    )


def build_project_execution_context(
    journal: SQLiteRunJournal,
    *,
    project_id: str,
    current_run_id: str,
    max_runs: int = _DEFAULT_MAX_RUNS,
    char_budget: int = _DEFAULT_CHAR_BUDGET,
) -> str:
    """Compatibility wrapper returning only the rendered prompt text."""

    return build_project_execution_context_projection(
        journal,
        project_id=project_id,
        current_run_id=current_run_id,
        max_runs=max_runs,
        char_budget=char_budget,
    ).text


def persist_context_projection_diagnostic(
    journal: SQLiteRunJournal,
    *,
    project_id: str,
    run_id: str,
    projected_text: str,
    source_event_ids: list[str] | tuple[str, ...] = (),
    source_memory_ids: list[str] | tuple[str, ...] = (),
) -> None:
    """Persist a secret-free derived envelope for one model projection."""

    digest = hashlib.sha256(projected_text.encode("utf-8")).hexdigest()
    identity = hashlib.sha256(
        f"{project_id}\0{run_id}\0{digest}".encode()
    ).hexdigest()[:32]
    try:
        state = journal.get_project_execution_state(project_id)
        journal.put_context_projection_diagnostic(
            projection_id=f"ctxproj_{identity}",
            project_id=project_id,
            run_id=run_id,
            source_event_ids=source_event_ids,
            source_memory_ids=source_memory_ids,
            project_state_version=state.state_version,
            projection_digest=digest,
            token_count=(len(projected_text) + 3) // 4,
        )
    except Exception:
        logger.warning(
            "Context projection diagnostics could not be persisted",
            extra={"project_id": project_id, "run_id": run_id},
            exc_info=True,
        )
