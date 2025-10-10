from typing import Any, Dict, List
from camel.toolkits import RedditToolkit as BaseRedditToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseRedditToolkit)
class RedditToolkit(BaseRedditToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(
        self,
        api_task_id: str,
        retries: int = 3,
        delay: float = 0,
        timeout: float | None = None,
    ):
        super().__init__(retries, delay, timeout)
        self.api_task_id = api_task_id

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        if env("REDDIT_CLIENT_ID") and env("REDDIT_CLIENT_SECRET") and env("REDDIT_USER_AGENT"):
            return RedditToolkit(api_task_id).get_tools()
        else:
            return []
