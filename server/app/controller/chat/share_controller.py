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
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_chat_share")

router = APIRouter(prefix="/chat", tags=["Chat Share"])


@router.get("/share/info/{token}", name="Get shared chat info", response_model=ChatHistoryShareOut)
@traceroot.trace()
def get_share_info(token: str, session: Session = Depends(session)):
    """
    Get shared chat history info by token, excluding sensitive data.
    """
    try:
        task_id = ChatShare.verify_token(token, False)
    except SignatureExpired:
        logger.warning("Shared chat access failed: token expired", extra={"token_prefix": token[:10]})
        raise HTTPException(status_code=400, detail="Share link is invalid or has expired.")
    except BadTimeSignature:
        logger.warning("Shared chat access failed: invalid token", extra={"token_prefix": token[:10]})
        raise HTTPException(status_code=400, detail="Share link is invalid or has expired.")

    stmt = select(ChatHistory).where(ChatHistory.task_id == task_id)
    history = session.exec(stmt).one_or_none()

    if not history:
        logger.warning("Shared chat not found", extra={"task_id": task_id})
        raise HTTPException(status_code=404, detail="Chat history not found.")

    logger.info("Shared chat info accessed", extra={"task_id": task_id})
    return history


@router.get("/share/playback/{token}", name="Playback shared chat via SSE")
@traceroot.trace()
async def share_playback(token: str, session: Session = Depends(session), delay_time: float = 0):
    """
    Playbacks the chat history via a sharing token (SSE).
    delay_time: control sse interval, max 5 seconds
    """
    if delay_time > 5:
        logger.debug("Delay time capped", extra={"requested": delay_time, "capped": 5})
        delay_time = 5
    
    try:
        task_id = ChatShare.verify_token(token, False)
    except SignatureExpired:
        logger.warning("Shared chat playback failed: token expired", extra={"token_prefix": token[:10]})
        raise HTTPException(status_code=400, detail="Share link has expired.")
    except BadTimeSignature:
        logger.warning("Shared chat playback failed: invalid token", extra={"token_prefix": token[:10]})
        raise HTTPException(status_code=400, detail="Share link is invalid.")

    async def event_generator():
        try:
            stmt = select(ChatStep).where(ChatStep.task_id == task_id).order_by(asc(ChatStep.id))
            steps = session.exec(stmt).all()

            if not steps:
                logger.warning("No steps found for playback", extra={"task_id": task_id})
                yield f"data: {json.dumps({'error': 'No steps found for this task.'})}\n\n"
                return

            logger.info("Shared chat playback started", extra={"task_id": task_id, "step_count": len(steps), "delay_time": delay_time})
            
            for idx, step in enumerate(steps, start=1):
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
            
            logger.info("Shared chat playback completed", extra={"task_id": task_id, "step_count": len(steps)})
        except Exception as e:
            logger.error("Shared chat playback error", extra={"task_id": task_id, "error": str(e)}, exc_info=True)
            yield f"data: {json.dumps({'error': 'Playback error occurred.'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/share", name="Generate sharable link for a task(1 day expiration)")
@traceroot.trace()
def create_share_link(data: ChatShareIn):
    """Generate sharing token with 1-day expiration for task."""
    try:
        share_token = ChatShare.generate_token(data.task_id)
        logger.info("Share link created", extra={"task_id": data.task_id, "token_prefix": share_token[:10]})
        return {"share_token": share_token}
    except Exception as e:
        logger.error("Share link creation failed", extra={"task_id": data.task_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")