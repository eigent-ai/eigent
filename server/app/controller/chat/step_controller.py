import asyncio
import json
from typing import List, Optional
from fastapi import Depends, HTTPException, Query, Response, APIRouter
from fastapi.responses import StreamingResponse
from sqlmodel import Session, asc, select
from app.component.database import session
from app.component.auth import Auth, auth_must
from fastapi_babel import _
from app.model.chat.chat_step import ChatStep, ChatStepOut, ChatStepIn

router = APIRouter(prefix="/chat", tags=["Chat Step Management"])


@router.get("/steps", name="list chat steps", response_model=List[ChatStepOut])
async def list_chat_steps(
    task_id: str, step: Optional[str] = None, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    query = select(ChatStep)
    if task_id is not None:
        query = query.where(ChatStep.task_id == task_id)
    if step is not None:
        query = query.where(ChatStep.step == step)
    chat_steps = session.exec(query).all()
    return chat_steps


@router.get("/steps/playback/{task_id}", name="Playback Chat Step via SSE")
async def share_playback(
    task_id: str, delay_time: float = 0, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """
    Playbacks the chat steps (SSE).
    """
    if delay_time > 5:
        delay_time = 5

    async def event_generator():
        stmt = select(ChatStep).where(ChatStep.task_id == task_id).order_by(asc(ChatStep.id))
        steps = session.exec(stmt).all()

        if not steps:
            yield f"data: {json.dumps({'error': 'No steps found for this task.'})}\n\n"
            return

        for step in steps:
            step_data = {
                "id": step.id,
                "task_id": step.task_id,
                "step": step.step,
                "data": step.data,
                "created_at": step.created_at.isoformat() if step.created_at else None,
            }
            yield f"data: {json.dumps(step_data)}\n\n"
            if delay_time > 0:
                await asyncio.sleep(delay_time)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/steps/{step_id}", name="get chat step", response_model=ChatStepOut)
async def get_chat_step(step_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    chat_step = session.get(ChatStep, step_id)
    if not chat_step:
        raise HTTPException(status_code=404, detail=_("Chat step not found"))
    return chat_step


@router.post("/steps", name="create chat step")
# TODO Limit request sources
async def create_chat_step(step: ChatStepIn, session: Session = Depends(session)):
    chat_step = ChatStep(
        task_id=step.task_id,
        step=step.step,
        data=step.data,
    )
    session.add(chat_step)
    session.commit()
    session.refresh(chat_step)
    return {"code": 200, "msg": "success"}


@router.put("/steps/{step_id}", name="update chat step", response_model=ChatStepOut)
async def update_chat_step(
    step_id: int, chat_step_update: ChatStep, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    db_chat_step = session.get(ChatStep, step_id)
    if not db_chat_step:
        raise HTTPException(status_code=404, detail=_("Chat step not found"))
    for key, value in chat_step_update.dict(exclude_unset=True).items():
        setattr(db_chat_step, key, value)
    session.add(db_chat_step)
    session.commit()
    session.refresh(db_chat_step)
    return db_chat_step


@router.delete("/steps/{step_id}", name="delete chat step")
async def delete_chat_step(step_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    db_chat_step = session.get(ChatStep, step_id)
    if not db_chat_step:
        raise HTTPException(status_code=404, detail=_("Chat step not found"))
    session.delete(db_chat_step)
    session.commit()
    return Response(status_code=204)
