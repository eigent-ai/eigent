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

"""Factory functions for workforce-internal agents (coordinator, task, worker)."""

from __future__ import annotations

import datetime
import platform
from typing import TYPE_CHECKING

from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.skill_toolkit import SkillToolkit
from app.model.chat import Chat
from app.service.task import Agents

if TYPE_CHECKING:
    from app.agent.listen_chat_agent import ListenChatAgent


def create_coordinator_and_task_agents(
    options: Chat, working_directory: str
) -> list[ListenChatAgent]:
    """Create coordinator and task agents (sync, runs in thread pool)."""
    return [
        agent_model(
            key,
            prompt,
            options,
            [
                *(
                    ToolkitMessageIntegration(
                        message_handler=HumanToolkit(
                            options.project_id, key
                        ).send_message_to_user
                    ).register_toolkits(
                        NoteTakingToolkit(
                            options.project_id,
                            working_directory=working_directory,
                        )
                    )
                ).get_tools(),
                *SkillToolkit(
                    options.project_id,
                    key,
                    working_directory=working_directory,
                    user_id=options.skill_config_user_id(),
                ).get_tools(),
            ],
        )
        for key, prompt in {
            Agents.coordinator_agent: f"""
You are a helpful coordinator.
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory \
`{working_directory}`. All local file operations \
must occur here, but you can access files from any \
place in the file system. For all file system \
operations, you MUST use absolute paths to ensure \
precision and avoid ambiguity.
The current date is {datetime.date.today()}. \
For any date-related tasks, you MUST use this as \
the current date.
            """,
            Agents.task_agent: f"""
You are a helpful task planner.
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory \
`{working_directory}`. All local file operations \
must occur here, but you can access files from any \
place in the file system. For all file system \
operations, you MUST use absolute paths to ensure \
precision and avoid ambiguity.
The current date is {datetime.date.today()}. \
For any date-related tasks, you MUST use this as \
the current date.
        """,
        }.items()
    ]


def create_new_worker_agent(
    options: Chat, working_directory: str
) -> ListenChatAgent:
    """Create new worker agent (sync, runs in thread pool)."""
    return agent_model(
        Agents.new_worker_agent,
        f"""
        You are a helpful assistant.
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory \
`{working_directory}`. All local file operations \
must occur here, but you can access files from any \
place in the file system. For all file system \
operations, you MUST use absolute paths to ensure \
precision and avoid ambiguity.
The current date is {datetime.date.today()}. \
For any date-related tasks, you MUST use this as \
the current date.
        """,
        options,
        [
            *HumanToolkit.get_can_use_tools(
                options.project_id, Agents.new_worker_agent
            ),
            *(
                ToolkitMessageIntegration(
                    message_handler=HumanToolkit(
                        options.project_id, Agents.new_worker_agent
                    ).send_message_to_user
                ).register_toolkits(
                    NoteTakingToolkit(
                        options.project_id,
                        working_directory=working_directory,
                    )
                )
            ).get_tools(),
            *SkillToolkit(
                options.project_id,
                Agents.new_worker_agent,
                working_directory=working_directory,
                user_id=options.skill_config_user_id(),
            ).get_tools(),
        ],
    )
