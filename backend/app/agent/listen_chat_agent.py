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
import logging
from collections.abc import Callable
from threading import Event
from typing import Any

from camel.agents import ChatAgent
from camel.agents._types import ToolCallRequest
from camel.agents.chat_agent import (
    AsyncStreamingChatAgentResponse,
    StreamingChatAgentResponse,
)
from camel.memories import AgentMemory
from camel.messages import BaseMessage
from camel.models import BaseModelBackend, ModelManager, ModelProcessingError
from camel.responses import ChatAgentResponse
from camel.terminators import ResponseTerminator
from camel.toolkits import FunctionTool, RegisteredAgentToolkit
from camel.types import ModelPlatformType, ModelType
from camel.types.agents import ToolCallingRecord
from pydantic import BaseModel

from app.service.task import (
    Action,
    ActionActivateAgentData,
    ActionActivateToolkitData,
    ActionBudgetNotEnough,
    ActionDeactivateAgentData,
    ActionDeactivateToolkitData,
    get_task_lock,
    set_process_task,
)
from app.utils.event_loop_utils import _schedule_async_task

# Logger for agent tracking
logger = logging.getLogger("agent")


class ListenChatAgent(ChatAgent):
    def __init__(
        self,
        api_task_id: str,
        agent_name: str,
        system_message: BaseMessage | str | None = None,
        model: (
            BaseModelBackend
            | ModelManager
            | tuple[str, str]
            | str
            | ModelType
            | tuple[ModelPlatformType, ModelType]
            | list[BaseModelBackend]
            | list[str]
            | list[ModelType]
            | list[tuple[str, str]]
            | list[tuple[ModelPlatformType, ModelType]]
            | None
        ) = None,
        memory: AgentMemory | None = None,
        message_window_size: int | None = None,
        token_limit: int | None = None,
        output_language: str | None = None,
        tools: list[FunctionTool | Callable[..., Any]] | None = None,
        toolkits_to_register_agent: list[RegisteredAgentToolkit] | None = None,
        external_tools: (
            list[FunctionTool | Callable[..., Any] | dict[str, Any]] | None
        ) = None,
        response_terminators: list[ResponseTerminator] | None = None,
        scheduling_strategy: str = "round_robin",
        max_iteration: int | None = None,
        agent_id: str | None = None,
        stop_event: Event | None = None,
        tool_execution_timeout: float | None = None,
        mask_tool_output: bool = False,
        pause_event: asyncio.Event | None = None,
        prune_tool_calls_from_memory: bool = False,
        enable_snapshot_clean: bool = False,
        step_timeout: float | None = 1800,  # 30 minutes
        **kwargs: Any,
    ) -> None:
        super().__init__(
            system_message=system_message,
            model=model,
            memory=memory,
            message_window_size=message_window_size,
            token_limit=token_limit,
            output_language=output_language,
            tools=tools,
            toolkits_to_register_agent=toolkits_to_register_agent,
            external_tools=external_tools,
            response_terminators=response_terminators,
            scheduling_strategy=scheduling_strategy,
            max_iteration=max_iteration,
            agent_id=agent_id,
            stop_event=stop_event,
            tool_execution_timeout=tool_execution_timeout,
            mask_tool_output=mask_tool_output,
            pause_event=pause_event,
            prune_tool_calls_from_memory=prune_tool_calls_from_memory,
            enable_snapshot_clean=enable_snapshot_clean,
            step_timeout=step_timeout,
            **kwargs,
        )
        self.api_task_id = api_task_id
        self.agent_name = agent_name

    process_task_id: str = ""

    def _send_agent_deactivate(self, message: str, tokens: int) -> None:
        """Send agent deactivation event to the frontend.

        Args:
            message: The accumulated message content
            tokens: The total token count used
        """
        task_lock = get_task_lock(self.api_task_id)
        _schedule_async_task(
            task_lock.put_queue(
                ActionDeactivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": message,
                        "tokens": tokens,
                    },
                )
            )
        )

    @staticmethod
    def _extract_tokens(response) -> int:
        """Extract total token count from a response chunk.

        Args:
            response: The response chunk (ChatAgentResponse or similar)

        Returns:
            Total token count or 0 if not available
        """
        if response is None:
            return 0
        usage_info = (
            response.info.get("usage")
            or response.info.get("token_usage")
            or {}
        )
        return usage_info.get("total_tokens", 0)

    def _stream_chunks(self, response_gen):
        """Generator that wraps a streaming response.

        Sends chunks to frontend.

        Args:
            response_gen: The original streaming response generator

        Yields:
            Each chunk from the original generator

        Returns:
            Tuple of (accumulated_content, total_tokens) via
            StopIteration value
        """
        accumulated_content = ""
        last_chunk = None

        try:
            for chunk in response_gen:
                last_chunk = chunk
                if chunk.msg and chunk.msg.content:
                    accumulated_content += chunk.msg.content
                yield chunk
        finally:
            total_tokens = self._extract_tokens(last_chunk)
            self._send_agent_deactivate(accumulated_content, total_tokens)

    async def _astream_chunks(self, response_gen):
        """Async generator that wraps a streaming response.

        Sends chunks to frontend.

        Args:
            response_gen: The original async streaming response generator

        Yields:
            Each chunk from the original generator
        """
        accumulated_content = ""
        last_chunk = None

        try:
            async for chunk in response_gen:
                last_chunk = chunk
                if chunk.msg and chunk.msg.content:
                    delta_content = chunk.msg.content
                    accumulated_content += delta_content
                yield chunk
        finally:
            total_tokens = self._extract_tokens(last_chunk)
            self._send_agent_deactivate(accumulated_content, total_tokens)

    def step(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | StreamingChatAgentResponse:
        task_lock = get_task_lock(self.api_task_id)
        _schedule_async_task(
            task_lock.put_queue(
                ActionActivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": (
                            input_message.content
                            if isinstance(input_message, BaseMessage)
                            else input_message
                        ),
                    },
                )
            )
        )
        error_info = None
        message = None
        res = None
        msg = (
            input_message.content
            if isinstance(input_message, BaseMessage)
            else input_message
        )
        logger.info(
            f"Agent {self.agent_name} starting step with message: {msg}"
        )
        try:
            res = super().step(input_message, response_format)
        except ModelProcessingError as e:
            res = None
            error_info = e
            if "Budget has been exceeded" in str(e):
                message = "Budget has been exceeded"
                logger.warning(f"Agent {self.agent_name} budget exceeded")
                _schedule_async_task(
                    task_lock.put_queue(ActionBudgetNotEnough())
                )
            else:
                message = str(e)
                logger.error(
                    f"Agent {self.agent_name} model processing error: {e}"
                )
            total_tokens = 0
        except Exception as e:
            res = None
            error_info = e
            logger.error(
                f"Agent {self.agent_name} unexpected error in step: {e}",
                exc_info=True,
            )
            message = f"Error processing message: {e!s}"
            total_tokens = 0

        if res is not None:
            if isinstance(res, StreamingChatAgentResponse):
                # Use reusable stream wrapper to send chunks to frontend
                return StreamingChatAgentResponse(self._stream_chunks(res))

            message = res.msg.content if res.msg else ""
            usage_info = (
                res.info.get("usage") or res.info.get("token_usage") or {}
            )
            total_tokens = (
                usage_info.get("total_tokens", 0) if usage_info else 0
            )
            logger.info(
                f"Agent {self.agent_name} completed step, "
                f"tokens used: {total_tokens}"
            )

        assert message is not None

        _schedule_async_task(
            task_lock.put_queue(
                ActionDeactivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": message,
                        "tokens": total_tokens,
                    },
                )
            )
        )

        if error_info is not None:
            raise error_info
        assert res is not None
        return res

    async def astep(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | AsyncStreamingChatAgentResponse:
        task_lock = get_task_lock(self.api_task_id)
        await task_lock.put_queue(
            ActionActivateAgentData(
                action=Action.activate_agent,
                data={
                    "agent_name": self.agent_name,
                    "process_task_id": self.process_task_id,
                    "agent_id": self.agent_id,
                    "message": (
                        input_message.content
                        if isinstance(input_message, BaseMessage)
                        else input_message
                    ),
                },
            )
        )

        error_info = None
        message = None
        res = None
        msg = (
            input_message.content
            if isinstance(input_message, BaseMessage)
            else input_message
        )
        logger.debug(
            f"Agent {self.agent_name} starting async step with message: {msg}"
        )

        try:
            res = await super().astep(input_message, response_format)
            if isinstance(res, AsyncStreamingChatAgentResponse):
                # Use reusable async stream wrapper to send chunks to frontend
                return AsyncStreamingChatAgentResponse(
                    self._astream_chunks(res)
                )
        except ModelProcessingError as e:
            res = None
            error_info = e
            if "Budget has been exceeded" in str(e):
                message = "Budget has been exceeded"
                logger.warning(f"Agent {self.agent_name} budget exceeded")
                asyncio.create_task(
                    task_lock.put_queue(ActionBudgetNotEnough())
                )
            else:
                message = str(e)
                logger.error(
                    f"Agent {self.agent_name} model processing error: {e}"
                )
            total_tokens = 0
        except Exception as e:
            res = None
            error_info = e
            logger.error(
                f"Agent {self.agent_name} unexpected error in async step: {e}",
                exc_info=True,
            )
            message = f"Error processing message: {e!s}"
            total_tokens = 0

        # For non-streaming responses, extract message and tokens from response
        if res is not None and not isinstance(
            res, AsyncStreamingChatAgentResponse
        ):
            message = res.msg.content if res.msg else ""
            usage_info = (
                res.info.get("usage") or res.info.get("token_usage") or {}
            )
            total_tokens = (
                usage_info.get("total_tokens", 0) if usage_info else 0
            )
            logger.info(
                f"Agent {self.agent_name} completed step, "
                f"tokens used: {total_tokens}"
            )

        # Send deactivation for all non-streaming cases (success or error)
        # Streaming responses handle deactivation in _astream_chunks
        assert message is not None

        asyncio.create_task(
            task_lock.put_queue(
                ActionDeactivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": message,
                        "tokens": total_tokens,
                    },
                )
            )
        )

        if error_info is not None:
            raise error_info
        assert res is not None
        return res

    def _execute_tool(
        self, tool_call_request: ToolCallRequest
    ) -> ToolCallingRecord:
        func_name = tool_call_request.tool_name
        tool: FunctionTool = self._internal_tools[func_name]
        # Route async functions to async execution
        # even if they have __wrapped__
        if asyncio.iscoroutinefunction(tool.func):
            # For async functions, we need to use the async execution path
            return asyncio.run(self._aexecute_tool(tool_call_request))

        # Handle all sync tools ourselves to maintain ContextVar context
        args = tool_call_request.args
        tool_call_id = tool_call_request.tool_call_id

        # Check if tool is wrapped by @listen_toolkit decorator
        # If so, the decorator will handle activate/deactivate events
        # TODO: Refactor - current marker detection is a workaround.
        # The proper fix is to unify event sending:
        # remove activate/deactivate from @listen_toolkit, only send here
        has_listen_decorator = getattr(tool.func, "__listen_toolkit__", False)

        try:
            task_lock = get_task_lock(self.api_task_id)

            toolkit_name = (
                tool._toolkit_name
                if hasattr(tool, "_toolkit_name")
                else "mcp_toolkit"
            )
            logger.debug(
                f"Agent {self.agent_name} executing tool: "
                f"{func_name} from toolkit: {toolkit_name} "
                f"with args: {json.dumps(args, ensure_ascii=False)}"
            )

            # Only send activate event if tool is
            # NOT wrapped by @listen_toolkit
            if not has_listen_decorator:
                _schedule_async_task(
                    task_lock.put_queue(
                        ActionActivateToolkitData(
                            data={
                                "agent_name": self.agent_name,
                                "process_task_id": self.process_task_id,
                                "toolkit_name": toolkit_name,
                                "method_name": func_name,
                                "message": json.dumps(
                                    args, ensure_ascii=False
                                ),
                            },
                        )
                    )
                )
            # Set process_task context for all tool executions
            with set_process_task(self.process_task_id):
                raw_result = tool(**args)
            logger.debug(f"Tool {func_name} executed successfully")
            if self.mask_tool_output:
                self._secure_result_store[tool_call_id] = raw_result
                result = (
                    "[The tool has been executed successfully, but the output"
                    " from the tool is masked. You can move forward]"
                )
                mask_flag = True
            else:
                result = raw_result
                mask_flag = False
            # Prepare result message with truncation
            if isinstance(result, str):
                result_msg = result
            else:
                result_str = repr(result)
                MAX_RESULT_LENGTH = 500
                if len(result_str) > MAX_RESULT_LENGTH:
                    result_msg = result_str[:MAX_RESULT_LENGTH] + (
                        f"... (truncated, total length: "
                        f"{len(result_str)} chars)"
                    )
                else:
                    result_msg = result_str

            # Only send deactivate event if tool is
            # NOT wrapped by @listen_toolkit
            if not has_listen_decorator:
                _schedule_async_task(
                    task_lock.put_queue(
                        ActionDeactivateToolkitData(
                            data={
                                "agent_name": self.agent_name,
                                "process_task_id": self.process_task_id,
                                "toolkit_name": toolkit_name,
                                "method_name": func_name,
                                "message": result_msg,
                            },
                        )
                    )
                )
        except Exception as e:
            # Capture the error message to prevent framework crash
            error_msg = f"Error executing tool '{func_name}': {e!s}"
            result = f"Tool execution failed: {error_msg}"
            mask_flag = False
            logger.error(
                f"Tool execution failed for {func_name}: {e}", exc_info=True
            )

        return self._record_tool_calling(
            func_name,
            args,
            result,
            tool_call_id,
            mask_output=mask_flag,
            extra_content=tool_call_request.extra_content,
        )

    async def _aexecute_tool(
        self, tool_call_request: ToolCallRequest
    ) -> ToolCallingRecord:
        func_name = tool_call_request.tool_name
        tool: FunctionTool = self._internal_tools[func_name]

        # Always handle tool execution ourselves to maintain ContextVar context
        args = tool_call_request.args
        tool_call_id = tool_call_request.tool_call_id
        task_lock = get_task_lock(self.api_task_id)

        # Try to get the real toolkit name
        toolkit_name = None

        # Method 1: Check _toolkit_name attribute
        if hasattr(tool, "_toolkit_name"):
            toolkit_name = tool._toolkit_name

        # Method 2: For MCP tools, check if func has __self__
        # (the toolkit instance)
        if (
            not toolkit_name
            and hasattr(tool, "func")
            and hasattr(tool.func, "__self__")
        ):
            toolkit_instance = tool.func.__self__
            if hasattr(toolkit_instance, "toolkit_name") and callable(
                toolkit_instance.toolkit_name
            ):
                toolkit_name = toolkit_instance.toolkit_name()

        # Method 3: Check if tool.func is a bound method with toolkit
        if not toolkit_name and hasattr(tool, "func"):
            if hasattr(tool.func, "func") and hasattr(
                tool.func.func, "__self__"
            ):
                toolkit_instance = tool.func.func.__self__
                if hasattr(toolkit_instance, "toolkit_name") and callable(
                    toolkit_instance.toolkit_name
                ):
                    toolkit_name = toolkit_instance.toolkit_name()

        # Default fallback
        if not toolkit_name:
            toolkit_name = "mcp_toolkit"

        logger.info(
            f"Agent {self.agent_name} executing async tool: {func_name} "
            f"from toolkit: {toolkit_name} "
            f"with args: {json.dumps(args, ensure_ascii=False)}"
        )

        # Check if tool is wrapped by @listen_toolkit decorator
        # If so, the decorator will handle activate/deactivate events
        has_listen_decorator = getattr(tool.func, "__listen_toolkit__", False)

        # Only send activate event if tool is NOT wrapped by @listen_toolkit
        if not has_listen_decorator:
            await task_lock.put_queue(
                ActionActivateToolkitData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": func_name,
                        "message": json.dumps(args, ensure_ascii=False),
                    },
                )
            )
        try:
            # Set process_task context for all tool executions
            with set_process_task(self.process_task_id):
                # Try different invocation paths in order of preference
                if hasattr(tool, "func") and hasattr(tool.func, "async_call"):
                    # MCP FunctionTool: always use async_call (sync wrapper can timeout)
                    result = await tool.func.async_call(**args)

                elif hasattr(tool, "async_call") and callable(tool.async_call):
                    # Case: tool itself has async_call
                    # Check if this is a sync tool to avoid run_in_executor
                    # (which breaks ContextVar)
                    if hasattr(tool, "is_async") and not tool.is_async:
                        # Sync tool: call directly to preserve ContextVar
                        # in same thread
                        result = tool(**args)
                        # Handle case where sync call returns a coroutine
                        if asyncio.iscoroutine(result):
                            result = await result
                    else:
                        # Async tool: use async_call
                        result = await tool.async_call(**args)

                elif hasattr(tool, "func") and asyncio.iscoroutinefunction(
                    tool.func
                ):
                    # Case: tool wraps a direct async function
                    result = await tool.func(**args)

                elif asyncio.iscoroutinefunction(tool):
                    # Case: tool is itself a coroutine function
                    result = await tool(**args)

                else:
                    # Fallback: sync call - call directly in current context
                    # DO NOT use run_in_executor to preserve ContextVar
                    result = tool(**args)
                    # Handle case where synchronous call returns a coroutine
                    if asyncio.iscoroutine(result):
                        result = await result

        except Exception as e:
            # Capture the error message to prevent framework crash
            error_msg = f"Error executing async tool '{func_name}': {e!s}"
            result = {"error": error_msg}
            logger.error(
                f"Async tool execution failed for {func_name}: {e}",
                exc_info=True,
            )

        # Prepare result message with truncation
        if isinstance(result, str):
            result_msg = result
        else:
            result_str = repr(result)
            MAX_RESULT_LENGTH = 500
            if len(result_str) > MAX_RESULT_LENGTH:
                result_msg = (
                    result_str[:MAX_RESULT_LENGTH]
                    + f"... (truncated, total length: {len(result_str)} chars)"
                )
            else:
                result_msg = result_str

        # Only send deactivate event if tool is NOT wrapped by @listen_toolkit
        if not has_listen_decorator:
            await task_lock.put_queue(
                ActionDeactivateToolkitData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": func_name,
                        "message": result_msg,
                    },
                )
            )
        return self._record_tool_calling(
            func_name,
            args,
            result,
            tool_call_id,
            extra_content=tool_call_request.extra_content,
        )

    def clone(self, with_memory: bool = False) -> ChatAgent:
        """Please see super.clone()"""
        system_message = None if with_memory else self._original_system_message

        # Clone tools and collect toolkits that need registration
        cloned_tools, toolkits_to_register = self._clone_tools()

        new_agent = ListenChatAgent(
            api_task_id=self.api_task_id,
            agent_name=self.agent_name,
            system_message=system_message,
            model=self.model_backend.models,  # Pass the existing model_backend
            memory=None,  # clone memory later
            message_window_size=getattr(self.memory, "window_size", None),
            token_limit=getattr(
                self.memory.get_context_creator(), "token_limit", None
            ),
            output_language=self._output_language,
            tools=cloned_tools,
            toolkits_to_register_agent=toolkits_to_register,
            external_tools=[
                schema for schema in self._external_tool_schemas.values()
            ],
            response_terminators=self.response_terminators,
            scheduling_strategy=self.model_backend.scheduling_strategy.__name__,
            max_iteration=self.max_iteration,
            stop_event=self.stop_event,
            tool_execution_timeout=self.tool_execution_timeout,
            mask_tool_output=self.mask_tool_output,
            pause_event=self.pause_event,
            prune_tool_calls_from_memory=self.prune_tool_calls_from_memory,
            enable_snapshot_clean=self._enable_snapshot_clean,
            step_timeout=self.step_timeout,
            stream_accumulate=self.stream_accumulate,
        )

        new_agent.process_task_id = self.process_task_id

        # Copy memory if requested
        if with_memory:
            # Get all records from the current memory
            context_records = self.memory.retrieve()
            # Write them to the new agent's memory
            for context_record in context_records:
                new_agent.memory.write_record(context_record.memory_record)

        return new_agent
