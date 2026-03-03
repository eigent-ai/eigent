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

from fastapi import APIRouter, Depends, HTTPException, Response, Query
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlmodel import Session, select, desc, and_, delete
from typing import Optional
from uuid import uuid4
import logging
from pydantic import ValidationError

from app.model.trigger.trigger import Trigger, TriggerIn, TriggerOut, TriggerUpdate, TriggerConfigSchemaOut
from app.model.trigger.trigger_execution import TriggerExecution, TriggerExecutionOut
from app.model.trigger.app_configs import (
    get_config_schema, 
    validate_config, 
    has_config,
    validate_activation,
    ActivationError,
)
from app.model.trigger.app_configs.config_registry import requires_authentication
from app.model.chat.chat_history import ChatHistory
from app.type.trigger_types import TriggerType, TriggerStatus
from app.component.auth import Auth, auth_must
from app.component.database import session
from app.component.redis_utils import get_redis_manager
from app.service.trigger.trigger_schedule_service import TriggerScheduleService
from fastapi_babel import _
from sqlalchemy import func

logger = logging.getLogger("server_trigger_controller")


def get_execution_counts(session: Session, trigger_ids: list[int]) -> dict[int, int]:
    """Get execution counts for multiple triggers in a single query."""
    if not trigger_ids:
        return {}
    
    result = session.exec(
        select(TriggerExecution.trigger_id, func.count(TriggerExecution.id))
        .where(TriggerExecution.trigger_id.in_(trigger_ids))
        .group_by(TriggerExecution.trigger_id)
    ).all()
    
    return {trigger_id: count for trigger_id, count in result}


def trigger_to_out(trigger: Trigger, execution_count: int = 0) -> TriggerOut:
    """Convert Trigger model to TriggerOut with execution count."""
    return TriggerOut(
        id=trigger.id,
        user_id=trigger.user_id,
        project_id=trigger.project_id,
        name=trigger.name,
        description=trigger.description,
        trigger_type=trigger.trigger_type,
        status=trigger.status,
        execution_count=execution_count,
        webhook_url=trigger.webhook_url,
        webhook_method=trigger.webhook_method,
        custom_cron_expression=trigger.custom_cron_expression,
        listener_type=trigger.listener_type,
        agent_model=trigger.agent_model,
        task_prompt=trigger.task_prompt,
        config=trigger.config,
        max_executions_per_hour=trigger.max_executions_per_hour,
        max_executions_per_day=trigger.max_executions_per_day,
        is_single_execution=trigger.is_single_execution,
        last_executed_at=trigger.last_executed_at,
        next_run_at=trigger.next_run_at,
        last_execution_status=trigger.last_execution_status,
        created_at=trigger.created_at,
        updated_at=trigger.updated_at,
    )


router = APIRouter(prefix="/trigger", tags=["Triggers"])

