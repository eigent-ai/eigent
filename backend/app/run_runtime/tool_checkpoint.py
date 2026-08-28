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

"""Durable checkpoints around EmbeddedExecutionBackend tool calls."""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from app.run_context import get_current_run_context
from app.run_journal import SQLiteRunJournal, get_default_run_journal
from app.run_policy import ToolSafetyClass
from app.run_runtime.step_coordinator import (
    RunStepCoordinator,
    get_current_step_id,
)

# This allowlist is trusted code, unlike model-generated names and arguments.
# Unknown tools default to UNSAFE_WRITE. Browser actions are deliberately
# enumerated so mutating operations cannot inherit safety from a shared prefix.
_SAFE_READ_TOOL_NAMES = frozenset(
    {
        "ask_human_via_gui",
        "browser_console_view",
        "browser_get_page_snapshot",
        "browser_sheet_read",
        "get_website_content",
        "information_retrieval",
        "query_knowledge_base",
        "read_file",
        "read_files",
        "read_page",
        "search_google",
        "search_querit",
        "search_mcp_from_url",
        "screenshot",
        "search_web",
        "view_image",
        "web_fetch_and_analyze",
    }
)
_IDEMPOTENT_WRITE_TOOL_KEYS: dict[str, str] = {}
_TOOL_SAFETY_ATTRIBUTE = "_eigent_tool_safety"
_TOOL_IDEMPOTENCY_ARGUMENT_ATTRIBUTE = "_eigent_idempotency_argument"
_MAX_CHECKPOINT_JSON_BYTES = 16_000
_MAX_DISPLAY_TEXT_LENGTH = 600
_MAX_DISPLAY_TITLE_LENGTH = 96
_DISPLAY_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+")
_DISPLAY_POSIX_PATH_PATTERN = re.compile(
    r"(?<![A-Za-z0-9:])/(?:[^/\s\"'<>]+/)+[^/\s\"'<>]+"
)
_DISPLAY_WINDOWS_PATH_PATTERN = re.compile(
    r"\b[A-Za-z]:[\\/](?:[^\\/\s\"'<>]+[\\/])+[^\\/\s\"'<>]+"
)


@dataclass(frozen=True)
class ToolCheckpointContext:
    tool_call_id: str
    run_id: str
    attempt_id: str
    tool_name: str
    safety_class: ToolSafetyClass
    idempotency_key: str | None
    request: dict[str, Any]
    toolkit_name: str | None = None
    agent_name: str | None = None
    task_id: str | None = None
    step_id: str | None = None
    delegated_step_id: str | None = None
    display_title: str | None = None
    display_input: str | None = None
    started_monotonic: float = 0.0


@dataclass(frozen=True)
class ToolDisplayProjection:
    """Presentation-safe fields emitted beside canonical tool evidence."""

    title: str
    input: str | None = None
    output: str | None = None
    summary: str | None = None


current_tool_checkpoint: ContextVar[ToolCheckpointContext | None] = ContextVar(
    "current_tool_checkpoint",
    default=None,
)


@contextmanager
def tool_checkpoint_scope(
    checkpoint: ToolCheckpointContext | None,
) -> Iterator[None]:
    token = current_tool_checkpoint.set(checkpoint)
    try:
        yield
    finally:
        current_tool_checkpoint.reset(token)


def get_current_tool_checkpoint() -> ToolCheckpointContext | None:
    return current_tool_checkpoint.get()


class ToolCheckpointError(RuntimeError):
    pass


class ToolInvocationNotDispatchedError(RuntimeError):
    """The tool failed before its external operation could start.

    This is deliberately not a ``ToolCheckpointError``: callers still need to
    persist the invocation as a known tool failure.  The marker survives
    framework wrappers through the exception cause/context chain.
    """


class ToolCheckpointPersistenceError(ToolCheckpointError):
    pass


