import time
import httpx
import asyncio
import os
import json
from app.service.chat_service import Chat
from app.component.environment import env
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
            chat: Chat = args[0] if args else None
            if chat is not None:
                asyncio.create_task(
                    send_to_api(
                        sync_url,
                        {
                            # TODO: revert to task_id to support multi-task project replay
                            # "task_id": chat.task_id,
                            "task_id": chat.project_id,
                            "step": json_data["step"],
                            "data": json_data["data"],
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
