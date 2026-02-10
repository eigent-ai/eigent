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

from camel.toolkits import (
    GoogleDriveMCPToolkit as BaseGoogleDriveMCPToolkit,
    MCPToolkit,
)
from camel.toolkits.function_tool import FunctionTool

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.command import bun
from app.component.environment import env
from app.service.task import Agents


class GoogleDriveMCPToolkit(BaseGoogleDriveMCPToolkit, AbstractToolkit):
    agent_name: str = Agents.document_agent

    def __init__(
        self,
        api_task_id: str,
        timeout: float | None = None,
        credentials_path: str | None = None,
        input_env: dict[str, str] | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        super().__init__(timeout, credentials_path)
        credentials_path = credentials_path or env("GDRIVE_CREDENTIALS_PATH")
        self._mcp_toolkit = MCPToolkit(
            config_dict={
                "mcpServers": {
                    "gdrive": {
                        "command": bun(),
                        "args": [
                            "x",
                            "-y",
                            "@modelcontextprotocol/server-gdrive",
                        ],
                        "env": {
                            "GDRIVE_CREDENTIALS_PATH": credentials_path,
                            **(input_env or {}),
                        },
                    }
                }
            },
            timeout=timeout,
        )

    @classmethod
    async def get_can_use_tools(
        cls, api_task_id: str, input_env: dict[str, str] | None = None
    ) -> list[FunctionTool]:
        if env("GDRIVE_CREDENTIALS_PATH") is None:
            return []
        toolkit = cls(
            api_task_id, 180, env("GDRIVE_CREDENTIALS_PATH"), input_env
        )
        await toolkit.connect()
        tools = []
        for item in toolkit.get_tools():
            item._toolkit_name = cls.__name__
            tools.append(item)
        return tools
