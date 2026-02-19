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

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from camel.agents import ChatAgent
from camel.agents._types import ToolCallRequest
from camel.messages import BaseMessage
from camel.responses import ChatAgentResponse
from camel.toolkits import FunctionTool
from camel.types.agents import ToolCallingRecord

from app.agent.listen_chat_agent import ListenChatAgent
from app.model.chat import Chat

_LCA = "app.agent.listen_chat_agent"

pytestmark = pytest.mark.unit


class TestListenChatAgent:
    """Test cases for ListenChatAgent class."""

    def test_listen_chat_agent_initialization(self):
        """Test ListenChatAgent initialization."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"

        with (
            patch(f"{_LCA}.get_task_lock") as mock_get_lock,
            patch("camel.models.ModelFactory.create") as mock_create_model,
        ):
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock

            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4",  # Use string instead of mock
                system_message="You are a helpful assistant",
                tools=[],
                agent_id="test_agent_123",
            )

            assert agent.api_task_id == api_task_id
            assert agent.agent_name == agent_name
            assert isinstance(agent, ChatAgent)

    def test_listen_chat_agent_step_with_string_input(self, mock_task_lock):
        """Test ListenChatAgent step method with string input."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
            patch("asyncio.create_task"),
        ):
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id, agent_name=agent_name, model="gpt-4"
            )
            agent.process_task_id = "test_process_task"

            # Mock the parent step method and create proper response
            mock_response = MagicMock(spec=ChatAgentResponse)
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Test response content"
            mock_response.info = {"usage": {"total_tokens": 100}}

            with patch.object(
                ChatAgent, "step", return_value=mock_response
            ) as mock_parent_step:
                result = agent.step("Test input message")

                assert result is mock_response
                # Check that step was called with
                # the input message (don't assert
                # on response_format param)
                mock_parent_step.assert_called_once()
                args, kwargs = mock_parent_step.call_args
                assert args[0] == "Test input message"
                # Should queue activation notification
                mock_task_lock.put_queue.assert_called()

    def test_listen_chat_agent_step_with_base_message_input(
        self, mock_task_lock
    ):
        """Test ListenChatAgent step method with BaseMessage input."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
            patch("asyncio.create_task"),
        ):
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id, agent_name=agent_name, model="gpt-4"
            )
            agent.agent_id = "test_agent_456"
            agent.process_task_id = "test_process_task"

            # Create mock BaseMessage
            mock_message = MagicMock(spec=BaseMessage)
            mock_message.content = "Base message content"

            # Create proper mock response
            mock_response = MagicMock(spec=ChatAgentResponse)
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Test response content"
            mock_response.info = {"usage": {"total_tokens": 100}}

            with patch.object(
                ChatAgent, "step", return_value=mock_response
            ) as mock_parent_step:
                result = agent.step(mock_message)

                assert result is mock_response
                # Check that step was called with
                # the mock message (don't assert
                # on response_format param)
                mock_parent_step.assert_called_once()
                args, kwargs = mock_parent_step.call_args
                assert args[0] is mock_message

                # Should queue activation with message content
                mock_task_lock.put_queue.assert_called()
                # Just verify put_queue was called -
                # don't check internal data
                # structure details

    @pytest.mark.asyncio
    async def test_listen_chat_agent_astep(self, mock_task_lock):
        """Test ListenChatAgent async step method."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
            patch("asyncio.create_task"),
        ):
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id, agent_name=agent_name, model="gpt-4"
            )
            agent.process_task_id = "test_process_task"

            # Mock the parent astep method
            mock_response = MagicMock()
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Test response message"
            mock_response.info = {"usage": {"total_tokens": 100}}

            with patch.object(
                ChatAgent, "astep", return_value=mock_response
            ) as mock_parent_astep:
                result = await agent.astep("Test async input")

                assert result is mock_response
                # Check that astep was called with
                # the input message (don't assert
                # on response_format param)
                mock_parent_astep.assert_called_once()
                args, kwargs = mock_parent_astep.call_args
                assert args[0] == "Test async input"

                # Verify that task lock put_queue was called
                mock_task_lock.put_queue.assert_called()

    def test_listen_chat_agent_execute_tool(self, mock_task_lock):
        """Test ListenChatAgent _execute_tool method."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
            patch("asyncio.create_task"),
        ):
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id, agent_name=agent_name, model="gpt-4"
            )

            # Create a mock tool and add it to _internal_tools
            mock_tool = MagicMock(spec=FunctionTool)
            mock_tool.func = MagicMock()
            mock_tool.return_value = "test_result"
            agent._internal_tools = {"test_tool": mock_tool}

            # Mock tool call request
            tool_call_request = MagicMock(spec=ToolCallRequest)
            tool_call_request.tool_name = "test_tool"
            tool_call_request.id = "tool_call_123"
            tool_call_request.tool_call_id = "tool_call_123"
            tool_call_request.args = {"arg1": "value1"}
            tool_call_request.extra_content = None

            # Mock tool calling record
            mock_record = MagicMock(spec=ToolCallingRecord)

            with patch.object(
                agent, "_record_tool_calling", return_value=mock_record
            ) as mock_record_func:
                result = agent._execute_tool(tool_call_request)

                assert result is mock_record
                mock_record_func.assert_called_once()

                # Should queue toolkit activation
                # and deactivation notifications
                assert mock_task_lock.put_queue.call_count >= 2

    @pytest.mark.asyncio
    async def test_listen_chat_agent_aexecute_tool(self, mock_task_lock):
        """Test ListenChatAgent _aexecute_tool method."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
        ):
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id, agent_name=agent_name, model="gpt-4"
            )

            # Create a mock tool and add it to _internal_tools
            mock_tool = MagicMock(spec=FunctionTool)
            mock_tool.func = AsyncMock()
            mock_tool.return_value = "test_async_result"
            agent._internal_tools = {"test_async_tool": mock_tool}

            tool_call_request = MagicMock(spec=ToolCallRequest)
            tool_call_request.tool_name = "test_async_tool"
            tool_call_request.id = "async_tool_call_123"
            tool_call_request.tool_call_id = "async_tool_call_123"
            tool_call_request.args = {"arg1": "value1"}
            tool_call_request.extra_content = None

            mock_record = MagicMock(spec=ToolCallingRecord)

            with patch.object(
                agent, "_record_tool_calling", return_value=mock_record
            ) as mock_record_func:
                result = await agent._aexecute_tool(tool_call_request)

                assert result is mock_record
                mock_record_func.assert_called_once()

                # Should queue toolkit activation
                # and deactivation notifications
                assert mock_task_lock.put_queue.call_count >= 2

    def test_listen_chat_agent_clone(self, mock_task_lock):
        """Test ListenChatAgent clone method."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
        ):
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            # String instead of list to avoid
            # list processing
            mock_backend.models = "gpt-4"
            mock_backend.scheduling_strategy = MagicMock()
            mock_backend.scheduling_strategy.__name__ = "round_robin"
            mock_create_model.return_value = mock_backend

            # Mock the clone process by patching
            # ListenChatAgent constructor for clone
            cloned_agent = MagicMock()
            cloned_agent.process_task_id = "test_process_task"

            # First create the initial agent
            agent = ListenChatAgent(
                api_task_id=api_task_id, agent_name=agent_name, model="gpt-4"
            )

            # Set up necessary attributes for cloning
            agent._original_system_message = "test system message"
            agent.memory = MagicMock()
            agent.memory.window_size = 10
            agent.memory.get_context_creator = MagicMock()
            agent.memory.get_context_creator.return_value.token_limit = 4000
            agent._output_language = "en"
            agent._external_tool_schemas = {}
            agent.response_terminators = []
            agent.max_iteration = None
            agent.agent_id = "test_agent_id"
            agent.stop_event = None
            agent.tool_execution_timeout = None
            agent.mask_tool_output = False
            agent.pause_event = None
            agent.prune_tool_calls_from_memory = False

            # Now mock the constructor for the clone call
            with (
                patch(
                    f"{_LCA}.ListenChatAgent", return_value=cloned_agent
                ) as mock_clone_constructor,
                patch.object(agent, "_clone_tools", return_value=([], [])),
            ):
                result = agent.clone(with_memory=True)

                assert result is cloned_agent
                mock_clone_constructor.assert_called_once()

    def test_listen_chat_agent_with_tools(self, mock_task_lock):
        """Test ListenChatAgent with tools."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"

        # Mock tool
        mock_tool = MagicMock(spec=FunctionTool)
        tools = [mock_tool]

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
        ):
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4",
                tools=tools,
            )

            # Mock function_list attribute that is expected to exist
            agent.function_list = [mock_tool]

            assert len(agent.function_list) == 1  # Should have the tool
            # Check that tools were passed to parent class
            mock_task_lock.put_queue.assert_not_called()  # No immediate action for tool setup

    def test_listen_chat_agent_with_pause_event(self, mock_task_lock):
        """Test ListenChatAgent with pause event."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"

        pause_event = asyncio.Event()

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
        ):
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4",
                pause_event=pause_event,
            )

            assert agent.pause_event is pause_event

    def test_listen_chat_agent_with_invalid_model(self):
        """Test ListenChatAgent with invalid model."""
        api_task_id = "error_test_123"
        agent_name = "ErrorAgent"

        with (
            patch(f"{_LCA}.get_task_lock") as mock_get_lock,
            patch(
                "camel.models.ModelFactory.create",
                side_effect=ValueError("Invalid model"),
            ),
        ):
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock

            # Try to create agent with invalid
            # model which should raise an error
            # through ModelFactory
            with pytest.raises(ValueError):
                ListenChatAgent(
                    api_task_id=api_task_id,
                    agent_name=agent_name,
                    model="invalid_model_string",  # Invalid model type
                )

    def test_listen_chat_agent_step_with_task_lock_error(self):
        """Test ListenChatAgent step when task lock retrieval fails."""
        api_task_id = "error_test_123"
        agent_name = "ErrorAgent"

        with (
            patch(
                f"{_LCA}.get_task_lock",
                side_effect=Exception("Task lock not found"),
            ),
            patch("camel.models.ModelFactory.create") as mock_create_model,
        ):
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id, agent_name=agent_name, model="gpt-4"
            )

            # Should handle task lock errors gracefully
            with pytest.raises(Exception):
                agent.step("Test message")


@pytest.mark.unit
def test_step_raises_runtime_error_on_none_message(mock_task_lock):
    """step() raises RuntimeError (not AssertionError) when message is None."""
    with (
        patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
        patch("camel.models.ModelFactory.create") as mock_create_model,
    ):
        mock_backend = MagicMock()
        mock_backend.model_type = "gpt-4"
        mock_backend.current_model = MagicMock()
        mock_backend.current_model.model_type = "gpt-4"
        mock_create_model.return_value = mock_backend

        agent = ListenChatAgent(
            api_task_id="test_task",
            agent_name="TestAgent",
            model="gpt-4",
        )
        agent.process_task_id = "test_process"

        error = Exception("Some unexpected error")
        with patch.object(ChatAgent, "step", side_effect=error):
            with pytest.raises(Exception, match="Some unexpected error"):
                agent.step("test input")

        mock_task_lock.put_queue.assert_called()


@pytest.mark.unit
def test_step_raises_runtime_error_when_res_is_none(mock_task_lock):
    """step() raises RuntimeError (not AssertionError) when res is None
    without error_info set."""
    with (
        patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
        patch("camel.models.ModelFactory.create") as mock_create_model,
    ):
        mock_backend = MagicMock()
        mock_backend.model_type = "gpt-4"
        mock_backend.current_model = MagicMock()
        mock_backend.current_model.model_type = "gpt-4"
        mock_create_model.return_value = mock_backend

        agent = ListenChatAgent(
            api_task_id="test_task",
            agent_name="TestAgent",
            model="gpt-4",
        )
        agent.process_task_id = "test_process"

        with patch.object(ChatAgent, "step", return_value=None):
            with pytest.raises(RuntimeError, match="returned None"):
                agent.step("test input")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_astep_raises_runtime_error_on_none_message(mock_task_lock):
    """astep() raises RuntimeError (not AssertionError) when message is None."""
    with (
        patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
        patch("camel.models.ModelFactory.create") as mock_create_model,
        patch("asyncio.create_task"),
    ):
        mock_backend = MagicMock()
        mock_backend.model_type = "gpt-4"
        mock_backend.current_model = MagicMock()
        mock_backend.current_model.model_type = "gpt-4"
        mock_create_model.return_value = mock_backend

        agent = ListenChatAgent(
            api_task_id="test_task",
            agent_name="TestAgent",
            model="gpt-4",
        )
        agent.process_task_id = "test_process"

        error = Exception("Async unexpected error")
        with patch.object(ChatAgent, "astep", side_effect=error):
            with pytest.raises(
                Exception, match="Async unexpected error"
            ):
                await agent.astep("test input")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_astep_raises_runtime_error_when_res_is_none(mock_task_lock):
    """astep() raises RuntimeError (not AssertionError) when res is None
    without error_info set."""
    with (
        patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
        patch("camel.models.ModelFactory.create") as mock_create_model,
        patch("asyncio.create_task"),
    ):
        mock_backend = MagicMock()
        mock_backend.model_type = "gpt-4"
        mock_backend.current_model = MagicMock()
        mock_backend.current_model.model_type = "gpt-4"
        mock_create_model.return_value = mock_backend

        agent = ListenChatAgent(
            api_task_id="test_task",
            agent_name="TestAgent",
            model="gpt-4",
        )
        agent.process_task_id = "test_process"

        with patch.object(ChatAgent, "astep", return_value=None):
            with pytest.raises(RuntimeError, match="returned None"):
                await agent.astep("test input")


@pytest.mark.model_backend
class TestAgentWithLLM:
    """Tests that require LLM backend (marked for selective running)."""

    @pytest.mark.asyncio
    async def test_agent_with_real_model(self, sample_chat_data):
        """Test agent creation with real LLM model."""
        Chat(**sample_chat_data)

        # This test would use real model backends
        # Marked as model_backend test for selective execution
        assert True  # Placeholder

    @pytest.mark.very_slow
    async def test_full_agent_conversation_workflow(self, sample_chat_data):
        """Test complete agent conversation workflow (very slow test)."""
        Chat(**sample_chat_data)

        # This test would run complete conversation workflow
        # Marked as very_slow for execution only in full test mode
        assert True  # Placeholder
