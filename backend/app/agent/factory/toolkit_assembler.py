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

import logging
import os
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from camel.toolkits import (
    FunctionTool,
    MCPToolkit,
    PlanningWorktreeToolkit,
    RegisteredAgentToolkit,
    ToolkitMessageIntegration,
    WebFetchToolkit,
)

from app.agent.toolkit.depth_limited_agent_toolkit import (
    DepthLimitedAgentToolkit,
)
from app.agent.toolkit.file_write_toolkit import FileToolkit
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.hybrid_browser_toolkit import HybridBrowserToolkit
from app.agent.toolkit.observable_todo_toolkit import ObservableTodoToolkit
from app.agent.toolkit.screenshot_toolkit import ScreenshotToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.skill_toolkit import SkillToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.toolkit.web_deploy_toolkit import WebDeployToolkit
from app.component.environment import env
from app.hands.interface import IHands
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.browser_launcher import normalize_cdp_url

logger = logging.getLogger("toolkit_assembler")

DEFAULT_SINGLE_AGENT_TOOLKIT_CONFIG: dict[str, Any] = {
    "human": {"enabled": True},
    "file": {"enabled": True},
    "web_deploy": {"enabled": True},
    "screenshot": {"enabled": True},
    "skill": {"enabled": True},
    "todo": {"enabled": True},
    "search": {"enabled": True},
    "browser": {"enabled": True},
    "terminal": {"enabled": True},
    "web_fetch": {"enabled": True},
    "planning_worktree": {"enabled": True},
    "mcp": {"enabled": True},
    "agent": {"enabled": True},
}


@dataclass
class ToolkitAssembly:
    tools: list[FunctionTool | Callable] = field(default_factory=list)
    tool_names: list[str] = field(default_factory=list)
    toolkits_to_register_agent: list[RegisteredAgentToolkit] = field(
        default_factory=list
    )
    observable_todo_toolkit: ObservableTodoToolkit | None = None
    browser_toolkit: HybridBrowserToolkit | None = None
    browser_port: int | None = None
    browser_cdp_url: str | None = None
    browser_session_id: str | None = None
    browser_owned_by_hands: bool = False

    def add_tools(
        self,
        tools: list[FunctionTool | Callable],
        toolkit_name: str,
    ) -> None:
        if not tools:
            return
        _tag_tools(tools, toolkit_name)
        self.tools.extend(tools)
        if toolkit_name not in self.tool_names:
            self.tool_names.append(toolkit_name)


def _merged_config(options: Chat) -> dict[str, Any]:
    config = {
        key: dict(value) if isinstance(value, dict) else value
        for key, value in DEFAULT_SINGLE_AGENT_TOOLKIT_CONFIG.items()
    }
    for key, value in (options.toolkit_config or {}).items():
        config[key] = value
    return config


def _enabled(config: dict[str, Any], name: str, default: bool = True) -> bool:
    value = config.get(name)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, dict):
        return bool(value.get("enabled", default))
    return bool(value)


def _options(config: dict[str, Any], name: str) -> dict[str, Any]:
    value = config.get(name)
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if key != "enabled"}


def _tag_tools(
    tools: list[FunctionTool | Callable], toolkit_name: str
) -> None:
    for tool in tools:
        try:
            tool._toolkit_name = toolkit_name
        except Exception:
            pass


def _get_browser_port(browser: dict) -> int:
    raw_port = browser.get("port")
    if raw_port is not None:
        return int(raw_port)

    raw_endpoint = browser.get("endpoint") or browser.get("cdp_url")
    if raw_endpoint:
        _, _, port = normalize_cdp_url(str(raw_endpoint))
        return port

    return int(env("browser_port", "9222"))


def _get_browser_endpoint(browser: dict) -> str:
    raw_endpoint = browser.get("endpoint") or browser.get("cdp_url")
    if raw_endpoint:
        endpoint, _, _ = normalize_cdp_url(str(raw_endpoint))
        return endpoint

    return f"http://localhost:{_get_browser_port(browser)}"


def _browser_enabled_tools() -> list[str]:
    return [
        "browser_click",
        "browser_type",
        "browser_back",
        "browser_forward",
        "browser_select",
        "browser_console_exec",
        "browser_console_view",
        "browser_switch_tab",
        "browser_enter",
        "browser_visit_page",
        "browser_scroll",
        "browser_sheet_read",
        "browser_sheet_input",
        "browser_get_page_snapshot",
        "browser_open",
        "browser_upload_file",
        "browser_download_file",
    ]


