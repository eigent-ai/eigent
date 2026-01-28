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

from app.agent.factory import developer_agent
from app.model.chat import Chat


pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_developer_agent_creation(sample_chat_data):
    """Test developer_agent creates agent with development tools."""
    options = Chat(**sample_chat_data)

    # Setup task lock in the registry before calling agent function
    from app.service.task import task_locks
    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    with patch('app.agent.factory.developer.agent_model') as mock_agent_model, \
         patch('asyncio.create_task'), \
         patch('app.agent.factory.developer.HumanToolkit') as mock_human_toolkit, \
         patch('app.agent.factory.developer.NoteTakingToolkit') as mock_note_toolkit, \
         patch('app.agent.factory.developer.WebDeployToolkit') as mock_web_toolkit, \
         patch('app.agent.factory.developer.ScreenshotToolkit') as mock_screenshot_toolkit, \
         patch('app.agent.factory.developer.TerminalToolkit') as mock_terminal_toolkit, \
         patch('app.agent.factory.developer.ToolkitMessageIntegration'):

        # Mock all toolkit instances
        mock_human_toolkit.get_can_use_tools.return_value = []
        mock_note_toolkit.return_value.get_tools.return_value = []
        mock_web_toolkit.return_value.get_tools.return_value = []
        mock_screenshot_toolkit.return_value.get_tools.return_value = []
        mock_terminal_toolkit.return_value.get_tools.return_value = []

        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = await developer_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()

        # Should have called with development-related tools
        call_args = mock_agent_model.call_args
        assert "developer_agent" in str(call_args[0][0])  # agent_name (enum contains this value)
        tools_arg = call_args[0][3]  # tools argument
        assert isinstance(tools_arg, list)


@pytest.mark.asyncio
async def test_developer_agent_with_multiple_toolkits(sample_chat_data):
    """Test agent creation with multiple toolkits."""
    options = Chat(**sample_chat_data)

    # Setup task lock in the registry before calling agent function
    from app.service.task import task_locks
    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    with patch('app.agent.factory.developer.agent_model') as mock_agent_model, \
         patch('asyncio.create_task'), \
         patch('app.agent.factory.developer.HumanToolkit') as mock_human_toolkit, \
         patch('app.agent.factory.developer.NoteTakingToolkit') as mock_note_toolkit, \
         patch('app.agent.factory.developer.WebDeployToolkit') as mock_web_toolkit, \
         patch('app.agent.factory.developer.ScreenshotToolkit') as mock_screenshot_toolkit, \
         patch('app.agent.factory.developer.TerminalToolkit') as mock_terminal_toolkit, \
         patch('app.agent.factory.developer.ToolkitMessageIntegration'):

        # Mock all toolkit instances
        mock_human_toolkit.get_can_use_tools.return_value = []
        mock_note_toolkit.return_value.get_tools.return_value = []
        mock_web_toolkit.return_value.get_tools.return_value = []
        mock_screenshot_toolkit.return_value.get_tools.return_value = []
        mock_terminal_toolkit.return_value.get_tools.return_value = []

        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = await developer_agent(options)

        assert result is mock_agent
