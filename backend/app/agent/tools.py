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
import hashlib
import json
import logging
import os
from functools import lru_cache

from camel.toolkits import MCPToolkit

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.agent.toolkit.audio_analysis_toolkit import AudioAnalysisToolkit
from app.agent.toolkit.excel_toolkit import ExcelToolkit
from app.agent.toolkit.file_write_toolkit import FileToolkit
from app.agent.toolkit.github_toolkit import GithubToolkit
from app.agent.toolkit.google_calendar_toolkit import GoogleCalendarToolkit
from app.agent.toolkit.google_drive_mcp_toolkit import GoogleDriveMCPToolkit
from app.agent.toolkit.google_gmail_mcp_toolkit import GoogleGmailMCPToolkit
from app.agent.toolkit.image_analysis_toolkit import ImageAnalysisToolkit
from app.agent.toolkit.lark_toolkit import LarkToolkit
from app.agent.toolkit.linkedin_toolkit import LinkedInToolkit
from app.agent.toolkit.mcp_search_toolkit import McpSearchToolkit
from app.agent.toolkit.notion_mcp_toolkit import NotionMCPToolkit
from app.agent.toolkit.openai_image_toolkit import OpenAIImageToolkit
from app.agent.toolkit.pptx_toolkit import PPTXToolkit
from app.agent.toolkit.rag_toolkit import RAGToolkit
from app.agent.toolkit.reddit_toolkit import RedditToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.slack_toolkit import SlackToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.toolkit.twitter_toolkit import TwitterToolkit
from app.agent.toolkit.video_analysis_toolkit import VideoAnalysisToolkit
from app.agent.toolkit.video_download_toolkit import VideoDownloaderToolkit
from app.agent.toolkit.whatsapp_toolkit import WhatsAppToolkit
from app.component.environment import env
from app.model.chat import McpServers

logger = logging.getLogger(__name__)

# Toolkit registry - maps toolkit names to classes
TOOLKIT_REGISTRY: dict[str, type[AbstractToolkit]] = {
    "audio_analysis_toolkit": AudioAnalysisToolkit,
    "openai_image_toolkit": OpenAIImageToolkit,
    "excel_toolkit": ExcelToolkit,
    "file_write_toolkit": FileToolkit,
    "github_toolkit": GithubToolkit,
    "google_calendar_toolkit": GoogleCalendarToolkit,
    "google_drive_mcp_toolkit": GoogleDriveMCPToolkit,
    "google_gmail_mcp_toolkit": GoogleGmailMCPToolkit,
    "image_analysis_toolkit": ImageAnalysisToolkit,
    "linkedin_toolkit": LinkedInToolkit,
    "lark_toolkit": LarkToolkit,
    "mcp_search_toolkit": McpSearchToolkit,
    "notion_mcp_toolkit": NotionMCPToolkit,
    "pptx_toolkit": PPTXToolkit,
    "rag_toolkit": RAGToolkit,
    "reddit_toolkit": RedditToolkit,
    "search_toolkit": SearchToolkit,
    "slack_toolkit": SlackToolkit,
    "terminal_toolkit": TerminalToolkit,
    "twitter_toolkit": TwitterToolkit,
    "video_analysis_toolkit": VideoAnalysisToolkit,
    "video_download_toolkit": VideoDownloaderToolkit,
    "whatsapp_toolkit": WhatsAppToolkit,
}


def _get_toolkit_cache_key(toolkit_name: str, api_task_id: str) -> str:
    """Generate cache key for toolkit tools."""
    return f"{toolkit_name}:{api_task_id}"


def _get_mcp_cache_key(mcp_server: McpServers) -> str:
    """Generate cache key for MCP server config."""
    # Create a deterministic hash from the server config
    config_str = json.dumps(mcp_server, sort_keys=True, default=str)
    return hashlib.sha256(config_str.encode()).hexdigest()[:16]


