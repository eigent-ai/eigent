from unittest.mock import AsyncMock, MagicMock, patch, call
import pytest
import os
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.controller.tool_controller import (
    install_tool,
    list_available_tools,
    get_oauth_status,
    cancel_oauth,
    uninstall_tool,
)


@pytest.mark.unit
class TestInstallTool:
    """Test cases for install_tool endpoint."""

    @pytest.mark.asyncio
    async def test_install_notion_tool_success(self):
        """Test successful Notion tool installation with connection."""
        tool_name = "notion"
        mock_toolkit = AsyncMock()
        mock_tools = [MagicMock(), MagicMock()]
        mock_tools[0].func.__name__ = "create_page"
        mock_tools[1].func.__name__ = "update_page"
        mock_toolkit.get_tools = MagicMock(return_value=mock_tools)

        with patch("app.controller.tool_controller.NotionMCPToolkit", return_value=mock_toolkit):
            result = await install_tool(tool_name)

        assert result["success"] is True
        assert result["tools"] == ["create_page", "update_page"]
        assert result["count"] == 2
        assert result["toolkit_name"] == "NotionMCPToolkit"
        assert "Successfully installed and authenticated" in result["message"]
        mock_toolkit.connect.assert_called_once()
        mock_toolkit.disconnect.assert_called_once()

    @pytest.mark.asyncio
    async def test_install_notion_tool_connection_failure(self):
        """Test Notion installation when connection fails - should still succeed with warning."""
        tool_name = "notion"
        mock_toolkit = AsyncMock()
        mock_toolkit.connect.side_effect = Exception("Connection failed")

        with patch("app.controller.tool_controller.NotionMCPToolkit", return_value=mock_toolkit):
            result = await install_tool(tool_name)

        # Should still return success but with warning
        assert result["success"] is True
        assert result["tools"] == []
        assert result["count"] == 0
        assert "warning" in result
        assert "not connected" in result["message"]

    @pytest.mark.asyncio
    async def test_install_notion_tool_toolkit_creation_failure(self):
        """Test Notion installation when toolkit creation fails."""
        with patch("app.controller.tool_controller.NotionMCPToolkit", side_effect=Exception("Toolkit creation failed")):
            with pytest.raises(HTTPException) as exc_info:
                await install_tool("notion")

        assert exc_info.value.status_code == 500
        assert "Failed to install notion" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_install_google_calendar_success(self):
        """Test successful Google Calendar installation with existing credentials."""
        tool_name = "google_calendar"
        mock_toolkit = MagicMock()
        mock_tools = [MagicMock(), MagicMock()]
        mock_tools[0].func.__name__ = "create_event"
        mock_tools[1].func.__name__ = "list_events"
        mock_toolkit.get_tools = MagicMock(return_value=mock_tools)

        with patch("app.controller.tool_controller.GoogleCalendarToolkit", return_value=mock_toolkit):
            result = await install_tool(tool_name)

        assert result["success"] is True
        assert result["tools"] == ["create_event", "list_events"]
        assert result["count"] == 2
        assert result["toolkit_name"] == "GoogleCalendarToolkit"

    @pytest.mark.asyncio
    async def test_install_google_calendar_requires_authorization(self):
        """Test Google Calendar installation when authorization is needed."""
        tool_name = "google_calendar"

        with patch("app.controller.tool_controller.GoogleCalendarToolkit", side_effect=ValueError("No credentials")), \
             patch("app.controller.tool_controller.GoogleCalendarToolkit.start_background_auth") as mock_auth:
            result = await install_tool(tool_name)

        assert result["success"] is False
        assert result["status"] == "authorizing"
        assert result["requires_auth"] is True
        assert "Authorization required" in result["message"]
        mock_auth.assert_called_once_with("install_auth")

    @pytest.mark.asyncio
    async def test_install_google_calendar_unexpected_error(self):
        """Test Google Calendar installation with unexpected error."""
        with patch("app.controller.tool_controller.GoogleCalendarToolkit", side_effect=Exception("Unexpected error")):
            with pytest.raises(HTTPException) as exc_info:
                await install_tool("google_calendar")

        assert exc_info.value.status_code == 500
        assert "Failed to install google_calendar" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_install_unknown_tool(self):
        """Test installation of unknown tool."""
        with pytest.raises(HTTPException) as exc_info:
            await install_tool("unknown_tool")

        assert exc_info.value.status_code == 404
        assert "Tool 'unknown_tool' not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_install_notion_empty_tools_list(self):
        """Test Notion installation when no tools are available."""
        mock_toolkit = AsyncMock()
        mock_toolkit.get_tools = MagicMock(return_value=[])

        with patch("app.controller.tool_controller.NotionMCPToolkit", return_value=mock_toolkit):
            result = await install_tool("notion")

        assert result["success"] is True
        assert result["tools"] == []
        assert result["count"] == 0


