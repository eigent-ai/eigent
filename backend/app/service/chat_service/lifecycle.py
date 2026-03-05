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

"""Workforce/task CRUD, start/stop/pause, and agent construction."""

from __future__ import annotations

import asyncio
import datetime
import logging
import platform
from typing import TYPE_CHECKING

from camel.tasks import Task
from camel.types import ModelPlatformType
from inflection import titleize
from pydash import chain

from app.agent.agent_model import agent_model
from app.agent.factory import (
    browser_agent,
    developer_agent,
    document_agent,
    mcp_agent,
    multi_modal_agent,
)
from app.agent.factory.task_summary import (
    get_task_result_with_optional_summary,
)
from app.agent.factory.workforce_agents import (
    create_coordinator_and_task_agents,
    create_new_worker_agent,
)
from app.agent.listen_chat_agent import ListenChatAgent
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.tools import get_mcp_tools, get_toolkits
from app.model.chat import Chat, NewAgent, Status, TaskContent, sse_json
from app.service.task import (
    Action,
    ActionInstallMcpData,
    ActionNewAgent,
    delete_task_lock,
)
from app.utils.context import check_conversation_history_length
from app.utils.event_loop_utils import set_main_event_loop
from app.utils.file_utils import get_working_directory
from app.utils.telemetry.workforce_metrics import WorkforceMetricsCallback
from app.utils.workforce import Workforce

if TYPE_CHECKING:
    from app.service.chat_service._step_solve import (
        LoopControl,
        StepSolveState,
    )

logger = logging.getLogger("chat_service")


# ============================================================================
# Standalone helper functions (moved as-is from chat_service.py)
# ============================================================================


async def install_mcp(
    mcp: ListenChatAgent,
    install_mcp: ActionInstallMcpData,
):
    mcp_keys = list(install_mcp.data.get("mcpServers", {}).keys())
    logger.info(f"Installing MCP tools: {mcp_keys}")
    try:
        mcp.add_tools(await get_mcp_tools(install_mcp.data))
        logger.info("MCP tools installed successfully")
    except Exception as e:
        logger.error(f"Error installing MCP tools: {e}", exc_info=True)
        raise


def to_sub_tasks(task: Task, summary_task_content: str):
    logger.info("[TO-SUB-TASKS] 📋 Creating to_sub_tasks SSE event")
    logger.info(
        f"[TO-SUB-TASKS] task.id={task.id}"
        f", summary={summary_task_content[:50]}"
        f"..., subtasks_count="
        f"{len(task.subtasks)}"
    )
    result = sse_json(
        "to_sub_tasks",
        {
            "summary_task": summary_task_content,
            "sub_tasks": tree_sub_tasks(task.subtasks),
        },
    )
    logger.info("[TO-SUB-TASKS] ✅ to_sub_tasks SSE event created")
    return result


def tree_sub_tasks(sub_tasks: list[Task], depth: int = 0):
    if depth > 5:
        return []

    result = (
        chain(sub_tasks)
        .filter(lambda x: x.content != "")
        .map(
            lambda x: {
                "id": x.id,
                "content": x.content,
                "state": x.state,
                "subtasks": tree_sub_tasks(x.subtasks, depth + 1),
            }
        )
        .value()
    )

    return result


def update_sub_tasks(
    sub_tasks: list[Task], update_tasks: dict[str, TaskContent], depth: int = 0
):
    if depth > 5:  # limit the depth of the recursion
        return []

    i = 0
    while i < len(sub_tasks):
        item = sub_tasks[i]
        if item.id in update_tasks:
            item.content = update_tasks[item.id].content
            update_sub_tasks(item.subtasks, update_tasks, depth + 1)
            i += 1
        else:
            sub_tasks.pop(i)
    return sub_tasks


def add_sub_tasks(
    camel_task: Task, update_tasks: list[TaskContent]
) -> list[Task]:
    """Add new tasks (with empty id) to camel_task
    and return the list of added tasks."""
    added_tasks = []
    for item in update_tasks:
        if item.id == "":
            new_task = Task(
                content=item.content,
                id=f"{camel_task.id}.{len(camel_task.subtasks) + 1}",
            )
            camel_task.add_subtask(new_task)
            added_tasks.append(new_task)
    return added_tasks


