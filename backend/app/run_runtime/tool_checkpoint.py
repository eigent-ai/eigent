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
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from app.run_context import get_current_run_context
from app.run_journal import SQLiteRunJournal, get_default_run_journal
from app.run_policy import ToolSafetyClass

_REDACTED_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
}
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


@dataclass(frozen=True)
class ToolCheckpointContext:
    tool_call_id: str
    run_id: str
    attempt_id: str
    tool_name: str
    safety_class: ToolSafetyClass
    idempotency_key: str | None
    request: dict[str, Any]


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


class ToolCheckpointPersistenceError(ToolCheckpointError):
    pass


class UnsafeToolOutcomeError(ToolCheckpointError):
    pass


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): (
                "[REDACTED]"
                if str(key).lower() in _REDACTED_KEYS
                else {
                    "argument_count": len(item),
                    "sha256": hashlib.sha256(
                        json.dumps(item, ensure_ascii=False).encode("utf-8")
                    ).hexdigest(),
                }
                if str(key).lower() == "argv"
                and isinstance(item, (list, tuple))
                else _redact(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    if value is None or isinstance(value, (bool, int, float, str)):
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


def prepare_tool_checkpoint(
    *,
    raw_tool_call_id: str,
    tool_name: str,
    arguments: dict[str, Any],
    declared_safety: tuple[ToolSafetyClass, str | None] | None = None,
    dispatch_immediately: bool = True,
    journal: SQLiteRunJournal | None = None,
) -> ToolCheckpointContext | None:
    run_context = get_current_run_context()
    if run_context is None:
        return None
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
    checkpoint = ToolCheckpointContext(
        tool_call_id=canonical_id,
        run_id=run_context.run_id,
        attempt_id=run.active_attempt_id,
        tool_name=tool_name,
        safety_class=safety,
        idempotency_key=idempotency_key,
        request=request,
    )
    values = dict(
        tool_call_id=checkpoint.tool_call_id,
        run_id=checkpoint.run_id,
        attempt_id=checkpoint.attempt_id,
        tool_name=checkpoint.tool_name,
        safety_class=checkpoint.safety_class,
        request=checkpoint.request,
        idempotency_key=checkpoint.idempotency_key,
    )
    try:
        store.checkpoint_tool_call(status="prepared", **values)
        if dispatch_immediately:
            store.checkpoint_tool_call(status="dispatched", **values)
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
    elif checkpoint.safety_class is ToolSafetyClass.UNSAFE_WRITE:
        status = "outcome_unknown"
        outcome = "outcome_unknown"
        result_payload = {
            "error": str(error),
            "external_effect_may_have_occurred": True,
        }
    else:
        status = "failed"
        outcome = "failed"
        result_payload = {"error": str(error)}
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
