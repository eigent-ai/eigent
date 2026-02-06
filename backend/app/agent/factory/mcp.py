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
import uuid

from camel.models import ModelFactory

from app.agent.listen_chat_agent import ListenChatAgent, logger
from app.agent.prompt import MCP_SYS_PROMPT
from app.agent.tools import get_mcp_tools
from app.model.chat import Chat
from app.service.task import ActionCreateAgentData, Agents, get_task_lock
from app.utils.toolkit.mcp_search_toolkit import McpSearchToolkit


async def mcp_agent(options: Chat):
    logger.info(
        f"Creating MCP agent for project: {options.project_id} "
        f"with {len(options.installed_mcp['mcpServers'])} MCP servers"
    )
    tools = [
        *McpSearchToolkit(options.project_id).get_tools(),
    ]
    if len(options.installed_mcp["mcpServers"]) > 0:
        try:
            mcp_tools = await get_mcp_tools(options.installed_mcp)
            logger.info(
                f"Retrieved {len(mcp_tools)} MCP tools "
                f"for task {options.project_id}"
            )
            if mcp_tools:
                tool_names = [
                    (
                        tool.get_function_name()
                        if hasattr(tool, "get_function_name")
                        else str(tool)
                    )
                    for tool in mcp_tools
                ]
                logger.debug(f"MCP tools: {tool_names}")
            tools = [*tools, *mcp_tools]
        except Exception as e:
            logger.debug(repr(e))

    task_lock = get_task_lock(options.project_id)
    agent_id = str(uuid.uuid4())
    logger.info(
        f"Creating MCP agent: {Agents.mcp_agent} with id: "
        f"{agent_id} for task: {options.project_id}"
    )
    asyncio.create_task(
        task_lock.put_queue(
            ActionCreateAgentData(
                data={
                    "agent_name": Agents.mcp_agent,
                    "agent_id": agent_id,
                    "tools": [
                        key
                        for key in options.installed_mcp["mcpServers"].keys()
                    ],
                }
            )
        )
    )
    return ListenChatAgent(
        options.project_id,
        Agents.mcp_agent,
        system_message=MCP_SYS_PROMPT,
        model=ModelFactory.create(
            model_platform=options.model_platform,
            model_type=options.model_type,
            api_key=options.api_key,
            url=options.api_url,
            model_config_dict=(
                {
                    "user": str(options.project_id),
                }
                if options.is_cloud()
                else None
            ),
            timeout=600,  # 10 minutes
            **{
                k: v
                for k, v in (options.extra_params or {}).items()
                if k not in ["model_platform", "model_type", "api_key", "url"]
            },
        ),
        # output_language=options.language,
        tools=tools,
        agent_id=agent_id,
    )
