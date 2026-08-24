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
import inspect
import json
import logging
import threading
import uuid
from collections.abc import Callable
from contextlib import AsyncExitStack
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

from app.permission_policy import (
    ToolPermissionRejectedError,
    authorize_tool_checkpoint,
)
from app.run_runtime.active_timeout import (
    ActiveExecutionTimeout,
    refresh_active_execution_timeout,
)
from app.run_runtime.step_coordinator import step_scope
from app.run_runtime.timeout_config import (
    normalize_optional_timeout_seconds,
    optional_timeout_seconds_from_env,
)
from app.run_runtime.tool_checkpoint import (
    ToolCheckpointError,
    ToolInvocationNotDispatchedError,
    declared_tool_safety,
    dispatch_tool_checkpoint,
    finish_tool_checkpoint,
    prepare_tool_checkpoint,
    tool_checkpoint_scope,
)
from app.service.task import (
    Action,
    ActionActivateAgentData,
    ActionActivateToolkitData,
    ActionBudgetNotEnough,
    ActionDeactivateAgentData,
    ActionDeactivateToolkitData,
    ActionRequestUsageData,
    get_task_lock,
    get_task_lock_if_exists,
    set_process_task,
)
from app.utils.event_loop_utils import _schedule_async_task

# Logger for agent tracking
logger = logging.getLogger("agent")


# One CAMEL "step" contains the entire progressing model/tool loop. It must
# not impose a default total duration ceiling on a durable Run. A separate
# sliding stall watchdog still bounds execution that stops making progress.
_MALFORMED_MODEL_JSON_RETRIES = 2


def default_step_timeout() -> float | None:
    """Return the opt-in hard cap for a complete CAMEL step."""

    return optional_timeout_seconds_from_env("AGENT_STEP_TIMEOUT_SECONDS")


def default_agent_stall_timeout() -> float | None:
    """Return the sliding no-progress timeout for one Agent activity."""

    return optional_timeout_seconds_from_env(
        "AGENT_STALL_TIMEOUT_SECONDS",
        default=1800,
    )


def _reported_tool_error(result: Any) -> RuntimeError | None:
    """Turn a tool-level error result into a *known* journal failure.

    Some tool adapters deliberately return an error mapping instead of raising.
    The mapping proves the invocation returned normally, so it must not be
    escalated into an unknown external side effect even when the tool itself is
    conservatively classified as an unsafe write.
    """

    if isinstance(result, dict) and result.get("error"):
        return RuntimeError(str(result["error"]))
    return None


def _legacy_tool_call_identity(checkpoint: Any) -> dict[str, str]:
    """Attach correlation only when a real canonical id is available."""

    tool_call_id = getattr(checkpoint, "tool_call_id", None)
    if isinstance(tool_call_id, str) and tool_call_id:
        return {"tool_call_id": tool_call_id}
    return {}


def _tool_failure_outcome_known(
    error: BaseException,
    *,
    checkpoint_dispatched: bool,
) -> bool:
    """Return whether an exception proves the external action never started."""

    if not checkpoint_dispatched:
        return True

    pending: list[BaseException] = [error]
    visited: set[int] = set()
    while pending:
        current = pending.pop()
        identity = id(current)
        if identity in visited:
            continue
        visited.add(identity)
        if isinstance(current, ToolInvocationNotDispatchedError):
            return True
        for linked in (current.__cause__, current.__context__):
            if linked is not None:
                pending.append(linked)
    return False


