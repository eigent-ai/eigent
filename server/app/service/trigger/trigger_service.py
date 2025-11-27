from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlmodel import Session, select, and_, or_
from uuid import uuid4
import asyncio
from croniter import croniter

from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import TriggerExecution
from app.type.trigger_types import TriggerType, TriggerStatus, ExecutionType, ExecutionStatus
from app.component.database import session_make
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("trigger_service")


class TriggerService:
    """Service for managing trigger operations and scheduling."""
    
    def __init__(self):
        self.session = session_make()
    
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
            started_at=datetime.now()
        )
        
        self.session.add(execution)
        self.session.commit()
        self.session.refresh(execution)
        
        # Update trigger statistics
        trigger.execution_count += 1
        trigger.last_executed_at = datetime.now()
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
        
        if status in [ExecutionStatus.completed, ExecutionStatus.failed, ExecutionStatus.cancelled]:
            execution.completed_at = datetime.now()
            if execution.started_at:
                execution.duration_seconds = (execution.completed_at - execution.started_at).total_seconds()
        
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
        
        # Update trigger status
        trigger = self.session.get(Trigger, execution.trigger_id)
        if trigger:
            if status == ExecutionStatus.failed:
                trigger.error_count += 1
                trigger.last_execution_status = "failed"
            elif status == ExecutionStatus.completed:
                trigger.last_execution_status = "completed"
            elif status == ExecutionStatus.cancelled:
                trigger.last_execution_status = "cancelled"
            
            self.session.add(trigger)
            self.session.commit()
        
        logger.info("Execution status updated", extra={
            "execution_id": execution.execution_id,
            "status": status.name,
            "duration": execution.duration_seconds
        })
        
        return execution
    
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
                    TriggerExecution.retry_count < TriggerExecution.max_retries
                )
            ).order_by(TriggerExecution.created_at)
        ).all()
        
        return list(executions)
    
    def check_rate_limits(self, trigger: Trigger) -> bool:
        """Check if trigger execution is within rate limits."""
        current_time = datetime.now()
        
        # Check hourly limit
        if trigger.max_executions_per_hour:
            hour_ago = current_time - timedelta(hours=1)
            hourly_count = self.session.exec(
                select(TriggerExecution).where(
                    and_(
                        TriggerExecution.trigger_id == trigger.id,
                        TriggerExecution.created_at >= hour_ago
                    )
                )
            ).all()
            
            if len(hourly_count) >= trigger.max_executions_per_hour:
                return False
        
        # Check daily limit
        if trigger.max_executions_per_day:
            day_ago = current_time - timedelta(days=1)
            daily_count = self.session.exec(
                select(TriggerExecution).where(
                    and_(
                        TriggerExecution.trigger_id == trigger.id,
                        TriggerExecution.created_at >= day_ago
                    )
                )
            ).all()
            
            if len(daily_count) >= trigger.max_executions_per_day:
                return False
        
        # Check single execution limit
        if trigger.is_single_execution and trigger.execution_count > 0:
            return False
        
        return True
    
    def get_due_scheduled_triggers(self) -> List[Trigger]:
        """Get scheduled triggers that are due for execution."""
        current_time = datetime.now()
        
        triggers = self.session.exec(
            select(Trigger).where(
                and_(
                    Trigger.trigger_type == TriggerType.schedule,
                    Trigger.status == TriggerStatus.active,
                    Trigger.custom_cron_expression.is_not(None)
                )
            )
        ).all()
        
        due_triggers = []
        
        for trigger in triggers:
            if not trigger.custom_cron_expression:
                continue
            
            try:
                cron = croniter(trigger.custom_cron_expression, trigger.last_executed_at or trigger.created_at)
                next_run = cron.get_next(datetime)
                
                # If next run time has passed, this trigger is due
                if next_run <= current_time:
                    # Check rate limits
                    if self.check_rate_limits(trigger):
                        due_triggers.append(trigger)
                    else:
                        logger.warning("Trigger execution skipped due to rate limits", extra={
                            "trigger_id": trigger.id,
                            "trigger_name": trigger.name
                        })
            except Exception as e:
                logger.error("Invalid cron expression", extra={
                    "trigger_id": trigger.id,
                    "cron_expression": trigger.custom_cron_expression,
                    "error": str(e)
                })
        
        return due_triggers
    
    def execute_scheduled_triggers(self) -> int:
        """Execute all due scheduled triggers."""
        due_triggers = self.get_due_scheduled_triggers()
        executed_count = 0
        
        for trigger in due_triggers:
            try:
                execution = self.create_execution(
                    trigger=trigger,
                    execution_type=ExecutionType.scheduled,
                    input_data={"scheduled_at": datetime.now().isoformat()}
                )
                
                # TODO: Queue the actual task execution
                # This would integrate with the task service to create and execute tasks
                
                executed_count += 1
                
                logger.info("Scheduled trigger executed", extra={
                    "trigger_id": trigger.id,
                    "execution_id": execution.execution_id
                })
                
            except Exception as e:
                logger.error("Scheduled trigger execution failed", extra={
                    "trigger_id": trigger.id,
                    "error": str(e)
                }, exc_info=True)
        
        return executed_count
    
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
        
        if not self.check_rate_limits(trigger):
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
        cutoff_date = datetime.now() - timedelta(days=days_to_keep)
        
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


# Global service instance
trigger_service = TriggerService()