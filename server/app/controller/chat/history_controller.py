from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from app.model.chat.chat_history import ChatHistoryOut, ChatHistoryIn, ChatHistory, ChatHistoryUpdate
from fastapi_babel import _
from sqlmodel import Session, select, desc
from app.component.auth import Auth, auth_must
from app.component.database import session
import traceroot

logger = traceroot.get_logger("server_chat_history")

router = APIRouter(prefix="/chat", tags=["Chat History"])


@router.post("/history", name="save chat history", response_model=ChatHistoryOut)
@traceroot.trace()
def create_chat_history(data: ChatHistoryIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    logger.info(f"Creating chat history for user {auth.user.id}, task_id: {data.task_id}")
    data.user_id = auth.user.id
    chat_history = ChatHistory(**data.model_dump())
    session.add(chat_history)
    session.commit()
    session.refresh(chat_history)
    logger.info(f"Chat history created: {chat_history.id}")
    return chat_history


@router.get("/histories", name="get chat history")
@traceroot.trace()
def list_chat_history(session: Session = Depends(session), auth: Auth = Depends(auth_must)) -> Page[ChatHistoryOut]:
    logger.info(f"Listing chat histories for user {auth.user.id}")
    stmt = select(ChatHistory).where(ChatHistory.user_id == auth.user.id).order_by(desc(ChatHistory.created_at))
    result = paginate(session, stmt)
    logger.debug(f"Found {result.total if hasattr(result, 'total') else 'N/A'} chat histories")
    return result


@router.delete("/history/{history_id}", name="delete chat history")
@traceroot.trace()
def delete_chat_history(history_id: str, session: Session = Depends(session)):
    logger.info(f"Deleting chat history: {history_id}")
    history = session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()
    if not history:
        logger.warning(f"Chat history not found: {history_id}")
        raise HTTPException(status_code=404, detail="Chat History not found")
    session.delete(history)
    session.commit()
    logger.info(f"Chat history deleted: {history_id}")
    return Response(status_code=204)


@router.put("/history/{history_id}", name="update chat history", response_model=ChatHistoryOut)
@traceroot.trace()
def update_chat_history(
    history_id: int, data: ChatHistoryUpdate, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    logger.info(f"Updating chat history: {history_id} for user {auth.user.id}")
    history = session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()
    if not history:
        logger.warning(f"Chat history not found: {history_id}")
        raise HTTPException(status_code=404, detail="Chat History not found")
    if history.user_id != auth.user.id:
        logger.warning(f"Unauthorized update attempt on history {history_id} by user {auth.user.id}")
        raise HTTPException(status_code=403, detail="You are not allowed to update this chat history")
    update_data = data.model_dump(exclude_unset=True)
    logger.debug(f"Update data: {list(update_data.keys())}")
    history.update_fields(update_data)
    history.save(session)
    session.refresh(history)
    logger.info(f"Chat history updated: {history_id}")
    return history
