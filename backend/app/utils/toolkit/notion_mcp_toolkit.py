import os
from typing import Any, Dict, List
from camel.toolkits import FunctionTool
from app.component.environment import env
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from camel.toolkits.mcp_toolkit import MCPToolkit
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("notion_mcp_toolkit")

def _customize_function_parameters(schema: Dict[str, Any]) -> None:
        r"""Customize function parameters for specific functions.

        This method allows modifying parameter descriptions or other schema
        attributes for specific functions.
        """
        function_info = schema.get("function", {})
        function_name = function_info.get("name", "")
        parameters = function_info.get("parameters", {})
        properties = parameters.get("properties", {})
        required = parameters.get("required", [])
        
        # Modify the notion-create-pages function to make parent optional
        if function_name == "notion-create-pages":
            required.remove("parent")
            parameters["required"] = required
            if "parent" in properties:
                # Update the parent parameter description
                properties["parent"]["description"] = "Optional. " + properties["parent"]["description"]

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
            tool_schema = [
                item.get_openai_tool_schema() for item in all_tools
            ]
            #adjust tool schema
            for item in tool_schema:
                _customize_function_parameters(item)
            for item in all_tools:
                setattr(item, "_toolkit_name", cls.__name__)
                tools.append(item)
        except Exception as e:
            print(f"Warning: Could not connect to Notion MCP server: {e}")
        return tools