class ListenChatAgent(ChatAgent):
    _cdp_clone_lock = (
        threading.Lock()
    )  # Protects CDP URL mutation during clone

    _camel_has_request_usage: bool = (
        "on_request_usage" in inspect.signature(ChatAgent.__init__).parameters
    )

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
        step_timeout: float | None = None,
        stall_timeout: float | None = None,
        model_reload_callback: (
            Callable[[], BaseModelBackend | ModelManager] | None
        ) = None,
        **kwargs: Any,
    ) -> None:
        self.api_task_id = api_task_id
        self.agent_name = agent_name
        self._user_on_request_usage = kwargs.pop("on_request_usage", None)
        if self._camel_has_request_usage:
            kwargs["on_request_usage"] = self._on_request_usage

        if step_timeout is None:
            step_timeout = default_step_timeout()
        else:
            step_timeout = normalize_optional_timeout_seconds(step_timeout)
        if stall_timeout is None:
            stall_timeout = default_agent_stall_timeout()
        else:
            stall_timeout = normalize_optional_timeout_seconds(stall_timeout)
        self.stall_timeout = stall_timeout
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
        self._tool_checkpoint_error_lock = threading.Lock()
        self._tool_checkpoint_error: ToolCheckpointError | None = None
        self._model_reload_callback = model_reload_callback
        self._model_reload_lock = threading.Lock()

    process_task_id: str = ""

    @staticmethod
    def _messages_with_model_json_error(
        openai_messages: list[Any],
        error: json.JSONDecodeError,
        *,
        retry_number: int,
    ) -> list[Any]:
        """Ask the model to regenerate only its rejected response.

        The correction is deliberately request-local: it is not written to
        Agent memory, and CAMEL has not recorded or dispatched the malformed
        tool call because parsing failed inside ``_get_model_response``.
        """

        return [
            *openai_messages,
            {
                "role": "user",
                "content": (
                    "Your previous response was rejected before any new "
                    "tool call was executed because its JSON arguments were "
                    f"invalid. Parser error: {error}. Regenerate the same "
                    "intended next response now. If you call a tool, follow "
                    "its schema exactly, use double-quoted JSON property "
                    "names, and do not repeat actions that were already "
                    f"completed. This is correction retry {retry_number} of "
                    f"{_MALFORMED_MODEL_JSON_RETRIES}."
                ),
            },
        ]

    def _get_model_response(
        self,
        openai_messages,
        current_iteration=0,
        response_format=None,
        tool_schemas=None,
        prev_num_openai_messages=0,
    ):
        """Retry a malformed model JSON response without replaying the step."""

        retry_messages = openai_messages
        for retry_number in range(_MALFORMED_MODEL_JSON_RETRIES + 1):
            try:
                response = super()._get_model_response(
                    retry_messages,
                    current_iteration=current_iteration,
                    response_format=response_format,
                    tool_schemas=tool_schemas,
                    prev_num_openai_messages=prev_num_openai_messages,
                )
                refresh_active_execution_timeout()
                return response
            except json.JSONDecodeError as error:
                refresh_active_execution_timeout()
                if retry_number >= _MALFORMED_MODEL_JSON_RETRIES:
                    raise
                next_retry = retry_number + 1
                logger.warning(
                    "Agent %s received malformed model JSON; retrying "
                    "current response (%s/%s): %s",
                    self.agent_name,
                    next_retry,
                    _MALFORMED_MODEL_JSON_RETRIES,
                    error,
                )
                retry_messages = self._messages_with_model_json_error(
                    openai_messages,
                    error,
                    retry_number=next_retry,
                )

        raise AssertionError("malformed model JSON retry loop exhausted")

    async def _aget_model_response(
        self,
        openai_messages,
        current_iteration=0,
        response_format=None,
        tool_schemas=None,
        prev_num_openai_messages=0,
    ):
        """Async variant of the bounded malformed-response retry."""

        retry_messages = openai_messages
        for retry_number in range(_MALFORMED_MODEL_JSON_RETRIES + 1):
            try:
                response = await super()._aget_model_response(
                    retry_messages,
                    current_iteration=current_iteration,
                    response_format=response_format,
                    tool_schemas=tool_schemas,
                    prev_num_openai_messages=prev_num_openai_messages,
                )
                refresh_active_execution_timeout()
                return response
            except json.JSONDecodeError as error:
                refresh_active_execution_timeout()
                if retry_number >= _MALFORMED_MODEL_JSON_RETRIES:
                    raise
                next_retry = retry_number + 1
                logger.warning(
                    "Agent %s received malformed model JSON; retrying "
                    "current response (%s/%s): %s",
                    self.agent_name,
                    next_retry,
                    _MALFORMED_MODEL_JSON_RETRIES,
                    error,
                )
                retry_messages = self._messages_with_model_json_error(
                    openai_messages,
                    error,
                    retry_number=next_retry,
                )

        raise AssertionError("malformed model JSON retry loop exhausted")

    async def _astep_with_active_timeout(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | AsyncStreamingChatAgentResponse:
        """Run CAMEL under opt-in hard and sliding no-progress guards.

        CAMEL's built-in non-streaming ``astep`` wraps the entire tool loop in
        one cumulative timeout. That is unsuitable for long-running Runs, so
        the cumulative guard defaults off while the stall guard is refreshed
        after each model response and tool completion. Durable human waits
        pause both guards. Streaming steps retain CAMEL's native path.
        """

        stream = self.model_backend.model_config_dict.get("stream", False)
        if stream:
            return await super().astep(input_message, response_format)
        if self.step_timeout is None and self.stall_timeout is None:
            return await super()._astep_non_streaming_task(
                input_message, response_format
            )
        hard_timeout: ActiveExecutionTimeout | None = None
        stall_timeout: ActiveExecutionTimeout | None = None
        try:
            async with AsyncExitStack() as stack:
                if self.step_timeout is not None:
                    hard_timeout = await stack.enter_async_context(
                        ActiveExecutionTimeout(self.step_timeout)
                    )
                if self.stall_timeout is not None:
                    stall_timeout = await stack.enter_async_context(
                        ActiveExecutionTimeout(
                            self.stall_timeout,
                            refresh_on_progress=True,
                        )
                    )
                return await super()._astep_non_streaming_task(
                    input_message, response_format
                )
        except TimeoutError as error:
            if hard_timeout is not None and hard_timeout.expired:
                raise TimeoutError(
                    f"Async step timed out after {self.step_timeout}s"
                ) from error
            if stall_timeout is not None and stall_timeout.expired:
                raise TimeoutError(
                    "Agent activity made no progress for "
                    f"{self.stall_timeout}s"
                ) from error
            raise

    def _reset_tool_checkpoint_error(self) -> None:
        with self._tool_checkpoint_error_lock:
            self._tool_checkpoint_error = None

    def _remember_tool_checkpoint_error(
        self, error: ToolCheckpointError
    ) -> None:
        with self._tool_checkpoint_error_lock:
            if self._tool_checkpoint_error is None:
                self._tool_checkpoint_error = error

    def _consume_tool_checkpoint_error(self) -> ToolCheckpointError | None:
        with self._tool_checkpoint_error_lock:
            error = self._tool_checkpoint_error
            self._tool_checkpoint_error = None
            return error

    def _execute_tools_sync_with_status_accumulator(self, *args, **kwargs):
        """Restore fail-closed semantics after CAMEL logs worker errors."""

        self._reset_tool_checkpoint_error()
        try:
            yield from super()._execute_tools_sync_with_status_accumulator(
                *args, **kwargs
            )
        finally:
            error = self._consume_tool_checkpoint_error()
            if error is not None:
                raise error

    async def _execute_tools_async_with_status_accumulator(
        self, *args, **kwargs
    ):
        """Restore fail-closed semantics after CAMEL logs task errors."""

        self._reset_tool_checkpoint_error()
        try:
            async for (
                item
            ) in super()._execute_tools_async_with_status_accumulator(
                *args, **kwargs
            ):
                yield item
        finally:
            error = self._consume_tool_checkpoint_error()
            if error is not None:
                raise error

    def _on_request_usage(self, payload: dict[str, Any]) -> Any:
        request_usage = payload.get("request_usage") or {}
        step_usage = payload.get("step_usage") or {}
        request_tokens = int(request_usage.get("total_tokens") or 0)
        # Lock may be gone if the task was stopped mid-request.
        task_lock = get_task_lock_if_exists(self.api_task_id)
        if request_tokens > 0 and task_lock is not None:
            _schedule_async_task(
                task_lock.put_queue(
                    ActionRequestUsageData(
                        data={
                            "agent_name": self.agent_name,
                            "process_task_id": self.process_task_id,
                            "agent_id": self.agent_id,
                            "tokens": request_tokens,
                            "request_index": payload.get("request_index", 0),
                            "response_id": payload.get("response_id", ""),
                            "step_total_tokens": int(
                                step_usage.get("total_tokens") or 0
                            ),
                        }
                    )
                )
            )
        if self._user_on_request_usage is not None:
            return self._user_on_request_usage(payload)
        return None

    @staticmethod
    def _is_retryable_model_auth_error(error: BaseException) -> bool:
        error_text = str(error).lower()
        return any(
            marker in error_text
            for marker in (
                "401",
                "unauthorized",
                "invalid_api_key",
                "invalid api key",
                "authentication error",
                "authenticationerror",
                "token_expired",
            )
        )

    def _reload_model_after_auth_error(self, error: BaseException) -> bool:
        if (
            self._model_reload_callback is None
            or not self._is_retryable_model_auth_error(error)
        ):
            return False

        try:
            with self._model_reload_lock:
                logger.info(
                    f"Agent {self.agent_name} refreshing model after "
                    "subscription auth error"
                )
                model = self._model_reload_callback()
                self.model_backend = (
                    model
                    if isinstance(model, ModelManager)
                    else ModelManager(
                        model,
                        scheduling_strategy=self.model_backend.scheduling_strategy.__name__,
                    )
                )
                self.model_type = self.model_backend.model_type
            return True
        except Exception as reload_error:
            logger.warning(
                f"Agent {self.agent_name} failed to refresh model after "
                f"auth error: {reload_error}"
            )
            return False

    async def _areload_model_after_auth_error(
        self, error: BaseException
    ) -> bool:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._reload_model_after_auth_error, error
        )

    def _send_agent_deactivate(
        self,
        message: str,
        tokens: int,
        agent_turn_id: str,
        *,
        status: str = "completed",
    ) -> None:
        """Send agent deactivation event to the frontend.

        Args:
            message: The accumulated message content
            tokens: The total token count used
        """
        if self._camel_has_request_usage:
            tokens = 0
        # A missing lock (task stopped mid-step) must not fail the step.
        task_lock = get_task_lock_if_exists(self.api_task_id)
        if task_lock is None:
            logger.warning(
                "Task lock %s missing; dropping deactivate event for %s",
                self.api_task_id,
                self.agent_name,
            )
            return
        _schedule_async_task(
            task_lock.put_queue(
                ActionDeactivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "agent_turn_id": agent_turn_id,
                        "message": message,
                        "status": status,
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

    def _stream_chunks(
        self,
        response_gen,
        agent_turn_id: str | None = None,
        input_message: BaseMessage | str | None = None,
        response_format: type[BaseModel] | None = None,
        auth_retry_available: bool = True,
    ):
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
        agent_turn_id = agent_turn_id or f"agent-turn:{uuid.uuid4().hex}"
        accumulated_content = ""
        last_chunk = None
        terminal_status = "failed"

        try:
            try:
                for chunk in response_gen:
                    last_chunk = chunk
                    if chunk.msg and chunk.msg.content:
                        accumulated_content += chunk.msg.content
                    yield chunk
            except ModelProcessingError as error:
                can_retry = (
                    auth_retry_available
                    and input_message is not None
                    and not accumulated_content
                    and self._reload_model_after_auth_error(error)
                )
                if not can_retry:
                    raise

                retry_response = ChatAgent.step(
                    self, input_message, response_format
                )
                if isinstance(retry_response, StreamingChatAgentResponse):
                    for chunk in retry_response:
                        last_chunk = chunk
                        if chunk.msg and chunk.msg.content:
                            accumulated_content += chunk.msg.content
                        yield chunk
                else:
                    last_chunk = retry_response
                    if retry_response.msg and retry_response.msg.content:
                        accumulated_content += retry_response.msg.content
                    yield retry_response
            terminal_status = "completed"
        except GeneratorExit:
            terminal_status = "cancelled"
            raise
        finally:
            total_tokens = self._extract_tokens(last_chunk)
            self._send_agent_deactivate(
                accumulated_content,
                total_tokens,
                agent_turn_id,
                status=terminal_status,
            )

    async def _astream_chunks(
        self,
        response_gen,
        agent_turn_id: str | None = None,
        input_message: BaseMessage | str | None = None,
        response_format: type[BaseModel] | None = None,
        auth_retry_available: bool = True,
    ):
        """Async generator that wraps a streaming response.

        Sends chunks to frontend.

        Args:
            response_gen: The original async streaming response generator

        Yields:
            Each chunk from the original generator
        """
        agent_turn_id = agent_turn_id or f"agent-turn:{uuid.uuid4().hex}"
        accumulated_content = ""
        last_chunk = None
        terminal_status = "failed"
        hard_timeout: ActiveExecutionTimeout | None = None
        stall_timeout: ActiveExecutionTimeout | None = None

        try:
            async with AsyncExitStack() as stack:
                if self.step_timeout is not None:
                    hard_timeout = await stack.enter_async_context(
                        ActiveExecutionTimeout(self.step_timeout)
                    )
                if self.stall_timeout is not None:
                    stall_timeout = await stack.enter_async_context(
                        ActiveExecutionTimeout(
                            self.stall_timeout,
                            refresh_on_progress=True,
                        )
                    )
                try:
                    async for chunk in response_gen:
                        last_chunk = chunk
                        if chunk.msg and chunk.msg.content:
                            delta_content = chunk.msg.content
                            accumulated_content += delta_content
                        refresh_active_execution_timeout()
                        yield chunk
                except ModelProcessingError as error:
                    can_retry = (
                        auth_retry_available
                        and input_message is not None
                        and not accumulated_content
                        and await self._areload_model_after_auth_error(error)
                    )
                    if not can_retry:
                        raise

                    retry_response = await ChatAgent.astep(
                        self, input_message, response_format
                    )
                    if isinstance(
                        retry_response, AsyncStreamingChatAgentResponse
                    ):
                        async for chunk in retry_response:
                            last_chunk = chunk
                            if chunk.msg and chunk.msg.content:
                                delta_content = chunk.msg.content
                                accumulated_content += delta_content
                            refresh_active_execution_timeout()
                            yield chunk
                    else:
                        last_chunk = retry_response
                        if retry_response.msg and retry_response.msg.content:
                            accumulated_content += retry_response.msg.content
                        refresh_active_execution_timeout()
                        yield retry_response
                terminal_status = "completed"
        except asyncio.CancelledError:
            terminal_status = "cancelled"
            raise
        except TimeoutError as error:
            if hard_timeout is not None and hard_timeout.expired:
                raise TimeoutError(
                    f"Streaming step timed out after {self.step_timeout}s"
                ) from error
            if stall_timeout is not None and stall_timeout.expired:
                raise TimeoutError(
                    "Streaming Agent activity made no progress for "
                    f"{self.stall_timeout}s"
                ) from error
            raise
        finally:
            total_tokens = self._extract_tokens(last_chunk)
            self._send_agent_deactivate(
                accumulated_content,
                total_tokens,
                agent_turn_id,
                status=terminal_status,
            )

    def step(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | StreamingChatAgentResponse:
        task_lock = get_task_lock(self.api_task_id)
        agent_turn_id = f"agent-turn:{uuid.uuid4().hex}"
        _schedule_async_task(
            task_lock.put_queue(
                ActionActivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "agent_turn_id": agent_turn_id,
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
        auth_retried = False

        try:
            res = super().step(input_message, response_format)
        except ModelProcessingError as e:
            if self._reload_model_after_auth_error(e):
                auth_retried = True
                try:
                    res = super().step(input_message, response_format)
                except ModelProcessingError as retry_error:
                    e = retry_error

            if res is not None:
                error_info = None
            else:
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
                return StreamingChatAgentResponse(
                    self._stream_chunks(
                        res,
                        agent_turn_id,
                        input_message,
                        response_format,
                        auth_retry_available=not auth_retried,
                    )
                )

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

        self._send_agent_deactivate(
            message,
            total_tokens,
            agent_turn_id,
            status="failed" if error_info is not None else "completed",
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
        agent_turn_id = f"agent-turn:{uuid.uuid4().hex}"
        await task_lock.put_queue(
            ActionActivateAgentData(
                action=Action.activate_agent,
                data={
                    "agent_name": self.agent_name,
                    "process_task_id": self.process_task_id,
                    "agent_id": self.agent_id,
                    "agent_turn_id": agent_turn_id,
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
            res = await self._astep_with_active_timeout(
                input_message, response_format
            )
            if isinstance(res, AsyncStreamingChatAgentResponse):
                # Use reusable async stream wrapper to send chunks to frontend
                return AsyncStreamingChatAgentResponse(
                    self._astream_chunks(
                        res,
                        agent_turn_id,
                        input_message,
                        response_format,
                        auth_retry_available=True,
                    )
                )
        except ModelProcessingError as e:
            if await self._areload_model_after_auth_error(e):
                try:
                    res = await self._astep_with_active_timeout(
                        input_message, response_format
                    )
                    if isinstance(res, AsyncStreamingChatAgentResponse):
                        return AsyncStreamingChatAgentResponse(
                            self._astream_chunks(
                                res,
                                agent_turn_id,
                                input_message,
                                response_format,
                                auth_retry_available=False,
                            )
                        )
                except ModelProcessingError as retry_error:
                    e = retry_error

            if res is not None:
                error_info = None
            else:
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

        self._send_agent_deactivate(
            message,
            total_tokens,
            agent_turn_id,
            status="failed" if error_info is not None else "completed",
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
        checkpoint = None
        dispatched = False

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
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id=tool_call_id,
                tool_name=func_name,
                arguments=args,
                declared_safety=declared_tool_safety(
                    tool,
                    func_name,
                    args,
                ),
                dispatch_immediately=False,
                toolkit_name=toolkit_name,
                agent_name=self.agent_name,
                task_id=self.process_task_id,
            )
            asyncio.run(
                authorize_tool_checkpoint(
                    checkpoint,
                    arguments=args,
                    toolkit_name=toolkit_name,
                    agent_name=self.agent_name,
                    task_lock=task_lock,
                )
            )
            dispatch_tool_checkpoint(checkpoint)
            dispatched = True

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
                                **_legacy_tool_call_identity(checkpoint),
                            },
                        )
                    )
                )
            # Set process_task context for all tool executions
            with (
                set_process_task(self.process_task_id),
                tool_checkpoint_scope(checkpoint),
                step_scope(checkpoint.step_id),
            ):
                raw_result = tool(**args)
            reported_error = _reported_tool_error(raw_result)
            if reported_error is None:
                finish_tool_checkpoint(checkpoint, result=raw_result)
            else:
                finish_tool_checkpoint(
                    checkpoint,
                    result=raw_result,
                    error=reported_error,
                    outcome_known=True,
                )
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
                                **_legacy_tool_call_identity(checkpoint),
                            },
                        )
                    )
                )
        except ToolPermissionRejectedError as error:
            finish_tool_checkpoint(
                checkpoint,
                result={"error": str(error), "permission_denied": True},
                error=error,
                outcome_known=True,
            )
            result = {"error": str(error), "permission_denied": True}
            mask_flag = False
        except ToolCheckpointError:
            raise
        except Exception as e:
            finish_tool_checkpoint(
                checkpoint,
                error=e,
                outcome_known=_tool_failure_outcome_known(
                    e,
                    checkpoint_dispatched=dispatched,
                ),
            )
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

    def _tool_call_request_from_stream_data(
        self, tool_call_data: dict[str, Any]
    ) -> ToolCallRequest:
        function_data = tool_call_data.get("function") or {}
        raw_args = function_data.get("arguments") or "{}"
        if isinstance(raw_args, str):
            args = json.loads(raw_args)
        elif isinstance(raw_args, dict):
            args = raw_args
        else:
            args = {"arguments": raw_args}

        if not isinstance(args, dict):
            args = {"arguments": args}

        return ToolCallRequest(
            tool_name=function_data.get("name", ""),
            args=args,
            tool_call_id=tool_call_data.get("id")
            or tool_call_data.get("call_id", ""),
            extra_content=tool_call_data.get("extra_content"),
        )

    def _execute_tool_from_stream_data(
        self, tool_call_data: dict[str, Any]
    ) -> ToolCallingRecord | None:
        try:
            tool_call_request = self._tool_call_request_from_stream_data(
                tool_call_data
            )
            if tool_call_request.tool_name not in self._internal_tools:
                raise ToolCheckpointError(
                    f"streamed tool {tool_call_request.tool_name!r} is not registered"
                )
            return self._execute_tool(tool_call_request)
        except ToolCheckpointError as error:
            self._remember_tool_checkpoint_error(error)
            raise
        except Exception as e:
            logger.error(f"Error processing streaming tool call: {e}")
            return None

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

        checkpoint = await asyncio.to_thread(
            prepare_tool_checkpoint,
            raw_tool_call_id=tool_call_id,
            tool_name=func_name,
            arguments=args,
            declared_safety=declared_tool_safety(
                tool,
                func_name,
                args,
            ),
            dispatch_immediately=False,
            toolkit_name=toolkit_name,
            agent_name=self.agent_name,
            task_id=self.process_task_id,
        )

        execution_error: Exception | None = None
        dispatched = False
        try:
            await authorize_tool_checkpoint(
                checkpoint,
                arguments=args,
                toolkit_name=toolkit_name,
                agent_name=self.agent_name,
                task_lock=task_lock,
            )
            await asyncio.to_thread(dispatch_tool_checkpoint, checkpoint)
            dispatched = True
            # Activation is an execution projection. Do not publish it before
            # the durable permission gate authorizes and dispatches the tool.
            if not has_listen_decorator:
                await task_lock.put_queue(
                    ActionActivateToolkitData(
                        data={
                            "agent_name": self.agent_name,
                            "process_task_id": self.process_task_id,
                            "toolkit_name": toolkit_name,
                            "method_name": func_name,
                            "message": json.dumps(args, ensure_ascii=False),
                            **_legacy_tool_call_identity(checkpoint),
                        },
                    )
                )
            # Set process_task context for all tool executions
            with (
                set_process_task(self.process_task_id),
                tool_checkpoint_scope(checkpoint),
                step_scope(checkpoint.step_id),
            ):
                # Try different invocation paths in order of preference
                if hasattr(tool, "func") and hasattr(tool.func, "async_call"):
                    # MCP FunctionTool: always use async_call (sync wrapper can timeout)
                    result = await tool.func.async_call(**args)

                elif hasattr(tool, "async_call") and callable(tool.async_call):
                    # Case: tool itself has async_call
                    # Sync tool execution must not block the owner event loop.
                    # asyncio.to_thread copies the current Context, preserving
                    # the Run/tool checkpoints needed by child-agent tool
                    # callbacks while the queue consumer stays responsive.
                    if hasattr(tool, "is_async") and not tool.is_async:
                        result = await asyncio.to_thread(tool, **args)
                        # Handle case where sync call returns a coroutine
                        if inspect.isawaitable(result):
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
                    # Fallback sync call. to_thread propagates ContextVars and
                    # prevents a blocking AgentToolkit wait from starving
                    # approvals, timeline events, and child progress updates.
                    result = await asyncio.to_thread(tool, **args)
                    # Handle case where synchronous call returns a coroutine
                    if inspect.isawaitable(result):
                        result = await result

        except asyncio.CancelledError as error:
            await asyncio.to_thread(
                finish_tool_checkpoint,
                checkpoint,
                error=TimeoutError("tool execution cancelled or timed out"),
                outcome_known=not dispatched,
            )
            raise error
        except ToolPermissionRejectedError as error:
            execution_error = error
            result = {"error": str(error), "permission_denied": True}
            await asyncio.to_thread(
                finish_tool_checkpoint,
                checkpoint,
                result=result,
                error=error,
                outcome_known=True,
            )
        except Exception as e:
            execution_error = e
            await asyncio.to_thread(
                finish_tool_checkpoint,
                checkpoint,
                error=e,
                outcome_known=_tool_failure_outcome_known(
                    e,
                    checkpoint_dispatched=dispatched,
                ),
            )
            # Capture the error message to prevent framework crash
            error_msg = f"Error executing async tool '{func_name}': {e!s}"
            result = {"error": error_msg}
            logger.error(
                f"Async tool execution failed for {func_name}: {e}",
                exc_info=True,
            )

        if execution_error is None:
            reported_error = _reported_tool_error(result)
            if reported_error is None:
                await asyncio.to_thread(
                    finish_tool_checkpoint,
                    checkpoint,
                    result=result,
                )
            else:
                await asyncio.to_thread(
                    finish_tool_checkpoint,
                    checkpoint,
                    result=result,
                    error=reported_error,
                    outcome_known=True,
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
                        **_legacy_tool_call_identity(checkpoint),
                    },
                )
            )
        refresh_active_execution_timeout()
        return self._record_tool_calling(
            func_name,
            args,
            result,
            tool_call_id,
            extra_content=tool_call_request.extra_content,
        )

    async def _aexecute_tool_from_stream_data(
        self, tool_call_data: dict[str, Any]
    ) -> ToolCallingRecord | None:
        try:
            tool_call_request = self._tool_call_request_from_stream_data(
                tool_call_data
            )
            if tool_call_request.tool_name not in self._internal_tools:
                raise ToolCheckpointError(
                    f"streamed tool {tool_call_request.tool_name!r} is not registered"
                )
            return await self._aexecute_tool(tool_call_request)
        except ToolCheckpointError as error:
            self._remember_tool_checkpoint_error(error)
            raise
        except Exception as e:
            logger.error(f"Error processing async streaming tool call: {e}")
            return None

    def clone(self, with_memory: bool = False) -> ChatAgent:
        """Please see super.clone()"""
        system_message = None if with_memory else self._original_system_message

        # If this agent has CDP acquire callback, acquire CDP BEFORE cloning
        # tools so that HybridBrowserToolkit clones with the correct CDP port
        new_cdp_port = None
        new_cdp_url = None
        new_owned_target_url = None
        new_cdp_session = None
        has_cdp = hasattr(self, "_cdp_acquire_callback") and callable(
            getattr(self, "_cdp_acquire_callback", None)
        )

        need_cdp_clone = False
        if has_cdp and hasattr(self, "_cdp_options"):
            options = self._cdp_options
            cdp_browsers = getattr(options, "cdp_browsers", [])
            if cdp_browsers and getattr(self, "_browser_toolkit", None):
                need_cdp_clone = True
                import uuid as _uuid

                from app.agent.factory.browser import _cdp_pool_manager

                new_cdp_session = str(_uuid.uuid4())[:8]
                selected = _cdp_pool_manager.acquire_browser(
                    cdp_browsers,
                    new_cdp_session,
                    getattr(self, "_cdp_task_id", None),
                )
                from app.agent.factory.browser import (
                    _get_browser_endpoint,
                    _get_browser_port,
                )

                if selected:
                    new_cdp_port = _get_browser_port(selected)
                    new_cdp_url = _get_browser_endpoint(selected)
                    new_owned_target_url = selected.get("targetUrl")
                else:
                    if any(
                        browser.get("managedBy") == "electron"
                        for browser in cdp_browsers
                    ):
                        raise RuntimeError(
                            "No unused Eigent embedded browser target is "
                            "available for the cloned Agent."
                        )
                    fallback_browser = cdp_browsers[0]
                    new_cdp_port = _get_browser_port(fallback_browser)
                    new_cdp_url = _get_browser_endpoint(fallback_browser)

        if need_cdp_clone:
            # Temporarily override the browser toolkit's CDP URL.
            # Lock prevents concurrent clones from clobbering each
            # other's cdp_url on the shared parent toolkit.
            toolkit = self._browser_toolkit
            with ListenChatAgent._cdp_clone_lock:
                original_cdp_url = (
                    toolkit.config_loader.get_browser_config().cdp_url
                )
                original_owned_target_url = getattr(
                    toolkit, "_owned_target_url", None
                )
                original_allow_owned_target_clone = getattr(
                    toolkit, "_allow_owned_target_clone", False
                )
                original_ws_owned_target_url = toolkit._ws_config.get(
                    "ownedTargetUrl"
                )
                toolkit.config_loader.get_browser_config().cdp_url = (
                    new_cdp_url
                )
                toolkit._owned_target_url = new_owned_target_url
                toolkit._allow_owned_target_clone = bool(new_owned_target_url)
                if new_owned_target_url:
                    toolkit._ws_config["ownedTargetUrl"] = new_owned_target_url
                else:
                    toolkit._ws_config.pop("ownedTargetUrl", None)
                try:
                    cloned_tools, toolkits_to_register = self._clone_tools()
                except Exception:
                    _cdp_pool_manager.release_browser(
                        new_cdp_port, new_cdp_session
                    )
                    raise
                finally:
                    toolkit.config_loader.get_browser_config().cdp_url = (
                        original_cdp_url
                    )
                    toolkit._owned_target_url = original_owned_target_url
                    toolkit._allow_owned_target_clone = (
                        original_allow_owned_target_clone
                    )
                    if original_ws_owned_target_url:
                        toolkit._ws_config["ownedTargetUrl"] = (
                            original_ws_owned_target_url
                        )
                    else:
                        toolkit._ws_config.pop("ownedTargetUrl", None)
        else:
            cloned_tools, toolkits_to_register = self._clone_tools()

        clone_kwargs: dict[str, Any] = {}
        if self._user_on_request_usage is not None:
            clone_kwargs["on_request_usage"] = self._user_on_request_usage

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
            stall_timeout=self.stall_timeout,
            stream_accumulate=self.stream_accumulate,
            **clone_kwargs,
        )

        new_agent.process_task_id = self.process_task_id

        # Copy CDP management data to cloned agent
        if has_cdp:
            new_agent._cdp_acquire_callback = self._cdp_acquire_callback
            new_agent._cdp_release_callback = self._cdp_release_callback
            if hasattr(self, "_cdp_options"):
                new_agent._cdp_options = self._cdp_options
            if hasattr(self, "_cdp_task_id"):
                new_agent._cdp_task_id = self._cdp_task_id

            # Find and store the cloned browser toolkit on the new agent
            for tk in toolkits_to_register:
                if tk.__class__.__name__ == "HybridBrowserToolkit":
                    new_agent._browser_toolkit = tk
                    break

            # Set CDP info on cloned agent
            if new_cdp_port is not None and new_cdp_session is not None:
                new_agent._cdp_port = new_cdp_port
                new_agent._cdp_url = new_cdp_url
                new_agent._cdp_session_id = new_cdp_session
            else:
                if hasattr(self, "_cdp_port"):
                    new_agent._cdp_port = self._cdp_port
                if hasattr(self, "_cdp_url"):
                    new_agent._cdp_url = self._cdp_url
                if hasattr(self, "_cdp_session_id"):
                    new_agent._cdp_session_id = self._cdp_session_id

        # Copy memory if requested
        if with_memory:
            # Get all records from the current memory
            context_records = self.memory.retrieve()
            # Write them to the new agent's memory
            for context_record in context_records:
                new_agent.memory.write_record(context_record.memory_record)

        return new_agent