@pytest.mark.unit
class TestListAvailableTools:
    """Test cases for list_available_tools endpoint."""

    @pytest.mark.asyncio
    async def test_list_available_tools_success(self):
        """Test listing all available tools."""
        result = await list_available_tools()

        assert "tools" in result
        assert len(result["tools"]) == 2

        # Check Notion tool
        notion_tool = next(t for t in result["tools"] if t["name"] == "notion")
        assert notion_tool["display_name"] == "Notion MCP"
        assert notion_tool["toolkit_class"] == "NotionMCPToolkit"
        assert notion_tool["requires_auth"] is True

        # Check Google Calendar tool
        gc_tool = next(t for t in result["tools"] if t["name"] == "google_calendar")
        assert gc_tool["display_name"] == "Google Calendar"
        assert gc_tool["toolkit_class"] == "GoogleCalendarToolkit"
        assert gc_tool["requires_auth"] is True


@pytest.mark.unit
class TestOAuthStatus:
    """Test cases for OAuth status endpoint."""

    @pytest.mark.asyncio
    async def test_get_oauth_status_not_started(self):
        """Test OAuth status when no authorization is in progress."""
        with patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=None):
            result = await get_oauth_status("google_calendar")

        assert result["provider"] == "google_calendar"
        assert result["status"] == "not_started"
        assert "No authorization in progress" in result["message"]

    @pytest.mark.asyncio
    async def test_get_oauth_status_with_state(self):
        """Test OAuth status when authorization state exists."""
        mock_state = MagicMock()
        mock_state.to_dict.return_value = {
            "provider": "google_calendar",
            "status": "authorizing",
            "message": "Waiting for user authorization"
        }

        with patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=mock_state):
            result = await get_oauth_status("google_calendar")

        assert result["provider"] == "google_calendar"
        assert result["status"] == "authorizing"
        mock_state.to_dict.assert_called_once()


@pytest.mark.unit
class TestCancelOAuth:
    """Test cases for cancel OAuth endpoint."""

    @pytest.mark.asyncio
    async def test_cancel_oauth_success(self):
        """Test successful OAuth cancellation."""
        mock_state = MagicMock()
        mock_state.status = "pending"

        with patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=mock_state):
            result = await cancel_oauth("google_calendar")

        assert result["success"] is True
        assert result["provider"] == "google_calendar"
        assert "cancelled successfully" in result["message"]
        mock_state.cancel.assert_called_once()

    @pytest.mark.asyncio
    async def test_cancel_oauth_not_found(self):
        """Test cancelling OAuth when no authorization exists."""
        with patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=None):
            with pytest.raises(HTTPException) as exc_info:
                await cancel_oauth("google_calendar")

        assert exc_info.value.status_code == 404
        assert "No authorization found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_cancel_oauth_wrong_status(self):
        """Test cancelling OAuth when status doesn't allow cancellation."""
        mock_state = MagicMock()
        mock_state.status = "completed"

        with patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=mock_state):
            with pytest.raises(HTTPException) as exc_info:
                await cancel_oauth("google_calendar")

        assert exc_info.value.status_code == 400
        assert "Cannot cancel authorization with status" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_cancel_oauth_authorizing_status(self):
        """Test cancelling OAuth with authorizing status."""
        mock_state = MagicMock()
        mock_state.status = "authorizing"

        with patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=mock_state):
            result = await cancel_oauth("google_calendar")

        assert result["success"] is True
        mock_state.cancel.assert_called_once()