@router.post("/", name="create trigger", response_model=TriggerOut)
def create_trigger(
    data: TriggerIn, 
    session: Session = Depends(session), 
    auth: Auth = Depends(auth_must)
):
    """Create a new trigger."""
    user_id = auth.user.id
    
    try:
        # Check user trigger limit (max 25 triggers per user)
        user_trigger_count = session.exec(
            select(func.count(Trigger.id)).where(Trigger.user_id == str(user_id))
        ).one()
        
        if user_trigger_count >= 25:
            logger.warning("User trigger limit reached", extra={
                "user_id": user_id,
                "current_count": user_trigger_count,
                "limit": 25
            })
            raise HTTPException(
                status_code=400,
                detail="Maximum number of triggers (25) reached for this user"
            )
        
        # Check project trigger limit (max 5 triggers per project)
        if data.project_id:
            project_trigger_count = session.exec(
                select(func.count(Trigger.id)).where(
                    and_(
                        Trigger.user_id == str(user_id),
                        Trigger.project_id == data.project_id
                    )
                )
            ).one()
            
            if project_trigger_count >= 5:
                logger.warning("Project trigger limit reached", extra={
                    "user_id": user_id,
                    "project_id": data.project_id,
                    "current_count": project_trigger_count,
                    "limit": 5
                })
                raise HTTPException(
                    status_code=400,
                    detail="Maximum number of triggers (5) reached for this project"
                )
        
        # Check if project_id exists in chat_history, if not create one
        if data.project_id:
            existing_chat = session.exec(
                select(ChatHistory).where(ChatHistory.project_id == data.project_id)
            ).first()
            
            if not existing_chat:
                # Create a new chat_history for this project
                chat_history = ChatHistory(
                    user_id=user_id,
                    task_id=data.project_id,  # Using project_id as task_id
                    project_id=data.project_id,
                    question=f"Project created via trigger: {data.name}",
                    language="en",
                    model_platform=data.agent_model or "none",
                    model_type=data.agent_model or "none",
                    installed_mcp="none", #Expects String
                    api_key="",
                    api_url="",
                    max_retries=3,
                    project_name=data.name,
                    summary=data.description or "",
                    tokens=0,
                    spend=0,
                    status=2  # completed status
                )
                session.add(chat_history)
                session.commit()
                session.refresh(chat_history)
                
                logger.info("Chat history created for new project", extra={
                    "user_id": user_id,
                    "project_id": data.project_id,
                    "chat_history_id": chat_history.id
                })
                
                # Send WebSocket notification about new project
                try:
                    redis_manager = get_redis_manager()
                    redis_manager.publish_execution_event({
                        "type": "project_created",
                        "project_id": data.project_id,
                        "project_name": data.name,
                        "chat_history_id": chat_history.id,
                        "trigger_name": data.name,
                        "user_id": str(user_id),
                        "created_at": chat_history.created_at.isoformat() if chat_history.created_at else None
                    })
                    logger.debug("WebSocket notification sent for new project", extra={
                        "user_id": user_id,
                        "project_id": data.project_id
                    })
                except Exception as e:
                    logger.warning("Failed to send WebSocket notification for new project", extra={
                        "user_id": user_id,
                        "project_id": data.project_id,
                        "error": str(e)
                    })
        
        # Generate webhook URL for webhook-based triggers
        webhook_url = None
        if data.trigger_type in (TriggerType.webhook, TriggerType.slack_trigger):
            webhook_url = f"/webhook/trigger/{uuid4()}"
        
        # Validate trigger-type specific config
        if data.config and has_config(data.trigger_type):
            try:
                validate_config(data.trigger_type, data.config)
            except ValidationError as e:
                logger.warning("Invalid trigger config", extra={
                    "user_id": user_id,
                    "trigger_type": data.trigger_type.value,
                    "errors": e.errors()
                })
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid config for {data.trigger_type.value}: {e.errors()}"
                )
        
        # Create trigger instance
        trigger_data = data.model_dump()
        trigger_data["user_id"] = str(user_id)
        trigger_data["webhook_url"] = webhook_url
        
        # Check if authentication is required - set initial status accordingly
        if has_config(data.trigger_type) and data.config and requires_authentication(data.trigger_type, data.config):
            trigger_data["status"] = TriggerStatus.pending_verification
        else: 
            trigger_data["status"] = TriggerStatus.active
        
        trigger = Trigger(**trigger_data)
        session.add(trigger)
        session.commit()
        session.refresh(trigger)
        
        # Calculate next_run_at for scheduled triggers
        if trigger.trigger_type == TriggerType.schedule and trigger.custom_cron_expression:
            schedule_service = TriggerScheduleService(session)
            trigger.next_run_at = schedule_service.calculate_next_run_at(trigger)
            session.add(trigger)
            session.commit()
            session.refresh(trigger)
        
        logger.info("Trigger created", extra={
            "user_id": user_id, 
            "trigger_id": trigger.id,
            "trigger_type": data.trigger_type.value,
            "next_run_at": trigger.next_run_at.isoformat() if trigger.next_run_at else None
        })
        
        return trigger_to_out(trigger, 0)  # New trigger has 0 executions
        
    except Exception as e:
        session.rollback()
        logger.error("Trigger creation failed", extra={
            "user_id": user_id, 
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/", name="list triggers")
def list_triggers(
    trigger_type: Optional[TriggerType] = Query(None, description="Filter by trigger type"),
    status: Optional[TriggerStatus] = Query(None, description="Filter by status"),
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
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
    
    if project_id:
        conditions.append(Trigger.project_id == project_id)
    
    stmt = (
        select(Trigger)
        .where(and_(*conditions))
        .order_by(desc(Trigger.created_at))
    )
    
    result = paginate(session, stmt)
    total = result.total if hasattr(result, 'total') else 0
    
    # Get execution counts for all triggers in the result
    trigger_ids = [t.id for t in result.items]
    counts = get_execution_counts(session, trigger_ids)
    
    # Convert triggers to TriggerOut with execution counts
    result.items = [trigger_to_out(t, counts.get(t.id, 0)) for t in result.items]
    
    logger.debug("Triggers listed", extra={
        "user_id": user_id, 
        "total": total,
        "filters": {
            "trigger_type": trigger_type.value if trigger_type else None,
            "status": status.value if status is not None else None,
            "project_id": project_id
        }
    })
    
    return result

@router.get("/{trigger_id}", name="get trigger", response_model=TriggerOut)
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
    
    # Get execution count
    counts = get_execution_counts(session, [trigger_id])
    execution_count = counts.get(trigger_id, 0)
    
    logger.debug("Trigger retrieved", extra={
        "user_id": user_id, 
        "trigger_id": trigger_id
    })
    
    return trigger_to_out(trigger, execution_count)


@router.put("/{trigger_id}", name="update trigger", response_model=TriggerOut)
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
        
        # Validate config if being updated
        if "config" in update_data and update_data["config"] is not None:
            if has_config(trigger.trigger_type):
                try:
                    validate_config(trigger.trigger_type, update_data["config"])
                except ValidationError as e:
                    logger.warning("Invalid trigger config on update", extra={
                        "user_id": user_id,
                        "trigger_id": trigger_id,
                        "trigger_type": trigger.trigger_type.value,
                        "errors": e.errors()
                    })
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid config for {trigger.trigger_type.value}: {e.errors()}"
                    )
        
        for key, value in update_data.items():
            setattr(trigger, key, value)
        
        # Recalculate next_run_at if cron expression or status changed for scheduled triggers
        if trigger.trigger_type == TriggerType.schedule:
            if "custom_cron_expression" in update_data or "status" in update_data:
                if trigger.status == TriggerStatus.active and trigger.custom_cron_expression:
                    schedule_service = TriggerScheduleService(session)
                    trigger.next_run_at = schedule_service.calculate_next_run_at(trigger)
        
        session.add(trigger)
        session.commit()
        session.refresh(trigger)
        
        # Get execution count
        counts = get_execution_counts(session, [trigger_id])
        execution_count = counts.get(trigger_id, 0)
        
        logger.info("Trigger updated", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id,
            "fields_updated": list(update_data.keys()),
            "next_run_at": trigger.next_run_at.isoformat() if trigger.next_run_at else None
        })
        
        return trigger_to_out(trigger, execution_count)
        
    except Exception as e:
        session.rollback()
        logger.error("Trigger update failed", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id, 
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{trigger_id}", name="delete trigger")
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
        # Delete execution logs first (bulk delete)
        session.exec(
            delete(TriggerExecution).where(
                TriggerExecution.trigger_id == trigger_id
            )
        )
        
        # Then delete the trigger
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
        # Check activation requirements for trigger types with configs
        if has_config(trigger.trigger_type):
            try:
                validate_activation(
                    trigger_type=trigger.trigger_type,
                    config_data=trigger.config,
                    user_id=int(user_id),
                    session=session
                )
            except ActivationError as e:
                logger.warning("Trigger activation requirements not met", extra={
                    "user_id": user_id,
                    "trigger_id": trigger_id,
                    "trigger_type": trigger.trigger_type.value,
                    "missing_requirements": e.missing_requirements
                })
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message": e.message,
                        "missing_requirements": e.missing_requirements,
                        "trigger_type": trigger.trigger_type.value
                    }
                )
        
        # Check if authentication is required - set to pending_verification if so
        if has_config(trigger.trigger_type) and requires_authentication(trigger.trigger_type, trigger.config):
            trigger.status = TriggerStatus.pending_verification
            logger.info("Trigger set to pending verification (authentication required)", extra={
                "user_id": user_id,
                "trigger_id": trigger_id,
                "trigger_type": trigger.trigger_type.value
            })
            # Save the status change before raising the exception
            session.add(trigger)
            session.commit()
            session.refresh(trigger)
            raise HTTPException(
                status_code=401,
                detail={
                    "message": "Authentication required for this trigger type",
                    "missing_requirements": ["authentication"],
                    "trigger_type": trigger.trigger_type.value
                }
            )
        else:
            trigger.status = TriggerStatus.active
            session.add(trigger)
            session.commit()
            session.refresh(trigger)
        
        # Get execution count
        counts = get_execution_counts(session, [trigger_id])
        execution_count = counts.get(trigger_id, 0)
        
        logger.info("Trigger status updated", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id,
            "status": trigger.status.value
        })
        
        return trigger_to_out(trigger, execution_count)
        
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        logger.error("Trigger activation failed", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id, 
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{trigger_id}/deactivate", name="deactivate trigger", response_model=TriggerOut)
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
        
        # Get execution count
        counts = get_execution_counts(session, [trigger_id])
        execution_count = counts.get(trigger_id, 0)
        
        logger.info("Trigger deactivated", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id
        })
        
        return trigger_to_out(trigger, execution_count)
        
    except Exception as e:
        session.rollback()
        logger.error("Trigger deactivation failed", extra={
            "user_id": user_id, 
            "trigger_id": trigger_id, 
            "error": str(e)
        }, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{trigger_id}/executions", name="list trigger executions")
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


# ============================================================================
# Trigger Config Endpoints
# ============================================================================

@router.get("/{trigger_type}/config", name="get trigger type config schema")
def get_trigger_type_config(
    trigger_type: TriggerType,
    auth: Auth = Depends(auth_must)
) -> TriggerConfigSchemaOut:
    """
    Get the configuration schema for a specific trigger type.
    
    This endpoint returns the JSON schema for the trigger type's config field,
    which can be used by the frontend to dynamically render configuration forms.
    """
    schema = get_config_schema(trigger_type)
    
    return TriggerConfigSchemaOut(
        trigger_type=trigger_type.value,
        has_config=has_config(trigger_type),
        schema_=schema
    )