from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlmodel import Session, select, desc, and_
from typing import Optional
from datetime import datetime
from uuid import uuid4

from app.model.trigger.trigger_execution import (
    TriggerExecution, 
    TriggerExecutionIn, 
    TriggerExecutionOut, 
    TriggerExecutionUpdate
)
from app.model.trigger.trigger import Trigger
from app.type.trigger_types import ExecutionStatus, ExecutionType
from app.component.auth import Auth, auth_must
from app.component.database import session
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("trigger_execution_controller")

router = APIRouter(prefix="/execution", tags=["Trigger Executions"])


@router.post("/", name="create trigger execution", response_model=TriggerExecutionOut)
@traceroot.trace()
def create_trigger_execution(
    data: TriggerExecutionIn,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
):
    """Create a new trigger execution."""
    user_id = auth.user.id
    
    # Verify the trigger exists and belongs to the user
    trigger = session.exec(
        select(Trigger).where(
            and_(Trigger.id == data.trigger_id, Trigger.user_id == str(user_id))
        )
    ).first()
    
    if not trigger:
        logger.warning("Trigger not found for execution creation", extra={
            "user_id": user_id, 
            "trigger_id": data.trigger_id
        })
        raise HTTPException(status_code=404, detail="Trigger not found")
    
    try:
        execution_data = data.model_dump()
        execution = TriggerExecution(**execution_data)
        
        session.add(execution)
        session.commit()
        session.refresh(execution)
        
        # Update trigger execution count
        trigger.execution_count += 1
        trigger.last_executed_at = datetime.now()
        session.add(trigger)
        session.commit()
        
        logger.info("Trigger execution created", extra={
            "user_id": user_id,
            "trigger_id": data.trigger_id,
            "execution_id": execution.execution_id,
            "execution_type": data.execution_type.value
        })
        
        return execution
        
    except Exception as e:
        session.rollback()
        logger.error("Trigger execution creation failed", extra={
            "user_id": user_id,
            "trigger_id": data.trigger_id,
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/", name="list executions")
@traceroot.trace()
def list_executions(
    trigger_id: Optional[int] = None,
    status: Optional[ExecutionStatus] = None,
    execution_type: Optional[ExecutionType] = None,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
) -> Page[TriggerExecutionOut]:
    """List trigger executions for current user."""
    user_id = auth.user.id
    
    # Get all trigger IDs that belong to the user
    user_trigger_ids = session.exec(
        select(Trigger.id).where(Trigger.user_id == str(user_id))
    ).all()
    
    if not user_trigger_ids:
        # User has no triggers, return empty result
        return Page(items=[], total=0, page=1, size=50, pages=0)
    
    # Build conditions
    conditions = [TriggerExecution.trigger_id.in_(user_trigger_ids)]
    
    if trigger_id:
        if trigger_id not in user_trigger_ids:
            raise HTTPException(status_code=404, detail="Trigger not found")
        conditions.append(TriggerExecution.trigger_id == trigger_id)
    
    if status is not None:
        conditions.append(TriggerExecution.status == status)
    
    if execution_type:
        conditions.append(TriggerExecution.execution_type == execution_type)
    
    stmt = (
        select(TriggerExecution)
        .where(and_(*conditions))
        .order_by(desc(TriggerExecution.created_at))
    )
    
    result = paginate(session, stmt)
    total = result.total if hasattr(result, 'total') else 0
    
    logger.debug("Executions listed", extra={
        "user_id": user_id,
        "total": total,
        "filters": {
            "trigger_id": trigger_id,
            "status": status.value if status is not None else None,
            "execution_type": execution_type.value if execution_type else None
        }
    })
    
    return result


@router.get("/{execution_id}", name="get execution", response_model=TriggerExecutionOut)
@traceroot.trace()
def get_execution(
    execution_id: str,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
):
    """Get a specific execution by execution ID."""
    user_id = auth.user.id
    
    # Get the execution and verify ownership through trigger
    execution = session.exec(
        select(TriggerExecution)
        .join(Trigger)
        .where(
            and_(
                TriggerExecution.execution_id == execution_id,
                Trigger.user_id == str(user_id)
            )
        )
    ).first()
    
    if not execution:
        logger.warning("Execution not found", extra={
            "user_id": user_id,
            "execution_id": execution_id
        })
        raise HTTPException(status_code=404, detail="Execution not found")
    
    logger.debug("Execution retrieved", extra={
        "user_id": user_id,
        "execution_id": execution_id
    })
    
    return execution


@router.put("/{execution_id}", name="update execution", response_model=TriggerExecutionOut)
@traceroot.trace()
def update_execution(
    execution_id: str,
    data: TriggerExecutionUpdate,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
):
    """Update a trigger execution."""
    user_id = auth.user.id
    
    # Get the execution and verify ownership through trigger
    execution = session.exec(
        select(TriggerExecution)
        .join(Trigger)
        .where(
            and_(
                TriggerExecution.execution_id == execution_id,
                Trigger.user_id == str(user_id)
            )
        )
    ).first()
    
    if not execution:
        logger.warning("Execution not found for update", extra={
            "user_id": user_id,
            "execution_id": execution_id
        })
        raise HTTPException(status_code=404, detail="Execution not found")
    
    try:
        update_data = data.model_dump(exclude_unset=True)
        
        # Auto-calculate duration if both started_at and completed_at are set
        if ("started_at" in update_data or "completed_at" in update_data) and execution.started_at:
            completed_at = update_data.get("completed_at") or execution.completed_at
            if completed_at:
                duration = (completed_at - execution.started_at).total_seconds()
                update_data["duration_seconds"] = duration
        
        for key, value in update_data.items():
            setattr(execution, key, value)
        
        session.add(execution)
        session.commit()
        session.refresh(execution)
        
        # Update trigger error count if execution failed
        if data.status == ExecutionStatus.failed:
            trigger = session.get(Trigger, execution.trigger_id)
            if trigger:
                trigger.error_count += 1
                trigger.last_execution_status = "failed"
                session.add(trigger)
                session.commit()
        elif data.status == ExecutionStatus.completed:
            trigger = session.get(Trigger, execution.trigger_id)
            if trigger:
                trigger.last_execution_status = "completed"
                session.add(trigger)
                session.commit()
        
        logger.info("Execution updated", extra={
            "user_id": user_id,
            "execution_id": execution_id,
            "fields_updated": list(update_data.keys())
        })
        
        return execution
        
    except Exception as e:
        session.rollback()
        logger.error("Execution update failed", extra={
            "user_id": user_id,
            "execution_id": execution_id,
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{execution_id}", name="delete execution")
@traceroot.trace()
def delete_execution(
    execution_id: str,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
):
    """Delete a trigger execution."""
    user_id = auth.user.id
    
    # Get the execution and verify ownership through trigger
    execution = session.exec(
        select(TriggerExecution)
        .join(Trigger)
        .where(
            and_(
                TriggerExecution.execution_id == execution_id,
                Trigger.user_id == str(user_id)
            )
        )
    ).first()
    
    if not execution:
        logger.warning("Execution not found for deletion", extra={
            "user_id": user_id,
            "execution_id": execution_id
        })
        raise HTTPException(status_code=404, detail="Execution not found")
    
    try:
        session.delete(execution)
        session.commit()
        
        logger.info("Execution deleted", extra={
            "user_id": user_id,
            "execution_id": execution_id
        })
        
        return Response(status_code=204)
        
    except Exception as e:
        session.rollback()
        logger.error("Execution deletion failed", extra={
            "user_id": user_id,
            "execution_id": execution_id,
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{execution_id}/retry", name="retry execution", response_model=TriggerExecutionOut)
@traceroot.trace()
def retry_execution(
    execution_id: str,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
):
    """Retry a failed execution."""
    user_id = auth.user.id
    
    # Get the execution and verify ownership through trigger
    execution = session.exec(
        select(TriggerExecution)
        .join(Trigger)
        .where(
            and_(
                TriggerExecution.execution_id == execution_id,
                Trigger.user_id == str(user_id)
            )
        )
    ).first()
    
    if not execution:
        logger.warning("Execution not found for retry", extra={
            "user_id": user_id,
            "execution_id": execution_id
        })
        raise HTTPException(status_code=404, detail="Execution not found")
    
    if execution.status != ExecutionStatus.failed:
        raise HTTPException(status_code=400, detail="Only failed executions can be retried")
    
    if execution.retry_count >= execution.max_retries:
        raise HTTPException(status_code=400, detail="Maximum retry attempts exceeded")
    
    try:
        # Create a new execution for the retry
        new_execution_id = str(uuid4())
        new_execution = TriggerExecution(
            trigger_id=execution.trigger_id,
            execution_id=new_execution_id,
            execution_type=execution.execution_type,
            input_data=execution.input_data,
            retry_count=execution.retry_count + 1,
            max_retries=execution.max_retries,
            worker_id=execution.worker_id
        )
        
        session.add(new_execution)
        session.commit()
        session.refresh(new_execution)
        
        logger.info("Execution retry created", extra={
            "user_id": user_id,
            "original_execution_id": execution_id,
            "new_execution_id": new_execution_id,
            "retry_count": new_execution.retry_count
        })
        
        return new_execution
        
    except Exception as e:
        session.rollback()
        logger.error("Execution retry failed", extra={
            "user_id": user_id,
            "execution_id": execution_id,
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")