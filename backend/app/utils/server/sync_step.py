"""
Cloud sync step decorator.

Syncs SSE step data to cloud server when SERVER_URL is configured.
High-frequency events (decompose_text) are filtered to reduce database bloat.

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


# High-frequency events to skip (reduces database bloat and API load)
SKIP_EVENTS = {"decompose_text"}


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
    
    # Skip high-frequency events to reduce database bloat
    if data.get("step") in SKIP_EVENTS:
        return
    
    task_id = _get_task_id(args)
    if not task_id:
        return
    
    payload = {
        "task_id": task_id,
        "step": data["step"],
        "data": data["data"],
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
