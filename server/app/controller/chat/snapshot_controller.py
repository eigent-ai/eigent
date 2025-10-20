from app.model.chat.chat_snpshot import ChatSnapshot, ChatSnapshotIn
from typing import List, Optional
from fastapi import Depends, HTTPException, Response, APIRouter
from sqlmodel import Session, select
from app.component.database import session
from app.component.auth import Auth, auth_must
from fastapi_babel import _
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_chat_snapshot")

router = APIRouter(prefix="/chat", tags=["Chat Snapshot Management"])


@router.get("/snapshots", name="list chat snapshots", response_model=List[ChatSnapshot])
@traceroot.trace()
async def list_chat_snapshots(
    api_task_id: Optional[str] = None,
    camel_task_id: Optional[str] = None,
    browser_url: Optional[str] = None,
    session: Session = Depends(session),
):
    """List chat snapshots with optional filtering."""
    query = select(ChatSnapshot)
    if api_task_id is not None:
        query = query.where(ChatSnapshot.api_task_id == api_task_id)
    if camel_task_id is not None:
        query = query.where(ChatSnapshot.camel_task_id == camel_task_id)
    if browser_url is not None:
        query = query.where(ChatSnapshot.browser_url == browser_url)
    
    snapshots = session.exec(query).all()
    logger.debug("Snapshots listed", extra={"api_task_id": api_task_id, "camel_task_id": camel_task_id, "count": len(snapshots)})
    return snapshots


@router.get("/snapshots/{snapshot_id}", name="get chat snapshot", response_model=ChatSnapshot)
@traceroot.trace()
async def get_chat_snapshot(snapshot_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Get specific chat snapshot."""
    user_id = auth.user.id
    snapshot = session.get(ChatSnapshot, snapshot_id)
    
    if not snapshot:
        logger.warning("Snapshot not found", extra={"user_id": user_id, "snapshot_id": snapshot_id})
        raise HTTPException(status_code=404, detail=_("Chat snapshot not found"))
    
    logger.debug("Snapshot retrieved", extra={"user_id": user_id, "snapshot_id": snapshot_id, "api_task_id": snapshot.api_task_id})
    return snapshot


@router.post("/snapshots", name="create chat snapshot", response_model=ChatSnapshot)
@traceroot.trace()
async def create_chat_snapshot(
    snapshot: ChatSnapshotIn, auth: Auth = Depends(auth_must), session: Session = Depends(session)
):
    """Create new chat snapshot from image."""
    user_id = auth.user.id
    
    try:
        image_path = ChatSnapshotIn.save_image(user_id, snapshot.api_task_id, snapshot.image_base64)
        chat_snapshot = ChatSnapshot(
            user_id=user_id,
            api_task_id=snapshot.api_task_id,
            camel_task_id=snapshot.camel_task_id,
            browser_url=snapshot.browser_url,
            image_path=image_path,
        )
        session.add(chat_snapshot)
        session.commit()
        session.refresh(chat_snapshot)
        logger.info("Snapshot created", extra={"user_id": user_id, "snapshot_id": chat_snapshot.id, "api_task_id": snapshot.api_task_id, "image_path": image_path})
        return chat_snapshot
    except Exception as e:
        session.rollback()
        logger.error("Snapshot creation failed", extra={"user_id": user_id, "api_task_id": snapshot.api_task_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/snapshots/{snapshot_id}", name="update chat snapshot", response_model=ChatSnapshot)
@traceroot.trace()
async def update_chat_snapshot(
    snapshot_id: int,
    snapshot_update: ChatSnapshot,
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
):
    """Update chat snapshot."""
    user_id = auth.user.id
    db_snapshot = session.get(ChatSnapshot, snapshot_id)
    
    if not db_snapshot:
        logger.warning("Snapshot not found for update", extra={"user_id": user_id, "snapshot_id": snapshot_id})
        raise HTTPException(status_code=404, detail=_("Chat snapshot not found"))
    
    if db_snapshot.user_id != user_id:
        logger.warning("Unauthorized snapshot update", extra={"user_id": user_id, "snapshot_id": snapshot_id, "owner_id": db_snapshot.user_id})
        raise HTTPException(status_code=403, detail=_("You are not allowed to update this snapshot"))
    
    try:
        update_data = snapshot_update.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_snapshot, key, value)
        session.add(db_snapshot)
        session.commit()
        session.refresh(db_snapshot)
        logger.info("Snapshot updated", extra={"user_id": user_id, "snapshot_id": snapshot_id, "fields_updated": list(update_data.keys())})
        return db_snapshot
    except Exception as e:
        session.rollback()
        logger.error("Snapshot update failed", extra={"user_id": user_id, "snapshot_id": snapshot_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/snapshots/{snapshot_id}", name="delete chat snapshot")
@traceroot.trace()
async def delete_chat_snapshot(snapshot_id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Delete chat snapshot."""
    user_id = auth.user.id
    db_snapshot = session.get(ChatSnapshot, snapshot_id)
    
    if not db_snapshot:
        logger.warning("Snapshot not found for deletion", extra={"user_id": user_id, "snapshot_id": snapshot_id})
        raise HTTPException(status_code=404, detail=_("Chat snapshot not found"))
    
    if db_snapshot.user_id != user_id:
        logger.warning("Unauthorized snapshot deletion", extra={"user_id": user_id, "snapshot_id": snapshot_id, "owner_id": db_snapshot.user_id})
        raise HTTPException(status_code=403, detail=_("You are not allowed to delete this snapshot"))
    
    try:
        session.delete(db_snapshot)
        session.commit()
        logger.info("Snapshot deleted", extra={"user_id": user_id, "snapshot_id": snapshot_id, "image_path": db_snapshot.image_path})
        return Response(status_code=204)
    except Exception as e:
        session.rollback()
        logger.error("Snapshot deletion failed", extra={"user_id": user_id, "snapshot_id": snapshot_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")