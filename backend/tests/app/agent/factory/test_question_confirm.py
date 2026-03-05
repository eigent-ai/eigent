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

from app.agent.factory.question_confirm import question_confirm
from app.model.chat import Chat
from app.service.task import TaskLock

pytestmark = pytest.mark.unit

_mod = "app.agent.factory.question_confirm"


@pytest.mark.asyncio
async def test_question_confirm_creates_agent(sample_chat_data):
    """Test question_confirm lazily creates and caches the agent."""
    options = Chat(**sample_chat_data)

    from app.service.task import task_locks

    mock_task_lock = MagicMock(spec=TaskLock)
    mock_task_lock.conversation_history = []
    mock_task_lock.question_agent = None
    task_locks[options.task_id] = mock_task_lock

    mock_agent = MagicMock()
    mock_resp = MagicMock()
    mock_resp.msgs = [MagicMock(content="no")]
    mock_agent.step.return_value = mock_resp

    with (
        patch(
            f"{_mod}._create_question_agent", return_value=mock_agent
        ) as mock_create,
        patch("asyncio.create_task"),
    ):
        result = await question_confirm("hello", options, mock_task_lock)

        assert result is False
        mock_create.assert_called_once_with(options)
        # Agent should be cached on task_lock
        assert mock_task_lock.question_agent is mock_agent


@pytest.mark.asyncio
async def test_question_confirm_reuses_cached_agent(sample_chat_data):
    """Test question_confirm reuses cached agent from task_lock."""
    options = Chat(**sample_chat_data)

    mock_agent = MagicMock()
    mock_resp = MagicMock()
    mock_resp.msgs = [MagicMock(content="yes")]
    mock_agent.step.return_value = mock_resp

    mock_task_lock = MagicMock(spec=TaskLock)
    mock_task_lock.conversation_history = []
    mock_task_lock.question_agent = mock_agent  # Already cached

    with patch(f"{_mod}._create_question_agent") as mock_create:
        result = await question_confirm(
            "create a file", options, mock_task_lock
        )

        assert result is True
        mock_create.assert_not_called()  # Should NOT create a new agent


@pytest.mark.asyncio
async def test_simple_answer_returns_content(sample_chat_data):
    options = Chat(**sample_chat_data)

    mock_agent = MagicMock()
    mock_resp = MagicMock()
    mock_resp.msgs = [MagicMock(content="The answer is 42.")]
    mock_agent.step.return_value = mock_resp

    mock_task_lock = MagicMock(spec=TaskLock)
    mock_task_lock.conversation_history = []
    mock_task_lock.question_agent = mock_agent

    from app.agent.factory.question_confirm import simple_answer

    result = await simple_answer(
        "What is the answer?", options, mock_task_lock
    )
    assert result == "The answer is 42."
    mock_agent.step.assert_called_once()


@pytest.mark.asyncio
async def test_simple_answer_creates_agent_when_none(sample_chat_data):
    options = Chat(**sample_chat_data)

    mock_agent = MagicMock()
    mock_resp = MagicMock()
    mock_resp.msgs = [MagicMock(content="Created and answered.")]
    mock_agent.step.return_value = mock_resp

    mock_task_lock = MagicMock(spec=TaskLock)
    mock_task_lock.conversation_history = []
    mock_task_lock.question_agent = None

    from app.agent.factory.question_confirm import simple_answer

    with patch(
        f"{_mod}._create_question_agent", return_value=mock_agent
    ) as mock_create:
        result = await simple_answer("Hello?", options, mock_task_lock)
        assert result == "Created and answered."
        mock_create.assert_called_once_with(options)
        assert mock_task_lock.question_agent is mock_agent


@pytest.mark.asyncio
async def test_simple_answer_fallback_on_empty_response(sample_chat_data):
    options = Chat(**sample_chat_data)

    mock_agent = MagicMock()
    mock_resp = MagicMock()
    mock_resp.msgs = [MagicMock(content="")]
    mock_agent.step.return_value = mock_resp

    mock_task_lock = MagicMock(spec=TaskLock)
    mock_task_lock.conversation_history = []
    mock_task_lock.question_agent = mock_agent

    from app.agent.factory.question_confirm import simple_answer

    result = await simple_answer("Hello?", options, mock_task_lock)
    assert "trouble generating" in result
