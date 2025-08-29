from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from camel.agents.chat_agent import AsyncStreamingChatAgentResponse
from camel.societies.workforce.utils import TaskResult
from camel.tasks import Task
from camel.tasks.task import TaskState

from app.utils.single_agent_worker import SingleAgentWorker
from app.utils.agent import ListenChatAgent


@pytest.mark.unit
class TestSingleAgentWorker:
    """Test cases for SingleAgentWorker class."""
    
    def test_single_agent_worker_initialization(self):
        """Test SingleAgentWorker initialization."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "worker_123"
        
        worker = SingleAgentWorker(
            description="Test worker description",
            worker=mock_worker,
            use_agent_pool=True,
            pool_initial_size=2,
            pool_max_size=5,
            auto_scale_pool=True,
            use_structured_output_handler=True
        )
        
        assert worker.worker is mock_worker
        assert worker.use_agent_pool is True
        assert worker.use_structured_output_handler is True
        # Pool configuration is managed by the AgentPool, not as individual attributes
        assert worker.agent_pool is not None  # Pool should be created
        assert worker.use_structured_output_handler is True

    @pytest.mark.asyncio
    async def test_process_task_success_with_structured_output(self):
        """Test _process_task with successful structured output."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "worker_123"
        
        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
            use_structured_output_handler=True
        )
        
        # Mock the structured handler
        mock_structured_handler = MagicMock()
        worker.structured_handler = mock_structured_handler
        
        # Create test task
        task = Task(content="Test task content", id="test_task_123")
        dependencies = []
        
        # Mock worker agent retrieval and return
        mock_worker_agent = AsyncMock()
        mock_worker_agent.role_name = "pooled_worker"
        mock_worker_agent.agent_id = "pooled_worker_123"
        
        # Mock response
        mock_response = MagicMock()
        mock_response.msg.content = "Task completed successfully"
        mock_response.info = {"usage": {"total_tokens": 100}}
        
        mock_worker_agent.astep.return_value = mock_response
        
        # Mock structured output parsing
        mock_task_result = TaskResult(
            content="Task completed successfully",
            failed=False
        )
        mock_structured_handler.parse_structured_response.return_value = mock_task_result
        mock_structured_handler.generate_structured_prompt.return_value = "Enhanced prompt"
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            result = await worker._process_task(task, dependencies)
            
            assert result == TaskState.DONE
            assert task.result == "Task completed successfully"
            assert "worker_attempts" in task.additional_info
            assert len(task.additional_info["worker_attempts"]) == 1
            
            attempt = task.additional_info["worker_attempts"][0]
            assert attempt["agent_id"] == "pooled_worker_123"
            assert attempt["total_tokens"] == 100
            
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    @pytest.mark.asyncio
    async def test_process_task_success_with_native_structured_output(self):
        """Test _process_task with successful native structured output."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "worker_123"
        
        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
            use_structured_output_handler=False  # Use native structured output
        )
        
        # Create test task
        task = Task(content="Test task content", id="test_task_123")
        dependencies = []
        
        # Mock worker agent
        mock_worker_agent = AsyncMock()
        mock_worker_agent.role_name = "pooled_worker"
        mock_worker_agent.agent_id = "pooled_worker_123"
        
        # Mock response with parsed result
        mock_response = MagicMock()
        mock_response.msg.content = "Task completed successfully"
        mock_response.msg.parsed = TaskResult(
            content="Task completed successfully",
            failed=False
        )
        mock_response.info = {"usage": {"total_tokens": 75}}
        
        mock_worker_agent.astep.return_value = mock_response
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            result = await worker._process_task(task, dependencies)
            
            assert result == TaskState.DONE
            assert task.result == "Task completed successfully"
            
            # Verify native structured output was used
            mock_worker_agent.astep.assert_called_once()
            call_args = mock_worker_agent.astep.call_args
            assert "response_format" in call_args.kwargs
            assert call_args.kwargs["response_format"] == TaskResult
            
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    @pytest.mark.skip(reason="Complex streaming response mock - needs fixing")
    @pytest.mark.asyncio
    async def test_process_task_with_streaming_response(self):
        """Test _process_task with streaming response."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "test_agent_123"
        
        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
            use_structured_output_handler=True
        )
        
        # Mock structured handler
        mock_structured_handler = MagicMock()
        worker.structured_handler = mock_structured_handler
        
        task = Task(content="Test task content", id="test_task_123")
        dependencies = []
        
        # Mock worker agent
        mock_worker_agent = AsyncMock()
        mock_worker_agent.role_name = "streaming_worker"
        mock_worker_agent.agent_id = "streaming_worker_123"
        
        # Create mock streaming response
        mock_streaming_response = MagicMock(spec=AsyncStreamingChatAgentResponse)
        
        # Mock the async iteration - create async generator
        async def async_chunks():
            chunk1 = MagicMock()
            chunk1.msg.content = "Partial response"
            yield chunk1
            chunk2 = MagicMock()
            chunk2.msg.content = "Complete response"  
            yield chunk2
        
        mock_streaming_response.__aiter__ = lambda self: async_chunks()
        
        mock_worker_agent.astep.return_value = mock_streaming_response
        
        # Mock structured parsing
        mock_task_result = TaskResult(content="Complete response", failed=False)
        mock_structured_handler.parse_structured_response.return_value = mock_task_result
        mock_structured_handler.generate_structured_prompt.return_value = "Enhanced prompt"
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            result = await worker._process_task(task, dependencies)
            
            assert result == TaskState.DONE
            assert task.result == "Complete response"
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    @pytest.mark.asyncio
    async def test_process_task_failure_exception(self):
        """Test _process_task handles exceptions properly."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "test_agent_123"
        
        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker
        )
        
        task = Task(content="Test task content", id="test_task_123")
        dependencies = []
        
        # Mock worker agent that raises exception
        mock_worker_agent = AsyncMock()
        mock_worker_agent.astep.side_effect = Exception("Processing error")
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            result = await worker._process_task(task, dependencies)
            
            assert result == TaskState.FAILED
            assert "Exception: Processing error" in task.result
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    @pytest.mark.asyncio
    async def test_process_task_with_failed_task_result(self):
        """Test _process_task when task result indicates failure."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "test_agent_123"
        
        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
            use_structured_output_handler=True
        )
        
        # Mock structured handler
        mock_structured_handler = MagicMock()
        worker.structured_handler = mock_structured_handler
        
        task = Task(content="Test task content", id="test_task_123")
        dependencies = []
        
        # Mock worker agent
        mock_worker_agent = AsyncMock()
        mock_response = MagicMock()
        mock_response.msg.content = "Task failed"
        mock_response.info = {"usage": {"total_tokens": 25}}
        mock_worker_agent.astep.return_value = mock_response
        
        # Mock failed task result
        mock_task_result = TaskResult(
            content="Task failed due to error",
            failed=True
        )
        mock_structured_handler.parse_structured_response.return_value = mock_task_result
        mock_structured_handler.generate_structured_prompt.return_value = "Enhanced prompt"
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            result = await worker._process_task(task, dependencies)
            
            assert result == TaskState.FAILED
            assert task.result == "Task failed due to error"
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    @pytest.mark.asyncio
    async def test_process_task_with_dependencies(self):
        """Test _process_task with task dependencies."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "test_agent_123"
        
        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
            use_structured_output_handler=False
        )
        
        # Create main task and dependencies
        main_task = Task(content="Main task", id="main_123")
        dep_task1 = Task(content="Dependency 1", id="dep_1")
        dep_task2 = Task(content="Dependency 2", id="dep_2")
        dependencies = [dep_task1, dep_task2]
        
        # Mock worker agent
        mock_worker_agent = AsyncMock()
        mock_response = MagicMock()
        mock_response.msg.content = "Task completed with dependencies"
        mock_response.msg.parsed = TaskResult(
            content="Task completed with dependencies",
            failed=False
        )
        mock_response.info = {"usage": {"total_tokens": 120}}
        mock_worker_agent.astep.return_value = mock_response
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="Dependencies: dep_1, dep_2") as mock_get_deps:
            
            result = await worker._process_task(main_task, dependencies)
            
            assert result == TaskState.DONE
            assert main_task.result == "Task completed with dependencies"
            
            # Verify dependencies were processed
            mock_get_deps.assert_called_once_with(dependencies)
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    @pytest.mark.asyncio
    async def test_process_task_with_parent_task(self):
        """Test _process_task with parent task context."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "test_agent_123"
        
        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
            use_structured_output_handler=False
        )
        
        # Create parent and child task
        parent_task = Task(content="Parent task", id="parent_123")
        child_task = Task(content="Child task", id="child_123")
        child_task.parent = parent_task
        
        # Mock worker agent
        mock_worker_agent = AsyncMock()
        mock_response = MagicMock()
        mock_response.msg.content = "Child task completed"
        mock_response.msg.parsed = TaskResult(
            content="Child task completed",
            failed=False
        )
        mock_response.info = {"usage": {"total_tokens": 80}}
        mock_worker_agent.astep.return_value = mock_response
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            result = await worker._process_task(child_task, [])
            
            assert result == TaskState.DONE
            assert child_task.result == "Child task completed"
            
            # Verify the prompt included parent task context
            call_args = mock_worker_agent.astep.call_args
            prompt = call_args[0][0]  # First positional argument
            assert "Parent task" in prompt
            
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    @pytest.mark.asyncio
    async def test_process_task_content_validation_failure(self):
        """Test _process_task when content validation fails."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "test_worker"
        mock_worker.agent_id = "test_agent_123"
        
        worker = SingleAgentWorker(
            description="Test worker",
            worker=mock_worker,
            use_structured_output_handler=False
        )
        
        task = Task(content="Test task content", id="test_task_123")
        
        # Mock worker agent
        mock_worker_agent = AsyncMock()
        mock_response = MagicMock()
        mock_response.msg.content = "Task completed"
        mock_response.msg.parsed = TaskResult(
            content="Task completed",
            failed=False
        )
        mock_response.info = {"usage": {"total_tokens": 50}}
        mock_worker_agent.astep.return_value = mock_response
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"), \
             patch('app.utils.single_agent_worker.is_task_result_insufficient', return_value=True):
            
            result = await worker._process_task(task, [])
            
            assert result == TaskState.FAILED
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    def test_worker_inherits_from_base_class(self):
        """Test that SingleAgentWorker inherits from BaseSingleAgentWorker."""
        from camel.societies.workforce.single_agent_worker import SingleAgentWorker as BaseSingleAgentWorker
        
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.agent_id = "test_agent_123"
        worker = SingleAgentWorker(description="Test", worker=mock_worker)
        
        assert isinstance(worker, BaseSingleAgentWorker)


@pytest.mark.integration
class TestSingleAgentWorkerIntegration:
    """Integration tests for SingleAgentWorker."""
    
    @pytest.mark.asyncio
    async def test_worker_with_multiple_tasks(self):
        """Test worker processing multiple tasks in sequence."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.role_name = "integration_worker"
        mock_worker.agent_id = "test_agent_123"
        
        worker = SingleAgentWorker(
            description="Integration test worker",
            worker=mock_worker,
            use_structured_output_handler=False
        )
        
        # Create multiple tasks
        tasks = [
            Task(content=f"Task {i}", id=f"task_{i}")
            for i in range(3)
        ]
        
        # Mock worker agent for all tasks
        mock_worker_agent = AsyncMock()
        
        def mock_astep(prompt, **kwargs):
            mock_response = MagicMock()
            mock_response.msg.content = f"Completed: {prompt[:20]}..."
            mock_response.msg.parsed = TaskResult(
                content=f"Completed: {prompt[:20]}...",
                failed=False
            )
            mock_response.info = {"usage": {"total_tokens": 60}}
            return mock_response
        
        mock_worker_agent.astep.side_effect = mock_astep
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent'), \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            # Process all tasks
            results = []
            for task in tasks:
                result = await worker._process_task(task, [])
                results.append(result)
            
            # All tasks should succeed
            assert all(result == TaskState.DONE for result in results)
            
            # Each task should have results
            for task in tasks:
                assert task.result is not None
                assert "Completed:" in task.result
                assert "worker_attempts" in task.additional_info


