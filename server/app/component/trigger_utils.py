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

"""Rate limiting utilities for triggers."""
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING
import logging
from sqlmodel import select, and_

from app.model.trigger.trigger_execution import TriggerExecution
from app.component.environment import env

logger = logging.getLogger("server_trigger_utils")

if TYPE_CHECKING:
    from sqlmodel import Session
    from app.model.trigger.trigger import Trigger
    
    
# Environment variable configuration with defaults
MAX_DISPATCH_PER_TICK = int(env("TRIGGER_SCHEDULE_MAX_DISPATCH_PER_TICK", "0"))  # Max triggers to dispatch per tick
SCHEDULED_FETCH_BATCH_SIZE = int(env("TRIGGER_SCHEDULE_POLLER_BATCH_SIZE", "100"))  # Fetch batch size


def check_rate_limits(session: "Session", trigger: "Trigger") -> bool:
    """
    Check if trigger execution is within rate limits.
    
    Args:
        session: Database session
        trigger: The trigger to check rate limits for
        
    Returns:
        True if execution is allowed, False if rate limited
    """
    current_time = datetime.now(timezone.utc)
    
    # Check hourly limit
    if trigger.max_executions_per_hour:
        hour_ago = current_time - timedelta(hours=1)
        hourly_count = session.exec(
            select(TriggerExecution).where(
                and_(
                    TriggerExecution.trigger_id == trigger.id,
                    TriggerExecution.created_at >= hour_ago
                )
            )
        ).all()
        
        if len(hourly_count) >= trigger.max_executions_per_hour:
            logger.warning(
                "Trigger hourly rate limit exceeded",
                extra={
                    "trigger_id": trigger.id,
                    "limit": trigger.max_executions_per_hour,
                    "current_count": len(hourly_count)
                }
            )
            return False
    
    # Check daily limit
    if trigger.max_executions_per_day:
        day_ago = current_time - timedelta(days=1)
        daily_count = session.exec(
            select(TriggerExecution).where(
                and_(
                    TriggerExecution.trigger_id == trigger.id,
                    TriggerExecution.created_at >= day_ago
                )
            )
        ).all()
        
        if len(daily_count) >= trigger.max_executions_per_day:
            logger.warning(
                "Trigger daily rate limit exceeded",
                extra={
                    "trigger_id": trigger.id,
                    "limit": trigger.max_executions_per_day,
                    "current_count": len(daily_count)
                }
            )
            return False
    
    return True
