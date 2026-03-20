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
import logging
import threading
from collections.abc import Callable
from threading import Event
from typing import Any

from camel.agents import ChatAgent, CloneContext
from camel.agents.chat_agent import (
    AsyncStreamingChatAgentResponse,
    StreamingChatAgentResponse,
)
from camel.memories import AgentMemory
from camel.messages import BaseMessage
from camel.models import BaseModelBackend, ModelManager
from camel.responses import ChatAgentResponse
from camel.terminators import ResponseTerminator
from camel.toolkits import FunctionTool, RegisteredAgentToolkit
from camel.types import ModelPlatformType, ModelType
from pydantic import BaseModel

from app.agent.listen_chat_agent_callback import ListenChatAgentCallback
from app.service.task import get_task_lock, set_process_task

# Logger for agent tracking
logger = logging.getLogger("agent")


class ListenChatAgent(ChatAgent):
    _cdp_clone_lock = (
        threading.Lock()
    )  # Protects CDP URL mutation during clone

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
        self.api_task_id = api_task_id
        self.agent_name = agent_name
        self.process_task_id = ""

        self._user_callbacks = list(kwargs.pop("callbacks", []) or [])
        self._user_execution_context = dict(
            kwargs.pop("execution_context", {}) or {}
        )
        self._user_execution_context_provider = kwargs.pop(
            "execution_context_provider", None
        )
        self._listen_callback = ListenChatAgentCallback(self)

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
            callbacks=[
                *self._user_callbacks,
                self._listen_callback,
            ],
            execution_context={
                **self._build_static_execution_context(),
                **self._user_execution_context,
            },
            execution_context_provider=self._build_dynamic_execution_context,
            **kwargs,
        )

    def _build_static_execution_context(self) -> dict[str, Any]:
        return {
            "api_task_id": self.api_task_id,
            "agent_name": self.agent_name,
        }

    def _build_dynamic_execution_context(self) -> dict[str, Any] | None:
        execution_context: dict[str, Any] = {}
        if self._user_execution_context_provider is not None:
            provided_context = self._user_execution_context_provider()
            if provided_context:
                execution_context.update(provided_context)
        if self.process_task_id:
            execution_context["process_task_id"] = self.process_task_id
        if getattr(self, "agent_id", None):
            execution_context["agent_id"] = self.agent_id
        return execution_context or None

    def _ensure_task_lock(self):
        return get_task_lock(self.api_task_id)

    def _stream_with_process_context(
        self, response_gen: StreamingChatAgentResponse
    ):
        with set_process_task(self.process_task_id):
            for chunk in response_gen:
                yield chunk

    async def _astream_with_process_context(
        self,
        response_gen: AsyncStreamingChatAgentResponse,
    ):
        with set_process_task(self.process_task_id):
            async for chunk in response_gen:
                yield chunk

    def step(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | StreamingChatAgentResponse:
        self._ensure_task_lock()
        with set_process_task(self.process_task_id):
            response = super().step(input_message, response_format)
        if isinstance(response, StreamingChatAgentResponse):
            return StreamingChatAgentResponse(
                self._stream_with_process_context(response)
            )
        return response

    async def astep(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | AsyncStreamingChatAgentResponse:
        self._ensure_task_lock()
        with set_process_task(self.process_task_id):
            response = await super().astep(input_message, response_format)
        if isinstance(response, AsyncStreamingChatAgentResponse):
            return AsyncStreamingChatAgentResponse(
                self._astream_with_process_context(response)
            )
        return response

    def clone(
        self,
        with_memory: bool = False,
        clone_context: CloneContext | None = None,
    ) -> ChatAgent:
        """Please see super.clone()"""
        system_message = None if with_memory else self._original_system_message
        effective_clone_context = (
            clone_context.model_copy(deep=True)
            if clone_context is not None
            else CloneContext()
        )

        # If this agent has CDP acquire callback, acquire CDP BEFORE cloning
        # tools so that HybridBrowserToolkit clones with the correct CDP port
        new_cdp_port = None
        new_cdp_session = effective_clone_context.session_id
        has_cdp = hasattr(self, "_cdp_acquire_callback") and callable(
            getattr(self, "_cdp_acquire_callback", None)
        )

        need_cdp_clone = False
        if has_cdp and hasattr(self, "_cdp_options"):
            options = self._cdp_options
            cdp_browsers = getattr(options, "cdp_browsers", [])
            if cdp_browsers and hasattr(self, "_browser_toolkit"):
                need_cdp_clone = True
                from app.agent.factory.browser import _cdp_pool_manager
                from uuid import uuid4

                if not new_cdp_session:
                    new_cdp_session = str(uuid4())[:8]
                effective_clone_context.session_id = new_cdp_session
                selected = _cdp_pool_manager.acquire_browser(
                    cdp_browsers,
                    new_cdp_session,
                    getattr(self, "_cdp_task_id", None),
                )
                from app.agent.factory.browser import _get_browser_port

                if selected:
                    new_cdp_port = _get_browser_port(selected)
                else:
                    new_cdp_port = _get_browser_port(cdp_browsers[0])
                resource_hints = dict(
                    effective_clone_context.resource_hints or {}
                )
                resource_hints["cdp_port"] = new_cdp_port
                effective_clone_context.resource_hints = resource_hints

        if need_cdp_clone:
            # Temporarily override the browser toolkit's CDP URL.
            # Lock prevents concurrent clones from clobbering each
            # other's cdp_url on the shared parent toolkit.
            toolkit = self._browser_toolkit
            with ListenChatAgent._cdp_clone_lock:
                original_cdp_url = (
                    toolkit.config_loader.get_browser_config().cdp_url
                )
                toolkit.config_loader.get_browser_config().cdp_url = (
                    f"http://localhost:{new_cdp_port}"
                )
                try:
                    cloned_tools, toolkits_to_register = self._clone_tools(
                        effective_clone_context
                    )
                except Exception:
                    _cdp_pool_manager.release_browser(
                        new_cdp_port, new_cdp_session
                    )
                    raise
                finally:
                    toolkit.config_loader.get_browser_config().cdp_url = (
                        original_cdp_url
                    )
        else:
            cloned_tools, toolkits_to_register = self._clone_tools(
                effective_clone_context
            )

        clone_execution_context = dict(self._user_execution_context)
        if effective_clone_context.execution_context:
            clone_execution_context.update(
                effective_clone_context.execution_context
            )

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
            retry_attempts=self.retry_attempts,
            retry_delay=self.retry_delay,
            step_timeout=self.step_timeout,
            callbacks=self._user_callbacks,
            execution_context=clone_execution_context,
            execution_context_provider=self._user_execution_context_provider,
            stream_accumulate=self.stream_accumulate,
            summary_window_ratio=self.summary_window_ratio,
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
                new_agent._cdp_session_id = new_cdp_session
            else:
                if hasattr(self, "_cdp_port"):
                    new_agent._cdp_port = self._cdp_port
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
