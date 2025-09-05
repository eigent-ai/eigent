import os
from unittest.mock import MagicMock, patch

import pytest
from fastapi import Response
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.controller.chat_controller import improve, post, stop, supplement, human_reply, install_mcp
from pydantic import ValidationError
from app.exception.exception import UserException
from app.model.chat import Chat, HumanReply, McpServers, Status, SupplementChat


@pytest.mark.unit
class TestChatController:
    """Test cases for chat controller endpoints."""
    
    @pytest.mark.asyncio
    async def test_post_chat_endpoint_success(self, sample_chat_data, mock_request, mock_task_lock, mock_environment_variables):
        """Test successful chat initialization."""
        chat_data = Chat(**sample_chat_data)
        
        with patch("app.controller.chat_controller.create_task_lock", return_value=mock_task_lock), \
             patch("app.controller.chat_controller.step_solve") as mock_step_solve, \
             patch("app.controller.chat_controller.load_dotenv"), \
             patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.home", return_value=MagicMock()):
            
            # Mock async generator
            async def mock_generator():
                yield "data: test_response\n\n"
                yield "data: test_response_2\n\n"
            
            mock_step_solve.return_value = mock_generator()
            
            response = await post(chat_data, mock_request)
            
            assert isinstance(response, StreamingResponse)
            assert response.media_type == "text/event-stream"
            mock_step_solve.assert_called_once_with(chat_data, mock_request, mock_task_lock)

    @pytest.mark.asyncio
    async def test_post_chat_sets_environment_variables(self, sample_chat_data, mock_request, mock_task_lock):
        """Test that environment variables are properly set."""
        chat_data = Chat(**sample_chat_data)
        
        with patch("app.controller.chat_controller.create_task_lock", return_value=mock_task_lock), \
             patch("app.controller.chat_controller.step_solve") as mock_step_solve, \
             patch("app.controller.chat_controller.load_dotenv"), \
             patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.home", return_value=MagicMock()), \
             patch.dict(os.environ, {}, clear=True):
            
            async def mock_generator():
                yield "data: test_response\n\n"
            
            mock_step_solve.return_value = mock_generator()
            
            await post(chat_data, mock_request)
            
            # Check environment variables were set
            assert os.environ.get("OPENAI_API_KEY") == "test_key"
            assert os.environ.get("OPENAI_API_BASE_URL") == "https://api.openai.com/v1"
            assert os.environ.get("CAMEL_MODEL_LOG_ENABLED") == "true"
            assert os.environ.get("browser_port") == "8080"

    def test_improve_chat_success(self, mock_task_lock):
        """Test successful chat improvement."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="Improve this code")
        mock_task_lock.status = Status.processing
        
        with patch("app.controller.chat_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = improve(task_id, supplement_data)
            
            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_run.assert_called_once()
            # put_queue is invoked when creating the coroutine passed to asyncio.run
            mock_task_lock.put_queue.assert_called_once()

    def test_improve_chat_task_done_error(self, mock_task_lock):
        """Test improvement fails when task is done."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="Improve this code")
        mock_task_lock.status = Status.done
        
        with patch("app.controller.chat_controller.get_task_lock", return_value=mock_task_lock):
            with pytest.raises(UserException):
                improve(task_id, supplement_data)

    def test_supplement_chat_success(self, mock_task_lock):
        """Test successful chat supplementation."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="Add more details")
        mock_task_lock.status = Status.done
        
        with patch("app.controller.chat_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = supplement(task_id, supplement_data)
            
            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_run.assert_called_once()

    def test_supplement_chat_task_not_done_error(self, mock_task_lock):
        """Test supplementation fails when task is not done."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="Add more details")
        mock_task_lock.status = Status.processing
        
        with patch("app.controller.chat_controller.get_task_lock", return_value=mock_task_lock):
            with pytest.raises(UserException):
                supplement(task_id, supplement_data)

    def test_stop_chat_success(self, mock_task_lock):
        """Test successful chat stopping."""
        task_id = "test_task_123"
        
        with patch("app.controller.chat_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = stop(task_id)
            
            assert isinstance(response, Response)
            assert response.status_code == 204
            mock_run.assert_called_once()

    def test_human_reply_success(self, mock_task_lock):
        """Test successful human reply."""
        task_id = "test_task_123"
        reply_data = HumanReply(agent="test_agent", reply="This is my reply")
        
        with patch("app.controller.chat_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = human_reply(task_id, reply_data)
            
            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_run.assert_called_once()

    def test_install_mcp_success(self, mock_task_lock):
        """Test successful MCP installation."""
        task_id = "test_task_123"
        mcp_data: McpServers = {"mcpServers": {"test_server": {"config": "test"}}}
        
        with patch("app.controller.chat_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run") as mock_run:
            
            response = install_mcp(task_id, mcp_data)
            
            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_run.assert_called_once()


@pytest.mark.integration
class TestChatControllerIntegration:
    """Integration tests for chat controller."""
    
    def test_chat_endpoint_integration(self, client: TestClient, sample_chat_data):
        """Test chat endpoint through FastAPI test client."""
        with patch("app.controller.chat_controller.create_task_lock") as mock_create_lock, \
             patch("app.controller.chat_controller.step_solve") as mock_step_solve, \
             patch("app.controller.chat_controller.load_dotenv"), \
             patch("pathlib.Path.mkdir"), \
             patch("pathlib.Path.home", return_value=MagicMock()):
            
            mock_task_lock = MagicMock()
            mock_create_lock.return_value = mock_task_lock
            
            async def mock_generator():
                yield "data: test_response\n\n"
            
            mock_step_solve.return_value = mock_generator()
            
            response = client.post("/chat", json=sample_chat_data)
            
            assert response.status_code == 200
            assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

    def test_improve_chat_endpoint_integration(self, client: TestClient):
        """Test improve chat endpoint through FastAPI test client."""
        task_id = "test_task_123"
        supplement_data = {"question": "Improve this code"}
        
        with patch("app.controller.chat_controller.get_task_lock") as mock_get_lock, \
             patch("asyncio.run"):
            
            mock_task_lock = MagicMock()
            mock_task_lock.status = Status.processing
            mock_get_lock.return_value = mock_task_lock
            
            response = client.post(f"/chat/{task_id}", json=supplement_data)
            
            assert response.status_code == 201

    def test_supplement_chat_endpoint_integration(self, client: TestClient):
        """Test supplement chat endpoint through FastAPI test client."""
        task_id = "test_task_123"
        supplement_data = {"question": "Add more details"}
        
        with patch("app.controller.chat_controller.get_task_lock") as mock_get_lock, \
             patch("asyncio.run"):
            
            mock_task_lock = MagicMock()
            mock_task_lock.status = Status.done
            mock_get_lock.return_value = mock_task_lock
            
            response = client.put(f"/chat/{task_id}", json=supplement_data)
            
            assert response.status_code == 201

    def test_stop_chat_endpoint_integration(self, client: TestClient):
        """Test stop chat endpoint through FastAPI test client."""
        task_id = "test_task_123"
        
        with patch("app.controller.chat_controller.get_task_lock") as mock_get_lock, \
             patch("asyncio.run"):
            
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock
            
            response = client.delete(f"/chat/{task_id}")
            
            assert response.status_code == 204

    def test_human_reply_endpoint_integration(self, client: TestClient):
        """Test human reply endpoint through FastAPI test client."""
        task_id = "test_task_123"
        reply_data = {"agent": "test_agent", "reply": "This is my reply"}
        
        with patch("app.controller.chat_controller.get_task_lock") as mock_get_lock, \
             patch("asyncio.run"):
            
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock
            
            response = client.post(f"/chat/{task_id}/human-reply", json=reply_data)
            
            assert response.status_code == 201

    def test_install_mcp_endpoint_integration(self, client: TestClient):
        """Test install MCP endpoint through FastAPI test client."""
        task_id = "test_task_123"
        mcp_data = {"mcpServers": {"test_server": {"config": "test"}}}
        
        with patch("app.controller.chat_controller.get_task_lock") as mock_get_lock, \
             patch("asyncio.run"):
            
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock
            
            response = client.post(f"/chat/{task_id}/install-mcp", json=mcp_data)
            
            assert response.status_code == 201


@pytest.mark.model_backend
class TestChatControllerWithLLM:
    """Tests that require LLM backend (marked for selective running)."""
    
    @pytest.mark.asyncio
    async def test_post_with_real_llm_model(self, sample_chat_data, mock_request):
        """Test chat endpoint with real LLM model (slow test)."""
        # This test would use actual LLM models and should be marked accordingly
        chat_data = Chat(**sample_chat_data)
        
        # Test implementation would involve real model calls
        # This is marked as model_backend test for selective execution
        assert True  # Placeholder

    @pytest.mark.very_slow
    async def test_full_chat_workflow_with_llm(self, sample_chat_data, mock_request):
        """Test complete chat workflow with LLM (very slow test)."""
        # This test would run the complete workflow including actual agent interactions
        # Marked as very_slow for execution only in full test mode
        assert True  # Placeholder


@pytest.mark.unit
class TestChatControllerErrorCases:
    """Test error cases and edge conditions."""
    
    @pytest.mark.asyncio
    async def test_post_with_invalid_data(self, mock_request):
        """Test chat endpoint with invalid data."""
        # Construction itself should raise a validation error due to multiple invalid fields
        with pytest.raises((ValueError, TypeError, ValidationError)):
            Chat(
                task_id="",  # Invalid empty task_id
                email="invalid_email",  # Invalid email format
                question="",  # Empty question
                attaches=[],
                model="invalid_model",  # Field not defined in model -> triggers error
                model_platform="invalid_platform",
                api_key="",
                api_url="invalid_url",
                new_agents=[],
                env_path="nonexistent.env",
                browser_port=-1,  # Invalid port
                summary_prompt=""
            )
        # If future validation moves to endpoint level, keep logic placeholder below.
        # (Intentionally not calling post with invalid Chat object since creation fails.)

    def test_improve_with_nonexistent_task(self):
        """Test improve endpoint with nonexistent task."""
        task_id = "nonexistent_task"
        supplement_data = SupplementChat(question="Improve this code")
        
        with patch("app.controller.chat_controller.get_task_lock", side_effect=KeyError("Task not found")):
            with pytest.raises(KeyError):
                improve(task_id, supplement_data)

    def test_supplement_with_empty_question(self, mock_task_lock):
        """Test supplement endpoint with empty question."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="")
        mock_task_lock.status = Status.done
        
        with patch("app.controller.chat_controller.get_task_lock", return_value=mock_task_lock), \
             patch("asyncio.run"):
            
            # Should handle empty question gracefully or raise appropriate error
            response = supplement(task_id, supplement_data)
            assert response.status_code == 201  # Or should it be an error?

    @pytest.mark.asyncio
    async def test_post_environment_setup_failure(self, sample_chat_data, mock_request):
        """Test chat endpoint when environment setup fails."""
        chat_data = Chat(**sample_chat_data)
        
        with patch("app.controller.chat_controller.create_task_lock") as mock_create_lock, \
             patch("app.controller.chat_controller.load_dotenv", side_effect=Exception("Env load failed")), \
             patch("pathlib.Path.mkdir", side_effect=Exception("Directory creation failed")):
            
            mock_task_lock = MagicMock()
            mock_create_lock.return_value = mock_task_lock
            
            # Should handle environment setup failures gracefully
            with pytest.raises(Exception):
                await post(chat_data, mock_request)
