import asyncio
import os
import re
from pathlib import Path
from dotenv import load_dotenv
from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from loguru import logger
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


router = APIRouter(tags=["chat"])


@router.post("/chat", name="start chat")
def post(data: Chat, request: Request):
    task_lock = create_task_lock(data.task_id)
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
    return StreamingResponse(step_solve(data, request, task_lock), media_type="text/event-stream")


@router.post("/chat/{id}", name="improve chat")
def improve(id: str, data: SupplementChat):
    task_lock = get_task_lock(id)
    if task_lock.status == Status.done:
        raise UserException(code.error, "Task was done")
    asyncio.run(task_lock.put_queue(ActionImproveData(data=data.question)))
    return Response(status_code=201)


@router.put("/chat/{id}", name="supplement task")
def supplement(id: str, data: SupplementChat):
    task_lock = get_task_lock(id)
    if task_lock.status != Status.done:
        raise UserException(code.error, "Please wait task done")
    asyncio.run(task_lock.put_queue(ActionSupplementData(data=data)))
    return Response(status_code=201)


@router.delete("/chat/{id}", name="stop chat")
def stop(id: str):
    """stop the task"""
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_queue(ActionStopData(action=Action.stop)))
    return Response(status_code=204)


@router.post("/chat/{id}/human-reply")
def human_reply(id: str, data: HumanReply):
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_human_input(data.agent, data.reply))
    return Response(status_code=201)


@router.post("/chat/{id}/install-mcp")
def install_mcp(id: str, data: McpServers):
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_queue(ActionInstallMcpData(action=Action.install_mcp, data=data)))
    return Response(status_code=201)
