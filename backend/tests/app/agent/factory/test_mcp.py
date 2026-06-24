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
    options = Chat(
        **{
            **sample_chat_data,
            "installed_mcp": {
                "mcpServers": {
                    "ticketing": {
                        "command": "node",
                        "args": ["ticketing.js"],
                    }
                }
            },
        }
    )

    _mod = "app.agent.factory.mcp"
    with (
        patch(f"{_mod}.agent_model") as mock_agent_model,
        patch(f"{_mod}.McpSearchToolkit") as mock_mcp_search_toolkit,
        patch(f"{_mod}.get_mcp_tools") as mock_get_mcp_tools,
        patch(
            f"{_mod}.attach_remote_sub_agent_if_enabled",
            return_value="MCP system prompt",
        ) as mock_attach_remote_sub_agent,
    ):
        search_tool = MagicMock(name="search_tool")
        mcp_tool = MagicMock(name="mcp_tool")
        mcp_tool.get_function_name.return_value = "create_ticket"

        # Mock toolkit instances
        mock_mcp_search_toolkit.toolkit_name.return_value = (
            "MCP Search Toolkit"
        )
        mock_mcp_search_toolkit.return_value.get_tools.return_value = [
            search_tool
        ]
        mock_get_mcp_tools.return_value = [mcp_tool]

        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = await mcp_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()

        # Check that it was called with MCP agent configuration
        call_args = mock_agent_model.call_args
        assert "mcp_agent" in str(
            call_args[0][0]
        )  # agent_name (enum contains this value)
        tools_arg = call_args[0][3]
        assert tools_arg == [search_tool, mcp_tool]
        assert call_args[0][1] == "MCP system prompt"
        assert call_args.kwargs["tool_names"] == ["ticketing"]

        prompt_kwargs = mock_attach_remote_sub_agent.call_args.kwargs
        assert prompt_kwargs["tools"] == [search_tool, mcp_tool]
        assert "MCP Search Toolkit" in prompt_kwargs["tool_names"]
        assert "create_ticket" in prompt_kwargs["tool_names"]


@pytest.mark.asyncio
async def test_mcp_agent_uses_shared_agent_model_path(sample_chat_data):
    """Workforce MCP agent must not bypass subscription-aware model setup."""
    options = Chat(
        **{
            **sample_chat_data,
            "api_key": "",
            "auth_source": "codex_subscription",
            "model_platform": "openai",
            "model_type": "gpt-5.5",
        }
    )

    _mod = "app.agent.factory.mcp"
    with (
        patch(f"{_mod}.agent_model") as mock_agent_model,
        patch(f"{_mod}.McpSearchToolkit") as mock_mcp_search_toolkit,
        patch(f"{_mod}.get_mcp_tools") as mock_get_mcp_tools,
        patch("camel.models.ModelFactory.create") as mock_create,
    ):
        mock_mcp_search_toolkit.return_value.get_tools.return_value = []
        mock_get_mcp_tools.return_value = []
        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = await mcp_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()
        assert mock_agent_model.call_args.args[2] is options
        mock_create.assert_not_called()
