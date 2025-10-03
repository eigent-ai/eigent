from typing import Any, List
from camel.toolkits import BaseToolkit, FunctionTool
import httpx
from app.service.task import Action, ActionSearchMcpData, Agents, get_task_lock
from app.component.environment import env_not_empty
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class McpSearchToolkit(BaseToolkit, AbstractToolkit):
    agent_name: str = Agents.mcp_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        super().__init__(timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        inputs=lambda _,
        keyword,
        size,
        page: f"keyword: {keyword}, size: {size}, page: {page}",
        return_msg=lambda res: f"Search {len(res)} results: ",
    )
    async def search_mcp_from_url(
        self,
        keyword: str,
        size: int = 15,
        page: int = 0,
    ) -> dict[str, Any]:
        """Search mcp server for keyword.

        Args:
            keyword (str): mcp server name keyword.
            size (int): count per page.
            page (int): page.

        Returns:
            dict[str, Any]: _description_
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                env_not_empty("MCP_URL"),
                params={
                    "keyword": keyword,
                    "size": size,
                    "page": page,
                },
            )
            if response.status_code != 200:
                raise Exception(f"MCP server search failed: {response.text}")
            data = response.json()
            task_lock = get_task_lock(self.api_task_id)
            await task_lock.put_queue(
                ActionSearchMcpData(action=Action.search_mcp, data=data["items"])
            )
            return data

    def get_tools(self) -> List[FunctionTool]:
        return [FunctionTool(self.search_mcp_from_url)]