@pytest.mark.unit
class TestUninstallTool:
    """Test cases for uninstall_tool endpoint."""

    @pytest.mark.asyncio
    async def test_uninstall_notion_success_with_files(self):
        """Test successful Notion uninstallation with auth files cleanup."""
        import tempfile
        import os

        with tempfile.TemporaryDirectory() as temp_dir:
            # Create mock auth directory structure
            mcp_auth_dir = os.path.join(temp_dir, ".mcp-auth", "v1")
            os.makedirs(mcp_auth_dir, exist_ok=True)

            # Create mock auth files
            import hashlib
            notion_url = "https://mcp.notion.com/mcp"
            url_hash = hashlib.md5(notion_url.encode()).hexdigest()
            test_file = os.path.join(mcp_auth_dir, f"{url_hash}_auth.json")
            with open(test_file, 'w') as f:
                f.write('{"test": "data"}')

            with patch("os.path.expanduser", return_value=temp_dir):
                result = await uninstall_tool("notion")

            assert result["success"] is True
            assert "Successfully uninstalled notion" in result["message"]
            assert "deleted_files" in result

    @pytest.mark.asyncio
    async def test_uninstall_notion_no_auth_files(self):
        """Test Notion uninstallation when no auth files exist."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("os.path.expanduser", return_value=temp_dir):
                result = await uninstall_tool("notion")

            assert result["success"] is True
            assert "Successfully uninstalled notion" in result["message"]

    @pytest.mark.asyncio
    async def test_uninstall_google_calendar_success(self):
        """Test successful Google Calendar uninstallation."""
        import tempfile
        import os

        with tempfile.TemporaryDirectory() as temp_dir:
            # Create token directory
            token_dir = os.path.join(temp_dir, ".eigent", "tokens", "google_calendar")
            os.makedirs(token_dir, exist_ok=True)

            with open(os.path.join(token_dir, "token.json"), 'w') as f:
                f.write('{"token": "test"}')

            mock_state = MagicMock()
            mock_state.status = "completed"

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=mock_state), \
                 patch("app.controller.tool_controller.oauth_state_manager._states", {}):
                result = await uninstall_tool("google_calendar")

            assert result["success"] is True
            assert "Successfully uninstalled google_calendar" in result["message"]
            assert not os.path.exists(token_dir)

    @pytest.mark.asyncio
    async def test_uninstall_google_calendar_cancel_ongoing_auth(self):
        """Test Google Calendar uninstallation cancels ongoing authorization."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            mock_state = MagicMock()
            mock_state.status = "authorizing"

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=mock_state), \
                 patch("app.controller.tool_controller.oauth_state_manager._states", {"google_calendar": mock_state}):
                result = await uninstall_tool("google_calendar")

            assert result["success"] is True
            mock_state.cancel.assert_called_once()

    @pytest.mark.asyncio
    async def test_uninstall_unknown_tool(self):
        """Test uninstalling unknown tool."""
        with pytest.raises(HTTPException) as exc_info:
            await uninstall_tool("unknown_tool")

        assert exc_info.value.status_code == 404
        assert "Tool 'unknown_tool' not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_uninstall_notion_error_handling(self):
        """Test Notion uninstallation error handling."""
        with patch("os.path.expanduser", side_effect=Exception("File system error")):
            with pytest.raises(HTTPException) as exc_info:
                await uninstall_tool("notion")

        assert exc_info.value.status_code == 500
        assert "Failed to uninstall notion" in exc_info.value.detail


