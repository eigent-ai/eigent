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
Schedule Trigger Configuration Models

Minimal configuration for scheduled triggers. Schedule details (time, day, weekday)
are handled by custom_cron_expression. This config only handles:
- date: For one-time executions (cron has no year)
- expirationDate: For recurring schedules with an end date
"""

from datetime import datetime, timezone
from typing import Optional, Tuple
from pydantic import Field, field_validator

from app.model.trigger.app_configs.base_config import BaseTriggerConfig


class ScheduleTriggerConfig(BaseTriggerConfig):
    """
    Minimal schedule trigger configuration.
    
    The cron expression handles time, day, weekday, and month scheduling.
    This config only handles what cron cannot:
    - date: Full date for one-time execution (cron has no year)
    - expirationDate: End date for recurring schedules
    
    Examples:
        Once (One-time execution):
        {
            "date": "2026-03-15"
        }
        
        Daily/Weekly/Monthly (no expiration):
        {}
        
        Daily/Weekly/Monthly (with expiration):
        {
            "expirationDate": "2026-06-30"
        }
    """
    
    # Date for one-time execution (YYYY-MM-DD format)
    # Required when is_single_execution=True because cron has no year
    date: Optional[str] = Field(
        default=None,
        description="Full date for one-time execution (YYYY-MM-DD). Required for is_single_execution=True since cron has no year."
    )
    
    # Expiration date for recurring schedules (YYYY-MM-DD format)
    expirationDate: Optional[str] = Field(
        default=None,
        description="End date for recurring schedules (YYYY-MM-DD). Schedule will be marked as completed after this date."
    )

    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate that date is in YYYY-MM-DD format."""
        if v is None:
            return None
        
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("Date must be in YYYY-MM-DD format")
        
        return v

    @field_validator("expirationDate")
    @classmethod
    def validate_expiration_date_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate that expiration date is in YYYY-MM-DD format."""
        if v is None:
            return None
        
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("Expiration date must be in YYYY-MM-DD format")
        
        return v

    def is_expired(self, check_date: Optional[datetime] = None) -> bool:
        """
        Check if the schedule has expired.
        
        For one-time (date is set): Check if date has passed
        For recurring (expirationDate is set): Check if expiration date has passed
        
        Args:
            check_date: Date to check against (defaults to now)
            
        Returns:
            True if the schedule has expired, False otherwise
        """
        if check_date is None:
            check_date = datetime.now(timezone.utc)
        
        # One-time execution: check if date has passed
        if self.date:
            execution_date = datetime.strptime(self.date, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
            return check_date > execution_date
        
        # Recurring with expiration: check if expiration date has passed
        if self.expirationDate:
            expiration = datetime.strptime(self.expirationDate, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
            return check_date > expiration
        
        # No expiration set
        return False

    def should_execute(self, check_date: Optional[datetime] = None) -> Tuple[bool, str]:
        """
        Check if the schedule should execute.
        
        Args:
            check_date: Date to check against (defaults to now)
            
        Returns:
            Tuple of (should_execute, reason)
        """
        if self.is_expired(check_date):
            return False, "schedule_expired"
        
        return True, "ok"

    @classmethod
    def validate_config(cls, config_data: dict) -> "ScheduleTriggerConfig":
        """Validate and return a ScheduleTriggerConfig instance."""
        return cls(**config_data)
