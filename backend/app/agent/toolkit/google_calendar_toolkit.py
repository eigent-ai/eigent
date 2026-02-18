# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import logging
import os
import threading

from camel.toolkits import GoogleCalendarToolkit as BaseGoogleCalendarToolkit

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.oauth_state_manager import oauth_state_manager

logger = logging.getLogger("main")

SCOPES = ["https://www.googleapis.com/auth/calendar"]


@auto_listen_toolkit(BaseGoogleCalendarToolkit)
class GoogleCalendarToolkit(BaseGoogleCalendarToolkit, AbstractToolkit):
    agent_name: str = Agents.social_media_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        self.api_task_id = api_task_id
        # Use a stable token file (no per-task suffix).
        # Can be overridden by env.
        self._token_path = env("GOOGLE_CALENDAR_TOKEN_PATH") or os.path.join(
            os.path.expanduser("~"),
            ".eigent",
            "tokens",
            "google_calendar",
            "google_calendar_token.json",
        )
        super().__init__(timeout)

    @classmethod
    def _build_canonical_token_path(cls) -> str:
        return env("GOOGLE_CALENDAR_TOKEN_PATH") or os.path.join(
            os.path.expanduser("~"),
            ".eigent",
            "tokens",
            "google_calendar",
            "google_calendar_token.json",
        )

    @classmethod
    def get_can_use_tools(cls, api_task_id: str):
        from dotenv import load_dotenv

        # Force reload environment variables
        default_env_path = os.path.join(
            os.path.expanduser("~"), ".eigent", ".env"
        )
        if os.path.exists(default_env_path):
            load_dotenv(dotenv_path=default_env_path, override=True)

        if os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get(
            "GOOGLE_CLIENT_SECRET"
        ):
            return cls(api_task_id).get_tools()
        else:
            return []

    def _get_calendar_service(self):
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build

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
        from dotenv import load_dotenv
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

        # Force reload environment variables from default .env file
        default_env_path = os.path.join(
            os.path.expanduser("~"), ".eigent", ".env"
        )
        if os.path.exists(default_env_path):
            load_dotenv(dotenv_path=default_env_path, override=True)

        creds = None

        # First, try to load from token file
        # (canonical then legacy install_auth)
        try:
            if os.path.exists(self._token_path):
                logger.info(
                    f"Loading credentials from token file: {self._token_path}"
                )
                creds = Credentials.from_authorized_user_file(
                    self._token_path, SCOPES
                )
                logger.info("Successfully loaded credentials from token file")
            elif os.path.exists(
                self._token_path.replace(
                    "google_calendar_token.json",
                    "google_calendar_token_install_auth.json",
                )
            ):
                legacy_path = self._token_path.replace(
                    "google_calendar_token.json",
                    "google_calendar_token_install_auth.json",
                )
                logger.info(
                    "Loading credentials from "
                    f"legacy token file: {legacy_path}"
                )
                creds = Credentials.from_authorized_user_file(
                    legacy_path, SCOPES
                )
                logger.info(
                    "Successfully loaded credentials from legacy token file"
                )
        except Exception as e:
            logger.warning(f"Could not load from token file: {e}")
            creds = None

        # If no token file, try environment variables
        if not creds:
            client_id = os.environ.get("GOOGLE_CLIENT_ID")
            client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
            refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN")
            token_uri = (
                os.environ.get("GOOGLE_TOKEN_URI")
                or "https://oauth2.googleapis.com/token"
            )

            if refresh_token and client_id and client_secret:
                logger.info("Creating credentials from environment variables")
                creds = Credentials(
                    None,
                    refresh_token=refresh_token,
                    token_uri=token_uri,
                    client_id=client_id,
                    client_secret=client_secret,
                    scopes=SCOPES,
                )

        # If still no creds, check background authorization
        if not creds:
            state = oauth_state_manager.get_state("google_calendar")
            if state and state.status == "success" and state.result:
                logger.info("Using credentials from background authorization")
                creds = state.result
            else:
                # No credentials available
                raise ValueError(
                    "No credentials available. "
                    "Please run authorization first "
                    "via /api/install/tool/"
                    "google_calendar"
                )

        # Refresh if expired
        if creds and creds.expired and creds.refresh_token:
            try:
                logger.info("Token expired, refreshing...")
                creds.refresh(Request())
                logger.info("Token refreshed successfully")
            except Exception as e:
                logger.error(f"Failed to refresh token: {e}")
                raise ValueError(
                    "Failed to refresh expired token. Please re-authorize."
                )

        # Save credentials
        try:
            os.makedirs(os.path.dirname(self._token_path), exist_ok=True)
            with open(self._token_path, "w") as f:
                f.write(creds.to_json())
        except Exception as e:
            logger.warning(f"Could not save credentials: {e}")

        return creds

    @staticmethod
    def start_background_auth(api_task_id: str = "install_auth") -> str:
        """
        Start background OAuth authorization flow with timeout
        Returns the status of the authorization
        """
        from dotenv import load_dotenv
        from google_auth_oauthlib.flow import InstalledAppFlow

        # Force reload environment variables from default .env file
        default_env_path = os.path.join(
            os.path.expanduser("~"), ".eigent", ".env"
        )
        if os.path.exists(default_env_path):
            logger.info(
                f"Reloading environment variables from {default_env_path}"
            )
            load_dotenv(dotenv_path=default_env_path, override=True)

        # Check if there's an existing authorization and force stop it
        old_state = oauth_state_manager.get_state("google_calendar")
        if old_state and old_state.status in ["pending", "authorizing"]:
            logger.info("Found existing authorization, forcing shutdown...")
            old_state.cancel()
            # Try to shutdown the old server if it exists
            if hasattr(old_state, "server") and old_state.server:
                try:
                    old_state.server.shutdown()
                    logger.info("Old server shutdown successfully")
                except Exception as e:
                    logger.warning(f"Could not shutdown old server: {e}")

        # Create new state for this authorization
        state = oauth_state_manager.create_state("google_calendar")

        def auth_flow():
            try:
                state.status = "authorizing"
                oauth_state_manager.update_status(
                    "google_calendar", "authorizing"
                )

                # Reload environment variables in this thread
                from dotenv import load_dotenv

                default_env_path = os.path.join(
                    os.path.expanduser("~"), ".eigent", ".env"
                )
                if os.path.exists(default_env_path):
                    load_dotenv(dotenv_path=default_env_path, override=True)

                client_id = os.environ.get("GOOGLE_CLIENT_ID")
                client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
                token_uri = (
                    os.environ.get("GOOGLE_TOKEN_URI")
                    or "https://oauth2.googleapis.com/token"
                )

                logger.info(
                    "Google Calendar auth - "
                    f"client_id present: {bool(client_id)}"
                    ", client_secret present: "
                    f"{bool(client_secret)}"
                )

                if not client_id or not client_secret:
                    error_msg = (
                        "GOOGLE_CLIENT_ID and "
                        "GOOGLE_CLIENT_SECRET must be "
                        "set in environment variables"
                    )
                    logger.error(error_msg)
                    raise ValueError(error_msg)

                client_config = {
                    "installed": {
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": token_uri,
                        "redirect_uris": ["http://localhost"],
                    }
                }
                logger.debug(
                    "calendar client_config initialized"
                    f" with client_id: {client_id[:10]}..."
                )
                flow = InstalledAppFlow.from_client_config(
                    client_config, SCOPES
                )

                # Check for cancellation before starting
                if state.is_cancelled():
                    logger.info("Authorization cancelled before starting")
                    return

                # This will automatically open browser
                # and wait for user authorization
                logger.info("=" * 80)
                logger.info(
                    f"[Thread {threading.current_thread().name}]"
                    " Starting local server for "
                    "Google Calendar authorization"
                )
                logger.info("Browser should open automatically in a moment...")
                logger.info("=" * 80)

                # Run local server - this will block
                # until authorization completes
                # Note: Each call uses a random port
                # (port=0), so multiple concurrent
                # attempts won't conflict
                try:
                    success_msg = (
                        "<h1>Authorization successful!"
                        "</h1><p>You can close this "
                        "window and return to "
                        "Eigent.</p>"
                    )
                    creds = flow.run_local_server(
                        port=0,
                        authorization_prompt_message="",
                        success_message=success_msg,
                        open_browser=True,
                    )
                    logger.info("Authorization flow completed successfully!")
                except Exception as server_error:
                    logger.error(
                        f"Error during run_local_server: {server_error}"
                    )
                    raise

                # Check for cancellation after auth
                if state.is_cancelled():
                    logger.info("Authorization cancelled after completion")
                    return

                # Save credentials to token file
                token_path = env("GOOGLE_CALENDAR_TOKEN_PATH") or os.path.join(
                    os.path.expanduser("~"),
                    ".eigent",
                    "tokens",
                    "google_calendar",
                    "google_calendar_token.json",
                )

                try:
                    os.makedirs(os.path.dirname(token_path), exist_ok=True)
                    with open(token_path, "w") as f:
                        f.write(creds.to_json())
                    logger.info(
                        f"Saved Google Calendar credentials to {token_path}"
                    )
                except Exception as e:
                    logger.warning(f"Could not save credentials: {e}")

                # Update state with success
                oauth_state_manager.update_status(
                    "google_calendar", "success", result=creds
                )
                logger.info("Google Calendar authorization successful!")

            except Exception as e:
                if state.is_cancelled():
                    logger.info("Authorization was cancelled")
                    oauth_state_manager.update_status(
                        "google_calendar", "cancelled"
                    )
                else:
                    error_msg = str(e)
                    logger.error(
                        f"Google Calendar authorization failed: {error_msg}"
                    )
                    oauth_state_manager.update_status(
                        "google_calendar", "failed", error=error_msg
                    )
            finally:
                # Clean up server reference
                state.server = None

        # Start authorization in background thread
        thread = threading.Thread(
            target=auth_flow,
            daemon=True,
            name=f"GoogleCalendar-OAuth-{state.started_at.timestamp()}",
        )
        state.thread = thread
        thread.start()

        logger.info("Started background Google Calendar authorization")
        return "authorizing"
