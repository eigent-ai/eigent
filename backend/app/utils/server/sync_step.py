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
"""
Cloud sync step decorator.

Syncs SSE step data to cloud server when SERVER_URL is configured.
High-frequency events (decompose_text) are batched to reduce API calls.

Config (~/.eigent/.env):
    SERVER_URL=https://dev.eigent.ai/api/v1
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass

import httpx

from app.component.environment import env
from app.run_context import get_current_run_context
from app.run_journal.runtime import get_default_event_recorder
from app.run_sync.runtime import _uses_eigent_hosted_control_plane
from app.service.task import get_task_lock_if_exists

logger = logging.getLogger("sync_step")

# Batch config for decompose_text events
BATCH_WORD_THRESHOLD = 5

# Buffer storage: task_id -> accumulated text
_text_buffers: dict[str, str] = {}


@dataclass
class _LocalTextBuffer:
    project_id: str
    content: str
    created_at: float


# Raw decompose_text chunks are the only Phase 1 exception to strict
# commit-before-yield. They are non-critical display deltas and are committed
# in small batches so synchronous=FULL does not fsync once per token chunk.
_local_text_buffers: dict[str, _LocalTextBuffer] = {}
_warned_missing_auth_projects: set[str] = set()
_warned_missing_server_url_projects: set[str] = set()
_logged_sync_targets: set[str] = set()
_logged_first_sync_tasks: set[str] = set()


def _normalize_server_url(server_url: str | None) -> str:
    if not server_url:
        return ""

    trimmed = server_url.rstrip("/")
    if trimmed.endswith("/api/v1"):
        return trimmed
    return f"{trimmed}/api/v1"


def _get_server_url(args) -> str:
    server_url = (
        getattr(args[0], "server_url", None)
        if args and hasattr(args[0], "server_url")
        else None
    )

    if not server_url:
        server_url = env("SERVER_URL", "")

    return str(server_url or "").strip()


def _get_config(args):
    server_url = _get_server_url(args)

    # Local/self-hosted servers already own the full Run history in SQLite.
    # The legacy step projection exists only for Eigent-operated Cloud APIs.
    if not _uses_eigent_hosted_control_plane(server_url):
        return None

    return f"{_normalize_server_url(server_url)}/chat/steps"


def sync_step(func):
    async def wrapper(*args, **kwargs):
        config = _get_config(args)

        if not config and not _get_server_url(args):
            _warn_missing_server_url(args)
        elif config and config not in _logged_sync_targets:
            _logged_sync_targets.add(config)
            logger.info("Cloud step sync enabled: %s", config)

        try:
            async for value in func(*args, **kwargs):
                await _record_local_step_fail_open(args, value)
                if config:
                    _try_sync(args, value, config)
                yield value
        finally:
            # A stream normally emits a non-text terminal step, but flush the
            # tail here as well so cancellation/end-of-stream cannot strand a
            # sub-threshold text batch in process memory.
            await _flush_local_text_for_args_fail_open(args)

    return wrapper


async def sync_step_event(
    *,
    task_id: str,
    step: str,
    data: dict,
    authorization: str | None,
    project_id: str | None = None,
    run_id: str | None = None,
    server_url: str | None = None,
) -> None:
    """Persist one non-SSE event, then schedule legacy cloud projection."""
    resolved_run_id = run_id or task_id
    timestamp = time.time_ns() / 1_000_000_000
    resolved_project_id = project_id or task_id
    try:
        await get_default_event_recorder().record_legacy_step(
            project_id=resolved_project_id,
            run_id=resolved_run_id,
            step=step,
            data=data,
            created_at=timestamp,
        )
    except Exception as exc:
        _mark_local_history_degraded(
            project_id=resolved_project_id,
            run_id=resolved_run_id,
            error=exc,
        )

    raw_server_url = str(server_url or env("SERVER_URL", "")).strip()
    if (
        not _uses_eigent_hosted_control_plane(raw_server_url)
        or not authorization
    ):
        return
    sync_base = _normalize_server_url(raw_server_url)

    payload = {
        "task_id": task_id,
        "run_id": resolved_run_id,
        "step": step,
        "data": data,
        "timestamp": timestamp,
    }
    asyncio.create_task(
        _send(
            f"{sync_base}/chat/steps",
            payload,
            {"Authorization": authorization},
        )
    )


async def _record_local_step(args, value) -> None:
    data = _parse_value(value)
    if not data:
        return

    run_id = _get_task_id(args)
    if not run_id:
        logger.warning("Skipping local step persistence: run_id is missing")
        return

    chat = args[0] if args else None
    project_id = getattr(chat, "project_id", None) or run_id
    if data["step"] == "decompose_text":
        content = data["data"].get("content", "")
        if not content:
            return
        existing = _local_text_buffers.get(run_id)
        if existing is not None and existing.project_id != project_id:
            await _flush_local_text(run_id)
            existing = None
        if existing is None:
            existing = _LocalTextBuffer(
                project_id=project_id,
                content="",
                created_at=time.time_ns() / 1_000_000_000,
            )
            _local_text_buffers[run_id] = existing
        existing.content += content
        if len(existing.content.split()) >= BATCH_WORD_THRESHOLD:
            await _flush_local_text(run_id)
        return

    # Preserve event order: a non-text step cannot commit ahead of text that
    # was already shown to the user.
    await _flush_local_text(run_id)
    if data["step"] in {"end", "wait_confirm"}:
        # RunCoordinator owns the successful terminal transaction. Artifact
        # discovery happens first, then assistant.final + run.completed commit
        # atomically before the terminal answer frame is yielded to the
        # Renderer. ``wait_confirm`` is the legacy direct-answer frame; it is
        # also a complete logical Run even though the warm Project generator
        # remains alive for later follow-ups.
        from app.run_runtime import get_default_run_coordinator

        if not await get_default_run_coordinator().complete_turn(
            run_id,
            project_id=project_id,
            assistant_data=data["data"],
        ):
            raise RuntimeError(
                f"RunCoordinator could not terminalize completed Run {run_id!r}"
            )
    else:
        await get_default_event_recorder().record_legacy_step(
            project_id=project_id,
            run_id=run_id,
            step=data["step"],
            data=data["data"],
        )


async def _record_local_step_fail_open(args, value) -> None:
    try:
        await _record_local_step(args, value)
    except Exception as exc:
        parsed = _parse_value(value)
        if parsed is not None and parsed.get("step") in {
            "end",
            "wait_confirm",
        }:
            # A successful terminal answer is a product claim that must never
            # outrun the canonical assistant result and Run transaction.
            raise
        run_id, project_id = _resolve_run_and_project(args)
        _local_text_buffers.pop(run_id, None)
        _mark_local_history_degraded(
            project_id=project_id,
            run_id=run_id,
            error=exc,
        )


async def _flush_local_text(run_id: str) -> None:
    buffered = _local_text_buffers.pop(run_id, None)
    if buffered is None or not buffered.content:
        return
    await get_default_event_recorder().record_legacy_step(
        project_id=buffered.project_id,
        run_id=run_id,
        step="decompose_text",
        data={"content": buffered.content},
        created_at=buffered.created_at,
    )


async def _flush_local_text_for_args_fail_open(args) -> None:
    run_id, project_id = _resolve_run_and_project(args)
    if not run_id:
        return
    try:
        await _flush_local_text(run_id)
    except Exception as exc:
        _mark_local_history_degraded(
            project_id=project_id,
            run_id=run_id,
            error=exc,
        )


def _resolve_run_and_project(args) -> tuple[str, str]:
    run_id = _get_task_id(args) or "unknown"
    chat = args[0] if args else None
    project_id = getattr(chat, "project_id", None) or run_id
    return run_id, project_id


def _mark_local_history_degraded(
    *, project_id: str, run_id: str, error: Exception
) -> None:
    error_summary = f"{type(error).__name__}: {error}"
    task_lock = get_task_lock_if_exists(project_id)
    marker = getattr(task_lock, "mark_local_history_degraded", None)
    if callable(marker):
        marker(error_summary)
    logger.exception(
        "RunJournal write failed; continuing Run with degraded local history",
        extra={
            "project_id": project_id,
            "run_id": run_id,
            "journal_error": error_summary,
        },
    )


def _try_sync(args, value, sync_url):
    data = _parse_value(value)
    if not data:
        return

    task_id = _get_task_id(args)
    if not task_id:
        return

    headers = _get_auth_headers(args)
    if headers is None:
        _warn_missing_auth(args)
        return

    step = data.get("step")

    # Batch decompose_text events to reduce API calls
    if step == "decompose_text":
        _buffer_text(task_id, data["data"].get("content", ""))
        if _should_flush(task_id):
            _flush_buffer(task_id, sync_url, headers)
        return

    # Flush any buffered text before sending other events (preserves order)
    if task_id in _text_buffers:
        _flush_buffer(task_id, sync_url, headers)

    payload = {
        "task_id": task_id,
        "step": step,
        "data": data["data"],
        "timestamp": time.time_ns() / 1_000_000_000,
    }

    if task_id not in _logged_first_sync_tasks:
        _logged_first_sync_tasks.add(task_id)
        logger.info(
            "Scheduling first cloud step sync: task_id=%s, step=%s, url=%s",
            task_id,
            step,
            sync_url,
        )

    asyncio.create_task(_send(sync_url, payload, headers))


def _buffer_text(task_id: str, content: str):
    """Accumulate decompose_text content in buffer."""
    if task_id not in _text_buffers:
        _text_buffers[task_id] = ""
    _text_buffers[task_id] += content


def _should_flush(task_id: str) -> bool:
    """Check if buffer has enough words to flush."""
    text = _text_buffers.get(task_id, "")
    word_count = len(text.split())
    return word_count >= BATCH_WORD_THRESHOLD


def _flush_buffer(
    task_id: str,
    sync_url: str,
    headers: dict[str, str],
):
    """Send buffered text and clear buffer."""
    text = _text_buffers.pop(task_id, "")
    if not text:
        return

    payload = {
        "task_id": task_id,
        "step": "decompose_text",
        "data": {"content": text},
        "timestamp": time.time_ns() / 1_000_000_000,
    }

    asyncio.create_task(_send(sync_url, payload, headers))


def _parse_value(value):
    if isinstance(value, str) and value.startswith("data: "):
        value = value[6:].strip()

    try:
        data = json.loads(value)
        if "step" in data and "data" in data:
            return data
    except (json.JSONDecodeError, TypeError):
        pass

    return None


def _get_task_id(args):
    run_context = get_current_run_context()
    if run_context is not None:
        return run_context.run_id

    if not args:
        return None

    chat = args[0]
    # Outside the scoped execution context, only immutable request ownership
    # is accepted. TaskLock.current_task_id is Project-global mutable UI state
    # and can be rebound while a warm generator is still flushing events.
    return getattr(chat, "run_id", None) or getattr(chat, "task_id", None)


def _get_auth_headers(args) -> dict[str, str] | None:
    if len(args) < 2:
        return None

    request = args[1]
    headers = getattr(request, "headers", None)
    if not headers:
        return None

    auth_header = headers.get("authorization")
    if not auth_header:
        return None

    return {"Authorization": auth_header}


def _warn_missing_auth(args) -> None:
    project_id = getattr(args[0], "project_id", None) if args else None
    if not project_id or project_id in _warned_missing_auth_projects:
        return

    _warned_missing_auth_projects.add(project_id)
    logger.info(
        "Skipping cloud step sync because Authorization header is missing "
        "for project_id=%s. Replay will be unavailable for this run.",
        project_id,
    )


def _warn_missing_server_url(args) -> None:
    project_id = getattr(args[0], "project_id", None) if args else None
    if not project_id or project_id in _warned_missing_server_url_projects:
        return

    _warned_missing_server_url_projects.add(project_id)
    logger.info(
        "Skipping cloud step sync because SERVER_URL is empty for "
        "project_id=%s. Replay will be unavailable for this run.",
        project_id,
    )


async def _send(url, data, headers: dict[str, str]):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(url, json=data, headers=headers)
            if response.is_error:
                logger.error(
                    "Failed to sync step to %s: HTTP %s: %s",
                    url,
                    response.status_code,
                    response.text[:500],
                )
    except Exception as e:
        logger.error(f"Failed to sync step to {url}: {type(e).__name__}: {e}")
