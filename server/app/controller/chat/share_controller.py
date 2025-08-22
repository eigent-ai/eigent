from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, asc, select
from app.component.database import session
import json
import asyncio
from itsdangerous import SignatureExpired, BadTimeSignature
from starlette.responses import StreamingResponse
from app.model.chat.chat_share import ChatHistoryShareOut, ChatShare, ChatShareIn
from app.model.chat.chat_step import ChatStep
from app.model.chat.chat_history import ChatHistory

router = APIRouter(prefix="/chat", tags=["Chat Share"])


@router.get("/share/info/{token}", name="Get shared chat info", response_model=ChatHistoryShareOut)
def get_share_info(token: str, session: Session = Depends(session)):
    """
    Get shared chat history info by token, excluding sensitive data.
    """
    try:
        task_id = ChatShare.verify_token(token, False)
    except (SignatureExpired, BadTimeSignature):
        raise HTTPException(status_code=400, detail="Share link is invalid or has expired.")

    stmt = select(ChatHistory).where(ChatHistory.task_id == task_id)
    history = session.exec(stmt).one_or_none()

    if not history:
        raise HTTPException(status_code=404, detail="Chat history not found.")

    return history


@router.get("/share/playback/{token}", name="Playback shared chat via SSE")
async def share_playback(token: str, session: Session = Depends(session), delay_time: float = 0):
    """
    Playbacks the chat history via a sharing token (SSE).
    delay_time: control sse interval, max 5 seconds
    """
    if delay_time > 5:
        delay_time = 5
    try:
        task_id = ChatShare.verify_token(token, False)
    except SignatureExpired:
        raise HTTPException(status_code=400, detail="Share link has expired.")
    except BadTimeSignature:
        raise HTTPException(status_code=400, detail="Share link is invalid.")

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
            if delay_time > 0 and step.step != "create_agent":
                await asyncio.sleep(delay_time)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/share", name="Generate sharable link for a task(1 day expiration)")
def create_share_link(data: ChatShareIn):
    """
    Generates a sharing token with an expiration time for the specified task_id.
    """
    share_token = ChatShare.generate_token(data.task_id)
    return {"share_token": share_token}
