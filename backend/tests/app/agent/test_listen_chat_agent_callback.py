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

from app.agent.listen_chat_agent import ListenChatAgent
from app.agent.listen_chat_agent_callback import (
    StepCompletedEvent,
    StepFailedEvent,
    StepStartedEvent,
)

_LCA = "app.agent.listen_chat_agent"


@pytest.fixture
def mock_task_lock():
    mock_lock = MagicMock()
    mock_lock.put_queue = MagicMock()
    return mock_lock


def _make_agent(mock_task_lock, mock_create_model):
    mock_backend = MagicMock()
    mock_backend.model_type = "gpt-4"
    mock_backend.current_model = MagicMock()
    mock_backend.current_model.model_type = "gpt-4"
    mock_create_model.return_value = mock_backend

    agent = ListenChatAgent(
        api_task_id="test_api_task_123",
        agent_name="TestAgent",
        model="gpt-4",
    )
    agent.process_task_id = "test_process_task"
    agent.agent_id = "test_agent_123"
    return agent


class TestListenChatAgentCallback:
    def test_handles_step_events(self, mock_task_lock):
        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
            patch("app.agent.listen_chat_agent_callback._schedule_async_task"),
        ):
            agent = _make_agent(mock_task_lock, mock_create_model)

            agent._listen_callback.handle_event(
                StepStartedEvent(
                    agent_id=agent.agent_id,
                    role_name=agent.role_name,
                    input_summary="Test input message",
                )
            )
            agent._listen_callback.handle_event(
                StepCompletedEvent(
                    agent_id=agent.agent_id,
                    role_name=agent.role_name,
                    output_summary="Test response content",
                    usage={"total_tokens": 100},
                )
            )

            assert mock_task_lock.put_queue.call_count == 2

    def test_handles_budget_failure(self, mock_task_lock):
        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
            patch("app.agent.listen_chat_agent_callback._schedule_async_task"),
        ):
            agent = _make_agent(mock_task_lock, mock_create_model)

            agent._listen_callback.handle_event(
                StepFailedEvent(
                    agent_id=agent.agent_id,
                    role_name=agent.role_name,
                    error_message="Budget has been exceeded",
                )
            )

            assert mock_task_lock.put_queue.call_count == 2
