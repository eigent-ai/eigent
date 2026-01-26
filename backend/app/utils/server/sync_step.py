"""
Cloud sync step decorator.

Syncs SSE step data to cloud server when SERVER_URL is configured.
High-frequency events (decompose_text) are batched to reduce API calls.

Config (~/.eigent/.env):
    SERVER_URL=https://dev.eigent.ai/api
"""

import asyncio
import json
import time
from functools import lru_cache

import httpx

from app.component.environment import env
from app.service.task import get_task_lock_if_exists
import logging

logger = logging.getLogger("sync_step")


# Batch config for decompose_text events
BATCH_WORD_THRESHOLD = 5

# Buffer storage: task_id -> accumulated text
_text_buffers: dict[str, str] = {}


@lru_cache(maxsize=1)
def _get_config():
    server_url = env("SERVER_URL", "")
    
    if not server_url:
        return None
    
    return f"{server_url.rstrip('/')}/chat/steps"


def sync_step(func):
    async def wrapper(*args, **kwargs):
        config = _get_config()
        
        if not config:
            async for value in func(*args, **kwargs):
                yield value
            return
        
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
    
    step = data.get("step")
    
    # Batch decompose_text events to reduce API calls
    if step == "decompose_text":
        _buffer_text(task_id, data["data"].get("content", ""))
        if _should_flush(task_id):
            _flush_buffer(task_id, sync_url)
        return
    
    # Flush any buffered text before sending other events (preserves order)
    if task_id in _text_buffers:
        _flush_buffer(task_id, sync_url)
    
    payload = {
        "task_id": task_id,
        "step": step,
        "data": data["data"],
        "timestamp": time.time_ns() / 1_000_000_000,
    }
    
    asyncio.create_task(_send(sync_url, payload))


def _buffer_text(task_id: str, content: str):
    """Accumulate decompose_text content in buffer."""
    if task_id not in _text_buffers:
        _text_buffers[task_id] = ""
    _text_buffers[task_id] = content


def _should_flush(task_id: str) -> bool:
    """Check if buffer has enough words to flush."""
    text = _text_buffers.get(task_id, "")
    word_count = len(text.split())
    return word_count >= BATCH_WORD_THRESHOLD


def _flush_buffer(task_id: str, sync_url: str):
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


def _get_task_id(args):
    if not args or not hasattr(args[0], "task_id"):
        return None
    
    chat = args[0]
    task_lock = get_task_lock_if_exists(chat.project_id)
    
    if task_lock and getattr(task_lock, "current_task_id", None):
        return task_lock.current_task_id
    
    return chat.task_id


async def _send(url, data):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url, json=data)
    except Exception:
        pass
