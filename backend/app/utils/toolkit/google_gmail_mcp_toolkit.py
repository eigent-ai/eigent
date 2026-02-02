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

from camel.toolkits import BaseToolkit, FunctionTool, MCPToolkit

from app.component.command import bun
from app.component.environment import env, env_or_fail
from app.service.task import Agents
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class GoogleGmailMCPToolkit(BaseToolkit, AbstractToolkit):
    agent_name: str = Agents.social_media_agent

    def __init__(
        self,
        api_task_id: str,
        credentials_path: str | None = None,
        timeout: float | None = None,
        input_env: dict[str, str] | None = None,
    ):
        super().__init__(timeout)
        self.api_task_id = api_task_id
        credentials_path = credentials_path or env("GMAIL_CREDENTIALS_PATH")
        self._mcp_toolkit = MCPToolkit(
            config_dict={
                "mcpServers": {
                    "gmail": {
                        "command": bun(),
                        "args":
                        ["x", "-y", "@gongrzhe/server-gmail-autoauth-mcp"],
                        "env": {
                            "GMAIL_CREDENTIALS_PATH": credentials_path,
                            **(input_env or {})
                        },
                    }
                }
            },
            timeout=timeout,
        )

    async def connect(self):
        await self._mcp_toolkit.connect()

    async def disconnect(self):
        await self._mcp_toolkit.disconnect()

    def get_tools(self) -> list[FunctionTool]:
        return self._mcp_toolkit.get_tools()

    @classmethod
    async def get_can_use_tools(
        cls,
        api_task_id: str,
        input_env: dict[str, str] | None = None
    ) -> list[FunctionTool]:
        if env("GMAIL_CREDENTIALS_PATH") is None:
            return []
        toolkit = cls(
            api_task_id, env_or_fail("GMAIL_CREDENTIALS_PATH"), 180, input_env
        )
        await toolkit.connect()
        tools = []
        for item in toolkit.get_tools():
            setattr(item, "_toolkit_name", cls.__name__)
            tools.append(item)
        return tools