class UnsafeToolOutcomeError(ToolCheckpointError):
    pass


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        # Imported lazily because permission_policy.runtime depends on this
        # module for ToolCheckpointContext. At execution time the package is
        # fully initialized and both paths share the exact same redactor.
        from app.permission_policy.models import redact_action_arguments

        redacted = redact_action_arguments(value)
        argv_key = next(
            (
                key
                for key in value
                if str(key).replace("-", "_").lower() == "argv"
                and isinstance(value[key], (list, tuple))
            ),
            None,
        )
        if argv_key is not None:
            item = value[argv_key]
            redacted[str(argv_key)] = {
                "argument_count": len(item),
                "sha256": hashlib.sha256(
                    json.dumps(item, ensure_ascii=False).encode("utf-8")
                ).hexdigest(),
                "redacted_preview": redacted[str(argv_key)],
            }
        return redacted
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    if isinstance(value, str):
        from app.permission_policy.models import redact_action_arguments

        return redact_action_arguments({"value": value})["value"]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return repr(value)


def _bounded_record(value: Any) -> dict[str, Any]:
    redacted = _redact(value)
    encoded = json.dumps(redacted, ensure_ascii=False, sort_keys=True)
    if len(encoded.encode("utf-8")) <= _MAX_CHECKPOINT_JSON_BYTES:
        return redacted if isinstance(redacted, dict) else {"value": redacted}
    return {
        "truncated": True,
        "preview": encoded[:4000],
        "original_bytes": len(encoded.encode("utf-8")),
    }


def _truncate_display(
    value: Any, limit: int = _MAX_DISPLAY_TEXT_LENGTH
) -> str:
    text = " ".join(str(value).split())
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)].rstrip()}…"


def _display_path(value: Any) -> str:
    """Return a portable target label without exposing a device path."""

    text = str(value or "").strip()
    if not text:
        return ""
    if "://" in text:
        parsed = urlsplit(text)
        suffix = PurePosixPath(parsed.path).name
        target = parsed.netloc
        if suffix:
            target = f"{target}/…/{suffix}"
        return _truncate_display(target, 120)
    normalized = text.replace("\\", "/")
    if normalized.startswith("/") or re.match(r"^[A-Za-z]:/", normalized):
        return f"…/{PurePosixPath(normalized).name}"
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return _truncate_display(normalized, 120)


def _sanitize_display_text(
    value: Any, limit: int = _MAX_DISPLAY_TEXT_LENGTH
) -> str:
    """Redact portable display text that may embed URLs or device paths."""

    text = str(value)
    text = _DISPLAY_URL_PATTERN.sub(
        lambda match: _display_path(match.group(0)), text
    )
    text = _DISPLAY_WINDOWS_PATH_PATTERN.sub(
        lambda match: _display_path(match.group(0)), text
    )
    text = _DISPLAY_POSIX_PATH_PATTERN.sub(
        lambda match: _display_path(match.group(0)), text
    )
    return _truncate_display(text, limit)


def _first_mapping_value(
    mapping: dict[str, Any], keys: tuple[str, ...]
) -> Any:
    normalized = {
        str(key).replace("-", "_").lower(): value
        for key, value in mapping.items()
    }
    for key in keys:
        value = normalized.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def _search_result_display_urls(result: dict[str, Any]) -> list[str]:
    """Return bounded public URLs from a search result projection."""

    candidates = result.get("results")
    if not isinstance(candidates, list):
        candidates = result.get("value")
    if not isinstance(candidates, list):
        return []

    urls: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        if not isinstance(item, dict):
            continue
        raw_url = _first_mapping_value(
            item,
            ("url", "link", "context_url", "image_url"),
        )
        if not isinstance(raw_url, str):
            continue
        try:
            parsed = urlsplit(raw_url.strip())
            hostname = parsed.hostname
            if parsed.scheme.lower() not in {"http", "https"} or not hostname:
                continue
            port = parsed.port
        except ValueError:
            continue
        host = hostname
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        netloc = f"{host}:{port}" if port is not None else host
        safe_url = urlunsplit(
            (parsed.scheme.lower(), netloc, parsed.path or "/", "", "")
        )
        safe_url = _truncate_display(safe_url, 240)
        if safe_url not in seen:
            seen.add(safe_url)
            urls.append(safe_url)
        if len(urls) >= 10:
            break
    return urls


