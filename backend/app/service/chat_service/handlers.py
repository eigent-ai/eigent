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

from __future__ import annotations

import asyncio
import logging

from camel.tasks import Task

from app.agent.factory.task_summary import (
    get_task_result_with_optional_summary,
)
from app.model.chat import Status, sse_json
from app.service.chat_service.lifecycle import (
    add_sub_tasks,
    format_agent_description,
    install_mcp,
    new_agent_model,
    to_sub_tasks,
    update_sub_tasks,
)
from app.service.chat_service.types import LoopControl, StepSolveState
from app.service.task import Action, delete_task_lock
from app.utils.context import check_conversation_history_length
from app.utils.file_utils import get_working_directory

logger = logging.getLogger(__name__)


def _sse_error(message: str) -> str:
    return sse_json("error", {"message": message})


def _stop_workforce(state: StepSolveState, *, force: bool = False) -> None:
    """Stop and clear the workforce. *force* uses BaseWorkforce.stop()
    (needed by skip_task to bypass the subclass override)."""
    if state.workforce is None:
        logger.info("Workforce is None, nothing to stop")
        return
    if state.workforce._running:
        if force:
            from camel.societies.workforce.workforce import (
                Workforce as BaseWorkforce,
            )

            BaseWorkforce.stop(state.workforce)
        else:
            state.workforce.stop()
    state.workforce.stop_gracefully()
    logger.info(f"Workforce stopped for project {state.options.project_id}")


def _extract_task_content(state: StepSolveState) -> str:
    """Get the user-facing task content string from camel_task."""
    if state.camel_task is not None:
        content: str = state.camel_task.content
        if "=== CURRENT TASK ===" in content:
            content = content.split("=== CURRENT TASK ===")[-1].strip()
        return content
    return f"Task {state.options.task_id}"


def _finalize_task(state: StepSolveState, result: str) -> None:
    """Mark the task done, save conversation history, clear camel_task."""
    state.task_lock.status = Status.done
    state.task_lock.last_task_result = result
    state.task_lock.add_conversation(
        "task_result",
        {
            "task_content": _extract_task_content(state),
            "task_result": result,
            "working_directory": get_working_directory(
                state.options, state.task_lock
            ),
        },
    )
    state.camel_task = None


def handle_passthrough_event(item) -> str | None:
    if item.action == Action.create_agent:
        return sse_json("create_agent", item.data)
    elif item.action == Action.activate_agent:
        return sse_json("activate_agent", item.data)
    elif item.action == Action.deactivate_agent:
        return sse_json("deactivate_agent", dict(item.data))
    elif item.action == Action.assign_task:
        return sse_json("assign_task", item.data)
    elif item.action == Action.activate_toolkit:
        return sse_json("activate_toolkit", item.data)
    elif item.action == Action.deactivate_toolkit:
        return sse_json("deactivate_toolkit", item.data)
    elif item.action == Action.write_file:
        return sse_json(
            "write_file",
            {"file_path": item.data, "process_task_id": item.process_task_id},
        )
    elif item.action == Action.ask:
        return sse_json("ask", item.data)
    elif item.action == Action.notice:
        return sse_json(
            "notice",
            {"notice": item.data, "process_task_id": item.process_task_id},
        )
    elif item.action == Action.search_mcp:
        return sse_json("search_mcp", item.data)
    elif item.action == Action.terminal:
        return sse_json(
            "terminal",
            {"output": item.data, "process_task_id": item.process_task_id},
        )
    elif item.action == Action.decompose_text:
        return sse_json("decompose_text", item.data)
    elif item.action == Action.decompose_progress:
        return sse_json("to_sub_tasks", item.data)
    return None


def handle_disconnect(state: StepSolveState) -> tuple[list[str], LoopControl]:
    logger.warning(
        f"Client disconnected for project {state.options.project_id}"
    )
    _stop_workforce(state)
    state.task_lock.status = Status.done
    return [], LoopControl.BREAK


async def handle_disconnect_cleanup(state: StepSolveState) -> None:
    try:
        await delete_task_lock(state.task_lock.id)
    except Exception as e:
        logger.error(f"Error deleting task lock on disconnect: {e}")


