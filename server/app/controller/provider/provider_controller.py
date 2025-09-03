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


router = APIRouter(tags=["Provider Management"])


@router.get("/providers", name="list providers", response_model=Page[ProviderOut])
async def gets(
    keyword: str | None = None,
    prefer: Optional[bool] = Query(None, description="Filter by prefer status"),
    session: Session = Depends(session),
    auth: Auth = Depends(auth_must),
) -> Page[ProviderOut]:
    user_id = auth.user.id
    stmt = select(Provider).where(Provider.user_id == user_id, Provider.no_delete())
    if keyword:
        stmt = stmt.where(col(Provider.provider_name).like(f"%{keyword}%"))
    if prefer is not None:
        stmt = stmt.where(Provider.prefer == prefer)
    stmt = stmt.order_by(col(Provider.created_at).desc(), col(Provider.id).desc())  # Added for consistent pagination
    return paginate(session, stmt)


@router.get("/provider", name="get provider detail", response_model=ProviderOut)
async def get(id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    user_id = auth.user.id
    stmt = select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == id)
    model = session.exec(stmt).one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    return model


@router.post("/provider", name="create provider", response_model=ProviderOut)
async def post(data: ProviderIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    user_id = auth.user.id
    model = Provider(**data.model_dump(), user_id=user_id)
    model.save(session)
    return model


@router.put("/provider/{id}", name="update provider", response_model=ProviderOut)
async def put(id: int, data: ProviderIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    user_id = auth.user.id
    model = session.exec(
        select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == id)
    ).one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    model.model_type = data.model_type
    model.provider_name = data.provider_name
    model.api_key = data.api_key
    model.endpoint_url = data.endpoint_url
    model.encrypted_config = data.encrypted_config
    model.is_vaild = data.is_vaild
    model.save(session)
    session.refresh(model)
    return model


@router.delete("/provider/{id}", name="delete provider")
async def delete(id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    user_id = auth.user.id
    model = session.exec(
        select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == id)
    ).one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    model.delete(session)
    return Response(status_code=204)


@router.post("/provider/prefer", name="set provider prefer")
async def set_prefer(data: ProviderPreferIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    user_id = auth.user.id
    try:
        # 1. current user's all provider prefer set to false
        session.exec(update(Provider).where(Provider.user_id == user_id, Provider.no_delete()).values(prefer=False))
        # 2. set the prefer of the specified provider_id to true
        session.exec(
            update(Provider)
            .where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == data.provider_id)
            .values(prefer=True)
        )
        session.commit()
        return {"success": True}
    except SQLAlchemyError as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))
