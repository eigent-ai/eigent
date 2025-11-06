from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from app.model.chat.chat_history import ChatHistoryOut, ChatHistoryIn, ChatHistory, ChatHistoryUpdate
from fastapi_babel import _
from sqlmodel import Session, select, desc, case
from app.component.auth import Auth, auth_must
from app.component.database import session
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_chat_history")

router = APIRouter(prefix="/chat", tags=["Chat History"])


@router.post("/history", name="save chat history", response_model=ChatHistoryOut)
@traceroot.trace()
def create_chat_history(data: ChatHistoryIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Save new chat history."""
    user_id = auth.user.id
    
    try:
        data.user_id = user_id
        chat_history = ChatHistory(**data.model_dump())
        session.add(chat_history)
        session.commit()
        session.refresh(chat_history)
        logger.info("Chat history created", extra={"user_id": user_id, "history_id": chat_history.id, "task_id": data.task_id})
        return chat_history
    except Exception as e:
        session.rollback()
        logger.error("Chat history creation failed", extra={"user_id": user_id, "task_id": data.task_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/histories", name="get chat history")
@traceroot.trace()
def list_chat_history(session: Session = Depends(session), auth: Auth = Depends(auth_must)) -> Page[ChatHistoryOut]:
    """List chat histories for current user."""
    user_id = auth.user.id
    
    # Order by created_at descending, but fallback to id descending for old records without timestamps
    # This ensures newer records with timestamps come first, followed by old records ordered by id
    stmt = (
        select(ChatHistory)
        .where(ChatHistory.user_id == user_id)
        .order_by(
            desc(case((ChatHistory.created_at.is_(None), 0), else_=1)),  # Non-null created_at first
            desc(ChatHistory.created_at),  # Then by created_at descending
            desc(ChatHistory.id)  # Finally by id descending for records with same/null created_at
        )
    )
    
    result = paginate(session, stmt)
    total = result.total if hasattr(result, 'total') else 0
    logger.debug("Chat histories listed", extra={"user_id": user_id, "total": total})
    return result


@router.delete("/history/{history_id}", name="delete chat history")
@traceroot.trace()
def delete_chat_history(history_id: str, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Delete chat history."""
    user_id = auth.user.id
    history = session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()
    
    if not history:
        logger.warning("Chat history not found for deletion", extra={"user_id": user_id, "history_id": history_id})
        raise HTTPException(status_code=404, detail="Chat History not found")
    
    if history.user_id != user_id:
        logger.warning("Unauthorized deletion attempt", extra={"user_id": user_id, "history_id": history_id, "owner_id": history.user_id})
        raise HTTPException(status_code=403, detail="You are not allowed to delete this chat history")
    
    try:
        session.delete(history)
        session.commit()
        logger.info("Chat history deleted", extra={"user_id": user_id, "history_id": history_id})
        return Response(status_code=204)
    except Exception as e:
        session.rollback()
        logger.error("Chat history deletion failed", extra={"user_id": user_id, "history_id": history_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/history/{history_id}", name="update chat history", response_model=ChatHistoryOut)
@traceroot.trace()
def update_chat_history(
    history_id: int, data: ChatHistoryUpdate, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    """Update chat history."""
    user_id = auth.user.id
    history = session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()
    
    if not history:
        logger.warning("Chat history not found for update", extra={"user_id": user_id, "history_id": history_id})
        raise HTTPException(status_code=404, detail="Chat History not found")
    
    if history.user_id != user_id:
        logger.warning("Unauthorized update attempt", extra={"user_id": user_id, "history_id": history_id, "owner_id": history.user_id})
        raise HTTPException(status_code=403, detail="You are not allowed to update this chat history")
    
    try:
        update_data = data.model_dump(exclude_unset=True)
        history.update_fields(update_data)
        history.save(session)
        session.refresh(history)
        logger.info("Chat history updated", extra={"user_id": user_id, "history_id": history_id, "fields_updated": list(update_data.keys())})
        return history
    except Exception as e:
        logger.error("Chat history update failed", extra={"user_id": user_id, "history_id": history_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")