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
import json
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from camel.agents import ChatAgent
from camel.agents._types import ToolCallRequest
from camel.messages import BaseMessage
from camel.models import ModelProcessingError
from camel.responses import ChatAgentResponse
from camel.toolkits import FunctionTool
from camel.types.agents import ToolCallingRecord

from app.agent.listen_chat_agent import (
    ListenChatAgent,
    _reported_tool_error,
    _tool_failure_outcome_known,
    default_agent_stall_timeout,
    default_step_timeout,
)
from app.model.chat import Chat
from app.run_runtime.active_timeout import (
    pause_active_execution_timeout,
    refresh_active_execution_timeout,
)
from app.run_runtime.tool_checkpoint import (
    ToolCheckpointError,
    ToolInvocationNotDispatchedError,
    UnsafeToolOutcomeError,
)
from app.service.task import process_task

_LCA = "app.agent.listen_chat_agent"

pytestmark = pytest.mark.unit


def test_reported_tool_error_detects_adapter_error_mapping():
    error = _reported_tool_error({"error": "remote write failed"})

    assert isinstance(error, RuntimeError)
    assert str(error) == "remote write failed"
    assert _reported_tool_error({"result": "ok"}) is None


def test_wrapped_pre_dispatch_error_is_a_known_tool_outcome():
    try:
        raise ToolInvocationNotDispatchedError("workspace is leased")
    except ToolInvocationNotDispatchedError:
        try:
            # CAMEL FunctionTool currently wraps tool exceptions this way.
            raise ValueError("Execution of function shell_exec failed")
        except ValueError as wrapped:
            assert _tool_failure_outcome_known(
                wrapped,
                checkpoint_dispatched=True,
            )


def test_unrelated_post_dispatch_error_remains_outcome_unknown():
    assert not _tool_failure_outcome_known(
        TimeoutError("provider outcome unknown"),
        checkpoint_dispatched=True,
    )


def test_long_running_defaults_have_no_hard_cap_and_keep_stall_watchdog():
    def configured_value(name, default):
        assert name in {
            "AGENT_STEP_TIMEOUT_SECONDS",
            "AGENT_STALL_TIMEOUT_SECONDS",
        }
        return default

    with patch(
        "app.run_runtime.timeout_config.env",
        side_effect=configured_value,
    ):
        assert default_step_timeout() is None
        assert default_agent_stall_timeout() == 1800


@pytest.mark.asyncio
async def test_agent_step_timeout_excludes_durable_human_wait():
    agent = object.__new__(ListenChatAgent)
    agent.model_backend = MagicMock()
    agent.model_backend.model_config_dict = {"stream": False}
    agent.step_timeout = 0.02
    agent.stall_timeout = None
    response = MagicMock(spec=ChatAgentResponse)

    async def parent_step(_agent, _message, _response_format):
        async with pause_active_execution_timeout():
            await asyncio.sleep(0.04)
        return response

    with patch.object(
        ChatAgent,
        "_astep_non_streaming_task",
        new=parent_step,
    ):
        result = await agent._astep_with_active_timeout("wait for approval")

    assert result is response


@pytest.mark.asyncio
async def test_agent_stall_watchdog_renews_after_progress():
    agent = object.__new__(ListenChatAgent)
    agent.model_backend = MagicMock()
    agent.model_backend.model_config_dict = {"stream": False}
    agent.step_timeout = None
    agent.stall_timeout = 0.02
    response = MagicMock(spec=ChatAgentResponse)

    async def progressing_step(_agent, _message, _response_format):
        for _ in range(3):
            await asyncio.sleep(0.012)
            refresh_active_execution_timeout()
        return response

    with patch.object(
        ChatAgent,
        "_astep_non_streaming_task",
        new=progressing_step,
    ):
        result = await agent._astep_with_active_timeout("long task")

    assert result is response


@pytest.mark.asyncio
async def test_agent_stall_watchdog_cancels_no_progress():
    agent = object.__new__(ListenChatAgent)
    agent.model_backend = MagicMock()
    agent.model_backend.model_config_dict = {"stream": False}
    agent.step_timeout = None
    agent.stall_timeout = 0.01

    async def stalled_step(_agent, _message, _response_format):
        await asyncio.sleep(0.03)

    with (
        patch.object(
            ChatAgent,
            "_astep_non_streaming_task",
            new=stalled_step,
        ),
        pytest.raises(TimeoutError, match="made no progress"),
    ):
        await agent._astep_with_active_timeout("stalled task")


