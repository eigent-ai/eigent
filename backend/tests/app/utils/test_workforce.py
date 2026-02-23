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
from camel.societies.workforce.utils import (
    TaskAnalysisResult,
    TaskAssignment,
    TaskAssignResult,
)
from camel.societies.workforce.workforce import (
    Workforce as BaseWorkforce,
    WorkforceState,
)
from camel.societies.workforce.workforce_metrics import WorkforceMetrics
from camel.tasks import Task
from camel.tasks.task import TaskState

from app.agent.listen_chat_agent import ListenChatAgent
from app.exception.exception import UserException
from app.service.task import (
    ActionAssignTaskData,
    ActionTaskStateData,
    create_task_lock,
)
from app.utils.workforce import _ANALYZE_TASK_MAX_RETRIES, Workforce


@pytest.fixture(autouse=True)
def _mock_model_factory():
    """Prevent ChatAgent from requiring real API keys during Workforce init."""
    mock_model = MagicMock()
    mock_model.model_type = MagicMock()
    mock_model.model_config_dict = {}
    with patch("camel.models.ModelFactory.create", return_value=mock_model):
        yield


@pytest.mark.unit
def test_workforce_initialization():
    """Test Workforce initialization with default settings."""
    api_task_id = "test_api_task_123"
    description = "Test workforce"

    workforce = Workforce(api_task_id=api_task_id, description=description)

    assert workforce.api_task_id == api_task_id
    assert workforce.description == description


@pytest.mark.unit
def test_eigent_make_sub_tasks_success():
    """Test eigent_make_sub_tasks successfully decomposes task."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    task = Task(content="Create a web application", id="main_task")

    subtask1 = Task(content="Setup project structure", id="subtask_1")
    subtask2 = Task(content="Implement authentication", id="subtask_2")
    mock_subtasks = [subtask1, subtask2]

    async def fake_decompose(*args, **kwargs):
        return mock_subtasks

    with (
        patch.object(
            workforce,
            "handle_decompose_append_task",
            side_effect=fake_decompose,
        ),
        patch("app.utils.workforce.validate_task_content", return_value=True),
    ):
        result = workforce.eigent_make_sub_tasks(task)

        assert result == mock_subtasks
        assert workforce._task is task
        assert workforce._state == WorkforceState.RUNNING


@pytest.mark.unit
def test_eigent_make_sub_tasks_with_streaming_decomposition():
    """Test eigent_make_sub_tasks with streaming decomposition result."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    task = Task(content="Complex project task", id="main_task")

    def mock_streaming_decomposition():
        yield [Task(content="Phase 1", id="phase_1")]
        yield [Task(content="Phase 2", id="phase_2")]
        yield [Task(content="Phase 3", id="phase_3")]

    with (
        patch.object(workforce, "reset"),
        patch.object(workforce, "set_channel"),
        patch.object(
            workforce,
            "_decompose_task",
            return_value=mock_streaming_decomposition(),
        ),
        patch("app.utils.workforce.validate_task_content", return_value=True),
    ):
        result = workforce.eigent_make_sub_tasks(task)

        assert len(result) == 3
        assert all(isinstance(subtask, Task) for subtask in result)
        assert result[0].content == "Phase 1"
        assert result[1].content == "Phase 2"
        assert result[2].content == "Phase 3"


