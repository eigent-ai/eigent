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

"""v1 Chat Step - H1 auth, H2 ownership, P2 dedicated Update model.
STATUS: full-rewrite (security: H1, H2, P2 Update model)
"""

import asyncio
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.sql.expression import case
from sqlmodel import Session, asc, select

from app.core.database import session
from app.model.chat.chat_step import ChatStep, ChatStepOut, ChatStepIn, ChatStepUpdate
from app.model.chat.chat_history import ChatHistory

from app.shared.auth import auth_must
from app.domains.chat.service import ChatService
from app.domains.chat.schema import TaskOwnershipCheckReq

router = APIRouter(prefix="/chat", tags=["V1 Chat Step"])


def _task_owned_by_user(db: Session, task_id: str, user_id: int) -> bool:
    return ChatService.verify_task_ownership(TaskOwnershipCheckReq(task_id=task_id, user_id=user_id))


@router.get("/steps", name="list chat steps", response_model=List[ChatStepOut])
async def list_chat_steps(
    task_id: str,
    step: Optional[str] = None,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    if not _task_owned_by_user(db_session, task_id, auth.user.id):
        return []
    query = select(ChatStep).where(ChatStep.task_id == task_id)
    if step is not None:
        query = query.where(ChatStep.step == step)
    return list(db_session.exec(query).all())


@router.get("/steps/playback/{task_id}", name="Playback Chat Step via SSE")
async def share_playback(
    task_id: str,
    delay_time: float = 0,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    if delay_time > 5:
        delay_time = 5
    if not _task_owned_by_user(db_session, task_id, auth.user.id):
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_generator():
        stmt = select(ChatStep).where(ChatStep.task_id == task_id).order_by(
            asc(case((ChatStep.timestamp.is_(None), 1), else_=0)),
            asc(ChatStep.timestamp),
            asc(ChatStep.id),
        )
        steps = db_session.exec(stmt).all()
        if not steps:
            yield f"data: {json.dumps({'error': 'No steps found for this task.'})}\n\n"
            return
        for s in steps:
            step_data = {
                "id": s.id,
                "task_id": s.task_id,
                "step": s.step,
                "data": s.data,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            yield f"data: {json.dumps(step_data)}\n\n"
            if delay_time > 0:
                await asyncio.sleep(delay_time)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/steps/{step_id}", name="get chat step", response_model=ChatStepOut)
async def get_chat_step(
    step_id: int,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    chat_step = db_session.get(ChatStep, step_id)
    if not chat_step:
        raise HTTPException(status_code=404, detail="Chat step not found")
    if not _task_owned_by_user(db_session, chat_step.task_id, auth.user.id):
        raise HTTPException(status_code=404, detail="Chat step not found")
    return chat_step


@router.post("/steps", name="create chat step")
async def create_chat_step(
    step: ChatStepIn,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    if not _task_owned_by_user(db_session, step.task_id, auth.user.id):
        raise HTTPException(status_code=403, detail="Task not found or access denied")
    chat_step = ChatStep(
        task_id=step.task_id,
        step=step.step,
        data=step.data,
        timestamp=step.timestamp,
    )
    db_session.add(chat_step)
    db_session.commit()
    db_session.refresh(chat_step)
    return {"code": 200, "msg": "success"}


@router.put("/steps/{step_id}", name="update chat step", response_model=ChatStepOut)
async def update_chat_step(
    step_id: int,
    chat_step_update: ChatStepUpdate,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    db_chat_step = db_session.get(ChatStep, step_id)
    if not db_chat_step:
        raise HTTPException(status_code=404, detail="Chat step not found")
    if not _task_owned_by_user(db_session, db_chat_step.task_id, auth.user.id):
        raise HTTPException(status_code=404, detail="Chat step not found")
    for key, value in chat_step_update.model_dump(exclude_unset=True).items():
        setattr(db_chat_step, key, value)
    db_session.add(db_chat_step)
    db_session.commit()
    db_session.refresh(db_chat_step)
    return db_chat_step


@router.delete("/steps/{step_id}", name="delete chat step")
async def delete_chat_step(
    step_id: int,
    db_session: Session = Depends(session),
    auth=Depends(auth_must),
):
    db_chat_step = db_session.get(ChatStep, step_id)
    if not db_chat_step:
        raise HTTPException(status_code=404, detail="Chat step not found")
    if not _task_owned_by_user(db_session, db_chat_step.task_id, auth.user.id):
        raise HTTPException(status_code=404, detail="Chat step not found")
    db_session.delete(db_chat_step)
    db_session.commit()
    return Response(status_code=204)