@pytest.mark.asyncio
async def test_streaming_agent_stall_watchdog_renews_on_chunks():
    agent = object.__new__(ListenChatAgent)
    agent.step_timeout = None
    agent.stall_timeout = 0.02
    agent._send_agent_deactivate = MagicMock()

    async def progressing_stream():
        for index in range(3):
            await asyncio.sleep(0.012)
            yield SimpleNamespace(
                msg=SimpleNamespace(content=str(index)),
                info={},
            )

    chunks = [
        chunk async for chunk in agent._astream_chunks(progressing_stream())
    ]

    assert [chunk.msg.content for chunk in chunks] == ["0", "1", "2"]


@pytest.mark.asyncio
async def test_streaming_agent_stall_watchdog_cancels_no_progress():
    agent = object.__new__(ListenChatAgent)
    agent.step_timeout = None
    agent.stall_timeout = 0.01
    agent._send_agent_deactivate = MagicMock()

    async def stalled_stream():
        await asyncio.sleep(0.03)
        yield SimpleNamespace(msg=SimpleNamespace(content="late"), info={})

    with pytest.raises(TimeoutError, match="made no progress"):
        async for _chunk in agent._astream_chunks(stalled_stream()):
            pass


def _malformed_tool_arguments_error() -> json.JSONDecodeError:
    return json.JSONDecodeError(
        "Expecting property name enclosed in double quotes",
        '{"path":"report.csv",\ncontent:"..."}',
        22,
    )


def test_sync_model_response_retries_malformed_json_with_error_feedback():
    agent = object.__new__(ListenChatAgent)
    agent.agent_name = "single_agent"
    original_messages = [{"role": "user", "content": "Create the report"}]
    response = MagicMock()

    with patch.object(
        ChatAgent,
        "_get_model_response",
        side_effect=[
            _malformed_tool_arguments_error(),
            _malformed_tool_arguments_error(),
            response,
        ],
    ) as parent:
        result = agent._get_model_response(
            original_messages,
            current_iteration=11,
            tool_schemas=[{"name": "write_file"}],
        )

    assert result is response
    assert parent.call_count == 3
    assert original_messages == [
        {"role": "user", "content": "Create the report"}
    ]
    for retry_index, call in enumerate(parent.call_args_list[1:], start=1):
        retry_messages = call.args[0]
        assert retry_messages[:-1] == original_messages
        feedback = retry_messages[-1]["content"]
        assert "Expecting property name enclosed in double quotes" in feedback
        assert "before any new tool call was executed" in feedback
        assert f"correction retry {retry_index} of 2" in feedback


@pytest.mark.asyncio
async def test_async_model_response_retries_malformed_json_twice():
    agent = object.__new__(ListenChatAgent)
    agent.agent_name = "single_agent"
    original_messages = [{"role": "user", "content": "Create the report"}]
    response = MagicMock()

    with patch.object(
        ChatAgent,
        "_aget_model_response",
        new=AsyncMock(
            side_effect=[
                _malformed_tool_arguments_error(),
                _malformed_tool_arguments_error(),
                response,
            ]
        ),
    ) as parent:
        result = await agent._aget_model_response(original_messages)

    assert result is response
    assert parent.await_count == 3
    assert original_messages == [
        {"role": "user", "content": "Create the report"}
    ]


@pytest.mark.asyncio
async def test_async_model_response_raises_after_two_correction_retries():
    agent = object.__new__(ListenChatAgent)
    agent.agent_name = "single_agent"
    errors = [_malformed_tool_arguments_error() for _ in range(3)]

    with patch.object(
        ChatAgent,
        "_aget_model_response",
        new=AsyncMock(side_effect=errors),
    ) as parent:
        with pytest.raises(json.JSONDecodeError) as raised:
            await agent._aget_model_response(
                [{"role": "user", "content": "Create the report"}]
            )

    assert raised.value is errors[-1]
    assert parent.await_count == 3


@pytest.mark.asyncio
async def test_async_model_response_does_not_retry_unrelated_errors():
    agent = object.__new__(ListenChatAgent)
    agent.agent_name = "single_agent"

    with patch.object(
        ChatAgent,
        "_aget_model_response",
        new=AsyncMock(side_effect=RuntimeError("provider unavailable")),
    ) as parent:
        with pytest.raises(RuntimeError, match="provider unavailable"):
            await agent._aget_model_response(
                [{"role": "user", "content": "Create the report"}]
            )

    assert parent.await_count == 1