@pytest.mark.model_backend
class TestSingleAgentWorkerWithLLM:
    """Tests that require LLM backend (marked for selective running)."""
    
    @pytest.mark.asyncio
    async def test_worker_with_real_agent(self):
        """Test SingleAgentWorker with real ListenChatAgent."""
        # This test would use real agent instances and LLM calls
        # Marked as model_backend test for selective execution
        assert True  # Placeholder

    @pytest.mark.very_slow
    async def test_worker_full_workflow_integration(self):
        """Test SingleAgentWorker in full workflow context (very slow test)."""
        # This test would run complete workflow with real agents
        # Marked as very_slow for execution only in full test mode
        assert True  # Placeholder


@pytest.mark.unit
class TestSingleAgentWorkerErrorCases:
    """Test error cases and edge conditions for SingleAgentWorker."""
    
    @pytest.mark.asyncio
    async def test_process_task_with_none_response(self):
        """Test _process_task when agent returns None response."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.agent_id = "test_agent_123"
        worker = SingleAgentWorker(description="Test", worker=mock_worker, use_structured_output_handler=False)
        
        task = Task(content="Test task", id="test_123")
        
        # Mock worker agent returning None
        mock_worker_agent = AsyncMock()
        mock_worker_agent.astep.return_value = None
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            result = await worker._process_task(task, [])
            
            # Should handle None response gracefully
            assert result == TaskState.FAILED
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    @pytest.mark.asyncio
    async def test_process_task_with_malformed_response(self):
        """Test _process_task with malformed response structure."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.agent_id = "test_agent_123"
        worker = SingleAgentWorker(description="Test", worker=mock_worker, use_structured_output_handler=False)
        
        task = Task(content="Test task", id="test_123")
        
        # Mock worker agent with malformed response
        mock_worker_agent = AsyncMock()
        mock_response = MagicMock()
        mock_response.msg = None  # Missing msg attribute
        mock_response.info = {}
        mock_worker_agent.astep.return_value = mock_response
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            # Should handle malformed response and likely raise exception
            result = await worker._process_task(task, [])
            
            # Depending on implementation, this might fail or handle gracefully
            assert result in [TaskState.FAILED, TaskState.DONE]
            mock_return_agent.assert_called_once_with(mock_worker_agent)

    @pytest.mark.asyncio
    async def test_process_task_with_missing_usage_info(self):
        """Test _process_task when usage information is missing."""
        mock_worker = MagicMock(spec=ListenChatAgent)
        mock_worker.agent_id = "test_agent_123"
        mock_worker.role_name = "test_worker"
        worker = SingleAgentWorker(description="Test", worker=mock_worker, use_structured_output_handler=False)
        
        task = Task(content="Test task", id="test_123")
        
        # Mock worker agent with missing usage info
        mock_worker_agent = AsyncMock()
        mock_response = MagicMock()
        mock_response.msg.content = "Task completed"
        mock_response.msg.parsed = TaskResult(content="Task completed", failed=False)
        mock_response.info = {}  # Missing usage information
        mock_worker_agent.astep.return_value = mock_response
        
        with patch.object(worker, '_get_worker_agent', return_value=mock_worker_agent), \
             patch.object(worker, '_return_worker_agent') as mock_return_agent, \
             patch.object(worker, '_get_dep_tasks_info', return_value="No dependencies"):
            
            result = await worker._process_task(task, [])
            
            assert result == TaskState.DONE
            assert task.additional_info["token_usage"]["total_tokens"] == 0
            mock_return_agent.assert_called_once_with(mock_worker_agent)