@pytest.mark.unit
def test_eigent_make_sub_tasks_invalid_content():
    """Test eigent_make_sub_tasks with invalid task content."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    task = Task(content="", id="invalid_task")

    with patch(
        "app.utils.workforce.validate_task_content", return_value=False
    ):
        with pytest.raises(UserException):
            workforce.eigent_make_sub_tasks(task)

        assert task.state == TaskState.FAILED
        assert "Invalid or empty content" in task.result


@pytest.mark.unit
@pytest.mark.asyncio
async def test_eigent_start_success():
    """Test eigent_start successfully starts workforce."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    subtasks = [
        Task(content="Subtask 1", id="sub_1"),
        Task(content="Subtask 2", id="sub_2"),
    ]

    with (
        patch.object(workforce, "start", new_callable=AsyncMock) as mock_start,
        patch.object(workforce, "save_snapshot") as mock_save_snapshot,
    ):
        await workforce.eigent_start(subtasks)

        assert len(workforce._pending_tasks) >= len(subtasks)

        mock_save_snapshot.assert_called_once_with(
            "Initial task decomposition"
        )
        mock_start.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_eigent_start_with_exception():
    """Test eigent_start handles exceptions properly."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    subtasks = [Task(content="Subtask 1", id="sub_1")]

    with (
        patch.object(
            workforce,
            "start",
            new_callable=AsyncMock,
            side_effect=Exception("Workforce start failed"),
        ),
        patch.object(workforce, "save_snapshot"),
    ):
        with pytest.raises(Exception, match="Workforce start failed"):
            await workforce.eigent_start(subtasks)

        assert workforce._state == WorkforceState.STOPPED


@pytest.mark.unit
@pytest.mark.asyncio
async def test_find_assignee_with_notifications(mock_task_lock):
    """Test _find_assignee sends proper task assignment notifications."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    main_task = Task(content="Main task", id="main")
    subtask1 = Task(content="Subtask 1", id="sub_1")
    workforce._task = main_task

    tasks = [main_task, subtask1]

    assignments = [
        TaskAssignment(
            task_id="main", assignee_id="coordinator", dependencies=[]
        ),
        TaskAssignment(
            task_id="sub_1", assignee_id="worker_node_1", dependencies=[]
        ),
    ]
    mock_assign_result = TaskAssignResult(assignments=assignments)

    with (
        patch(
            "app.utils.workforce.get_task_lock",
            return_value=mock_task_lock,
        ),
        patch(
            "app.utils.workforce.get_camel_task",
            side_effect=lambda task_id, task_list: next(
                (t for t in task_list if t.id == task_id), None
            ),
        ),
        patch.object(
            workforce.__class__.__bases__[0],
            "_find_assignee",
            return_value=mock_assign_result,
        ),
        patch.object(
            workforce,
            "_get_agent_id_from_node_id",
            return_value="agent_1",
        ),
    ):
        result = await workforce._find_assignee(tasks)

        assert result is mock_assign_result
        # put_queue is called via asyncio.create_task, so check
        # add_background_task was called (tracks the async task)
        assert mock_task_lock.add_background_task.call_count >= 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_post_task_notification(mock_task_lock):
    """Test _post_task sends running state notification."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    main_task = Task(content="Main task", id="main")
    subtask = Task(content="Subtask", id="sub_1")
    workforce._task = main_task

    assignee_id = "worker_node_1"

    with (
        patch(
            "app.utils.workforce.get_task_lock",
            return_value=mock_task_lock,
        ),
        patch.object(
            workforce,
            "_get_agent_id_from_node_id",
            return_value="agent_1",
        ),
        patch.object(
            workforce.__class__.__bases__[0],
            "_post_task",
            return_value=None,
        ) as mock_super_post,
    ):
        await workforce._post_task(subtask, assignee_id)

        mock_task_lock.put_queue.assert_called_once()
        call_args = mock_task_lock.put_queue.call_args[0][0]
        assert isinstance(call_args, ActionAssignTaskData)
        assert call_args.data["assignee_id"] == "agent_1"
        assert call_args.data["task_id"] == "sub_1"
        assert call_args.data["state"] == "running"

        mock_super_post.assert_called_once_with(subtask, assignee_id)


@pytest.mark.unit
def test_add_single_agent_worker_success():
    """Test add_single_agent_worker successfully adds worker."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    mock_worker = MagicMock(spec=ListenChatAgent)
    mock_worker.agent_id = "test_worker_123"
    mock_worker.agent_name = "test_worker"
    description = "Test worker description"

    with (
        patch.object(workforce, "_validate_agent_compatibility"),
        patch.object(workforce, "_attach_pause_event_to_agent"),
        patch.object(workforce, "_start_child_node_when_paused"),
    ):
        result = workforce.add_single_agent_worker(
            description, mock_worker, pool_max_size=5
        )

        assert result is workforce
        assert len(workforce._children) == 1

        added_worker = workforce._children[0]
        assert hasattr(added_worker, "worker")
        assert added_worker.worker is mock_worker


