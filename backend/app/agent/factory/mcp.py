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
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.factory.remote_sub_agent import (
    attach_remote_sub_agent_if_enabled,
    remote_sub_agent_enabled,
)
from app.agent.listen_chat_agent import logger
from app.agent.prompt import MCP_SYS_PROMPT
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.mcp_search_toolkit import McpSearchToolkit
from app.agent.tools import get_mcp_tools
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


async def mcp_agent(options: Chat):
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating MCP agent for project: {options.project_id} "
        f"with {len(options.installed_mcp['mcpServers'])} MCP servers"
    )
    message_integration = None
    if remote_sub_agent_enabled(options, working_directory):
        message_integration = ToolkitMessageIntegration(
            message_handler=HumanToolkit(
                options.project_id, Agents.mcp_agent
            ).send_message_to_user
        )
    tools = [
        *McpSearchToolkit(options.project_id).get_tools(),
    ]
    tool_names = [McpSearchToolkit.toolkit_name()]
    if len(options.installed_mcp["mcpServers"]) > 0:
        try:
            mcp_tools = await get_mcp_tools(options.installed_mcp)
            logger.info(
                f"Retrieved {len(mcp_tools)} MCP tools "
                f"for task {options.project_id}"
            )
            if mcp_tools:
                mcp_tool_names = [
                    (
                        tool.get_function_name()
                        if hasattr(tool, "get_function_name")
                        else str(tool)
                    )
                    for tool in mcp_tools
                ]
                logger.debug(f"MCP tools: {mcp_tool_names}")
                tool_names.extend(mcp_tool_names)
            tools = [*tools, *mcp_tools]
        except Exception as e:
            logger.debug(repr(e))

    system_message = attach_remote_sub_agent_if_enabled(
        options=options,
        agent_name=Agents.mcp_agent,
        working_directory=working_directory,
        tools=tools,
        tool_names=tool_names,
        system_message=MCP_SYS_PROMPT,
        local_tool_description="local MCP or search tools",
        message_integration=message_integration,
    )

    return agent_model(
        Agents.mcp_agent,
        system_message,
        options,
        tools,
        tool_names=[key for key in options.installed_mcp["mcpServers"].keys()],
    )