def _humanize_tool_name(tool_name: str) -> str:
    words = tool_name.strip().replace("-", "_").replace("_", " ")
    return words[:1].upper() + words[1:] if words else "Tool call"


def _tool_display_title(tool_name: str, request: dict[str, Any]) -> str:
    normalized = tool_name.strip().lower().replace("-", "_")
    path = _display_path(
        _first_mapping_value(
            request,
            ("path", "file_path", "filepath", "relative_path", "filename"),
        )
    )
    query = _sanitize_display_text(
        _first_mapping_value(
            request,
            ("query", "search_query", "pattern", "keyword"),
        )
        or "",
        52,
    )
    if normalized == "agent_run_subagent":
        subagent_type = _sanitize_display_text(
            _first_mapping_value(request, ("subagent_type",))
            or "general-purpose",
            48,
        )
        title = f"Started {subagent_type} sub-agent"
    elif normalized == "agent_get_task_output":
        title = "Checked sub-agent status"
    elif normalized == "agent_stop_task":
        title = "Stopped sub-agent task"
    elif normalized in {"todo_write", "update_plan"}:
        title = "Updated plan"
    elif normalized == "step_update":
        title = "Updated task step"
    elif normalized in {"read_file", "read_files"}:
        title = f"Read {path}" if path else "Read files"
    elif normalized in {
        "write_file",
        "write_to_file",
        "shell_write_content_to_file",
    }:
        title = f"Wrote {path}" if path else "Wrote file"
    elif normalized in {"glob_files", "list_files", "list_directory"}:
        title = f"Listed {path}" if path else "Listed files"
    elif "search_memory" in normalized:
        title = "Searched memory"
    elif "search" in normalized:
        title = f"Searched for {query}" if query else "Searched"
    elif normalized.startswith(("shell", "terminal", "exec", "run_")):
        title = "Ran command"
    elif normalized == "cleanup":
        title = "Cleaned up tools"
    elif normalized.startswith(("browser", "navigate", "visit")):
        title = "Used browser"
    else:
        title = _humanize_tool_name(tool_name)
    return _truncate_display(title, _MAX_DISPLAY_TITLE_LENGTH)


def _tool_display_input(tool_name: str, request: dict[str, Any]) -> str | None:
    normalized = tool_name.strip().lower().replace("-", "_")
    if normalized == "agent_run_subagent":
        description = _first_mapping_value(request, ("description",))
        if description is not None:
            return "Task: " + _sanitize_display_text(description, 240)
        return "Task: delegated sub-agent work"
    if normalized in {"agent_get_task_output", "agent_stop_task"}:
        task_id = _first_mapping_value(request, ("task_id",))
        if task_id is not None:
            return "Sub-agent task: " + _sanitize_display_text(task_id, 120)
    if normalized == "step_update":
        summary = _first_mapping_value(request, ("summary",))
        if summary is not None:
            return _sanitize_display_text(summary, 240)
        return None

    path = _display_path(
        _first_mapping_value(
            request,
            ("path", "file_path", "filepath", "relative_path", "filename"),
        )
    )
    if path:
        return f"File: {path}"

    query = _first_mapping_value(
        request, ("query", "search_query", "pattern", "keyword")
    )
    if query is not None:
        return f"Query: {_sanitize_display_text(query, 240)}"

    url = _first_mapping_value(request, ("url", "uri"))
    if url is not None:
        return f"URL: {_display_path(url)}"

    if normalized in {"todo_write", "update_plan"}:
        todos = _first_mapping_value(request, ("todos", "steps", "tasks"))
        if isinstance(todos, list):
            statuses: dict[str, int] = {}
            for item in todos:
                if not isinstance(item, dict):
                    continue
                status = str(item.get("status") or "item").replace("_", " ")
                statuses[status] = statuses.get(status, 0) + 1
            details = " · ".join(
                f"{count} {status}" for status, count in statuses.items()
            )
            return f"{len(todos)} plan items" + (
                f" · {details}" if details else ""
            )

    command = _first_mapping_value(request, ("command", "cmd"))
    if command is not None:
        return f"Command: {_sanitize_display_text(command, 360)}"
    argv = _first_mapping_value(request, ("argv",))
    if isinstance(argv, dict):
        preview = argv.get("redacted_preview")
        if isinstance(preview, list):
            return "Command: " + _sanitize_display_text(
                " ".join(map(str, preview)), 360
            )
        count = argv.get("argument_count")
        if count is not None:
            return f"Command arguments: {count}"

    content = _first_mapping_value(request, ("content", "text", "data"))
    if isinstance(content, str):
        return f"Content: {len(content)} characters"
    if isinstance(content, (list, dict)):
        return f"Content: {len(content)} items"

    visible_keys = sorted(
        str(key).replace("_", " ")
        for key, value in request.items()
        if value not in (None, "", [], {})
        and str(key) not in {"truncated", "preview", "original_bytes"}
    )
    return (
        f"Parameters: {_truncate_display(', '.join(visible_keys), 240)}"
        if visible_keys
        else None
    )


