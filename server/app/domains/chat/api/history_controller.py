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

"""Chat History controller. Uses ChatService for grouping."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from loguru import logger
from sqlmodel import Session, case, delete, desc, func, select
from fastapi_babel import _

from app.core.database import session
from app.model.chat.chat_history import ChatHistory, ChatHistoryIn, ChatHistoryOut, ChatHistoryUpdate, ChatStatus
from app.model.chat.chat_history_grouped import GroupedHistoryResponse, ProjectGroup
from app.model.trigger.trigger import Trigger
from app.model.trigger.trigger_execution import TriggerExecution
from app.model.user.key import Key
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth
from app.domains.chat.service.chat_service import ChatService

router = APIRouter(prefix="/chat", tags=["Chat History"])


@router.post("/history", name="save chat history", response_model=ChatHistoryOut)
def create_chat_history(data: ChatHistoryIn, db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    data.user_id = auth.id
    chat_history = ChatHistory(**data.model_dump())
    db_session.add(chat_history)
    db_session.commit()
    db_session.refresh(chat_history)
    return chat_history


@router.get("/histories", name="get chat history")
def list_chat_history(db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)) -> Page[ChatHistoryOut]:
    stmt = (
        select(ChatHistory)
        .where(ChatHistory.user_id == auth.id)
        .order_by(
            desc(case((ChatHistory.created_at.is_(None), 0), else_=1)),
            desc(ChatHistory.created_at),
            desc(ChatHistory.id),
        )
    )
    return paginate(db_session, stmt)


@router.get("/histories/grouped", name="get grouped chat history")
def list_grouped_chat_history(
    include_tasks: Optional[bool] = Query(True, description="Whether to include individual tasks in groups"),
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
) -> GroupedHistoryResponse:
    return ChatService.get_grouped_histories(auth.id, include_tasks, db_session)


@router.get("/histories/grouped/{project_id}", name="get single grouped project")
def get_grouped_project(
    project_id: str,
    include_tasks: Optional[bool] = Query(True, description="Whether to include individual tasks in the project"),
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
) -> ProjectGroup:
    result = ChatService.get_grouped_project(auth.id, project_id, include_tasks, db_session)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.delete("/history/{history_id}", name="delete chat history")
def delete_chat_history(history_id: int, db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)):
    history = db_session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()
    if not history:
        raise HTTPException(status_code=404, detail="Chat History not found")
    if history.user_id != auth.id:
        raise HTTPException(status_code=403, detail="You are not allowed to delete this chat history")

    project_id = history.project_id if history.project_id else history.task_id

    sibling_count = (
        db_session.exec(
            select(func.count(ChatHistory.id)).where(
                ChatHistory.id != history_id,
                ChatHistory.project_id == project_id if history.project_id else ChatHistory.task_id == project_id,
            )
        ).first()
        or 0
    )

    db_session.delete(history)

    if sibling_count == 0:
        triggers = db_session.exec(select(Trigger).where(Trigger.project_id == project_id)).all()
        for trigger in triggers:
            db_session.exec(delete(TriggerExecution).where(TriggerExecution.trigger_id == trigger.id))
            db_session.delete(trigger)
        logger.info(
            "Deleted triggers for removed project", extra={"project_id": project_id, "trigger_count": len(triggers)}
        )

    db_session.commit()
    return Response(status_code=204)


@router.put("/history/{history_id}", name="update chat history", response_model=ChatHistoryOut)
async def update_chat_history(
    history_id: int, data: ChatHistoryUpdate, db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)
):
    history = db_session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()
    if not history:
        raise HTTPException(status_code=404, detail="Chat History not found")
    if history.user_id != auth.id:
        raise HTTPException(status_code=403, detail="You are not allowed to update this chat history")

    update_data = data.model_dump(exclude_unset=True)
    history.update_fields(update_data)
    history.save(db_session)

    db_session.refresh(history)
    return history


@router.put("/project/{project_id}/name", name="update project name")
def update_project_name(
    project_id: str, new_name: str, db_session: Session = Depends(session), auth: V1UserAuth = Depends(auth_must)
):
    user_id = auth.id
    stmt = select(ChatHistory).where(ChatHistory.project_id == project_id).where(ChatHistory.user_id == user_id)
    histories = db_session.exec(stmt).all()

    if not histories:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    try:
        for history in histories:
            history.project_name = new_name
            db_session.add(history)
        db_session.commit()
        return Response(status_code=200)
    except Exception as e:
        db_session.rollback()
        logger.error("Project name update failed", extra={"user_id": user_id, "project_id": project_id, "error": str(e)})
        raise HTTPException(status_code=500, detail="Internal server error")
