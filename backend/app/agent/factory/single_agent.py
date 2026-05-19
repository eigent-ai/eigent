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
import platform
from dataclasses import dataclass
from typing import Literal

from camel.messages import BaseMessage

from app.agent.agent_model import agent_model
from app.agent.factory.toolkit_assembler import assemble_single_agent_toolkits
from app.agent.prompt import SINGLE_AGENT_SYS_PROMPT
from app.agent.utils import NOW_STR
from app.hands.interface import IHands
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


@dataclass(frozen=True)
class AgentRuntimeConfig:
    role: Literal["root", "subagent"] = "root"
    depth: int = 0
    max_depth: int = 1

    @property
    def can_delegate(self) -> bool:
        return self.depth < self.max_depth


async def single_agent(
    options: Chat,
    *,
    task_id: str | None = None,
    hands: IHands | None = None,
    pause_event: asyncio.Event | None = None,
    runtime: AgentRuntimeConfig | None = None,
):
    """Create the root Single Agent using CAMEL-first tool assembly."""

    runtime = runtime or AgentRuntimeConfig()
    working_directory = get_working_directory(options)
    current_task_id = task_id or options.task_id

    assembly = await assemble_single_agent_toolkits(
        options,
        task_id=current_task_id,
        working_directory=working_directory,
        hands=hands,
        can_delegate=runtime.can_delegate,
        current_depth=runtime.depth,
        max_depth=runtime.max_depth,
    )

    system_message = SINGLE_AGENT_SYS_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )

    agent = agent_model(
        Agents.single_agent,
        BaseMessage.make_assistant_message(
            role_name="Single Agent",
            content=system_message,
        ),
        options,
        assembly.tools,
        tool_names=assembly.tool_names,
        toolkits_to_register_agent=assembly.toolkits_to_register_agent,
    )
    if pause_event is not None:
        agent.pause_event = pause_event
    if assembly.observable_todo_toolkit is not None:
        assembly.observable_todo_toolkit.agent_id = agent.agent_id
    agent._observable_todo_toolkit = assembly.observable_todo_toolkit
    return agent
