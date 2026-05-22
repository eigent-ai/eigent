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

from collections.abc import Callable

from camel.toolkits import AgentToolkit, FunctionTool, RegisteredAgentToolkit

from app.agent.toolkit.abstract_toolkit import AbstractToolkit


def _is_agent_tool(tool: FunctionTool | Callable) -> bool:
    func = getattr(tool, "func", tool)
    toolkit = getattr(func, "__self__", None)
    return isinstance(toolkit, AgentToolkit)


class DepthLimitedAgentToolkit(AgentToolkit, AbstractToolkit):
    """CAMEL AgentToolkit with delegated-agent recursion disabled.

    CAMEL's native AgentToolkit clones the parent tool set into child agents.
    For Eigent single-agent mode we want root agents to delegate, while child
    agents must not delegate again. This adapter keeps the CAMEL toolkit API
    and removes AgentToolkit tools from child tool sets.
    """

    def __init__(
        self,
        *,
        current_depth: int = 0,
        max_depth: int = 1,
        timeout: float | None = None,
    ) -> None:
        super().__init__(timeout=timeout)
        self.current_depth = current_depth
        self.max_depth = max_depth

    def _resolve_child_tools(
        self,
        parent,
    ) -> tuple[
        list[FunctionTool | Callable] | None,
        list[RegisteredAgentToolkit] | None,
    ]:
        tools, toolkits_to_register = super()._resolve_child_tools(parent)
        if tools is None:
            return None, toolkits_to_register

        return (
            [tool for tool in tools if not _is_agent_tool(tool)],
            [
                toolkit
                for toolkit in (toolkits_to_register or [])
                if not isinstance(toolkit, AgentToolkit)
            ],
        )

    def _build_system_message(
        self,
        subagent_type: str,
        description: str,
    ) -> str:
        base = super()._build_system_message(subagent_type, description)
        return (
            base + "\nYou are a child sub-agent. Complete the assigned task "
            "directly and do not create or delegate to any further sub-agents."
        )

    @classmethod
    def toolkit_name(cls) -> str:
        return "AgentToolkit"
