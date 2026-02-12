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

r"""Tests for the Codex OAuth manager."""

import io
import os
import stat
import tempfile
import time
from collections.abc import Generator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

from app.utils.codex_oauth import (
    CODEX_CLIENT_ID,
    CODEX_TOKEN_DEFAULT_LIFETIME,
    CODEX_TOKEN_REFRESH_THRESHOLD,
    CodexOAuthManager,
    _CallbackHandler,
    _decrypt_token_data,
    _derive_encryption_key,
    _encrypt_token_data,
    _generate_pkce_pair,
    _get_machine_identifier,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def temp_token_path() -> Generator[str, None, None]:
    r"""Create a temporary token path and patch CodexOAuthManager to use it."""
    with tempfile.TemporaryDirectory() as temp_dir:
        token_path = os.path.join(temp_dir, "codex_token.enc")
        with patch.object(
            CodexOAuthManager, "_token_path", return_value=token_path
        ):
            yield token_path


@pytest.fixture
def clean_env() -> Generator[None, None, None]:
    r"""Ensure OPENAI_API_KEY is cleaned up before and after test."""
    original = os.environ.pop("OPENAI_API_KEY", None)
    yield
    os.environ.pop("OPENAI_API_KEY", None)
    if original is not None:
        os.environ["OPENAI_API_KEY"] = original


@contextmanager
def mock_callback_request(path: str, expected_state: str | None = None):
    r"""Create a mock HTTP request for _CallbackHandler testing."""
    handler = MagicMock(spec=_CallbackHandler)
    handler.path = path
    handler.wfile = io.BytesIO()

    # Track response
    handler.response_code = None
    handler.headers_sent = {}

    def send_response(code):
        handler.response_code = code

    def send_header(name, value):
        handler.headers_sent[name] = value

    def end_headers():
        pass

    handler.send_response = send_response
    handler.send_header = send_header
    handler.end_headers = end_headers

    # Create mock server
    handler.server = MagicMock()
    handler.server.auth_code = None
    handler.server.auth_error = None
    handler.server.expected_state = expected_state

    yield handler


# ---------------------------------------------------------------------------
# PKCE Generation Tests
# ---------------------------------------------------------------------------


class TestPKCEGeneration:
    r"""Tests for PKCE code verifier and challenge generation."""

    @pytest.mark.unit
    def test_returns_tuple_of_strings(self):
        """PKCE pair should be a tuple of two strings."""
        verifier, challenge = _generate_pkce_pair()

        assert isinstance(verifier, str)
        assert isinstance(challenge, str)

    @pytest.mark.unit
    def test_verifier_meets_minimum_length(self):
        """Code verifier should be at least 43 characters (RFC 7636)."""
        verifier, _ = _generate_pkce_pair()

        assert len(verifier) >= 43

    @pytest.mark.unit
    def test_challenge_is_base64url_without_padding(self):
        """Code challenge should be valid base64url without padding."""
        _, challenge = _generate_pkce_pair()

        # Base64url should not contain +, /, or =
        assert "+" not in challenge
        assert "/" not in challenge
        assert "=" not in challenge

    @pytest.mark.unit
    def test_generates_unique_values(self):
        """Each call should generate cryptographically unique values."""
        pairs = [_generate_pkce_pair() for _ in range(10)]
        verifiers = [p[0] for p in pairs]
        challenges = [p[1] for p in pairs]

        assert len(set(verifiers)) == 10
        assert len(set(challenges)) == 10


# ---------------------------------------------------------------------------
# Machine Identifier Tests
# ---------------------------------------------------------------------------


class TestMachineIdentifier:
    r"""Tests for machine identifier generation."""

    @pytest.mark.unit
    def test_returns_bytes(self):
        """Machine identifier should be bytes."""
        identifier = _get_machine_identifier()

        assert isinstance(identifier, bytes)

    @pytest.mark.unit
    def test_is_deterministic(self):
        """Machine identifier should be consistent across calls."""
        assert _get_machine_identifier() == _get_machine_identifier()

    @pytest.mark.unit
    def test_contains_multiple_components(self):
        """Identifier should contain pipe-separated components."""
        identifier = _get_machine_identifier()
        decoded = identifier.decode("utf-8")
        components = decoded.split("|")

        # Should have at least username, hostname, platform.node, home dir
        assert len(components) >= 4


# ---------------------------------------------------------------------------
# Encryption Tests
# ---------------------------------------------------------------------------


class TestEncryption:
    r"""Tests for token encryption and decryption."""

    @pytest.mark.unit
    def test_derive_key_returns_fernet_compatible_key(self):
        """Derived key should be 44 bytes (Fernet format)."""
        key = _derive_encryption_key()

        assert isinstance(key, bytes)
        assert len(key) == 44

    @pytest.mark.unit
    def test_derive_key_is_deterministic(self):
        """Derived key should be consistent for same machine."""
        assert _derive_encryption_key() == _derive_encryption_key()

    @pytest.mark.unit
    def test_encrypt_decrypt_roundtrip(self):
        """Data should survive encryption and decryption."""
        original = {
            "access_token": "sk-test-token-123",
            "refresh_token": "rt-refresh-456",
            "expires_at": 1234567890,
            "scope": "openai.api.read",
        }

        encrypted = _encrypt_token_data(original)
        decrypted = _decrypt_token_data(encrypted)

        assert decrypted == original

    @pytest.mark.unit
    def test_encrypt_returns_bytes(self):
        """Encrypted output should be bytes."""
        encrypted = _encrypt_token_data({"access_token": "test"})

        assert isinstance(encrypted, bytes)
        assert len(encrypted) > 0

    @pytest.mark.unit
    def test_encrypted_data_differs_from_input(self):
        """Encrypted data should not contain plaintext."""
        token = "my_secret_token"
        encrypted = _encrypt_token_data({"access_token": token})

        assert token.encode() not in encrypted

    @pytest.mark.unit
    def test_decrypt_invalid_data_returns_none(self):
        """Decrypting garbage data should return None, not raise."""
        assert _decrypt_token_data(b"not-valid-fernet-data") is None

    @pytest.mark.unit
    def test_decrypt_corrupted_data_returns_none(self):
        """Decrypting tampered data should return None."""
        encrypted = _encrypt_token_data({"access_token": "test"})
        corrupted = encrypted[:-10] + b"tampered!!"

        assert _decrypt_token_data(corrupted) is None

    @pytest.mark.unit
    def test_decrypt_empty_data_returns_none(self):
        """Decrypting empty data should return None."""
        assert _decrypt_token_data(b"") is None


# ---------------------------------------------------------------------------
# Callback Handler Tests
# ---------------------------------------------------------------------------


class TestCallbackHandler:
    r"""Tests for OAuth callback HTTP handler."""

    @pytest.mark.unit
    def test_captures_authorization_code(self):
        """Handler should capture auth code from callback URL."""
        path = "/auth/callback?code=auth_code_123&state=valid_state"
        with mock_callback_request(
            path, expected_state="valid_state"
        ) as handler:
            _CallbackHandler.do_GET(handler)

            assert handler.server.auth_code == "auth_code_123"
            assert handler.response_code == 200

    @pytest.mark.unit
    def test_captures_error_response(self):
        """Handler should capture error from callback URL."""
        path = "/auth/callback?error=access_denied&error_description=User%20denied"
        with mock_callback_request(path) as handler:
            _CallbackHandler.do_GET(handler)

            assert handler.server.auth_error == "access_denied: User denied"
            assert handler.response_code == 400

    @pytest.mark.unit
    def test_handles_missing_code(self):
        """Handler should return 400 when code is missing."""
        with mock_callback_request("/auth/callback?state=xyz") as handler:
            _CallbackHandler.do_GET(handler)

            assert handler.response_code == 400
            assert handler.server.auth_code is None

    @pytest.mark.unit
    def test_escapes_html_in_error(self):
        """Handler should escape HTML in error messages to prevent XSS."""
        path = "/auth/callback?error=<script>&error_description=<img>"
        with mock_callback_request(path) as handler:
            _CallbackHandler.do_GET(handler)

            output = handler.wfile.getvalue().decode()
            assert "<script>" not in output
            assert "&lt;script&gt;" in output or "script" not in output

    @pytest.mark.unit
    def test_rejects_mismatched_state(self):
        """Handler should reject callback with mismatched state (CSRF protection)."""
        path = "/auth/callback?code=auth_code_123&state=wrong_state"
        with mock_callback_request(
            path, expected_state="correct_state"
        ) as handler:
            _CallbackHandler.do_GET(handler)

            assert handler.response_code == 400
            assert handler.server.auth_code is None
            assert "state_mismatch" in handler.server.auth_error

    @pytest.mark.unit
    def test_accepts_matching_state(self):
        """Handler should accept callback with matching state."""
        path = "/auth/callback?code=auth_code_123&state=my_state_value"
        with mock_callback_request(
            path, expected_state="my_state_value"
        ) as handler:
            _CallbackHandler.do_GET(handler)

            assert handler.response_code == 200
            assert handler.server.auth_code == "auth_code_123"
            assert handler.server.auth_error is None

    @pytest.mark.unit
    def test_skips_state_validation_when_not_expected(self):
        """Handler should skip state validation if server has no expected_state."""
        path = "/auth/callback?code=auth_code_123"
        with mock_callback_request(path, expected_state=None) as handler:
            _CallbackHandler.do_GET(handler)

            assert handler.response_code == 200
            assert handler.server.auth_code == "auth_code_123"


# ---------------------------------------------------------------------------
# Token Operations Tests
# ---------------------------------------------------------------------------


class TestTokenOperations:
    r"""Tests for CodexOAuthManager token save/load/clear."""

    @pytest.mark.unit
    def test_save_creates_directory_structure(self, clean_env):
        """save_token should create parent directories."""
        with tempfile.TemporaryDirectory() as temp_dir:
            nested_path = os.path.join(temp_dir, "a", "b", "c", "token.enc")
            with patch.object(
                CodexOAuthManager, "_token_path", return_value=nested_path
            ):
                result = CodexOAuthManager.save_token({"access_token": "test"})

                assert result is True
                assert os.path.exists(nested_path)

    @pytest.mark.unit
    def test_save_sets_restrictive_permissions(
        self, temp_token_path, clean_env
    ):
        """Token file should have owner-only read/write permissions."""
        CodexOAuthManager.save_token({"access_token": "secret"})

        file_stat = os.stat(temp_token_path)
        mode = stat.S_IMODE(file_stat.st_mode)

        assert mode == (stat.S_IRUSR | stat.S_IWUSR)

    @pytest.mark.unit
    def test_save_sets_environment_variable(self, temp_token_path, clean_env):
        """save_token should set OPENAI_API_KEY environment variable."""
        CodexOAuthManager.save_token({"access_token": "sk-test-key"})

        assert os.environ.get("OPENAI_API_KEY") == "sk-test-key"

    @pytest.mark.unit
    def test_save_computes_expires_at_from_expires_in(
        self, temp_token_path, clean_env
    ):
        """save_token should convert expires_in to absolute expires_at."""
        before = int(time.time())
        CodexOAuthManager.save_token(
            {
                "access_token": "test",
                "expires_in": 3600,
            }
        )
        after = int(time.time())

        loaded = CodexOAuthManager.load_token()

        assert "expires_at" in loaded
        assert "expires_in" not in loaded
        assert before + 3600 <= loaded["expires_at"] <= after + 3600

    @pytest.mark.unit
    def test_save_uses_default_lifetime_when_no_expiry(
        self, temp_token_path, clean_env
    ):
        """save_token should use default lifetime if no expiry provided."""
        before = int(time.time())
        CodexOAuthManager.save_token({"access_token": "test"})

        loaded = CodexOAuthManager.load_token()
        expected = before + CODEX_TOKEN_DEFAULT_LIFETIME

        assert loaded["expires_at"] >= expected

    @pytest.mark.unit
    def test_save_preserves_existing_expires_at(
        self, temp_token_path, clean_env
    ):
        """save_token should preserve explicit expires_at."""
        explicit_time = 9999999999
        CodexOAuthManager.save_token(
            {
                "access_token": "test",
                "expires_at": explicit_time,
            }
        )

        loaded = CodexOAuthManager.load_token()

        assert loaded["expires_at"] == explicit_time

    @pytest.mark.unit
    def test_load_returns_none_when_no_file(self, temp_token_path):
        """load_token should return None if file doesn't exist."""
        assert CodexOAuthManager.load_token() is None

    @pytest.mark.unit
    def test_load_returns_saved_data(self, temp_token_path, clean_env):
        """load_token should return previously saved data."""
        CodexOAuthManager.save_token(
            {
                "access_token": "my-token",
                "refresh_token": "my-refresh",
                "scope": "openai.api.read",
            }
        )

        loaded = CodexOAuthManager.load_token()

        assert loaded["access_token"] == "my-token"
        assert loaded["refresh_token"] == "my-refresh"
        assert loaded["scope"] == "openai.api.read"

    @pytest.mark.unit
    def test_clear_removes_token_file(self, temp_token_path, clean_env):
        """clear_token should delete the token file."""
        CodexOAuthManager.save_token({"access_token": "test"})
        assert os.path.exists(temp_token_path)

        result = CodexOAuthManager.clear_token()

        assert result is True
        assert not os.path.exists(temp_token_path)

    @pytest.mark.unit
    def test_clear_removes_environment_variable(
        self, temp_token_path, clean_env
    ):
        """clear_token should unset OPENAI_API_KEY."""
        os.environ["OPENAI_API_KEY"] = "to-be-removed"

        CodexOAuthManager.clear_token()

        assert "OPENAI_API_KEY" not in os.environ

    @pytest.mark.unit
    def test_clear_succeeds_when_no_file(self, temp_token_path):
        """clear_token should succeed even if no token file exists."""
        result = CodexOAuthManager.clear_token()

        assert result is True

    @pytest.mark.unit
    def test_get_token_info_returns_full_token_data(
        self, temp_token_path, clean_env
    ):
        """get_token_info should return complete stored token."""
        CodexOAuthManager.save_token(
            {
                "access_token": "token",
                "refresh_token": "refresh",
            }
        )

        info = CodexOAuthManager.get_token_info()

        assert info["access_token"] == "token"
        assert info["refresh_token"] == "refresh"
        assert "saved_at" in info
        assert "expires_at" in info


# ---------------------------------------------------------------------------
# Authentication Status Tests
# ---------------------------------------------------------------------------


class TestAuthenticationStatus:
    r"""Tests for authentication status checking."""

    @pytest.mark.unit
    def test_is_authenticated_true_with_token_file(
        self, temp_token_path, clean_env
    ):
        """is_authenticated should return True when token file exists."""
        CodexOAuthManager.save_token({"access_token": "file-token"})

        assert CodexOAuthManager.is_authenticated() is True

    @pytest.mark.unit
    def test_is_authenticated_false_with_only_env_var(self, temp_token_path):
        """is_authenticated should return False when only env var is set (no Codex OAuth token)."""
        os.environ["OPENAI_API_KEY"] = "env-token"

        try:
            # Codex OAuth status should not be affected by generic OPENAI_API_KEY
            assert CodexOAuthManager.is_authenticated() is False
        finally:
            os.environ.pop("OPENAI_API_KEY", None)

    @pytest.mark.unit
    def test_is_authenticated_false_when_nothing_configured(
        self, temp_token_path, clean_env
    ):
        """is_authenticated should return False with no credentials."""
        assert CodexOAuthManager.is_authenticated() is False

    @pytest.mark.unit
    def test_get_access_token_prefers_file_over_env(
        self, temp_token_path, clean_env
    ):
        """get_access_token should prefer file token over env var."""
        CodexOAuthManager.save_token({"access_token": "file-token"})
        os.environ["OPENAI_API_KEY"] = "env-token"

        token = CodexOAuthManager.get_access_token()

        assert token == "file-token"

    @pytest.mark.unit
    def test_get_access_token_returns_none_without_oauth_token(
        self, temp_token_path
    ):
        """get_access_token should return None when no Codex OAuth token exists."""
        os.environ["OPENAI_API_KEY"] = "env-fallback"

        try:
            # Should not fall back to env var; Codex OAuth token is separate
            assert CodexOAuthManager.get_access_token() is None
        finally:
            os.environ.pop("OPENAI_API_KEY", None)

    @pytest.mark.unit
    def test_get_access_token_returns_none_when_nothing(
        self, temp_token_path, clean_env
    ):
        """get_access_token should return None with no credentials."""
        assert CodexOAuthManager.get_access_token() is None


# ---------------------------------------------------------------------------
# Token Expiry Tests
# ---------------------------------------------------------------------------


class TestTokenExpiry:
    r"""Tests for token expiration checking."""

    @pytest.mark.unit
    def test_is_expired_false_when_no_token(self, temp_token_path):
        """is_token_expired should return False if no token exists."""
        assert CodexOAuthManager.is_token_expired() is False

    @pytest.mark.unit
    def test_is_expired_false_when_token_valid(
        self, temp_token_path, clean_env
    ):
        """is_token_expired should return False for valid token."""
        future = int(time.time()) + 3600
        CodexOAuthManager.save_token(
            {
                "access_token": "test",
                "expires_at": future,
            }
        )

        assert CodexOAuthManager.is_token_expired() is False

    @pytest.mark.unit
    def test_is_expired_true_when_token_expired(
        self, temp_token_path, clean_env
    ):
        """is_token_expired should return True for expired token."""
        past = int(time.time()) - 100
        CodexOAuthManager.save_token(
            {
                "access_token": "test",
                "expires_at": past,
            }
        )

        assert CodexOAuthManager.is_token_expired() is True

    @pytest.mark.unit
    def test_is_expired_false_when_no_expires_at(
        self, temp_token_path, clean_env
    ):
        """is_token_expired should return False if expires_at missing."""
        # Directly write token without expires_at
        token_data = {"access_token": "test", "saved_at": int(time.time())}
        encrypted = _encrypt_token_data(token_data)
        os.makedirs(os.path.dirname(temp_token_path), exist_ok=True)
        with open(temp_token_path, "wb") as f:
            f.write(encrypted)

        assert CodexOAuthManager.is_token_expired() is False

    @pytest.mark.unit
    def test_is_expiring_soon_false_when_no_token(self, temp_token_path):
        """is_token_expiring_soon should return False if no token."""
        assert CodexOAuthManager.is_token_expiring_soon() is False

    @pytest.mark.unit
    def test_is_expiring_soon_true_within_threshold(
        self, temp_token_path, clean_env
    ):
        """is_token_expiring_soon should return True within threshold."""
        soon = int(time.time()) + CODEX_TOKEN_REFRESH_THRESHOLD - 60
        CodexOAuthManager.save_token(
            {
                "access_token": "test",
                "expires_at": soon,
            }
        )

        assert CodexOAuthManager.is_token_expiring_soon() is True

    @pytest.mark.unit
    def test_is_expiring_soon_false_with_plenty_of_time(
        self, temp_token_path, clean_env
    ):
        """is_token_expiring_soon should return False with ample time."""
        future = int(time.time()) + 3600
        CodexOAuthManager.save_token(
            {
                "access_token": "test",
                "expires_at": future,
            }
        )

        assert CodexOAuthManager.is_token_expiring_soon() is False


# ---------------------------------------------------------------------------
# Token Refresh Tests
# ---------------------------------------------------------------------------


class TestTokenRefresh:
    r"""Tests for token refresh functionality."""

    @pytest.mark.unit
    def test_refresh_returns_false_when_no_token(self, temp_token_path):
        """refresh_token_if_needed should return False with no token."""
        assert CodexOAuthManager.refresh_token_if_needed() is False

    @pytest.mark.unit
    def test_refresh_returns_true_when_not_expiring(
        self, temp_token_path, clean_env
    ):
        """refresh_token_if_needed should return True if not expiring."""
        future = int(time.time()) + 3600
        CodexOAuthManager.save_token(
            {
                "access_token": "test",
                "expires_at": future,
            }
        )

        assert CodexOAuthManager.refresh_token_if_needed() is True

    @pytest.mark.unit
    def test_refresh_returns_false_without_refresh_token(
        self, temp_token_path, clean_env
    ):
        """refresh should return False if no refresh token available."""
        soon = int(time.time()) + CODEX_TOKEN_REFRESH_THRESHOLD - 60
        CodexOAuthManager.save_token(
            {
                "access_token": "test",
                "expires_at": soon,
            }
        )

        assert CodexOAuthManager.refresh_token_if_needed() is False

    @pytest.mark.unit
    def test_refresh_calls_token_endpoint(self, temp_token_path, clean_env):
        """refresh should call OpenAI token endpoint with correct params."""
        soon = int(time.time()) + CODEX_TOKEN_REFRESH_THRESHOLD - 60
        CodexOAuthManager.save_token(
            {
                "access_token": "old-token",
                "refresh_token": "refresh-123",
                "expires_at": soon,
            }
        )

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "new-token",
            "expires_in": 3600,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("requests.post", return_value=mock_response) as mock_post:
            result = CodexOAuthManager.refresh_token_if_needed()

            assert result is True
            mock_post.assert_called_once()

            call_kwargs = mock_post.call_args
            assert call_kwargs[1]["data"]["grant_type"] == "refresh_token"
            assert call_kwargs[1]["data"]["client_id"] == CODEX_CLIENT_ID
            assert call_kwargs[1]["data"]["refresh_token"] == "refresh-123"

    @pytest.mark.unit
    def test_refresh_saves_new_token(self, temp_token_path, clean_env):
        """refresh should save the new token after successful refresh."""
        soon = int(time.time()) + CODEX_TOKEN_REFRESH_THRESHOLD - 60
        CodexOAuthManager.save_token(
            {
                "access_token": "old-token",
                "refresh_token": "refresh-123",
                "expires_at": soon,
            }
        )

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "brand-new-token",
            "expires_in": 7200,
            "refresh_token": "new-refresh-456",
        }
        mock_response.raise_for_status = MagicMock()

        with patch("requests.post", return_value=mock_response):
            CodexOAuthManager.refresh_token_if_needed()

            loaded = CodexOAuthManager.load_token()
            assert loaded["access_token"] == "brand-new-token"
            assert loaded["refresh_token"] == "new-refresh-456"

    @pytest.mark.unit
    def test_refresh_returns_false_on_api_error(
        self, temp_token_path, clean_env
    ):
        """refresh should return False if API call fails."""
        soon = int(time.time()) + CODEX_TOKEN_REFRESH_THRESHOLD - 60
        CodexOAuthManager.save_token(
            {
                "access_token": "test",
                "refresh_token": "refresh",
                "expires_at": soon,
            }
        )

        with patch("requests.post", side_effect=Exception("Network error")):
            result = CodexOAuthManager.refresh_token_if_needed()

            assert result is False


