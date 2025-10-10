from typing import Any, Dict, List
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from camel.toolkits import GoogleCalendarToolkit as BaseGoogleCalendarToolkit


@auto_listen_toolkit(BaseGoogleCalendarToolkit)
class GoogleCalendarToolkit(BaseGoogleCalendarToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        self.api_task_id = api_task_id
        super().__init__(timeout)

    @classmethod
    def get_can_use_tools(cls, api_task_id: str):
        if env("GOOGLE_CLIENT_ID") and env("GOOGLE_CLIENT_SECRET"):
            return cls(api_task_id).get_tools()
        else:
            return []