def _tool_display_output(
    tool_name: str,
    result: dict[str, Any] | None,
) -> str | None:
    if not result:
        return None
    normalized = tool_name.strip().lower().replace("-", "_")
    error = _first_mapping_value(result, ("error", "reason"))
    if error is not None:
        return f"Error: {_sanitize_display_text(error, 420)}"
    if normalized in {
        "agent_run_subagent",
        "agent_get_task_output",
        "agent_stop_task",
    }:
        state = _first_mapping_value(result, ("status",))
        if state is not None:
            return "Sub-agent status: " + _sanitize_display_text(state, 80)
        return "Sub-agent task updated"
    if normalized in {"search_google", "search_querit", "search_web"}:
        urls = _search_result_display_urls(result)
        if urls:
            return _truncate_display(
                "Sources: " + " ".join(urls),
                _MAX_DISPLAY_TEXT_LENGTH,
            )
    message = _first_mapping_value(result, ("message", "summary"))
    if message is not None:
        if isinstance(message, str):
            return f"Returned a message ({len(message)} characters)"
        return "Returned a message"
    path = _first_mapping_value(
        result, ("path", "file_path", "relative_path", "filename")
    )
    if path is not None:
        return f"File: {_display_path(path)}"
    count = _first_mapping_value(
        result, ("count", "result_count", "items_count", "match_count")
    )
    if count is not None:
        return f"Returned {count} items"
    if "content" in result:
        content = result["content"]
        if isinstance(content, str):
            return f"Returned {len(content)} characters"
        if isinstance(content, (list, dict)):
            return f"Returned {len(content)} items"
    if set(result) == {"value"}:
        value = result["value"]
        if value is None:
            return None
        if isinstance(value, str):
            return f"Returned text ({len(value)} characters)"
        if isinstance(value, (list, dict)):
            return f"Returned {len(value)} items"
        return f"Returned {_truncate_display(value, 120)}"
    if result.get("truncated"):
        size = result.get("original_bytes")
        return "Returned a large result" + (f" ({size} bytes)" if size else "")
    if result.get("success") is True:
        return "Completed successfully"
    return None


def _format_duration(duration_ms: int | None) -> str:
    if duration_ms is None:
        return ""
    if duration_ms < 1000:
        return f"{duration_ms} ms"
    seconds = duration_ms / 1000
    return f"{seconds:.1f} s" if seconds < 10 else f"{seconds:.0f} s"


def build_tool_display_projection(
    *,
    tool_name: str,
    request: dict[str, Any],
    status: str,
    result: dict[str, Any] | None = None,
    duration_ms: int | None = None,
) -> ToolDisplayProjection:
    """Build bounded display text without exposing raw request/result data."""

    title = _tool_display_title(tool_name, request)
    output = _tool_display_output(tool_name, result)
    duration = _format_duration(duration_ms)
    if status == "prepared":
        summary = "Prepared"
    elif status == "dispatched":
        summary = "Running"
    elif status == "completed":
        summary = f"Completed in {duration}" if duration else "Completed"
    elif status == "outcome_unknown":
        summary = (
            f"Outcome unknown after {duration}"
            if duration
            else "Outcome unknown"
        )
    else:
        summary = f"Failed after {duration}" if duration else "Failed"
    return ToolDisplayProjection(
        title=title,
        input=_tool_display_input(tool_name, request),
        output=output,
        summary=summary,
    )


