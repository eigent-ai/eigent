import os
import json
import asyncio
from textwrap import indent
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
        
        help_description = "If you need use parent, you can use `notion-search` for the information"
        # Modify the notion-create-pages function to make parent optional
        if function_name == "notion-create-pages" or function_name == "notion-create-database":
            required.remove("parent")
            parameters["required"] = required
            if "parent" in properties:
                # Update the parent parameter description
                properties["parent"]["description"] = "Optional. " + properties["parent"]["description"] + help_description

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
        # Retry mechanism for remote MCP connection
        max_retries = 3
        retry_delay = 2  # seconds
        
        for attempt in range(max_retries):
            tools = []
            toolkit = None
            
            try:
                # Create a fresh toolkit instance for each retry
                toolkit = cls(api_task_id)
                logger.info(f"Attempting to connect to Notion MCP server (attempt {attempt + 1}/{max_retries})")
                
                await toolkit.connect()
                
                # Get tools from the connected toolkit
                all_tools = toolkit.get_tools()
                tool_schema = [
                    item.get_openai_tool_schema() for item in all_tools
                ]
                
                # Adjust tool schema
                for item in tool_schema:
                    _customize_function_parameters(item)
                
                for item in all_tools:
                    setattr(item, "_toolkit_name", cls.__name__)
                    tools.append(item)
                
                # Check if we actually got tools
                if len(tools) == 0:
                    logger.warning(f"Connected to Notion MCP server but got 0 tools (attempt {attempt + 1}/{max_retries})")
                    raise Exception("No tools retrieved from Notion MCP server")
                
                # Success! Got tools
                logger.info(f"Successfully connected to Notion MCP server and loaded {len(tools)} tools")
                
                return tools
                
            except Exception as e:
                logger.warning(f"Failed to connect to Notion MCP server (attempt {attempt + 1}/{max_retries}): {e}")
                
                # If not the last attempt, wait and retry
                if attempt < max_retries - 1:
                    logger.info(f"Retrying in {retry_delay} seconds...")
                    await asyncio.sleep(retry_delay)
                else:
                    # Last attempt failed
                    logger.error(f"All {max_retries} connection attempts to Notion MCP server failed. Notion tools will not be available for this task.")
        return []
