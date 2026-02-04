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

import json
import logging
import os
import time

from camel.toolkits import LinkedInToolkit as BaseLinkedInToolkit
from camel.toolkits.function_tool import FunctionTool

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit

logger = logging.getLogger("linkedin_toolkit")

# LinkedIn access tokens expire after 60 days (in seconds)
LINKEDIN_TOKEN_LIFETIME_SECONDS = 60 * 24 * 60 * 60
# Refresh token when less than 7 days remaining
LINKEDIN_TOKEN_REFRESH_THRESHOLD_SECONDS = 7 * 24 * 60 * 60


@auto_listen_toolkit(BaseLinkedInToolkit)
class LinkedInToolkit(BaseLinkedInToolkit, AbstractToolkit):
    r"""LinkedIn toolkit for social media automation.

    This toolkit wraps CAMEL-AI's LinkedInToolkit and provides:
    - Post creation and deletion
    - Profile information retrieval
    - Token file persistence
    - Environment variable fallback
    """

    agent_name: str = Agents.social_media_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        self.api_task_id = api_task_id
        self._token_path = self._build_canonical_token_path()
        self._load_credentials()
        super().__init__(timeout)

    @classmethod
    def _build_canonical_token_path(cls) -> str:
        r"""Build the canonical path for storing LinkedIn tokens."""
        return env("LINKEDIN_TOKEN_PATH") or os.path.join(
            os.path.expanduser("~"),
            ".eigent",
            "tokens",
            "linkedin",
            "linkedin_token.json",
        )

    def _load_credentials(self):
        r"""Load credentials from token file or environment variables."""
        from dotenv import load_dotenv

        # Force reload environment variables from default .env file
        default_env_path = os.path.join(
            os.path.expanduser("~"), ".eigent", ".env"
        )
        if os.path.exists(default_env_path):
            load_dotenv(dotenv_path=default_env_path, override=True)

        # Try to load from token file first
        if os.path.exists(self._token_path):
            try:
                with open(self._token_path) as f:
                    token_data = json.load(f)
                    access_token = token_data.get("access_token")
                    if access_token:
                        # Check if token is expired before loading
                        expires_at = token_data.get("expires_at")
                        if expires_at and int(time.time()) >= expires_at:
                            logger.warning(
                                "LinkedIn token file contains "
                                "expired token, skipping load"
                            )
                        else:
                            os.environ["LINKEDIN_ACCESS_TOKEN"] = access_token
                            logger.info(
                                "Loaded LinkedIn credentials "
                                "from token file: "
                                f"{self._token_path}"
                            )
            except Exception as e:
                logger.warning(f"Could not load LinkedIn token file: {e}")

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        r"""Return tools only if LinkedIn credentials are configured."""
        from dotenv import load_dotenv

        # Force reload environment variables
        default_env_path = os.path.join(
            os.path.expanduser("~"), ".eigent", ".env"
        )
        if os.path.exists(default_env_path):
            load_dotenv(dotenv_path=default_env_path, override=True)

        # Check for token file
        token_path = cls._build_canonical_token_path()
        if os.path.exists(token_path):
            try:
                with open(token_path) as f:
                    token_data = json.load(f)
                    access_token = token_data.get("access_token")
                    if access_token:
                        # Check if token is expired before loading
                        expires_at = token_data.get("expires_at")
                        if expires_at and int(time.time()) >= expires_at:
                            logger.warning(
                                "LinkedIn token file contains "
                                "expired token, skipping load"
                            )
                        else:
                            os.environ["LINKEDIN_ACCESS_TOKEN"] = access_token
            except Exception:
                pass

        if env("LINKEDIN_ACCESS_TOKEN"):
            return LinkedInToolkit(api_task_id).get_tools()
        else:
            return []

    @classmethod
    def save_token(cls, token_data: dict) -> bool:
        r"""Save OAuth token to file.

        Args:
            token_data: Dictionary containing access_token
                and optionally refresh_token

        Returns:
            True if saved successfully, False otherwise
        """
        token_path = cls._build_canonical_token_path()
        try:
            # Add timestamp for expiration tracking if not present
            if "saved_at" not in token_data:
                token_data["saved_at"] = int(time.time())

            # Calculate expiration time if expires_in is provided
            if "expires_in" in token_data and "expires_at" not in token_data:
                token_data["expires_at"] = (
                    token_data["saved_at"] + token_data["expires_in"]
                )
            elif "expires_at" not in token_data:
                # Default to 60 days if no expiration info provided
                token_data["expires_at"] = (
                    token_data["saved_at"] + LINKEDIN_TOKEN_LIFETIME_SECONDS
                )

            os.makedirs(os.path.dirname(token_path), exist_ok=True)
            with open(token_path, "w") as f:
                json.dump(token_data, f, indent=2)
            logger.info(f"Saved LinkedIn token to {token_path}")

            # Also update environment variable
            if token_data.get("access_token"):
                os.environ["LINKEDIN_ACCESS_TOKEN"] = token_data[
                    "access_token"
                ]

            return True
        except Exception as e:
            logger.error(f"Failed to save LinkedIn token: {e}")
            return False

    @classmethod
    def clear_token(cls) -> bool:
        r"""Remove stored token file and clear environment variable.

        Returns:
            True if cleared successfully, False otherwise
        """
        token_path = cls._build_canonical_token_path()
        try:
            if os.path.exists(token_path):
                os.remove(token_path)
                logger.info(f"Removed LinkedIn token file: {token_path}")

            # Also try to remove the parent directory if empty
            token_dir = os.path.dirname(token_path)
            if os.path.exists(token_dir) and not os.listdir(token_dir):
                os.rmdir(token_dir)
                logger.info(
                    f"Removed empty LinkedIn token directory: {token_dir}"
                )

            # Clear environment variable
            if "LINKEDIN_ACCESS_TOKEN" in os.environ:
                del os.environ["LINKEDIN_ACCESS_TOKEN"]

            return True
        except Exception as e:
            logger.error(f"Failed to clear LinkedIn token: {e}")
            return False

    @classmethod
    def is_authenticated(cls) -> bool:
        r"""Check if user has valid LinkedIn credentials.

        Returns:
            True if credentials are available, False otherwise
        """
        from dotenv import load_dotenv

        # Force reload environment variables
        default_env_path = os.path.join(
            os.path.expanduser("~"), ".eigent", ".env"
        )
        if os.path.exists(default_env_path):
            load_dotenv(dotenv_path=default_env_path, override=True)

        # Check token file
        token_path = cls._build_canonical_token_path()
        if os.path.exists(token_path):
            try:
                with open(token_path) as f:
                    token_data = json.load(f)
                    if token_data.get("access_token"):
                        return True
            except Exception:
                pass

        # Check environment variable
        return bool(env("LINKEDIN_ACCESS_TOKEN"))

    @classmethod
    def get_token_info(cls) -> dict | None:
        r"""Get stored token information including expiration.

        Returns:
            Token data dictionary or None if not available
        """
        token_path = cls._build_canonical_token_path()
        if os.path.exists(token_path):
            try:
                with open(token_path) as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    @classmethod
    def is_token_expiring_soon(cls) -> bool:
        r"""Check if token is expiring within the refresh threshold.

        Returns:
            True if token is expiring soon or already expired, False otherwise.
            Returns False if no token file exists (e.g. env var auth only).
        """
        token_info = cls.get_token_info()
        if not token_info:
            # No token file; cannot determine expiry
            return False

        expires_at = token_info.get("expires_at")
        if not expires_at:
            return False  # No expiration info, assume valid

        current_time = int(time.time())
        time_remaining = expires_at - current_time

        return time_remaining < LINKEDIN_TOKEN_REFRESH_THRESHOLD_SECONDS

    @classmethod
    def is_token_expired(cls) -> bool:
        r"""Check if token has expired.

        Returns:
            True if token is expired, False otherwise.
            Returns False if no token file exists (e.g. env var auth only).
        """
        token_info = cls.get_token_info()
        if not token_info:
            # No token file; cannot determine expiry
            return False

        expires_at = token_info.get("expires_at")
        if not expires_at:
            return False  # No expiration info, assume valid

        return int(time.time()) >= expires_at

    def get_profile_safe(self) -> dict:
        r"""Get LinkedIn profile with error handling.

        Returns:
            Profile dictionary or error information
        """
        try:
            return self.get_profile(include_id=True)
        except Exception as e:
            logger.error(f"Failed to get LinkedIn profile: {e}")
            return {"error": str(e)}
