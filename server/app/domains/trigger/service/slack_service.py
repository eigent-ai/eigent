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

"""SlackService: Slack integration helpers (channel listing)."""

from loguru import logger
from sqlmodel import select, and_

from app.core.database import session_make
from app.model.config.config import Config
from app.shared.types.config_group import ConfigGroup


class SlackService:
    """Slack integration - static methods."""

    @staticmethod
    def get_channels(user_id: int) -> dict:
        """Fetch Slack channels for user. Returns {"success": True, "channels": [...], "has_credentials": True} or error."""
        with session_make() as s:
            configs = s.exec(
                select(Config).where(
                    and_(
                        Config.user_id == int(user_id),
                        Config.config_group == ConfigGroup.SLACK.value,
                    )
                )
            ).all()

        credentials = {config.config_name: config.config_value for config in configs}
        bot_token = credentials.get("SLACK_BOT_TOKEN")

        if not bot_token:
            logger.warning("Slack credentials not found", extra={"user_id": user_id})
            return {"success": True, "channels": [], "has_credentials": False}

        try:
            from slack_sdk import WebClient
            from slack_sdk.errors import SlackApiError

            client = WebClient(token=bot_token)
            channels = []
            cursor = None

            while True:
                response = client.conversations_list(
                    types="public_channel,private_channel",
                    cursor=cursor,
                    limit=200,
                )
                for channel in response.get("channels", []):
                    channels.append({
                        "id": channel.get("id"),
                        "name": channel.get("name"),
                        "is_private": channel.get("is_private", False),
                        "is_member": channel.get("is_member", False),
                        "num_members": channel.get("num_members"),
                    })
                cursor = response.get("response_metadata", {}).get("next_cursor")
                if not cursor:
                    break

            logger.info("Slack channels fetched", extra={"user_id": user_id, "channel_count": len(channels)})
            return {"success": True, "channels": channels, "has_credentials": True}

        except ImportError:
            logger.error("slack_sdk not installed")
            return {"success": False, "error_code": "SLACK_SDK_NOT_INSTALLED"}
        except Exception as e:
            error_detail = getattr(e, "response", {}).get("error", str(e)) if hasattr(e, "response") else str(e)
            logger.error("Slack API error", extra={"user_id": user_id, "error": error_detail})
            return {"success": False, "error_code": "SLACK_API_ERROR", "detail": error_detail}
