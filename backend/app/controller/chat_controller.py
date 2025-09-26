import asyncio
import os
import re
from pathlib import Path
from dotenv import load_dotenv
from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from loguru import logger
from app.utils import traceroot_wrapper as traceroot
from app.component import code
from app.exception.exception import UserException
from app.model.chat import Chat, HumanReply, McpServers, Status, SupplementChat
from app.service.chat_service import step_solve
from app.service.task import (
    Action,
    ActionImproveData,
    ActionInstallMcpData,
    ActionStopData,
    ActionSupplementData,
    create_task_lock,
    get_task_lock,
)
from app.component.environment import set_user_env_path


router = APIRouter(tags=["chat"])

# Create traceroot logger for chat controller
chat_logger = traceroot.get_logger('chat_controller')


@router.post("/chat", name="start chat")
@traceroot.trace()
async def post(data: Chat, request: Request):
    chat_logger.info(f"Starting new chat session for task_id: {data.task_id}, user: {data.email}")
    task_lock = create_task_lock(data.task_id)
    
    # Set user-specific environment path for this thread
    set_user_env_path(data.env_path)
    load_dotenv(dotenv_path=data.env_path)

    # logger.debug(f"start chat: {data.model_dump_json()}")

    os.environ["file_save_path"] = data.file_save_path()
    os.environ["browser_port"] = str(data.browser_port)
    os.environ["OPENAI_API_KEY"] = data.api_key
    os.environ["OPENAI_API_BASE_URL"] = data.api_url or "https://api.openai.com/v1"
    os.environ["CAMEL_MODEL_LOG_ENABLED"] = "true"

    email = re.sub(r'[\\/*?:"<>|\s]', "_", data.email.split("@")[0]).strip(".")
    camel_log = Path.home() / ".eigent" / email / ("task_" + data.task_id) / "camel_logs"
    camel_log.mkdir(parents=True, exist_ok=True)

    os.environ["CAMEL_LOG_DIR"] = str(camel_log)

    if data.is_cloud():
        os.environ["cloud_api_key"] = data.api_key
    
    chat_logger.info(f"Chat session initialized, starting streaming response for task_id: {data.task_id}")
    return StreamingResponse(step_solve(data, request, task_lock), media_type="text/event-stream")


@router.post("/chat/{id}", name="improve chat")
@traceroot.trace()
def improve(id: str, data: SupplementChat):
    chat_logger.info(f"Improving chat for task_id: {id} with question: {data.question}")
    task_lock = get_task_lock(id)
    if task_lock.status == Status.done:
        raise UserException(code.error, "Task was done")
    asyncio.run(task_lock.put_queue(ActionImproveData(data=data.question)))
    chat_logger.info(f"Improvement request queued for task_id: {id}")
    return Response(status_code=201)


@router.put("/chat/{id}", name="supplement task")
@traceroot.trace()
def supplement(id: str, data: SupplementChat):
    chat_logger.info(f"Supplementing task_id: {id} with additional data")
    task_lock = get_task_lock(id)
    if task_lock.status != Status.done:
        raise UserException(code.error, "Please wait task done")
    asyncio.run(task_lock.put_queue(ActionSupplementData(data=data)))
    chat_logger.info(f"Supplement data queued for task_id: {id}")
    return Response(status_code=201)


@router.delete("/chat/{id}", name="stop chat")
@traceroot.trace()
def stop(id: str):
    """stop the task"""
    chat_logger.warning(f"Stopping chat session for task_id: {id}")
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_queue(ActionStopData(action=Action.stop)))
    chat_logger.info(f"Stop signal sent for task_id: {id}")
    return Response(status_code=204)


@router.post("/chat/{id}/human-reply")
@traceroot.trace()
def human_reply(id: str, data: HumanReply):
    chat_logger.info(f"Human reply received for task_id: {id}, agent: {data.agent}")
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_human_input(data.agent, data.reply))
    chat_logger.info(f"Human reply processed for task_id: {id}")
    return Response(status_code=201)


@router.post("/chat/{id}/install-mcp")
@traceroot.trace()
def install_mcp(id: str, data: McpServers):
    chat_logger.info(f"Installing MCP servers for task_id: {id}, servers count: {len(data.get('mcpServers', {}))}")
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_queue(ActionInstallMcpData(action=Action.install_mcp, data=data)))
    chat_logger.info(f"MCP installation queued for task_id: {id}")
    return Response(status_code=201)