def handle_update_task(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    assert state.camel_task is not None
    update_tasks_map = {item.id: item for item in item.data.task}
    if not state.sub_tasks:
        state.sub_tasks = getattr(state.task_lock, "decompose_sub_tasks", [])
    state.sub_tasks = update_sub_tasks(state.sub_tasks, update_tasks_map)
    update_sub_tasks(state.camel_task.subtasks, update_tasks_map)
    new_tasks = add_sub_tasks(state.camel_task, item.data.task)
    state.sub_tasks.extend(new_tasks)
    state.task_lock.decompose_sub_tasks = state.sub_tasks
    summary_task_content_local = getattr(
        state.task_lock, "summary_task_content", state.summary_task_content
    )
    return [
        to_sub_tasks(state.camel_task, summary_task_content_local)
    ], LoopControl.NORMAL


def handle_add_task(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    if state.camel_task is None and state.workforce is None:
        logger.error(
            f"Cannot add task: not initialized for {state.options.project_id}"
        )
        return [
            _sse_error(
                "Cannot add task: task not initialized. Please start a task first."
            )
        ], LoopControl.CONTINUE

    assert state.camel_task is not None
    if state.workforce is None:
        logger.error(
            f"Cannot add task: workforce not initialized for {state.options.project_id}"
        )
        return [
            _sse_error(
                "Workforce not initialized. Please start the task first."
            )
        ], LoopControl.CONTINUE

    state.workforce.add_task(item.content, item.task_id, item.additional_info)
    return [
        sse_json(
            "add_task",
            {
                "project_id": item.project_id,
                "task_id": item.task_id
                or (len(state.camel_task.subtasks) + 1),
            },
        )
    ], LoopControl.NORMAL


def handle_remove_task(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    if state.workforce is None:
        logger.error(
            f"Cannot remove task: workforce not initialized for {state.options.project_id}"
        )
        return [
            _sse_error(
                "Workforce not initialized. Please start the task first."
            )
        ], LoopControl.CONTINUE

    state.workforce.remove_task(item.task_id)
    return [
        sse_json(
            "remove_task",
            {"project_id": item.project_id, "task_id": item.task_id},
        )
    ], LoopControl.NORMAL


def handle_skip_task(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    logger.info(f"SKIP_TASK received for project {state.options.project_id}")

    if state.task_lock.status == Status.done:
        logger.warning("SKIP_TASK ignored: task already done")
        return [], LoopControl.CONTINUE

    if (
        state.workforce is not None
        and item.project_id == state.options.project_id
    ):
        _stop_workforce(state, force=True)
        state.workforce = None

    end_message = "<summary>Task stopped</summary>Task stopped by user"
    _finalize_task(state, end_message)
    logger.info("Task stopped, ready for multi-turn")
    return [sse_json("end", end_message)], LoopControl.NORMAL


def handle_start(state: StepSolveState, item) -> tuple[list[str], LoopControl]:
    is_exceeded, total_length = check_conversation_history_length(
        state.task_lock
    )
    if is_exceeded:
        logger.error(
            f"Conversation history too long ({total_length} chars) for {state.options.project_id}"
        )
        return [
            sse_json(
                "context_too_long",
                {
                    "message": "The conversation history is too long. Please create a new project to continue.",
                    "current_length": total_length,
                    "max_length": 100000,
                },
            )
        ], LoopControl.CONTINUE

    if state.workforce is not None:
        if state.workforce._state.name == "PAUSED":
            state.workforce.resume()
            return [], LoopControl.CONTINUE
    else:
        return [], LoopControl.CONTINUE

    state.task_lock.status = Status.processing
    if not state.sub_tasks:
        state.sub_tasks = getattr(state.task_lock, "decompose_sub_tasks", [])
    task = asyncio.create_task(state.workforce.eigent_start(state.sub_tasks))
    state.task_lock.add_background_task(task)
    return [], LoopControl.NORMAL


def handle_task_state(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    task_state = item.data.get("state", "unknown")
    task_result = item.data.get("result", "")
    if task_state == "DONE" and task_result:
        state.last_completed_task_result = task_result
    return [sse_json("task_state", item.data)], LoopControl.NORMAL


async def handle_end(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    logger.info(
        f"END received for project {state.options.project_id}, task {state.options.task_id}"
    )

    if state.task_lock.status == Status.done:
        logger.warning("END ignored: task already done")
        return [], LoopControl.CONTINUE

    if state.camel_task is None:
        logger.warning(
            f"END with camel_task=None for {state.options.project_id}"
        )
        final_result: str = str(item.data) if item.data else "Task completed"
    else:
        final_result: str = await get_task_result_with_optional_summary(
            state.camel_task, state.options
        )

    _finalize_task(state, final_result)

    if state.workforce is not None:
        state.workforce.stop_gracefully()
        state.workforce = None
        logger.info(
            f"Workforce stopped for project {state.options.project_id}"
        )
    else:
        logger.warning(
            f"Workforce already None at end for {state.options.project_id}"
        )

    if state.task_lock.question_agent is not None:
        state.task_lock.question_agent.reset()

    return [sse_json("end", final_result)], LoopControl.NORMAL


def handle_supplement(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    if state.camel_task is None:
        logger.warning(
            f"SUPPLEMENT with camel_task=None for {state.options.project_id}"
        )
        return [
            _sse_error(
                "Cannot supplement task: task not initialized. Please start a task first."
            )
        ], LoopControl.CONTINUE

    state.task_lock.status = Status.processing
    state.camel_task.add_subtask(
        Task(
            content=item.data.question,
            id=f"{state.camel_task.id}.{len(state.camel_task.subtasks)}",
        )
    )
    if state.workforce is not None:
        task = asyncio.create_task(
            state.workforce.eigent_start(state.camel_task.subtasks)
        )
        state.task_lock.add_background_task(task)
    return [], LoopControl.NORMAL


def handle_budget_not_enough(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    if state.workforce is not None:
        state.workforce.pause()
    return [
        sse_json(Action.budget_not_enough, {"message": "budget not enouth"})
    ], LoopControl.NORMAL


async def handle_stop(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    logger.info(f"STOP received for project {state.options.project_id}")
    _stop_workforce(state)
    await delete_task_lock(state.task_lock.id)
    return [], LoopControl.BREAK


def handle_pause(state: StepSolveState, item) -> tuple[list[str], LoopControl]:
    if state.workforce is not None:
        state.workforce.pause()
        logger.info(f"Workforce paused for project {state.options.project_id}")
    else:
        logger.warning(
            f"Cannot pause: workforce is None for {state.options.project_id}"
        )
    return [], LoopControl.NORMAL


def handle_resume(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    if state.workforce is not None:
        state.workforce.resume()
        logger.info(
            f"Workforce resumed for project {state.options.project_id}"
        )
    else:
        logger.warning(
            f"Cannot resume: workforce is None for {state.options.project_id}"
        )
    return [], LoopControl.NORMAL


async def handle_new_agent(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    if state.workforce is not None:
        state.workforce.pause()
        state.workforce.add_single_agent_worker(
            format_agent_description(item),
            await new_agent_model(item, state.options),
        )
        state.workforce.resume()
    return [], LoopControl.NORMAL


def handle_timeout(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    logger.info(f"TIMEOUT for project {state.options.project_id}: {item.data}")
    return [
        sse_json(
            "error",
            {
                "message": item.data.get("message", "Task execution timeout"),
                "type": "timeout",
                "details": {
                    "in_flight_tasks": item.data.get("in_flight_tasks", 0),
                    "pending_tasks": item.data.get("pending_tasks", 0),
                    "timeout_seconds": item.data.get("timeout_seconds", 0),
                },
            },
        )
    ], LoopControl.NORMAL


def handle_install_mcp(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    if state.mcp is None:
        logger.error(
            f"Cannot install MCP: agent not initialized for {state.options.project_id}"
        )
        return [
            _sse_error(
                "MCP agent not initialized. Please start a complex task first."
            )
        ], LoopControl.CONTINUE
    task = asyncio.create_task(install_mcp(state.mcp, item))
    state.task_lock.add_background_task(task)
    return [], LoopControl.NORMAL
