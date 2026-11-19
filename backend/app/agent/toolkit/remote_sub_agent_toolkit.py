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

import logging
from typing import Any

from camel.toolkits import BaseToolkit, FunctionTool

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.remote_sub_agent.policy import build_configured_policy
from app.remote_sub_agent.provider_registry import (
    build_remote_sub_agent_provider,
    get_configured_provider_name,
    is_remote_sub_agent_provider_configured,
)
from app.remote_sub_agent.runtime import RemoteSubAgentRuntime
from app.remote_sub_agent.types import RemoteSubAgentRequest
from app.service.task import Agents

logger = logging.getLogger(__name__)


class RemoteSubAgentToolkit(BaseToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        working_directory: str | None = None,
        remote_sub_agent_config: Any | None = None,
        timeout: float | None = None,
    ) -> None:
        super().__init__(timeout=timeout)
        self.api_task_id = api_task_id
        self.working_directory = working_directory
        self.remote_sub_agent_config = remote_sub_agent_config
        if agent_name is not None:
            self.agent_name = agent_name

    @staticmethod
    def is_enabled(
        remote_sub_agent_config: Any | None = None,
        working_directory: str | None = None,
    ) -> bool:
        return _is_config_enabled(remote_sub_agent_config, working_directory)

    async def run_remote_sub_agent(
        self,
        instruction: str,
        remote_agent_name: str | None = None,
        system_instruction: str | None = None,
        reuse_session: bool = True,
        skill_context: str | None = None,
    ) -> str:
        """Delegate a bounded task to the configured remote sub-agent.

        Use this tool whenever the user or task explicitly asks for
        RemoteSubAgent, remote sub-agent, remote sandbox, cloud sandbox, or
        isolated remote execution. Also use it for bounded work that is likely
        long-running or better suited to an isolated environment, such as
        dependency installation, script execution, scraping, data/log analysis,
        ML or CI failure audits, and remote research. Do not replace those
        requests with local terminal execution; local terminal output is not
        remote evidence.

        The remote agent only has access to content supplied in the
        instruction or through HTTP(S) URLs included in the task context. Pass
        user-provided readable URLs verbatim and ask the remote agent to
        fetch/read them from the remote environment. Do not claim that it
        inspected local workspace files unless the needed content was included
        in the instruction or made available through a readable URL. When the
        remote work depends on a locally loaded skill, pass the relevant skill
        instructions in `skill_context`; the remote sandbox cannot read local
        skill files by itself.
        To control cost, do not repeat a completed remote job only to improve
        formatting. Reuse the existing session for clarifications when needed.

        Args:
            instruction: The exact task for the remote sub-agent.
            remote_agent_name: Optional provider-specific remote agent id.
            system_instruction: Optional behavior constraints for this run.
            reuse_session: Continue the previous provider interaction when true.
            skill_context: Optional relevant skill instructions to include in
                the remote prompt.

        Returns:
            The remote sub-agent's final text answer plus minimal run metadata.
        """
        if not instruction.strip():
            return "RemoteSubAgent instruction cannot be empty."

        policy = build_configured_policy(
            self.remote_sub_agent_config, self.working_directory
        )
        if not _is_config_enabled(
            self.remote_sub_agent_config, self.working_directory
        ):
            return (
                "RemoteSubAgent is disabled or incomplete. Enable and "
                "configure it in Agents > Sub Agents first."
            )

        provider_name = get_configured_provider_name(
            self.remote_sub_agent_config
        )
        prompt_parts = []
        if skill_context and skill_context.strip():
            prompt_parts.append(
                f"<skill_context>\n{skill_context.strip()}\n</skill_context>"
            )
        prompt_parts.append(instruction)

        request = RemoteSubAgentRequest(
            api_task_id=self.api_task_id,
            prompt="\n\n".join(prompt_parts),
            provider=provider_name,
            remote_agent_name=remote_agent_name,
            system_instruction=system_instruction,
            reuse_session=reuse_session,
        )
        logger.info(
            "RemoteSubAgent tool invoked",
            extra={
                "api_task_id": self.api_task_id,
                "agent_name": self.agent_name,
                "remote_agent_name": remote_agent_name,
                "reuse_session": reuse_session,
            },
        )
        runtime = RemoteSubAgentRuntime(
            provider=build_remote_sub_agent_provider(
                self.remote_sub_agent_config
            ),
            policy=policy,
        )
        result = await runtime.run(request)
        logger.info(
            "RemoteSubAgent tool completed",
            extra={
                "api_task_id": self.api_task_id,
                "provider": result.session.provider,
                "session_id": result.session.session_id,
                "interaction_id": result.session.remote_interaction_id,
                "events_count": len(result.events),
                "has_usage": result.usage is not None,
            },
        )

        metadata = [
            f"provider: {result.session.provider}",
            f"session_id: {result.session.session_id}",
        ]
        if result.session.remote_interaction_id:
            metadata.append(
                f"interaction_id: {result.session.remote_interaction_id}"
            )
        if result.usage:
            total_tokens = result.usage.get("total_tokens")
            if total_tokens is not None:
                metadata.append(f"total_tokens: {total_tokens}")

        return (
            f"{result.final_text}\n\n[RemoteSubAgent: {'; '.join(metadata)}]"
        )

    def get_tools(self) -> list[FunctionTool]:
        return [FunctionTool(self.run_remote_sub_agent)]


def _is_config_enabled(
    remote_sub_agent_config: Any | None = None,
    working_directory: str | None = None,
) -> bool:
    policy = build_configured_policy(
        remote_sub_agent_config, working_directory
    )
    if not policy.enabled:
        return False

    return is_remote_sub_agent_provider_configured(remote_sub_agent_config)
