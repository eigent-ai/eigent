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
import inspect
import logging
import os
import time
from dataclasses import replace
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse

from app.component import code
from app.component.environment import env, sanitize_env_path, set_user_env_path
from app.exception.exception import UserException
from app.memory import get_memory_service
from app.model.chat import (
    AddTaskRequest,
    Chat,
    HumanReply,
    McpServers,
    Status,
    SupplementChat,
    sse_json,
)
from app.run_context import (
    RunContext,
    apply_run_env_for_third_party,
    stream_with_run_context,
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
    get_task_lock_if_exists,
    set_current_task_id,
    task_locks,
)
from app.utils.browser_launcher import (
    ensure_cdp_browser_endpoint,
    is_cdp_url_available,
    normalize_cdp_url,
)
from app.utils.cdp_browser_state import (
    clear_connected_cdp_browser_for_request,
    get_connected_cdp_endpoint_for_request,
)
from app.utils.event_loop_utils import schedule_async_task_from_worker
from app.utils.workspace_paths import camel_log_root
from app.utils.workspace_resolver import get_workspace_resolver

router = APIRouter()

# Logger for chat controller
chat_logger = logging.getLogger("chat_controller")

# SSE timeout configuration (60 minutes in seconds)
SSE_TIMEOUT_SECONDS = 60 * 60

# CAMEL reads this as a process-level logging toggle, not as per-run state.
os.environ.setdefault("CAMEL_MODEL_LOG_ENABLED", "true")


def _is_remote_browser_hands(request: Request | None) -> bool:
    hands = getattr(getattr(request, "state", None), "hands", None)
    if hands is None:
        return False
    get_manifest = getattr(hands, "get_capability_manifest", None)
    if get_manifest is None or inspect.iscoroutinefunction(get_manifest):
        return False
    try:
        manifest = get_manifest()
    except Exception:
        return False
    if inspect.isawaitable(manifest):
        if hasattr(manifest, "close"):
            manifest.close()
        return False
    if not isinstance(manifest, dict):
        return False
    return manifest.get("deployment") == "remote_cluster"


async def _prepare_browser_for_request(
    request: Request | None,
    port: int,
) -> bool:
    existing_cdp_url = (
        get_connected_cdp_endpoint_for_request(request)
        or env("EIGENT_CDP_URL", "")
    ).strip()
    if existing_cdp_url:
        is_available = await asyncio.to_thread(
            is_cdp_url_available, existing_cdp_url
        )
        if is_available:
            normalized_endpoint, _, selected_port = normalize_cdp_url(
                existing_cdp_url
            )
            if request is not None:
                request.state.browser_available = True
                request.state.cdp_url = normalized_endpoint
                request.state.browser_port = selected_port
            return True
        clear_connected_cdp_browser_for_request(request)

    if _is_remote_browser_hands(request):
        if request is not None:
            request.state.browser_available = True
            request.state.cdp_url = None
            request.state.browser_port = port
        return True

    try:
        endpoint = await asyncio.to_thread(ensure_cdp_browser_endpoint, port)
    except Exception as e:
        chat_logger.warning(
            "Could not ensure CDP browser for web mode",
            extra={"error": str(e), "port": port},
        )
        if request is not None:
            request.state.browser_available = False
            request.state.cdp_url = None
            request.state.browser_port = port
        return False

    if endpoint:
        _, _, selected_port = normalize_cdp_url(endpoint)
        if request is not None:
            request.state.browser_available = True
            request.state.cdp_url = endpoint
            request.state.browser_port = selected_port
        return True

    chat_logger.warning(
        "CDP browser not available after ensure attempt",
        extra={"port": port},
    )
    if request is not None:
        request.state.browser_available = False
        request.state.cdp_url = None
        request.state.browser_port = port
    return False


def _browser_prepare_timeout_seconds() -> float:
    raw = env("BROWSER_PREPARE_TIMEOUT_SECONDS", "8")
    try:
        timeout = float(raw)
    except (TypeError, ValueError):
        return 8.0
    return timeout if timeout > 0 else 8.0


async def _prepare_browser_for_request_with_timeout(
    request: Request | None,
    port: int,
) -> bool:
    timeout = _browser_prepare_timeout_seconds()
    try:
        return await asyncio.wait_for(
            _prepare_browser_for_request(request, port),
            timeout=timeout,
        )
    except TimeoutError:
        chat_logger.warning(
            "Timed out preparing CDP browser",
            extra={"port": port, "timeout_seconds": timeout},
        )
        if request is not None:
            request.state.browser_available = False
            request.state.cdp_url = None
            request.state.browser_port = port
        return False


