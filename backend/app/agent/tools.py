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

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.agent.toolkit.audio_analysis_toolkit import AudioAnalysisToolkit
from app.agent.toolkit.excel_toolkit import ExcelToolkit
from app.agent.toolkit.file_write_toolkit import FileToolkit
from app.agent.toolkit.github_toolkit import GithubToolkit
from app.agent.toolkit.google_calendar_toolkit import GoogleCalendarToolkit
from app.agent.toolkit.google_drive_mcp_toolkit import GoogleDriveMCPToolkit
from app.agent.toolkit.google_gmail_mcp_toolkit import GoogleGmailMCPToolkit
from app.agent.toolkit.lark_toolkit import LarkToolkit
from app.agent.toolkit.linkedin_toolkit import LinkedInToolkit
from app.agent.toolkit.mcp_search_toolkit import McpSearchToolkit
from app.agent.toolkit.notion_mcp_toolkit import NotionMCPToolkit
from app.agent.toolkit.openai_image_toolkit import OpenAIImageToolkit
from app.agent.toolkit.pptx_toolkit import PPTXToolkit
from app.agent.toolkit.rag_toolkit import RAGToolkit
from app.agent.toolkit.reddit_toolkit import RedditToolkit
from app.agent.toolkit.remote_sub_agent_toolkit import RemoteSubAgentToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.slack_toolkit import SlackToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.toolkit.twitter_toolkit import TwitterToolkit
from app.agent.toolkit.video_analysis_toolkit import VideoAnalysisToolkit
from app.agent.toolkit.video_download_toolkit import VideoDownloaderToolkit
from app.agent.toolkit.whatsapp_toolkit import WhatsAppToolkit
from app.agent.toolkit.workspace_git_toolkit import WorkspaceGitToolkit
from app.component.environment import env
from app.hands.interface import IHands
from app.model.chat import McpServers

logger = logging.getLogger(__name__)

# Toolkits depending on terminal hand
TERMINAL_DEPENDENT_TOOLKITS = frozenset({"terminal_toolkit"})

# Toolkits depending on browser hand
BROWSER_DEPENDENT_TOOLKITS = (
    frozenset()
)  # hybrid_browser not in get_toolkits dict


async def get_toolkits(
    tools: list[str],
    agent_name: str,
    api_task_id: str,
    hands: IHands | None = None,
):
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
        "linkedin_toolkit": LinkedInToolkit,
        "lark_toolkit": LarkToolkit,
        "mcp_search_toolkit": McpSearchToolkit,
        "notion_mcp_toolkit": NotionMCPToolkit,
        "pptx_toolkit": PPTXToolkit,
        "rag_toolkit": RAGToolkit,
        "reddit_toolkit": RedditToolkit,
        "remote_sub_agent_toolkit": RemoteSubAgentToolkit,
        "search_toolkit": SearchToolkit,
        "slack_toolkit": SlackToolkit,
        "terminal_toolkit": TerminalToolkit,
        "twitter_toolkit": TwitterToolkit,
        "video_analysis_toolkit": VideoAnalysisToolkit,
        "video_download_toolkit": VideoDownloaderToolkit,
        "whatsapp_toolkit": WhatsAppToolkit,
        "workspace_git_toolkit": WorkspaceGitToolkit,
    }
    res = []
    for item in tools:
        if item in toolkits:
            # Filter by Brain capabilities
            if hands is not None:
                if (
                    item in TERMINAL_DEPENDENT_TOOLKITS
                    and not hands.can_execute_terminal()
                ):
                    logger.info(
                        f"Skipping {item} for {agent_name}: no terminal hand"
                    )
                    continue
                if (
                    item in BROWSER_DEPENDENT_TOOLKITS
                    and not hands.can_use_browser()
                ):
                    logger.info(
                        f"Skipping {item} for {agent_name}: no browser hand"
                    )
                    continue
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


async def get_mcp_tools(
    mcp_server: McpServers,
    hands: IHands | None = None,
    *,
    account: str = "",
    project_id: str | None = None,
):
    logger.info(
        f"Getting MCP tools for {len(mcp_server['mcpServers'])} servers"
    )
    if len(mcp_server["mcpServers"]) == 0:
        return []

    # Filter by mcp hand capability
    mcp_servers = mcp_server["mcpServers"]
    if hands is not None:
        filtered = {
            name: cfg
            for name, cfg in mcp_servers.items()
            if hands.can_use_mcp(name)
        }
        if len(filtered) == 0:
            logger.info(
                "No MCP servers allowed by mcp hand, skipping MCP tools"
            )
            return []
        mcp_server = {**mcp_server, "mcpServers": filtered}

    from app.service.mcp_oauth import (
        connect_mcp_toolkits,
        emit_mcp_notice,
        is_mcp_auth_failure,
        prepare_mcp_oauth,
    )
    from app.service.task import get_task_lock_if_exists

    config_dict = await prepare_mcp_oauth(
        mcp_server,
        account=account,
        project_id=project_id,
        strict=False,
    )
    task_lock = get_task_lock_if_exists(project_id) if project_id else None

    async def connector_failed(name: str, exc: BaseException) -> None:
        reason = (
            "mcp_auth_failed"
            if is_mcp_auth_failure(exc)
            else "connection_failed"
        )
        logger.warning("MCP connector %r failed (%s)", name, reason)
        await emit_mcp_notice(project_id, name, reason)

    async def disconnect(toolkit) -> None:
        try:
            await toolkit.disconnect()
        except Exception:
            logger.warning("Failed to disconnect unavailable MCP connector")

    started = []
    for name, server_config in config_dict["mcpServers"].items():
        if server_config.get("command"):
            server_config.setdefault("env", {}).setdefault(
                "MCP_REMOTE_CONFIG_DIR",
                env(
                    "MCP_REMOTE_CONFIG_DIR", os.path.expanduser("~/.mcp-auth")
                ),
            )
        try:
            toolkit = MCPToolkit(
                config_dict={"mcpServers": {name: server_config}},
                timeout=180,
                skip_failed=False,
            )
        except Exception as exc:
            await connector_failed(name, exc)
            continue
        if task_lock is not None:
            task_lock.register_toolkit(toolkit)
        started.append((name, toolkit))

    # Each connector connects separately so one failure cannot hide another's
    # tools, but independent connectors still start concurrently.
    try:
        failures = await connect_mcp_toolkits(
            [toolkit for _, toolkit in started]
        )
    except asyncio.CancelledError:
        for _, toolkit in started:
            await disconnect(toolkit)
        raise
    tools = []
    for (name, toolkit), failure in zip(started, failures):
        if failure is None:
            tools.extend(toolkit.get_tools())
            continue
        await connector_failed(name, failure)
        await disconnect(toolkit)
    return tools
