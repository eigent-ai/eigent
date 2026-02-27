# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi_babel import _
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, col, select

from app.component.auth import Auth, auth_must
from app.component.database import session
from app.model.provider.provider import (
    Provider,
    ProviderIn,
    ProviderOut,
    ProviderPreferIn,
    VaildStatus,
)

logger = logging.getLogger("server_provider_controller")

router = APIRouter(tags=["Provider Management"])


@router.get("/providers", name="list providers", response_model=Page[ProviderOut])
async def gets(
    keyword: str | None = None,
    prefer: bool | None = Query(None, description="Filter by prefer status"),
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
async def post(data: ProviderIn, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Create a new provider."""
    user_id = auth.user.id
    try:
        model = Provider(**data.model_dump(), user_id=user_id)
        model.save(session)
        logger.info(
            "Provider created", extra={"user_id": user_id, "provider_id": model.id, "provider_name": data.provider_name}
        )
        return model
    except Exception as e:
        logger.error("Provider creation failed", extra={"user_id": user_id, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/provider/{id}", name="update provider", response_model=ProviderOut)
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
        logger.info(
            "Provider updated", extra={"user_id": user_id, "provider_id": id, "provider_name": data.provider_name}
        )
        return model
    except Exception as e:
        logger.error(
            "Provider update failed", extra={"user_id": user_id, "provider_id": id, "error": str(e)}, exc_info=True
        )
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/provider/{id}", name="delete provider")
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
        logger.error(
            "Provider deletion failed", extra={"user_id": user_id, "provider_id": id, "error": str(e)}, exc_info=True
        )
        raise HTTPException(status_code=500, detail="Internal server error")


@router.patch("/provider/{id}/invalidate", name="invalidate provider")
async def invalidate(id: int, session: Session = Depends(session), auth: Auth = Depends(auth_must)):
    """Mark a provider as invalid."""
    user_id = auth.user.id
    model = session.exec(
        select(Provider).where(Provider.user_id == user_id, Provider.no_delete(), Provider.id == id)
    ).one_or_none()
    if not model:
        logger.warning("Provider not found for invalidation", extra={"user_id": user_id, "provider_id": id})
        raise HTTPException(status_code=404, detail=_("Provider not found"))

    try:
        model.is_vaild = VaildStatus.not_valid
        model.save(session)
        logger.info("Provider invalidated", extra={"user_id": user_id, "provider_id": id})
        return {"success": True}
    except Exception as e:
        logger.error(
            "Provider invalidation failed", extra={"user_id": user_id, "provider_id": id, "error": str(e)}, exc_info=True
        )
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/provider/prefer", name="set provider prefer")
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
        logger.error(
            "Failed to set preferred provider",
            extra={"user_id": user_id, "provider_id": provider_id, "error": str(e)},
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")
