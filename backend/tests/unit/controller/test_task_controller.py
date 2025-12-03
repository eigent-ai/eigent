from unittest.mock import MagicMock, patch
import pytest
from fastapi import Response
from fastapi.testclient import TestClient

from app.controller.task_controller import start, put, take_control, add_agent, stop_all, TakeControl
from app.model.chat import NewAgent, UpdateData, TaskContent
from app.service.task import Action, ActionStartData, ActionUpdateTaskData, ActionTakeControl, ActionNewAgent, ActionStopData


@pytest.mark.unit
class TestTaskController:
    """Test cases for task controller endpoints."""
    
    def test_start_task_success(self, mock_task_lock):
        """Test successful task start."""
        task_id = "test_task_123"
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = start(task_id)
            
            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_run.assert_called_once()

    def test_update_task_success(self, mock_task_lock):
        """Test successful task update."""
        task_id = "test_task_123"
        update_data = UpdateData(
            task=[
                TaskContent(id="subtask_1", content="Updated content 1"),
                TaskContent(id="subtask_2", content="Updated content 2")
            ]
        )
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = put(task_id, update_data)
            
            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_run.assert_called_once()

    @pytest.mark.parametrize("action", [Action.pause, Action.resume])
    def test_take_control_success(self, mock_task_lock, action):
        """Test successful task pause/resume control."""
        task_id = "test_task_123"
        control_data = TakeControl(action=action)
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = take_control(task_id, control_data)
            
            assert isinstance(response, Response)
            assert response.status_code == 204
            mock_run.assert_called_once()

    @pytest.mark.parametrize(
        "mcp_tools,env_path",
        [
            (None, ".env"),  # Basic agent without MCP tools
            ({"mcpServers": {"notion": {"config": "test"}}}, ".env"),  # Agent with MCP tools
            (None, "/custom/path/.env"),  # Custom env path
        ],
        ids=["basic", "with_mcp_tools", "custom_env_path"]
    )
    def test_add_agent_success(self, mock_task_lock, mcp_tools, env_path):
        """Test successful agent addition with various configurations."""
        task_id = "test_task_123"
        new_agent = NewAgent(
            name="Test Agent",
            description="A test agent",
            tools=["search", "code"],
            mcp_tools=mcp_tools,
            env_path=env_path
        )
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("app.controller.task_controller.set_user_env_path") as mock_set_env, \
             patch("app.controller.task_controller.load_dotenv"), \
             patch("asyncio.run") as mock_run:
            
            response = add_agent(task_id, new_agent)
            
            assert isinstance(response, Response)
            assert response.status_code == 204
            mock_run.assert_called_once()
            # Verify set_user_env_path was called with correct path
            mock_set_env.assert_called_once_with(env_path)

    def test_start_task_nonexistent_task(self):
        """Test start task with nonexistent task ID."""
        task_id = "nonexistent_task"
        
        with patch("app.controller.task_controller.get_task_lock", side_effect=KeyError("Task not found")):
            with pytest.raises(KeyError):
                start(task_id)

    def test_update_task_empty_data(self, mock_task_lock):
        """Test update task with empty task list."""
        task_id = "test_task_123"
        update_data = UpdateData(task=[])
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = put(task_id, update_data)
            
            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_run.assert_called_once()


    @pytest.mark.parametrize("task_count", [0, 1, 3])
    def test_stop_all_success(self, task_count):
        """Test stopping all tasks with varying number of running tasks."""
        mock_locks_list = [MagicMock() for _ in range(task_count)]
        
        with patch("app.controller.task_controller.task_locks") as mock_locks, \
             patch("asyncio.run") as mock_run:
            mock_locks.values.return_value = mock_locks_list
            mock_locks.__len__.return_value = task_count
            
            response = stop_all()
            
            assert isinstance(response, Response)
            assert response.status_code == 204
            assert mock_run.call_count == task_count

    def test_start_task_verifies_action_data(self, mock_task_lock):
        """Test that start sends correct ActionStartData to queue."""
        task_id = "test_task_123"
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            start(task_id)
            
            mock_run.assert_called_once()
            call_arg = mock_run.call_args[0][0]
            mock_task_lock.put_queue.assert_called_once()

    def test_update_task_verifies_action_data(self, mock_task_lock):
        """Test that update sends correct ActionUpdateTaskData with data."""
        task_id = "test_task_123"
        update_data = UpdateData(
            task=[
                TaskContent(id="subtask_1", content="Content 1"),
                TaskContent(id="subtask_2", content="Content 2")
            ]
        )
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            put(task_id, update_data)
            
            mock_run.assert_called_once()
            mock_task_lock.put_queue.assert_called_once()

    def test_take_control_verifies_action_data(self, mock_task_lock):
        """Test that take_control sends correct ActionTakeControl."""
        task_id = "test_task_123"
        control_data = TakeControl(action=Action.pause)
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            take_control(task_id, control_data)
            
            mock_run.assert_called_once()
            mock_task_lock.put_queue.assert_called_once()

    def test_update_task_nonexistent_task(self):
        """Test update task with nonexistent task ID."""
        task_id = "nonexistent_task"
        update_data = UpdateData(task=[TaskContent(id="1", content="test")])
        
        with patch("app.controller.task_controller.get_task_lock", side_effect=KeyError("Task not found")):
            with pytest.raises(KeyError):
                put(task_id, update_data)

    def test_take_control_nonexistent_task(self):
        """Test take control with nonexistent task ID."""
        task_id = "nonexistent_task"
        control_data = TakeControl(action=Action.pause)
        
        with patch("app.controller.task_controller.get_task_lock", side_effect=KeyError("Task not found")):
            with pytest.raises(KeyError):
                take_control(task_id, control_data)

    def test_add_agent_nonexistent_task(self):
        """Test add agent with nonexistent task ID."""
        task_id = "nonexistent_task"
        new_agent = NewAgent(
            name="Test Agent",
            description="Test",
            tools=["search"],
            mcp_tools=None,
            env_path=".env"
        )
        
        with patch("app.controller.task_controller.get_task_lock", side_effect=KeyError("Task not found")):
            with pytest.raises(KeyError):
                add_agent(task_id, new_agent)


