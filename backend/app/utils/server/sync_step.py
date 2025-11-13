import time
import httpx
import asyncio
import os
import json
from app.service.chat_service import Chat
from app.component.environment import env
from app.service.task import get_task_lock_if_exists
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("sync_step")


def sync_step(func):
    async def wrapper(*args, **kwargs):
        server_url = env("SERVER_URL")
        sync_url = server_url + "/chat/steps" if server_url else None
        async for value in func(*args, **kwargs):
            if not server_url:
                yield value
                continue

            if isinstance(value, str) and value.startswith("data: "):
                value_json_str = value[len("data: ") :].strip()
            else:
                value_json_str = value
            json_data = json.loads(value_json_str)
            
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
            yield value

    return wrapper


async def send_to_api(url, data):
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(url, json=data)
            # logger.info(res)
        except Exception as e:
            logger.error(e)