@pytest.mark.integration
class TestToolControllerIntegration:
    """Integration tests for tool controller."""

    def test_install_notion_tool_endpoint_integration(self, client: TestClient):
        """Test install Notion tool endpoint through FastAPI test client."""
        mock_toolkit = AsyncMock()
        mock_tools = [MagicMock(), MagicMock()]
        mock_tools[0].func.__name__ = "create_page"
        mock_tools[1].func.__name__ = "update_page"
        mock_toolkit.get_tools = MagicMock(return_value=mock_tools)

        with patch("app.controller.tool_controller.NotionMCPToolkit", return_value=mock_toolkit):
            response = client.post("/install/tool/notion")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["tools"] == ["create_page", "update_page"]
            assert data["toolkit_name"] == "NotionMCPToolkit"

    def test_install_unknown_tool_endpoint_integration(self, client: TestClient):
        """Test install unknown tool returns 404."""
        response = client.post("/install/tool/unknown_tool")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

    def test_list_available_tools_endpoint_integration(self, client: TestClient):
        """Test list available tools endpoint."""
        response = client.get("/tools/available")

        assert response.status_code == 200
        data = response.json()
        assert "tools" in data
        assert len(data["tools"]) == 2

    def test_get_oauth_status_endpoint_integration(self, client: TestClient):
        """Test get OAuth status endpoint."""
        with patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=None):
            response = client.get("/oauth/status/google_calendar")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "not_started"

    def test_cancel_oauth_endpoint_integration(self, client: TestClient):
        """Test cancel OAuth endpoint."""
        mock_state = MagicMock()
        mock_state.status = "pending"

        with patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=mock_state):
            response = client.post("/oauth/cancel/google_calendar")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_uninstall_tool_endpoint_integration(self, client: TestClient):
        """Test uninstall tool endpoint."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("os.path.expanduser", return_value=temp_dir):
                response = client.delete("/uninstall/tool/notion")

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True


@pytest.mark.unit
class TestToolControllerEdgeCases:
    """Test edge cases and error scenarios."""

    @pytest.mark.asyncio
    async def test_install_tool_with_special_characters(self):
        """Test tool installation with special characters in name."""
        with pytest.raises(HTTPException) as exc_info:
            await install_tool("notion@#$%")

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_install_notion_get_tools_failure(self):
        """Test when get_tools fails during installation - should return success with warning."""
        mock_toolkit = AsyncMock()
        mock_toolkit.get_tools = MagicMock(side_effect=Exception("Failed to get tools"))

        with patch("app.controller.tool_controller.NotionMCPToolkit", return_value=mock_toolkit):
            # Controller catches exception and returns success with warning
            result = await install_tool("notion")

            assert result["success"] is True
            assert result["tools"] == []
            assert "warning" in result
            assert "Could not connect" in result["warning"]

    @pytest.mark.asyncio
    async def test_multiple_oauth_providers(self):
        """Test OAuth status for different providers."""
        for provider in ["google_calendar", "notion", "other"]:
            with patch("app.controller.tool_controller.oauth_state_manager.get_state", return_value=None):
                result = await get_oauth_status(provider)
                assert result["provider"] == provider
                assert result["status"] == "not_started"


@pytest.mark.unit
class TestOpenBrowserLogin:
    """Test cases for open_browser_login endpoint."""

    @pytest.mark.asyncio
    async def test_open_browser_login_success(self):
        """Test successfully opening browser for login."""
        from app.controller.tool_controller import open_browser_login
        import tempfile
        import subprocess
        import socket

        with tempfile.TemporaryDirectory() as temp_dir:
            mock_process = MagicMock()
            mock_process.pid = 12345
            mock_process.stdout = MagicMock()
            mock_process.stdout.readline = MagicMock(return_value='')

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("subprocess.Popen", return_value=mock_process), \
                 patch("builtins.open", MagicMock()), \
                 patch("socket.socket") as mock_socket:

                # Mock port check to return False (port not in use)
                mock_socket.return_value.__enter__.return_value.connect_ex.return_value = 1

                result = await open_browser_login()

                assert result["success"] is True
                assert result["session_id"] == "user_login"
                assert result["cdp_port"] == 9223
                assert result["pid"] == 12345
                assert "message" in result

    @pytest.mark.asyncio
    async def test_open_browser_login_already_running(self):
        """Test opening browser when it's already running."""
        from app.controller.tool_controller import open_browser_login
        import tempfile
        import socket

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("socket.socket") as mock_socket:

                # Mock port check to return True (port in use)
                mock_socket.return_value.__enter__.return_value.connect_ex.return_value = 0

                result = await open_browser_login()

                assert result["success"] is True
                assert result["session_id"] == "user_login"
                assert "already running" in result["message"].lower()

    @pytest.mark.asyncio
    async def test_open_browser_login_failure(self):
        """Test browser opening failure."""
        from app.controller.tool_controller import open_browser_login

        with patch("os.path.expanduser", side_effect=Exception("File system error")):
            with pytest.raises(HTTPException) as exc_info:
                await open_browser_login()

            assert exc_info.value.status_code == 500
            assert "Failed to open browser" in exc_info.value.detail


