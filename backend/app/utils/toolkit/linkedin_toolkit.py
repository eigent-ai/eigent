from camel.toolkits import LinkedInToolkit as BaseLinkedInToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class LinkedInToolkit(BaseLinkedInToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        super().__init__(timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseLinkedInToolkit.create_post,
        lambda _, text: f"create a LinkedIn post with text: {text}",
    )
    def create_post(self, text: str) -> dict:
        return super().create_post(text)

    @listen_toolkit(
        BaseLinkedInToolkit.delete_post,
        lambda _, post_id: f"delete LinkedIn post with id: {post_id}",
    )
    def delete_post(self, post_id: str) -> str:
        return super().delete_post(post_id)

    @listen_toolkit(
        BaseLinkedInToolkit.get_profile,
        lambda _, include_id: f"get LinkedIn profile with include_id: {include_id}",
    )
    def get_profile(self, include_id: bool = False) -> dict:
        return super().get_profile(include_id)

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        if env("LINKEDIN_ACCESS_TOKEN"):
            return LinkedInToolkit(api_task_id).get_tools()
        else:
            return []