# ---------------------------------------------------------------------------
# Background Auth Tests
# ---------------------------------------------------------------------------


class TestBackgroundAuth:
    r"""Tests for background OAuth flow."""

    @pytest.mark.unit
    def test_start_returns_authorizing(self):
        """start_background_auth should return 'authorizing'."""
        with patch("app.utils.codex_oauth.oauth_state_manager") as mock_mgr:
            mock_state = MagicMock()
            mock_state.status = "pending"
            mock_state.is_cancelled.return_value = False
            mock_mgr.get_state.return_value = None
            mock_mgr.create_state.return_value = mock_state

            with (
                patch("webbrowser.open"),
                patch("app.utils.codex_oauth.HTTPServer") as mock_server,
            ):
                mock_server.return_value.server_address = ("127.0.0.1", 9999)

                result = CodexOAuthManager.start_background_auth()

                assert result == "authorizing"

    @pytest.mark.unit
    def test_start_cancels_existing_pending_flow(self):
        """start_background_auth should cancel any existing flow."""
        with patch("app.utils.codex_oauth.oauth_state_manager") as mock_mgr:
            old_state = MagicMock()
            old_state.status = "authorizing"
            old_state.server = MagicMock()

            new_state = MagicMock()
            new_state.status = "pending"
            new_state.is_cancelled.return_value = False

            mock_mgr.get_state.return_value = old_state
            mock_mgr.create_state.return_value = new_state

            with (
                patch("webbrowser.open"),
                patch("app.utils.codex_oauth.HTTPServer") as mock_server,
            ):
                mock_server.return_value.server_address = ("127.0.0.1", 9999)

                CodexOAuthManager.start_background_auth()

                old_state.cancel.assert_called_once()

    @pytest.mark.unit
    def test_start_creates_new_oauth_state(self):
        """start_background_auth should create a new OAuth state."""
        with patch("app.utils.codex_oauth.oauth_state_manager") as mock_mgr:
            mock_state = MagicMock()
            mock_state.status = "pending"
            mock_state.is_cancelled.return_value = False
            mock_mgr.get_state.return_value = None
            mock_mgr.create_state.return_value = mock_state

            with (
                patch("webbrowser.open"),
                patch("app.utils.codex_oauth.HTTPServer") as mock_server,
            ):
                mock_server.return_value.server_address = ("127.0.0.1", 9999)

                CodexOAuthManager.start_background_auth()

                mock_mgr.create_state.assert_called_once_with("codex")


# ---------------------------------------------------------------------------
# Constants Tests
# ---------------------------------------------------------------------------


class TestConstants:
    r"""Tests for module constants."""

    @pytest.mark.unit
    def test_default_lifetime_is_one_hour(self):
        """Default token lifetime should be 3600 seconds (1 hour)."""
        assert CODEX_TOKEN_DEFAULT_LIFETIME == 3600

    @pytest.mark.unit
    def test_refresh_threshold_is_five_minutes(self):
        """Refresh threshold should be 300 seconds (5 minutes)."""
        assert CODEX_TOKEN_REFRESH_THRESHOLD == 300

    @pytest.mark.unit
    def test_client_id_is_codex_cli_public_id(self):
        """Client ID should be the public Codex CLI client ID."""
        assert CODEX_CLIENT_ID == "app_EMoamEEZ73f0CkXaXp7hrann"
