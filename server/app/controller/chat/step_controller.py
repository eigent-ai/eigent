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
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_chat_step")

router = APIRouter(prefix="/chat", tags=["Chat Step Management"])


@router.get("/steps", name="list chat steps", response_model=List[ChatStepOut])
@traceroot.trace()
async def list_chat_steps(
    task_id: str, step: Optional[str] = None, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """List chat steps for a task with optional step type filtering."""
    user_id = auth.user.id
    query = select(ChatStep)
    if task_id is not None:
        query = query.where(ChatStep.task_id == task_id)
    if step is not None:
        query = query.where(ChatStep.step == step)
    
    chat_steps = session.exec(query).all()
    logger.debug("Chat steps listed", extra={"user_id": user_id, "task_id": task_id, "step_type": step, "count": len(chat_steps)})
    return chat_steps


@router.get("/steps/playback/{task_id}", name="Playback Chat Step via SSE")
@traceroot.trace()
async def share_playback(
    task_id: str, delay_time: float = 0, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """Playback chat steps via SSE stream."""
    user_id = auth.user.id
    if delay_time > 5:
        logger.debug("Delay time capped", extra={"user_id": user_id, "task_id": task_id, "requested": delay_time, "capped": 5})
        delay_time = 5

    async def event_generator():
        try:
            stmt = select(ChatStep).where(ChatStep.task_id == task_id).order_by(asc(ChatStep.id))
            steps = session.exec(stmt).all()

            if not steps:
                logger.warning("No steps found for playback", extra={"user_id": user_id, "task_id": task_id})
                yield f"data: {json.dumps({'error': 'No steps found for this task.'})}\n\n"
                return

            logger.info("Chat step playback started", extra={"user_id": user_id, "task_id": task_id, "step_count": len(steps), "delay_time": delay_time})
            
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

            
            logger.info("Chat step playback completed", extra={"user_id": user_id, "task_id": task_id, "step_count": len(steps)})
        except Exception as e:
            logger.error("Chat step playback error", extra={"user_id": user_id, "task_id": task_id, "error": str(e)}, exc_info=True)
            yield f"data: {json.dumps({'error': 'Playback error occurred.'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/steps/{step_id}", name="get chat step", response_model=ChatStepOut)
@traceroot.trace()
async def get_chat_step(step_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Get specific chat step."""
    user_id = auth.user.id
    chat_step = session.get(ChatStep, step_id)
    
    if not chat_step:
        logger.warning("Chat step not found", extra={"user_id": user_id, "step_id": step_id})
        raise HTTPException(status_code=404, detail=_("Chat step not found"))
    
    logger.debug("Chat step retrieved", extra={"user_id": user_id, "step_id": step_id, "task_id": chat_step.task_id})
    return chat_step


@router.post("/steps", name="create chat step")
@traceroot.trace()
async def create_chat_step(step: ChatStepIn, session: Session = Depends(session)):
    """Create new chat step. TODO: Implement request source validation."""
    try:
        chat_step = ChatStep(
            task_id=step.task_id,
            step=step.step,
            data=step.data,
        )
        session.add(chat_step)
        session.commit()
        session.refresh(chat_step)
        logger.info("Chat step created", extra={"step_id": chat_step.id, "task_id": step.task_id, "step_type": step.step})
        return {"code": 200, "msg": "success"}
    except Exception as e:
        session.rollback()
        logger.error("Chat step creation failed", extra={"task_id": step.task_id, "step_type": step.step, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/steps/{step_id}", name="update chat step", response_model=ChatStepOut)
@traceroot.trace()
async def update_chat_step(
    step_id: int, chat_step_update: ChatStep, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """Update chat step."""
    user_id = auth.user.id
    db_chat_step = session.get(ChatStep, step_id)
    
    if not db_chat_step:
        logger.warning("Chat step not found for update", extra={"user_id": user_id, "step_id": step_id})
        raise HTTPException(status_code=404, detail=_("Chat step not found"))

    try:
        update_data = chat_step_update.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_chat_step, key, value)
        session.add(db_chat_step)
        session.commit()
        session.refresh(db_chat_step)
        logger.info("Chat step updated", extra={"user_id": user_id, "step_id": step_id, "task_id": db_chat_step.task_id, "fields_updated": list(update_data.keys())})
        return db_chat_step
    except Exception as e:
        session.rollback()
        logger.error("Chat step update failed", extra={"user_id": user_id, "step_id": step_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/steps/{step_id}", name="delete chat step")
@traceroot.trace()
async def delete_chat_step(step_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Delete chat step."""
    user_id = auth.user.id
    db_chat_step = session.get(ChatStep, step_id)
    
    if not db_chat_step:
        logger.warning("Chat step not found for deletion", extra={"user_id": user_id, "step_id": step_id})
        raise HTTPException(status_code=404, detail=_("Chat step not found"))

    try:
        session.delete(db_chat_step)
        session.commit()
        logger.info("Chat step deleted", extra={"user_id": user_id, "step_id": step_id, "task_id": db_chat_step.task_id})
        return Response(status_code=204)
    except Exception as e:
        session.rollback()
        logger.error("Chat step deletion failed", extra={"user_id": user_id, "step_id": step_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")