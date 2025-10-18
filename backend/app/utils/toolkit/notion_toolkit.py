from typing import List
from camel.toolkits import NotionToolkit as BaseNotionToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseNotionToolkit)
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

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> List[FunctionTool]:
        if env("NOTION_TOKEN"):
            return NotionToolkit(api_task_id).get_tools()
        else:
            return []
