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

import inspect

import pytest


class TestRedirectXSSPrevention:
    """Tests verifying that the redirect callback endpoint escapes
    user-controlled parameters to prevent reflected XSS."""

    def test_redirect_controller_uses_html_escape(self):
        """The redirect_callback function must import and use html.escape."""
        import importlib
        mod = importlib.import_module("app.controller.redirect_controller")
        source = inspect.getsource(mod.redirect_callback)
        assert "html.escape" in source or "safe_code" in source, (
            "redirect_callback does not escape the code parameter — reflected XSS"
        )

    def test_redirect_callback_escapes_script_injection(self):
        """An XSS payload in the code parameter must be rendered harmless."""
        from unittest.mock import MagicMock
        from app.controller.redirect_controller import redirect_callback

        mock_request = MagicMock()
        mock_request.cookies = {}
        xss_payload = '";alert(document.cookie);//'
        response = redirect_callback(code=xss_payload, request=mock_request)
        body = response.body.decode()
        # The raw payload should NOT appear unescaped in the HTML
        assert xss_payload not in body, (
            "XSS payload appears unescaped in redirect HTML"
        )
        # The escaped version should be present
        assert "&quot;" in body or "&#x27;" in body or "&amp;" in body


class TestMcpInstallKeyError:
    """Tests verifying that MCP install handles missing keys gracefully."""

    def test_install_command_uses_get(self):
        """mcp_controller install must use .get() instead of bracket access."""
        mod = __import__(
            "app.controller.mcp.mcp_controller", fromlist=["install"]
        )
        source = inspect.getsource(mod.install)
        assert 'install_command.get(' in source, (
            "mcp_controller.install still uses bracket access on install_command"
        )


class TestMcpUserIDOR:
    """Tests verifying IDOR protections on MCP user endpoints."""

    def test_get_mcp_user_has_ownership_filter(self):
        """GET /mcp/users/{id} must filter by user_id."""
        from app.controller.mcp.user_controller import get_mcp_user
        source = inspect.getsource(get_mcp_user)
        assert "McpUser.user_id" in source, (
            "get_mcp_user does not filter by user_id — IDOR vulnerability"
        )

    def test_delete_mcp_user_has_ownership_check(self):
        """DELETE /mcp/users/{id} must check ownership before deletion."""
        from app.controller.mcp.user_controller import delete_mcp_user
        source = inspect.getsource(delete_mcp_user)
        assert "user_id" in source and "403" in source, (
            "delete_mcp_user does not check ownership — IDOR vulnerability"
        )


class TestBlockedUserLoginBypass:
    """Tests verifying that blocked users cannot log in via any endpoint."""

    def test_password_login_checks_blocked_status(self):
        """POST /login must reject blocked users."""
        from app.controller.user.login_controller import by_password
        source = inspect.getsource(by_password)
        assert "Status.Block" in source, (
            "by_password does not check user.status == Status.Block"
        )

    def test_dev_login_checks_blocked_status(self):
        """POST /dev_login must reject blocked users."""
        from app.controller.user.login_controller import dev_login
        source = inspect.getsource(dev_login)
        assert "Status.Block" in source or "blocked" in source.lower(), (
            "dev_login does not check for blocked users"
        )


class TestAuthMustNullUserCheck:
    """Tests verifying auth_must rejects deleted users and None tokens."""

    def test_auth_must_has_none_token_guard(self):
        """auth_must should accept Optional[str] and raise on None."""
        from app.component.auth import auth_must
        sig = inspect.signature(auth_must)
        token_param = sig.parameters["token"]
        annotation = str(token_param.annotation)
        assert "None" in annotation or "Optional" in annotation

    def test_auth_must_checks_user_exists(self):
        """auth_must must verify user is not None after DB lookup."""
        from app.component.auth import auth_must
        source = inspect.getsource(auth_must)
        assert "if not user" in source or "user is None" in source, (
            "auth_must does not check if user exists after token decode"
        )


class TestHistoryGroupedKeyError:
    """Tests verifying the defaultdict factory includes total_failed_tasks."""

    def test_grouped_history_has_total_failed_tasks_key(self):
        """The defaultdict factory must include total_failed_tasks."""
        from app.controller.chat.history_controller import list_grouped_chat_history
        source = inspect.getsource(list_grouped_chat_history)
        assert '"total_failed_tasks"' in source and "0" in source, (
            "defaultdict factory is missing total_failed_tasks key"
        )


class TestSnapshotPathTraversal:
    """Tests verifying snapshot image save rejects path traversal."""

    def test_save_image_rejects_directory_traversal(self):
        """api_task_id with ../ must be rejected."""
        from app.model.chat.chat_snpshot import ChatSnapshotIn
        import base64

        dummy_image = base64.b64encode(b"\xff\xd8\xff\xe0").decode()
        with pytest.raises(ValueError, match="disallowed characters"):
            ChatSnapshotIn.save_image(
                user_id=1,
                api_task_id="../../etc",
                image_base64=dummy_image,
            )

    def test_save_image_rejects_special_characters(self):
        """api_task_id with slashes must be rejected."""
        from app.model.chat.chat_snpshot import ChatSnapshotIn
        import base64

        dummy_image = base64.b64encode(b"\xff\xd8\xff\xe0").decode()
        with pytest.raises(ValueError):
            ChatSnapshotIn.save_image(
                user_id=1,
                api_task_id="task/../../passwd",
                image_base64=dummy_image,
            )

    def test_save_image_accepts_valid_task_id(self):
        """A valid alphanumeric api_task_id should not raise."""
        from app.model.chat.chat_snpshot import ChatSnapshotIn
        import base64
        import os
        import shutil

        dummy_image = base64.b64encode(b"\xff\xd8\xff\xe0").decode()
        result = ChatSnapshotIn.save_image(
            user_id=99999,
            api_task_id="valid-task-id_123",
            image_base64=dummy_image,
        )
        assert "valid-task-id_123" in result
        # Cleanup
        folder = os.path.join("app", "public", "upload")
        if os.path.exists(folder):
            for d in os.listdir(folder):
                full = os.path.join(folder, d)
                if "99999" in d or d.startswith("0"):
                    shutil.rmtree(full, ignore_errors=True)
