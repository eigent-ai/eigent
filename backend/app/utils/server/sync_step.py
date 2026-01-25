"""
Cloud sync step decorator.

Syncs SSE step data to cloud server. Disabled by default.

Config (~/.eigent/.env):
    ENABLE_CLOUD_SYNC=true
    SERVER_URL=https://dev.eigent.ai/api
    SERVER_AUTH_TOKEN=your-token
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


@lru_cache(maxsize=1)
def _get_config():
    enabled = env("ENABLE_CLOUD_SYNC", "false").lower() == "true"
    server_url = env("SERVER_URL", "")
    token = env("SERVER_AUTH_TOKEN", "")
    
    if not enabled or not server_url:
        return None
    
    return {
        "url": f"{server_url.rstrip('/')}/chat/steps",
        "token": token or None
    }


def sync_step(func):
    async def wrapper(*args, **kwargs):
        config = _get_config()
        
        if not config:
            async for value in func(*args, **kwargs):
                yield value
            return
        
        async for value in func(*args, **kwargs):
<<<<<<< Updated upstream
            if not server_url:
                yield value
                continue

            if isinstance(value, str) and value.startswith("data: "):
                value_json_str = value[len("data: ") :].strip()
            else:
                value_json_str = value

            try:
                json_data = json.loads(value_json_str)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON in sync_step: {e}. Value: {value_json_str}")
                yield value
                continue

            if "step" not in json_data or "data" not in json_data:
                logger.error(f"Missing 'step' or 'data' key in sync_step JSON. Keys: {list(json_data.keys())}")
                yield value
                continue

            # Dynamic task_id extraction - prioritize runtime data over static args
            chat: Chat = args[0] if args and hasattr(args[0], 'task_id') else None
            task_id = None

            if chat is not None:
                task_lock = get_task_lock_if_exists(chat.project_id)
                if task_lock is not None:
                    task_id = task_lock.current_task_id \
                        if hasattr(task_lock, 'current_task_id') and task_lock.current_task_id else chat.task_id
                else:
                    logger.warning(f"Task lock not found for project_id {chat.project_id}, using chat.task_id")
                    task_id = chat.task_id

            if task_id:
                # TODO: Filter out unnecessary events to avoid database bloat
                # - Skip "decompose_text" streaming events (sent 50-200+ times per task)
                # - Only sync structural events: decompose_progress, task_state, create_agent, etc.
                # - Consider batching or deduplication for high-frequency events
                # - Extract and add task dependencies for analytics

                asyncio.create_task(
                    send_to_api(
                        sync_url,
                        {
                            "task_id": task_id,
                            "step": json_data["step"],
                            "data": json_data["data"],
                            "timestamp": time.time_ns() / 1_000_000_000,
                        },
                    )
                )
=======
            _try_sync(args, value, config)
>>>>>>> Stashed changes
            yield value
    
    return wrapper


def _try_sync(args, value, config):
    data = _parse_value(value)
    if not data:
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
    
    asyncio.create_task(_send(config["url"], config["token"], payload))


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


async def _send(url, token, data):
    try:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url, json=data, headers=headers)
    except Exception:
        pass