def test_sync_tool_soft_error_is_recorded_as_known_failure_not_raised():
    def vendor_search():
        return {"error": "rate limited"}

    tool = FunctionTool(vendor_search)
    agent = object.__new__(ListenChatAgent)
    agent._internal_tools = {"vendor_search": tool}
    agent.api_task_id = "project-1"
    agent.agent_name = "searcher"
    agent.process_task_id = "process-1"
    agent.mask_tool_output = False
    agent._secure_result_store = {}
    agent._record_tool_calling = MagicMock(return_value="recorded")
    checkpoint = MagicMock()
    request = ToolCallRequest(
        tool_name="vendor_search",
        args={},
        tool_call_id="call-1",
    )

    with (
        patch(f"{_LCA}.get_task_lock", return_value=MagicMock()),
        patch(f"{_LCA}.prepare_tool_checkpoint", return_value=checkpoint),
        patch(f"{_LCA}.authorize_tool_checkpoint", new=AsyncMock()),
        patch(f"{_LCA}.dispatch_tool_checkpoint"),
        patch(f"{_LCA}.finish_tool_checkpoint") as finish,
        patch(f"{_LCA}._schedule_async_task"),
    ):
        assert agent._execute_tool(request) == "recorded"

    finish.assert_called_once()
    assert finish.call_args.kwargs["result"] == {"error": "rate limited"}
    assert isinstance(finish.call_args.kwargs["error"], RuntimeError)
    assert finish.call_args.kwargs["outcome_known"] is True


