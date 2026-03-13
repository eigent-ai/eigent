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
import datetime
import logging
import platform

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
from app.agent.factory.workforce_agents import (
    create_coordinator_and_task_agents,
    create_new_worker_agent,
)
from app.agent.listen_chat_agent import ListenChatAgent
from app.agent.prompt import (
    AGENT_ENVIRONMENT_PROMPT,
    BROWSER_WORKER_DESCRIPTION,
    DEVELOPER_WORKER_DESCRIPTION,
    DOCUMENT_WORKER_DESCRIPTION,
    MULTI_MODAL_WORKER_DESCRIPTION,
)
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.tools import get_mcp_tools, get_toolkits
from app.model.chat import Chat, NewAgent, TaskContent, sse_json
from app.service.task import ActionInstallMcpData, ActionNewAgent
from app.utils.event_loop_utils import set_main_event_loop
from app.utils.file_utils import get_working_directory
from app.utils.telemetry.workforce_metrics import WorkforceMetricsCallback
from app.utils.workforce import Workforce

logger = logging.getLogger(__name__)


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


async def new_agent_model(
    data: NewAgent | ActionNewAgent, options: Chat
) -> ListenChatAgent:
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
    enhanced_description = (
        data.description
        + "\n"
        + AGENT_ENVIRONMENT_PROMPT.format(
            platform_system=platform.system(),
            platform_machine=platform.machine(),
            working_directory=working_directory,
            current_date=datetime.date.today(),
        )
    )

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
    workforce.add_single_agent_worker(DEVELOPER_WORKER_DESCRIPTION, developer)
    workforce.add_single_agent_worker(BROWSER_WORKER_DESCRIPTION, searcher)
    workforce.add_single_agent_worker(DOCUMENT_WORKER_DESCRIPTION, documenter)
    workforce.add_single_agent_worker(
        MULTI_MODAL_WORKER_DESCRIPTION, multi_modaler
    )

    return workforce, mcp
