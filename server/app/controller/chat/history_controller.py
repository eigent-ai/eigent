from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from app.model.chat.chat_history import ChatHistoryOut, ChatHistoryIn, ChatHistory, ChatHistoryUpdate
from fastapi_babel import _
from sqlmodel import Session, select, desc
from app.component.auth import Auth, auth_must
from app.component.database import session

router = APIRouter(prefix="/chat", tags=["Chat History"])


@router.post("/history", name="save chat history", response_model=ChatHistoryOut)
def create_chat_history(data: ChatHistoryIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    data.user_id = auth.user.id
    chat_history = ChatHistory(**data.model_dump())
    session.add(chat_history)
    session.commit()
    session.refresh(chat_history)
    return chat_history


@router.get("/histories", name="get chat history")
def list_chat_history(session: Session = Depends(session), auth: Auth = Depends(auth_must)) -> Page[ChatHistoryOut]:
    stmt = select(ChatHistory).where(ChatHistory.user_id == auth.user.id).order_by(desc(ChatHistory.created_at))
    return paginate(session, stmt)


@router.delete("/history/{history_id}", name="delete chat history")
def delete_chat_history(history_id: str, session: Session = Depends(session)):
    history = session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()
    if not history:
        raise HTTPException(status_code=404, detail="Caht History not found")
    session.delete(history)
    session.commit()
    return Response(status_code=204)


@router.put("/history/{history_id}", name="update chat history", response_model=ChatHistoryOut)
def update_chat_history(
    history_id: int, data: ChatHistoryUpdate, session: Session = Depends(session), auth: Auth = Depends(auth_must)
):
    history = session.exec(select(ChatHistory).where(ChatHistory.id == history_id)).first()
    if not history:
        raise HTTPException(status_code=404, detail="Chat History not found")
    if history.user_id != auth.user.id:
        raise HTTPException(status_code=403, detail="You are not allowed to update this chat history")
    update_data = data.model_dump(exclude_unset=True)
    history.update_fields(update_data)
    history.save(session)
    session.refresh(history)
    return history