def _build_run_context(
    data: Chat,
    frozen_dirs,
    request: Request,
    camel_log: Path,
) -> RunContext:
    api_base_url = data.api_url or "https://api.openai.com/v1"
    browser_port = int(
        getattr(request.state, "browser_port", data.browser_port)
    )
    cdp_url = getattr(request.state, "cdp_url", None)
    auth_header = request.headers.get("authorization")
    return RunContext(
        space_id=data.space_id or data.project_id,
        project_id=data.project_id,
        run_id=data.run_id or data.task_id,
        task_id=data.task_id,
        email=data.email,
        user_id=str(data.user_id) if data.user_id is not None else None,
        working_directory=frozen_dirs.working_directory,
        task_output_root=frozen_dirs.task_output_root,
        camel_log_dir=camel_log,
        binding_source=frozen_dirs.binding_source,
        workdir_mode=frozen_dirs.workdir_mode or data.workdir_mode,
        browser_port=browser_port,
        cdp_url=cdp_url,
        api_key=data.api_key,
        api_base_url=api_base_url,
        cloud_api_key=data.api_key if data.is_cloud() else None,
        server_url=data.server_url,
        auth_header=auth_header,
        search_config=data.search_config or {},
        extra_env={
            "baseSnapshotId": frozen_dirs.base_snapshot_id or "",
        },
    )


def _queue_action_from_worker(task_lock, action, description: str) -> None:
    schedule_async_task_from_worker(
        task_lock.put_queue(action),
        timeout=5.0,
        description=description,
    )


def _camel_log_dir(
    email: str,
    project_id: str,
    task_id: str,
    user_id: str | int | None = None,
) -> Path:
    return camel_log_root(email, project_id, task_id, user_id)


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


def _should_preserve_task_lock_on_cancel(task_lock) -> bool:
    """Keep completed Project state alive for follow-up turns.

    The frontend closes the SSE stream after a run reaches `end`. That close is
    reported to FastAPI as a cancellation, but for multi-turn Project semantics
    it is not a user stop. The TaskLock carries the short-term conversation
    context used by follow-up `/chat/{project_id}` requests, especially for the
    single-agent harness, so completed locks with history must survive it.
    """
    if not task_lock:
        return False
    if getattr(task_lock, "status", None) not in {
        Status.done,
        Status.confirming,
    }:
        return False
    return bool(getattr(task_lock, "conversation_history", None))


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
        if _should_preserve_task_lock_on_cancel(task_lock):
            chat_logger.info(
                "[STREAM-CANCELLED] Preserving completed task lock for follow-up context",
                extra={"task_id": getattr(task_lock, "id", None)},
            )
            raise
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


async def start_chat_stream(data: Chat, request: Request):
    """
    Setup and start chat stream. Used by POST /chat and Message Router.
    Returns async generator of SSE chunks.
    """
    # TODO(brain-auth): Phase B should derive canonical user_id from
    # request.state.brain_auth, then verify/replace Chat.email before any
    # workspace snapshot, artifact path, or task lock is resolved.
    chat_logger.info(
        "Starting new chat session",
        extra={
            "project_id": data.project_id,
            "task_id": data.task_id,
            "user": data.email,
        },
    )

    task_lock = get_or_create_task_lock(data.project_id)

    # Set user-specific environment path for this thread
    set_user_env_path(data.env_path)
    # Load environment with validated path
    safe_env_path = sanitize_env_path(data.env_path)
    if safe_env_path:
        load_dotenv(dotenv_path=safe_env_path)

    resolver = get_workspace_resolver()
    try:
        frozen_dirs = resolver.freeze_task_directories(data, task_lock)
    except ValueError as exc:
        raise UserException(code.error, str(exc)) from exc

    try:
        await asyncio.to_thread(
            resolver.write_task_snapshot,
            data.email,
            frozen_dirs.snapshot,
        )
    except Exception:
        chat_logger.warning(
            "Failed to persist task workspace snapshot",
            extra={"project_id": data.project_id, "task_id": data.task_id},
            exc_info=True,
        )

    # Web mode: reuse an existing CDP endpoint first, otherwise acquire browser
    # through RemoteHands or launch a local browser when available.
    if not data.cdp_browsers:
        await _prepare_browser_for_request_with_timeout(
            request, data.browser_port
        )

    camel_log = _camel_log_dir(
        data.email,
        data.project_id,
        data.run_id or data.task_id,
        data.user_id,
    )
    camel_log.mkdir(parents=True, exist_ok=True)
    run_context = _build_run_context(data, frozen_dirs, request, camel_log)
    apply_run_env_for_third_party(run_context)
    task_lock.run_context = run_context

    # Local memory: write Space/Project/Run scaffolding + append user prompt.
    # Best-effort; MemoryService swallows write errors so chat keeps working.
    memory_service = get_memory_service()
    memory_mode = (
        "single_agent" if data.session_mode == "single-agent" else "workforce"
    )
    memory_space_source = (
        "legacy"
        if data.space_id and data.space_id.startswith("legacy_")
        else ("folder" if data.space_root_path else "blank")
    )
    memory_service.on_run_start(
        run_context=run_context,
        space_name=None,
        project_name=None,
        space_source_type=memory_space_source,
        mode=memory_mode,
        user_prompt=data.question,
        prompt_source="chat",
    )
    task_lock.memory_service = memory_service

    # Set the initial current_task_id in task_lock
    set_current_task_id(data.project_id, data.task_id)

    # Put initial action in queue to start processing
    await task_lock.put_queue(
        ActionImproveData(
            data=ImprovePayload(
                question=data.question,
                attaches=data.attaches or [],
                project_context=data.project_context,
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
            "working_directory": str(frozen_dirs.working_directory),
            "binding_source": frozen_dirs.binding_source,
        },
    )
    return timeout_stream_wrapper(
        stream_with_run_context(
            step_solve(data, request, task_lock),
            lambda: getattr(task_lock, "run_context", run_context),
        ),
        task_lock=task_lock,
    )


@router.post("/chat", name="start chat")
async def post(data: Chat, request: Request):
    stream = await start_chat_stream(data, request)
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
    )


