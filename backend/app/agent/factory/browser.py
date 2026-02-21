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
import threading
import uuid

from camel.messages import BaseMessage
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import BROWSER_SYS_PROMPT
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.hybrid_browser_toolkit import HybridBrowserToolkit

# TODO: Remove NoteTakingToolkit and use TerminalToolkit instead
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.screenshot_toolkit import ScreenshotToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.skill_toolkit import SkillToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.utils import NOW_STR
from app.component.environment import env
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


def _get_browser_port(browser: dict) -> int:
    """Extract port from a browser config dict, with fallback to env default."""
    return int(browser.get("port", env("browser_port", "9222")))


class CdpBrowserPoolManager:
    """Manages CDP browser pool occupation to ensure
    parallel tasks use different browsers."""

    def __init__(self):
        self._occupied_ports: dict[int, str] = {}
        self._session_to_port: dict[str, int] = {}
        self._session_to_task: dict[str, str | None] = {}
        self._lock = threading.Lock()

    def acquire_browser(
        self,
        cdp_browsers: list[dict],
        session_id: str,
        task_id: str | None = None,
    ) -> dict | None:
        """Acquire an available browser from the pool.

        Args:
            cdp_browsers: List of browser configurations.
            session_id: Unique session identifier.
            task_id: Optional task identifier for ownership tracking.

        Returns:
            Browser configuration dict or None if all occupied.
        """
        with self._lock:
            for browser in cdp_browsers:
                port = browser.get("port")
                if port and port not in self._occupied_ports:
                    self._occupied_ports[port] = session_id
                    self._session_to_port[session_id] = port
                    self._session_to_task[session_id] = task_id
                    logger.info(
                        f"Acquired browser on port {port} for session "
                        f"{session_id}. Occupied: "
                        f"{list(self._occupied_ports.keys())}"
                    )
                    return browser
            logger.warning(
                f"No available browsers for session {session_id}. "
                f"All occupied: {list(self._occupied_ports.keys())}"
            )
            return None

    def release_browser(self, port: int, session_id: str):
        """Release a browser back to the pool."""
        with self._lock:
            if (
                port in self._occupied_ports
                and self._occupied_ports[port] == session_id
            ):
                del self._occupied_ports[port]
                self._session_to_port.pop(session_id, None)
                self._session_to_task.pop(session_id, None)
                logger.info(
                    f"Released browser on port {port} from session "
                    f"{session_id}. Occupied: "
                    f"{list(self._occupied_ports.keys())}"
                )
            else:
                logger.warning(
                    f"Attempted to release browser on port {port} "
                    f"but it was not occupied by {session_id}"
                )

    def release_by_task(self, task_id: str) -> list[int]:
        """Release all browsers associated with a task_id.

        Returns:
            List of released ports.
        """
        released_ports = []
        with self._lock:
            sessions = [
                s for s, t in self._session_to_task.items() if t == task_id
            ]
            for session_id in sessions:
                port = self._session_to_port.get(session_id)
                if (
                    port is not None
                    and self._occupied_ports.get(port) == session_id
                ):
                    del self._occupied_ports[port]
                    released_ports.append(port)
                self._session_to_port.pop(session_id, None)
                self._session_to_task.pop(session_id, None)
            if released_ports:
                logger.info(
                    f"Released {len(released_ports)} browser(s) for "
                    f"task {task_id}. Occupied: "
                    f"{list(self._occupied_ports.keys())}"
                )
        return released_ports

    def get_occupied_ports(self) -> list[int]:
        """Get list of currently occupied ports."""
        with self._lock:
            return list(self._occupied_ports.keys())


# Global CDP browser pool manager instance
_cdp_pool_manager = CdpBrowserPoolManager()


