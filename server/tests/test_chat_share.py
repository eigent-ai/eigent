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

import os
from unittest.mock import patch

import pytest


class TestChatShareSecretKey:
    """Tests for ChatShare secret key generation.

    Validates that the hardcoded default secret key has been replaced
    with secure random generation when environment variables are not set.
    """

    def test_get_secret_key_returns_env_var_when_set(self):
        """_get_secret_key should return the environment variable value."""
        with patch.dict(os.environ, {"CHAT_SHARE_SECRET_KEY": "my-custom-key"}):
            from app.model.chat.chat_share import _get_secret_key

            assert _get_secret_key() == "my-custom-key"

    def test_get_secret_key_generates_random_when_env_not_set(self):
        """_get_secret_key should generate a random key when env var is absent."""
        env = os.environ.copy()
        env.pop("CHAT_SHARE_SECRET_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            from app.model.chat.chat_share import _get_secret_key

            key = _get_secret_key()
            assert key is not None
            assert len(key) > 20  # token_urlsafe(32) produces ~43 chars
            # Must NOT be the old hardcoded value
            assert key != "EGB1WRC9xMUVgNoIPH8tLw"

    def test_get_secret_key_generates_unique_values(self):
        """Each call without env var should produce a different key."""
        env = os.environ.copy()
        env.pop("CHAT_SHARE_SECRET_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            from app.model.chat.chat_share import _get_secret_key

            key1 = _get_secret_key()
            key2 = _get_secret_key()
            assert key1 != key2

    def test_get_salt_returns_env_var_when_set(self):
        """_get_salt should return the environment variable value."""
        with patch.dict(os.environ, {"CHAT_SHARE_SALT": "custom-salt"}):
            from app.model.chat.chat_share import _get_salt

            assert _get_salt() == "custom-salt"

    def test_get_salt_generates_random_when_env_not_set(self):
        """_get_salt should generate a random salt when env var is absent."""
        env = os.environ.copy()
        env.pop("CHAT_SHARE_SALT", None)
        with patch.dict(os.environ, env, clear=True):
            from app.model.chat.chat_share import _get_salt

            salt = _get_salt()
            assert salt is not None
            assert len(salt) > 5
            # Must NOT be the old hardcoded value
            assert salt != "r4U2M"

    def test_token_roundtrip_with_random_keys(self):
        """Tokens generated with random keys should verify correctly."""
        env = os.environ.copy()
        env.pop("CHAT_SHARE_SECRET_KEY", None)
        env.pop("CHAT_SHARE_SALT", None)
        with patch.dict(os.environ, env, clear=True):
            import importlib

            from app.model.chat import chat_share

            importlib.reload(chat_share)
            cls = chat_share.ChatShare
            token = cls.generate_token("test-task-id")
            result = cls.verify_token(token)
            assert result == "test-task-id"