@pytest.mark.unit
def test_add_single_agent_worker_while_running():
    """Test add_single_agent_worker raises error when workforce is running."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )
    workforce._state = WorkforceState.RUNNING

    mock_worker = MagicMock(spec=ListenChatAgent)

    with pytest.raises(
        RuntimeError, match="Cannot add workers while workforce is running"
    ):
        workforce.add_single_agent_worker("Test worker", mock_worker)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_handle_completed_task(mock_task_lock):
    """Test _handle_completed_task sends completion notification."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    task = Task(content="Completed task", id="completed_123")
    task.state = TaskState.DONE
    task.result = "Task completed successfully"
    task.failure_count = 0

    with (
        patch(
            "app.utils.workforce.get_task_lock",
            return_value=mock_task_lock,
        ),
        patch.object(
            workforce.__class__.__bases__[0],
            "_handle_completed_task",
            return_value=None,
        ) as mock_super_handle,
    ):
        await workforce._handle_completed_task(task)

        mock_task_lock.put_queue.assert_called_once()
        call_args = mock_task_lock.put_queue.call_args[0][0]
        assert isinstance(call_args, ActionTaskStateData)
        assert call_args.data["task_id"] == "completed_123"
        assert call_args.data["state"] == TaskState.DONE
        assert call_args.data["result"] == "Task completed successfully"

        mock_super_handle.assert_called_once_with(task)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_handle_failed_task(mock_task_lock):
    """Test _handle_failed_task sends failure notification after max retries."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )
    # Clear callbacks to isolate notification test from metrics logging
    workforce._callbacks = []

    task = Task(content="Failed task", id="failed_123")
    task.state = TaskState.FAILED
    # failure_count must be >= max_retries (default 3) for notification
    task.failure_count = 3

    with (
        patch(
            "app.utils.workforce.get_task_lock",
            return_value=mock_task_lock,
        ),
        patch.object(
            workforce.__class__.__bases__[0],
            "_handle_failed_task",
            return_value=True,
        ) as mock_super_handle,
    ):
        result = await workforce._handle_failed_task(task)

        assert result is True

        mock_task_lock.put_queue.assert_called_once()
        call_args = mock_task_lock.put_queue.call_args[0][0]
        assert isinstance(call_args, ActionTaskStateData)
        assert call_args.data["task_id"] == "failed_123"
        assert call_args.data["state"] == TaskState.FAILED
        assert call_args.data["failure_count"] == 3

        mock_super_handle.assert_called_once_with(task)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_handle_failed_task_logs_all_metrics_callbacks(mock_task_lock):
    """Test _handle_failed_task broadcasts failure event to callbacks."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    task = Task(content="Failed task", id="failed_123")
    task.state = TaskState.FAILED
    task.failure_count = workforce.failure_handling_config.max_retries
    task.result = "Test failure"

    class DummyMetrics(WorkforceMetrics):
        def __init__(self):
            self.log_entries = []
            self.log_task_failed = MagicMock()

        def reset_task_data(self) -> None:
            return None

        def dump_to_json(self, file_path: str) -> None:
            return None

        def get_ascii_tree_representation(self) -> str:
            return ""

        def get_kpis(self):
            return {}

    callback_one = DummyMetrics()
    callback_one.log_entries = [object()]
    callback_two = DummyMetrics()
    callback_two.log_entries = [
        {
            "event_type": "task_failed",
            "task_id": "failed_123",
            "error_message": "Failure from callback two",
        }
    ]
    workforce._callbacks = [callback_one, callback_two]

    with (
        patch(
            "app.utils.workforce.get_task_lock",
            return_value=mock_task_lock,
        ),
        patch.object(
            workforce.__class__.__bases__[0],
            "_handle_failed_task",
            return_value=True,
        ),
    ):
        await workforce._handle_failed_task(task)

    mock_task_lock.put_queue.assert_called_once()
    call_args = mock_task_lock.put_queue.call_args[0][0]
    assert call_args.data["result"] == "Failure from callback two"

    callback_one.log_task_failed.assert_called_once()
    callback_two.log_task_failed.assert_called_once()
    failed_event = callback_one.log_task_failed.call_args[0][0]
    assert failed_event.error_message == "Failure from callback two"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stop_sends_end_notification(mock_task_lock):
    """Test stop method sends end notification."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    with (
        patch(
            "app.utils.workforce.get_task_lock",
            return_value=mock_task_lock,
        ),
        patch.object(
            workforce.__class__.__bases__[0], "stop"
        ) as mock_super_stop,
    ):
        workforce.stop()

        mock_super_stop.assert_called_once()
        assert mock_task_lock.add_background_task.call_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cleanup_deletes_task_lock():
    """Test cleanup method deletes task lock."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    with patch("app.service.task.delete_task_lock") as mock_delete:
        await workforce.cleanup()

        mock_delete.assert_called_once_with(api_task_id)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cleanup_handles_exception():
    """Test cleanup handles exceptions gracefully."""
    api_task_id = "test_api_task_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Test workforce"
    )

    with patch(
        "app.service.task.delete_task_lock",
        side_effect=Exception("Delete failed"),
    ):
        await workforce.cleanup()


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_eigent_make_sub_tasks_with_none_task():
    """Test eigent_make_sub_tasks with None task."""
    api_task_id = "error_test_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Error test workforce"
    )

    with pytest.raises((AttributeError, TypeError)):
        workforce.eigent_make_sub_tasks(None)


