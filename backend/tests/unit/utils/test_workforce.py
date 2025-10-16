from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from camel.societies.workforce.workforce import WorkforceState
from camel.societies.workforce.utils import TaskAssignResult, TaskAssignment
from camel.tasks import Task
from camel.tasks.task import TaskState
from camel.agents import ChatAgent

from app.utils.workforce import Workforce
from app.utils.agent import ListenChatAgent
from app.service.task import ActionAssignTaskData, ActionTaskStateData, ActionEndData
from app.exception.exception import UserException


@pytest.mark.unit
class TestWorkforce:
    """Test cases for Workforce class."""
    
    def test_workforce_initialization(self):
        """Test Workforce initialization with default settings."""
        api_task_id = "test_api_task_123"
        description = "Test workforce"
        
        workforce = Workforce(
            api_task_id=api_task_id,
            description=description
        )
        
        assert workforce.api_task_id == api_task_id
        assert workforce.description == description

    def test_eigent_make_sub_tasks_success(self):
        """Test eigent_make_sub_tasks successfully decomposes task."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        # Create test task
        task = Task(content="Create a web application", id="main_task")
        
        # Mock subtasks
        subtask1 = Task(content="Setup project structure", id="subtask_1")
        subtask2 = Task(content="Implement authentication", id="subtask_2")
        mock_subtasks = [subtask1, subtask2]
        
        with patch.object(workforce, 'reset'), \
             patch.object(workforce, 'set_channel'), \
             patch.object(workforce, '_decompose_task', return_value=mock_subtasks), \
             patch('app.utils.workforce.validate_task_content', return_value=True):
            
            result = workforce.eigent_make_sub_tasks(task)
            
            assert result == mock_subtasks
            assert workforce._task is task
            assert workforce._state == WorkforceState.RUNNING
            assert task.state == TaskState.OPEN
            assert task in workforce._pending_tasks

    def test_eigent_make_sub_tasks_with_streaming_decomposition(self):
        """Test eigent_make_sub_tasks with streaming decomposition result."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        task = Task(content="Complex project task", id="main_task")
        
        # Mock streaming generator
        def mock_streaming_decomposition():
            yield [Task(content="Phase 1", id="phase_1")]
            yield [Task(content="Phase 2", id="phase_2")]
            yield [Task(content="Phase 3", id="phase_3")]
        
        with patch.object(workforce, 'reset'), \
             patch.object(workforce, 'set_channel'), \
             patch.object(workforce, '_decompose_task', return_value=mock_streaming_decomposition()), \
             patch('app.utils.workforce.validate_task_content', return_value=True):
            
            result = workforce.eigent_make_sub_tasks(task)
            
            # Should have flattened all streaming results
            assert len(result) == 3
            assert all(isinstance(subtask, Task) for subtask in result)
            assert result[0].content == "Phase 1"
            assert result[1].content == "Phase 2"
            assert result[2].content == "Phase 3"

    def test_eigent_make_sub_tasks_invalid_content(self):
        """Test eigent_make_sub_tasks with invalid task content."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        # Create task with invalid content
        task = Task(content="", id="invalid_task")  # Empty content
        
        with patch('app.utils.workforce.validate_task_content', return_value=False):
            with pytest.raises(UserException):
                workforce.eigent_make_sub_tasks(task)
            
            # Task should be marked as failed
            assert task.state == TaskState.FAILED
            assert "Invalid or empty content" in task.result

    @pytest.mark.asyncio
    async def test_eigent_start_success(self):
        """Test eigent_start successfully starts workforce."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        # Mock subtasks
        subtasks = [
            Task(content="Subtask 1", id="sub_1"),
            Task(content="Subtask 2", id="sub_2")
        ]
        
        with patch.object(workforce, 'start', new_callable=AsyncMock) as mock_start, \
             patch.object(workforce, 'save_snapshot') as mock_save_snapshot:
            
            await workforce.eigent_start(subtasks)
            
            # Should add subtasks to pending tasks
            assert len(workforce._pending_tasks) >= len(subtasks)
            
            # Should save snapshot and start
            mock_save_snapshot.assert_called_once_with("Initial task decomposition")
            mock_start.assert_called_once()

    @pytest.mark.asyncio
    async def test_eigent_start_with_exception(self):
        """Test eigent_start handles exceptions properly."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        subtasks = [Task(content="Subtask 1", id="sub_1")]
        
        with patch.object(workforce, 'start', new_callable=AsyncMock, side_effect=Exception("Workforce start failed")) as mock_start, \
             patch.object(workforce, 'save_snapshot'):
            
            with pytest.raises(Exception, match="Workforce start failed"):
                await workforce.eigent_start(subtasks)
            
            # State should be set to STOPPED on exception
            assert workforce._state == WorkforceState.STOPPED

    @pytest.mark.asyncio
    async def test_find_assignee_with_notifications(self, mock_task_lock):
        """Test _find_assignee sends proper task assignment notifications."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        # Create test tasks
        main_task = Task(content="Main task", id="main")
        subtask1 = Task(content="Subtask 1", id="sub_1")
        subtask2 = Task(content="Subtask 2", id="sub_2")
        workforce._task = main_task
        
        tasks = [main_task, subtask1, subtask2]
        
        # Mock assignment result
        assignments = [
            TaskAssignment(task_id="main", assignee_id="coordinator", dependencies=[]),
            TaskAssignment(task_id="sub_1", assignee_id="worker_1", dependencies=[]),
            TaskAssignment(task_id="sub_2", assignee_id="worker_2", dependencies=["sub_1"])
        ]
        mock_assign_result = TaskAssignResult(assignments=assignments)
        
        with patch('app.utils.workforce.get_task_lock', return_value=mock_task_lock), \
             patch('app.utils.workforce.get_camel_task', side_effect=lambda task_id, task_list: next((t for t in task_list if t.id == task_id), None)), \
             patch.object(workforce.__class__.__bases__[0], '_find_assignee', return_value=mock_assign_result):
            
            result = await workforce._find_assignee(tasks)
            
            assert result is mock_assign_result
            # Should have queued assignment notifications for subtasks (not main task)
            assert mock_task_lock.put_queue.call_count >= 1

    @pytest.mark.asyncio
    async def test_post_task_notification(self, mock_task_lock):
        """Test _post_task sends running state notification."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        # Create test tasks
        main_task = Task(content="Main task", id="main")
        subtask = Task(content="Subtask", id="sub_1")
        workforce._task = main_task
        
        assignee_id = "worker_1"
        
        with patch('app.utils.workforce.get_task_lock', return_value=mock_task_lock), \
             patch.object(workforce.__class__.__bases__[0], '_post_task', return_value=None) as mock_super_post:
            
            await workforce._post_task(subtask, assignee_id)
            
            # Should queue running state notification for subtask
            mock_task_lock.put_queue.assert_called_once()
            call_args = mock_task_lock.put_queue.call_args[0][0]
            assert isinstance(call_args, ActionAssignTaskData)
            assert call_args.data["assignee_id"] == assignee_id
            assert call_args.data["task_id"] == "sub_1"
            assert call_args.data["state"] == "running"
            
            # Should call parent method
            mock_super_post.assert_called_once_with(subtask, assignee_id)

    def test_add_single_agent_worker_success(self):
        """Test add_single_agent_worker successfully adds worker."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        # Create mock worker with required attributes
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.agent_id = "test_worker_123"
        description = "Test worker description"
        
        with patch.object(workforce, '_validate_agent_compatibility'), \
             patch.object(workforce, '_attach_pause_event_to_agent'), \
             patch.object(workforce, '_start_child_node_when_paused'):
            
            result = workforce.add_single_agent_worker(description, mock_worker, pool_max_size=5)
            
            assert result is workforce
            assert len(workforce._children) == 1
            
            # Check that the added worker is a SingleAgentWorker
            added_worker = workforce._children[0]
            assert hasattr(added_worker, 'worker')
            assert added_worker.worker is mock_worker

    def test_add_single_agent_worker_while_running(self):
        """Test add_single_agent_worker raises error when workforce is running."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        workforce._state = WorkforceState.RUNNING
        
        mock_worker = MagicMock(spec=ListenChatAgent)
        
        with pytest.raises(RuntimeError, match="Cannot add workers while workforce is running"):
            workforce.add_single_agent_worker("Test worker", mock_worker)

    @pytest.mark.asyncio
    async def test_handle_completed_task(self, mock_task_lock):
        """Test _handle_completed_task sends completion notification."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        # Create completed task
        task = Task(content="Completed task", id="completed_123")
        task.state = TaskState.DONE
        task.result = "Task completed successfully"
        task.failure_count = 0
        
        with patch('app.utils.workforce.get_task_lock', return_value=mock_task_lock), \
             patch.object(workforce.__class__.__bases__[0], '_handle_completed_task', return_value=None) as mock_super_handle:
            
            await workforce._handle_completed_task(task)
            
            # Should queue task state notification
            mock_task_lock.put_queue.assert_called_once()
            call_args = mock_task_lock.put_queue.call_args[0][0]
            assert isinstance(call_args, ActionTaskStateData)
            assert call_args.data["task_id"] == "completed_123"
            assert call_args.data["state"] == TaskState.DONE
            assert call_args.data["result"] == "Task completed successfully"
            
            # Should call parent method
            mock_super_handle.assert_called_once_with(task)

    @pytest.mark.asyncio
    async def test_handle_failed_task(self, mock_task_lock):
        """Test _handle_failed_task sends failure notification."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        # Create failed task
        task = Task(content="Failed task", id="failed_123")
        task.state = TaskState.FAILED
        task.failure_count = 2
        
        with patch('app.utils.workforce.get_task_lock', return_value=mock_task_lock), \
             patch.object(workforce.__class__.__bases__[0], '_handle_failed_task', return_value=True) as mock_super_handle:
            
            result = await workforce._handle_failed_task(task)
            
            assert result is True
            
            # Should queue task state notification
            mock_task_lock.put_queue.assert_called_once()
            call_args = mock_task_lock.put_queue.call_args[0][0]
            assert isinstance(call_args, ActionTaskStateData)
            assert call_args.data["task_id"] == "failed_123"
            assert call_args.data["state"] == TaskState.FAILED
            assert call_args.data["failure_count"] == 2
            
            # Should call parent method
            mock_super_handle.assert_called_once_with(task)

    @pytest.mark.asyncio
    async def test_stop_sends_end_notification(self, mock_task_lock):
        """Test stop method sends end notification."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        with patch('app.utils.workforce.get_task_lock', return_value=mock_task_lock), \
             patch.object(workforce.__class__.__bases__[0], 'stop') as mock_super_stop:
            
            workforce.stop()
            
            # Should call parent stop method
            mock_super_stop.assert_called_once()
            
            # Should queue end notification
            assert mock_task_lock.add_background_task.call_count == 1

    @pytest.mark.asyncio
    async def test_cleanup_deletes_task_lock(self):
        """Test cleanup method deletes task lock."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        with patch('app.service.task.delete_task_lock') as mock_delete:
            await workforce.cleanup()
            
            mock_delete.assert_called_once_with(api_task_id)

    @pytest.mark.asyncio
    async def test_cleanup_handles_exception(self):
        """Test cleanup handles exceptions gracefully."""
        api_task_id = "test_api_task_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Test workforce"
        )
        
        with patch('app.service.task.delete_task_lock', side_effect=Exception("Delete failed")), \
             patch('traceroot.get_logger') as mock_get_logger:
            
            # Should not raise exception
            await workforce.cleanup()

            # Should log the error
            mock_get_logger.assert_called_once()


@pytest.mark.integration
class TestWorkforceIntegration:
    """Integration tests for Workforce class."""
    
    def setup_method(self):
        """Clean up before each test."""
        from app.service.task import task_locks
        task_locks.clear()

    @pytest.mark.asyncio
    async def test_full_workforce_lifecycle(self):
        """Test complete workforce lifecycle from creation to cleanup."""
        api_task_id = "integration_test_123"
        
        # Create task lock
        from app.service.task import create_task_lock
        task_lock = create_task_lock(api_task_id)
        
        # Create workforce
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Integration test workforce"
        )
        
        # Create main task
        main_task = Task(content="Integration test task", id="main_task")
        
        # Mock subtasks
        subtasks = [
            Task(content="Setup", id="setup_task"),
            Task(content="Implementation", id="impl_task"),
            Task(content="Testing", id="test_task")
        ]
        
        with patch.object(workforce, '_decompose_task', return_value=subtasks), \
             patch('app.utils.workforce.validate_task_content', return_value=True), \
             patch.object(workforce, 'start', new_callable=AsyncMock):
            
            # Make subtasks
            result_subtasks = workforce.eigent_make_sub_tasks(main_task)
            assert len(result_subtasks) == 3
            
            # Start workforce
            await workforce.eigent_start(result_subtasks)
            
            # Add worker
            mock_worker = MagicMock(spec=ListenChatAgent)
            mock_worker.agent_id = "integration_worker_123"
            with patch.object(workforce, '_validate_agent_compatibility'), \
                 patch.object(workforce, '_attach_pause_event_to_agent'), \
                 patch.object(workforce, '_start_child_node_when_paused'):
                workforce.add_single_agent_worker("Integration worker", mock_worker)
            
            assert len(workforce._children) == 1
            
            # Stop workforce
            with patch.object(workforce.__class__.__bases__[0], 'stop'):
                workforce.stop()
            
            # Cleanup
            await workforce.cleanup()

    @pytest.mark.asyncio
    async def test_workforce_with_multiple_workers(self):
        """Test workforce with multiple workers."""
        api_task_id = "multi_worker_test_123"
        
        from app.service.task import create_task_lock
        create_task_lock(api_task_id)
        
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Multi-worker test workforce"
        )
        
        # Add multiple workers
        workers = []
        for i in range(3):
            mock_worker = MagicMock(spec=ListenChatAgent)
            mock_worker.role_name = f"worker_{i}"
            mock_worker.agent_id = f"worker_{i}_123"
            workers.append(mock_worker)
        
        with patch.object(workforce, '_validate_agent_compatibility'), \
             patch.object(workforce, '_attach_pause_event_to_agent'), \
             patch.object(workforce, '_start_child_node_when_paused'):
            
            for i, worker in enumerate(workers):
                workforce.add_single_agent_worker(f"Worker {i}", worker)
        
        assert len(workforce._children) == 3
        
        # Cleanup
        await workforce.cleanup()

    @pytest.mark.asyncio
    async def test_workforce_task_state_tracking(self):
        """Test workforce properly tracks task state changes."""
        api_task_id = "task_tracking_test_123"
        
        from app.service.task import create_task_lock
        task_lock = create_task_lock(api_task_id)
        
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Task tracking test workforce"
        )
        
        # Test completed task handling
        completed_task = Task(content="Completed task", id="completed")
        completed_task.state = TaskState.DONE
        completed_task.result = "Success"
        
        with patch.object(workforce.__class__.__bases__[0], '_handle_completed_task', return_value=None):
            await workforce._handle_completed_task(completed_task)
        
        # Test failed task handling
        failed_task = Task(content="Failed task", id="failed")
        failed_task.state = TaskState.FAILED
        failed_task.failure_count = 1
        
        with patch.object(workforce.__class__.__bases__[0], '_handle_failed_task', return_value=True):
            result = await workforce._handle_failed_task(failed_task)
            assert result is True
        
        # Cleanup
        await workforce.cleanup()


@pytest.mark.model_backend
class TestWorkforceWithLLM:
    """Tests that require LLM backend (marked for selective running)."""
    
    @pytest.mark.asyncio
    async def test_workforce_with_real_agents(self):
        """Test workforce with real agent implementations."""
        # This test would use real agent instances and LLM calls
        # Marked as model_backend test for selective execution
        assert True  # Placeholder

    @pytest.mark.very_slow
    async def test_full_workforce_execution(self):
        """Test complete workforce execution with real task processing (very slow test)."""
        # This test would run complete workforce with real task execution
        # Marked as very_slow for execution only in full test mode
        assert True  # Placeholder


@pytest.mark.unit
class TestWorkforceErrorCases:
    """Test error cases and edge conditions for Workforce."""
    
    def test_eigent_make_sub_tasks_with_none_task(self):
        """Test eigent_make_sub_tasks with None task."""
        api_task_id = "error_test_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Error test workforce"
        )
        
        with pytest.raises((AttributeError, TypeError)):
            workforce.eigent_make_sub_tasks(None)

    def test_eigent_make_sub_tasks_with_malformed_task(self):
        """Test eigent_make_sub_tasks with malformed task object."""
        api_task_id = "error_test_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Error test workforce"
        )
        
        # Create object that looks like task but isn't
        fake_task = MagicMock()
        fake_task.content = "Fake task content"
        fake_task.id = "fake_task"
        
        with patch('app.utils.workforce.validate_task_content', return_value=False):
            with pytest.raises(UserException):
                workforce.eigent_make_sub_tasks(fake_task)

    @pytest.mark.asyncio
    async def test_eigent_start_with_empty_subtasks(self):
        """Test eigent_start with empty subtasks list."""
        api_task_id = "empty_test_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Empty test workforce"
        )
        
        with patch.object(workforce, 'start', new_callable=AsyncMock), \
             patch.object(workforce, 'save_snapshot'):
            
            # Should handle empty subtasks gracefully
            await workforce.eigent_start([])
            
            # Should still call start method
            workforce.start.assert_called_once()

    def test_add_single_agent_worker_with_invalid_worker(self):
        """Test add_single_agent_worker with invalid worker object."""
        api_task_id = "invalid_worker_test_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Invalid worker test workforce"
        )
        
        # Try to add invalid worker
        invalid_worker = "not_an_agent"
        
        with patch.object(workforce, '_validate_agent_compatibility', side_effect=ValueError("Invalid agent")):
            with pytest.raises(ValueError, match="Invalid agent"):
                workforce.add_single_agent_worker("Invalid worker", invalid_worker)

    @pytest.mark.asyncio
    async def test_find_assignee_with_get_task_lock_failure(self):
        """Test _find_assignee when get_task_lock fails after parent method succeeds."""
        api_task_id = "lock_fail_test_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Lock fail test workforce"
        )
        
        tasks = [Task(content="Test task", id="test")]
        
        with patch.object(workforce.__class__.__bases__[0], '_find_assignee', return_value=TaskAssignResult(assignments=[])) as mock_super_find, \
             patch('app.utils.workforce.get_task_lock', side_effect=Exception("Task lock not found")):
            
            # Should handle task lock failure and raise the exception after parent method succeeds
            with pytest.raises(Exception, match="Task lock not found"):
                await workforce._find_assignee(tasks)
            
            # Parent method should have been called first
            mock_super_find.assert_called_once_with(tasks)

    @pytest.mark.asyncio
    async def test_cleanup_with_nonexistent_task_lock(self):
        """Test cleanup when task lock doesn't exist."""
        api_task_id = "nonexistent_lock_test_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Nonexistent lock test workforce"
        )
        
        with patch('app.service.task.delete_task_lock', side_effect=Exception("Task lock not found")), \
             patch('traceroot.get_logger') as mock_get_logger:
            
            # Should handle missing task lock gracefully
            await workforce.cleanup()

            # Should log the error
            mock_get_logger.assert_called_once()

    def test_workforce_inheritance(self):
        """Test that Workforce properly inherits from BaseWorkforce."""
        from camel.societies.workforce.workforce import Workforce as BaseWorkforce
        
        api_task_id = "inheritance_test_123"
        workforce = Workforce(
            api_task_id=api_task_id,
            description="Inheritance test workforce"
        )
        
        assert isinstance(workforce, BaseWorkforce)
        assert hasattr(workforce, 'api_task_id')
        assert workforce.api_task_id == api_task_id