def classify_tool_safety(
    tool_name: str, arguments: dict[str, Any]
) -> tuple[ToolSafetyClass, str | None]:
    normalized = tool_name.strip().lower()
    if normalized in _SAFE_READ_TOOL_NAMES:
        return ToolSafetyClass.SAFE_READ, None
    idempotency_argument = _IDEMPOTENT_WRITE_TOOL_KEYS.get(normalized)
    if idempotency_argument is not None:
        value = arguments.get(idempotency_argument)
        if value is not None and str(value).strip():
            return ToolSafetyClass.IDEMPOTENT_WRITE, str(value)
    return ToolSafetyClass.UNSAFE_WRITE, None


def declare_tool_safety(
    tool: Any,
    safety_class: ToolSafetyClass,
    *,
    idempotency_argument: str | None = None,
) -> Any:
    """Attach a trusted safety declaration to a tool assembled by Eigent.

    The model never controls these attributes. Third-party and MCP tools that
    do not carry a declaration remain conservative UNSAFE_WRITE operations.
    """

    if (
        safety_class is ToolSafetyClass.IDEMPOTENT_WRITE
        and not idempotency_argument
    ):
        raise ValueError("idempotent tool declarations require a key field")
    targets = [tool]
    try:
        wrapped = getattr(tool, "func", None)
    except Exception:
        wrapped = None
    if wrapped is not None and wrapped is not tool:
        targets.append(wrapped)
    for target in targets:
        try:
            # Write the key first so a partially writable proxy can never
            # expose an idempotent declaration without its required key.
            if idempotency_argument:
                setattr(
                    target,
                    _TOOL_IDEMPOTENCY_ARGUMENT_ATTRIBUTE,
                    idempotency_argument,
                )
            setattr(target, _TOOL_SAFETY_ATTRIBUTE, safety_class.value)
        except (AttributeError, TypeError):
            continue
        break
    return tool


def declared_tool_safety(
    tool: Any,
    tool_name: str,
    arguments: dict[str, Any],
) -> tuple[ToolSafetyClass, str | None]:
    """Resolve code-owned metadata before the conservative name fallback."""

    targets = (tool, getattr(tool, "func", None))
    for target in targets:
        if target is None:
            continue
        attributes = getattr(target, "__dict__", {})
        raw_safety = (
            attributes.get(_TOOL_SAFETY_ATTRIBUTE)
            if isinstance(attributes, dict)
            else None
        )
        if raw_safety is None:
            continue
        try:
            safety = ToolSafetyClass(raw_safety)
        except (TypeError, ValueError):
            # Dynamic proxies/mocks may synthesize arbitrary attributes. Only
            # a valid, explicitly stored enum value is a trusted declaration.
            continue
        if safety is not ToolSafetyClass.IDEMPOTENT_WRITE:
            return safety, None
        key_name = attributes.get(_TOOL_IDEMPOTENCY_ARGUMENT_ATTRIBUTE)
        value = arguments.get(key_name) if key_name else None
        if value is not None and str(value).strip():
            return safety, str(value)
        # A broken trusted declaration must fail conservative instead of
        # accepting an LLM-provided field with a guessed name.
        return ToolSafetyClass.UNSAFE_WRITE, None
    return classify_tool_safety(tool_name, arguments)


def _subagent_step_id_for_task(
    store: SQLiteRunJournal,
    *,
    run_id: str,
    task_id: str,
) -> str | None:
    """Resolve a delegated task through durable tool facts, never adjacency."""

    target = task_id.strip()
    if not target:
        return None
    for event in reversed(store.list_events(run_id)):
        if event.event_type != "tool.completed":
            continue
        payload = event.payload
        tool_name = str(payload.get("tool_name") or "")
        if tool_name.strip().lower().replace("-", "_") != "agent_run_subagent":
            continue
        result = payload.get("result")
        if not isinstance(result, dict):
            continue
        candidate = _first_mapping_value(result, ("task_id", "taskId"))
        if str(candidate or "").strip() != target:
            continue
        step_id = str(payload.get("step_id") or "").strip()
        return step_id or None
    return None


