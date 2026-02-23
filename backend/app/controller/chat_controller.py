# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import asyncio
import logging
import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse

from app.component import code
from app.component.environment import sanitize_env_path, set_user_env_path
from app.exception.exception import UserException
from app.model.chat import (
    AddTaskRequest,
    ApprovalRequest,
    Chat,
    HumanReply,
    McpServers,
    Status,
    SupplementChat,
    sse_json,
)
from app.service.chat_service import step_solve
from app.service.task import (
    Action,
    ActionAddTaskData,
    ActionImproveData,
    ActionInstallMcpData,
    ActionRemoveTaskData,
    ActionSkipTaskData,
    ActionStopData,
    ActionSupplementData,
    ImprovePayload,
    delete_task_lock,
    get_or_create_task_lock,
    get_task_lock,
    set_current_task_id,
    task_locks,
)

router = APIRouter()

# Logger for chat controller
chat_logger = logging.getLogger("chat_controller")

# SSE timeout configuration (60 minutes in seconds)
SSE_TIMEOUT_SECONDS = 60 * 60


async def _cleanup_task_lock_safe(task_lock, reason: str) -> bool:
    """Safely cleanup task lock with existence check.

    Args:
        task_lock: The task lock to cleanup
        reason: Reason for cleanup (for logging)

    Returns:
        True if cleanup was performed, False otherwise
    """
    if not task_lock:
        return False

    # Check if task_lock still exists before attempting cleanup
    if task_lock.id not in task_locks:
        chat_logger.debug(
            f"[{reason}] Task lock already removed, skipping cleanup",
            extra={"task_id": task_lock.id},
        )
        return False

    try:
        task_lock.status = Status.done
        await delete_task_lock(task_lock.id)
        chat_logger.info(
            f"[{reason}] Task lock cleanup completed",
            extra={"task_id": task_lock.id},
        )
        return True
    except Exception as e:
        chat_logger.error(
            f"[{reason}] Failed to cleanup task lock",
            extra={"task_id": task_lock.id, "error": str(e)},
            exc_info=True,
        )
        return False


async def timeout_stream_wrapper(
    stream_generator,
    timeout_seconds: int = SSE_TIMEOUT_SECONDS,
    task_lock=None,
):
    """Wraps a stream generator with timeout handling.

    Closes the SSE connection if no data is received within the timeout period.
    Triggers cleanup if timeout occurs to prevent resource leaks.
    """
    last_data_time = time.time()
    generator = stream_generator.__aiter__()
    cleanup_triggered = False

    try:
        while True:
            elapsed = time.time() - last_data_time
            remaining_timeout = timeout_seconds - elapsed

            try:
                data = await asyncio.wait_for(
                    generator.__anext__(), timeout=remaining_timeout
                )
                last_data_time = time.time()
                yield data
            except TimeoutError:
                chat_logger.warning(
                    "SSE timeout: No data received, closing connection",
                    extra={"timeout_seconds": timeout_seconds},
                )
                timeout_min = timeout_seconds // 60
                yield sse_json(
                    "error",
                    {
                        "message": "Connection timeout: No data"
                        f" received for {timeout_min}"
                        " minutes"
                    },
                )
                cleanup_triggered = await _cleanup_task_lock_safe(
                    task_lock, "TIMEOUT"
                )
                break
            except StopAsyncIteration:
                break

    except asyncio.CancelledError:
        chat_logger.info(
            "[STREAM-CANCELLED] Stream cancelled, triggering cleanup"
        )
        if not cleanup_triggered:
            await _cleanup_task_lock_safe(task_lock, "CANCELLED")
        raise
    except Exception as e:
        chat_logger.error(
            "[STREAM-ERROR] Unexpected error in stream wrapper",
            extra={"error": str(e)},
            exc_info=True,
        )
        if not cleanup_triggered:
            await _cleanup_task_lock_safe(task_lock, "ERROR")
        raise


