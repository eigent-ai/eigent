from app.model.chat.chat_snpshot import ChatSnapshot, ChatSnapshotIn
from typing import List, Optional
from fastapi import Depends, HTTPException, Response, APIRouter
from sqlmodel import Session, select
from app.component.database import session
from app.component.auth import Auth, auth_must
from fastapi_babel import _

router = APIRouter(prefix="/chat", tags=["Chat Snapshot Management"])


@router.get("/snapshots", name="list chat snapshots", response_model=List[ChatSnapshot])
async def list_chat_snapshots(
    api_task_id: Optional[str] = None,
    camel_task_id: Optional[str] = None,
    browser_url: Optional[str] = None,
    session: Session = Depends(session),
):
    query = select(ChatSnapshot)
    if api_task_id is not None:
        query = query.where(ChatSnapshot.api_task_id == api_task_id)
    if camel_task_id is not None:
        query = query.where(ChatSnapshot.camel_task_id == camel_task_id)
    if browser_url is not None:
        query = query.where(ChatSnapshot.browser_url == browser_url)
    snapshots = session.exec(query).all()
    return snapshots


@router.get("/snapshots/{snapshot_id}", name="get chat snapshot", response_model=ChatSnapshot)
async def get_chat_snapshot(snapshot_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    snapshot = session.get(ChatSnapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail=_("Chat snapshot not found"))
    return snapshot


@router.post("/snapshots", name="create chat snapshot", response_model=ChatSnapshot)
async def create_chat_snapshot(
    snapshot: ChatSnapshotIn, auth: Auth = Depends(auth_must), session: Session = Depends(session)
):
    image_path = ChatSnapshotIn.save_image(auth.user.id, snapshot.api_task_id, snapshot.image_base64)
    chat_snapshot = ChatSnapshot(
        user_id=auth.user.id,
        api_task_id=snapshot.api_task_id,
        camel_task_id=snapshot.camel_task_id,
        browser_url=snapshot.browser_url,
        image_path=image_path,
    )
    session.add(chat_snapshot)
    session.commit()
    session.refresh(chat_snapshot)
    return Response(status_code=200)


@router.put("/snapshots/{snapshot_id}", name="update chat snapshot", response_model=ChatSnapshot)
async def update_chat_snapshot(
    snapshot_id: int,
    snapshot_update: ChatSnapshot,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
):
    db_snapshot = session.get(ChatSnapshot, snapshot_id)
    if not db_snapshot:
        raise HTTPException(status_code=404, detail=_("Chat snapshot not found"))
    for key, value in snapshot_update.dict(exclude_unset=True).items():
        setattr(db_snapshot, key, value)
    session.add(db_snapshot)
    session.commit()
    session.refresh(db_snapshot)
    return db_snapshot


@router.delete("/snapshots/{snapshot_id}", name="delete chat snapshot")
async def delete_chat_snapshot(snapshot_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    db_snapshot = session.get(ChatSnapshot, snapshot_id)
    if not db_snapshot:
        raise HTTPException(status_code=404, detail=_("Chat snapshot not found"))
    session.delete(db_snapshot)
    session.commit()
    return Response(status_code=204)
