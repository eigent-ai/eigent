import os
from camel.toolkits import FunctionTool, NotionMCPToolkit as BaseNotionMCPToolkit
from app.component.command import bun
from app.component.environment import env
from app.service.task import Agents
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from camel.toolkits.mcp_toolkit import MCPToolkit


class NotionMCPToolkit(BaseNotionMCPToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(
        self,
        api_task_id: str,
        timeout: float | None = None,
    ):
        self.api_task_id = api_task_id
        if timeout is None:
            timeout = 120.0
        super().__init__(timeout)
        self._mcp_toolkit = MCPToolkit(
            config_dict={
                "mcpServers": {
                    "notionMCP": {
                        "command": bun(),
                        "args": ["x", "-y", "eigent-mcp-remote@0.1.22", "https://mcp.notion.com/mcp"],
                        "env": {
                            "MCP_REMOTE_CONFIG_DIR": env("MCP_REMOTE_CONFIG_DIR", os.path.expanduser("~/.mcp-auth")),
                        },
                    }
                }
            },
            timeout=timeout,
        )

    @classmethod
    async def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        tools = []
        if env("MCP_REMOTE_CONFIG_DIR"):
            toolkit = cls(api_task_id)
            await toolkit.connect()
            for item in toolkit.get_tools():
                setattr(item, "_toolkit_name", cls.__name__)
                tools.append(item)
        return tools
