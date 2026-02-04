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
from app.agent.prompt import DEVELOPER_SYS_PROMPT
from app.agent.utils import NOW_STR
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory
from app.utils.toolkit.human_toolkit import HumanToolkit
from app.utils.toolkit.knowledge_base_toolkit import KnowledgeBaseToolkit

# TODO: Remove NoteTakingToolkit and use TerminalToolkit instead
from app.utils.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.utils.toolkit.screenshot_toolkit import ScreenshotToolkit
from app.utils.toolkit.terminal_toolkit import TerminalToolkit
from app.utils.toolkit.web_deploy_toolkit import WebDeployToolkit


async def developer_agent(options: Chat):
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating developer agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.developer_agent
        ).send_message_to_user
    )
    note_toolkit = NoteTakingToolkit(
        api_task_id=options.project_id,
        agent_name=Agents.developer_agent,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    web_deploy_toolkit = WebDeployToolkit(api_task_id=options.project_id)
    web_deploy_toolkit = message_integration.register_toolkits(
        web_deploy_toolkit
    )
    screenshot_toolkit = ScreenshotToolkit(
        options.project_id, working_directory=working_directory
    )
    screenshot_toolkit = message_integration.register_toolkits(
        screenshot_toolkit
    )

    terminal_toolkit = TerminalToolkit(
        options.project_id,
        Agents.developer_agent,
        working_directory=working_directory,
        safe_mode=True,
        clone_current_env=True,
    )
    terminal_toolkit = message_integration.register_toolkits(terminal_toolkit)
    knowledge_base_toolkit = KnowledgeBaseToolkit(
        api_task_id=options.project_id,
        agent_name=Agents.developer_agent,
    )

    tools = [
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.developer_agent
        ),
        *note_toolkit.get_tools(),
        *web_deploy_toolkit.get_tools(),
        *terminal_toolkit.get_tools(),
        *screenshot_toolkit.get_tools(),
        *knowledge_base_toolkit.get_tools(),
    ]
    system_message = DEVELOPER_SYS_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )

    return agent_model(
        Agents.developer_agent,
        BaseMessage.make_assistant_message(
            role_name="Developer Agent",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            HumanToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            WebDeployToolkit.toolkit_name(),
            KnowledgeBaseToolkit.toolkit_name(),
        ],
    )