def format_agent_description(agent_data: NewAgent | ActionNewAgent) -> str:
    r"""Format a comprehensive agent description including name, tools, and
    description.
    """
    description_parts = [f"{agent_data.name}:"]

    # Add description if available
    if hasattr(agent_data, "description") and agent_data.description:
        description_parts.append(agent_data.description.strip())
    else:
        description_parts.append("A specialized agent")

    # Add tools information
    tool_names = []
    if hasattr(agent_data, "tools") and agent_data.tools:
        for tool in agent_data.tools:
            tool_names.append(titleize(tool))

    if hasattr(agent_data, "mcp_tools") and agent_data.mcp_tools:
        for mcp_server in agent_data.mcp_tools.get("mcpServers", {}).keys():
            tool_names.append(titleize(mcp_server))

    if tool_names:
        description_parts.append(
            f"with access to {', '.join(tool_names)} tools : <{tool_names}>"
        )

    return " ".join(description_parts)


async def new_agent_model(data: NewAgent | ActionNewAgent, options: Chat):
    logger.info(
        "Creating new agent",
        extra={
            "agent_name": data.name,
            "project_id": options.project_id,
            "task_id": options.task_id,
        },
    )
    logger.debug(
        "New agent data", extra={"agent_data": data.model_dump_json()}
    )
    working_directory = get_working_directory(options)
    tool_names = []
    tools = [*await get_toolkits(data.tools, data.name, options.project_id)]
    for item in data.tools:
        tool_names.append(titleize(item))
    # Always include terminal_toolkit with proper working directory
    terminal_toolkit = TerminalToolkit(
        options.project_id,
        agent_name=data.name,
        working_directory=working_directory,
        safe_mode=True,
        clone_current_env=True,
    )
    tools.extend(terminal_toolkit.get_tools())
    tool_names.append(titleize("terminal_toolkit"))
    if data.mcp_tools is not None:
        tools = [*tools, *await get_mcp_tools(data.mcp_tools)]
        for item in data.mcp_tools["mcpServers"].keys():
            tool_names.append(titleize(item))
    for item in tools:
        logger.debug(f"Agent {data.name} tool: {item.func.__name__}")
    logger.info(
        f"Agent {data.name} created with {len(tools)} tools: {tool_names}"
    )
    # Enhanced system message with platform information
    enhanced_description = f"""{data.description}
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory \
`{working_directory}`. All local file operations \
must occur here, but you can access files from any \
place in the file system. For all file system \
operations, you MUST use absolute paths to ensure \
precision and avoid ambiguity.
The current date is {datetime.date.today()}. \
For any date-related tasks, you MUST use this as \
the current date.
"""

    # Pass per-agent custom model config if available
    custom_model_config = getattr(data, "custom_model_config", None)
    return agent_model(
        data.name,
        enhanced_description,
        options,
        tools,
        tool_names=tool_names,
        custom_model_config=custom_model_config,
    )