@pytest.mark.unit
class TestListCookieDomains:
    """Test cases for list_cookie_domains endpoint."""

    @pytest.mark.asyncio
    async def test_list_cookie_domains_success(self):
        """Test successfully listing cookie domains."""
        from app.controller.tool_controller import list_cookie_domains
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookie_manager = MagicMock()
            mock_cookie_manager.get_cookie_domains.return_value = ["example.com", "google.com"]

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                result = await list_cookie_domains()

                assert result["success"] is True
                assert result["domains"] == ["example.com", "google.com"]
                assert result["total"] == 2

    @pytest.mark.asyncio
    async def test_list_cookie_domains_with_search(self):
        """Test listing cookie domains with search filter."""
        from app.controller.tool_controller import list_cookie_domains
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookie_manager = MagicMock()
            mock_cookie_manager.search_cookies.return_value = ["google.com"]

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                result = await list_cookie_domains(search="google")

                assert result["success"] is True
                assert result["domains"] == ["google.com"]
                mock_cookie_manager.search_cookies.assert_called_once_with("google")

    @pytest.mark.asyncio
    async def test_list_cookie_domains_no_profile(self):
        """Test listing cookies when no browser profile exists."""
        from app.controller.tool_controller import list_cookie_domains
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # Create temp dir but don't create the profile directory
            non_existent_dir = os.path.join(temp_dir, "non_existent")

            with patch("os.path.expanduser", return_value=non_existent_dir):
                result = await list_cookie_domains()

                assert result["success"] is True
                assert result["domains"] == []
                assert "No browser profile" in result["message"]

    @pytest.mark.asyncio
    async def test_list_cookie_domains_failure(self):
        """Test cookie listing failure."""
        from app.controller.tool_controller import list_cookie_domains

        with patch("os.path.expanduser", side_effect=Exception("Cookie error")):
            with pytest.raises(HTTPException) as exc_info:
                await list_cookie_domains()

            assert exc_info.value.status_code == 500
            assert "Failed to list cookies" in exc_info.value.detail


@pytest.mark.unit
class TestGetDomainCookies:
    """Test cases for get_domain_cookies endpoint."""

    @pytest.mark.asyncio
    async def test_get_domain_cookies_success(self):
        """Test successfully getting cookies for a domain."""
        from app.controller.tool_controller import get_domain_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookies = [
                {"name": "session", "value": "abc123"},
                {"name": "user_id", "value": "456"}
            ]
            mock_cookie_manager = MagicMock()
            mock_cookie_manager.get_cookies_for_domain.return_value = mock_cookies

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                result = await get_domain_cookies("example.com")

                assert result["success"] is True
                assert result["domain"] == "example.com"
                assert result["cookies"] == mock_cookies
                assert result["count"] == 2
                mock_cookie_manager.get_cookies_for_domain.assert_called_once_with("example.com")

    @pytest.mark.asyncio
    async def test_get_domain_cookies_no_profile(self):
        """Test getting cookies when no browser profile exists."""
        from app.controller.tool_controller import get_domain_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            non_existent_dir = os.path.join(temp_dir, "non_existent")

            with patch("os.path.expanduser", return_value=non_existent_dir):
                with pytest.raises(HTTPException) as exc_info:
                    await get_domain_cookies("example.com")

                assert exc_info.value.status_code == 404
                assert "No browser profile" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_domain_cookies_failure(self):
        """Test getting cookies with error."""
        from app.controller.tool_controller import get_domain_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookie_manager = MagicMock()
            mock_cookie_manager.get_cookies_for_domain.side_effect = Exception("Cookie error")

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                with pytest.raises(HTTPException) as exc_info:
                    await get_domain_cookies("example.com")

                assert exc_info.value.status_code == 500
                assert "Failed to get cookies" in exc_info.value.detail