def test_sync_tool_pre_dispatch_marker_is_recorded_as_known_failure():
    def terminal_command():
        raise ToolInvocationNotDispatchedError("workspace is leased")

    tool = FunctionTool(terminal_command)
    agent = object.__new__(ListenChatAgent)
    agent._internal_tools = {"terminal_command": tool}
    agent.api_task_id = "project-1"
    agent.agent_name = "developer"
    agent.process_task_id = "process-1"
    agent.mask_tool_output = False
    agent._secure_result_store = {}
    agent._record_tool_calling = MagicMock(return_value="recorded")
    checkpoint = MagicMock()
    request = ToolCallRequest(
        tool_name="terminal_command",
        args={},
        tool_call_id="call-lease-conflict",
    )

    with (
        patch(f"{_LCA}.get_task_lock", return_value=MagicMock()),
        patch(f"{_LCA}.prepare_tool_checkpoint", return_value=checkpoint),
        patch(f"{_LCA}.authorize_tool_checkpoint", new=AsyncMock()),
        patch(f"{_LCA}.dispatch_tool_checkpoint"),
        patch(f"{_LCA}.finish_tool_checkpoint") as finish,
        patch(f"{_LCA}._schedule_async_task"),
    ):
        assert agent._execute_tool(request) == "recorded"

    finish.assert_called_once()
    # CAMEL intentionally wraps tool exceptions in ValueError. The marker is
    # retained as __context__, which is what the checkpoint outcome classifier
    # must inspect.
    assert isinstance(finish.call_args.kwargs["error"], ValueError)
    assert isinstance(
        finish.call_args.kwargs["error"].__context__,
        ToolInvocationNotDispatchedError,
    )
    assert finish.call_args.kwargs["outcome_known"] is True


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

    def test_listen_chat_agent_reloads_model_once_on_auth_error(
        self, mock_task_lock
    ):
        """Codex subscription agents can refresh and retry one 401."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        reload_callback = MagicMock()

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
        ):
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            reload_callback.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4",
                model_reload_callback=reload_callback,
            )
            agent.process_task_id = "test_process_task"

            mock_response = MagicMock(spec=ChatAgentResponse)
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Retried response"
            mock_response.info = {"usage": {"total_tokens": 42}}

            with patch.object(
                ChatAgent,
                "step",
                side_effect=[
                    ModelProcessingError("401 Unauthorized"),
                    mock_response,
                ],
            ) as mock_parent_step:
                result = agent.step("Test input message")

            assert result is mock_response
            assert mock_parent_step.call_count == 2
            reload_callback.assert_called_once()

    @pytest.mark.asyncio
    async def test_listen_chat_agent_async_reloads_model_once_on_auth_error(
        self, mock_task_lock
    ):
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        reload_callback = MagicMock()

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch("camel.models.ModelFactory.create") as mock_create_model,
        ):
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            reload_callback.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4",
                model_reload_callback=reload_callback,
            )
            agent.process_task_id = "test_process_task"

            mock_response = MagicMock()
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Retried async response"
            mock_response.info = {"usage": {"total_tokens": 43}}

            with patch.object(
                ChatAgent,
                "astep",
                new=AsyncMock(
                    side_effect=[
                        ModelProcessingError("401 Unauthorized"),
                        mock_response,
                    ]
                ),
            ) as mock_parent_astep:
                result = await agent.astep("Test async input")

            assert result is mock_response
            assert mock_parent_astep.call_count == 2
            reload_callback.assert_called_once()

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
            agent.model_backend.model_config_dict = {"stream": False}

            # Mock CAMEL's non-streaming task. ListenChatAgent owns the outer
            # pause-aware timeout so durable approval waits do not consume it.
            mock_response = MagicMock()
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Test response message"
            mock_response.info = {"usage": {"total_tokens": 100}}

            with patch.object(
                ChatAgent,
                "_astep_non_streaming_task",
                return_value=mock_response,
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
            patch(
                f"{_LCA}.prepare_tool_checkpoint",
                return_value=MagicMock(),
            ),
            patch(f"{_LCA}.authorize_tool_checkpoint", new=AsyncMock()),
            patch(f"{_LCA}.dispatch_tool_checkpoint"),
            patch(f"{_LCA}.finish_tool_checkpoint"),
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
            patch(
                f"{_LCA}.prepare_tool_checkpoint",
                return_value=MagicMock(),
            ),
            patch(f"{_LCA}.authorize_tool_checkpoint", new=AsyncMock()),
            patch(f"{_LCA}.dispatch_tool_checkpoint"),
            patch(f"{_LCA}.finish_tool_checkpoint"),
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

    @pytest.mark.asyncio
    async def test_streaming_tool_execution_preserves_process_task_context(
        self, mock_task_lock
    ):
        """Streaming tool calls should use the current follow-up task id."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        observed_process_task_ids: list[str] = []
        observed_thread_ids: list[int] = []
        owner_thread_id = threading.get_ident()

        class SyncTool:
            is_async = False

            def func(self):
                return None

            def __call__(self, **kwargs):
                observed_process_task_ids.append(process_task.get(""))
                observed_thread_ids.append(threading.get_ident())
                return f"ok:{kwargs['arg1']}"

        with (
            patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
            patch(
                f"{_LCA}.prepare_tool_checkpoint",
                return_value=MagicMock(),
            ),
            patch(f"{_LCA}.authorize_tool_checkpoint", new=AsyncMock()),
            patch(f"{_LCA}.dispatch_tool_checkpoint"),
            patch(f"{_LCA}.finish_tool_checkpoint"),
            patch("camel.models.ModelFactory.create") as mock_create_model,
        ):
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend

            agent = ListenChatAgent(
                api_task_id=api_task_id, agent_name=agent_name, model="gpt-4"
            )
            agent.process_task_id = "follow_up_task_123"
            agent._internal_tools = {"stream_tool": SyncTool()}

            result = await agent._aexecute_tool_from_stream_data(
                {
                    "id": "stream_tool_call_123",
                    "function": {
                        "name": "stream_tool",
                        "arguments": '{"arg1": "value1"}',
                    },
                }
            )

            assert result is not None
            assert result.tool_name == "stream_tool"
            assert result.result == "ok:value1"
            assert observed_process_task_ids == ["follow_up_task_123"]
            assert observed_thread_ids != [owner_thread_id]
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

    def test_clone_assigns_a_distinct_electron_target(self, mock_task_lock):
        from app.agent.factory.browser import _cdp_pool_manager

        task_id = "electron-clone-task"
        first_target = "about:blank#eigent-browser-toolkit=101"
        second_target = "about:blank#eigent-browser-toolkit=102"
        browsers = [
            {
                "port": 9222,
                "managedBy": "electron",
                "targetUrl": first_target,
            },
            {
                "port": 9222,
                "managedBy": "electron",
                "targetUrl": second_target,
            },
        ]
        _cdp_pool_manager.acquire_browser(browsers, "parent-session", task_id)

        try:
            with (
                patch(f"{_LCA}.get_task_lock", return_value=mock_task_lock),
                patch("camel.models.ModelFactory.create") as create_model,
            ):
                backend = MagicMock()
                backend.model_type = "gpt-4"
                backend.current_model = MagicMock()
                backend.current_model.model_type = "gpt-4"
                backend.models = "gpt-4"
                backend.scheduling_strategy = MagicMock()
                backend.scheduling_strategy.__name__ = "round_robin"
                create_model.return_value = backend

                agent = ListenChatAgent(
                    api_task_id="project-1",
                    agent_name="Browser Agent",
                    model="gpt-4",
                )
                agent._original_system_message = "browser system"
                agent.memory = MagicMock()
                agent.memory.window_size = 10
                agent.memory.get_context_creator.return_value.token_limit = (
                    4000
                )
                agent._external_tool_schemas = {}
                agent.response_terminators = []
                agent._cdp_acquire_callback = MagicMock()
                agent._cdp_release_callback = MagicMock()
                agent._cdp_options = SimpleNamespace(cdp_browsers=browsers)
                agent._cdp_task_id = task_id

                browser_config = SimpleNamespace(
                    cdp_url="http://127.0.0.1:9222"
                )
                toolkit = MagicMock()
                toolkit.config_loader.get_browser_config.return_value = (
                    browser_config
                )
                toolkit._owned_target_url = first_target
                toolkit._allow_owned_target_clone = False
                toolkit._ws_config = {"ownedTargetUrl": first_target}
                agent._browser_toolkit = toolkit

                observed: dict[str, object] = {}

                def clone_tools():
                    observed["owned_target_url"] = toolkit._owned_target_url
                    observed["allow_owned_target_clone"] = (
                        toolkit._allow_owned_target_clone
                    )
                    observed["ws_owned_target_url"] = toolkit._ws_config.get(
                        "ownedTargetUrl"
                    )
                    return [], []

                cloned_agent = MagicMock()
                with (
                    patch(
                        f"{_LCA}.ListenChatAgent",
                        return_value=cloned_agent,
                    ),
                    patch.object(
                        agent, "_clone_tools", side_effect=clone_tools
                    ),
                ):
                    assert agent.clone() is cloned_agent

                assert observed == {
                    "owned_target_url": second_target,
                    "allow_owned_target_clone": True,
                    "ws_owned_target_url": second_target,
                }
                assert toolkit._owned_target_url == first_target
                assert toolkit._allow_owned_target_clone is False
                assert toolkit._ws_config["ownedTargetUrl"] == first_target
                assert cloned_agent._cdp_session_id != "parent-session"
        finally:
            _cdp_pool_manager.release_by_task(task_id)

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


