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

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agent.agent_model import agent_model
from app.model.chat import Chat

pytestmark = pytest.mark.unit


class TestAgentFactoryFunctions:
    """Test cases for agent factory functions."""

    def test_agent_model_creation(self, sample_chat_data):
        """Test agent_model creates agent properly."""
        options = Chat(**sample_chat_data)
        agent_name = "TestAgent"
        system_prompt = "You are a helpful assistant"

        # Setup task lock in the registry before calling agent_model
        from app.service.task import task_locks

        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        mock_task_lock.put_queue = AsyncMock()

        _m = sys.modules["app.agent.agent_model"]
        with (
            patch.object(_m, "ListenChatAgent") as mock_listen_agent,
            patch.object(_m, "ModelFactory") as mock_model_factory,
            patch.object(_m, "get_task_lock", return_value=mock_task_lock),
            patch("asyncio.create_task"),
        ):
            mock_agent = MagicMock()
            mock_listen_agent.return_value = mock_agent
            mock_model_factory.create.return_value = MagicMock()

            result = agent_model(agent_name, system_prompt, options, [])

            assert result is mock_agent
            mock_listen_agent.assert_called_once()

    def test_codex_subscription_model_uses_responses_api(
        self, monkeypatch, sample_chat_data
    ):
        """Codex subscription must call the Responses API, not chat completions."""
        options = Chat(
            **{
                **sample_chat_data,
                "api_key": "",
                "api_url": "",
                "model_platform": "openai",
                "model_type": "gpt-5.5",
                "auth_source": "codex_subscription",
            }
        )
        monkeypatch.setenv("CODEX_RESOLVER_URL", "http://127.0.0.1:12345")
        monkeypatch.setenv("CODEX_RESOLVER_SECRET", "resolver-secret")

        from app.model.subscription_runtime import codex
        from app.service.task import task_locks

        class Response:
            status_code = 200

            def json(self):
                return {
                    "access_token": "fresh-local-token",
                    "token_type": "Bearer",
                    "status": "connected",
                }

        monkeypatch.setattr(
            codex.httpx, "post", lambda *args, **kwargs: Response()
        )

        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        mock_task_lock.put_queue = AsyncMock()

        _m = sys.modules["app.agent.agent_model"]
        with (
            patch.object(_m, "ListenChatAgent") as mock_listen_agent,
            patch.object(_m, "ModelFactory") as mock_model_factory,
            patch.object(_m, "get_task_lock", return_value=mock_task_lock),
            patch("asyncio.create_task"),
        ):
            mock_listen_agent.return_value = MagicMock()
            mock_model_factory.create.return_value = MagicMock()

            agent_model("TestAgent", "You are helpful", options, [])

        _, kwargs = mock_model_factory.create.call_args
        assert kwargs["model_platform"] == "openai"
        assert kwargs["model_type"] == "gpt-5.5"
        assert kwargs["url"] == "https://chatgpt.com/backend-api/codex"
        assert kwargs["api_mode"] == "responses"
        assert kwargs["model_config_dict"]["stream"] is True
        assert kwargs["model_config_dict"]["store"] is False
        assert kwargs["default_headers"]["originator"] == "codex_cli_rs"

    def test_non_codex_model_does_not_inherit_subscription_runtime_params(
        self, sample_chat_data
    ):
        """Switching away from Codex must not keep Codex-only runtime params."""
        options = Chat(
            **{
                **sample_chat_data,
                "api_key": "legacy-key",
                "api_url": "https://api.openai.com/v1",
                "model_platform": "openai",
                "model_type": "gpt-4o",
                "auth_source": None,
                "extra_params": {},
            }
        )

        from app.service.task import task_locks

        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        mock_task_lock.put_queue = AsyncMock()

        _m = sys.modules["app.agent.agent_model"]
        with (
            patch.object(_m, "ListenChatAgent"),
            patch.object(_m, "ModelFactory") as mock_model_factory,
            patch.object(_m, "get_task_lock", return_value=mock_task_lock),
            patch("asyncio.create_task"),
        ):
            mock_model_factory.create.return_value = MagicMock()

            agent_model("TestAgent", "You are helpful", options, [])

        _, kwargs = mock_model_factory.create.call_args
        model_config = kwargs["model_config_dict"] or {}
        assert "api_mode" not in kwargs
        assert "stream" not in model_config
        assert "store" not in model_config
        assert kwargs["url"] == "https://api.openai.com/v1"

    def test_agent_model_with_missing_options(self):
        """Test agent_model with missing required options."""
        agent_name = "ErrorAgent"
        system_prompt = "Test prompt"

        # Missing required Chat options
        with pytest.raises((AttributeError, KeyError)):
            agent_model(agent_name, system_prompt, None, [])


@pytest.mark.integration
class TestAgentIntegration:
    """Integration tests for agent utilities."""

    def setup_method(self):
        """Clean up before each test."""
        from app.service.task import task_locks

        task_locks.clear()

    @pytest.mark.asyncio
    async def test_full_agent_workflow(self, sample_chat_data):
        """Test complete agent creation and usage workflow."""
        from app.service.task import task_locks

        options = Chat(**sample_chat_data)
        api_task_id = options.task_id

        # Create task lock
        mock_task_lock = MagicMock()
        mock_task_lock.put_queue = AsyncMock()
        task_locks[api_task_id] = mock_task_lock

        # Create agent
        _m = sys.modules["app.agent.agent_model"]
        with (
            patch.object(_m, "ModelFactory") as mock_model_factory,
            patch.object(_m, "_schedule_async_task"),
            patch.object(_m, "ListenChatAgent") as mock_listen_agent,
            patch.object(_m, "get_task_lock", return_value=mock_task_lock),
        ):
            mock_model = MagicMock()
            mock_model_factory.return_value = mock_model

            mock_agent_instance = MagicMock()
            mock_agent_instance.api_task_id = api_task_id
            mock_listen_agent.return_value = mock_agent_instance

            agent = agent_model(
                "IntegrationAgent", "Test system prompt", options, []
            )

            assert agent is mock_agent_instance
            assert agent.api_task_id == api_task_id

            # Test step operation
            mock_response = MagicMock()
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Test response"
            mock_response.info = {"usage": {"total_tokens": 50}}

            agent.step = MagicMock(return_value=mock_response)
            result = agent.step("Test message")
            assert result is mock_response
