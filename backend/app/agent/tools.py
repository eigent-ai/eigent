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

from camel.toolkits import MCPToolkit

from app.component.environment import env
from app.model.chat import McpServers
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.utils.toolkit.audio_analysis_toolkit import AudioAnalysisToolkit
from app.utils.toolkit.excel_toolkit import ExcelToolkit
from app.utils.toolkit.file_write_toolkit import FileToolkit
from app.utils.toolkit.github_toolkit import GithubToolkit
from app.utils.toolkit.google_calendar_toolkit import GoogleCalendarToolkit
from app.utils.toolkit.google_drive_mcp_toolkit import GoogleDriveMCPToolkit
from app.utils.toolkit.google_gmail_mcp_toolkit import GoogleGmailMCPToolkit
from app.utils.toolkit.image_analysis_toolkit import ImageAnalysisToolkit
from app.utils.toolkit.knowledge_base_toolkit import KnowledgeBaseToolkit
from app.utils.toolkit.lark_toolkit import LarkToolkit
from app.utils.toolkit.linkedin_toolkit import LinkedInToolkit
from app.utils.toolkit.mcp_search_toolkit import McpSearchToolkit
from app.utils.toolkit.notion_mcp_toolkit import NotionMCPToolkit
from app.utils.toolkit.openai_image_toolkit import OpenAIImageToolkit
from app.utils.toolkit.pptx_toolkit import PPTXToolkit
from app.utils.toolkit.reddit_toolkit import RedditToolkit
from app.utils.toolkit.search_toolkit import SearchToolkit
from app.utils.toolkit.slack_toolkit import SlackToolkit
from app.utils.toolkit.terminal_toolkit import TerminalToolkit
from app.utils.toolkit.twitter_toolkit import TwitterToolkit
from app.utils.toolkit.video_analysis_toolkit import VideoAnalysisToolkit
from app.utils.toolkit.video_download_toolkit import VideoDownloaderToolkit
from app.utils.toolkit.whatsapp_toolkit import WhatsAppToolkit

logger = logging.getLogger(__name__)


async def get_toolkits(tools: list[str], agent_name: str, api_task_id: str):
    logger.info(
        f"Getting toolkits for agent: {agent_name}, "
        f"task: {api_task_id}, tools: {tools}"
    )
    toolkits = {
        "audio_analysis_toolkit": AudioAnalysisToolkit,
        "openai_image_toolkit": OpenAIImageToolkit,
        "excel_toolkit": ExcelToolkit,
        "file_write_toolkit": FileToolkit,
        "github_toolkit": GithubToolkit,
        "google_calendar_toolkit": GoogleCalendarToolkit,
        "google_drive_mcp_toolkit": GoogleDriveMCPToolkit,
        "google_gmail_mcp_toolkit": GoogleGmailMCPToolkit,
        "image_analysis_toolkit": ImageAnalysisToolkit,
        "knowledge_base_toolkit": KnowledgeBaseToolkit,
        "linkedin_toolkit": LinkedInToolkit,
        "lark_toolkit": LarkToolkit,
        "mcp_search_toolkit": McpSearchToolkit,
        "notion_mcp_toolkit": NotionMCPToolkit,
        "pptx_toolkit": PPTXToolkit,
        "reddit_toolkit": RedditToolkit,
        "search_toolkit": SearchToolkit,
        "slack_toolkit": SlackToolkit,
        "terminal_toolkit": TerminalToolkit,
        "twitter_toolkit": TwitterToolkit,
        "video_analysis_toolkit": VideoAnalysisToolkit,
        "video_download_toolkit": VideoDownloaderToolkit,
        "whatsapp_toolkit": WhatsAppToolkit,
    }
    res = []
    for item in tools:
        if item in toolkits:
            toolkit: AbstractToolkit = toolkits[item]
            toolkit.agent_name = agent_name
            toolkit_tools = toolkit.get_can_use_tools(api_task_id)
            toolkit_tools = (
                await toolkit_tools
                if asyncio.iscoroutine(toolkit_tools)
                else toolkit_tools
            )
            res.extend(toolkit_tools)
        else:
            logger.warning(f"Toolkit {item} not found for agent {agent_name}")
    return res


async def get_mcp_tools(mcp_server: McpServers):
    logger.info(
        f"Getting MCP tools for {len(mcp_server['mcpServers'])} servers"
    )
    if len(mcp_server["mcpServers"]) == 0:
        return []

    # Ensure unified auth directory for all mcp-remote servers to avoid
    # re-authentication on each task
    config_dict = {**mcp_server}
    for server_config in config_dict["mcpServers"].values():
        if "env" not in server_config:
            server_config["env"] = {}
        # Set global auth directory to persist authentication across tasks
        if "MCP_REMOTE_CONFIG_DIR" not in server_config["env"]:
            server_config["env"]["MCP_REMOTE_CONFIG_DIR"] = env(
                "MCP_REMOTE_CONFIG_DIR", os.path.expanduser("~/.mcp-auth")
            )

    mcp_toolkit = None
    try:
        mcp_toolkit = MCPToolkit(config_dict=config_dict, timeout=180)
        await mcp_toolkit.connect()

        logger.info(
            f"Successfully connected to MCP toolkit with "
            f"{len(mcp_server['mcpServers'])} servers"
        )
        tools = mcp_toolkit.get_tools()
        if tools:
            tool_names = [
                (
                    tool.get_function_name()
                    if hasattr(tool, "get_function_name")
                    else str(tool)
                )
                for tool in tools
            ]
            logging.debug(f"MCP tool names: {tool_names}")
        return tools
    except asyncio.CancelledError:
        logger.info("MCP connection cancelled during get_mcp_tools")
        return []
    except Exception as e:
        logger.error(f"Failed to connect MCP toolkit: {e}", exc_info=True)
        return []