@router.get("/chat/{project_id}/status", name="get chat status")
async def status(project_id: str):
    task_lock = get_task_lock_if_exists(project_id)
    if task_lock is None:
        return {
            "project_id": project_id,
            "has_lock": False,
            "status": "offline",
            "current_task_id": None,
        }
    return {
        "project_id": project_id,
        "has_lock": True,
        "status": task_lock.status.value,
        "current_task_id": task_lock.current_task_id,
    }


@router.post("/chat/{id}", name="improve chat")
async def improve(id: str, data: SupplementChat, request: Request):
    chat_logger.info(
        "Chat improvement requested",
        extra={"task_id": id, "question_length": len(data.question)},
    )
    task_lock = get_task_lock(id)

    # Reuse an existing endpoint when possible to avoid tearing down
    # a browser that was manually connected through the Browser page.
    current_context = getattr(task_lock, "run_context", None)
    port = (
        current_context.browser_port
        if isinstance(current_context, RunContext)
        else int(env("browser_port", "9222"))
    )
    await _prepare_browser_for_request_with_timeout(request, port)

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
            current_email = getattr(task_lock, "email", None)

            # If we have the necessary info, update
            # the file_save_path
            if current_email and id:
                resolver = get_workspace_resolver()
                frozen_dirs = await asyncio.to_thread(
                    resolver.freeze_task_directories_for,
                    space_id=getattr(task_lock, "space_id", id),
                    project_id=id,
                    task_id=data.task_id,
                    email=current_email,
                    task_lock=task_lock,
                    user_id=getattr(task_lock, "user_id", None),
                )
                try:
                    await asyncio.to_thread(
                        resolver.write_task_snapshot,
                        current_email,
                        frozen_dirs.snapshot,
                    )
                except Exception:
                    chat_logger.warning(
                        "Failed to persist task workspace snapshot",
                        extra={"project_id": id, "task_id": data.task_id},
                        exc_info=True,
                    )
                new_folder_path = frozen_dirs.task_output_root
                camel_log = _camel_log_dir(
                    current_email,
                    id,
                    data.task_id,
                    getattr(task_lock, "user_id", None),
                )
                await asyncio.to_thread(
                    camel_log.mkdir, parents=True, exist_ok=True
                )
                current_context = getattr(task_lock, "run_context", None)
                if isinstance(current_context, RunContext):
                    updated_context = replace(
                        current_context,
                        run_id=data.task_id,
                        task_id=data.task_id,
                        working_directory=frozen_dirs.working_directory,
                        task_output_root=frozen_dirs.task_output_root,
                        camel_log_dir=camel_log,
                        binding_source=frozen_dirs.binding_source,
                        browser_port=int(
                            getattr(request.state, "browser_port", port)
                        ),
                        cdp_url=getattr(
                            request.state, "cdp_url", current_context.cdp_url
                        ),
                    )
                    await asyncio.to_thread(
                        apply_run_env_for_third_party, updated_context
                    )
                    task_lock.run_context = updated_context
                chat_logger.info(
                    f"Updated file_save_path to: {new_folder_path}"
                )

                # Store the new folder path in task_lock
                # for potential cleanup and persistence
                task_lock.new_folder_path = (
                    new_folder_path
                    if frozen_dirs.binding_source == "default"
                    else None
                )
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

    # Local memory: this is a follow-up turn within the same Project. The
    # original on_run_start ran when the chat first started; here we open a
    # new Run record for the supplement turn so its conversation events are
    # bound to the right run_id.
    #
    # Strict guard: only open a new durable Run when run_context was actually
    # rotated to the supplied task_id. The workspace-rotation block above is
    # wrapped in a best-effort try/except, so a missing email, a resolver
    # failure, or any other swallowed exception can leave task_lock.run_context
    # pointing at the previous (finalized) run id. Calling on_run_start in
    # that state would reset the old run's status.json back to "running" and
    # the finalize dedup set then blocks the next end-of-turn writer from
    # closing it again -- leaving durable memory permanently divergent from
    # the visible chat flow.
    refreshed_context = getattr(task_lock, "run_context", None)
    rotation_succeeded = (
        data.task_id
        and isinstance(refreshed_context, RunContext)
        and refreshed_context.run_id == data.task_id
    )
    if rotation_succeeded:
        await asyncio.to_thread(
            get_memory_service().on_run_start,
            run_context=refreshed_context,
            space_name=None,
            project_name=None,
            space_source_type=(
                "legacy"
                if refreshed_context.space_id.startswith("legacy_")
                else "blank"
            ),
            mode=None,  # mode unchanged; preserve existing project.json value
            user_prompt=data.question,
            prompt_source="improve",
        )
    elif data.task_id:
        # The client wanted a fresh run but rotation failed upstream. Don't
        # touch durable memory; the in-process turn still proceeds so the
        # user gets a response, but we leave a breadcrumb for diagnosis.
        chat_logger.warning(
            "Skipped durable on_run_start: run_context did not rotate to"
            " requested task_id",
            extra={
                "project_id": id,
                "requested_task_id": data.task_id,
                "current_run_id": (
                    refreshed_context.run_id
                    if isinstance(refreshed_context, RunContext)
                    else None
                ),
            },
        )

    await task_lock.put_queue(
        ActionImproveData(
            data=ImprovePayload(
                question=data.question,
                attaches=data.attaches or [],
                project_context=data.project_context,
            ),
            new_task_id=data.task_id,
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
    _queue_action_from_worker(
        task_lock,
        ActionSupplementData(data=data),
        "supplement task queue action",
    )
    chat_logger.debug("Supplement data queued", extra={"task_id": id})
    return Response(status_code=201)


@router.delete("/chat/{id}", name="stop chat")
async def stop(id: str):
    """stop the task"""
    chat_logger.info("=" * 80)
    chat_logger.info(
        "🛑 [STOP-BUTTON] DELETE /chat/{id} request received from frontend"
    )
    chat_logger.info(f"[STOP-BUTTON] project_id/task_id: {id}")
    chat_logger.info("=" * 80)
    task_lock = get_task_lock_if_exists(id)
    if task_lock is not None:
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
        try:
            await task_lock.put_queue(ActionStopData(action=Action.stop))
            chat_logger.info(
                "[STOP-BUTTON] ActionStopData queued"
                " successfully, this will trigger"
                " workforce.stop_gracefully()"
            )
        except Exception as e:
            chat_logger.warning(
                "[STOP-BUTTON] Failed to queue ActionStopData",
                extra={"task_id": id, "error": str(e)},
            )
    else:
        chat_logger.warning(
            "[STOP-BUTTON] Task lock not found, task may already be stopped",
            extra={"task_id": id},
        )
    return Response(status_code=204)


@router.post("/chat/{id}/human-reply")
async def human_reply(id: str, data: HumanReply):
    chat_logger.info(
        "Human reply received",
        extra={"task_id": id, "reply_length": len(data.reply)},
    )
    task_lock = get_task_lock(id)
    try:
        await task_lock.put_human_input(data.agent, data.reply)
    except KeyError as exc:
        chat_logger.warning(
            "Human reply target is no longer waiting for input",
            extra={"task_id": id, "agent": data.agent},
        )
        raise UserException(
            code.error,
            "This task is no longer waiting for a human reply. Please send a new message.",
        ) from exc
    chat_logger.debug("Human reply processed", extra={"task_id": id})
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
    _queue_action_from_worker(
        task_lock,
        ActionInstallMcpData(action=Action.install_mcp, data=data),
        "install MCP queue action",
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
        _queue_action_from_worker(
            task_lock,
            add_task_action,
            "add task queue action",
        )
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
        _queue_action_from_worker(
            task_lock,
            remove_task_action,
            "remove task queue action",
        )

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
    task_lock = get_task_lock_if_exists(project_id)
    if task_lock is None:
        chat_logger.warning(
            "[STOP-BUTTON] Task lock not found, task may already be stopped",
            extra={"project_id": project_id},
        )
        return Response(status_code=204)
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
        _queue_action_from_worker(
            task_lock,
            skip_task_action,
            "skip task queue action",
        )

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
