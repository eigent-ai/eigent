import asyncio
import os
import re
import time
from pathlib import Path
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from utils import traceroot_wrapper as traceroot
from app.component import code
from app.exception.exception import UserException
from app.model.chat import Chat, HumanReply, McpServers, Status, SupplementChat, AddTaskRequest, sse_json
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
    set_current_task_id,
)
from app.component.environment import set_user_env_path
from app.utils.workforce import Workforce
from camel.tasks.task import Task


router = APIRouter()

# Create traceroot logger for chat controller
chat_logger = traceroot.get_logger("chat_controller")

# SSE timeout configuration (10 minutes in seconds)
SSE_TIMEOUT_SECONDS = 10 * 60


async def timeout_stream_wrapper(stream_generator, timeout_seconds: int = SSE_TIMEOUT_SECONDS):
    """
    Wraps a stream generator with timeout handling.

    Closes the SSE connection if no data is received within the timeout period.
    """
    last_data_time = time.time()
    generator = stream_generator.__aiter__()

    try:
        while True:
            elapsed = time.time() - last_data_time
            remaining_timeout = timeout_seconds - elapsed

            try:
                data = await asyncio.wait_for(generator.__anext__(), timeout=remaining_timeout)
                last_data_time = time.time()
                yield data
            except asyncio.TimeoutError:
                chat_logger.warning(f"SSE timeout: No data received for {timeout_seconds} seconds, closing connection")
                # yield sse_json("error", {"message": "Connection timeout: No data received for 10 minutes"})
                # TODO: Temporary change: suppress error signal to frontend on timeout. Needs proper fix later.
                break
            except StopAsyncIteration:
                break

    except asyncio.CancelledError:
        chat_logger.info("Stream cancelled")
        raise
    except Exception as e:
        chat_logger.error(f"Error in stream wrapper: {e}", exc_info=True)
        raise


@router.post("/chat", name="start chat")
@traceroot.trace()
async def post(data: Chat, request: Request):
    chat_logger.info(
        "Starting new chat session", extra={"project_id": data.project_id, "task_id": data.task_id, "user": data.email}
    )
    task_lock = get_or_create_task_lock(data.project_id)

    # Set user-specific environment path for this thread
    set_user_env_path(data.env_path)
    load_dotenv(dotenv_path=data.env_path)

    os.environ["file_save_path"] = data.file_save_path()
    os.environ["browser_port"] = str(data.browser_port)
    os.environ["OPENAI_API_KEY"] = data.api_key
    os.environ["OPENAI_API_BASE_URL"] = data.api_url or "https://api.openai.com/v1"
    os.environ["CAMEL_MODEL_LOG_ENABLED"] = "true"

    # Set user-specific search engine configuration if provided
    if data.search_config:
        for key, value in data.search_config.items():
            if value:  # Only set non-empty values
                os.environ[key] = value
                chat_logger.info(f"Set search config: {key}", extra={"project_id": data.project_id})

    email_sanitized = re.sub(r'[\\/*?:"<>|\s]', "_", data.email.split("@")[0]).strip(".")
    camel_log = (
        Path.home()
        / ".eigent"
        / email_sanitized
        / ("project_" + data.project_id)
        / ("task_" + data.task_id)
        / "camel_logs"
    )
    camel_log.mkdir(parents=True, exist_ok=True)

    os.environ["CAMEL_LOG_DIR"] = str(camel_log)

    if data.is_cloud():
        os.environ["cloud_api_key"] = data.api_key

    # Set the initial current_task_id in task_lock
    set_current_task_id(data.project_id, data.task_id)

    # Put initial action in queue to start processing
    await task_lock.put_queue(ActionImproveData(data=data.question, new_task_id=data.task_id))

    chat_logger.info(
        "Chat session initialized, starting streaming response",
        extra={"project_id": data.project_id, "task_id": data.task_id, "log_dir": str(camel_log)},
    )
    return StreamingResponse(
        timeout_stream_wrapper(step_solve(data, request, task_lock)), media_type="text/event-stream"
    )


@router.post("/chat/{id}", name="improve chat")
@traceroot.trace()
def improve(id: str, data: SupplementChat):
    chat_logger.info("Chat improvement requested", extra={"task_id": id, "question_length": len(data.question)})
    task_lock = get_task_lock(id)

    # Allow continuing conversation even after task is done
    # This supports multi-turn conversation after complex task completion
    if task_lock.status == Status.done:
        # Reset status to allow processing new messages
        task_lock.status = Status.confirming
        # Clear any existing background tasks since workforce was stopped
        if hasattr(task_lock, "background_tasks"):
            task_lock.background_tasks.clear()
        # Note: conversation_history and last_task_result are preserved

        # Log context preservation
        if hasattr(task_lock, "conversation_history"):
            chat_logger.info(f"[CONTEXT] Preserved {len(task_lock.conversation_history)} conversation entries")
        if hasattr(task_lock, "last_task_result"):
            chat_logger.info(f"[CONTEXT] Preserved task result: {len(task_lock.last_task_result)} chars")

    # If task_id is provided, optimistically update file_save_path (will be destroyed if task is not complex)
    # this is because a NEW workforce instance may be created for this task
    new_folder_path = None
    if data.task_id:
        try:
            # Get current environment values needed to construct new path
            current_email = None

            # Extract email from current file_save_path if available
            current_file_save_path = os.environ.get("file_save_path", "")
            if current_file_save_path:
                path_parts = Path(current_file_save_path).parts
                if len(path_parts) >= 3 and "eigent" in path_parts:
                    eigent_index = path_parts.index("eigent")
                    if eigent_index + 1 < len(path_parts):
                        current_email = path_parts[eigent_index + 1]

            # If we have the necessary information, update the file_save_path
            if current_email and id:
                # Create new path using the existing pattern: email/project_{project_id}/task_{task_id}
                new_folder_path = Path.home() / "eigent" / current_email / f"project_{id}" / f"task_{data.task_id}"
                new_folder_path.mkdir(parents=True, exist_ok=True)
                os.environ["file_save_path"] = str(new_folder_path)
                chat_logger.info(f"Updated file_save_path to: {new_folder_path}")

                # Store the new folder path in task_lock for potential cleanup and persistence
                task_lock.new_folder_path = new_folder_path
            else:
                chat_logger.warning(f"Could not update file_save_path - email: {current_email}, project_id: {id}")

        except Exception as e:
            chat_logger.error(f"Error updating file path for project_id: {id}, task_id: {data.task_id}: {e}")

    asyncio.run(task_lock.put_queue(ActionImproveData(data=data.question, new_task_id=data.task_id)))
    chat_logger.info("Improvement request queued with preserved context", extra={"project_id": id})
    return Response(status_code=201)