def _mcp_config(options: Chat, hands: IHands | None) -> dict[str, Any] | None:
    servers = dict((options.installed_mcp or {}).get("mcpServers", {}))
    if not servers:
        return None

    if hands is not None:
        servers = {
            name: cfg
            for name, cfg in servers.items()
            if hands.can_use_mcp(name)
        }
        if not servers:
            logger.info("Skipping MCPToolkit: no MCP servers allowed")
            return None

    normalized_servers = {}
    for name, cfg in servers.items():
        server_cfg = dict(cfg)
        server_env = dict(server_cfg.get("env", {}))
        server_env.setdefault(
            "MCP_REMOTE_CONFIG_DIR",
            env("MCP_REMOTE_CONFIG_DIR", os.path.expanduser("~/.mcp-auth")),
        )
        server_cfg["env"] = server_env
        normalized_servers[name] = server_cfg

    return {"mcpServers": normalized_servers}


async def assemble_single_agent_toolkits(
    options: Chat,
    *,
    task_id: str,
    working_directory: str,
    hands: IHands | None,
    can_delegate: bool,
    current_depth: int = 0,
    max_depth: int = 1,
) -> ToolkitAssembly:
    config = _merged_config(options)
    assembly = ToolkitAssembly()

    human_toolkit = HumanToolkit(options.project_id, Agents.single_agent)
    message_integration = ToolkitMessageIntegration(
        message_handler=human_toolkit.send_message_to_user
    )

    if _enabled(config, "human"):
        assembly.add_tools(
            human_toolkit.get_tools(), HumanToolkit.toolkit_name()
        )

    if _enabled(config, "file"):
        file_options = {
            "working_directory": working_directory,
            **_options(config, "file"),
        }
        toolkit = FileToolkit(
            options.project_id,
            **file_options,
        )
        toolkit.agent_name = Agents.single_agent
        toolkit = message_integration.register_toolkits(toolkit)
        assembly.add_tools(toolkit.get_tools(), FileToolkit.toolkit_name())

    if _enabled(config, "web_deploy"):
        toolkit = WebDeployToolkit(
            api_task_id=options.project_id,
            **_options(config, "web_deploy"),
        )
        toolkit.agent_name = Agents.single_agent
        toolkit = message_integration.register_toolkits(toolkit)
        assembly.add_tools(
            toolkit.get_tools(), WebDeployToolkit.toolkit_name()
        )

    if _enabled(config, "screenshot"):
        screenshot_options = {
            "working_directory": working_directory,
            "agent_name": Agents.single_agent,
            **_options(config, "screenshot"),
        }
        toolkit = ScreenshotToolkit(
            options.project_id,
            **screenshot_options,
        )
        assembly.toolkits_to_register_agent.append(toolkit)
        registered = message_integration.register_toolkits(toolkit)
        assembly.add_tools(
            registered.get_tools(), ScreenshotToolkit.toolkit_name()
        )

    if _enabled(config, "skill"):
        skill_options = {
            "working_directory": working_directory,
            "user_id": options.skill_config_user_id(),
            **_options(config, "skill"),
        }
        toolkit = SkillToolkit(
            options.project_id,
            Agents.single_agent,
            **skill_options,
        )
        toolkit = message_integration.register_toolkits(toolkit)
        assembly.add_tools(toolkit.get_tools(), SkillToolkit.toolkit_name())

    if _enabled(config, "todo"):
        todo_options = {
            "working_dir": working_directory,
            **_options(config, "todo"),
        }
        todo_toolkit = ObservableTodoToolkit(
            api_task_id=options.project_id,
            task_id=task_id,
            **todo_options,
        )
        todo_toolkit.agent_name = Agents.single_agent
        assembly.observable_todo_toolkit = todo_toolkit
        assembly.add_tools(
            todo_toolkit.get_tools(), ObservableTodoToolkit.toolkit_name()
        )

    if _enabled(config, "search"):
        search_tools = SearchToolkit.get_can_use_tools(
            options.project_id, agent_name=Agents.single_agent
        )
        if search_tools:
            search_tools = message_integration.register_functions(search_tools)
            assembly.add_tools(search_tools, SearchToolkit.toolkit_name())

    if _enabled(config, "browser") and (
        hands is None or hands.can_use_browser()
    ):
        toolkit_session_id = str(uuid.uuid4())[:8]
        selected_port: int | None = None
        cdp_url: str | None = None
        cdp_owned_by_hands = False

        if options.cdp_browsers:
            # Reuse the same pool as the Browser Agent so concurrent projects
            # do not accidentally claim the same CDP browser tab set.
            from app.agent.factory.browser import _cdp_pool_manager

            selected_browser = _cdp_pool_manager.acquire_browser(
                options.cdp_browsers,
                toolkit_session_id,
                options.task_id,
            )
            if selected_browser is None:
                selected_browser = options.cdp_browsers[0]
                logger.warning(
                    "No available CDP browser in pool for Single Agent; "
                    "using first browser",
                    extra={
                        "project_id": options.project_id,
                        "task_id": options.task_id,
                    },
                )
            selected_port = _get_browser_port(selected_browser)
            cdp_url = _get_browser_endpoint(selected_browser)
        else:
            existing_cdp_url = env("EIGENT_CDP_URL", "").strip()
            selected_port = int(env("browser_port", "9222"))
            cdp_url = f"http://localhost:{selected_port}"
            if existing_cdp_url:
                cdp_url = existing_cdp_url
                try:
                    parsed = urlparse(existing_cdp_url)
                    if parsed.port is not None:
                        selected_port = parsed.port
                except Exception:
                    selected_port = int(env("browser_port", "9222"))
            elif hands is not None:
                try:
                    cdp_url = hands.acquire_resource(
                        "browser", toolkit_session_id, port=selected_port
                    )
                    cdp_owned_by_hands = True
                except (NotImplementedError, ValueError):
                    cdp_url = f"http://localhost:{selected_port}"

        cdp_keep_current = bool(options.cdp_browsers)
        default_start_url = None if cdp_keep_current else "about:blank"
        browser_options = {
            "cdp_keep_current_page": cdp_keep_current,
            "default_start_url": default_start_url,
            "headless": False,
            "browser_log_to_file": True,
            "stealth": True,
            "session_id": toolkit_session_id,
            "cdp_url": cdp_url,
            "enabled_tools": _browser_enabled_tools(),
            **_options(config, "browser"),
        }
        toolkit = HybridBrowserToolkit(options.project_id, **browser_options)
        toolkit.agent_name = Agents.single_agent
        assembly.browser_toolkit = toolkit
        assembly.browser_port = selected_port
        assembly.browser_cdp_url = cdp_url
        assembly.browser_session_id = toolkit_session_id
        assembly.browser_owned_by_hands = cdp_owned_by_hands
        assembly.toolkits_to_register_agent.append(toolkit)
        registered = message_integration.register_toolkits(toolkit)
        assembly.add_tools(
            registered.get_tools(), HybridBrowserToolkit.toolkit_name()
        )

    if _enabled(config, "terminal") and (
        hands is None or hands.can_execute_terminal()
    ):
        terminal_options = {
            "working_directory": working_directory,
            "safe_mode": True,
            "clone_current_env": True,
            **_options(config, "terminal"),
        }
        toolkit = TerminalToolkit(
            options.project_id,
            Agents.single_agent,
            **terminal_options,
        )
        toolkit = message_integration.register_toolkits(toolkit)
        assembly.add_tools(toolkit.get_tools(), TerminalToolkit.toolkit_name())

    if _enabled(config, "web_fetch"):
        toolkit = WebFetchToolkit(**_options(config, "web_fetch"))
        assembly.toolkits_to_register_agent.append(toolkit)
        assembly.add_tools(toolkit.get_tools(), "WebFetchToolkit")

    if _enabled(config, "planning_worktree"):
        planning_options = {
            "working_directory": working_directory,
            **_options(config, "planning_worktree"),
        }
        toolkit = PlanningWorktreeToolkit(
            **planning_options,
        )
        assembly.add_tools(toolkit.get_tools(), "PlanningWorktreeToolkit")

    if _enabled(config, "mcp"):
        mcp_config = _mcp_config(options, hands)
        if mcp_config is not None:
            mcp_options = {
                "config_dict": mcp_config,
                "timeout": 180,
                **_options(config, "mcp"),
            }
            toolkit = MCPToolkit(**mcp_options)
            try:
                await toolkit.connect()
            except Exception:
                logger.error("Failed to connect MCPToolkit", exc_info=True)
            else:
                assembly.add_tools(toolkit.get_tools(), "MCPToolkit")

    if _enabled(config, "agent") and can_delegate:
        toolkit = DepthLimitedAgentToolkit(
            current_depth=current_depth,
            max_depth=max_depth,
            **_options(config, "agent"),
        )
        assembly.toolkits_to_register_agent.append(toolkit)
        assembly.add_tools(toolkit.get_tools(), toolkit.toolkit_name())

    return assembly