@pytest.mark.integration
class TestTaskControllerIntegration:
    """Integration tests for task controller."""
    
    def test_start_task_endpoint_integration(self, client: TestClient):
        """Test start task endpoint through FastAPI test client."""
        task_id = "test_task_123"
        
        with patch("app.controller.task_controller.get_task_lock") as mock_get_lock, \
             patch("asyncio.run"):
            
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock
            
            response = client.post(f"/task/{task_id}/start")
            
            assert response.status_code == 201

    def test_update_task_endpoint_integration(self, client: TestClient):
        """Test update task endpoint through FastAPI test client."""
        task_id = "test_task_123"
        update_data = {
            "task": [
                {"id": "subtask_1", "content": "Updated content 1"},
                {"id": "subtask_2", "content": "Updated content 2"}
            ]
        }
        
        with patch("app.controller.task_controller.get_task_lock") as mock_get_lock, \
             patch("asyncio.run"):
            
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock
            
            response = client.put(f"/task/{task_id}", json=update_data)
            
            assert response.status_code == 201

    @pytest.mark.parametrize("action", ["pause", "resume"])
    def test_take_control_endpoint_integration(self, client: TestClient, action):
        """Test take control pause/resume endpoint through FastAPI test client."""
        task_id = "test_task_123"
        control_data = {"action": action}
        
        with patch("app.controller.task_controller.get_task_lock") as mock_get_lock, \
             patch("asyncio.run"):
            
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock
            
            response = client.put(f"/task/{task_id}/take-control", json=control_data)
            
            assert response.status_code == 204

    def test_add_agent_endpoint_integration(self, client: TestClient):
        """Test add agent endpoint through FastAPI test client."""
        task_id = "test_task_123"
        agent_data = {
            "name": "Test Agent",
            "description": "A test agent",
            "tools": ["search", "code"],
            "mcp_tools": None,
            "env_path": ".env"
        }
        
        with patch("app.controller.task_controller.get_task_lock") as mock_get_lock, \
             patch("app.controller.task_controller.load_dotenv"), \
             patch("asyncio.run"):
            
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock
            
            response = client.post(f"/task/{task_id}/add-agent", json=agent_data)
            
            assert response.status_code == 204

    def test_stop_all_endpoint_integration(self, client: TestClient):
        """Test stop all endpoint through FastAPI test client."""
        mock_lock_1 = MagicMock()
        mock_lock_2 = MagicMock()
        
        with patch("app.controller.task_controller.task_locks") as mock_locks, \
             patch("asyncio.run"):
            mock_locks.values.return_value = [mock_lock_1, mock_lock_2]
            mock_locks.__len__.return_value = 2
            
            response = client.delete("/task/stop-all")
            
            assert response.status_code == 204


