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

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, and_
from typing import Optional, List
import logging
from pydantic import BaseModel

from app.model.config.config import Config
from app.type.config_group import ConfigGroup
from app.component.auth import Auth, auth_must
from app.component.database import session

logger = logging.getLogger("server_slack_controller")


class SlackChannelOut(BaseModel):
    """Output model for Slack channels."""
    id: str
    name: str
    is_private: bool = False
    is_member: bool = False
    num_members: Optional[int] = None


class SlackChannelsResponse(BaseModel):
    """Response model for Slack channels list."""
    channels: List[SlackChannelOut]
    has_credentials: bool


router = APIRouter(prefix="/trigger/slack", tags=["Slack Integration"])


@router.get("/channels", name="get slack channels")
def get_slack_channels(
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
) -> SlackChannelsResponse:
    """
    Get list of Slack channels for the authenticated user.
    
    This endpoint fetches channels from the user's Slack workspace using their
    stored credentials. Requires SLACK_BOT_TOKEN to be configured in user configs.
    """
    user_id = auth.user.id
    
    # Get Slack credentials from config
    configs = session.exec(
        select(Config).where(
            and_(
                Config.user_id == int(user_id),
                Config.config_group == ConfigGroup.SLACK.value
            )
        )
    ).all()
    
    credentials = {config.config_name: config.config_value for config in configs}
    bot_token = credentials.get("SLACK_BOT_TOKEN")
    
    if not bot_token:
        logger.warning("Slack credentials not found", extra={"user_id": user_id})
        return SlackChannelsResponse(channels=[], has_credentials=False)
    
    try:
        from slack_sdk import WebClient
        from slack_sdk.errors import SlackApiError
        
        client = WebClient(token=bot_token)
        
        # Fetch all channels (public and private the bot has access to)
        channels = []
        cursor = None
        
        while True:
            response = client.conversations_list(
                types="public_channel,private_channel",
                cursor=cursor,
                limit=200
            )
            
            for channel in response.get("channels", []):
                channels.append(SlackChannelOut(
                    id=channel.get("id"),
                    name=channel.get("name"),
                    is_private=channel.get("is_private", False),
                    is_member=channel.get("is_member", False),
                    num_members=channel.get("num_members")
                ))
            
            # Check for pagination
            cursor = response.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break
        
        logger.info("Slack channels fetched", extra={
            "user_id": user_id,
            "channel_count": len(channels)
        })
        
        return SlackChannelsResponse(channels=channels, has_credentials=True)
        
    except ImportError:
        logger.error("slack_sdk not installed")
        raise HTTPException(
            status_code=500, 
            detail="Slack SDK not installed on server"
        )
    except SlackApiError as e:
        logger.error("Slack API error", extra={
            "user_id": user_id,
            "error": str(e)
        })
        raise HTTPException(
            status_code=400, 
            detail=f"Slack API error: {e.response.get('error', 'Unknown error')}"
        )
    except Exception as e:
        logger.error("Error fetching Slack channels", extra={
            "user_id": user_id,
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch Slack channels")
