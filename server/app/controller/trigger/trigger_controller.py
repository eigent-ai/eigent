from fastapi import APIRouter, Depends, HTTPException, Response, Query
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlmodel import Session, select, desc, and_, or_
from typing import Optional, List
from uuid import uuid4
from datetime import datetime

from app.model.trigger.trigger import Trigger, TriggerIn, TriggerOut, TriggerUpdate
from app.model.trigger.trigger_execution import TriggerExecution, TriggerExecutionOut
from app.type.trigger_types import TriggerType, TriggerStatus
from app.component.auth import Auth, auth_must
from app.component.database import session
from utils import traceroot_wrapper as traceroot
from fastapi_babel import _

logger = traceroot.get_logger("trigger_controller")

router = APIRouter(prefix="/trigger", tags=["Triggers"])


@router.post("/", name="create trigger", response_model=TriggerOut)
@traceroot.trace()
def create_trigger(
    data: TriggerIn, 
    session: Session = Depends(session), 
    auth: Auth = Depends(auth_must)
):
    """Create a new trigger."""
    user_id = auth.user.id
    
    try:
        # Generate webhook URL if this is a webhook trigger
        webhook_url = None
        if data.trigger_type == TriggerType.webhook:
            webhook_url = f"/webhook/trigger/{uuid4()}"
        
        # Create trigger instance
        trigger_data = data.model_dump()
        trigger_data["user_id"] = str(user_id)
        trigger_data["webhook_url"] = webhook_url
        
        trigger = Trigger(**trigger_data)
        session.add(trigger)
        session.commit()
        session.refresh(trigger)
        
        logger.info("Trigger created", extra={
            "user_id": user_id, 
            "trigger_id": trigger.id,
            "trigger_type": data.trigger_type.value
        })
        
        return trigger
        
    except Exception as e:
        session.rollback()
        logger.error("Trigger creation failed", extra={
            "user_id": user_id, 
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/", name="list triggers")
@traceroot.trace()
def list_triggers(
    trigger_type: Optional[TriggerType] = Query(None, description="Filter by trigger type"),
    status: Optional[TriggerStatus] = Query(None, description="Filter by status"),
    session: Session = Depends(session), 
    auth: Auth = Depends(auth_must)
) -> Page[TriggerOut]:
    """List triggers for current user."""
    user_id = auth.user.id
    
    # Build query with filters
    conditions = [Trigger.user_id == str(user_id)]
    
    if trigger_type:
        conditions.append(Trigger.trigger_type == trigger_type)
    
    if status is not None:
        conditions.append(Trigger.status == status)
    
    stmt = (
        select(Trigger)
        .where(and_(*conditions))
        .order_by(desc(Trigger.created_at))
    )
    
    result = paginate(session, stmt)
    total = result.total if hasattr(result, 'total') else 0
    
    logger.debug("Triggers listed", extra={
        "user_id": user_id, 
        "total": total,
        "filters": {
            "trigger_type": trigger_type.value if trigger_type else None,
            "status": status.value if status is not None else None
        }
    })
    
    return result


@router.get("/{trigger_id}", name="get trigger", response_model=TriggerOut)
@traceroot.trace()
def get_trigger(
    trigger_id: int, 
    session: Session = Depends(session), 
    auth: Auth = Depends(auth_must)
):
    """Get a specific trigger by ID."""
    user_id = auth.user.id
    
    trigger = session.exec(
        select(Trigger).where(
            and_(Trigger.id == trigger_id, Trigger.user_id == str(user_id))
        )
    ).first()
    
    if not trigger:
        logger.warning("Trigger not found", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        raise HTTPException(status_code=404, detail="Trigger not found")
    
    logger.debug("Trigger retrieved", extra={
        "user_id": user_id, 
        "trigger_id": trigger_id
    })
    
    return trigger


@router.put("/{trigger_id}", name="update trigger", response_model=TriggerOut)
@traceroot.trace()
def update_trigger(
    trigger_id: int,
    data: TriggerUpdate,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must)
):
    """Update a trigger."""
    user_id = auth.user.id
    
    trigger = session.exec(
        select(Trigger).where(
            and_(Trigger.id == trigger_id, Trigger.user_id == str(user_id))
        )
    ).first()
    
    if not trigger:
        logger.warning("Trigger not found for update", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        raise HTTPException(status_code=404, detail="Trigger not found")
    
    try:
        update_data = data.model_dump(exclude_unset=True)
        
        for key, value in update_data.items():
            setattr(trigger, key, value)
        
        session.add(trigger)
        session.commit()
        session.refresh(trigger)
        
        logger.info("Trigger updated", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id,
            "fields_updated": list(update_data.keys())
        })
        
        return trigger
        
    except Exception as e:
        session.rollback()
        logger.error("Trigger update failed", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id, 
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{trigger_id}", name="delete trigger")
@traceroot.trace()
def delete_trigger(
    trigger_id: int, 
    session: Session = Depends(session), 
    auth: Auth = Depends(auth_must)
):
    """Delete a trigger."""
    user_id = auth.user.id
    
    trigger = session.exec(
        select(Trigger).where(
            and_(Trigger.id == trigger_id, Trigger.user_id == str(user_id))
        )
    ).first()
    
    if not trigger:
        logger.warning("Trigger not found for deletion", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        raise HTTPException(status_code=404, detail="Trigger not found")
    
    try:
        session.delete(trigger)
        session.commit()
        
        logger.info("Trigger deleted", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        
        return Response(status_code=204)
        
    except Exception as e:
        session.rollback()
        logger.error("Trigger deletion failed", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id, 
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{trigger_id}/activate", name="activate trigger", response_model=TriggerOut)
@traceroot.trace()
def activate_trigger(
    trigger_id: int, 
    session: Session = Depends(session), 
    auth: Auth = Depends(auth_must)
):
    """Activate a trigger."""
    user_id = auth.user.id
    
    trigger = session.exec(
        select(Trigger).where(
            and_(Trigger.id == trigger_id, Trigger.user_id == str(user_id))
        )
    ).first()
    
    if not trigger:
        logger.warning("Trigger not found for activation", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        raise HTTPException(status_code=404, detail="Trigger not found")
    
    try:
        trigger.status = TriggerStatus.active
        session.add(trigger)
        session.commit()
        session.refresh(trigger)
        
        logger.info("Trigger activated", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        
        return trigger
        
    except Exception as e:
        session.rollback()
        logger.error("Trigger activation failed", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id, 
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{trigger_id}/deactivate", name="deactivate trigger", response_model=TriggerOut)
@traceroot.trace()
def deactivate_trigger(
    trigger_id: int, 
    session: Session = Depends(session), 
    auth: Auth = Depends(auth_must)
):
    """Deactivate a trigger."""
    user_id = auth.user.id
    
    trigger = session.exec(
        select(Trigger).where(
            and_(Trigger.id == trigger_id, Trigger.user_id == str(user_id))
        )
    ).first()
    
    if not trigger:
        logger.warning("Trigger not found for deactivation", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        raise HTTPException(status_code=404, detail="Trigger not found")
    
    try:
        trigger.status = TriggerStatus.inactive
        session.add(trigger)
        session.commit()
        session.refresh(trigger)
        
        logger.info("Trigger deactivated", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        
        return trigger
        
    except Exception as e:
        session.rollback()
        logger.error("Trigger deactivation failed", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id, 
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{trigger_id}/executions", name="list trigger executions")
@traceroot.trace()
def list_trigger_executions(
    trigger_id: int,
    session: Session = Depends(session), 
    auth: Auth = Depends(auth_must)
) -> Page[TriggerExecutionOut]:
    """List executions for a specific trigger."""
    user_id = auth.user.id
    
    # First verify the trigger belongs to the user
    trigger = session.exec(
        select(Trigger).where(
            and_(Trigger.id == trigger_id, Trigger.user_id == str(user_id))
        )
    ).first()
    
    if not trigger:
        logger.warning("Trigger not found for executions list", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        raise HTTPException(status_code=404, detail="Trigger not found")
    
    # Get executions for this trigger
    stmt = (
        select(TriggerExecution)
        .where(TriggerExecution.trigger_id == trigger_id)
        .order_by(desc(TriggerExecution.created_at))
    )
    
    result = paginate(session, stmt)
    total = result.total if hasattr(result, 'total') else 0
    
    logger.debug("Trigger executions listed", extra={
        "user_id": user_id, 
        "trigger_id": trigger_id,
        "total": total
    })
    
    return result