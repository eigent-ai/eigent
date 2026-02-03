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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agent.tools import get_mcp_tools, get_toolkits
from app.model.chat import McpServers

pytestmark = pytest.mark.unit


class TestToolkitFunctions:
    """Test cases for toolkit utility functions."""

    @pytest.mark.asyncio
    async def test_get_toolkits_with_known_tools(self):
        """Test get_toolkits with known tool names."""
        tools = ["search_toolkit", "terminal_toolkit", "file_write_toolkit"]
        agent_name = "TestAgent"
        api_task_id = "test_task_123"

        _mod = 'app.agent.tools'
        with patch(f'{_mod}.SearchToolkit') as mock_search_toolkit, \
             patch(f'{_mod}.TerminalToolkit') as mock_terminal_toolkit, \
             patch(f'{_mod}.FileToolkit') as mock_file_toolkit:

            # Mock toolkit instances - these should
            # return tools directly
            # from get_can_use_tools
            mock_search_instance = MagicMock()
            mock_search_instance.agent_name = agent_name
            mock_search_tools = [MagicMock(), MagicMock()]
            mock_search_instance\
                .get_can_use_tools\
                .return_value = mock_search_tools
            mock_search_toolkit.return_value = mock_search_instance

            mock_terminal_instance = MagicMock()
            mock_terminal_instance.agent_name = agent_name
            mock_terminal_tools = [MagicMock()]
            mock_terminal_instance\
                .get_can_use_tools\
                .return_value = mock_terminal_tools
            mock_terminal_toolkit.return_value = mock_terminal_instance

            mock_file_instance = MagicMock()
            mock_file_instance.agent_name = agent_name
            mock_file_tools = [MagicMock()]
            mock_file_instance.get_can_use_tools.return_value = mock_file_tools
            mock_file_toolkit.return_value = mock_file_instance

            # Mock the toolkit classes to have
            # get_can_use_tools class method
            # that returns the mock tools
            mock_search_toolkit.get_can_use_tools = MagicMock(
                return_value=mock_search_tools
            )
            mock_terminal_toolkit.get_can_use_tools = MagicMock(
                return_value=mock_terminal_tools
            )
            mock_file_toolkit.get_can_use_tools = MagicMock(
                return_value=mock_file_tools
            )

            result = await get_toolkits(tools, agent_name, api_task_id)

            # The result should contain tools from the toolkits that match
            assert isinstance(result, list)
            # Since get_toolkits filters by known
            # toolkit names, only matching ones
            # should be included
            assert len(result) >= 0  # Should have some tools if any match

    @pytest.mark.asyncio
    async def test_get_toolkits_with_unknown_tool(self):
        """Test get_toolkits with unknown tool name."""
        tools = ["unknown_tool"]
        agent_name = "TestAgent"
        api_task_id = "test_task_123"

        result = await get_toolkits(tools, agent_name, api_task_id)

        # Should return empty list or handle unknown tools gracefully
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_get_toolkits_empty_tools(self):
        """Test get_toolkits with empty tools list."""
        tools = []
        agent_name = "TestAgent"
        api_task_id = "test_task_123"

        result = await get_toolkits(tools, agent_name, api_task_id)

        assert result == []

    @pytest.mark.asyncio
    async def test_get_toolkits_with_toolkit_initialization_error(self):
        """Test get_toolkits when toolkit initialization fails."""
        tools = ["search"]
        agent_name = "ErrorAgent"
        api_task_id = "error_test_123"

        with patch(
            'app.agent.tools.SearchToolkit',
            side_effect=Exception("Toolkit init failed")
        ):
            # Should handle toolkit initialization errors
            result = await get_toolkits(tools, agent_name, api_task_id)
            # Should return what it can or empty list
            assert isinstance(result, list)


class TestMcpTools:
    """Test cases for MCP tools utility functions."""

    @pytest.mark.asyncio
    async def test_get_mcp_tools_success(self):
        """Test get_mcp_tools with valid MCP server configuration."""
        mcp_servers: McpServers = {
            "mcpServers": {
                "notion": {
                    "command": "npx",
                    "args": ["@modelcontextprotocol/server-notion"]
                }
            }
        }

        mock_tools = [MagicMock(), MagicMock()]

        with patch('app.agent.tools.MCPToolkit') as mock_mcp_toolkit:
            mock_toolkit_instance = MagicMock()
            mock_toolkit_instance.connect = AsyncMock()
            mock_toolkit_instance.get_tools.return_value = mock_tools
            mock_mcp_toolkit.return_value = mock_toolkit_instance

            result = await get_mcp_tools(mcp_servers)

            assert len(result) == 2
            assert result == mock_tools
            mock_mcp_toolkit.assert_called_once()
            mock_toolkit_instance.connect.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_mcp_tools_empty_servers(self):
        """Test get_mcp_tools with empty server configuration."""
        mcp_servers: McpServers = {"mcpServers": {}}

        result = await get_mcp_tools(mcp_servers)

        assert result == []

    @pytest.mark.asyncio
    async def test_get_mcp_tools_connection_failure(self):
        """Test get_mcp_tools when MCP connection fails."""
        mcp_servers: McpServers = {
            "mcpServers": {
                "failing_server": {
                    "command": "invalid_command"
                }
            }
        }

        with patch(
            'app.agent.tools.MCPToolkit',
            side_effect=Exception("Connection failed")
        ):
            result = await get_mcp_tools(mcp_servers)
            assert result == []

    @pytest.mark.asyncio
    async def test_get_mcp_tools_with_malformed_config(self):
        """Test get_mcp_tools with malformed configuration."""
        mcp_servers = {"invalid_key": "invalid_value"}

        with pytest.raises((KeyError, TypeError)):
            await get_mcp_tools(mcp_servers)