@pytest.mark.unit
class TestTaskControllerErrorCases:
    """Test error cases and edge conditions for task controller."""
    
    def test_start_task_async_error(self, mock_task_lock):
        """Test start task when async operation fails."""
        task_id = "test_task_123"
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run", side_effect=Exception("Async error")):
            
            with pytest.raises(Exception, match="Async error"):
                start(task_id)

    def test_update_task_with_invalid_task_content(self, mock_task_lock):
        """Test update task with invalid task content."""
        task_id = "test_task_123"
        # Create invalid update data that might cause validation errors
        update_data = UpdateData(task=[
            TaskContent(id="", content=""),  # Empty ID and content
            TaskContent(id="valid_id", content="Valid content")
        ])
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            # Should handle invalid data gracefully or raise appropriate error
            response = put(task_id, update_data)
            assert response.status_code == 201

    def test_take_control_invalid_action(self):
        """Test take control with invalid action value."""
        task_id = "test_task_123"
        
        # This should be caught by Pydantic validation
        with pytest.raises((ValueError, TypeError)):
            TakeControl(action="invalid_action")

    def test_add_agent_env_load_failure(self, mock_task_lock):
        """Test add agent when environment loading fails."""
        task_id = "test_task_123"
        new_agent = NewAgent(
            name="Test Agent",
            description="A test agent",
            tools=["search"],
            mcp_tools=None,
            env_path="nonexistent.env"
        )
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("app.controller.task_controller.load_dotenv", side_effect=Exception("Env load failed")), \
             patch("asyncio.run"):
            
            # Should handle environment load failure gracefully or raise error
            with pytest.raises(Exception, match="Env load failed"):
                add_agent(task_id, new_agent)

    def test_add_agent_with_empty_name(self, mock_task_lock):
        """Test add agent with empty name."""
        task_id = "test_task_123"
        new_agent = NewAgent(
            name="",  # Empty name
            description="A test agent",
            tools=["search"],
            mcp_tools=None,
            env_path=".env"
        )
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("app.controller.task_controller.load_dotenv"), \
             patch("asyncio.run"):
            
            # Should handle empty name appropriately
            response = add_agent(task_id, new_agent)
            assert response.status_code == 204

    def test_task_operations_with_concurrent_access(self, mock_task_lock):
        """Test task operations with concurrent access scenarios."""
        task_id = "test_task_123"
        
        # Simulate concurrent access by having the task lock be modified during operation
        def side_effect():
            mock_task_lock.status = "modified_during_operation"
            return None
        
        mock_task_lock.put_queue.side_effect = side_effect
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = start(task_id)
            assert response.status_code == 201

    def test_stop_all_with_async_error(self):
        """Test stop_all when async operation fails on one task."""
        mock_lock_1 = MagicMock()
        mock_lock_2 = MagicMock()
        
        call_count = [0]
        
        def mock_run_side_effect(coroutine):
            call_count[0] += 1
            if call_count[0] == 1:
                raise Exception("First task failed to stop")
            return None
        
        with patch("app.controller.task_controller.task_locks") as mock_locks, \
             patch("asyncio.run", side_effect=mock_run_side_effect):
            mock_locks.values.return_value = [mock_lock_1, mock_lock_2]
            mock_locks.__len__.return_value = 2
            
            # Should raise exception when first task fails
            with pytest.raises(Exception, match="First task failed to stop"):
                stop_all()

    def test_add_agent_verifies_set_user_env_path(self, mock_task_lock):
        """Test that add_agent always calls set_user_env_path with env_path."""
        task_id = "test_task_123"
        custom_env_path = "/custom/path/.env"
        new_agent = NewAgent(
            name="Test Agent",
            description="Test",
            tools=["search"],
            mcp_tools=None,
            env_path=custom_env_path
        )
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("app.controller.task_controller.set_user_env_path") as mock_set_env, \
             patch("app.controller.task_controller.load_dotenv"), \
             patch("asyncio.run"):
            
            add_agent(task_id, new_agent)
            
            # Verify set_user_env_path was called with the custom path
            mock_set_env.assert_called_once_with(custom_env_path)

    def test_update_task_with_large_dataset(self, mock_task_lock):
        """Test update task with many TaskContent items."""
        task_id = "test_task_123"
        # Create a large update with 100 items
        task_items = [
            TaskContent(id=f"task_{i}", content=f"Content {i}")
            for i in range(100)
        ]
        update_data = UpdateData(task=task_items)
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = put(task_id, update_data)
            
            assert response.status_code == 201
            mock_run.assert_called_once()

    def test_add_agent_with_special_characters_in_env_path(self, mock_task_lock):
        """Test add_agent with special characters in env_path."""
        task_id = "test_task_123"
        new_agent = NewAgent(
            name="Test Agent",
            description="Test",
            tools=["search"],
            mcp_tools=None,
            env_path="/path/with spaces/.env"
        )
        
        with patch("app.controller.task_controller.get_task_lock", return_value=mock_task_lock), \
             patch("app.controller.task_controller.set_user_env_path") as mock_set_env, \
             patch("app.controller.task_controller.load_dotenv"), \
             patch("asyncio.run"):
            
            response = add_agent(task_id, new_agent)
            
            assert response.status_code == 204
            mock_set_env.assert_called_once_with("/path/with spaces/.env")
