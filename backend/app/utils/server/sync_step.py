import time
import httpx
import asyncio
import os
import json
from app.service.chat_service import Chat
from app.component.environment import env
from utils import traceroot_wrapper as traceroot
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

logger = traceroot.get_logger("sync_step")
tracer = trace.get_tracer(__name__)


def sync_step(func):
    async def wrapper(*args, **kwargs):
        # Extract chat info for span attributes
        chat: Chat = args[0] if args else None
        span_attributes = {}
        if chat is not None:
            span_attributes["project_id"] = chat.project_id
            span_attributes["task_id"] = chat.task_id

        # Start span manually and make it current so child spans can link to it
        span = tracer.start_span(f"{func.__name__}_streaming", attributes=span_attributes)
        ctx = trace.set_span_in_context(span)
        token = trace.attach(ctx)

        try:
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

            # Mark span as successful
            span.set_status(Status(StatusCode.OK))
        except Exception as e:
            # Record exception and mark span as error
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            logger.error(f"Error in sync_step wrapper: {e}")
            raise
        finally:
            # Detach context and end the span when streaming completes
            trace.detach(token)
            span.end()

    return wrapper


async def send_to_api(url, data):
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(url, json=data)
            # logger.info(res)
        except Exception as e:
            logger.error(e)
