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

import datetime
import platform
from typing import TYPE_CHECKING

from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.prompt import AGENT_ENVIRONMENT_PROMPT
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.skill_toolkit import SkillToolkit
from app.model.chat import Chat
from app.service.task import Agents

if TYPE_CHECKING:
    from app.agent.listen_chat_agent import ListenChatAgent


def _env_prompt(working_directory: str) -> str:
    return AGENT_ENVIRONMENT_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        current_date=datetime.date.today(),
    )


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
            Agents.coordinator_agent: (
                "You are a helpful coordinator.\n"
                + _env_prompt(working_directory)
            ),
            Agents.task_agent: (
                "You are a helpful task planner.\n"
                + _env_prompt(working_directory)
            ),
        }.items()
    ]


def create_new_worker_agent(
    options: Chat, working_directory: str
) -> ListenChatAgent:
    """Create new worker agent (sync, runs in thread pool)."""
    return agent_model(
        Agents.new_worker_agent,
        "You are a helpful assistant.\n" + _env_prompt(working_directory),
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
