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

from app.agent.factory import question_confirm_agent
from app.model.chat import Chat


pytestmark = pytest.mark.unit


def test_question_confirm_agent_creation(sample_chat_data):
    """Test question_confirm_agent creates specialized agent."""
    options = Chat(**sample_chat_data)

    # Setup task lock in the registry before calling agent function
    from app.service.task import task_locks
    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    with patch('app.agent.factory.question_confirm.agent_model') as mock_agent_model, \
         patch('asyncio.create_task'):
        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = question_confirm_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()

        # Check that it was called with question confirmation prompt
        call_args = mock_agent_model.call_args
        assert "question_confirm_agent" in call_args[0][0]  # agent_name
        assert "analyze a user's request" in call_args[0][1]  # system_prompt
