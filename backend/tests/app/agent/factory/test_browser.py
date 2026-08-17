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

import os
from unittest.mock import MagicMock, patch

import pytest

from app.agent.factory import browser_agent
from app.agent.factory.browser import CdpBrowserPoolManager
from app.model.chat import Chat
from app.service.task import Agents

pytestmark = pytest.mark.unit


def test_electron_browser_pool_allocates_by_target_not_shared_port():
    pool = CdpBrowserPoolManager()
    browsers = [
        {
            "port": 9222,
            "managedBy": "electron",
            "targetUrl": "about:blank#eigent-browser-toolkit=1",
        },
        {
            "port": 9222,
            "managedBy": "electron",
            "targetUrl": "about:blank#eigent-browser-toolkit=2",
        },
    ]

    first = pool.acquire_browser(browsers, "session-1", "task-1")
    second = pool.acquire_browser(browsers, "session-2", "task-1")

    assert first == browsers[0]
    assert second == browsers[1]
    assert pool.acquire_browser(browsers, "session-3", "task-1") is None

    pool.release_browser(9222, "session-1")
    assert pool.acquire_browser(browsers, "session-3", "task-1") == browsers[0]


def test_browser_agent_creation(sample_chat_data):
    """Test browser_agent creates agent with search tools."""
    options = Chat(**sample_chat_data)

    # Setup task lock in the registry before calling agent function
    from app.service.task import task_locks

    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    _mod = "app.agent.factory.browser"
    with (
        patch(f"{_mod}.agent_model") as mock_agent_model,
        patch(
            f"{_mod}.get_working_directory", return_value="/tmp/test_workdir"
        ),
        patch("asyncio.create_task"),
        patch(f"{_mod}.HumanToolkit") as mock_human_toolkit,
        patch(f"{_mod}.HybridBrowserToolkit") as mock_browser_toolkit,
        patch(f"{_mod}.TerminalToolkit") as mock_terminal_toolkit,
        patch(f"{_mod}.NoteTakingToolkit") as mock_note_toolkit,
        patch(f"{_mod}.ScreenshotToolkit") as mock_screenshot_toolkit,
        patch(f"{_mod}.SearchToolkit") as mock_search_toolkit,
        patch(f"{_mod}.ToolkitMessageIntegration"),
        patch("uuid.uuid4") as mock_uuid,
    ):
        # Mock all toolkit instances
        mock_human_toolkit.get_can_use_tools.return_value = []
        mock_browser_toolkit.return_value.get_tools.return_value = []

        # Create a proper terminal toolkit mock
        mock_terminal_instance = MagicMock()
        mock_terminal_instance.shell_exec = MagicMock()
        mock_terminal_toolkit.return_value = mock_terminal_instance

        mock_note_toolkit.return_value.get_tools.return_value = []
        mock_screenshot_toolkit.return_value.get_tools.return_value = []
        mock_search_instance = MagicMock()
        mock_search_instance.search_google = MagicMock()
        mock_search_toolkit.return_value = mock_search_instance
        mock_uuid.return_value.__getitem__ = lambda self, key: "test_session"

        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = browser_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()
        mock_screenshot_toolkit.assert_called_once_with(
            options.project_id,
            working_directory="/tmp/test_workdir",
            agent_name=Agents.browser_agent,
        )

        # Check that it was called with browser agent configuration
        call_args = mock_agent_model.call_args
        assert "browser_agent" in str(
            call_args[0][0]
        )  # agent_name (enum contains this value)
        # The system_prompt is a BaseMessage, so check its content attribute
        system_message = call_args[0][1]
        if hasattr(system_message, "content"):
            assert "search" in system_message.content.lower()
        else:
            assert (
                "search" in str(system_message).lower()
            )  # system_prompt contains search


def test_browser_agent_prefers_preconnected_cdp_url(sample_chat_data):
    """A browser connected from the Browser page should be reused by the agent."""
    options = Chat(**sample_chat_data)

    from app.service.task import task_locks

    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    _mod = "app.agent.factory.browser"
    with (
        patch(f"{_mod}.agent_model") as mock_agent_model,
        patch(
            f"{_mod}.get_working_directory", return_value="/tmp/test_workdir"
        ),
        patch("asyncio.create_task"),
        patch(f"{_mod}.HumanToolkit") as mock_human_toolkit,
        patch(f"{_mod}.HybridBrowserToolkit") as mock_browser_toolkit,
        patch(f"{_mod}.TerminalToolkit") as mock_terminal_toolkit,
        patch(f"{_mod}.NoteTakingToolkit") as mock_note_toolkit,
        patch(f"{_mod}.ScreenshotToolkit") as mock_screenshot_toolkit,
        patch(f"{_mod}.SearchToolkit") as mock_search_toolkit,
        patch(f"{_mod}.ToolkitMessageIntegration"),
        patch("uuid.uuid4") as mock_uuid,
        patch.dict(
            os.environ,
            {"EIGENT_CDP_URL": "http://worker-17:9222"},
            clear=False,
        ),
    ):
        mock_human_toolkit.get_can_use_tools.return_value = []
        mock_browser_toolkit.return_value.get_tools.return_value = []
        mock_terminal_instance = MagicMock()
        mock_terminal_instance.shell_exec = MagicMock()
        mock_terminal_toolkit.return_value = mock_terminal_instance
        mock_note_toolkit.return_value.get_tools.return_value = []
        mock_screenshot_toolkit.return_value.get_tools.return_value = []
        mock_search_instance = MagicMock()
        mock_search_instance.search_google = MagicMock()
        mock_search_toolkit.return_value = mock_search_instance
        mock_uuid.return_value.__getitem__ = lambda self, key: "test_session"

        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        browser_agent(options)

        assert mock_browser_toolkit.call_args.kwargs["cdp_url"] == (
            "http://worker-17:9222"
        )


