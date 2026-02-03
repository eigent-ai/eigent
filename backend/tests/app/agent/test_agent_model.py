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
from unittest.mock import MagicMock, patch

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

        _m = sys.modules['app.agent.agent_model']
        with patch.object(_m, 'ListenChatAgent') as mock_listen_agent, \
             patch.object(_m, 'ModelFactory') as mock_model_factory, \
             patch.object(_m, 'get_task_lock', return_value=mock_task_lock), \
             patch('asyncio.create_task'):

            mock_agent = MagicMock()
            mock_listen_agent.return_value = mock_agent
            mock_model_factory.create.return_value = MagicMock()

            result = agent_model(agent_name, system_prompt, options, [])

            assert result is mock_agent
            mock_listen_agent.assert_called_once()

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
        task_locks[api_task_id] = mock_task_lock

        # Create agent
        _m = sys.modules['app.agent.agent_model']
        with patch.object(_m, 'ModelFactory') as mock_model_factory, \
             patch.object(_m, '_schedule_async_task'), \
             patch.object(_m, 'ListenChatAgent') as mock_listen_agent, \
             patch.object(_m, 'get_task_lock', return_value=mock_task_lock):
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