def browser_agent(options: Chat):
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating browser agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.browser_agent
        ).send_message_to_user
    )

    # Acquire CDP browser from pool or use default port
    toolkit_session_id = str(uuid.uuid4())[:8]
    selected_port = None
    selected_is_external = False

    if options.cdp_browsers:
        selected_browser = _cdp_pool_manager.acquire_browser(
            options.cdp_browsers, toolkit_session_id, options.task_id
        )
        if selected_browser:
            selected_port = _get_browser_port(selected_browser)
            selected_is_external = selected_browser.get("isExternal", False)
            logger.info(
                f"Acquired CDP browser from pool (initial): "
                f"port={selected_port}, isExternal={selected_is_external}, "
                f"session_id={toolkit_session_id}"
            )
        else:
            selected_port = _get_browser_port(options.cdp_browsers[0])
            selected_is_external = options.cdp_browsers[0].get(
                "isExternal", False
            )
            logger.warning(
                f"No available browsers in pool (initial), using first: "
                f"port={selected_port}, session_id={toolkit_session_id}"
            )
    else:
        selected_port = env("browser_port", "9222")

    web_toolkit_custom = HybridBrowserToolkit(
        options.project_id,
        headless=False,
        browser_log_to_file=True,
        stealth=True,
        session_id=toolkit_session_id,
        default_start_url="about:blank",
        cdp_url=f"http://localhost:{selected_port}",
        enabled_tools=[
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
        ],
    )

    # Save reference before registering for toolkits_to_register_agent
    web_toolkit_for_agent_registration = web_toolkit_custom
    web_toolkit_custom = message_integration.register_toolkits(
        web_toolkit_custom
    )

    terminal_toolkit = TerminalToolkit(
        options.project_id,
        Agents.browser_agent,
        working_directory=working_directory,
        safe_mode=True,
        clone_current_env=True,
    )
    terminal_toolkit = message_integration.register_functions(
        [terminal_toolkit.shell_exec]
    )

    note_toolkit = NoteTakingToolkit(
        options.project_id,
        Agents.browser_agent,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    screenshot_toolkit = ScreenshotToolkit(
        options.project_id,
        working_directory=working_directory,
        agent_name=Agents.browser_agent,
    )
    # Save reference before registering for toolkits_to_register_agent
    screenshot_toolkit_for_agent_registration = screenshot_toolkit
    screenshot_toolkit = message_integration.register_toolkits(
        screenshot_toolkit
    )

    skill_toolkit = SkillToolkit(
        options.project_id,
        Agents.browser_agent,
        working_directory=working_directory,
        user_id=options.skill_config_user_id(),
    )
    skill_toolkit = message_integration.register_toolkits(skill_toolkit)

    search_tools = SearchToolkit.get_can_use_tools(options.project_id)
    if search_tools:
        search_tools = message_integration.register_functions(search_tools)
    else:
        search_tools = []

    tools = [
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.browser_agent
        ),
        *web_toolkit_custom.get_tools(),
        *terminal_toolkit,
        *note_toolkit.get_tools(),
        *screenshot_toolkit.get_tools(),
        *search_tools,
        *skill_toolkit.get_tools(),
    ]

    # Build external browser notice
    external_browser_notice = ""
    if selected_is_external:
        external_browser_notice = (
            "\n<external_browser_connection>\n"
            "**IMPORTANT**: You are connected to an external browser instance. "
            "The browser may already be open with active sessions and logged-in "
            "websites. When you use browser tools, you will connect to this "
            "existing browser and can immediately access its current state and "
            "pages.\n"
            "</external_browser_connection>\n"
        )

    system_message = BROWSER_SYS_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
        external_browser_notice=external_browser_notice,
    )

    agent = agent_model(
        Agents.browser_agent,
        BaseMessage.make_assistant_message(
            role_name="Browser Agent",
            content=system_message,
        ),
        options,
        tools,
        prune_tool_calls_from_memory=True,
        tool_names=[
            SearchToolkit.toolkit_name(),
            HybridBrowserToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            ScreenshotToolkit.toolkit_name(),
            SkillToolkit.toolkit_name(),
        ],
        toolkits_to_register_agent=[
            web_toolkit_for_agent_registration,
            screenshot_toolkit_for_agent_registration,
        ],
        enable_snapshot_clean=True,
    )

    # Attach CDP management callbacks and info to the agent
    def acquire_cdp_for_agent(agent_instance):
        """Acquire a CDP browser from pool for a cloned agent."""
        if not options.cdp_browsers:
            return
        session_id = str(uuid.uuid4())[:8]
        selected = _cdp_pool_manager.acquire_browser(
            options.cdp_browsers, session_id, options.task_id
        )
        if selected:
            agent_instance._cdp_port = _get_browser_port(selected)
        else:
            agent_instance._cdp_port = _get_browser_port(
                options.cdp_browsers[0]
            )
        agent_instance._cdp_session_id = session_id
        logger.info(
            f"Acquired CDP for cloned agent {agent_instance.agent_id}: "
            f"port={agent_instance._cdp_port}, session={session_id}"
        )

    def release_cdp_from_agent(agent_instance):
        """Release CDP browser back to pool."""
        port = getattr(agent_instance, "_cdp_port", None)
        session_id = getattr(agent_instance, "_cdp_session_id", None)
        if port is not None and session_id is not None:
            _cdp_pool_manager.release_browser(port, session_id)
            logger.info(
                f"Released CDP for agent {agent_instance.agent_id}: "
                f"port={port}, session={session_id}"
            )

    agent._cdp_acquire_callback = acquire_cdp_for_agent
    agent._cdp_release_callback = release_cdp_from_agent
    agent._cdp_port = selected_port
    agent._cdp_session_id = toolkit_session_id
    agent._cdp_task_id = options.task_id
    agent._cdp_options = options
    agent._browser_toolkit = web_toolkit_for_agent_registration

    return agent
