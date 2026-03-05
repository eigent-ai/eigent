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
from camel.tasks import Task

from app.agent.factory.task_summary import summary_task
from app.model.chat import Chat

pytestmark = pytest.mark.unit

_mod = "app.agent.factory.task_summary"


@pytest.mark.asyncio
async def test_summary_task_creates_agent_and_summarizes(sample_chat_data):
    """Test summary_task creates agent internally and generates summary."""
    options = Chat(**sample_chat_data)

    from app.service.task import task_locks

    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    mock_agent = MagicMock()
    mock_resp = MagicMock()
    mock_resp.msgs = [MagicMock(content="Task Name|Summary of the task")]
    mock_agent.step.return_value = mock_resp

    task = Task(content="Build a website", id="test_task")

    with (
        patch(
            f"{_mod}._create_summary_agent", return_value=mock_agent
        ) as mock_create,
        patch("asyncio.create_task"),
    ):
        result = await summary_task(task, options)

        assert result == "Task Name|Summary of the task"
        mock_create.assert_called_once_with(options)
        mock_agent.step.assert_called_once()
