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

from typing import Any

from camel.toolkits import ToolkitMessageIntegration

from app.agent.prompt import build_remote_sub_agent_usage_notice
from app.agent.toolkit.remote_sub_agent_toolkit import RemoteSubAgentToolkit
from app.model.chat import Chat


def remote_sub_agent_enabled(options: Chat, working_directory: str) -> bool:
    return RemoteSubAgentToolkit.is_enabled(
        options.remote_sub_agent_config, working_directory
    )


def attach_remote_sub_agent_if_enabled(
    *,
    options: Chat,
    agent_name: str,
    working_directory: str,
    tools: list[Any],
    tool_names: list[str],
    system_message: str,
    local_tool_description: str,
    message_integration: ToolkitMessageIntegration | None = None,
) -> str:
    if not remote_sub_agent_enabled(options, working_directory):
        return system_message

    toolkit_name = RemoteSubAgentToolkit.toolkit_name()
    if toolkit_name not in tool_names:
        remote_sub_agent_toolkit = RemoteSubAgentToolkit(
            api_task_id=options.project_id,
            agent_name=agent_name,
            working_directory=working_directory,
            remote_sub_agent_config=options.remote_sub_agent_config,
        )
        if message_integration is not None:
            remote_sub_agent_toolkit = message_integration.register_toolkits(
                remote_sub_agent_toolkit
            )
        tools.extend(remote_sub_agent_toolkit.get_tools())
        tool_names.append(toolkit_name)

    remote_sub_agent_notice = build_remote_sub_agent_usage_notice(
        working_directory=working_directory,
        local_tool_description=local_tool_description,
    )
    return f"{system_message}\n{remote_sub_agent_notice}"
