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
from app.model.chat import Chat, HumanReply, McpServers, Status, SupplementChat, AddTaskRequest
from app.service.chat_service import step_solve
from app.service.task import (
    Action,
    ActionImproveData,
    ActionInstallMcpData,
    ActionStopData,
    ActionSupplementData,
    ActionAddTaskData,
    ActionRemoveTaskData,
    ActionSkipTaskData,
    get_or_create_task_lock,
    get_task_lock,
)
from app.component.environment import set_user_env_path
from app.utils.workforce import Workforce
from camel.tasks.task import Task


router = APIRouter(tags=["chat"])

# Create traceroot logger for chat controller
chat_logger = traceroot.get_logger('chat_controller')


@router.post("/chat", name="start chat")
@traceroot.trace()
async def post(data: Chat, request: Request):
    chat_logger.info(f"Starting new chat session for project_id: {data.project_id}, user: {data.email}")
    task_lock = get_or_create_task_lock(data.project_id)
    
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
    camel_log = Path.home() / ".eigent" / email / ("task_" + data.project_id) / "camel_logs"
    camel_log.mkdir(parents=True, exist_ok=True)

    os.environ["CAMEL_LOG_DIR"] = str(camel_log)

    if data.is_cloud():
        os.environ["cloud_api_key"] = data.api_key
    
    # Put initial action in queue to start processing
    await task_lock.put_queue(ActionImproveData(data=data.question))
    
    chat_logger.info(f"Chat session initialized, starting streaming response for project_id: {data.project_id}")
    return StreamingResponse(step_solve(data, request, task_lock), media_type="text/event-stream")


@router.post("/chat/{id}", name="improve chat")
@traceroot.trace()
def improve(id: str, data: SupplementChat):
    chat_logger.info(f"Improving chat for task_id: {id} with question: {data.question}")
    task_lock = get_task_lock(id)

    # Allow continuing conversation even after task is done
    # This supports multi-turn conversation after complex task completion
    if task_lock.status == Status.done:
        # Reset status to allow processing new messages
        task_lock.status = Status.confirming
        # Clear any existing background tasks since workforce was stopped
        if hasattr(task_lock, 'background_tasks'):
            task_lock.background_tasks.clear()
        # Note: conversation_history and last_task_result are preserved

        # Log context preservation
        if hasattr(task_lock, 'conversation_history'):
            chat_logger.info(f"[CONTEXT] Preserved {len(task_lock.conversation_history)} conversation entries")
        if hasattr(task_lock, 'last_task_result'):
            chat_logger.info(f"[CONTEXT] Preserved task result: {len(task_lock.last_task_result)} chars")

    asyncio.run(task_lock.put_queue(ActionImproveData(data=data.question)))
    chat_logger.info(f"Improvement request queued with preserved context")
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


@router.post("/chat/{id}/add-task", name="add task to workforce")
@traceroot.trace()
def add_task(id: str, data: AddTaskRequest):
    """Add a new task to the workforce"""
    chat_logger.info(f"Adding task to workforce for task_id: {id}, content: {data.content[:100]}...")
    task_lock = get_task_lock(id)
    
    try:
        # Queue the add task action
        add_task_action = ActionAddTaskData(
            content=data.content,
            project_id=data.project_id,
            task_id=data.task_id,
            additional_info=data.additional_info,
            insert_position=data.insert_position
        )
        asyncio.run(task_lock.put_queue(add_task_action))
        return Response(status_code=201)
        
    except Exception as e:
        chat_logger.error(f"Error adding task for task_id: {id}: {e}")
        raise UserException(code.error, f"Failed to add task: {str(e)}")


@router.delete("/chat/{project_id}/remove-task/{task_id}", name="remove task from workforce")
@traceroot.trace()
def remove_task(project_id: str, task_id: str):
    """Remove a task from the workforce"""
    chat_logger.info(f"Removing task {task_id} from workforce for project_id: {project_id}")
    task_lock = get_task_lock(project_id)
    
    try:
        # Queue the remove task action
        remove_task_action = ActionRemoveTaskData(task_id=task_id, project_id=project_id)
        asyncio.run(task_lock.put_queue(remove_task_action))

        chat_logger.info(f"Task removal request queued for project_id: {project_id}, removing task: {task_id}")
        return Response(status_code=204)
            
    except Exception as e:
        chat_logger.error(f"Error removing task {task_id} for project_id: {project_id}: {e}")
        raise UserException(code.error, f"Failed to remove task: {str(e)}")


@router.post("/chat/{project_id}/skip-task", name="skip task in workforce")
@traceroot.trace()
def skip_task(project_id: str):
    """Skip a task in the workforce"""
    chat_logger.info(f"Skipping task in workforce for project_id: {project_id}")
    task_lock = get_task_lock(project_id)
    
    try:
        # Queue the skip task action
        skip_task_action = ActionSkipTaskData(project_id=project_id)
        asyncio.run(task_lock.put_queue(skip_task_action))

        chat_logger.info(f"Task skip request queued for project_id: {project_id}")
        return Response(status_code=201)
            
    except Exception as e:
        chat_logger.error(f"Error skipping task for project_id: {project_id}: {e}")
        raise UserException(code.error, f"Failed to skip task: {str(e)}")
