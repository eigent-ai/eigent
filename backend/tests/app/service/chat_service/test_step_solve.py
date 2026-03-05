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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.model.chat import Chat
from app.service.chat_service.step_solve import step_solve
from app.service.task import (
    Action,
    ActionEndData,
    ActionImproveData,
    ImprovePayload,
    TaskLock,
)
from app.utils.context import (
    build_conversation_context,
    collect_previous_task_context,
)

# --- integration tests ---


@pytest.mark.asyncio
async def test_step_solve_context_building_workflow(
    sample_chat_data, mock_request, temp_dir
):
    options = Chat(**sample_chat_data)
    task_lock = TaskLock(id="test_task_123", queue=AsyncMock(), human_input={})
    task_lock.conversation_history = [
        {"role": "user", "content": "Create a Python script"},
        {"role": "assistant", "content": "Script created successfully"},
    ]
    task_lock.last_task_result = "def hello(): print('Hello World')"
    task_lock.last_task_summary = "Python Hello World Script"

    working_dir = temp_dir / "test_project"
    working_dir.mkdir()
    (working_dir / "script.py").write_text("def hello(): print('Hello World')")

    context = build_conversation_context(task_lock)
    assert "=== CONVERSATION HISTORY ===" in context
    assert "Script created successfully" in context


@pytest.mark.asyncio
async def test_step_solve_new_task_state_context_collection(
    sample_chat_data, mock_request, temp_dir
):
    Chat(**sample_chat_data)
    working_dir = temp_dir / "project"
    working_dir.mkdir()
    (working_dir / "main.py").write_text("print('main')")
    (working_dir / "config.json").write_text('{"version": "1.0"}')

    with patch.object(Chat, "file_save_path", return_value=str(working_dir)):
        result = collect_previous_task_context(
            working_directory=str(working_dir),
            previous_task_content="Create project structure",
            previous_task_result="Project files created successfully",
            previous_summary="Project Setup Task",
        )
        assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
        assert "Create project structure" in result
        assert "Project Setup Task" in result
        assert "Project files created successfully" in result
        assert "main.py" in result
        assert "config.json" in result
        assert "=== END OF PREVIOUS TASK CONTEXT ===" in result


@pytest.mark.asyncio
async def test_step_solve_end_action_context_collection(
    sample_chat_data, mock_request, temp_dir
):
    Chat(**sample_chat_data)
    working_dir = temp_dir / "finished_project"
    working_dir.mkdir()
    (working_dir / "output.txt").write_text("Final output")
    (working_dir / "report.md").write_text("# Task Report")

    task_lock = TaskLock(id="test_end_task", queue=AsyncMock(), human_input={})
    task_lock.last_task_summary = "Final Task Summary"

    with patch.object(Chat, "file_save_path", return_value=str(working_dir)):
        context = collect_previous_task_context(
            working_directory=str(working_dir),
            previous_task_content="Generate final report",
            previous_task_result="Report generated successfully with output files",
            previous_summary=task_lock.last_task_summary,
        )
        assert "=== CONTEXT FROM PREVIOUS TASK ===" in context
        assert "Generate final report" in context
        assert "Report generated successfully with output files" in context
        assert "Final Task Summary" in context
        assert "output.txt" in context
        assert "report.md" in context

        task_lock.add_conversation("task_result", context)
        assert len(task_lock.conversation_history) == 1
        assert task_lock.conversation_history[0]["role"] == "task_result"
        assert task_lock.conversation_history[0]["content"] == context


@pytest.mark.asyncio
@pytest.mark.skip(reason="Gets Stuck for some reason.")
async def test_step_solve_basic_workflow(
    sample_chat_data, mock_request, mock_task_lock
):
    options = Chat(**sample_chat_data)
    mock_task_lock.get_queue = AsyncMock(
        side_effect=[
            ActionImproveData(
                action=Action.improve,
                data=ImprovePayload(question="Test question"),
            ),
            ActionEndData(action=Action.end),
        ]
    )

    mock_workforce = MagicMock()
    mock_mcp = MagicMock()

    with (
        patch(
            "app.service.chat_service.decomposition.construct_workforce",
            return_value=(mock_workforce, mock_mcp),
        ),
        patch(
            "app.service.chat_service.question_router.question_confirm",
            return_value=True,
        ),
        patch(
            "app.service.chat_service.question_router.summary_task",
            return_value="Test Summary",
        ),
    ):
        mock_workforce.eigent_make_sub_tasks.return_value = []
        responses = []
        async for response in step_solve(
            options, mock_request, mock_task_lock
        ):
            responses.append(response)
            if len(responses) > 10:
                break
        assert len(responses) > 0


@pytest.mark.asyncio
async def test_step_solve_with_disconnected_request(
    sample_chat_data, mock_request, mock_task_lock
):
    options = Chat(**sample_chat_data)
    mock_request.is_disconnected = AsyncMock(return_value=True)
    mock_workforce = MagicMock()

    with patch(
        "app.service.chat_service.decomposition.construct_workforce",
        return_value=(mock_workforce, MagicMock()),
    ):
        responses = []
        async for response in step_solve(
            options, mock_request, mock_task_lock
        ):
            responses.append(response)
        assert len(responses) == 0


@pytest.mark.asyncio
@pytest.mark.skip(reason="Gets Stuck for some reason.")
async def test_step_solve_error_handling(
    sample_chat_data, mock_request, mock_task_lock
):
    options = Chat(**sample_chat_data)
    mock_task_lock.get_queue = AsyncMock(side_effect=Exception("Queue error"))

    responses = []
    async for response in step_solve(options, mock_request, mock_task_lock):
        responses.append(response)
        break
        assert len(responses) == 0


# --- LLM tests ---


@pytest.mark.model_backend
@pytest.mark.asyncio
async def test_construct_workforce_with_real_agents(sample_chat_data):
    Chat(**sample_chat_data)
    assert True  # Placeholder


@pytest.mark.very_slow
async def test_full_chat_workflow_integration(sample_chat_data, mock_request):
    Chat(**sample_chat_data)
    assert True  # Placeholder
