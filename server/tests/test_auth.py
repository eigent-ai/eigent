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

from app.controller.chat.share_controller import (
    create_share_link,
    get_share_info,
    share_playback,
)


class TestAuthMustNoneTokenHandling:
    """Tests for auth_must handling of None tokens.

    When oauth2_scheme is configured with auto_error=False, it returns
    None instead of raising 401 when no token is provided. auth_must
    must explicitly handle this case instead of passing None to
    jwt.decode() which produces an opaque DecodeError.
    """

    def test_auth_must_has_none_type_annotation(self):
        """auth_must should accept Optional[str] since oauth2_scheme
        may return None with auto_error=False."""
        from app.component.auth import auth_must

        sig = inspect.signature(auth_must)
        token_param = sig.parameters["token"]
        annotation = str(token_param.annotation)
        # Should accept None (str | None or Optional[str])
        assert "None" in annotation or "Optional" in annotation

    def test_auth_must_raises_on_none_token(self):
        """auth_must should raise TokenException immediately when
        token is None, not pass it to jwt.decode()."""
        import asyncio
        from unittest.mock import MagicMock

        from app.component.auth import auth_must
        from app.exception.exception import TokenException

        mock_session = MagicMock()

        with pytest.raises(TokenException):
            asyncio.run(auth_must(token=None, session=mock_session))

    def test_auth_must_does_not_call_decode_on_none(self):
        """Verify jwt.decode is never called with None token."""
        import asyncio
        from unittest.mock import MagicMock, patch

        from app.component.auth import auth_must

        mock_session = MagicMock()

        with patch("app.component.auth.Auth.decode_token") as mock_decode:
            try:
                asyncio.run(auth_must(token=None, session=mock_session))
            except Exception:
                pass
            mock_decode.assert_not_called()


class TestSnapshotEndpointAuthRequirements:
    """Tests verifying that all snapshot CRUD endpoints require authentication.

    The list endpoint was previously missing the auth dependency, allowing
    unauthenticated users to enumerate all snapshots across all users.
    """

    def test_list_snapshots_requires_auth_dependency(self):
        """GET /snapshots must include auth_must as a dependency."""
        from app.controller.chat.snapshot_controller import list_chat_snapshots

        sig = inspect.signature(list_chat_snapshots)
        param_names = list(sig.parameters.keys())
        assert "auth" in param_names, (
            "list_chat_snapshots is missing the 'auth' parameter — unauthenticated users can list all snapshots"
        )

    def test_get_snapshot_requires_auth_dependency(self):
        """GET /snapshots/{id} must include auth_must as a dependency."""
        from app.controller.chat.snapshot_controller import get_chat_snapshot

        sig = inspect.signature(get_chat_snapshot)
        param_names = list(sig.parameters.keys())
        assert "auth" in param_names

    def test_create_snapshot_requires_auth_dependency(self):
        """POST /snapshots must include auth_must as a dependency."""
        from app.controller.chat.snapshot_controller import create_chat_snapshot

        sig = inspect.signature(create_chat_snapshot)
        param_names = list(sig.parameters.keys())
        assert "auth" in param_names

    def test_update_snapshot_requires_auth_dependency(self):
        """PUT /snapshots/{id} must include auth_must as a dependency."""
        from app.controller.chat.snapshot_controller import update_chat_snapshot

        sig = inspect.signature(update_chat_snapshot)
        param_names = list(sig.parameters.keys())
        assert "auth" in param_names

    def test_delete_snapshot_requires_auth_dependency(self):
        """DELETE /snapshots/{id} must include auth_must as a dependency."""
        from app.controller.chat.snapshot_controller import delete_chat_snapshot

        sig = inspect.signature(delete_chat_snapshot)
        param_names = list(sig.parameters.keys())
        assert "auth" in param_names


def test_create_share_link_requires_auth_dependency():
    """POST /share must include auth_must as a dependency."""
    sig = inspect.signature(create_share_link)
    param_names = list(sig.parameters.keys())
    assert "auth" in param_names, (
        "create_share_link is missing the 'auth' parameter — unauthenticated users can generate share tokens"
    )


def test_share_read_endpoints_remain_public():
    """GET /share/info and /share/playback should remain public
    since they verify the share token itself."""
    # These endpoints use the share token for auth, not user auth
    info_params = list(inspect.signature(get_share_info).parameters.keys())
    playback_params = list(inspect.signature(share_playback).parameters.keys())
    assert "token" in info_params
    assert "token" in playback_params