def _delegated_task_state(result: dict[str, Any] | None) -> str | None:
    if not result:
        return None
    value = _first_mapping_value(result, ("status", "state"))
    return str(value).strip().lower().replace("-", "_") if value else None


def prepare_tool_checkpoint(
    *,
    raw_tool_call_id: str,
    tool_name: str,
    arguments: dict[str, Any],
    declared_safety: tuple[ToolSafetyClass, str | None] | None = None,
    dispatch_immediately: bool = True,
    toolkit_name: str | None = None,
    agent_name: str | None = None,
    task_id: str | None = None,
    journal: SQLiteRunJournal | None = None,
) -> ToolCheckpointContext | None:
    run_context = get_current_run_context()
    if run_context is None:
        raise ToolCheckpointPersistenceError(
            f"tool {tool_name!r} cannot execute without an admitted RunContext"
        )
    store = journal or get_default_run_journal()
    try:
        run = store.get_run(run_context.run_id)
    except Exception as error:
        raise ToolCheckpointPersistenceError(
            "failed to load the durable Run before tool execution"
        ) from error
    if run is None or run.active_attempt_id is None:
        raise RuntimeError(
            f"tool {tool_name!r} has no active durable RunAttempt"
        )
    safety, idempotency_key = declared_safety or classify_tool_safety(
        tool_name, arguments
    )
    call_id = raw_tool_call_id.strip() or uuid.uuid4().hex
    canonical_id = f"{run_context.run_id}:{call_id}"
    request = _bounded_record(arguments)
    display = build_tool_display_projection(
        tool_name=tool_name,
        request=request,
        status="prepared",
    )
    steps = RunStepCoordinator(store)
    parent_step_id = get_current_step_id() or steps.current_running_step_id(
        run_context.run_id,
        agent_id=agent_name,
    )
    step_id = parent_step_id
    delegated_step_id: str | None = None
    normalized_tool_name = tool_name.strip().lower().replace("-", "_")
    if normalized_tool_name == "agent_run_subagent":
        child_agent_id = _first_mapping_value(
            request,
            ("subagent_type", "agent_name", "role"),
        )
        child_title = _first_mapping_value(
            request,
            ("description", "task", "prompt"),
        )
        step_id = steps.create_child_step(
            project_id=run.project_id,
            run_id=run_context.run_id,
            parent_step_id=parent_step_id,
            task_identity=canonical_id,
            title=_sanitize_display_text(
                child_title or "Delegated sub-agent task",
                160,
            ),
            agent_id=(
                _sanitize_display_text(child_agent_id, 120)
                if child_agent_id is not None
                else None
            ),
            start=False,
        )
        delegated_step_id = step_id
    elif normalized_tool_name in {"agent_get_task_output", "agent_stop_task"}:
        delegated_task_id = _first_mapping_value(
            request,
            ("task_id", "taskId"),
        )
        if delegated_task_id is not None:
            delegated_step_id = _subagent_step_id_for_task(
                store,
                run_id=run_context.run_id,
                task_id=str(delegated_task_id),
            )
            step_id = delegated_step_id or step_id
    checkpoint = ToolCheckpointContext(
        tool_call_id=canonical_id,
        run_id=run_context.run_id,
        attempt_id=run.active_attempt_id,
        tool_name=tool_name,
        safety_class=safety,
        idempotency_key=idempotency_key,
        request=request,
        toolkit_name=toolkit_name,
        agent_name=agent_name,
        task_id=task_id,
        step_id=step_id,
        delegated_step_id=delegated_step_id,
        display_title=display.title,
        display_input=display.input,
        started_monotonic=time.monotonic(),
    )
    values = dict(
        tool_call_id=checkpoint.tool_call_id,
        run_id=checkpoint.run_id,
        attempt_id=checkpoint.attempt_id,
        tool_name=checkpoint.tool_name,
        safety_class=checkpoint.safety_class,
        request=checkpoint.request,
        idempotency_key=checkpoint.idempotency_key,
        toolkit_name=checkpoint.toolkit_name,
        agent_name=checkpoint.agent_name,
        task_id=checkpoint.task_id,
        step_id=checkpoint.step_id,
        display_title=checkpoint.display_title,
        display_input=checkpoint.display_input,
    )
    try:
        store.checkpoint_tool_call(
            status="prepared",
            display_summary="Prepared",
            **values,
        )
        if dispatch_immediately:
            store.checkpoint_tool_call(
                status="dispatched",
                display_summary="Running",
                **values,
            )
            if delegated_step_id is not None:
                steps.start_child_step(
                    project_id=run.project_id,
                    run_id=run_context.run_id,
                    step_id=delegated_step_id,
                )
    except Exception as error:
        raise ToolCheckpointPersistenceError(
            f"failed to persist checkpoint before tool {tool_name!r}"
        ) from error
    _notify_cloud_sync()
    return checkpoint


