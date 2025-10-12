from typing import Any, Dict, List
import os

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from camel.toolkits import GoogleCalendarToolkit as BaseGoogleCalendarToolkit

SCOPES = ['https://www.googleapis.com/auth/calendar']

class GoogleCalendarToolkit(BaseGoogleCalendarToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        self.api_task_id = api_task_id
        self._token_path = (
            os.environ.get("GOOGLE_CALENDAR_TOKEN_PATH")
            or os.path.join(
                os.path.expanduser("~"),
                ".eigent",
                "tokens",
                "google_calendar",
                f"google_calendar_token_{api_task_id}.json",
            )
        )
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
        return super().create_event(
            event_title, start_time, end_time, description, location, attendees_email, timezone
        )

    @listen_toolkit(BaseGoogleCalendarToolkit.get_events)
    def get_events(
        self, max_results: int = 10, time_min: str | None = None
    ) -> List[Dict[str, Any]] | Dict[str, Any]:
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
        return super().update_event(
            event_id, event_title, start_time, end_time, description, location, attendees_email
        )

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

    def _get_calendar_service(self):
        from googleapiclient.discovery import build
        from google.auth.transport.requests import Request

        creds = self._authenticate()

        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            try:
                os.makedirs(os.path.dirname(self._token_path), exist_ok=True)
                with open(self._token_path, "w") as f:
                    f.write(creds.to_json())
            except Exception:
                pass

        return build("calendar", "v3", credentials=creds)

    def _authenticate(self):
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request

        client_id = os.environ.get("GOOGLE_CLIENT_ID")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
        refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN")
        token_uri = os.environ.get("GOOGLE_TOKEN_URI", "https://oauth2.googleapis.com/token")

        creds = None

        try:
            if os.path.exists(self._token_path):
                creds = Credentials.from_authorized_user_file(self._token_path, SCOPES)
        except Exception:
            creds = None

        if not creds and refresh_token:
            creds = Credentials(
                None,
                refresh_token=refresh_token,
                token_uri=token_uri,
                client_id=client_id,
                client_secret=client_secret,
                scopes=SCOPES,
            )

        if not creds:
            client_config = {
                "installed": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": token_uri,
                    "redirect_uris": ["http://localhost"],
                }
            }
            flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
            creds = flow.run_local_server(port=0)


        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())


        try:
            os.makedirs(os.path.dirname(self._token_path), exist_ok=True)
            with open(self._token_path, "w") as f:
                f.write(creds.to_json())
        except Exception:
            pass

        return creds