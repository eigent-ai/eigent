import os
from typing import Any, Dict, List
from camel.toolkits import FunctionTool
from app.component.environment import env
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from camel.toolkits.mcp_toolkit import MCPToolkit
from app.utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("notion_mcp_toolkit")


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

    def get_tools(self) -> List[FunctionTool]:
        r"""Returns a list of tools provided by the NotionMCPToolkit.

        Returns:
            List[FunctionTool]: List of available tools.
        """
        all_tools = []
        for client in self.clients:
            try:
                original_build_schema = client._build_tool_schema

                def create_wrapper(orig_func):
                    def wrapper(mcp_tool):
                        return self._build_custom_tool_schema(
                            mcp_tool, orig_func
                        )

                    return wrapper

                client._build_tool_schema = create_wrapper(  # type: ignore[method-assign]
                    original_build_schema
                )

                client_tools = client.get_tools()
                all_tools.extend(client_tools)

                client._build_tool_schema = original_build_schema  # type: ignore[method-assign]

            except Exception as e:
                logger.error(f"Failed to get tools from client: {e}")
        return all_tools

    def _build_custom_tool_schema(self, mcp_tool, original_build_schema):
        r"""Build tool schema with custom modifications."""
        schema = original_build_schema(mcp_tool)
        self._customize_function_parameters(schema)
        return schema

    def _customize_function_parameters(self, schema: Dict[str, Any]) -> None:
        r"""Customize function parameters for specific functions.

        This method allows modifying parameter descriptions or other schema
        attributes for specific functions.
        """
        function_info = schema.get("function", {})
        function_name = function_info.get("name", "")
        parameters = function_info.get("parameters", {})
        properties = parameters.get("properties", {})

        # Modify the notion-create-pages function to make parent optional
        if function_name == "notion-create-pages":
            if "parent" in properties:
                # Update the parent parameter description
                properties["parent"]["description"] = (
                    "Optional. The parent under which the new pages will be created. "
                    "This can be a page (page_id), a database page (database_id), or "
                    "a data source/collection under a database (data_source_id). "
                    "If omitted, the new pages will be created as private pages at the workspace level. "
                    "Use data_source_id when you have a collection:// URL from the fetch tool."
                )

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
