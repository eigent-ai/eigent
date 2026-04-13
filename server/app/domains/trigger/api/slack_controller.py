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

"""Slack integration controller. Uses SlackService."""

from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List
from pydantic import BaseModel

from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth
from app.domains.trigger.service.slack_service import SlackService


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
def get_slack_channels(auth: V1UserAuth = Depends(auth_must)) -> SlackChannelsResponse:
    result = SlackService.get_channels(auth.id)
    if not result["success"]:
        error_map = {
            "SLACK_SDK_NOT_INSTALLED": (500, "Slack SDK not installed on server"),
            "SLACK_API_ERROR": (400, f"Slack API error: {result.get('detail', 'Unknown error')}"),
        }
        status, msg = error_map.get(result["error_code"], (500, "Failed to fetch Slack channels"))
        raise HTTPException(status_code=status, detail=msg)
    return SlackChannelsResponse(
        channels=[SlackChannelOut(**ch) for ch in result["channels"]],
        has_credentials=result["has_credentials"],
    )
