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

"""Versioned display-safe semantics for durable Run events.

The execution stream still emits legacy SSE actions during migration.  New
RunJournal writes project the actions that have stable domain meaning into a
typed event exactly once, while retaining ``legacy_step`` as provenance.  The
payload deliberately contains only bounded, redacted presentation data; raw
tool evidence stays in its dedicated canonical records.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Literal, TypedDict, get_args

SEMANTIC_SCHEMA_VERSION = 1
DISPLAY_SCHEMA_VERSION = 1
STEP_SEMANTIC_SCHEMA_VERSION = 2
STEP_DISPLAY_SCHEMA_VERSION = 1
_MAX_DISPLAY_TEXT = 600
_MAX_DISPLAY_TITLE = 120
_MAX_ID_LENGTH = 200

SemanticKind = Literal[
    "agent",
    "agent_turn",
    "browser_operation",
    "command_execution",
    "file_change",
    "file_operation",
    "git_conflict_resolution",
    "git_integration",
    "narration",
    "plan",
    "plan_operation",
    "subtask",
    "tool_call",
    "workspace_writer",
]
SemanticSubjectType = Literal[
    "activity_stream",
    "agent",
    "agent_turn",
    "agent_workspace",
    "artifact",
    "file",
    "plan",
    "task",
    "tool_call",
    "writer_request",
]
SemanticActorType = Literal["agent", "system", "user"]
SemanticPhase = Literal[
    "requested",
    "started",
    "progress",
    "completed",
    "failed",
    "cancelled",
    "unknown",
]
SemanticStatus = Literal[
    "pending",
    "running",
    "completed",
    "failed",
    "timed_out",
    "outcome_unknown",
    "cancelled",
    "unknown",
]

StepSemanticPhase = Literal[
    "requested",
    "started",
    "progress",
    "blocked",
    "resumed",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
]
StepSemanticStatus = Literal[
    "pending",
    "running",
    "blocked",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
]

_SEMANTIC_KINDS = frozenset(get_args(SemanticKind))
_SEMANTIC_SUBJECT_TYPES = frozenset(get_args(SemanticSubjectType))
_SEMANTIC_ACTOR_TYPES = frozenset(get_args(SemanticActorType))
_SEMANTIC_PHASES = frozenset(get_args(SemanticPhase))
_SEMANTIC_STATUSES = frozenset(get_args(SemanticStatus))
_STEP_SEMANTIC_PHASES = frozenset(get_args(StepSemanticPhase))
_STEP_SEMANTIC_STATUSES = frozenset(get_args(StepSemanticStatus))


class SemanticSubject(TypedDict):
    type: SemanticSubjectType
    id: str


class SemanticActor(TypedDict, total=False):
    type: SemanticActorType
    id: str
    name: str


class SemanticLifecycle(TypedDict):
    phase: SemanticPhase
    status: SemanticStatus


class SemanticCompleteness(TypedDict):
    state: Literal["complete", "partial"]
    missing_fields: list[str]


class SemanticEnvelopeV1(TypedDict, total=False):
    kind: SemanticKind
    subject: SemanticSubject
    actor: SemanticActor
    lifecycle: SemanticLifecycle
    correlation: dict[str, str]
    completeness: SemanticCompleteness
    provenance: dict[str, str]


@dataclass(frozen=True)
class LegacySemanticProjection:
    event_type: str
    payload: dict[str, Any]


def _bounded_text(value: Any, *, limit: int = _MAX_DISPLAY_TEXT) -> str:
    # Import lazily because permission_policy.service depends on RunJournal.
    # At event-write time both packages are fully initialized.
    from app.permission_policy.models import redact_sensitive_text
    from app.workspace_config.models import redact_device_home_paths

    text = " ".join(str(value or "").split())
    text = redact_device_home_paths(redact_sensitive_text(text))
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)].rstrip()}…"


def _bounded_text_fragment(
    value: Any, *, limit: int = _MAX_DISPLAY_TEXT
) -> str:
    """Redact a streamed display fragment without changing its boundaries."""

    from app.permission_policy.models import redact_sensitive_text
    from app.workspace_config.models import redact_device_home_paths

    text = redact_device_home_paths(redact_sensitive_text(str(value or "")))
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)]}…"


def _identifier(value: Any) -> str:
    return _bounded_text(value, limit=_MAX_ID_LENGTH)


def _portable_path(relative_path: Any, fallback_path: Any = None) -> str:
    candidate = str(relative_path or "").strip().replace("\\", "/")
    while candidate.startswith("./"):
        candidate = candidate[2:]
    if (
        candidate
        and not candidate.startswith(("/", "~/"))
        and not re.match(r"^[A-Za-z]:/", candidate)
        and ".." not in candidate.split("/")
    ):
        return _bounded_text(candidate, limit=_MAX_ID_LENGTH)

    fallback = str(fallback_path or "").strip().replace("\\", "/")
    basename = PurePosixPath(fallback).name
    return _bounded_text(basename, limit=_MAX_ID_LENGTH) if basename else ""


def semantic_event_fields(
    *,
    kind: SemanticKind,
    subject_type: SemanticSubjectType,
    subject_id: str | None,
    phase: SemanticPhase,
    status: SemanticStatus,
    source: str,
    actor_type: SemanticActorType | None = None,
    actor_id: str | None = None,
    actor_name: str | None = None,
    correlation: dict[str, Any] | None = None,
    missing_fields: tuple[str, ...] | list[str] = (),
) -> dict[str, Any]:
    """Build the shared discriminated semantic envelope.

    Missing correlation is explicit instead of being inferred from event
    adjacency.  This lets the UI distinguish authoritative and partial facts.
    """

    vocabulary = (
        ("kind", kind, _SEMANTIC_KINDS),
        ("subject_type", subject_type, _SEMANTIC_SUBJECT_TYPES),
        ("phase", phase, _SEMANTIC_PHASES),
        ("status", status, _SEMANTIC_STATUSES),
    )
    if actor_type is not None:
        vocabulary += (("actor_type", actor_type, _SEMANTIC_ACTOR_TYPES),)
    for field, value, allowed in vocabulary:
        if value not in allowed:
            raise ValueError(f"Unsupported semantic {field}: {value}")

    missing = [value for value in missing_fields if value]
    subject = _identifier(subject_id)
    if not subject:
        missing.append("subject.id")

    envelope: SemanticEnvelopeV1 = {
        "kind": kind,
        "subject": {"type": subject_type, "id": subject},
        "lifecycle": {"phase": phase, "status": status},
        "completeness": {
            "state": "partial" if missing else "complete",
            "missing_fields": sorted(set(missing)),
        },
        "provenance": {"source": source},
    }
    actor: SemanticActor = {}
    if actor_type:
        actor["type"] = actor_type
    if actor_id:
        actor["id"] = _identifier(actor_id)
    if actor_name:
        actor["name"] = _bounded_text(actor_name, limit=_MAX_DISPLAY_TITLE)
    if actor:
        envelope["actor"] = actor

    correlated = {
        str(key): _identifier(value)
        for key, value in (correlation or {}).items()
        if value not in (None, "")
    }
    if correlated:
        envelope["correlation"] = correlated
    return {
        "semantic_schema_version": SEMANTIC_SCHEMA_VERSION,
        "display_schema_version": DISPLAY_SCHEMA_VERSION,
        "semantic": envelope,
    }


def semantic_step_event_fields(
    *,
    step_id: str,
    phase: StepSemanticPhase,
    status: StepSemanticStatus,
    source: str,
    actor_type: SemanticActorType = "agent",
    actor_id: str | None = None,
    actor_name: str | None = None,
    correlation: dict[str, Any] | None = None,
    missing_fields: tuple[str, ...] | list[str] = (),
) -> dict[str, Any]:
    """Build the V2 semantic envelope reserved for authored task Steps.

    V1 stays closed and unchanged for existing producers.  Step lifecycle
    needs the additional ``step`` subject plus blocked/interrupted states, so
    emitting it as V2 prevents older clients from accepting a vocabulary they
    do not actually understand.
    """

    if phase not in _STEP_SEMANTIC_PHASES:
        raise ValueError(f"Unsupported step semantic phase: {phase}")
    if status not in _STEP_SEMANTIC_STATUSES:
        raise ValueError(f"Unsupported step semantic status: {status}")

    missing = [value for value in missing_fields if value]
    subject_id = _identifier(step_id)
    if not subject_id:
        missing.append("subject.id")
    if actor_type not in _SEMANTIC_ACTOR_TYPES:
        raise ValueError(f"Unsupported step semantic actor_type: {actor_type}")
    actor: SemanticActor = {"type": actor_type}
    if actor_id:
        actor["id"] = _identifier(actor_id)
    if actor_name:
        actor["name"] = _bounded_text(actor_name, limit=_MAX_DISPLAY_TITLE)
    correlated = {
        str(key): _identifier(value)
        for key, value in (correlation or {}).items()
        if value not in (None, "")
    }
    return {
        "semantic_schema_version": STEP_SEMANTIC_SCHEMA_VERSION,
        "display_schema_version": STEP_DISPLAY_SCHEMA_VERSION,
        "semantic": {
            "kind": "step",
            "subject": {"type": "step", "id": subject_id},
            "actor": actor,
            "lifecycle": {"phase": phase, "status": status},
            "correlation": correlated,
            "completeness": {
                "state": "partial" if missing else "complete",
                "missing_fields": sorted(set(missing)),
            },
            "provenance": {"source": source},
        },
    }


def display_safe_semantic_text(value: Any, *, limit: int = 600) -> str:
    """Expose the shared redaction/bounding policy to typed event producers."""

    return _bounded_text(value, limit=limit)


def _status(value: Any) -> SemanticStatus:
    normalized = str(value or "").strip().lower()
    if normalized.startswith("taskstate."):
        normalized = normalized.removeprefix("taskstate.")
    if normalized in {"done", "complete", "completed", "success"}:
        return "completed"
    if normalized in {"failed", "failure", "error"}:
        return "failed"
    if normalized in {"running", "active", "in_progress"}:
        return "running"
    if normalized in {"waiting", "queued", "pending", "open"}:
        return "pending"
    if normalized in {"skipped", "cancelled", "canceled", "removed"}:
        return "cancelled"
    return "unknown"


def _event_for_status(prefix: str, status: SemanticStatus) -> str:
    suffix = {
        "pending": "queued",
        "running": "started",
        "completed": "completed",
        "failed": "failed",
        "cancelled": "cancelled",
    }.get(status, "updated")
    return f"{prefix}.{suffix}"


def _phase_for_status(status: SemanticStatus) -> SemanticPhase:
    return {
        "pending": "requested",
        "running": "started",
        "completed": "completed",
        "failed": "failed",
        "cancelled": "cancelled",
    }.get(status, "progress")


def _plan_projection(
    data: dict[str, Any], run_id: str | None
) -> LegacySemanticProjection:
    task_id = _identifier(data.get("task_id"))
    plan_id = task_id or (f"{run_id}:plan" if run_id else "")
    todos: list[dict[str, str]] = []
    raw_todos = data.get("todos")
    if isinstance(raw_todos, list):
        for index, raw in enumerate(raw_todos[:100], start=1):
            if not isinstance(raw, dict):
                continue
            content = _bounded_text(raw.get("content"))
            active_form = _bounded_text(raw.get("active_form"))
            if not content and not active_form:
                continue
            todos.append(
                {
                    "id": _identifier(raw.get("id")) or f"todo_{index}",
                    "content": content or active_form,
                    "active_form": active_form,
                    "status": _status(raw.get("status")),
                }
            )
    completed = sum(item["status"] == "completed" for item in todos)
    is_complete = bool(todos) and completed == len(todos)
    event_type = "plan.completed" if is_complete else "plan.updated"
    status = "completed" if is_complete else "running"
    payload: dict[str, Any] = {
        **semantic_event_fields(
            kind="plan",
            subject_type="plan",
            subject_id=plan_id,
            phase="completed" if is_complete else "progress",
            status=status,
            source="legacy.todo_state",
            actor_type="agent",
            actor_id=_identifier(data.get("agent_id")) or None,
            correlation={
                "task_id": task_id,
                "run_id": run_id,
                "project_id": data.get("project_id"),
            },
        ),
        "task_id": task_id,
        "agent_id": _identifier(data.get("agent_id")),
        "todos": todos,
        "display_title": "Plan",
        "display_summary": f"{completed} of {len(todos)} steps completed",
    }
    return LegacySemanticProjection(event_type, payload)


def _subtask_plan_projection(
    data: dict[str, Any], run_id: str | None
) -> LegacySemanticProjection:
    task_id = _identifier(data.get("task_id"))
    plan_id = task_id or (f"{run_id}:plan" if run_id else "")
    tasks: list[dict[str, str]] = []

    def visit(candidates: Any, depth: int = 0) -> None:
        if depth > 5 or not isinstance(candidates, list):
            return
        for raw in candidates:
            if len(tasks) >= 100:
                return
            if not isinstance(raw, dict):
                continue
            content = _bounded_text(raw.get("content"))
            if content:
                tasks.append(
                    {
                        "id": _identifier(raw.get("id"))
                        or f"subtask_{len(tasks) + 1}",
                        "content": content,
                        "status": _status(
                            raw.get("state") or raw.get("status")
                        ),
                    }
                )
            visit(raw.get("subtasks"), depth + 1)

    visit(data.get("sub_tasks"))
    summary_task = _bounded_text(data.get("summary_task"))
    separator = summary_task.find("|")
    title = (
        summary_task[:separator].strip()
        if separator >= 0
        else "Execution plan"
    )
    summary = (
        summary_task[separator + 1 :].strip()
        if separator >= 0
        else summary_task
    )
    return LegacySemanticProjection(
        "plan.updated",
        {
            **semantic_event_fields(
                kind="plan",
                subject_type="plan",
                subject_id=plan_id,
                phase="progress",
                status="running",
                source="legacy.to_sub_tasks",
                correlation={
                    "task_id": task_id,
                    "run_id": run_id,
                    "project_id": data.get("project_id"),
                },
            ),
            "task_id": task_id,
            "tasks": tasks,
            "is_final": bool(data.get("is_final")),
            "display_title": title or "Execution plan",
            "display_summary": summary or f"{len(tasks)} subtasks",
        },
    )


def project_legacy_semantic_event(
    *, step: str, data: dict[str, Any], run_id: str | None = None
) -> LegacySemanticProjection | None:
    """Project a legacy runtime action when it has stable domain semantics."""

    if step == "todo_state":
        return _plan_projection(data, run_id)

    if step == "to_sub_tasks":
        return _subtask_plan_projection(data, run_id)

    if step == "decompose_text" and run_id:
        content = _bounded_text_fragment(data.get("content"))
        if not content.strip():
            return None
        return LegacySemanticProjection(
            "activity.progress",
            {
                **semantic_event_fields(
                    kind="narration",
                    subject_type="activity_stream",
                    subject_id=f"{run_id}:narration",
                    phase="progress",
                    status="running",
                    source="legacy.decompose_text",
                    actor_type="agent",
                    correlation={"run_id": run_id},
                ),
                "status": "running",
                "display_title": content,
                "display_fragment_exact": True,
            },
        )

    if step == "notice" and run_id:
        content = _bounded_text(
            data.get("content")
            or data.get("message_description")
            or data.get("notice")
        )
        if not content:
            return None
        title = _bounded_text(
            data.get("title") or data.get("message_title"),
            limit=_MAX_DISPLAY_TITLE,
        )
        notice_id = _identifier(
            data.get("notice_id")
            or data.get("tool_call_id")
            or f"{run_id}:notice"
        )
        task_id = _identifier(data.get("process_task_id"))
        tool_call_id = _identifier(data.get("tool_call_id"))
        severity = str(data.get("severity") or "info").strip().lower()
        if severity not in {"info", "success", "warning", "error"}:
            severity = "info"
        purpose = str(data.get("purpose") or "progress").strip().lower()
        if purpose not in {"progress", "result", "decision", "status"}:
            purpose = "progress"
        return LegacySemanticProjection(
            "notice.progress",
            {
                **semantic_event_fields(
                    kind="narration",
                    subject_type="activity_stream",
                    subject_id=notice_id,
                    phase="progress",
                    status="running",
                    source="legacy.notice",
                    actor_type="agent",
                    correlation={
                        "run_id": run_id,
                        "task_id": task_id,
                        "tool_call_id": tool_call_id,
                        "notice_id": notice_id,
                    },
                ),
                "notice_id": notice_id,
                "process_task_id": task_id,
                "tool_call_id": tool_call_id,
                "purpose": purpose,
                "severity": severity,
                "title": title,
                "content": content,
                "notice": content,
                "display_title": title or content,
                "display_summary": content if title else "",
            },
        )

    if step == "create_agent":
        agent_id = _identifier(data.get("agent_id"))
        agent_name = _bounded_text(
            data.get("agent_name"), limit=_MAX_DISPLAY_TITLE
        )
        tools = (
            [
                _bounded_text(item, limit=_MAX_DISPLAY_TITLE)
                for item in data.get("tools", [])[:100]
                if str(item or "").strip()
            ]
            if isinstance(data.get("tools"), list)
            else []
        )
        return LegacySemanticProjection(
            "agent.registered",
            {
                **semantic_event_fields(
                    kind="agent",
                    subject_type="agent",
                    subject_id=agent_id,
                    phase="completed",
                    status="completed",
                    source="legacy.create_agent",
                    actor_type="system",
                ),
                "agent_id": agent_id,
                "agent_name": agent_name,
                "tools": tools,
                "status": "completed",
                "display_title": agent_name or "Registered agent",
                "display_summary": (
                    f"Registered with {len(tools)} tools"
                    if tools
                    else "Registered agent"
                ),
            },
        )

    if step in {"activate_agent", "deactivate_agent"}:
        started = step == "activate_agent"
        terminal_status = (
            _status(data.get("status")) if not started else "running"
        )
        if not started and terminal_status == "unknown":
            terminal_status = "completed"
        terminal_phase = _phase_for_status(terminal_status)
        agent_id = _identifier(data.get("agent_id"))
        agent_name = _bounded_text(
            data.get("agent_name"), limit=_MAX_DISPLAY_TITLE
        )
        task_id = _identifier(data.get("process_task_id"))
        turn_id = _identifier(data.get("agent_turn_id"))
        missing = [] if turn_id else ["correlation.agent_turn_id"]
        payload = {
            **semantic_event_fields(
                kind="agent_turn",
                subject_type="agent_turn",
                subject_id=turn_id,
                phase="started" if started else terminal_phase,
                status="running" if started else terminal_status,
                source=f"legacy.{step}",
                actor_type="agent",
                actor_id=agent_id or None,
                actor_name=agent_name or None,
                correlation={
                    "agent_turn_id": turn_id,
                    "task_id": task_id,
                },
                missing_fields=missing,
            ),
            "agent_turn_id": turn_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "process_task_id": task_id,
            "status": "running" if started else terminal_status,
            "display_title": agent_name or "Agent",
        }
        if started:
            prompt = _bounded_text(data.get("message"))
            if prompt:
                payload["display_input"] = prompt
                payload["display_summary"] = "Started agent turn"
        else:
            tokens = data.get("tokens")
            payload["tokens"] = (
                int(tokens) if isinstance(tokens, (int, float)) else 0
            )
            outcome_label = {
                "failed": "Agent turn failed",
                "cancelled": "Agent turn cancelled",
            }.get(terminal_status, "Completed agent turn")
            payload["display_summary"] = (
                f"{outcome_label} · {payload['tokens']} tokens"
                if payload["tokens"]
                else outcome_label
            )
        return LegacySemanticProjection(
            "agent.started"
            if started
            else _event_for_status("agent", terminal_status),
            payload,
        )

    if step == "assign_task":
        status = _status(data.get("state"))
        task_id = _identifier(data.get("task_id"))
        content = _bounded_text(data.get("content"))
        assignee_id = _identifier(data.get("assignee_id"))
        return LegacySemanticProjection(
            _event_for_status("subtask", status),
            {
                **semantic_event_fields(
                    kind="subtask",
                    subject_type="task",
                    subject_id=task_id,
                    phase=_phase_for_status(status),
                    status=status,
                    source="legacy.assign_task",
                    actor_type="agent",
                    actor_id=assignee_id or None,
                    correlation={"task_id": task_id},
                ),
                "task_id": task_id,
                "assignee_id": assignee_id,
                "status": status,
                "display_title": content or "Subtask",
                "display_input": content,
                "display_summary": (
                    "Waiting for an agent"
                    if status == "pending"
                    else "Agent started this subtask"
                ),
            },
        )

    if step in {"task_state", "new_task_state"}:
        status = _status(data.get("state"))
        task_id = _identifier(data.get("task_id"))
        content = _bounded_text(data.get("content"))
        failures = data.get("failure_count")
        return LegacySemanticProjection(
            _event_for_status("subtask", status),
            {
                **semantic_event_fields(
                    kind="subtask",
                    subject_type="task",
                    subject_id=task_id,
                    phase=_phase_for_status(status),
                    status=status,
                    source=f"legacy.{step}",
                    correlation={"task_id": task_id},
                ),
                "task_id": task_id,
                "status": status,
                "failure_count": (
                    int(failures) if isinstance(failures, (int, float)) else 0
                ),
                "display_title": content or "Subtask",
                "display_input": content,
                "display_summary": {
                    "completed": "Subtask completed",
                    "failed": "Subtask failed",
                    "running": "Subtask is running",
                    "pending": "Subtask is waiting",
                    "cancelled": "Subtask stopped",
                }.get(status, "Subtask status updated"),
            },
        )

    if step in {"add_task", "remove_task", "skip_task"}:
        task_id = _identifier(data.get("task_id"))
        content = _bounded_text(data.get("content"))
        if step == "add_task":
            event_type, status, phase = (
                "subtask.created",
                "pending",
                "requested",
            )
        else:
            event_type, status, phase = (
                "subtask.cancelled",
                "cancelled",
                "cancelled",
            )
        return LegacySemanticProjection(
            event_type,
            {
                **semantic_event_fields(
                    kind="subtask",
                    subject_type="task",
                    subject_id=task_id,
                    phase=phase,
                    status=status,
                    source=f"legacy.{step}",
                    actor_type="user",
                    correlation={"task_id": task_id},
                ),
                "task_id": task_id,
                "status": status,
                "display_title": content or "Subtask",
                "display_input": content,
                "display_summary": (
                    "Subtask added"
                    if step == "add_task"
                    else "Subtask removed"
                ),
            },
        )

    if step == "write_file":
        relative_path = _portable_path(
            data.get("relative_path"), data.get("file_path")
        )
        task_id = _identifier(data.get("process_task_id"))
        missing = [] if data.get("relative_path") else ["relative_path"]
        return LegacySemanticProjection(
            "file.written",
            {
                **semantic_event_fields(
                    kind="file_change",
                    subject_type="file",
                    subject_id=relative_path,
                    phase="completed",
                    status="completed",
                    source="legacy.write_file",
                    correlation={"task_id": task_id},
                    missing_fields=missing,
                ),
                "relative_path": relative_path,
                "name": PurePosixPath(relative_path).name,
                "process_task_id": task_id,
                "operation": "written",
                "display_title": (
                    f"Wrote {relative_path}" if relative_path else "Wrote file"
                ),
            },
        )

    return None