@pytest.mark.unit
def test_eigent_make_sub_tasks_with_malformed_task():
    """Test eigent_make_sub_tasks with malformed task object."""
    api_task_id = "error_test_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Error test workforce"
    )

    fake_task = MagicMock()
    fake_task.content = "Fake task content"
    fake_task.id = "fake_task"

    with patch(
        "app.utils.workforce.validate_task_content", return_value=False
    ):
        with pytest.raises(UserException):
            workforce.eigent_make_sub_tasks(fake_task)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_eigent_start_with_empty_subtasks():
    """Test eigent_start with empty subtasks list."""
    api_task_id = "empty_test_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Empty test workforce"
    )

    with (
        patch.object(workforce, "start", new_callable=AsyncMock),
        patch.object(workforce, "save_snapshot"),
    ):
        await workforce.eigent_start([])

        workforce.start.assert_called_once()


@pytest.mark.unit
def test_add_single_agent_worker_with_invalid_worker():
    """Test add_single_agent_worker with invalid worker object."""
    api_task_id = "invalid_worker_test_123"
    workforce = Workforce(
        api_task_id=api_task_id,
        description="Invalid worker test workforce",
    )

    invalid_worker = "not_an_agent"

    with patch.object(
        workforce,
        "_validate_agent_compatibility",
        side_effect=ValueError("Invalid agent"),
    ):
        with pytest.raises(ValueError, match="Invalid agent"):
            workforce.add_single_agent_worker("Invalid worker", invalid_worker)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_find_assignee_with_get_task_lock_failure():
    """Test _find_assignee when get_task_lock fails after parent method succeeds."""
    api_task_id = "lock_fail_test_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Lock fail test workforce"
    )

    tasks = [Task(content="Test task", id="test")]

    with (
        patch.object(
            workforce.__class__.__bases__[0],
            "_find_assignee",
            return_value=TaskAssignResult(assignments=[]),
        ) as mock_super_find,
        patch(
            "app.utils.workforce.get_task_lock",
            side_effect=Exception("Task lock not found"),
        ),
    ):
        with pytest.raises(Exception, match="Task lock not found"):
            await workforce._find_assignee(tasks)

        mock_super_find.assert_called_once_with(tasks)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cleanup_with_nonexistent_task_lock():
    """Test cleanup when task lock doesn't exist."""
    api_task_id = "nonexistent_lock_test_123"
    workforce = Workforce(
        api_task_id=api_task_id,
        description="Nonexistent lock test workforce",
    )

    with patch(
        "app.service.task.delete_task_lock",
        side_effect=Exception("Task lock not found"),
    ):
        await workforce.cleanup()


