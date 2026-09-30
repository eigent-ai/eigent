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
from dataclasses import dataclass, replace
from typing import Any

from app.permission_policy.models import redact_action_arguments
from app.run_journal.models import CommittedRunEvent, ToolCallRecord
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
# Preserve the former controller ledger's per-result evidence allowance.
_RESUME_EVENT_VALUE_CHARS = 1_000
logger = logging.getLogger("run_journal.context_projection")


class ResumeContextError(RuntimeError):
    """Mandatory recovery facts cannot safely be projected for inference."""


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


def _render_tool(
    event: CommittedRunEvent, *, value_limit: int = _MAX_EVENT_VALUE_CHARS
) -> list[str]:
    payload = event.payload
    name = str(payload.get("tool_name") or "unknown")
    status = str(
        payload.get("status") or event.event_type.removeprefix("tool.")
    )
    request = payload.get("request")
    result = payload.get("result")
    lines = [
        f"Assistant tool call: {name}({_json(request or {}, limit=value_limit)})"
    ]
    if event.event_type in _TERMINAL_TOOL_EVENT_TYPES or result is not None:
        outcome: dict[str, Any] = {"result": result}
        if payload.get("outcome") is not None:
            outcome["outcome"] = payload["outcome"]
        if payload.get("timeout_reason") is not None:
            outcome["timeout_reason"] = payload["timeout_reason"]
        if event.event_type == "tool.outcome_unknown":
            outcome["external_effect_may_have_occurred"] = True
        lines.append(
            f"Tool result [{status}]: {_json(outcome, limit=value_limit)}"
        )
    else:
        lines.append(
            f"Tool result [{status}]: no durable outcome was observed"
        )
    return lines


def _render_run(
    events: list[CommittedRunEvent],
    run_id: str,
    *,
    recovery_tools: dict[str, ToolCallRecord] | None = None,
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
        if recovery_tools is not None:
            payload = redact_action_arguments(payload)
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
                if recovery_tools is not None:
                    # Startup outcome events can omit the name/request/result.
                    # The canonical ledger supplies those fields, not Memory
                    # or the renderer bridge. Redact before rendering raw rows.
                    tool = recovery_tools[tool_call_id]
                    payload = redact_action_arguments(
                        {
                            "tool_call_id": tool.tool_call_id,
                            "attempt_id": tool.attempt_id,
                            "tool_name": tool.tool_name,
                            "safety_class": tool.safety_class,
                            "idempotency_key": tool.idempotency_key,
                            "status": tool.status,
                            "outcome": tool.outcome,
                            "timeout_reason": tool.timeout_reason,
                            "external_effect_may_have_occurred": tool.status
                            == "outcome_unknown",
                            "request": tool.request,
                            "result": tool.result,
                        }
                    )
                    # Keep identity and safety outside truncatable evidence.
                    lines.append(
                        "Tool checkpoint: "
                        + json.dumps(
                            {
                                key: value
                                for key, value in payload.items()
                                if key not in {"request", "result"}
                            },
                            ensure_ascii=False,
                            sort_keys=True,
                        )
                    )
                    event = replace(
                        event,
                        payload=payload,
                        event_type=f"tool.{tool.status}",
                    )
                lines.extend(
                    _render_tool(
                        event,
                        value_limit=_RESUME_EVENT_VALUE_CHARS
                        if recovery_tools is not None
                        else _MAX_EVENT_VALUE_CHARS,
                    )
                )
                source_event_ids.append(event.event_id)
        elif recovery_tools is not None and (
            event_type.startswith(("approval.", "interaction.", "step."))
            or event_type in {"run.interrupted", "runtime.interrupted"}
        ):
            lines.append(
                f"Checkpoint [{event_type}]: "
                + json.dumps(
                    payload,
                    ensure_ascii=False,
                    sort_keys=True,
                )
            )
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
    current_attempt_id: str | None = None,
) -> ExecutionContextProjection:
    """Project prior Runs; an explicit Resume reserves its current Run first."""

    if isinstance(current_attempt_id, str):
        try:
            attempt = journal.get_run_attempt(current_attempt_id)
        except Exception as exc:
            raise ResumeContextError("Canonical Attempt unavailable") from exc
        if attempt is None or attempt.run_id != current_run_id:
            raise ResumeContextError("Recovery Attempt does not belong to Run")
        if attempt.resume_reason == "explicit_resume":
            try:
                return _build_resume_execution_context(
                    journal,
                    project_id=project_id,
                    run_id=current_run_id,
                    max_runs=max_runs,
                    char_budget=char_budget,
                )
            except ResumeContextError:
                raise
            except Exception as exc:
                raise ResumeContextError(
                    "Canonical recovery context unavailable"
                ) from exc

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


def _build_resume_execution_context(
    journal: SQLiteRunJournal,
    *,
    project_id: str,
    run_id: str,
    max_runs: int,
    char_budget: int,
) -> ExecutionContextProjection:
    """Reserve the existing history budget for current-Run recovery first.

    Never tail-slice a recovery checkpoint or silently drop old unsafe calls.
    If mandatory facts cannot fit, fail before inference. Prior Runs use only
    the remainder and are included whole, oldest-to-newest, before this Run.
    Memory retains its own existing policy and is not a recovery fact source.
    """
    run = journal.get_run(run_id)
    if run is None or run.project_id != project_id:
        raise ResumeContextError("Recovery Run does not belong to Project")
    events = journal.list_events(run_id)
    if not any(
        event.event_type == "user.message"
        or (
            event.event_type == "legacy.confirmed"
            and event.payload.get("question")
        )
        for event in events
    ):
        raise ResumeContextError("Canonical recovery intent unavailable")
    tools = {
        tool.tool_call_id: tool for tool in journal.list_tool_calls(run_id)
    }
    if set(tools) != set(_latest_tool_events(events)):
        raise ResumeContextError("Canonical recovery ledger is incomplete")
    current, current_ids = _render_run(events, run_id, recovery_tools=tools)
    header = (
        "=== Canonical Project Recovery Context ===\n"
        "Older Runs may be omitted to fit the recovery budget; omitted "
        "history does not prove that an action never occurred."
    )
    footer = "=== End Canonical Project Recovery Context ==="
    used = len("\n".join([header, *current, footer]))
    if used > char_budget:
        raise ResumeContextError(
            "context_budget_exhausted: mandatory Resume checkpoint"
        )
    prior = []
    if max_runs > 0:
        for previous in journal.list_runs(
            project_id=project_id, limit=max_runs + 1
        ):
            if previous.run_id == run_id:
                continue
            lines, ids = _render_run(
                journal.list_events(previous.run_id), previous.run_id
            )
            if not lines:
                continue
            cost = len("\n".join(lines)) + 1
            if used + cost > char_budget:
                break
            prior.append((lines, ids))
            used += cost
            if len(prior) == max_runs:
                break
    lines = [header]
    source_ids = []
    for rendered, ids in reversed(prior):
        lines.extend(rendered)
        source_ids.extend(ids)
    lines.extend(current)
    source_ids.extend(current_ids)
    lines.append(footer)
    text = "\n".join(lines)
    return ExecutionContextProjection(
        text=text,
        source_event_ids=tuple(source_ids),
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
