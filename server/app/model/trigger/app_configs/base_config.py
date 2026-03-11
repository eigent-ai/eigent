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
Base Trigger Configuration Models

Base configuration models that all app-specific trigger configs should extend from.
Contains common fields and validation logic shared across all trigger types.
"""

import re
from typing import Optional, List, Dict, Any, TYPE_CHECKING
from pydantic import BaseModel, Field, field_validator

from app.type.config_group import ConfigGroup

if TYPE_CHECKING:
    from sqlmodel import Session


class ActivationError(Exception):
    """Exception raised when trigger activation requirements are not met."""
    def __init__(self, message: str, missing_requirements: List[str] = None):
        self.message = message
        self.missing_requirements = missing_requirements or []
        super().__init__(self.message)


class BaseTriggerConfig(BaseModel):
    """
    Base trigger configuration that all app-specific configs should extend.
    
    Contains common fields like message filtering and authentication requirements
    that are shared across different trigger types.
    """
    
    # Authentication Configuration
    authentication_required: bool = Field(
        default=False,
        description="Whether authentication is required for this trigger",
        json_schema_extra={
            "ui:widget": "switch",
            "ui:label": "triggers.base.authentication_required.label",
            "ui:notice": "triggers.base.authentication_required.notice"
        },
    )
    
    # Auto-disable Configuration
    max_failure_count: Optional[int] = Field(
        default=None,
        description="Maximum consecutive failures before auto-disabling the trigger. Set to None to disable this feature.",
        ge=1,
        le=100,
        json_schema_extra={
            "ui:widget": "number-input",
            "ui:label": "triggers.base.max_failure_count.label",
            "ui:placeholder": "triggers.base.max_failure_count.placeholder",
            "ui:notice": "triggers.base.max_failure_count.notice"
        },
    )
    
    # Common Filtering Options
    message_filter: Optional[str] = Field(
        default=None,
        description="Regex pattern to filter incoming messages/events",
        json_schema_extra={
            "ui:label": "triggers.base.message_filter.label",
            "ui:widget": "text-input",
            "ui:placeholder": "triggers.base.message_filter.placeholder",
            "ui:notice": "triggers.base.message_filter.notice",
            "ui:validation": "regex",
            "maxLength": 500
        },
    )
    
    @field_validator("message_filter")
    @classmethod
    def validate_regex(cls, v):
        """Validate that the message_filter is a valid regex pattern."""
        if v is None:
            return v
        try:
            re.compile(v)
        except re.error as e:
            raise ValueError(f"Invalid regex: {e}")
        return v
    
    def matches_filter(self, text: Optional[str]) -> bool:
        """
        Check if the given text matches the message filter.
        
        Args:
            text: The text to check against the filter
            
        Returns:
            True if no filter is set, or if the text matches the filter
        """
        if self.message_filter is None or text is None:
            return True
        
        pattern = re.compile(self.message_filter)
        return bool(pattern.search(text))
    
    def should_auto_disable(self, consecutive_failures: int) -> bool:
        """
        Check if the trigger should be auto-disabled based on failure count.
        
        Args:
            consecutive_failures: The current number of consecutive failures
            
        Returns:
            True if the trigger should be disabled, False otherwise
        """
        if self.max_failure_count is None:
            return False
        return consecutive_failures >= self.max_failure_count
    
    def get_required_config_group(self) -> Optional[ConfigGroup]:
        """
        Get the config group required for this trigger type.
        
        Override this in subclasses to specify the config group (e.g., ConfigGroup.SLACK).
        This leverages the same ConfigGroup enum used by toolkits, ensuring triggers
        and toolkits for the same service share credentials.
        
        Returns:
            The ConfigGroup enum value, or None if no config group is required
        """
        return None
    
    def get_required_credentials(self) -> List[str]:
        """
        Get the list of required credential names for this trigger.
        
        Override this in subclasses to specify required credentials.
        
        Returns:
            List of credential names that must be present (e.g., ["SLACK_BOT_TOKEN"])
        """
        return []
    
    # Built in, depends on ConfigInfo from models/config/config.py
    def check_activation_requirements(
        self, 
        user_id: int, 
        session: "Session"
    ) -> Dict[str, Any]:
        """
        Check if all activation requirements are met for this trigger.
        
        Args:
            user_id: The ID of the user who owns the trigger
            session: Database session for querying credentials
            
        Returns:
            Dict with:
                - can_activate: bool - whether the trigger can be activated
                - missing_requirements: list - list of missing requirements
                - message: str - human-readable status message
                
        Raises:
            ActivationError: If activation requirements are not met
        """
        if not self.authentication_required:
            return {
                "can_activate": True,
                "missing_requirements": [],
                "message": "Authentication not required"
            }
        
        config_group = self.get_required_config_group()
        required_credentials = self.get_required_credentials()
        
        if not config_group or not required_credentials:
            return {
                "can_activate": True,
                "missing_requirements": [],
                "message": "No specific credentials required"
            }
        
        # Import here to avoid circular imports
        from sqlmodel import select, and_
        from app.model.config.config import Config
        
        # Query for user's credentials in the required config group
        # Use config_group.value since config_group is now a ConfigGroup enum
        configs = session.exec(
            select(Config).where(
                and_(
                    Config.user_id == int(user_id),
                    Config.config_group == config_group.value
                )
            )
        ).all()
        
        available_credentials = {
            config.config_name: config.config_value 
            for config in configs 
            if config.config_value  # Only count non-empty values
        }
        
        missing = [
            cred for cred in required_credentials 
            if cred not in available_credentials
        ]
        
        if missing:
            return {
                "can_activate": False,
                "missing_requirements": missing,
                "message": f"Missing required credentials: {', '.join(missing)}"
            }
        
        return {
            "can_activate": True,
            "missing_requirements": [],
            "message": "All requirements met"
        }
    
    def validate_activation(self, user_id: int, session: "Session") -> None:
        """
        Validate that the trigger can be activated.
        
        Args:
            user_id: The ID of the user who owns the trigger
            session: Database session for querying credentials
            
        Raises:
            ActivationError: If activation requirements are not met
        """
        result = self.check_activation_requirements(user_id, session)
        
        if not result["can_activate"]:
            raise ActivationError(
                message=result["message"],
                missing_requirements=result["missing_requirements"]
            )
    
    @classmethod
    def validate_config(cls, config_data: dict) -> "BaseTriggerConfig":
        """Validate and return a config instance."""
        return cls(**config_data)
