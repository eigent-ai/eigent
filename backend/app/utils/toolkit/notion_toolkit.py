from typing import List
from camel.toolkits import NotionToolkit as BaseNotionToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class NotionToolkit(BaseNotionToolkit, AbstractToolkit):
    agent_name: str = Agents.document_agent

    def __init__(
        self,
        api_task_id: str,
        notion_token: str | None = None,
        timeout: float | None = None,
    ) -> None:
        super().__init__(notion_token, timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseNotionToolkit.list_all_pages,
        lambda _: "list all pages in Notion workspace",
        lambda result: f"{len(result)} pages found",
    )
    def list_all_pages(self) -> List[dict]:
        return super().list_all_pages()

    @listen_toolkit(
        BaseNotionToolkit.list_all_users,
        lambda _: "list all users in Notion workspace",
        lambda result: f"{len(result)} users found",
    )
    def list_all_users(self) -> List[dict]:
        return super().list_all_users()

    @listen_toolkit(
        BaseNotionToolkit.get_notion_block_text_content,
        lambda _, page_id: f"get text content of page with id: {page_id}",
    )
    def get_notion_block_text_content(self, block_id: str) -> str:
        return super().get_notion_block_text_content(block_id)

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> List[FunctionTool]:
        if env("NOTION_TOKEN"):
            return NotionToolkit(api_task_id).get_tools()
        else:
            return []
