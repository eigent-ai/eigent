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

# STATUS: full-rewrite (uses ProviderService, self-managed session)
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi_babel import _
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlmodel import paginate
from sqlmodel import Session, select, col

from app.core.database import session
from app.model.provider.provider import Provider, ProviderIn, ProviderOut, ProviderPreferIn
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth
from app.domains.model_provider.service.provider_service import ProviderService

router = APIRouter(tags=["Provider Management"])


@router.get("/providers", name="list providers", response_model=Page[ProviderOut])
async def gets(
    keyword: str | None = None,
    prefer: Optional[bool] = Query(None, description="Filter by prefer status"),
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
) -> Page[ProviderOut]:
    # Pagination still needs session for paginate() — use session directly for this read-only query
    stmt = select(Provider).where(Provider.user_id == auth.id, Provider.no_delete())
    if keyword:
        stmt = stmt.where(col(Provider.provider_name).like(f"%{keyword}%"))
    if prefer is not None:
        stmt = stmt.where(Provider.prefer == prefer)
    stmt = stmt.order_by(col(Provider.created_at).desc(), col(Provider.id).desc())
    return paginate(db_session, stmt)


@router.get("/provider", name="get provider detail", response_model=ProviderOut)
async def get(id: int, auth: V1UserAuth = Depends(auth_must)):
    model = ProviderService.get(id, auth.id)
    if not model:
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    return model


@router.post("/provider", name="create provider", response_model=ProviderOut)
async def post(data: ProviderIn, auth: V1UserAuth = Depends(auth_must)):
    result = ProviderService.create(auth.id, data.model_dump())
    return result["provider"]


@router.put("/provider/{id}", name="update provider", response_model=ProviderOut)
async def put(id: int, data: ProviderIn, auth: V1UserAuth = Depends(auth_must)):
    result = ProviderService.update(id, auth.id, data.model_dump())
    if not result["success"]:
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    return result["provider"]


@router.get("/provider/{id}/models", name="get provider models")
async def get_models(id: int, auth: V1UserAuth = Depends(auth_must)):
    """Get the list of sub-models for a provider."""
    model = ProviderService.get(id, auth.id)
    if not model:
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    return {"models": model.model_types or []}


@router.delete("/provider/{id}", name="delete provider")
async def delete(id: int, auth: V1UserAuth = Depends(auth_must)):
    if not ProviderService.delete(id, auth.id):
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    return Response(status_code=204)


@router.patch("/provider/{id}/invalidate", name="invalidate provider")
async def invalidate(id: int, auth: V1UserAuth = Depends(auth_must)):
    result = ProviderService.invalidate(id, auth.id)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=_("Provider not found"))
    return {"success": True}


@router.post("/provider/prefer", name="set provider prefer")
async def set_prefer(data: ProviderPreferIn, auth: V1UserAuth = Depends(auth_must)):
    result = ProviderService.set_prefer(data.provider_id, auth.id)
    if not result["success"]:
        raise HTTPException(status_code=500, detail="Failed to set prefer")
    return {"success": True}