@pytest.mark.unit
class TestDeleteDomainCookies:
    """Test cases for delete_domain_cookies endpoint."""

    @pytest.mark.asyncio
    async def test_delete_domain_cookies_success(self):
        """Test successfully deleting cookies for a domain."""
        from app.controller.tool_controller import delete_domain_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookie_manager = MagicMock()
            mock_cookie_manager.delete_cookies_for_domain.return_value = True

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                result = await delete_domain_cookies("example.com")

                assert result["success"] is True
                assert "Successfully deleted cookies" in result["message"]
                mock_cookie_manager.delete_cookies_for_domain.assert_called_once_with("example.com")

    @pytest.mark.asyncio
    async def test_delete_domain_cookies_no_profile(self):
        """Test deleting cookies when no browser profile exists."""
        from app.controller.tool_controller import delete_domain_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            non_existent_dir = os.path.join(temp_dir, "non_existent")

            with patch("os.path.expanduser", return_value=non_existent_dir):
                with pytest.raises(HTTPException) as exc_info:
                    await delete_domain_cookies("example.com")

                assert exc_info.value.status_code == 404
                assert "No browser profile" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_delete_domain_cookies_failure(self):
        """Test deleting cookies failure from cookie manager."""
        from app.controller.tool_controller import delete_domain_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookie_manager = MagicMock()
            mock_cookie_manager.delete_cookies_for_domain.return_value = False

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                with pytest.raises(HTTPException) as exc_info:
                    await delete_domain_cookies("example.com")

                assert exc_info.value.status_code == 500
                assert "Failed to delete cookies" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_delete_domain_cookies_exception(self):
        """Test deleting cookies with unexpected exception."""
        from app.controller.tool_controller import delete_domain_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookie_manager = MagicMock()
            mock_cookie_manager.delete_cookies_for_domain.side_effect = Exception("Delete error")

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                with pytest.raises(HTTPException) as exc_info:
                    await delete_domain_cookies("example.com")

                assert exc_info.value.status_code == 500
                assert "Failed to delete cookies" in exc_info.value.detail


@pytest.mark.unit
class TestDeleteAllCookies:
    """Test cases for delete_all_cookies endpoint."""

    @pytest.mark.asyncio
    async def test_delete_all_cookies_success(self):
        """Test successfully deleting all cookies."""
        from app.controller.tool_controller import delete_all_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookie_manager = MagicMock()
            mock_cookie_manager.delete_all_cookies.return_value = True

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                result = await delete_all_cookies()

                assert result["success"] is True
                assert "Successfully deleted all cookies" in result["message"]
                mock_cookie_manager.delete_all_cookies.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_all_cookies_no_profile(self):
        """Test deleting all cookies when no browser profile exists."""
        from app.controller.tool_controller import delete_all_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            non_existent_dir = os.path.join(temp_dir, "non_existent")

            with patch("os.path.expanduser", return_value=non_existent_dir):
                with pytest.raises(HTTPException) as exc_info:
                    await delete_all_cookies()

                assert exc_info.value.status_code == 404
                assert "No browser profile" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_delete_all_cookies_failure(self):
        """Test deleting all cookies failure from cookie manager."""
        from app.controller.tool_controller import delete_all_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookie_manager = MagicMock()
            mock_cookie_manager.delete_all_cookies.return_value = False

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                with pytest.raises(HTTPException) as exc_info:
                    await delete_all_cookies()

                assert exc_info.value.status_code == 500
                assert "Failed to delete all cookies" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_delete_all_cookies_exception(self):
        """Test deleting all cookies with unexpected exception."""
        from app.controller.tool_controller import delete_all_cookies
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            # When expanduser is patched, the function constructs: temp_dir/profile_user_login
            user_data_dir = os.path.join(temp_dir, "profile_user_login")
            os.makedirs(user_data_dir, exist_ok=True)

            mock_cookie_manager = MagicMock()
            mock_cookie_manager.delete_all_cookies.side_effect = Exception("Delete error")

            with patch("os.path.expanduser", return_value=temp_dir), \
                 patch("app.controller.tool_controller.CookieManager", return_value=mock_cookie_manager):

                with pytest.raises(HTTPException) as exc_info:
                    await delete_all_cookies()

                assert exc_info.value.status_code == 500
                assert "Failed to delete cookies" in exc_info.value.detail
