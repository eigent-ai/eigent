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

from app.agent.factory import mcp_agent
from app.model.chat import Chat


pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_mcp_agent_creation(sample_chat_data):
    """Test mcp_agent creates agent with MCP tools."""
    options = Chat(**sample_chat_data)

    with patch('app.agent.factory.mcp.ListenChatAgent') as mock_listen_agent, \
         patch('app.agent.factory.mcp.ModelFactory.create') as mock_model_factory, \
         patch('asyncio.create_task'), \
         patch('app.agent.factory.mcp.McpSearchToolkit') as mock_mcp_search_toolkit, \
         patch('app.agent.factory.mcp.get_mcp_tools') as mock_get_mcp_tools, \
         patch('app.agent.factory.mcp.get_task_lock') as mock_get_task_lock:

        # Mock toolkit instances
        mock_mcp_search_toolkit.return_value.get_tools.return_value = []
        mock_get_mcp_tools.return_value = []

        mock_agent = MagicMock()
        mock_listen_agent.return_value = mock_agent
        mock_model_factory.return_value = MagicMock()

        result = await mcp_agent(options)

        assert result is mock_agent
        mock_listen_agent.assert_called_once()

        # Check that it was called with MCP agent configuration
        call_args = mock_listen_agent.call_args
        assert "mcp_agent" in str(call_args[0][1])  # agent_name (enum contains this value)
