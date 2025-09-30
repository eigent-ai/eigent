import os
from typing import Any, ClassVar, Dict, List, Optional, Set
from camel.toolkits import FunctionTool, NotionMCPToolkit as BaseNotionMCPToolkit
from app.component.command import bun
from app.component.environment import env
from app.service.task import Agents
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from camel.toolkits.mcp_toolkit import MCPToolkit


class NotionMCPToolkit(BaseNotionMCPToolkit, AbstractToolkit):

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
                            "command": "npx",
                            "args": [
                                "-y",
                                "mcp-remote",
                                "https://mcp.notion.com/mcp",
                            ],
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
        toolkit = cls(api_task_id)
        try:
            await toolkit.connect()
            # Use subclass implementation that inlines upstream processing
            all_tools = BaseNotionMCPToolkit.get_tools(toolkit)
            for item in all_tools:
                setattr(item, "_toolkit_name", cls.__name__)
                tools.append(item)
        except Exception as e:
            print(f"Warning: Could not connect to Notion MCP server: {e}")
        return tools