@router.post("/chat", name="start chat")
async def post(data: Chat, request: Request):
    chat_logger.info(
        "Starting new chat session",
        extra={
            "project_id": data.project_id,
            "task_id": data.task_id,
            "user": data.email,
        },
    )

    task_lock = get_or_create_task_lock(data.project_id)
    task_lock.hitl_options = data.hitl_options

    # Set user-specific environment path for this thread
    set_user_env_path(data.env_path)
    # Load environment with validated path
    safe_env_path = sanitize_env_path(data.env_path)
    if safe_env_path:
        load_dotenv(dotenv_path=safe_env_path)

    os.environ["file_save_path"] = data.file_save_path()
    os.environ["browser_port"] = str(data.browser_port)
    os.environ["OPENAI_API_KEY"] = data.api_key
    os.environ["OPENAI_API_BASE_URL"] = (
        data.api_url or "https://api.openai.com/v1"
    )
    os.environ["CAMEL_MODEL_LOG_ENABLED"] = "true"

    # Set user-specific search engine configuration if provided
    if data.search_config:
        for key, value in data.search_config.items():
            if value:
                os.environ[key] = value
                chat_logger.debug(
                    f"Set search config: {key}",
                    extra={"project_id": data.project_id},
                )

    email_sanitized = re.sub(
        r'[\\/*?:"<>|\s]', "_", data.email.split("@")[0]
    ).strip(".")
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
    await task_lock.put_queue(
        ActionImproveData(
            data=ImprovePayload(
                question=data.question,
                attaches=data.attaches or [],
            ),
            new_task_id=data.task_id,
        )
    )

    chat_logger.info(
        "Chat session initialized",
        extra={
            "project_id": data.project_id,
            "task_id": data.task_id,
            "log_dir": str(camel_log),
        },
    )
    return StreamingResponse(
        timeout_stream_wrapper(
            step_solve(data, request, task_lock), task_lock=task_lock
        ),
        media_type="text/event-stream",
    )


@router.post("/chat/{id}", name="improve chat")
def improve(id: str, data: SupplementChat):
    chat_logger.info(
        "Chat improvement requested",
        extra={"task_id": id, "question_length": len(data.question)},
    )
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
            hist_len = len(task_lock.conversation_history)
            chat_logger.info(
                f"[CONTEXT] Preserved {hist_len} conversation entries"
            )
        if hasattr(task_lock, "last_task_result"):
            result_len = len(task_lock.last_task_result)
            chat_logger.info(
                f"[CONTEXT] Preserved task result: {result_len} chars"
            )

    # If task_id is provided, optimistically update
    # file_save_path (will be destroyed if task is
    # not complex)
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

            # If we have the necessary info, update
            # the file_save_path
            if current_email and id:
                # Create new path using the existing
                # pattern: email/project_{id}/task_{id}
                new_folder_path = (
                    Path.home()
                    / "eigent"
                    / current_email
                    / f"project_{id}"
                    / f"task_{data.task_id}"
                )
                new_folder_path.mkdir(parents=True, exist_ok=True)
                os.environ["file_save_path"] = str(new_folder_path)
                chat_logger.info(
                    f"Updated file_save_path to: {new_folder_path}"
                )

                # Store the new folder path in task_lock
                # for potential cleanup and persistence
                task_lock.new_folder_path = new_folder_path
            else:
                chat_logger.warning(
                    "Could not update"
                    " file_save_path -"
                    f" email: {current_email},"
                    f" project_id: {id}"
                )

        except Exception as e:
            chat_logger.error(
                "Error updating file path for"
                f" project_id: {id},"
                f" task_id: {data.task_id}:"
                f" {e}"
            )

    asyncio.run(
        task_lock.put_queue(
            ActionImproveData(
                data=ImprovePayload(
                    question=data.question,
                    attaches=data.attaches or [],
                ),
                new_task_id=data.task_id,
            )
        )
    )
    chat_logger.info(
        "Improvement request queued with preserved context",
        extra={"project_id": id},
    )
    return Response(status_code=201)


@router.put("/chat/{id}", name="supplement task")
def supplement(id: str, data: SupplementChat):
    chat_logger.info("Chat supplement requested", extra={"task_id": id})
    task_lock = get_task_lock(id)
    if task_lock.status != Status.done:
        raise UserException(code.error, "Please wait task done")
    asyncio.run(task_lock.put_queue(ActionSupplementData(data=data)))
    chat_logger.debug("Supplement data queued", extra={"task_id": id})
    return Response(status_code=201)


@router.delete("/chat/{id}", name="stop chat")
def stop(id: str):
    """stop the task"""
    chat_logger.info("=" * 80)
    chat_logger.info(
        "🛑 [STOP-BUTTON] DELETE /chat/{id} request received from frontend"
    )
    chat_logger.info(f"[STOP-BUTTON] project_id/task_id: {id}")
    chat_logger.info("=" * 80)
    try:
        task_lock = get_task_lock(id)
        chat_logger.info(
            "[STOP-BUTTON] Task lock retrieved,"
            f" task_lock.id: {task_lock.id},"
            f" task_lock.status: {task_lock.status}"
        )
        chat_logger.info(
            "[STOP-BUTTON] Queueing"
            " ActionStopData(Action.stop)"
            " to task_lock queue"
        )
        asyncio.run(task_lock.put_queue(ActionStopData(action=Action.stop)))
        chat_logger.info(
            "[STOP-BUTTON] ActionStopData queued"
            " successfully, this will trigger"
            " workforce.stop_gracefully()"
        )
    except Exception as e:
        # Task lock may not exist if task is already
        # finished or never started
        chat_logger.warning(
            "[STOP-BUTTON] Task lock not found"
            " or already stopped,"
            f" task_id: {id},"
            f" error: {str(e)}"
        )
    return Response(status_code=204)