def test_browser_agent_uses_cdp_browser_endpoint(sample_chat_data):
    """Browser pool entries may point at remote Hands endpoints."""
    sample_chat_data["cdp_browsers"] = [
        {
            "id": "remote-browser",
            "port": 9222,
            "endpoint": "http://worker-17:9222",
            "isExternal": False,
            "name": "Remote Browser",
        }
    ]
    options = Chat(**sample_chat_data)

    from app.agent.factory import browser as browser_factory
    from app.service.task import task_locks

    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    _mod = "app.agent.factory.browser"
    try:
        with (
            patch(f"{_mod}.agent_model") as mock_agent_model,
            patch(
                f"{_mod}.get_working_directory",
                return_value="/tmp/test_workdir",
            ),
            patch("asyncio.create_task"),
            patch(f"{_mod}.HumanToolkit") as mock_human_toolkit,
            patch(f"{_mod}.HybridBrowserToolkit") as mock_browser_toolkit,
            patch(f"{_mod}.TerminalToolkit") as mock_terminal_toolkit,
            patch(f"{_mod}.NoteTakingToolkit") as mock_note_toolkit,
            patch(f"{_mod}.ScreenshotToolkit") as mock_screenshot_toolkit,
            patch(f"{_mod}.SearchToolkit") as mock_search_toolkit,
            patch(f"{_mod}.ToolkitMessageIntegration"),
            patch("uuid.uuid4") as mock_uuid,
        ):
            mock_human_toolkit.get_can_use_tools.return_value = []
            mock_browser_toolkit.return_value.get_tools.return_value = []
            mock_terminal_instance = MagicMock()
            mock_terminal_instance.shell_exec = MagicMock()
            mock_terminal_toolkit.return_value = mock_terminal_instance
            mock_note_toolkit.return_value.get_tools.return_value = []
            mock_screenshot_toolkit.return_value.get_tools.return_value = []
            mock_search_toolkit.return_value = MagicMock()
            mock_uuid.return_value.__getitem__ = (
                lambda self, key: "test_session"
            )

            mock_agent = MagicMock()
            mock_agent_model.return_value = mock_agent

            browser_agent(options)

            assert mock_browser_toolkit.call_args.kwargs["cdp_url"] == (
                "http://worker-17:9222"
            )
    finally:
        browser_factory._cdp_pool_manager.release_by_task(options.task_id)
        task_locks.pop(options.task_id, None)


def test_electron_browser_agent_propagates_exact_owned_target(
    sample_chat_data,
):
    target_url = "about:blank#eigent-browser-toolkit=17"
    sample_chat_data["cdp_browsers"] = [
        {
            "id": "electron-webview-17",
            "port": 9222,
            "endpoint": "http://127.0.0.1:9222",
            "managedBy": "electron",
            "targetUrl": target_url,
        }
    ]
    options = Chat(**sample_chat_data)

    from app.agent.factory import browser as browser_factory
    from app.service.task import task_locks

    task_locks[options.task_id] = MagicMock()
    module = "app.agent.factory.browser"
    try:
        with (
            patch.dict(os.environ, {"EIGENT_RUNTIME": "electron"}),
            patch(f"{module}.agent_model", return_value=MagicMock()),
            patch(
                f"{module}.get_working_directory",
                return_value="/tmp/test_workdir",
            ),
            patch("asyncio.create_task"),
            patch(f"{module}.HumanToolkit") as human,
            patch(f"{module}.HybridBrowserToolkit") as browser_toolkit,
            patch(f"{module}.TerminalToolkit") as terminal,
            patch(f"{module}.NoteTakingToolkit") as notes,
            patch(f"{module}.ScreenshotToolkit") as screenshots,
            patch(f"{module}.SearchToolkit") as search,
            patch(f"{module}.ToolkitMessageIntegration"),
        ):
            human.get_can_use_tools.return_value = []
            browser_toolkit.return_value.get_tools.return_value = []
            terminal.return_value.shell_exec = MagicMock()
            notes.return_value.get_tools.return_value = []
            screenshots.return_value.get_tools.return_value = []
            search.return_value = MagicMock()

            browser_agent(options)

            assert browser_toolkit.call_args.kwargs["owned_target_url"] == (
                target_url
            )
            assert (
                browser_toolkit.call_args.kwargs["cdp_keep_current_page"]
                is True
            )
    finally:
        browser_factory._cdp_pool_manager.release_by_task(options.task_id)
        task_locks.pop(options.task_id, None)