# In-memory cache for toolkit tools: dict[cache_key, tools_list]
_toolkit_tools_cache: dict[str, list] = {}
# In-memory cache for MCP toolkit instances: dict[cache_key, MCPToolkit]
_mcp_toolkit_cache: dict[str, MCPToolkit] = {}


async def get_toolkits(tools: list[str], agent_name: str, api_task_id: str):
    """Get tools from specified toolkits with caching.

    Tools are cached per (toolkit_name, api_task_id) to avoid
    recreating the same tools on repeated calls.
    """
    logger.info(
        f"Getting toolkits for agent: {agent_name}, "
        f"task: {api_task_id}, tools: {tools}"
    )
    res = []
    for toolkit_name in tools:
        if toolkit_name not in TOOLKIT_REGISTRY:
            logger.warning(f"Toolkit {toolkit_name} not found for agent {agent_name}")
            continue

        # Check cache first
        cache_key = _get_toolkit_cache_key(toolkit_name, api_task_id)
        if cache_key in _toolkit_tools_cache:
            logger.debug(f"Using cached tools for {toolkit_name}")
            res.extend(_toolkit_tools_cache[cache_key])
            continue

        # Get tools from toolkit
        toolkit_class = TOOLKIT_REGISTRY[toolkit_name]
        toolkit_tools = toolkit_class.get_can_use_tools(api_task_id)
        toolkit_tools = (
            await toolkit_tools
            if asyncio.iscoroutine(toolkit_tools)
            else toolkit_tools
        )

        # Cache the result
        _toolkit_tools_cache[cache_key] = toolkit_tools
        logger.debug(f"Cached tools for {toolkit_name}, count: {len(toolkit_tools)}")

        res.extend(toolkit_tools)

    return res


def clear_toolkit_cache(api_task_id: str | None = None):
    """Clear toolkit cache.

    Args:
        api_task_id: If provided, only clear cache for this task ID.
                     If None, clear all cache.
    """
    global _toolkit_tools_cache
    if api_task_id is None:
        _toolkit_tools_cache = {}
        logger.info("Cleared all toolkit caches")
    else:
        # Clear only cache entries for this task
        keys_to_remove = [k for k in _toolkit_tools_cache if k.endswith(f":{api_task_id}")]
        for key in keys_to_remove:
            del _toolkit_tools_cache[key]
        logger.info(f"Cleared toolkit cache for task {api_task_id}, entries: {len(keys_to_remove)}")


async def get_mcp_tools(mcp_server: McpServers):
    """Get MCP tools with connection caching.

    Reuses existing connections when possible to avoid
    repeated authentication overhead.
    """
    logger.info(
        f"Getting MCP tools for {len(mcp_server['mcpServers'])} servers"
    )
    if len(mcp_server["mcpServers"]) == 0:
        return []

    # Generate cache key from server config
    cache_key = _get_mcp_cache_key(mcp_server)

    # Check if we have a cached connected toolkit
    if cache_key in _mcp_toolkit_cache:
        cached_toolkit = _mcp_toolkit_cache[cache_key]
        try:
            # Try to use cached toolkit - get tools from it
            tools = cached_toolkit.get_tools()
            if tools:
                logger.info(f"Using cached MCP toolkit, tools: {len(tools)}")
                return tools
            # If tools are empty, need to reconnect
        except Exception as e:
            logger.warning(f"Cached MCP toolkit error: {e}, reconnecting")

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

        # Cache the connected toolkit for reuse
        _mcp_toolkit_cache[cache_key] = mcp_toolkit

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


def clear_mcp_cache(server_config_hash: str | None = None):
    """Clear MCP toolkit cache.

    Args:
        server_config_hash: If provided, only clear this specific cache entry.
                           If None, clear all MCP cache.
    """
    global _mcp_toolkit_cache
    if server_config_hash is None:
        _mcp_toolkit_cache = {}
        logger.info("Cleared all MCP toolkit caches")
    elif server_config_hash in _mcp_toolkit_cache:
        del _mcp_toolkit_cache[server_config_hash]
        logger.info(f"Cleared MCP cache for {server_config_hash}")
