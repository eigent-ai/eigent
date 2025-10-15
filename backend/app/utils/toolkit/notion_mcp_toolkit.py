import os
from camel.toolkits import FunctionTool
from app.component.environment import env
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from camel.toolkits.mcp_toolkit import MCPToolkit


class NotionMCPToolkit(MCPToolkit, AbstractToolkit):

    def __init__(
        self,
        api_task_id: str,
        timeout: float | None = None,
    ):
        self.api_task_id = api_task_id
        if timeout is None:
            timeout = 120.0
        
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
        }
        super().__init__(config_dict=config_dict, timeout=timeout)

    @classmethod
    async def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        tools = []
        toolkit = cls(api_task_id)
        try:
            await toolkit.connect()
            # Use subclass implementation that inlines upstream processing
            all_tools = toolkit.get_tools()
            for item in all_tools:
                setattr(item, "_toolkit_name", cls.__name__)
                tools.append(item)
        except Exception as e:
            print(f"Warning: Could not connect to Notion MCP server: {e}")
        return tools