async def construct_workforce(
    options: Chat,
) -> tuple[Workforce, ListenChatAgent]:
    """Construct a workforce with all required agents.

    This function creates all agents in PARALLEL to minimize startup time.
    Sync functions are run in thread pool, async functions
    are awaited concurrently.
    """
    logger.debug(
        "construct_workforce started",
        extra={"project_id": options.project_id, "task_id": options.task_id},
    )

    # Store main event loop reference for thread-safe async task scheduling
    # This allows agent_model() to schedule tasks
    # when called from worker threads
    set_main_event_loop(asyncio.get_running_loop())

    working_directory = get_working_directory(options)

    # ========================================================================
    # Execute all agent creations in PARALLEL
    # ========================================================================

    try:
        # asyncio.gather runs all coroutines concurrently
        # asyncio.to_thread runs sync functions in
        # thread pool without blocking event loop
        results = await asyncio.gather(
            asyncio.to_thread(
                create_coordinator_and_task_agents, options, working_directory
            ),
            asyncio.to_thread(
                create_new_worker_agent, options, working_directory
            ),
            asyncio.to_thread(browser_agent, options),
            developer_agent(options),
            document_agent(options),
            asyncio.to_thread(multi_modal_agent, options),
            mcp_agent(options),
        )
    except Exception as e:
        logger.error(
            f"Failed to create agents in parallel: {e}", exc_info=True
        )
        raise
    finally:
        # Always clear event loop reference after
        # parallel agent creation completes.
        # This prevents stale references and
        # potential cross-request interference
        set_main_event_loop(None)

    # Unpack results
    (
        coord_task_agents,
        new_worker_agent,
        searcher,
        developer,
        documenter,
        multi_modaler,
        mcp,
    ) = results

    coordinator_agent, task_agent = coord_task_agents

    # ========================================================================
    # Create Workforce instance and add workers (must be sequential)
    # ========================================================================

    try:
        model_platform_enum = ModelPlatformType(options.model_platform.lower())
    except (ValueError, AttributeError):
        model_platform_enum = None

    # Create workforce metrics callback for workforce analytics
    workforce_metrics = WorkforceMetricsCallback(
        project_id=options.project_id, task_id=options.task_id
    )

    workforce = Workforce(
        options.project_id,
        "A workforce",
        graceful_shutdown_timeout=3,
        share_memory=False,
        coordinator_agent=coordinator_agent,
        task_agent=task_agent,
        new_worker_agent=new_worker_agent,
        use_structured_output_handler=False
        if model_platform_enum == ModelPlatformType.OPENAI
        else True,
    )

    # Register workforce metrics callback
    workforce._callbacks.append(workforce_metrics)
    workforce.add_single_agent_worker(
        "Developer Agent: A master-level coding assistant with a powerful "
        "terminal. It can write and execute code, manage files, automate "
        "desktop tasks, and deploy web applications to solve complex "
        "technical challenges.",
        developer,
    )
    workforce.add_single_agent_worker(
        "Browser Agent: Can search the web, extract webpage content, "
        "simulate browser actions, and provide relevant information to "
        "solve the given task.",
        searcher,
    )
    workforce.add_single_agent_worker(
        "Document Agent: A document processing assistant skilled in creating "
        "and modifying a wide range of file formats. It can generate "
        "text-based files/reports (Markdown, JSON, YAML, HTML), "
        "office documents (Word, PDF), presentations (PowerPoint), and "
        "data files (Excel, CSV).",
        documenter,
    )
    workforce.add_single_agent_worker(
        "Multi-Modal Agent: A specialist in media processing. It can "
        "analyze images and audio, transcribe speech, download videos, and "
        "generate new images from text prompts.",
        multi_modaler,
    )

    return workforce, mcp


# ============================================================================
# Extracted action handlers
# ============================================================================


def handle_disconnect(state: StepSolveState) -> tuple[list[str], LoopControl]:
    """Handle client disconnect. Returns BREAK to exit the main loop."""
    from app.service.chat_service._step_solve import LoopControl

    # This is called after checking request.is_disconnected()
    # The actual async disconnect check is done in _step_solve.py
    logger.warning("=" * 80)
    logger.warning(
        "[LIFECYCLE] CLIENT DISCONNECTED "
        f"for project {state.options.project_id}"
    )
    logger.warning("=" * 80)
    if state.workforce is not None:
        logger.info(
            "[LIFECYCLE] Stopping workforce "
            "due to client disconnect, "
            "workforce._running="
            f"{state.workforce._running}"
        )
        if state.workforce._running:
            state.workforce.stop()
        state.workforce.stop_gracefully()
        logger.info("[LIFECYCLE] Workforce stopped after client disconnect")
    else:
        logger.info("[LIFECYCLE] Workforce is None, no need to stop")
    state.task_lock.status = Status.done
    return [], LoopControl.BREAK


async def handle_disconnect_cleanup(state: StepSolveState) -> None:
    """Async cleanup after disconnect (delete task lock)."""
    try:
        await delete_task_lock(state.task_lock.id)
        logger.info("[LIFECYCLE] Task lock deleted after client disconnect")
    except Exception as e:
        logger.error(f"Error deleting task lock on disconnect: {e}")


