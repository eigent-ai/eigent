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

from unittest.mock import MagicMock, patch
import pytest

from app.agent.factory import browser_agent
from app.model.chat import Chat


pytestmark = pytest.mark.unit


def test_browser_agent_creation(sample_chat_data):
    """Test browser_agent creates agent with search tools."""
    options = Chat(**sample_chat_data)

    # Setup task lock in the registry before calling agent function
    from app.service.task import task_locks
    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    with patch('app.agent.factory.browser.agent_model') as mock_agent_model, \
         patch('asyncio.create_task'), \
         patch('app.agent.factory.browser.HumanToolkit') as mock_human_toolkit, \
         patch('app.agent.factory.browser.HybridBrowserToolkit') as mock_browser_toolkit, \
         patch('app.agent.factory.browser.TerminalToolkit') as mock_terminal_toolkit, \
         patch('app.agent.factory.browser.NoteTakingToolkit') as mock_note_toolkit, \
         patch('app.agent.factory.browser.SearchToolkit') as mock_search_toolkit, \
         patch('app.agent.factory.browser.ToolkitMessageIntegration'), \
         patch('uuid.uuid4') as mock_uuid:

        # Mock all toolkit instances
        mock_human_toolkit.get_can_use_tools.return_value = []
        mock_browser_toolkit.return_value.get_tools.return_value = []

        # Create a proper terminal toolkit mock
        mock_terminal_instance = MagicMock()
        mock_terminal_instance.shell_exec = MagicMock()
        mock_terminal_toolkit.return_value = mock_terminal_instance

        mock_note_toolkit.return_value.get_tools.return_value = []
        mock_search_instance = MagicMock()
        mock_search_instance.search_google = MagicMock()
        mock_search_toolkit.return_value = mock_search_instance
        mock_uuid.return_value.__getitem__ = lambda self, key: "test_session"

        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = browser_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()

        # Check that it was called with browser agent configuration
        call_args = mock_agent_model.call_args
        assert "browser_agent" in str(call_args[0][0])  # agent_name (enum contains this value)
        # The system_prompt is a BaseMessage, so check its content attribute
        system_message = call_args[0][1]
        if hasattr(system_message, 'content'):
            assert "search" in system_message.content.lower()
        else:
            assert "search" in str(system_message).lower()  # system_prompt contains search