@router.put("/chat/{id}", name="supplement task")
@traceroot.trace()
def supplement(id: str, data: SupplementChat):
    chat_logger.info("Chat supplement requested", extra={"task_id": id})
    task_lock = get_task_lock(id)
    if task_lock.status != Status.done:
        raise UserException(code.error, "Please wait task done")
    asyncio.run(task_lock.put_queue(ActionSupplementData(data=data)))
    chat_logger.debug("Supplement data queued", extra={"task_id": id})
    return Response(status_code=201)


@router.delete("/chat/{id}", name="stop chat")
@traceroot.trace()
def stop(id: str):
    """stop the task"""
    chat_logger.info("=" * 80)
    chat_logger.info("🛑 [STOP-BUTTON] DELETE /chat/{id} request received from frontend")
    chat_logger.info(f"[STOP-BUTTON] project_id/task_id: {id}")
    chat_logger.info("=" * 80)
    try:
        task_lock = get_task_lock(id)
        chat_logger.info(f"[STOP-BUTTON] Task lock retrieved, task_lock.id: {task_lock.id}, task_lock.status: {task_lock.status}")
        chat_logger.info(f"[STOP-BUTTON] Queueing ActionStopData(Action.stop) to task_lock queue")
        asyncio.run(task_lock.put_queue(ActionStopData(action=Action.stop)))
        chat_logger.info(f"[STOP-BUTTON] ✅ ActionStopData queued successfully, this will trigger workforce.stop_gracefully()")
    except Exception as e:
        # Task lock may not exist if task is already finished or never started
        chat_logger.warning(f"[STOP-BUTTON] ⚠️  Task lock not found or already stopped, task_id: {id}, error: {str(e)}")
    return Response(status_code=204)


@router.post("/chat/{id}/human-reply")
@traceroot.trace()
def human_reply(id: str, data: HumanReply):
    chat_logger.info("Human reply received", extra={"task_id": id, "reply_length": len(data.reply)})
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_human_input(data.agent, data.reply))
    chat_logger.debug("Human reply processed", extra={"task_id": id})
    return Response(status_code=201)


@router.post("/chat/{id}/install-mcp")
@traceroot.trace()
def install_mcp(id: str, data: McpServers):
    chat_logger.info("Installing MCP servers", extra={"task_id": id, "servers_count": len(data.get("mcpServers", {}))})
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_queue(ActionInstallMcpData(action=Action.install_mcp, data=data)))
    chat_logger.info("MCP installation queued", extra={"task_id": id})
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
            insert_position=data.insert_position,
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
    """
    Skip/Stop current task execution while preserving context.
    This endpoint is called when user clicks the Stop button.

    Behavior:
    - Stops workforce gracefully
    - Marks task as done
    - Preserves conversation_history and last_task_result in task_lock
    - Sends 'end' event to frontend
    - Keeps SSE connection alive for multi-turn conversation
    """
    chat_logger.info("=" * 80)
    chat_logger.info(f"🛑 [STOP-BUTTON] SKIP-TASK request received from frontend (User clicked Stop)")
    chat_logger.info(f"[STOP-BUTTON] project_id: {project_id}")
    chat_logger.info("=" * 80)
    task_lock = get_task_lock(project_id)
    chat_logger.info(f"[STOP-BUTTON] Task lock retrieved, task_lock.id: {task_lock.id}, task_lock.status: {task_lock.status}")

    try:
        # Queue the skip task action - this will preserve context for multi-turn
        skip_task_action = ActionSkipTaskData(project_id=project_id)
        chat_logger.info(f"[STOP-BUTTON] Queueing ActionSkipTaskData (preserves context, marks as done)")
        asyncio.run(task_lock.put_queue(skip_task_action))

        chat_logger.info(f"[STOP-BUTTON] ✅ Skip request queued - task will stop gracefully and preserve context")
        return Response(status_code=201)

    except Exception as e:
        chat_logger.error(f"[STOP-BUTTON] ❌ Error skipping task for project_id: {project_id}: {e}")
        raise UserException(code.error, f"Failed to skip task: {str(e)}")