def dispatch_tool_checkpoint(
    checkpoint: ToolCheckpointContext | None,
    *,
    journal: SQLiteRunJournal | None = None,
) -> None:
    """Persist dispatch only after policy approval is durably resolved."""

    if checkpoint is None:
        return
    store = journal or get_default_run_journal()
    try:
        store.checkpoint_tool_call(
            tool_call_id=checkpoint.tool_call_id,
            run_id=checkpoint.run_id,
            attempt_id=checkpoint.attempt_id,
            tool_name=checkpoint.tool_name,
            safety_class=checkpoint.safety_class,
            status="dispatched",
            request=checkpoint.request,
            idempotency_key=checkpoint.idempotency_key,
            toolkit_name=checkpoint.toolkit_name,
            agent_name=checkpoint.agent_name,
            task_id=checkpoint.task_id,
            step_id=checkpoint.step_id,
            display_title=checkpoint.display_title,
            display_input=checkpoint.display_input,
            display_summary="Running",
        )
        if checkpoint.delegated_step_id is not None:
            run = store.get_run(checkpoint.run_id)
            if run is None:
                raise ToolCheckpointPersistenceError(
                    f"run {checkpoint.run_id!r} disappeared before dispatch"
                )
            RunStepCoordinator(store).start_child_step(
                project_id=run.project_id,
                run_id=checkpoint.run_id,
                step_id=checkpoint.delegated_step_id,
            )
    except Exception as error:
        raise ToolCheckpointPersistenceError(
            f"failed to persist dispatch for tool {checkpoint.tool_name!r}"
        ) from error
    _notify_cloud_sync()


