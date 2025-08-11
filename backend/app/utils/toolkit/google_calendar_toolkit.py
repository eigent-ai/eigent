from typing import Any, Dict, List
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from camel.toolkits import GoogleCalendarToolkit as BaseGoogleCalendarToolkit


class GoogleCalendarToolkit(BaseGoogleCalendarToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        self.api_task_id = api_task_id
        super().__init__(timeout)

    @listen_toolkit(BaseGoogleCalendarToolkit.create_event)
    def create_event(
        self,
        event_title: str,
        start_time: str,
        end_time: str,
        description: str = "",
        location: str = "",
        attendees_email: List[str] | None = None,
        timezone: str = "UTC",
    ) -> Dict[str, Any]:
        return super().create_event(event_title, start_time, end_time, description, location, attendees_email, timezone)

    @listen_toolkit(BaseGoogleCalendarToolkit.get_events)
    def get_events(self, max_results: int = 10, time_min: str | None = None) -> List[Dict[str, Any]] | Dict[str, Any]:
        return super().get_events(max_results, time_min)

    @listen_toolkit(BaseGoogleCalendarToolkit.update_event)
    def update_event(
        self,
        event_id: str,
        event_title: str | None = None,
        start_time: str | None = None,
        end_time: str | None = None,
        description: str | None = None,
        location: str | None = None,
        attendees_email: List[str] | None = None,
    ) -> Dict[str, Any]:
        return super().update_event(event_id, event_title, start_time, end_time, description, location, attendees_email)

    @listen_toolkit(BaseGoogleCalendarToolkit.delete_event)
    def delete_event(self, event_id: str) -> str:
        return super().delete_event(event_id)

    @listen_toolkit(BaseGoogleCalendarToolkit.get_calendar_details)
    def get_calendar_details(self) -> Dict[str, Any]:
        return super().get_calendar_details()

    @classmethod
    def get_can_use_tools(cls, api_task_id: str):
        if env("GOOGLE_CLIENT_ID") and env("GOOGLE_CLIENT_SECRET"):
            return cls(api_task_id).get_tools()
        else:
            return []
