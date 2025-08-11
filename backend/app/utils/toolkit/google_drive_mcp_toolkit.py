from camel.toolkits import GoogleDriveMCPToolkit as BaseGoogleDriveMCPToolkit, MCPToolkit
from app.component.command import bun
from app.component.environment import env
from app.service.task import Agents
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from camel.toolkits.function_tool import FunctionTool


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
                        "args": ["x", "-y", "@modelcontextprotocol/server-gdrive"],
                        "env": {"GDRIVE_CREDENTIALS_PATH": credentials_path, **(input_env or {})},
                    }
                }
            },
            timeout=timeout,
        )

    @classmethod
    async def get_can_use_tools(cls, api_task_id: str, input_env: dict[str, str] | None = None) -> list[FunctionTool]:
        if env("GDRIVE_CREDENTIALS_PATH") is None:
            return []
        toolkit = cls(api_task_id, 180, env("GDRIVE_CREDENTIALS_PATH"), input_env)
        await toolkit.connect()
        tools = []
        for item in toolkit.get_tools():
            setattr(item, "_toolkit_name", cls.__name__)
            tools.append(item)
        return tools
