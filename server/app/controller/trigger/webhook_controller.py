from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select, and_
from typing import Dict, Any
from uuid import uuid4
from datetime import datetime
import json

from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import TriggerExecution
from app.type.trigger_types import TriggerType, TriggerStatus, ExecutionType, ExecutionStatus
from app.component.database import session
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("webhook_controller")

router = APIRouter(prefix="/webhook", tags=["Webhook"])


@router.post("/trigger/{webhook_uuid}", name="webhook trigger")
@traceroot.trace()
async def webhook_trigger(
    webhook_uuid: str,
    request: Request,
    session: Session = Depends(session)
):
    """Handle incoming webhook triggers."""
    try:
        # Get request body
        body = await request.body()
        try:
            input_data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            input_data = {"raw_body": body.decode()}
        
        # Get request headers
        headers = dict(request.headers)
        
        # Construct webhook URL to find the trigger
        webhook_url = f"/webhook/trigger/{webhook_uuid}"
        
        # Find the trigger
        trigger = session.exec(
            select(Trigger).where(
                and_(
                    Trigger.webhook_url == webhook_url,
                    Trigger.trigger_type == TriggerType.webhook,
                    Trigger.status == TriggerStatus.active
                )
            )
        ).first()
        
        if not trigger:
            logger.warning("Webhook trigger not found or inactive", extra={
                "webhook_uuid": webhook_uuid,
                "webhook_url": webhook_url
            })
            raise HTTPException(status_code=404, detail="Webhook not found or inactive")
        
        # Check rate limits
        current_time = datetime.now()
        if trigger.max_executions_per_hour or trigger.max_executions_per_day:
            # TODO: Implement rate limiting logic
            pass
        
        # Check if single execution and already executed
        if trigger.is_single_execution and trigger.execution_count > 0:
            logger.warning("Single execution trigger already executed", extra={
                "trigger_id": trigger.id,
                "webhook_uuid": webhook_uuid
            })
            raise HTTPException(status_code=409, detail="Single execution trigger already executed")
        
        # Create execution record
        execution_id = str(uuid4())
        execution = TriggerExecution(
            trigger_id=trigger.id,
            execution_id=execution_id,
            execution_type=ExecutionType.webhook,
            status=ExecutionStatus.pending,
            input_data={
                "headers": headers,
                "body": input_data,
                "method": request.method,
                "url": str(request.url),
                "client_ip": request.client.host if request.client else None
            },
            started_at=current_time
        )
        
        session.add(execution)
        session.commit()
        session.refresh(execution)
        
        # Update trigger
        trigger.execution_count += 1
        trigger.last_executed_at = current_time
        trigger.last_execution_status = "pending"
        session.add(trigger)
        session.commit()
        
        logger.info("Webhook trigger executed", extra={
            "trigger_id": trigger.id,
            "execution_id": execution_id,
            "webhook_uuid": webhook_uuid,
            "user_id": trigger.user_id
        })
        
        # TODO: Queue the actual task execution based on trigger configuration
        # This would typically involve:
        # 1. Creating a task based on trigger.task_prompt and trigger.custom_task
        # 2. Assigning to appropriate agent based on trigger.listener_type
        # 3. Using trigger.system_message and trigger.agent_model for configuration
        
        return {
            "success": True,
            "execution_id": execution_id,
            "message": "Webhook trigger processed successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Webhook trigger processing failed", extra={
            "webhook_uuid": webhook_uuid,
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/trigger/{webhook_uuid}/info", name="webhook info")
@traceroot.trace()
def get_webhook_info(
    webhook_uuid: str,
    session: Session = Depends(session)
):
    """Get information about a webhook trigger (public endpoint)."""
    webhook_url = f"/webhook/trigger/{webhook_uuid}"
    
    trigger = session.exec(
        select(Trigger).where(
            and_(
                Trigger.webhook_url == webhook_url,
                Trigger.trigger_type == TriggerType.webhook
            )
        )
    ).first()
    
    if not trigger:
        logger.warning("Webhook info requested for non-existent webhook", extra={
            "webhook_uuid": webhook_uuid
        })
        raise HTTPException(status_code=404, detail="Webhook not found")
    
    return {
        "name": trigger.name,
        "description": trigger.description,
        "status": trigger.status.name,
        "is_active": trigger.status == TriggerStatus.active,
        "execution_count": trigger.execution_count,
        "last_executed_at": trigger.last_executed_at.isoformat() if trigger.last_executed_at else None,
        "max_executions_per_hour": trigger.max_executions_per_hour,
        "max_executions_per_day": trigger.max_executions_per_day,
        "is_single_execution": trigger.is_single_execution
    }