def _checkpoint_test_agent() -> ListenChatAgent:
    agent = object.__new__(ListenChatAgent)
    agent._internal_tools = {}
    agent._tool_checkpoint_error_lock = threading.Lock()
    agent._tool_checkpoint_error = None
    return agent


def test_unregistered_streamed_tool_fails_instead_of_completing_checkpoint():
    agent = _checkpoint_test_agent()

    with pytest.raises(ToolCheckpointError, match="not registered"):
        agent._execute_tool_from_stream_data(
            {
                "id": "call-1",
                "function": {"name": "unknown_write", "arguments": "{}"},
            }
        )


def test_sync_stream_propagates_checkpoint_error_swallowed_by_camel():
    agent = _checkpoint_test_agent()
    failure = UnsafeToolOutcomeError("external outcome unknown")

    def swallowed(parent, *_args, **_kwargs):
        parent._remember_tool_checkpoint_error(failure)
        return
        yield

    with patch.object(
        ChatAgent,
        "_execute_tools_sync_with_status_accumulator",
        new=swallowed,
    ):
        with pytest.raises(UnsafeToolOutcomeError, match="outcome unknown"):
            list(agent._execute_tools_sync_with_status_accumulator({}, []))


@pytest.mark.asyncio
async def test_async_stream_propagates_checkpoint_error_swallowed_by_camel():
    agent = _checkpoint_test_agent()
    failure = UnsafeToolOutcomeError("external outcome unknown")

    async def swallowed(parent, *_args, **_kwargs):
        parent._remember_tool_checkpoint_error(failure)
        return
        yield

    with patch.object(
        ChatAgent,
        "_execute_tools_async_with_status_accumulator",
        new=swallowed,
    ):
        with pytest.raises(UnsafeToolOutcomeError, match="outcome unknown"):
            async for _ in agent._execute_tools_async_with_status_accumulator(
                {}, MagicMock(), {}, []
            ):
                pass


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
