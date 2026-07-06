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

"""Trigger controller. Uses TriggerCrudService for business logic."""

from fastapi import APIRouter, Depends, HTTPException, Response, Query
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlmodel import Session, select, desc, and_, delete
from typing import Optional
from loguru import logger

from app.model.trigger.trigger import Trigger, TriggerIn, TriggerOut, TriggerUpdate, TriggerConfigSchemaOut
from app.model.trigger.trigger_execution import TriggerExecution, TriggerExecutionOut
from app.model.trigger.app_configs import get_config_schema, has_config
from app.shared.types.trigger_types import TriggerType, TriggerStatus
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth
from app.core.database import session
from app.domains.trigger.service.trigger_crud_service import TriggerCrudService

router = APIRouter(prefix="/trigger", tags=["Triggers"])


def _raise_on_error(result: dict) -> None:
    """Convert service error dict to HTTPException."""
    if result["success"]:
        return
    status_code = result.get("status_code", 500)
    error = result.get("error", "Internal server error")
    raise HTTPException(status_code=status_code, detail=error)


@router.post("/", name="create trigger", response_model=TriggerOut)
def create_trigger(
    data: TriggerIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Create a new trigger."""
    try:
        result = TriggerCrudService.create(data, auth.id, db_session)
        _raise_on_error(result)
        return result["trigger_out"]
    except HTTPException:
        raise
    except Exception as e:
        db_session.rollback()
        logger.error("Trigger creation failed", extra={"user_id": auth.id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/", name="list triggers")
def list_triggers(
    trigger_type: Optional[TriggerType] = Query(None, description="Filter by trigger type"),
    status: Optional[TriggerStatus] = Query(None, description="Filter by status"),
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
) -> Page[TriggerOut]:
    """List triggers for current user."""
    user_id = auth.id
    conditions = [Trigger.user_id == str(user_id)]
    if trigger_type:
        conditions.append(Trigger.trigger_type == trigger_type)
    if status is not None:
        conditions.append(Trigger.status == status)
    if project_id:
        conditions.append(Trigger.project_id == project_id)

    stmt = select(Trigger).where(and_(*conditions)).order_by(desc(Trigger.created_at))
    result = paginate(db_session, stmt)

    # Enrich with execution counts
    trigger_ids = [t.id for t in result.items]
    counts = TriggerCrudService.get_execution_counts(db_session, trigger_ids)
    result.items = [TriggerCrudService.trigger_to_out(t, counts.get(t.id, 0)) for t in result.items]

    return result


@router.get("/{trigger_id}", name="get trigger", response_model=TriggerOut)
def get_trigger(
    trigger_id: int,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Get a specific trigger by ID."""
    trigger = db_session.exec(
        select(Trigger).where(and_(Trigger.id == trigger_id, Trigger.user_id == str(auth.id)))
    ).first()
    if not trigger:
        raise HTTPException(status_code=404, detail="Trigger not found")

    counts = TriggerCrudService.get_execution_counts(db_session, [trigger_id])
    return TriggerCrudService.trigger_to_out(trigger, counts.get(trigger_id, 0))


@router.put("/{trigger_id}", name="update trigger", response_model=TriggerOut)
def update_trigger(
    trigger_id: int,
    data: TriggerUpdate,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Update a trigger."""
    try:
        result = TriggerCrudService.update(trigger_id, data, auth.id, db_session)
        _raise_on_error(result)
        return result["trigger_out"]
    except HTTPException:
        raise
    except Exception as e:
        db_session.rollback()
        logger.error("Trigger update failed", extra={"user_id": auth.id, "trigger_id": trigger_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{trigger_id}", name="delete trigger")
def delete_trigger(
    trigger_id: int,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Delete a trigger and its executions."""
    trigger = db_session.exec(
        select(Trigger).where(and_(Trigger.id == trigger_id, Trigger.user_id == str(auth.id)))
    ).first()
    if not trigger:
        raise HTTPException(status_code=404, detail="Trigger not found")

    try:
        db_session.exec(delete(TriggerExecution).where(TriggerExecution.trigger_id == trigger_id))
        db_session.delete(trigger)
        db_session.commit()
        logger.info("Trigger deleted", extra={"user_id": auth.id, "trigger_id": trigger_id})
        return Response(status_code=204)
    except Exception as e:
        db_session.rollback()
        logger.error("Trigger deletion failed", extra={"user_id": auth.id, "trigger_id": trigger_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{trigger_id}/activate", name="activate trigger", response_model=TriggerOut)
def activate_trigger(
    trigger_id: int,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Activate a trigger."""
    try:
        result = TriggerCrudService.activate(trigger_id, auth.id, db_session)
        _raise_on_error(result)
        return result["trigger_out"]
    except HTTPException:
        raise
    except Exception as e:
        db_session.rollback()
        logger.error("Trigger activation failed", extra={"user_id": auth.id, "trigger_id": trigger_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{trigger_id}/deactivate", name="deactivate trigger", response_model=TriggerOut)
def deactivate_trigger(
    trigger_id: int,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    """Deactivate a trigger."""
    try:
        result = TriggerCrudService.deactivate(trigger_id, auth.id, db_session)
        _raise_on_error(result)
        return result["trigger_out"]
    except HTTPException:
        raise
    except Exception as e:
        db_session.rollback()
        logger.error("Trigger deactivation failed", extra={"user_id": auth.id, "trigger_id": trigger_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{trigger_id}/executions", name="list trigger executions")
def list_trigger_executions(
    trigger_id: int,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
) -> Page[TriggerExecutionOut]:
    """List executions for a specific trigger."""
    trigger = db_session.exec(
        select(Trigger).where(and_(Trigger.id == trigger_id, Trigger.user_id == str(auth.id)))
    ).first()
    if not trigger:
        raise HTTPException(status_code=404, detail="Trigger not found")

    stmt = (
        select(TriggerExecution)
        .where(TriggerExecution.trigger_id == trigger_id)
        .order_by(desc(TriggerExecution.created_at))
    )
    return paginate(db_session, stmt)


@router.get("/{trigger_type}/config", name="get trigger type config schema")
def get_trigger_type_config(
    trigger_type: TriggerType,
    auth: V1UserAuth = Depends(auth_must),
) -> TriggerConfigSchemaOut:
    """Get the configuration schema for a specific trigger type."""
    schema = get_config_schema(trigger_type)
    return TriggerConfigSchemaOut(
        trigger_type=trigger_type.value,
        has_config=has_config(trigger_type),
        schema_=schema,
    )