@router.post("/chat/{id}/human-reply")
def human_reply(id: str, data: HumanReply):
    chat_logger.info(
        "Human reply received",
        extra={"task_id": id, "reply_length": len(data.reply)},
    )
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_human_input(data.agent, data.reply))
    chat_logger.debug("Human reply processed", extra={"task_id": id})
    return Response(status_code=201)


@router.post("/chat/{id}/approval")
def approval(id: str, data: ApprovalRequest):
    """Accept user approval for a dangerous command."""
    chat_logger.info(
        "Approval received",
        extra={"task_id": id, "agent": data.agent, "approval": data.approval},
    )
    task_lock = get_task_lock(id)
    asyncio.run(task_lock.put_approval_input(data.agent, data.approval))
    chat_logger.debug("Approval processed", extra={"task_id": id})
    return Response(status_code=201)


@router.post("/chat/{id}/install-mcp")
def install_mcp(id: str, data: McpServers):
    chat_logger.info(
        "Installing MCP servers",
        extra={
            "task_id": id,
            "servers_count": len(data.get("mcpServers", {})),
        },
    )
    task_lock = get_task_lock(id)
    asyncio.run(
        task_lock.put_queue(
            ActionInstallMcpData(action=Action.install_mcp, data=data)
        )
    )
    chat_logger.info("MCP installation queued", extra={"task_id": id})
    return Response(status_code=201)


@router.post("/chat/{id}/add-task", name="add task to workforce")
def add_task(id: str, data: AddTaskRequest):
    """Add a new task to the workforce"""
    chat_logger.info(
        "Adding task to workforce for"
        f" task_id: {id},"
        f" content: {data.content[:100]}..."
    )
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


@router.delete(
    "/chat/{project_id}/remove-task/{task_id}",
    name="remove task from workforce",
)
def remove_task(project_id: str, task_id: str):
    """Remove a task from the workforce"""
    chat_logger.info(
        f"Removing task {task_id} from workforce for project_id: {project_id}"
    )
    task_lock = get_task_lock(project_id)

    try:
        # Queue the remove task action
        remove_task_action = ActionRemoveTaskData(
            task_id=task_id, project_id=project_id
        )
        asyncio.run(task_lock.put_queue(remove_task_action))

        chat_logger.info(
            "Task removal request queued for"
            f" project_id: {project_id},"
            f" removing task: {task_id}"
        )
        return Response(status_code=204)

    except Exception as e:
        chat_logger.error(
            f"Error removing task {task_id} for project_id: {project_id}: {e}"
        )
        raise UserException(code.error, f"Failed to remove task: {str(e)}")


@router.post("/chat/{project_id}/skip-task", name="skip task in workforce")
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
    chat_logger.info(
        "[STOP-BUTTON] SKIP-TASK request"
        " received from frontend"
        " (User clicked Stop)"
    )
    chat_logger.info(f"[STOP-BUTTON] project_id: {project_id}")
    chat_logger.info("=" * 80)
    task_lock = get_task_lock(project_id)
    chat_logger.info(
        "[STOP-BUTTON] Task lock retrieved,"
        f" task_lock.id: {task_lock.id},"
        " task_lock.status:"
        f" {task_lock.status}"
    )

    try:
        # Queue the skip task action - this will
        # preserve context for multi-turn
        skip_task_action = ActionSkipTaskData(project_id=project_id)
        chat_logger.info(
            "[STOP-BUTTON] Queueing"
            " ActionSkipTaskData"
            " (preserves context,"
            " marks as done)"
        )
        asyncio.run(task_lock.put_queue(skip_task_action))

        chat_logger.info(
            "[STOP-BUTTON] Skip request"
            " queued - task will stop"
            " gracefully and preserve context"
        )
        return Response(status_code=201)

    except Exception as e:
        chat_logger.error(
            "[STOP-BUTTON] Error skipping"
            " task for"
            f" project_id: {project_id}:"
            f" {e}"
        )
        raise UserException(code.error, f"Failed to skip task: {str(e)}")
