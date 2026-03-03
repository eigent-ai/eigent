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

"""
Slack Trigger Configuration Models

Configuration models for Slack webhook triggers. These are stored in the 
trigger's config field and used by the webhook controller for 
app-specific event handling.
"""

from enum import StrEnum
from typing import Optional, List, TYPE_CHECKING
from pydantic import Field

from app.model.trigger.app_configs.base_config import BaseTriggerConfig
from app.type.config_group import ConfigGroup

if TYPE_CHECKING:
    from sqlmodel import Session


class SlackEventType(StrEnum):
    """Slack event types that can trigger the workflow"""
    ANY = "any_event"
    APP_MENTION = "app_mention"
    MESSAGE = "message"
    FILE_SHARED = "file_shared"
    FILE_PUBLIC = "file_public"
    CHANNEL_CREATED = "channel_created"
    CHANNEL_ARCHIVE = "channel_archive"
    CHANNEL_UNARCHIVE = "channel_unarchive"
    CHANNEL_RENAME = "channel_rename"
    MEMBER_JOINED_CHANNEL = "member_joined_channel"
    MEMBER_LEFT_CHANNEL = "member_left_channel"
    TEAM_JOIN = "team_join"
    REACTION_ADDED = "reaction_added"
    REACTION_REMOVED = "reaction_removed"
    PIN_ADDED = "pin_added"
    PIN_REMOVED = "pin_removed"
    APP_HOME_OPENED = "app_home_opened"


class SlackTriggerConfig(BaseTriggerConfig):
    """
    Slack-specific trigger configuration.
    
    Extends BaseTriggerConfig with Slack-specific fields for event handling,
    channel filtering, and bot message handling.
    """
    # Override: Slack triggers require authentication
    authentication_required: bool = Field(
        default=True,
        description="Whether authentication is required for this trigger",
        json_schema_extra={
            "ui:widget": "switch",
            "ui:label": "triggers.slack.authentication_required.label",
            "ui:notice": "triggers.slack.authentication_required.notice",
            "hidden": True
        },
    )
    
    # API Key
    SLACK_BOT_TOKEN: Optional[str] = Field(
        default=None,
        description="Slack Bot Token for API access",
        json_schema_extra={
            "ui:label": "triggers.slack.bot_token.label",
            "ui:widget": "text-input",
            "ui:widget:type": "secret",
            "ui:placeholder": "triggers.slack.bot_token.placeholder",
            "ui:notice": "triggers.slack.bot_token.notice",
            "minLength": 20,
            "maxLength": 200,
            "pattern": "^xoxb-",
            "api:GET": f"/configs?config_group={ConfigGroup.SLACK.value}",
            "api:POST": "/configs",
            "api:PUT": "/configs/{config_id}",
            "config_group": ConfigGroup.SLACK.value,
            "exclude": True # Exclude from saving to trigger/config
        },
    )
    SLACK_SIGNING_SECRET: Optional[str] = Field(
        default=None,
        description="Slack Signing Secret for API request verification",
        json_schema_extra={
            "ui:label": "triggers.slack.signing_secret.label",
            "ui:widget": "text-input",
            "ui:widget:type": "secret",
            "ui:placeholder": "triggers.slack.signing_secret.placeholder",
            "ui:notice": "triggers.slack.signing_secret.notice",
            "minLength": 32,
            "maxLength": 64,
            "pattern": "^[a-f0-9]+$",
            "api:GET": f"/configs?config_group={ConfigGroup.SLACK.value}",
            "api:POST": "/configs",
            "api:PUT": "/configs/{config_id}",
            "config_group": ConfigGroup.SLACK.value,
            "exclude": True # Exclude from saving to trigger/config
        },
    )
    
    # Event Selection
    events: List[SlackEventType] = Field(
        default=[SlackEventType.MESSAGE],
        description="Slack event types to trigger on",
        json_schema_extra={
            "ui:label": "triggers.slack.events.label",
            "ui:widget": "multi-select",
            "ui:options": [{"label": e.value, "value": e.value} for e in SlackEventType],
            "ui:notice": "triggers.slack.events.notice"
        }
    )
    
    # Channel Configuration    
    channel_id: Optional[str] = Field(
        default=None,
        description="Specific channel ID to watch",
        json_schema_extra={
            "ui:label": "triggers.slack.channel_id.label",
            "ui:widget": "multi-select",
            "ui:options": ["fetch channel IDs from Slack API"],
            "ui:placeholder": "triggers.slack.channel_id.placeholder",
            "pattern": "^C[A-Z0-9]{8,}$",
            "api:GET": "trigger/slack/channels",
            "ui:notice": "triggers.slack.channel_id.notice",
            "hidden": True
        },
    )
    
    # Slack-Specific Filtering Options
    ignore_bot_messages: bool = Field(
        default=True,
        description="Ignore messages from bots",
        json_schema_extra={
            "ui:widget": "switch",
            "ui:label": "triggers.slack.ignore_bot_messages.label",
        },
    )
    
    ignore_users: List[str] = Field(
        default=[],
        description="User IDs to ignore",
        json_schema_extra={
            "ui:label": "triggers.slack.ignore_users.label",
            "ui:widget": "multi-text-input",
            "ui:placeholder": "triggers.slack.ignore_users.placeholder",
            "ui:notice": "triggers.slack.ignore_users.notice",
            "pattern": "^U[A-Z0-9]{8,}$"
        },
    )

    def get_required_config_group(self) -> ConfigGroup:
        """Get the config group required for Slack triggers."""
        return ConfigGroup.SLACK
    
    def get_required_credentials(self) -> List[str]:
        """Get the list of required Slack credentials."""
        return ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"]

    def should_trigger(self, event_type: str) -> bool:
        """Check if this event type should trigger the workflow."""
        if "any_event" in self.events:
            return True
        return event_type in self.events

    @classmethod
    def validate_config(cls, config_data: dict) -> "SlackTriggerConfig":
        """Validate and return a SlackTriggerConfig instance."""
        return cls(**config_data)