def handle_update_task(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    assert state.camel_task is not None
    update_tasks_map = {item.id: item for item in item.data.task}
    # Use stored decomposition results if available
    if not state.sub_tasks:
        state.sub_tasks = getattr(state.task_lock, "decompose_sub_tasks", [])
    state.sub_tasks = update_sub_tasks(state.sub_tasks, update_tasks_map)
    # Also update camel_task.subtasks to remove deleted tasks
    update_sub_tasks(state.camel_task.subtasks, update_tasks_map)
    # Add new tasks (with empty id) to both camel_task and sub_tasks
    new_tasks = add_sub_tasks(state.camel_task, item.data.task)
    state.sub_tasks.extend(new_tasks)
    # Save updated sub_tasks back to task_lock
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
    from app.service.chat_service._step_solve import LoopControl

    events = []
    # Check if this might be a misrouted second question
    if state.camel_task is None and state.workforce is None:
        logger.error(
            "Cannot add task: both "
            "camel_task and workforce "
            "are None for project "
            f"{state.options.project_id}"
        )
        events.append(
            sse_json(
                "error",
                {
                    "message": "Cannot add task: task not "
                    "initialized. Please start"
                    " a task first."
                },
            )
        )
        return events, LoopControl.CONTINUE

    assert state.camel_task is not None
    if state.workforce is None:
        logger.error(
            "Cannot add task: workforce"
            " not initialized for "
            "project "
            f"{state.options.project_id}"
        )
        events.append(
            sse_json(
                "error",
                {
                    "message": "Workforce not initialized."
                    " Please start the task "
                    "first."
                },
            )
        )
        return events, LoopControl.CONTINUE

    # Add task to the workforce queue
    state.workforce.add_task(item.content, item.task_id, item.additional_info)

    returnData = {
        "project_id": item.project_id,
        "task_id": item.task_id or (len(state.camel_task.subtasks) + 1),
    }
    events.append(sse_json("add_task", returnData))
    return events, LoopControl.NORMAL


def handle_remove_task(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    events = []
    if state.workforce is None:
        logger.error(
            "Cannot remove task: "
            "workforce not initialized "
            "for project "
            f"{state.options.project_id}"
        )
        events.append(
            sse_json(
                "error",
                {
                    "message": "Workforce not initialized."
                    " Please start the task "
                    "first."
                },
            )
        )
        return events, LoopControl.CONTINUE

    state.workforce.remove_task(item.task_id)
    returnData = {
        "project_id": item.project_id,
        "task_id": item.task_id,
    }
    events.append(sse_json("remove_task", returnData))
    return events, LoopControl.NORMAL


def handle_skip_task(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    events = []
    logger.info("=" * 80)
    logger.info(
        "🛑 [LIFECYCLE] SKIP_TASK action received (User clicked Stop button)",
        extra={
            "project_id": state.options.project_id,
            "item_project_id": item.project_id,
        },
    )
    logger.info("=" * 80)

    # Prevent duplicate skip processing
    if state.task_lock.status == Status.done:
        logger.warning(
            "[LIFECYCLE] SKIP_TASK "
            "received but task already "
            "marked as done. Ignoring."
        )
        return events, LoopControl.CONTINUE

    wf_match = (
        state.workforce is not None
        and item.project_id == state.options.project_id
    )
    if wf_match:
        logger.info(
            "[LIFECYCLE] Workforce exists"
            f" (id={id(state.workforce)}), "
            "state="
            f"{state.workforce._state.name}, "
            f"_running={state.workforce._running}"
        )

        # Stop workforce completely
        logger.info("[LIFECYCLE] 🛑 Stopping workforce")
        if state.workforce._running:
            # Import correct BaseWorkforce from camel
            from camel.societies.workforce.workforce import (
                Workforce as BaseWorkforce,
            )

            BaseWorkforce.stop(state.workforce)
            logger.info(
                "[LIFECYCLE] "
                "BaseWorkforce.stop() "
                "completed, state="
                f"{state.workforce._state.name}, "
                f"_running={state.workforce._running}"
            )

        state.workforce.stop_gracefully()
        logger.info("[LIFECYCLE] ✅ Workforce stopped gracefully")

        # Clear workforce to avoid state issues
        state.workforce = None
        logger.info(
            "[LIFECYCLE] Workforce set "
            "to None, will be recreated"
            " on next question"
        )
    else:
        logger.warning(
            "[LIFECYCLE] Cannot skip: workforce is None or project_id mismatch"
        )

    # Mark task as done and preserve context
    state.task_lock.status = Status.done
    end_message = "<summary>Task stopped</summary>Task stopped by user"
    state.task_lock.last_task_result = end_message

    # Add to conversation history
    if state.camel_task is not None:
        task_content: str = state.camel_task.content
        if "=== CURRENT TASK ===" in task_content:
            task_content = task_content.split("=== CURRENT TASK ===")[
                -1
            ].strip()
    else:
        task_content: str = f"Task {state.options.task_id}"

    state.task_lock.add_conversation(
        "task_result",
        {
            "task_content": task_content,
            "task_result": end_message,
            "working_directory": get_working_directory(
                state.options, state.task_lock
            ),
        },
    )

    # Clear camel_task as well
    state.camel_task = None
    logger.info(
        "[LIFECYCLE] Task marked as "
        "done, workforce and "
        "camel_task cleared, "
        "ready for multi-turn"
    )

    events.append(sse_json("end", end_message))
    logger.info("[LIFECYCLE] Sent 'end' SSE event to frontend")
    return events, LoopControl.NORMAL


def handle_start(state: StepSolveState, item) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    events = []
    # Check conversation history length before starting task
    is_exceeded, total_length = check_conversation_history_length(
        state.task_lock
    )
    if is_exceeded:
        logger.error(
            "Cannot start task: "
            "conversation history too "
            f"long ({total_length} chars)"
            " for project "
            f"{state.options.project_id}"
        )
        ctx_msg = (
            "The conversation history "
            "is too long. Please create"
            " a new project to continue."
        )
        events.append(
            sse_json(
                "context_too_long",
                {
                    "message": ctx_msg,
                    "current_length": total_length,
                    "max_length": 100000,
                },
            )
        )
        return events, LoopControl.CONTINUE

    if state.workforce is not None:
        if state.workforce._state.name == "PAUSED":
            # Resume paused workforce
            state.workforce.resume()
            return events, LoopControl.CONTINUE
    else:
        return events, LoopControl.CONTINUE

    state.task_lock.status = Status.processing
    if not state.sub_tasks:
        state.sub_tasks = getattr(state.task_lock, "decompose_sub_tasks", [])
    task = asyncio.create_task(state.workforce.eigent_start(state.sub_tasks))
    state.task_lock.add_background_task(task)
    return events, LoopControl.NORMAL


def handle_task_state(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    # Track completed task results for the end event
    task_state = item.data.get("state", "unknown")
    task_result = item.data.get("result", "")

    if task_state == "DONE" and task_result:
        state.last_completed_task_result = task_result

    return [sse_json("task_state", item.data)], LoopControl.NORMAL


async def handle_end(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    events = []
    logger.info("=" * 80)
    logger.info(
        "[LIFECYCLE] END action "
        "received for project "
        f"{state.options.project_id}, "
        f"task {state.options.task_id}"
    )
    logger.info(
        "[LIFECYCLE] camel_task "
        f"exists: {state.camel_task is not None}"
        ", current status: "
        f"{state.task_lock.status}, workforce"
        f" exists: {state.workforce is not None}"
    )
    if state.workforce is not None:
        logger.info(
            "[LIFECYCLE] Workforce state"
            " at END: _state="
            f"{state.workforce._state.name}"
            ", _running="
            f"{state.workforce._running}"
        )
    logger.info("=" * 80)

    # Prevent duplicate end processing
    if state.task_lock.status == Status.done:
        logger.warning(
            "[LIFECYCLE] END action "
            "received but task already "
            "marked as done. Ignoring "
            "duplicate END action."
        )
        return events, LoopControl.CONTINUE

    if state.camel_task is None:
        logger.warning(
            "END action received but "
            "camel_task is None for "
            "project "
            f"{state.options.project_id}, "
            f"task {state.options.task_id}. "
            "This may indicate multiple "
            "END actions or improper "
            "task lifecycle management."
        )
        # Use item data as final result if camel_task is None
        final_result: str = str(item.data) if item.data else "Task completed"
    else:
        final_result: str = await get_task_result_with_optional_summary(
            state.camel_task, state.options
        )

    state.task_lock.status = Status.done
    state.task_lock.last_task_result = final_result

    # Handle task content - use fallback if camel_task is None
    if state.camel_task is not None:
        task_content: str = state.camel_task.content
        if "=== CURRENT TASK ===" in task_content:
            task_content = task_content.split("=== CURRENT TASK ===")[
                -1
            ].strip()
    else:
        task_content: str = f"Task {state.options.task_id}"

    state.task_lock.add_conversation(
        "task_result",
        {
            "task_content": task_content,
            "task_result": final_result,
            "working_directory": get_working_directory(
                state.options, state.task_lock
            ),
        },
    )

    events.append(sse_json("end", final_result))

    if state.workforce is not None:
        logger.info(
            "[LIFECYCLE] Calling "
            "workforce.stop_gracefully()"
            " for project "
            f"{state.options.project_id}, "
            f"workforce id={id(state.workforce)}"
        )
        state.workforce.stop_gracefully()
        logger.info(
            "[LIFECYCLE] Workforce "
            "stopped gracefully for "
            "project "
            f"{state.options.project_id}"
        )
        state.workforce = None
        logger.info("[LIFECYCLE] Workforce set to None")
    else:
        logger.warning(
            "[LIFECYCLE] Workforce "
            "already None at end "
            "action for project "
            f"{state.options.project_id}"
        )

    state.camel_task = None
    logger.info("[LIFECYCLE] camel_task set to None")

    if state.question_agent is not None:
        state.question_agent.reset()
        logger.info(
            "[LIFECYCLE] question_agent"
            " reset for project "
            f"{state.options.project_id}"
        )
    return events, LoopControl.NORMAL


def handle_supplement(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    events = []
    if state.camel_task is None:
        logger.warning(
            "SUPPLEMENT action received "
            "but camel_task is None for "
            f"project {state.options.project_id}"
        )
        events.append(
            sse_json(
                "error",
                {
                    "message": "Cannot supplement task: "
                    "task not initialized. "
                    "Please start a task "
                    "first."
                },
            )
        )
        return events, LoopControl.CONTINUE
    else:
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
    return events, LoopControl.NORMAL


def handle_budget_not_enough(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    if state.workforce is not None:
        state.workforce.pause()
    return [
        sse_json(Action.budget_not_enough, {"message": "budget not enouth"})
    ], LoopControl.NORMAL


async def handle_stop(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    logger.info("=" * 80)
    logger.info(
        "[LIFECYCLE] STOP action received"
        " for project "
        f"{state.options.project_id}"
    )
    logger.info("=" * 80)
    if state.workforce is not None:
        logger.info(
            "[LIFECYCLE] Workforce exists "
            f"(id={id(state.workforce)}), "
            f"_running={state.workforce._running}"
            ", _state="
            f"{state.workforce._state.name}"
        )
        if state.workforce._running:
            logger.info(
                "[LIFECYCLE] Calling workforce.stop() because _running=True"
            )
            state.workforce.stop()
            logger.info("[LIFECYCLE] workforce.stop() completed")
        logger.info("[LIFECYCLE] Calling workforce.stop_gracefully()")
        state.workforce.stop_gracefully()
        logger.info(
            "[LIFECYCLE] Workforce stopped"
            " for project "
            f"{state.options.project_id}"
        )
    else:
        logger.warning(
            "[LIFECYCLE] Workforce is None"
            " at stop action for project"
            f" {state.options.project_id}"
        )
    logger.info("[LIFECYCLE] Deleting task lock")
    await delete_task_lock(state.task_lock.id)
    logger.info("[LIFECYCLE] Task lock deleted, breaking out of loop")
    return [], LoopControl.BREAK


def handle_pause(state: StepSolveState, item) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    if state.workforce is not None:
        state.workforce.pause()
        logger.info(f"Workforce paused for project {state.options.project_id}")
    else:
        logger.warning(
            "Cannot pause: workforce is "
            "None for project "
            f"{state.options.project_id}"
        )
    return [], LoopControl.NORMAL


def handle_resume(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    if state.workforce is not None:
        state.workforce.resume()
        logger.info(
            f"Workforce resumed for project {state.options.project_id}"
        )
    else:
        logger.warning(
            "Cannot resume: workforce "
            "is None for project "
            f"{state.options.project_id}"
        )
    return [], LoopControl.NORMAL


async def handle_new_agent(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

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
    from app.service.chat_service._step_solve import LoopControl

    logger.info("=" * 80)
    logger.info(
        "[LIFECYCLE] TIMEOUT action "
        "received for project "
        f"{state.options.project_id}, "
        f"task {state.options.task_id}"
    )
    logger.info(f"[LIFECYCLE] Timeout data: {item.data}")
    logger.info("=" * 80)

    # Send timeout error to frontend
    timeout_message = item.data.get("message", "Task execution timeout")
    in_flight = item.data.get("in_flight_tasks", 0)
    pending = item.data.get("pending_tasks", 0)
    timeout_seconds = item.data.get("timeout_seconds", 0)

    return [
        sse_json(
            "error",
            {
                "message": timeout_message,
                "type": "timeout",
                "details": {
                    "in_flight_tasks": in_flight,
                    "pending_tasks": pending,
                    "timeout_seconds": timeout_seconds,
                },
            },
        )
    ], LoopControl.NORMAL


def handle_install_mcp(
    state: StepSolveState, item
) -> tuple[list[str], LoopControl]:
    from app.service.chat_service._step_solve import LoopControl

    events = []
    if state.mcp is None:
        logger.error(
            "Cannot install MCP: mcp "
            "agent not initialized for "
            "project "
            f"{state.options.project_id}"
        )
        events.append(
            sse_json(
                "error",
                {
                    "message": "MCP agent not initialized."
                    " Please start a complex "
                    "task first."
                },
            )
        )
        return events, LoopControl.CONTINUE
    task = asyncio.create_task(install_mcp(state.mcp, item))
    state.task_lock.add_background_task(task)
    return events, LoopControl.NORMAL
