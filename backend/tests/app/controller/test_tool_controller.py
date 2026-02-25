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
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.controller.tool_controller import install_tool


@pytest.mark.unit
class TestToolController:
    """Test cases for tool controller endpoints."""

    @pytest.mark.asyncio
    async def test_install_notion_tool_success(self):
        tool_name = "notion"
        mock_toolkit = AsyncMock()
        mock_tools = [MagicMock(), MagicMock()]
        for tool, name in zip(mock_tools, ["create_page", "update_page"]):
            tool.func.__name__ = name
        mock_toolkit.get_tools = MagicMock(return_value=mock_tools)
        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            result = await install_tool(tool_name)
        assert result["success"] is True
        assert result["tools"] == ["create_page", "update_page"]
        assert result["count"] == 2
        assert result["toolkit_name"] == "NotionMCPToolkit"
        mock_toolkit.connect.assert_called_once()
        mock_toolkit.disconnect.assert_called_once()

    @pytest.mark.asyncio
    async def test_install_unknown_tool(self):
        with pytest.raises(HTTPException) as exc_info:
            await install_tool("unknown_tool")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_install_notion_tool_connection_failure(self):
        mock_toolkit = AsyncMock()
        mock_toolkit.connect.side_effect = Exception("Connection failed")
        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            result = await install_tool("notion")
        assert result["success"] is True
        assert result["tools"] == []
        assert result["count"] == 0
        assert "warning" in result

    @pytest.mark.asyncio
    async def test_install_notion_tool_get_tools_failure(self):
        mock_toolkit = AsyncMock()
        mock_toolkit.get_tools = MagicMock(
            side_effect=Exception("Failed to get tools")
        )
        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            result = await install_tool("notion")
        assert result["success"] is True
        assert result["tools"] == []
        assert result["count"] == 0
        assert "warning" in result

    @pytest.mark.asyncio
    async def test_install_notion_tool_disconnect_failure(self):
        mock_toolkit = AsyncMock()
        mock_tools = [MagicMock()]
        mock_tools[0].func.__name__ = "test_tool"
        mock_toolkit.get_tools = MagicMock(return_value=mock_tools)
        mock_toolkit.disconnect.side_effect = Exception("Disconnect failed")
        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            result = await install_tool("notion")
        assert result["success"] is True
        assert result["tools"] == []
        assert result["count"] == 0
        assert "warning" in result

    @pytest.mark.asyncio
    async def test_install_notion_tool_empty_tools(self):
        mock_toolkit = AsyncMock()
        mock_toolkit.get_tools = MagicMock(return_value=[])
        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            result = await install_tool("notion")
        assert result["success"] is True
        assert result["tools"] == []
        assert result["count"] == 0
        mock_toolkit.connect.assert_called_once()
        mock_toolkit.disconnect.assert_called_once()

    @pytest.mark.asyncio
    async def test_install_notion_tool_with_complex_tools(self):
        mock_toolkit = AsyncMock()
        names = [
            "create_database",
            "query_database",
            "update_block",
            "delete_page",
        ]
        mock_tools = []
        for name in names:
            mt = MagicMock()
            mt.func.__name__ = name
            mock_tools.append(mt)
        mock_toolkit.get_tools = MagicMock(return_value=mock_tools)
        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            result = await install_tool("notion")
        assert result["success"] is True
        assert result["tools"] == names
        assert result["count"] == 4
        mock_toolkit.connect.assert_called_once()
        mock_toolkit.disconnect.assert_called_once()


@pytest.mark.integration
class TestToolControllerIntegration:
    """Integration tests for tool controller."""

    def test_install_notion_tool_endpoint_integration(
        self, client: TestClient
    ):
        """Test install Notion tool endpoint through FastAPI test client."""
        tool_name = "notion"

        mock_toolkit = AsyncMock()
        mock_tools = [MagicMock(), MagicMock()]
        mock_tools[0].func.__name__ = "create_page"
        mock_tools[1].func.__name__ = "update_page"
        mock_toolkit.get_tools = MagicMock(return_value=mock_tools)

        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            response = client.post(f"/install/tool/{tool_name}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["tools"] == ["create_page", "update_page"]
            assert data["count"] == 2

    def test_install_unknown_tool_endpoint_integration(
        self, client: TestClient
    ):
        """Test install unknown tool endpoint through FastAPI test client."""
        tool_name = "unknown_tool"

        response = client.post(f"/install/tool/{tool_name}")

        assert response.status_code == 404

    def test_install_notion_tool_endpoint_with_connection_error(
        self, client: TestClient
    ):
        """Test install Notion tool endpoint when connection fails."""
        tool_name = "notion"

        mock_toolkit = AsyncMock()
        mock_toolkit.connect.side_effect = Exception("Connection failed")

        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            response = client.post(f"/install/tool/{tool_name}")
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["tools"] == []
            assert "warning" in data


@pytest.mark.model_backend
class TestToolControllerWithRealMCP:
    """Tests that require real MCP connections (marked for selective running)."""

    @pytest.mark.asyncio
    async def test_install_notion_tool_with_real_connection(self):
        """Test Notion tool installation with real MCP connection."""

        # This test would connect to real Notion MCP server
        # Requires actual MCP server setup and credentials
        # Marked as model_backend test for selective execution
        assert True  # Placeholder

    @pytest.mark.very_slow
    async def test_install_and_test_all_notion_tools(self):
        """Test installation and functionality of all Notion tools (very slow test)."""
        # This test would install and test each Notion tool individually
        # Marked as very_slow for execution only in full test mode
        assert True  # Placeholder


@pytest.mark.unit
class TestToolControllerErrorCases:
    """Test error and edge cases for tool installation."""

    @pytest.mark.asyncio
    async def test_install_tool_with_malformed_tool_response(self):
        mock_toolkit = AsyncMock()
        tools = [MagicMock(), object()]  # Second item lacks func
        tools[0].func.__name__ = "valid_tool"
        mock_toolkit.get_tools = MagicMock(return_value=tools)
        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            # Inner except catches the AttributeError and returns success with empty tools
            result = await install_tool("notion")
        assert result["success"] is True
        assert result["tools"] == []
        assert "warning" in result

    @pytest.mark.asyncio
    async def test_install_tool_with_none_toolkit(self):
        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=None,
        ):
            # Inner except catches AttributeError on None.connect()
            result = await install_tool("notion")
        assert result["success"] is True
        assert result["tools"] == []
        assert "warning" in result

    @pytest.mark.asyncio
    async def test_install_tool_with_special_characters_in_name(self):
        with pytest.raises(HTTPException) as exc_info:
            await install_tool("notion@#$%")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_install_tool_with_empty_string_name(self):
        with pytest.raises(HTTPException) as exc_info:
            await install_tool("")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_install_tool_with_none_name(self):
        with pytest.raises(HTTPException) as exc_info:
            await install_tool(None)
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_install_notion_tool_partial_failure(self):
        mock_toolkit = AsyncMock()
        mock_toolkit.connect.return_value = None
        tools = [MagicMock(), MagicMock(), MagicMock()]
        tools[0].func.__name__ = "create_page"
        tools[1].func.__name__ = "update_page"
        tools[2].func = None
        mock_toolkit.get_tools = MagicMock(return_value=tools)
        mock_toolkit.disconnect.return_value = None
        with patch(
            "app.controller.tool_controller.NotionMCPToolkit",
            return_value=mock_toolkit,
        ):
            # Inner except catches the AttributeError from tools[2].func
            result = await install_tool("notion")
        assert result["success"] is True
        assert result["tools"] == []
        assert "warning" in result
