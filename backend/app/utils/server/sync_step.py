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

import httpx

from app.component.environment import env
from app.service.task import get_task_lock_if_exists

logger = logging.getLogger("sync_step")

# Batch config for decompose_text events
BATCH_WORD_THRESHOLD = 5

# Buffer storage: task_id -> accumulated text
_text_buffers: dict[str, str] = {}
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


def _get_config(args):
    server_url = (
        getattr(args[0], "server_url", None)
        if args and hasattr(args[0], "server_url")
        else None
    )

    if not server_url:
        server_url = env("SERVER_URL", "")

    server_url = _normalize_server_url(server_url)

    if not server_url:
        return None

    return f"{server_url}/chat/steps"


def sync_step(func):
    async def wrapper(*args, **kwargs):
        config = _get_config(args)

        if not config:
            _warn_missing_server_url(args)
            async for value in func(*args, **kwargs):
                yield value
            return

        if config not in _logged_sync_targets:
            _logged_sync_targets.add(config)
            logger.info("Cloud step sync enabled: %s", config)

        async for value in func(*args, **kwargs):
            _try_sync(args, value, config)
            yield value

    return wrapper


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
