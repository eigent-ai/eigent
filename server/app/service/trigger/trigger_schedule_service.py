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

from datetime import datetime, timedelta, timezone
from typing import List, Tuple, Optional
import logging
from croniter import croniter
from uuid import uuid4
import asyncio
from sqlmodel import select

from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import TriggerExecution
from app.type.trigger_types import TriggerStatus, ExecutionType, ExecutionStatus, TriggerType
from app.component.trigger_utils import check_rate_limits, MAX_DISPATCH_PER_TICK
from app.model.trigger.app_configs import ScheduleTriggerConfig

logger = logging.getLogger("server_trigger_schedule_service")


class TriggerScheduleService:
    """Service for managing scheduled trigger operations.
       This service mainly delegates schedule business logic
       from the main trigger_service.py.
       
       Handles tasks from the Celery beat scheduler.
       
       Mainly handles:
       - Polling for due schedules
       - Dispatching scheduled triggers
       - Calculating next run times based on cron expressions
    """
    
    def __init__(self, session):
        """
        Initialize the schedule service with a database session.
        
        Args:
            session: SQLModel session for database operations
        """
        self.session = session
    
    def fetch_due_schedules(self, limit: Optional[int] = 100) -> List[Trigger]:
        """
        Fetch triggers that are due for execution.
        
        Args:
            limit: Maximum number of triggers to fetch
            
        Returns:
            List of triggers that need to be executed
        """
        now = datetime.now(timezone.utc)
        
        try:
            statement = (
                select(Trigger)
                .where(Trigger.trigger_type == TriggerType.schedule)
                .where(Trigger.status == TriggerStatus.active)
                .where(Trigger.next_run_at <= now)
                .order_by(Trigger.next_run_at)
                .limit(limit)
            )
            
            results = self.session.exec(statement).all()
            
            logger.debug(
                "Fetched due schedules",
                extra={
                    "count": len(results),
                    "current_time": now.isoformat()
                }
            )
            
            return list(results)
            
        except Exception as e:
            logger.error(
                "Failed to fetch due schedules",
                extra={"error": str(e)},
                exc_info=True
            )
            return []
    
    def calculate_next_run_at(
        self, 
        trigger: Trigger, 
        base_time: Optional[datetime] = None
    ) -> datetime:
        """
        Calculate the next run time for a trigger based on its cron expression.
        
        Args:
            trigger: The trigger to calculate next run time for
            base_time: Base time to calculate from (defaults to now)
            
        Returns:
            The next scheduled run time
            
        Raises:
            ValueError: If trigger has no cron expression or invalid expression
        """
        if not trigger.custom_cron_expression:
            raise ValueError(f"Trigger {trigger.id} has no cron expression")
        
        if base_time is None:
            base_time = datetime.now(timezone.utc)
        
        try:
            cron = croniter(trigger.custom_cron_expression, base_time)
            next_run = cron.get_next(datetime)
            return next_run
        except Exception as e:
            logger.error(
                "Failed to calculate next run time",
                extra={
                    "trigger_id": trigger.id,
                    "cron_expression": trigger.custom_cron_expression,
                    "error": str(e)
                }
            )
            raise
    
    def dispatch_trigger(self, trigger: Trigger) -> bool:
        """
        Dispatch a trigger for execution.
        
        Args:
            trigger: The trigger to dispatch
            
        Returns:
            True if dispatched successfully, False otherwise
        """
        try:
            # Check schedule expiration before dispatching
            if not self._check_schedule_valid(trigger):
                logger.info(
                    "Schedule trigger expired, skipping dispatch",
                    extra={"trigger_id": trigger.id, "trigger_name": trigger.name}
                )
                return False
            
            # Create execution record
            execution_id = str(uuid4())
            execution = TriggerExecution(
                trigger_id=trigger.id,
                execution_id=execution_id,
                execution_type=ExecutionType.scheduled,
                status=ExecutionStatus.pending,
                input_data={"scheduled_at": datetime.now(timezone.utc).isoformat()},
                started_at=datetime.now(timezone.utc)
            )
            
            self.session.add(execution)
            
            # Update trigger statistics
            trigger.last_executed_at = datetime.now(timezone.utc)
            trigger.last_execution_status = "pending"
            
            # Calculate and set next run time
            try:
                trigger.next_run_at = self.calculate_next_run_at(trigger, datetime.now(timezone.utc))
            except Exception as e:
                logger.error(
                    "Failed to calculate next run time, trigger will be skipped",
                    extra={"trigger_id": trigger.id, "error": str(e)}
                )
                # Set next_run_at far in the future to prevent immediate re-execution
                trigger.next_run_at = datetime.now(timezone.utc) + timedelta(days=365)
            
            # If single execution, deactivate the trigger
            if trigger.is_single_execution:
                trigger.status = TriggerStatus.inactive
                logger.info(
                    "Trigger deactivated after single execution",
                    extra={"trigger_id": trigger.id}
                )
            
            self.session.add(trigger)
            self.session.commit()
            
            # TODO: Queue the actual task execution
            # This would integrate with a task queue (e.g., Celery) to execute the trigger's action
            # For now event is sent to client for execution
            
            logger.info(
                "Trigger dispatched successfully",
                extra={
                    "trigger_id": trigger.id,
                    "trigger_name": trigger.name,
                    "execution_id": execution_id,
                    "next_run_at": trigger.next_run_at.isoformat() if trigger.next_run_at else None
                }
            )
            
            # Notify WebSocket subscribers
            # Using asyncio.run() to run async code from sync Celery worker context
            try:
                # Notify WebSocket subscribers via Redis pub/sub
                from app.component.redis_utils import get_redis_manager
                redis_manager = get_redis_manager()
                redis_manager.publish_execution_event({
                    "type": "execution_created",
                    "execution_id": execution_id,
                    "trigger_id": trigger.id,
                    "trigger_type": "schedule",
                    "status": "pending",
                    "input_data": execution.input_data,
                    "task_prompt": trigger.task_prompt,
                    "execution_type": "schedule",
                    "user_id": str(trigger.user_id),
                    "project_id": str(trigger.project_id)
                })
                
                logger.debug("WebSocket notification sent", extra={
                    "execution_id": execution_id,
                    "trigger_id": trigger.id
                })
            except Exception as e:
                # Don't fail the trigger dispatch if notification fails
                logger.warning("Failed to send WebSocket notification", extra={
                    "trigger_id": trigger.id,
                    "execution_id": execution_id,
                    "error": str(e)
                })
            
            return True
            
        except Exception as e:
            logger.error(
                "Failed to dispatch trigger",
                extra={
                    "trigger_id": trigger.id,
                    "error": str(e)
                },
                exc_info=True
            )
            self.session.rollback()
            return False
    
    def process_schedules(self, due_schedules: List[Trigger]) -> Tuple[int, int]:
        """
        Process due schedules, checking rate limits and dispatching.
        
        Args:
            due_schedules: List of triggers that are due for execution
            
        Returns:
            Tuple of (dispatched_count, rate_limited_count)
        """
        dispatched_count = 0
        rate_limited_count = 0
        
        for trigger in due_schedules:
            # Check rate limits
            if not check_rate_limits(self.session, trigger):
                rate_limited_count += 1
                
                # Still update next_run_at even if rate limited, so we don't keep checking
                try:
                    trigger.next_run_at = self.calculate_next_run_at(trigger, datetime.now(timezone.utc))
                    self.session.add(trigger)
                    self.session.commit()
                except Exception as e:
                    logger.error(
                        "Failed to update next_run_at for rate limited trigger",
                        extra={"trigger_id": trigger.id, "error": str(e)}
                    )
                
                continue
            
            # Dispatch the trigger
            if self.dispatch_trigger(trigger):
                dispatched_count += 1
        
        return dispatched_count, rate_limited_count
    
    def poll_and_execute_due_triggers(
        self, 
        max_dispatch_per_tick: Optional[int] = None
    ) -> Tuple[int, int]:
        """
        Poll for due triggers and execute them in batches.
        
        Args:
            max_dispatch_per_tick: Maximum number of triggers to dispatch in this tick
                                  (defaults to MAX_DISPATCH_PER_TICK)
        
        Returns:
            Tuple of (total_dispatched, total_rate_limited)
        """
        max_dispatch = max_dispatch_per_tick or MAX_DISPATCH_PER_TICK
        total_dispatched = 0
        total_rate_limited = 0
        
        # Process in batches until we've handled all due schedules or hit the limit
        while True:
            due_schedules = self.fetch_due_schedules()
            
            if not due_schedules:
                break
            
            dispatched_count, rate_limited_count = self.process_schedules(due_schedules)
            total_dispatched += dispatched_count
            total_rate_limited += rate_limited_count
            
            logger.debug(
                "Batch processed",
                extra={
                    "dispatched": dispatched_count,
                    "rate_limited": rate_limited_count
                }
            )
            
            # Check if we've hit the per-tick limit (if enabled)
            if max_dispatch > 0 and total_dispatched >= max_dispatch:
                logger.warning(
                    "Circuit breaker activated: reached dispatch limit, will continue next tick",
                    extra={"limit": max_dispatch}
                )
                break
        
        if total_dispatched > 0 or total_rate_limited > 0:
            logger.info(
                "Trigger schedule poll completed",
                extra={
                    "total_dispatched": total_dispatched,
                    "total_rate_limited": total_rate_limited
                }
            )
        
        return total_dispatched, total_rate_limited
    
    def _check_schedule_valid(self, trigger: Trigger) -> bool:
        """
        Check if a scheduled trigger is valid for execution.
        
        Validates:
        - For one-time (date set): Checks if the scheduled date has passed
        - For recurring (expirationDate set): Checks if expirationDate has passed
        
        If expired, the trigger will be marked as completed.
        
        Args:
            trigger: The trigger to check
            
        Returns:
            True if trigger is valid for execution, False if expired
        """
        config_data = trigger.config or {}
        
        # If no config or empty config, allow execution (no expiration)
        if not config_data:
            return True
        
        try:
            config = ScheduleTriggerConfig(**config_data)
        except Exception as e:
            logger.warning(
                "Invalid schedule config",
                extra={"trigger_id": trigger.id, "error": str(e)}
            )
            return False
        
        # Check if schedule has expired
        if config.is_expired():
            # Mark trigger as completed
            trigger.status = TriggerStatus.completed
            self.session.add(trigger)
            self.session.commit()
            
            logger.info(
                "Schedule trigger expired and marked as completed",
                extra={
                    "trigger_id": trigger.id,
                    "trigger_name": trigger.name,
                    "expiration_info": config.expirationDate or config.date
                }
            )
            return False
        
        return True
    
    def update_trigger_next_run(self, trigger: Trigger) -> None:
        """
        Update a trigger's next_run_at based on its cron expression.
        
        Args:
            trigger: The trigger to update
        """
        try:
            # Check if schedule is expired before updating next run
            if not self._check_schedule_valid(trigger):
                logger.info(
                    "Trigger expired, not updating next_run_at",
                    extra={"trigger_id": trigger.id}
                )
                return
            
            trigger.next_run_at = self.calculate_next_run_at(trigger)
            self.session.add(trigger)
            self.session.commit()
            
            logger.info(
                "Trigger next_run_at updated",
                extra={
                    "trigger_id": trigger.id,
                    "next_run_at": trigger.next_run_at.isoformat()
                }
            )
        except Exception as e:
            logger.error(
                "Failed to update trigger next_run_at",
                extra={
                    "trigger_id": trigger.id,
                    "error": str(e)
                }
            )
            self.session.rollback()