def finish_tool_checkpoint(
    checkpoint: ToolCheckpointContext | None,
    *,
    result: Any = None,
    error: Exception | None = None,
    outcome_known: bool = False,
    journal: SQLiteRunJournal | None = None,
) -> None:
    if checkpoint is None:
        return
    store = journal or get_default_run_journal()
    if error is None:
        status = "completed"
        outcome = "completed"
        result_payload = _bounded_record(result)
    elif outcome_known:
        # A structured error returned by the tool is an observed outcome, not
        # an ambiguous external side effect. Keep it model-visible/retryable
        # without poisoning explicit Run resume.
        status = "failed"
        outcome = "failed"
        result_payload = _bounded_record(
            result if result is not None else {"error": str(error)}
        )
    elif checkpoint.safety_class in {
        ToolSafetyClass.INTERNAL_CONTROL,
        ToolSafetyClass.UNSAFE_WRITE,
    }:
        # Cancelling a synchronous AgentToolkit call only cancels this await;
        # the delegated thread/child may still be running. Preserve the same
        # fail-closed ambiguity boundary used for external writes so Resume
        # cannot silently launch duplicate child work.
        status = "outcome_unknown"
        outcome = "outcome_unknown"
        result_payload = _bounded_record(
            {
                "error": str(error),
                "external_effect_may_have_occurred": (
                    checkpoint.safety_class is ToolSafetyClass.UNSAFE_WRITE
                ),
                "delegated_work_may_still_be_running": (
                    checkpoint.safety_class is ToolSafetyClass.INTERNAL_CONTROL
                ),
            }
        )
    else:
        status = "failed"
        outcome = "failed"
        result_payload = _bounded_record({"error": str(error)})
    duration_ms = max(
        0,
        round((time.monotonic() - checkpoint.started_monotonic) * 1000),
    )
    display = build_tool_display_projection(
        tool_name=checkpoint.tool_name,
        request=checkpoint.request,
        status=status,
        result=result_payload,
        duration_ms=duration_ms,
    )
    try:
        store.checkpoint_tool_call(
            tool_call_id=checkpoint.tool_call_id,
            run_id=checkpoint.run_id,
            attempt_id=checkpoint.attempt_id,
            tool_name=checkpoint.tool_name,
            safety_class=checkpoint.safety_class,
            status=status,
            request=checkpoint.request,
            result=result_payload,
            idempotency_key=checkpoint.idempotency_key,
            outcome=outcome,
            toolkit_name=checkpoint.toolkit_name,
            agent_name=checkpoint.agent_name,
            task_id=checkpoint.task_id,
            step_id=checkpoint.step_id,
            display_title=checkpoint.display_title or display.title,
            display_input=checkpoint.display_input or display.input,
            display_output=display.output,
            display_summary=display.summary,
            display_duration_ms=duration_ms,
        )
        normalized_tool_name = (
            checkpoint.tool_name.strip().lower().replace("-", "_")
        )
        if (
            normalized_tool_name
            in {
                "agent_run_subagent",
                "agent_get_task_output",
                "agent_stop_task",
            }
            and checkpoint.delegated_step_id
        ):
            run = store.get_run(checkpoint.run_id)
            if run is None:
                raise ToolCheckpointPersistenceError(
                    f"run {checkpoint.run_id!r} disappeared while finishing "
                    "its delegated Step"
                )
            child_outcome: str | None
            if outcome == "outcome_unknown":
                child_outcome = "outcome_unknown"
            elif outcome == "failed":
                child_outcome = "failed"
            elif normalized_tool_name == "agent_stop_task":
                child_outcome = "cancelled"
            else:
                delegated_state = _delegated_task_state(result_payload)
                if delegated_state in {
                    "queued",
                    "pending",
                    "running",
                    "in_progress",
                    "started",
                }:
                    child_outcome = None
                elif delegated_state in {
                    "failed",
                    "error",
                    "timed_out",
                    "timeout",
                }:
                    child_outcome = "failed"
                elif delegated_state in {
                    "cancelled",
                    "canceled",
                    "stopped",
                    "interrupted",
                }:
                    child_outcome = "cancelled"
                elif delegated_state in {
                    "completed",
                    "complete",
                    "succeeded",
                    "success",
                }:
                    child_outcome = "completed"
                elif normalized_tool_name == "agent_run_subagent" and (
                    _first_mapping_value(result_payload, ("task_id", "taskId"))
                    is not None
                ):
                    # Dispatch acknowledgement without a terminal status.
                    child_outcome = None
                else:
                    child_outcome = "completed"
            if child_outcome is not None:
                RunStepCoordinator(store).finish_child_step(
                    project_id=run.project_id,
                    run_id=checkpoint.run_id,
                    step_id=checkpoint.delegated_step_id,
                    outcome=child_outcome,  # type: ignore[arg-type]
                    summary=display.output or display.summary,
                )
    except Exception as persistence_error:
        raise ToolCheckpointPersistenceError(
            f"failed to persist outcome for tool {checkpoint.tool_name!r}"
        ) from persistence_error
    _notify_cloud_sync()
    if error is not None and status == "outcome_unknown":
        raise UnsafeToolOutcomeError(
            f"tool {checkpoint.tool_name!r} may have produced an external side effect"
        ) from error


def _notify_cloud_sync() -> None:
    try:
        from app.run_sync.runtime import notify_default_cloud_sync_worker

        notify_default_cloud_sync_worker()
    except Exception:
        # The SQLite checkpoint is authoritative; the outbox worker also polls.
        return
