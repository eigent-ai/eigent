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

Persists outgoing SSE step data to the local SQLite event log.
When SERVER_URL is configured, the same step data can also be
forwarded to the cloud server in batches.

Config (~/.eigent/.env):
    SERVER_URL=https://dev.eigent.ai/api
"""

import asyncio
import json
import logging
import time
from functools import lru_cache

import httpx

from app.component.environment import env
from app.event_store.config import get_event_db_path
from app.event_store.sqlite_store import SQLiteTranscriptStore
from app.service.task import get_task_lock_if_exists

logger = logging.getLogger("sync_step")

# Batch config for decompose_text events
BATCH_WORD_THRESHOLD = 5

# Buffer storage: task_id -> accumulated text
_text_buffers: dict[str, str] = {}


@lru_cache(maxsize=1)
def _get_sync_url():
    server_url = env("SERVER_URL", "")

    if not server_url:
        return None

    return f"{server_url.rstrip('/')}/chat/steps"


def sync_step(func):
    async def wrapper(*args, **kwargs):
        sync_url = _get_sync_url()

        try:
            async for value in func(*args, **kwargs):
                _record_step(args, value, sync_url)
                yield value
        finally:
            run_id = _get_run_id(args)
            if run_id in _text_buffers:
                _flush_buffer(args, run_id, sync_url)

    return wrapper


def _record_step(args, value, sync_url):
    data = _parse_value(value)
    if not data:
        return

    run_id = _get_run_id(args)
    if not run_id:
        return

    step = data.get("step")

    # Batch decompose_text events to reduce event volume.
    if step == "decompose_text":
        _buffer_text(run_id, data["data"].get("content", ""))
        if _should_flush(run_id):
            _flush_buffer(args, run_id, sync_url)
        return

    # Flush any buffered text before sending other events.
    if run_id in _text_buffers:
        _flush_buffer(args, run_id, sync_url)

    _persist_local_event(args, run_id, step, data["data"])

    if not sync_url:
        return

    payload = {
        "task_id": _get_current_task_id(args, data["data"]),
        "step": step,
        "data": data["data"],
        "timestamp": time.time_ns() / 1_000_000_000,
    }

    asyncio.create_task(_send(sync_url, payload))


def _buffer_text(run_id: str, content: str):
    """Accumulate decompose_text content in buffer."""
    if run_id not in _text_buffers:
        _text_buffers[run_id] = ""
    _text_buffers[run_id] += content


def _should_flush(run_id: str) -> bool:
    """Check if buffer has enough words to flush."""
    text = _text_buffers.get(run_id, "")
    word_count = len(text.split())
    return word_count >= BATCH_WORD_THRESHOLD


def _flush_buffer(args, run_id: str, sync_url: str | None):
    """Send buffered text and clear buffer."""
    text = _text_buffers.pop(run_id, "")
    if not text:
        return

    data = {"content": text}
    _persist_local_event(args, run_id, "decompose_text", data)

    if not sync_url:
        return

    payload = {
        "task_id": _get_current_task_id(args, data),
        "step": "decompose_text",
        "data": data,
        "timestamp": time.time_ns() / 1_000_000_000,
    }

    asyncio.create_task(_send(sync_url, payload))


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


def _get_run_id(args):
    if not args or not hasattr(args[0], "task_id"):
        return None

    return getattr(args[0], "task_id", None)


def _get_current_task_id(args, payload=None):
    payload = payload if isinstance(payload, dict) else {}
    if task_id := payload.get("task_id") or payload.get("process_task_id"):
        return task_id

    if not args or not hasattr(args[0], "task_id"):
        return None

    chat = args[0]
    task_lock = get_task_lock_if_exists(chat.project_id)

    if task_lock and getattr(task_lock, "current_task_id", None):
        return task_lock.current_task_id

    if not task_lock:
        logger.warning(
            f"Task lock not found for project_id {chat.project_id}, "
            f"using chat.task_id"
        )

    return chat.task_id


def _persist_local_event(args, run_id: str, step: str, payload):
    if not args or not hasattr(args[0], "project_id"):
        return

    chat = args[0]
    try:
        SQLiteTranscriptStore.append_event(
            get_event_db_path(),
            run_id=run_id,
            project_id=chat.project_id,
            task_id=_get_current_task_id(args, payload),
            event_type=step,
            payload=payload,
            source="eigent_sse",
            agent_id=_extract_agent_id(payload),
            agent_name=_extract_agent_name(payload),
        )
    except Exception as e:
        logger.warning(
            f"Failed to persist local step event {step}: "
            f"{type(e).__name__}: {e}"
        )


def _extract_agent_id(payload) -> str | None:
    if not isinstance(payload, dict):
        return None
    return (
        payload.get("agent_id")
        or payload.get("assignee_id")
        or payload.get("worker_id")
    )


def _extract_agent_name(payload) -> str | None:
    if not isinstance(payload, dict):
        return None
    return payload.get("agent_name") or payload.get("role")


async def _send(url, data):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url, json=data)
    except Exception as e:
        logger.error(f"Failed to sync step to {url}: {type(e).__name__}: {e}")
