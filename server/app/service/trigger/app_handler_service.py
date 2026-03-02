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
Trigger App Handler Service

Modular service for handling app-specific webhook authentication, 
filtering, and payload normalization based on trigger_type.
"""

import re
from typing import Optional
from dataclasses import dataclass
from fastapi import Request
from sqlmodel import Session, select, and_
import logging

from app.model.trigger.trigger import Trigger
from app.model.config.config import Config
from app.model.trigger.app_configs import SlackTriggerConfig, WebhookTriggerConfig, ScheduleTriggerConfig
from app.type.trigger_types import TriggerType, ExecutionType, TriggerStatus
from app.type.config_group import ConfigGroup

logger = logging.getLogger("server_app_handler_service")


@dataclass
class AppHandlerResult:
    """Result from app handler operations."""
    success: bool
    data: Optional[dict] = None
    reason: Optional[str] = None


class BaseAppHandler:
    """Base class for app-specific handlers."""
    
    trigger_type: TriggerType
    execution_type: ExecutionType = ExecutionType.webhook
    config_group: Optional[str] = None
    
    async def get_credentials(self, session: Session, user_id: str) -> dict:
        """Get user credentials from config table."""
        if not self.config_group:
            return {}
        
        configs = session.exec(
            select(Config).where(
                and_(
                    Config.user_id == int(user_id),
                    Config.config_group == self.config_group
                )
            )
        ).all()
        return {config.config_name: config.config_value for config in configs}
    
    async def authenticate(
        self, 
        request: Request, 
        body: bytes, 
        trigger: Trigger, 
        session: Session
    ) -> AppHandlerResult:
        """
        Authenticate the incoming webhook request.
        Returns (success, challenge_response or None)
        """
        return AppHandlerResult(success=True)
    
    async def filter_event(
        self, 
        payload: dict, 
        trigger: Trigger
    ) -> AppHandlerResult:
        """
        Filter events based on trigger configuration.
        Returns (should_process, reason)
        """
        return AppHandlerResult(success=True, reason="ok")
    
    def normalize_payload(
        self, 
        payload: dict, 
        trigger: Trigger,
        request_meta: dict = None
    ) -> dict:
        """Normalize the payload for execution input."""
        return payload


class SlackAppHandler(BaseAppHandler):
    """Handler for Slack triggers."""
    
    trigger_type = TriggerType.slack_trigger
    execution_type = ExecutionType.slack
    config_group = ConfigGroup.SLACK.value
    
    async def authenticate(
        self, 
        request: Request, 
        body: bytes, 
        trigger: Trigger, 
        session: Session
    ) -> AppHandlerResult:
        """Handle Slack authentication and URL verification."""
        from camel.auth.slack_auth import SlackAuth
        
        credentials = await self.get_credentials(session, trigger.user_id)
        
        slack_auth = SlackAuth(
            signing_secret=credentials.get("SLACK_SIGNING_SECRET"),
            bot_token=credentials.get("SLACK_BOT_TOKEN"),
            api_token=credentials.get("SLACK_API_TOKEN"),
        )
        
        # Check for URL verification challenge
        challenge_response = slack_auth.get_verification_response(request, body)
        if challenge_response:
            # Return the challenge response (already in correct format: {"challenge": "..."})
            logger.info(f"Slack URL verification - challenge_response: {challenge_response}")
            return AppHandlerResult(success=True, data=challenge_response)
        
        # Verify webhook signature
        if not slack_auth.verify_webhook_request(request, body):
            logger.warning("Invalid Slack webhook signature", extra={
                "trigger_id": trigger.id
            })
            return AppHandlerResult(success=False, reason="invalid_signature")
        
        return AppHandlerResult(success=True)
    
    async def filter_event(
        self, 
        payload: dict, 
        trigger: Trigger
    ) -> AppHandlerResult:
        """Filter Slack events based on trigger config."""
        # Prefer 'config' field
        config_data = trigger.config or {}
        config = SlackTriggerConfig(**config_data)
        event = payload.get("event", {})
        event_type = event.get("type", "")
        
        # Check event type
        if not config.should_trigger(event_type):
            return AppHandlerResult(success=False, reason="event_type_not_configured")
        
        # Check channel filter (if channel_id is set, only trigger for that channel)
        if config.channel_id:
            if event.get("channel") != config.channel_id:
                return AppHandlerResult(success=False, reason="channel_not_matched")
        
        # Check bot message filter
        if config.ignore_bot_messages:
            if event.get("bot_id") or event.get("subtype") == "bot_message":
                return AppHandlerResult(success=False, reason="bot_message_ignored")
        
        # Check user filter
        if config.ignore_users and event.get("user") in config.ignore_users:
            return AppHandlerResult(success=False, reason="user_filtered")
        
        # Check message filter regex
        if config.message_filter and event.get("text"):
            if not re.search(config.message_filter, event.get("text", ""), re.IGNORECASE):
                return AppHandlerResult(success=False, reason="message_filter_not_matched")
        
        return AppHandlerResult(success=True, reason="ok")
    
    def normalize_payload(
        self, 
        payload: dict, 
        trigger: Trigger,
        request_meta: dict = None
    ) -> dict:
        """Normalize Slack event payload."""
        logger.info("Normalizing payload", extra={"payload": payload})
        # Prefer 'config' field
        config_data = trigger.config or {}
        config = SlackTriggerConfig(**config_data)
        event = payload.get("event", {})
        
        normalized = {
            "event_type": event.get("type"),
            "event_ts": event.get("event_ts"),
            "team_id": payload.get("team_id"),
            "user_id": event.get("user"),
            "channel_id": event.get("channel"),
            "text": event.get("text"),
            "message_ts": event.get("ts"),
            "thread_ts": event.get("thread_ts"),
            "reaction": event.get("reaction"),
            "files": event.get("files"),
            "event_id": payload.get("event_id") or payload.get("id")
        }
        
        # if config.include_raw_payload:
        #     normalized["raw_payload"] = payload
        
        return normalized


class DefaultWebhookHandler(BaseAppHandler):
    """Default handler for generic webhooks with config-based filtering."""
    
    trigger_type = TriggerType.webhook
    execution_type = ExecutionType.webhook
    
    async def filter_event(
        self, 
        payload: dict, 
        trigger: Trigger,
        headers: dict = None,
        body_raw: str = None
    ) -> AppHandlerResult:
        """Filter webhook events based on trigger config."""
        config_data = trigger.config or {}
        config = WebhookTriggerConfig(**config_data)
        
        # Get text content for message_filter (check body for text field or stringify)
        text = None
        if isinstance(payload, dict):
            text = payload.get("text") or payload.get("message") or payload.get("content")
        if text is None and body_raw:
            text = body_raw
        
        # Use the config's should_trigger method
        should_trigger, reason = config.should_trigger(
            body=body_raw or "",
            headers=headers or {},
            text=text
        )
        
        if not should_trigger:
            return AppHandlerResult(success=False, reason=reason)
        
        return AppHandlerResult(success=True, reason="ok")
    
    def normalize_payload(
        self, 
        payload: dict, 
        trigger: Trigger,
        request_meta: dict = None
    ) -> dict:
        """Normalize generic webhook payload with full request metadata."""
        config_data = trigger.config or {}
        config = WebhookTriggerConfig(**config_data)
        
        result = {"body": payload}
        
        if request_meta:
            # Include headers if configured
            if config.include_headers and "headers" in request_meta:
                result["headers"] = request_meta["headers"]
            
            # Include query params if configured
            if config.include_query_params and "query_params" in request_meta:
                result["query_params"] = request_meta["query_params"]
            
            # Include request metadata if configured
            if config.include_request_metadata:
                if "method" in request_meta:
                    result["method"] = request_meta["method"]
                if "url" in request_meta:
                    result["url"] = request_meta["url"]
                if "client_ip" in request_meta:
                    result["client_ip"] = request_meta["client_ip"]
        
        return result


class ScheduleAppHandler(BaseAppHandler):
    """
    Handler for scheduled triggers.
    
    Manages schedule-specific logic including:
    - Expiration checking (expirationDate for recurring schedules)
    - Date validation for one-time executions (date field)
    """
    
    trigger_type = TriggerType.schedule
    execution_type = ExecutionType.scheduled
    
    async def filter_event(
        self, 
        payload: dict, 
        trigger: Trigger
    ) -> AppHandlerResult:
        """
        Filter scheduled events based on trigger config.
        
        Checks:
        - If one-time (date set) and date has passed
        - If recurring with expirationDate and it has passed
        """
        config_data = trigger.config or {}
        
        try:
            config = ScheduleTriggerConfig(**config_data)
        except Exception as e:
            logger.warning(
                "Invalid schedule config",
                extra={"trigger_id": trigger.id, "error": str(e)}
            )
            # Allow execution if config is missing/invalid (backwards compatibility)
            return AppHandlerResult(success=True, reason="ok")
        
        # Check if schedule should execute
        should_execute, reason = config.should_execute()
        
        if not should_execute:
            return AppHandlerResult(success=False, reason=reason)
        
        return AppHandlerResult(success=True, reason="ok")
    
    def normalize_payload(
        self, 
        payload: dict, 
        trigger: Trigger,
        request_meta: dict = None
    ) -> dict:
        """Normalize scheduled trigger payload."""
        config_data = trigger.config or {}
        
        normalized = {
            "scheduled_at": payload.get("scheduled_at"),
            "trigger_id": trigger.id,
            "trigger_name": trigger.name,
            "is_single_execution": trigger.is_single_execution,
        }
        
        # Include config details if present
        if config_data:
            if config_data.get("date"):
                normalized["date"] = config_data.get("date")
            if config_data.get("expirationDate"):
                normalized["expirationDate"] = config_data.get("expirationDate")
        
        return normalized
    
    def check_and_handle_expiration(
        self, 
        trigger: Trigger, 
        session: Session
    ) -> bool:
        """
        Check if a schedule has expired and handle accordingly.
        
        Args:
            trigger: The trigger to check
            session: Database session for updates
            
        Returns:
            True if trigger is expired and was deactivated, False otherwise
        """
        config_data = trigger.config or {}
        
        try:
            config = ScheduleTriggerConfig(**config_data)
        except Exception as e:
            logger.warning(
                "Invalid schedule config during expiration check",
                extra={"trigger_id": trigger.id, "error": str(e)}
            )
            return False
        
        if config.is_expired():
            # Deactivate the trigger
            trigger.status = TriggerStatus.completed
            session.add(trigger)
            session.commit()
            
            logger.info(
                "Schedule trigger expired and deactivated",
                extra={
                    "trigger_id": trigger.id,
                    "trigger_name": trigger.name,
                    "expiration_date": config.expirationDate or config.date
                }
            )
            
            return True
        
        return False
    
    def validate_schedule_for_execution(
        self, 
        trigger: Trigger
    ) -> tuple[bool, str]:
        """
        Validate that a scheduled trigger is valid for execution.
        
        Args:
            trigger: The trigger to validate
            
        Returns:
            Tuple of (is_valid, reason)
        """
        config_data = trigger.config or {}
        
        try:
            config = ScheduleTriggerConfig(**config_data)
        except Exception as e:
            return False, f"invalid_config: {str(e)}"
        
        # Check expiration
        if config.is_expired():
            return False, "schedule_expired"
        
        return True, "ok"


# Registry of handlers by trigger_type
_HANDLERS: dict[TriggerType, BaseAppHandler] = {
    TriggerType.slack_trigger: SlackAppHandler(),
    TriggerType.webhook: DefaultWebhookHandler(),
    TriggerType.schedule: ScheduleAppHandler(),
}


def get_app_handler(trigger_type: TriggerType) -> Optional[BaseAppHandler]:
    """Get the handler for a trigger type."""
    return _HANDLERS.get(trigger_type)


def register_app_handler(trigger_type: TriggerType, handler: BaseAppHandler):
    """Register a new app handler."""
    _HANDLERS[trigger_type] = handler


def get_supported_trigger_types() -> list[TriggerType]:
    """Get list of trigger types with webhook support."""
    return list(_HANDLERS.keys())


def get_schedule_handler() -> ScheduleAppHandler:
    """Get the schedule handler instance."""
    return _HANDLERS.get(TriggerType.schedule)
