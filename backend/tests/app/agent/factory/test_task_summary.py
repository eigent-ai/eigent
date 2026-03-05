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


@pytest.mark.asyncio
async def test_summary_subtasks_result(sample_chat_data):
    from app.agent.factory.task_summary import summary_subtasks_result

    options = Chat(**sample_chat_data)

    parent = Task(content="Build a web app", id="parent")
    sub1 = Task(content="Create frontend", id="sub1")
    sub1.result = "Frontend done"
    sub2 = Task(content="Create backend", id="sub2")
    sub2.result = "Backend done"
    parent.add_subtask(sub1)
    parent.add_subtask(sub2)

    mock_agent = MagicMock()
    mock_resp = MagicMock()
    mock_resp.msgs = [
        MagicMock(content="Both frontend and backend completed.")
    ]
    mock_agent.step.return_value = mock_resp

    with patch(f"{_mod}._create_summary_agent", return_value=mock_agent):
        result = await summary_subtasks_result(parent, options)

    assert result == "Both frontend and backend completed."
    call_args = mock_agent.step.call_args[0][0]
    assert "Create frontend" in call_args
    assert "Create backend" in call_args
    assert "Frontend done" in call_args
    assert "Backend done" in call_args


@pytest.mark.asyncio
async def test_get_task_result_with_optional_summary_multiple_subtasks(
    sample_chat_data,
):
    from app.agent.factory.task_summary import (
        get_task_result_with_optional_summary,
    )

    options = Chat(**sample_chat_data)

    parent = Task(content="Multi-step task", id="parent")
    parent.result = "Raw aggregated result"
    sub1 = Task(content="Step 1", id="s1")
    sub1.result = "Step 1 done"
    sub2 = Task(content="Step 2", id="s2")
    sub2.result = "Step 2 done"
    parent.add_subtask(sub1)
    parent.add_subtask(sub2)

    mock_agent = MagicMock()
    mock_resp = MagicMock()
    mock_resp.msgs = [MagicMock(content="Summarized multi-step result")]
    mock_agent.step.return_value = mock_resp

    with patch(f"{_mod}._create_summary_agent", return_value=mock_agent):
        result = await get_task_result_with_optional_summary(parent, options)

    assert result == "Summarized multi-step result"


@pytest.mark.asyncio
async def test_get_task_result_with_optional_summary_single_subtask(
    sample_chat_data,
):
    from app.agent.factory.task_summary import (
        get_task_result_with_optional_summary,
    )

    options = Chat(**sample_chat_data)

    parent = Task(content="Single step task", id="parent")
    parent.result = "--- Subtask 1 Result ---\nActual result content"
    sub1 = Task(content="Step 1", id="s1")
    sub1.result = "Step 1 done"
    parent.add_subtask(sub1)

    with patch(f"{_mod}._create_summary_agent") as mock_create:
        result = await get_task_result_with_optional_summary(parent, options)

    mock_create.assert_not_called()
    assert result == "Actual result content"


@pytest.mark.asyncio
async def test_get_task_result_with_optional_summary_no_subtasks(
    sample_chat_data,
):
    from app.agent.factory.task_summary import (
        get_task_result_with_optional_summary,
    )

    options = Chat(**sample_chat_data)

    task = Task(content="Simple task", id="simple")
    task.result = "Direct result"

    with patch(f"{_mod}._create_summary_agent") as mock_create:
        result = await get_task_result_with_optional_summary(task, options)

    mock_create.assert_not_called()
    assert result == "Direct result"
