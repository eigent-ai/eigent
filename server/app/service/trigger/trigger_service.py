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
from typing import Optional, List, Dict, Any
from sqlmodel import select, and_, or_
from uuid import uuid4
import logging

from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import TriggerExecution
from app.type.trigger_types import TriggerType, TriggerStatus, ExecutionType, ExecutionStatus
from app.component.database import session_make
from app.service.trigger.trigger_schedule_service import TriggerScheduleService
from app.component.trigger_utils import SCHEDULED_FETCH_BATCH_SIZE, check_rate_limits
from app.model.trigger.app_configs import ScheduleTriggerConfig, WebhookTriggerConfig
from app.model.trigger.app_configs.base_config import BaseTriggerConfig

logger = logging.getLogger("server_trigger_service")


class TriggerService:
    """Service for managing trigger operations and scheduling."""

    def __init__(self, session=None):
        self.session = session or session_make()
        self.schedule_service = TriggerScheduleService(self.session)
    
    def create_execution(
        self, 
        trigger: Trigger, 
        execution_type: ExecutionType,
        input_data: Optional[Dict[str, Any]] = None
    ) -> TriggerExecution:
        """Create a new trigger execution."""
        execution_id = str(uuid4())
        
        execution = TriggerExecution(
            trigger_id=trigger.id,
            execution_id=execution_id,
            execution_type=execution_type,
            status=ExecutionStatus.pending,
            input_data=input_data or {},
            started_at=datetime.now(timezone.utc)
        )
        
        self.session.add(execution)
        self.session.commit()
        self.session.refresh(execution)
        
        # Update trigger statistics
        trigger.last_executed_at = datetime.now(timezone.utc)
        trigger.last_execution_status = "pending"
        self.session.add(trigger)
        self.session.commit()
        
        logger.info("Execution created", extra={
            "trigger_id": trigger.id,
            "execution_id": execution_id,
            "execution_type": execution_type.value
        })
        
        return execution
    
    def update_execution_status(
        self, 
        execution: TriggerExecution, 
        status: ExecutionStatus,
        output_data: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
        tokens_used: Optional[int] = None,
        tools_executed: Optional[Dict[str, Any]] = None
    ) -> TriggerExecution:
        """Update execution status and metadata."""
        execution.status = status
        
        # Set completed_at and duration for terminal statuses
        if status in [ExecutionStatus.completed, ExecutionStatus.failed, ExecutionStatus.cancelled, ExecutionStatus.missed]:
            execution.completed_at = datetime.now(timezone.utc)
            if execution.started_at:
                # Ensure started_at is timezone-aware for subtraction
                started_at = execution.started_at
                if started_at.tzinfo is None:
                    started_at = started_at.replace(tzinfo=timezone.utc)
                execution.duration_seconds = (execution.completed_at - started_at).total_seconds()
        
        if output_data:
            execution.output_data = output_data
        
        if error_message:
            execution.error_message = error_message
        
        if tokens_used:
            execution.tokens_used = tokens_used
        
        if tools_executed:
            execution.tools_executed = tools_executed
        
        self.session.add(execution)
        self.session.commit()
        
        # Update trigger status and handle auto-disable logic
        trigger = self.session.get(Trigger, execution.trigger_id)
        if trigger:
            if status == ExecutionStatus.failed:
                trigger.last_execution_status = "failed"
                trigger.consecutive_failures += 1
                
                # Check for auto-disable based on max_failure_count in config
                self._check_auto_disable(trigger)
                
            elif status == ExecutionStatus.completed:
                trigger.last_execution_status = "completed"
                # Reset consecutive failures on success
                trigger.consecutive_failures = 0
            elif status == ExecutionStatus.cancelled:
                trigger.last_execution_status = "cancelled"
            elif status == ExecutionStatus.missed:
                trigger.last_execution_status = "missed"
            
            self.session.add(trigger)
            self.session.commit()
        
        logger.info("Execution status updated", extra={
            "execution_id": execution.execution_id,
            "status": status.name,
            "duration": execution.duration_seconds
        })
        
        return execution
    
    def _check_auto_disable(self, trigger: Trigger) -> bool:
        """
        Check if trigger should be auto-disabled based on consecutive failures.
        
        Args:
            trigger: The trigger to check
            
        Returns:
            True if trigger was auto-disabled, False otherwise
        """
        if not trigger.config:
            return False
        
        try:
            # Get the appropriate config class based on trigger type
            config: BaseTriggerConfig
            if trigger.trigger_type == TriggerType.schedule:
                config = ScheduleTriggerConfig(**trigger.config)
            elif trigger.trigger_type == TriggerType.webhook:
                config = WebhookTriggerConfig(**trigger.config)
            else:
                # For other trigger types, use base config
                config = BaseTriggerConfig(**trigger.config)
            
            # Check if auto-disable should happen
            if config.should_auto_disable(trigger.consecutive_failures):
                trigger.status = TriggerStatus.inactive
                trigger.auto_disabled_at = datetime.now(timezone.utc)
                
                logger.warning(
                    "Trigger auto-disabled due to max failures",
                    extra={
                        "trigger_id": trigger.id,
                        "trigger_name": trigger.name,
                        "consecutive_failures": trigger.consecutive_failures,
                        "max_failure_count": config.max_failure_count
                    }
                )
                return True
                
        except Exception as e:
            logger.error(
                "Failed to check auto-disable for trigger",
                extra={
                    "trigger_id": trigger.id,
                    "error": str(e)
                }
            )
        
        return False
    
    def get_pending_executions(self) -> List[TriggerExecution]:
        """Get all pending executions that need to be processed."""
        executions = self.session.exec(
            select(TriggerExecution).where(
                TriggerExecution.status == ExecutionStatus.pending
            ).order_by(TriggerExecution.created_at)
        ).all()
        
        return list(executions)
    
    def get_failed_executions_for_retry(self) -> List[TriggerExecution]:
        """Get failed executions that can be retried."""
        executions = self.session.exec(
            select(TriggerExecution).where(
                and_(
                    TriggerExecution.status == ExecutionStatus.failed,
                    TriggerExecution.attempts < TriggerExecution.max_retries
                )
            ).order_by(TriggerExecution.created_at)
        ).all()
        
        return list(executions)
    
    def get_due_scheduled_triggers(self, limit: Optional[int] = None) -> List[Trigger]:
        """
        Fetch scheduled triggers that are due for execution.
        
        Args:
            limit: Maximum number of triggers to fetch (defaults to SCHEDULED_FETCH_BATCH_SIZE)
            
        Returns:
            List of triggers that are due for execution
        """
        current_time = datetime.now(timezone.utc)
        limit = limit or SCHEDULED_FETCH_BATCH_SIZE
        
        # Query triggers that:
        # 1. Are scheduled type
        # 2. Are active
        # 3. Have a cron expression
        # 4. next_run_at is null (never run) or next_run_at <= now
        triggers = self.session.exec(
            select(Trigger)
            .where(
                and_(
                    Trigger.trigger_type == TriggerType.schedule,
                    Trigger.status == TriggerStatus.active,
                    Trigger.custom_cron_expression.is_not(None),
                    or_(
                        Trigger.next_run_at.is_(None),
                        Trigger.next_run_at <= current_time
                    )
                )
            )
            .limit(limit)
        ).all()
        
        return list(triggers)
    
    def execute_scheduled_triggers(self) -> int:
        """
        Execute all due scheduled triggers.
        Uses TriggerScheduleService for the actual execution logic.
        """
        due_triggers = self.get_due_scheduled_triggers()
        
        if not due_triggers:
            return 0
        
        dispatched_count, rate_limited_count = self.schedule_service.process_schedules(due_triggers)
        
        logger.info(
            "Scheduled triggers execution completed",
            extra={
                "dispatched": dispatched_count,
                "rate_limited": rate_limited_count
            }
        )
        
        return dispatched_count
    
    def process_slack_trigger(
        self, 
        trigger: Trigger, 
        slack_data: Dict[str, Any]
    ) -> Optional[TriggerExecution]:
        """Process a Slack trigger event."""
        if trigger.trigger_type != TriggerType.slack_trigger:
            raise ValueError("Trigger is not a Slack trigger")
        
        if trigger.status != TriggerStatus.active:
            logger.warning("Slack trigger is not active", extra={
                "trigger_id": trigger.id
            })
            return None
        
        if not check_rate_limits(self.session, trigger):
            logger.warning("Slack trigger execution skipped due to rate limits", extra={
                "trigger_id": trigger.id
            })
            return None
        
        try:
            execution = self.create_execution(
                trigger=trigger,
                execution_type=ExecutionType.slack,
                input_data=slack_data
            )
            
            # TODO: Queue the actual task execution
            
            logger.info("Slack trigger executed", extra={
                "trigger_id": trigger.id,
                "execution_id": execution.execution_id
            })
            
            return execution
            
        except Exception as e:
            logger.error("Slack trigger execution failed", extra={
                "trigger_id": trigger.id,
                "error": str(e)
            }, exc_info=True)
            return None
    
    def cleanup_old_executions(self, days_to_keep: int = 30) -> int:
        """Clean up old execution records."""
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_to_keep)
        
        old_executions = self.session.exec(
            select(TriggerExecution).where(
                and_(
                    TriggerExecution.created_at < cutoff_date,
                    TriggerExecution.status.in_([
                        ExecutionStatus.completed, 
                        ExecutionStatus.failed, 
                        ExecutionStatus.cancelled
                    ])
                )
            )
        ).all()
        
        count = len(old_executions)
        
        for execution in old_executions:
            self.session.delete(execution)
        
        self.session.commit()
        
        logger.info("Old executions cleaned up", extra={
            "count": count,
            "days_to_keep": days_to_keep
        })
        
        return count
    
    def get_trigger_statistics(self, trigger_id: int) -> Dict[str, Any]:
        """Get statistics for a specific trigger."""
        trigger = self.session.get(Trigger, trigger_id)
        if not trigger:
            raise ValueError("Trigger not found")
        
        # Get execution counts by status
        executions = self.session.exec(
            select(TriggerExecution).where(
                TriggerExecution.trigger_id == trigger_id
            )
        ).all()
        
        stats = {
            "trigger_id": trigger_id,
            "name": trigger.name,
            "trigger_type": trigger.trigger_type.value,
            "status": trigger.status.name,
            "total_executions": len(executions),
            "successful_executions": len([e for e in executions if e.status == ExecutionStatus.completed]),
            "failed_executions": len([e for e in executions if e.status == ExecutionStatus.failed]),
            "pending_executions": len([e for e in executions if e.status == ExecutionStatus.pending]),
            "cancelled_executions": len([e for e in executions if e.status == ExecutionStatus.cancelled]),
            "last_executed_at": trigger.last_executed_at.isoformat() if trigger.last_executed_at else None,
            "created_at": trigger.created_at.isoformat() if trigger.created_at else None
        }
        
        # Calculate average execution time for completed executions
        completed_executions = [e for e in executions if e.status == ExecutionStatus.completed and e.duration_seconds]
        if completed_executions:
            avg_duration = sum(e.duration_seconds for e in completed_executions) / len(completed_executions)
            stats["average_execution_time_seconds"] = round(avg_duration, 2)
        
        # Calculate total tokens used
        total_tokens = sum(e.tokens_used for e in executions if e.tokens_used)
        if total_tokens:
            stats["total_tokens_used"] = total_tokens
        
        return stats

def get_trigger_service(session=None) -> TriggerService:
    """Factory function to create a TriggerService instance with a fresh session."""
    return TriggerService(session)