# ---------------------------------------------------------------------------
# Workforce tests
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_workforce_inheritance():
    """Test that Workforce properly inherits from BaseWorkforce."""
    api_task_id = "inheritance_test_123"
    workforce = Workforce(
        api_task_id=api_task_id, description="Inheritance test workforce"
    )

    assert isinstance(workforce, BaseWorkforce)
    assert hasattr(workforce, "api_task_id")
    assert workforce.api_task_id == api_task_id


@pytest.mark.integration
@pytest.mark.asyncio
async def test_full_workforce_lifecycle():
    """Test complete workforce lifecycle from creation to cleanup."""
    api_task_id = "integration_test_123"

    create_task_lock(api_task_id)

    workforce = Workforce(
        api_task_id=api_task_id, description="Integration test workforce"
    )

    main_task = Task(content="Integration test task", id="main_task")

    subtasks = [
        Task(content="Setup", id="setup_task"),
        Task(content="Implementation", id="impl_task"),
        Task(content="Testing", id="test_task"),
    ]

    with (
        patch("app.utils.workforce.validate_task_content", return_value=True),
        # Mock asyncio.run to return subtasks directly (can't nest event loops)
        patch("app.utils.workforce.asyncio.run", return_value=subtasks),
        patch.object(workforce, "start", new_callable=AsyncMock),
    ):
        result_subtasks = workforce.eigent_make_sub_tasks(main_task)
        assert len(result_subtasks) == 3

        await workforce.eigent_start(result_subtasks)

        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.agent_id = "integration_worker_123"
        mock_worker.agent_name = "integration_worker"
        with (
            patch.object(workforce, "_validate_agent_compatibility"),
            patch.object(workforce, "_attach_pause_event_to_agent"),
            patch.object(workforce, "_start_child_node_when_paused"),
        ):
            workforce.add_single_agent_worker(
                "Integration worker", mock_worker
            )

        assert len(workforce._children) == 1

        with patch.object(workforce.__class__.__bases__[0], "stop"):
            workforce.stop()

        await workforce.cleanup()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_workforce_with_multiple_workers():
    """Test workforce with multiple workers."""
    api_task_id = "multi_worker_test_123"

    create_task_lock(api_task_id)

    workforce = Workforce(
        api_task_id=api_task_id, description="Multi-worker test workforce"
    )

    workers = []
    for i in range(3):
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = f"worker_{i}"
        mock_worker.agent_id = f"worker_{i}_123"
        mock_worker.agent_name = f"worker_{i}"
        workers.append(mock_worker)

    with (
        patch.object(workforce, "_validate_agent_compatibility"),
        patch.object(workforce, "_attach_pause_event_to_agent"),
        patch.object(workforce, "_start_child_node_when_paused"),
    ):
        for i, worker in enumerate(workers):
            workforce.add_single_agent_worker(f"Worker {i}", worker)

    assert len(workforce._children) == 3

    await workforce.cleanup()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_workforce_task_state_tracking():
    """Test workforce properly tracks task state changes."""
    api_task_id = "task_tracking_test_123"

    create_task_lock(api_task_id)

    workforce = Workforce(
        api_task_id=api_task_id, description="Task tracking test workforce"
    )

    completed_task = Task(content="Completed task", id="completed")
    completed_task.state = TaskState.DONE
    completed_task.result = "Success"

    with patch.object(
        workforce.__class__.__bases__[0],
        "_handle_completed_task",
        return_value=None,
    ):
        await workforce._handle_completed_task(completed_task)

    failed_task = Task(content="Failed task", id="failed")
    failed_task.state = TaskState.FAILED
    failed_task.failure_count = 1

    with patch.object(
        workforce.__class__.__bases__[0],
        "_handle_failed_task",
        return_value=True,
    ):
        result = await workforce._handle_failed_task(failed_task)
        assert result is True

    await workforce.cleanup()


