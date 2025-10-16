from typing import Literal
from camel.toolkits import GithubToolkit as BaseGithubToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseGithubToolkit)
class GithubToolkit(BaseGithubToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent

    def __init__(
        self,
        api_task_id: str,
        access_token: str | None = None,
        timeout: float | None = None,
    ) -> None:
        super().__init__(access_token, timeout)
        self.api_task_id = api_task_id

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        if env("GITHUB_ACCESS_TOKEN"):
            return GithubToolkit(api_task_id).get_tools()
        else:
            return []
