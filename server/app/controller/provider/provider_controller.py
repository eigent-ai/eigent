from typing import List, Optional
from fastapi import Depends, HTTPException, Query, Response, APIRouter
from fastapi_babel import _
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlalchemy import update
from sqlmodel import Session, select, col
from sqlalchemy.exc import SQLAlchemyError

from app.component.database import session
from app.component.auth import Auth, auth_must
from app.model.provider.provider import Provider, ProviderIn, ProviderOut, ProviderPreferIn
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_provider_controller")

router = APIRouter(tags=["Provider Management"])


@router.get("/providers", name="list providers", response_model=Page[ProviderOut])
@traceroot.trace()
async def gets(
    keyword: str | None = None,
    prefer: Optional[bool] = Query(None, description="Filter by prefer status"),
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
) -> Page[ProviderOut]:
    """List user's providers with optional filtering."""
    user_id = auth.user.id
    stmt = select(Provider).where(Provider.user_id == user_id, Provider.no_delete())
    if keyword:
        stmt = stmt.where(col(Provider.provider_name).like(f"%{keyword}%"))
    if prefer is not None:
        stmt = stmt.where(Provider.prefer == prefer)
    stmt = stmt.order_by(col(Provider.created_at).desc(), col(Provider.id).desc())
    logger.debug("Providers listed", extra={"user_id": user_id, "keyword": keyword, "prefer_filter": prefer})
    return paginate(session, stmt)


@router.get("/provider", name="get provider detail", response_model=ProviderOut)
@traceroot.trace()
async def get(id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Get provider details."""
    user_id = auth.user.id
    stmt = select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == id)
    model = session.exec(stmt).one_or_none()
    if not model:
        logger.warning("Provider not found", extra={"user_id": user_id, "provider_id": id})
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    logger.debug("Provider retrieved", extra={"user_id": user_id, "provider_id": id})
    return model


@router.post("/provider", name="create provider", response_model=ProviderOut)
@traceroot.trace()
async def post(data: ProviderIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Create a new provider."""
    user_id = auth.user.id
    try:
        model = Provider(**data.model_dump(), user_id=user_id)
        model.save(session)
        logger.info("Provider created", extra={"user_id": user_id, "provider_id": model.id, "provider_name": data.provider_name})
        return model
    except Exception as e:
        logger.error("Provider creation failed", extra={"user_id": user_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/provider/{id}", name="update provider", response_model=ProviderOut)
@traceroot.trace()
async def put(id: int, data: ProviderIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Update provider details."""
    user_id = auth.user.id
    model = session.exec(
        select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == id)
    ).one_or_none()
    if not model:
        logger.warning("Provider not found for update", extra={"user_id": user_id, "provider_id": id})
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    
    try:
        model.model_type = data.model_type
        model.provider_name = data.provider_name
        model.api_key = data.api_key
        model.endpoint_url = data.endpoint_url
        model.encrypted_config = data.encrypted_config
        model.is_vaild = data.is_vaild
        model.save(session)
        session.refresh(model)
        logger.info("Provider updated", extra={"user_id": user_id, "provider_id": id, "provider_name": data.provider_name})
        return model
    except Exception as e:
        logger.error("Provider update failed", extra={"user_id": user_id, "provider_id": id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/provider/{id}", name="delete provider")
@traceroot.trace()
async def delete(id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Delete a provider."""
    user_id = auth.user.id
    model = session.exec(
        select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == id)
    ).one_or_none()
    if not model:
        logger.warning("Provider not found for deletion", extra={"user_id": user_id, "provider_id": id})
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    
    try:
        model.delete(session)
        logger.info("Provider deleted", extra={"user_id": user_id, "provider_id": id})
        return Response(status_code=204)
    except Exception as e:
        logger.error("Provider deletion failed", extra={"user_id": user_id, "provider_id": id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/provider/prefer", name="set provider prefer")
@traceroot.trace()
async def set_prefer(data: ProviderPreferIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Set preferred provider for user."""
    user_id = auth.user.id
    provider_id = data.provider_id
    
    try:
        # 1. Set all current user's providers prefer to false
        session.exec(update(Provider).where(Provider.user_id == user_id, Provider.no_delete()).values(prefer=False))
        # 2. Set the prefer of the specified provider_id to true
        session.exec(
            update(Provider)
            .where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == provider_id)
            .values(prefer=True)
        )
        session.commit()
        logger.info("Preferred provider set", extra={"user_id": user_id, "provider_id": provider_id})
        return {"success": True}
    except SQLAlchemyError as e:
        session.rollback()
        logger.error("Failed to set preferred provider", extra={"user_id": user_id, "provider_id": provider_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")