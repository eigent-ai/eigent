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
from camel.messages import BaseMessage

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import SOCIAL_MEDIA_SYS_PROMPT
from app.agent.toolkit.google_calendar_toolkit import GoogleCalendarToolkit
from app.agent.toolkit.google_gmail_mcp_toolkit import GoogleGmailMCPToolkit
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.linkedin_toolkit import LinkedInToolkit

# TODO: Remove NoteTakingToolkit and use TerminalToolkit instead
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.notion_mcp_toolkit import NotionMCPToolkit
from app.agent.toolkit.reddit_toolkit import RedditToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.toolkit.twitter_toolkit import TwitterToolkit
from app.agent.toolkit.whatsapp_toolkit import WhatsAppToolkit
from app.agent.utils import NOW_STR
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


async def social_media_agent(options: Chat):
    """
    Agent to handling tasks related to social media including:
    WhatsApp, Twitter, LinkedIn, Reddit, Notion, Slack, Discord
    and Google Suite.
    """
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating social media agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )
    tools = [
        *WhatsAppToolkit.get_can_use_tools(options.project_id),
        *TwitterToolkit.get_can_use_tools(options.project_id),
        *LinkedInToolkit.get_can_use_tools(options.project_id),
        *RedditToolkit.get_can_use_tools(options.project_id),
        *await NotionMCPToolkit.get_can_use_tools(options.project_id),
        # *SlackToolkit.get_can_use_tools(options.project_id),
        *await GoogleGmailMCPToolkit.get_can_use_tools(
            options.project_id, options.get_bun_env()
        ),
        *GoogleCalendarToolkit.get_can_use_tools(options.project_id),
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.social_media_agent
        ),
        *TerminalToolkit(
            options.project_id,
            agent_name=Agents.social_media_agent,
            working_directory=working_directory,
            clone_current_env=True,
        ).get_tools(),
        *NoteTakingToolkit(
            options.project_id,
            Agents.social_media_agent,
            working_directory=working_directory,
        ).get_tools(),
        *SearchToolkit.get_can_use_tools(options.project_id),
        # *DiscordToolkit(options.project_id).get_tools(),
        # *GoogleSuiteToolkit(options.project_id).get_tools(),
    ]
    return agent_model(
        Agents.social_media_agent,
        BaseMessage.make_assistant_message(
            role_name="Social Media Agent",
            content=SOCIAL_MEDIA_SYS_PROMPT.format(
                working_directory=working_directory, now_str=NOW_STR
            ),
        ),
        options,
        tools,
        tool_names=[
            WhatsAppToolkit.toolkit_name(),
            TwitterToolkit.toolkit_name(),
            LinkedInToolkit.toolkit_name(),
            RedditToolkit.toolkit_name(),
            NotionMCPToolkit.toolkit_name(),
            GoogleGmailMCPToolkit.toolkit_name(),
            GoogleCalendarToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            SearchToolkit.toolkit_name(),
        ],
    )