# ---------------------------------------------------------------------------
# _analyze_task retry logic tests
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_analyze_task_returns_valid_result_on_first_attempt():
    """Test _analyze_task returns immediately when base class succeeds."""
    workforce = Workforce(api_task_id="test_123", description="Test workforce")
    task = Task(content="Test task", id="task_1")

    expected = TaskAnalysisResult(reasoning="looks good", quality_score=90)

    with patch.object(
        workforce.__class__.__bases__[0],
        "_analyze_task",
        return_value=expected,
    ) as mock_super:
        result = workforce._analyze_task(task, for_failure=False)

        assert result is expected
        assert mock_super.call_count == 1


@pytest.mark.unit
@pytest.mark.parametrize(
    "side_effect, expected_calls",
    [
        ([None, "success"], 2),
        ([ValueError("err"), "success"], 2),
        ([None, ValueError("err"), "success"], 3),
    ],
    ids=["none_then_success", "exception_then_success", "mixed_then_success"],
)
def test_analyze_task_retries_and_succeeds(side_effect, expected_calls):
    """Test _analyze_task retries on None/exception and succeeds."""
    workforce = Workforce(api_task_id="test_123", description="Test workforce")
    task = Task(content="Test task", id="task_1")

    expected = TaskAnalysisResult(reasoning="recovered", quality_score=85)
    # Replace "success" sentinel with actual result
    resolved = [expected if s == "success" else s for s in side_effect]

    with patch.object(
        workforce.__class__.__bases__[0],
        "_analyze_task",
        side_effect=resolved,
    ) as mock_super:
        result = workforce._analyze_task(task, for_failure=False)

        assert result is expected
        assert mock_super.call_count == expected_calls


@pytest.mark.unit
def test_analyze_task_quality_eval_fallback_after_exhausted_retries():
    """Test _analyze_task returns quality_score=80 fallback when all retries
    fail for quality evaluation (for_failure=False)."""
    workforce = Workforce(api_task_id="test_123", description="Test workforce")
    task = Task(content="Test task", id="task_1")

    with patch.object(
        workforce.__class__.__bases__[0],
        "_analyze_task",
        return_value=None,
    ) as mock_super:
        result = workforce._analyze_task(task, for_failure=False)

        assert mock_super.call_count == _ANALYZE_TASK_MAX_RETRIES
        assert result.quality_score == 80
        assert "retries" in result.reasoning


@pytest.mark.unit
def test_analyze_task_failure_raises_after_exhausted_retries():
    """Test _analyze_task raises RuntimeError when all retries fail
    for failure analysis (for_failure=True)."""
    workforce = Workforce(api_task_id="test_123", description="Test workforce")
    task = Task(content="Test task", id="task_1")

    with patch.object(
        workforce.__class__.__bases__[0],
        "_analyze_task",
        return_value=None,
    ) as mock_super:
        with pytest.raises(RuntimeError, match="returned None after"):
            workforce._analyze_task(
                task, for_failure=True, error_message="task crashed"
            )

        assert mock_super.call_count == _ANALYZE_TASK_MAX_RETRIES
