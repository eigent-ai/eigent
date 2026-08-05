"""Durable checkpoints around EmbeddedExecutionBackend tool calls."""

from __future__ import annotations

import json
import uuid
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
        "browser_console_view",
        "browser_get_page_snapshot",
        "browser_sheet_read",
        "get_website_content",
        "read_file",
        "read_page",
        "screenshot",
        "search_web",
        "view_image",
    }
)
_IDEMPOTENT_WRITE_TOOL_KEYS: dict[str, str] = {}
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


def prepare_tool_checkpoint(
    *,
    raw_tool_call_id: str,
    tool_name: str,
    arguments: dict[str, Any],
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
    safety, idempotency_key = classify_tool_safety(tool_name, arguments)
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
        store.checkpoint_tool_call(status="dispatched", **values)
    except Exception as error:
        raise ToolCheckpointPersistenceError(
            f"failed to persist checkpoint before tool {tool_name!r}"
        ) from error
    _notify_cloud_sync()
    return checkpoint


def finish_tool_checkpoint(
    checkpoint: ToolCheckpointContext | None,
    *,
    result: Any = None,
    error: Exception | None = None,
    journal: SQLiteRunJournal | None = None,
) -> None:
    if checkpoint is None:
        return
    store = journal or get_default_run_journal()
    if error is None:
        status = "completed"
        outcome = "completed"
        result_payload = _bounded_record(result)
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
