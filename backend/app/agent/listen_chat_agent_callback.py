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

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.service.task import (
    ActionActivateAgentData,
    ActionActivateToolkitData,
    ActionBudgetNotEnough,
    ActionDeactivateAgentData,
    ActionDeactivateToolkitData,
)
from app.utils.event_loop_utils import _schedule_async_task
from camel.agents import (
    AgentCallback,
    AgentEvent,
    StepCompletedEvent,
    StepFailedEvent,
    StepStartedEvent,
    ToolCompletedEvent,
    ToolFailedEvent,
    ToolStartedEvent,
)

if TYPE_CHECKING:
    from app.agent.listen_chat_agent import ListenChatAgent
    from camel.toolkits import FunctionTool

logger = logging.getLogger("listen_chat_agent_callback")


def _get_total_tokens(event: StepCompletedEvent) -> int:
    usage = event.usage or {}
    return usage.get("total_tokens", 0)


class ListenChatAgentCallback(AgentCallback):
    """Bridge CAMEL agent lifecycle events into Eigent task actions."""

    def __init__(self, agent: ListenChatAgent) -> None:
        self._agent = agent

    def handle_event(self, event: AgentEvent) -> None:
        if isinstance(event, StepStartedEvent):
            self._handle_step_started(event)
        elif isinstance(event, StepCompletedEvent):
            self._handle_step_completed(event)
        elif isinstance(event, StepFailedEvent):
            self._handle_step_failed(event)
        elif isinstance(event, ToolStartedEvent):
            self._handle_tool_started(event)
        elif isinstance(event, ToolCompletedEvent):
            self._handle_tool_completed(event)
        elif isinstance(event, ToolFailedEvent):
            self._handle_tool_failed(event)

    def _queue_action(self, action) -> None:
        task_lock = self._agent._ensure_task_lock()
        _schedule_async_task(task_lock.put_queue(action))

    def _resolve_tool(self, tool_name: str) -> FunctionTool | None:
        return self._agent._internal_tools.get(tool_name)

    def _should_skip_toolkit_event(self, tool_name: str) -> bool:
        tool = self._resolve_tool(tool_name)
        if tool is None:
            return False
        return bool(getattr(tool.func, "__listen_toolkit__", False))

    def _resolve_toolkit_name(
        self, event_toolkit_name: str | None, tool_name: str
    ) -> str:
        if event_toolkit_name:
            return event_toolkit_name

        tool = self._resolve_tool(tool_name)
        if tool is None:
            return "mcp_toolkit"

        if hasattr(tool, "_toolkit_name"):
            return tool._toolkit_name

        if hasattr(tool, "func") and hasattr(tool.func, "__self__"):
            toolkit_instance = tool.func.__self__
            if hasattr(toolkit_instance, "toolkit_name") and callable(
                toolkit_instance.toolkit_name
            ):
                return toolkit_instance.toolkit_name()

        if (
            hasattr(tool, "func")
            and hasattr(tool.func, "func")
            and hasattr(tool.func.func, "__self__")
        ):
            toolkit_instance = tool.func.func.__self__
            if hasattr(toolkit_instance, "toolkit_name") and callable(
                toolkit_instance.toolkit_name
            ):
                return toolkit_instance.toolkit_name()

        return "mcp_toolkit"

    def _activate_agent_payload(self, message: str) -> dict:
        return {
            "agent_name": self._agent.agent_name,
            "process_task_id": self._agent.process_task_id,
            "agent_id": self._agent.agent_id,
            "message": message,
        }

    def _deactivate_agent_payload(self, message: str, tokens: int = 0) -> dict:
        return {
            "agent_name": self._agent.agent_name,
            "process_task_id": self._agent.process_task_id,
            "agent_id": self._agent.agent_id,
            "message": message,
            "tokens": tokens,
        }

    def _tool_payload(
        self,
        *,
        tool_name: str,
        toolkit_name: str,
        message: str,
    ) -> dict:
        return {
            "agent_name": self._agent.agent_name,
            "process_task_id": self._agent.process_task_id,
            "toolkit_name": toolkit_name,
            "method_name": tool_name,
            "message": message,
        }

    def _handle_step_started(self, event: StepStartedEvent) -> None:
        self._queue_action(
            ActionActivateAgentData(
                data=self._activate_agent_payload(event.input_summary or "")
            )
        )

    def _handle_step_completed(self, event: StepCompletedEvent) -> None:
        self._queue_action(
            ActionDeactivateAgentData(
                data=self._deactivate_agent_payload(
                    event.output_summary or "",
                    _get_total_tokens(event),
                )
            )
        )

    def _handle_step_failed(self, event: StepFailedEvent) -> None:
        message = event.error_message
        if "Budget has been exceeded" in message:
            self._queue_action(ActionBudgetNotEnough())
            message = "Budget has been exceeded"

        self._queue_action(
            ActionDeactivateAgentData(
                data=self._deactivate_agent_payload(message, 0)
            )
        )

    def _handle_tool_started(self, event: ToolStartedEvent) -> None:
        if self._should_skip_toolkit_event(event.tool_name):
            return

        toolkit_name = self._resolve_toolkit_name(
            event.toolkit_name, event.tool_name
        )
        self._queue_action(
            ActionActivateToolkitData(
                data=self._tool_payload(
                    tool_name=event.tool_name,
                    toolkit_name=toolkit_name,
                    message=event.input_summary or "",
                )
            )
        )

    def _handle_tool_completed(self, event: ToolCompletedEvent) -> None:
        if self._should_skip_toolkit_event(event.tool_name):
            return

        toolkit_name = self._resolve_toolkit_name(
            event.toolkit_name, event.tool_name
        )
        self._queue_action(
            ActionDeactivateToolkitData(
                data=self._tool_payload(
                    tool_name=event.tool_name,
                    toolkit_name=toolkit_name,
                    message=event.output_summary or "",
                )
            )
        )

    def _handle_tool_failed(self, event: ToolFailedEvent) -> None:
        if self._should_skip_toolkit_event(event.tool_name):
            return

        toolkit_name = self._resolve_toolkit_name(
            event.toolkit_name, event.tool_name
        )
        self._queue_action(
            ActionDeactivateToolkitData(
                data=self._tool_payload(
                    tool_name=event.tool_name,
                    toolkit_name=toolkit_name,
                    message=event.error_message,
                )
            )
        )
