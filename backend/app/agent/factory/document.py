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
import platform

from camel.messages import BaseMessage
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import DOCUMENT_SYS_PROMPT
from app.agent.toolkit.excel_toolkit import ExcelToolkit
from app.agent.toolkit.file_write_toolkit import FileToolkit
from app.agent.toolkit.google_drive_mcp_toolkit import GoogleDriveMCPToolkit
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.markitdown_toolkit import MarkItDownToolkit

# TODO: Remove NoteTakingToolkit and use TerminalToolkit instead
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.pptx_toolkit import PPTXToolkit
from app.agent.toolkit.screenshot_toolkit import ScreenshotToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.skill_toolkit import SkillToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.utils import NOW_STR
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


async def document_agent(options: Chat):
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating document agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )

    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.task_agent
        ).send_message_to_user
    )
    file_write_toolkit = FileToolkit(
        options.project_id, working_directory=working_directory
    )
    pptx_toolkit = PPTXToolkit(
        options.project_id, working_directory=working_directory
    )
    pptx_toolkit = message_integration.register_toolkits(pptx_toolkit)
    mark_it_down_toolkit = MarkItDownToolkit(options.project_id)
    mark_it_down_toolkit = message_integration.register_toolkits(
        mark_it_down_toolkit
    )
    excel_toolkit = ExcelToolkit(
        options.project_id, working_directory=working_directory
    )
    excel_toolkit = message_integration.register_toolkits(excel_toolkit)
    note_toolkit = NoteTakingToolkit(
        options.project_id,
        Agents.document_agent,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    screenshot_toolkit = ScreenshotToolkit(
        options.project_id,
        working_directory=working_directory,
        agent_name=Agents.document_agent,
    )
    # Save reference before registering for toolkits_to_register_agent
    screenshot_toolkit_for_agent_registration = screenshot_toolkit
    screenshot_toolkit = message_integration.register_toolkits(
        screenshot_toolkit
    )

    terminal_toolkit = TerminalToolkit(
        options.project_id,
        Agents.document_agent,
        working_directory=working_directory,
        clone_current_env=True,
    )
    terminal_toolkit = message_integration.register_toolkits(terminal_toolkit)

    google_drive_tools = await GoogleDriveMCPToolkit.get_can_use_tools(
        options.project_id, options.get_bun_env()
    )

    skill_toolkit = SkillToolkit(
        options.project_id,
        Agents.document_agent,
        working_directory=working_directory,
        user_id=options.skill_config_user_id(),
    )
    skill_toolkit = message_integration.register_toolkits(skill_toolkit)

    search_tools = SearchToolkit.get_can_use_tools(
        options.project_id, agent_name=Agents.document_agent
    )
    if search_tools:
        search_tools = message_integration.register_functions(search_tools)
    else:
        search_tools = []

    tools = [
        *file_write_toolkit.get_tools(),
        *pptx_toolkit.get_tools(),
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.document_agent
        ),
        *mark_it_down_toolkit.get_tools(),
        *excel_toolkit.get_tools(),
        *note_toolkit.get_tools(),
        *terminal_toolkit.get_tools(),
        *screenshot_toolkit.get_tools(),
        *google_drive_tools,
        *skill_toolkit.get_tools(),
        *search_tools,
    ]
    system_message = DOCUMENT_SYS_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )

    return agent_model(
        Agents.document_agent,
        BaseMessage.make_assistant_message(
            role_name="Document Agent",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            FileToolkit.toolkit_name(),
            PPTXToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            MarkItDownToolkit.toolkit_name(),
            ExcelToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            ScreenshotToolkit.toolkit_name(),
            GoogleDriveMCPToolkit.toolkit_name(),
            SkillToolkit.toolkit_name(),
            SearchToolkit.toolkit_name(),
        ],
        toolkits_to_register_agent=[
            screenshot_toolkit_for_agent_registration,
        ],
    )
