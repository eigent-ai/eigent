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

"""Model provider metadata routes.

The server keeps a provider as non-secret metadata only. The provider's key and
every other secret part stay on the user's device, so no route here accepts or
returns one.

``/model-providers`` is the current API. The older ``/providers`` and
``/provider`` routes exchanged the key itself; they are retired and answer in a
way released desktop versions handle: an empty list for reads and a clear
refusal for writes.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi_babel import _
from fastapi_pagination import Page, Params
from fastapi_pagination.ext.sqlmodel import paginate
from loguru import logger
from pydantic import BaseModel
from sqlmodel import Session, col, select

from app.core.database import session
from app.domains.model_provider.service.provider_service import ProviderService
from app.model.provider.metadata import (
    MAX_WRITE_BYTES,
    InvalidModelProvider,
    ModelProviderWrite,
    parse_model_provider_write,
)
from app.model.provider.provider import ModelProviderOut, Provider, ProviderModelMetadata, ProviderPreferIn
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth

router = APIRouter(tags=["Provider Management"])

INVALID_WRITE_MESSAGE = (
    "This request is not a valid model provider. Send only provider_name, model_type, endpoint_url, "
    "config and is_valid. Keys and other secrets stay on the device and are never sent."
)
RETIRED_WRITE_MESSAGE = (
    "This version of Eigent can no longer save model provider settings. "
    "Update Eigent to the latest version to keep using your own models."
)


class SuccessOut(BaseModel):
    success: bool


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail=_("Provider not found"))


def _refused(fields: list[str]) -> HTTPException:
    # Field names only. A submitted value is never repeated in an answer or a log line.
    logger.info("Model provider write refused")
    return HTTPException(
        status_code=422,
        detail={"code": "invalid_model_provider", "message": INVALID_WRITE_MESSAGE, "fields": fields},
    )


async def model_provider_write(request: Request) -> ModelProviderWrite:
    """Read and check a write body here, so no framework error can echo it."""
    raw = b""
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > MAX_WRITE_BYTES:
            raise _refused(["body"])
    try:
        payload = json.loads(raw)
    except ValueError:
        raise _refused(["body"]) from None
    try:
        return parse_model_provider_write(payload)
    except InvalidModelProvider as error:
        raise _refused(error.fields) from None


@router.get("/provider-models", response_model=list[ProviderModelMetadata])
async def model_catalog(
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
) -> list[ProviderModelMetadata]:
    # Extract the two model overrides in SQL; this metadata-only request never
    # loads the address or the rest of the stored settings.
    stmt = (
        select(
            Provider.provider_name,
            Provider.model_type,
            Provider.is_valid,
            col(Provider.encrypted_config)["model_platform"].as_string().label("configured_model_platform"),
            col(Provider.encrypted_config)["model_type"].as_string().label("configured_model_type"),
        )
        .where(Provider.user_id == auth.id, Provider.no_delete())
        .limit(513)
    )
    metadata_rows = db_session.exec(stmt).all()
    if len(metadata_rows) > 512:
        raise HTTPException(status_code=413, detail="Provider catalog exceeds limit")
    return [ProviderModelMetadata.from_projection(*row) for row in metadata_rows]


@router.get("/model-providers", name="list model providers", response_model=Page[ModelProviderOut])
async def list_model_providers(
    keyword: str | None = None,
    prefer: bool | None = Query(None, description="Filter by prefer status"),
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
) -> Page[ModelProviderOut]:
    return paginate(
        db_session,
        ProviderService.owned(auth.id, keyword, prefer),
        transformer=lambda rows: [ModelProviderOut.from_row(row) for row in rows],
    )


@router.post("/model-providers", name="create model provider", response_model=ModelProviderOut)
async def create_model_provider(
    auth: V1UserAuth = Depends(auth_must),
    data: ModelProviderWrite = Depends(model_provider_write),
) -> ModelProviderOut:
    result = ProviderService.create(auth.id, data)
    return ModelProviderOut.from_row(result["provider"])


@router.post("/model-providers/prefer", name="set preferred model provider", response_model=SuccessOut)
@router.post("/provider/prefer", name="set provider prefer", response_model=SuccessOut)
async def set_prefer(data: ProviderPreferIn, auth: V1UserAuth = Depends(auth_must)) -> SuccessOut:
    result = ProviderService.set_prefer(data.provider_id, auth.id)
    if not result["success"]:
        raise _not_found()
    return SuccessOut(success=True)


@router.get("/model-providers/{id}", name="get model provider", response_model=ModelProviderOut)
async def get_model_provider(id: int, auth: V1UserAuth = Depends(auth_must)) -> ModelProviderOut:
    model = ProviderService.get(id, auth.id)
    if not model:
        raise _not_found()
    return ModelProviderOut.from_row(model)


@router.put("/model-providers/{id}", name="update model provider", response_model=ModelProviderOut)
async def update_model_provider(
    id: int,
    auth: V1UserAuth = Depends(auth_must),
    data: ModelProviderWrite = Depends(model_provider_write),
) -> ModelProviderOut:
    result = ProviderService.update(id, auth.id, data)
    if not result["success"]:
        raise _not_found()
    return ModelProviderOut.from_row(result["provider"])


@router.delete("/model-providers/{id}", name="delete model provider")
@router.delete("/provider/{id}", name="delete provider")
async def delete(id: int, auth: V1UserAuth = Depends(auth_must)):
    if not ProviderService.delete(id, auth.id):
        raise _not_found()
    return Response(status_code=204)


@router.patch("/model-providers/{id}/invalidate", name="invalidate model provider", response_model=SuccessOut)
@router.patch("/provider/{id}/invalidate", name="invalidate provider", response_model=SuccessOut)
async def invalidate(id: int, auth: V1UserAuth = Depends(auth_must)) -> SuccessOut:
    result = ProviderService.invalidate(id, auth.id)
    if not result["success"]:
        raise _not_found()
    return SuccessOut(success=True)


# --- Retired routes -------------------------------------------------------
# Desktop versions released before keys moved to the device still call these.
# They expect the key in the list and send it on save. Neither happens any
# more: the list is always empty, which those versions show as "no model
# provider is configured", and a save is refused before its body is read.


@router.get("/providers", name="list providers (retired)", response_model=Page[ModelProviderOut])
async def retired_list(
    params: Params = Depends(),
    auth: V1UserAuth = Depends(auth_must),
) -> Page[ModelProviderOut]:
    return Page[ModelProviderOut].create([], params, total=0)


@router.get("/provider", name="get provider detail (retired)", response_model=ModelProviderOut)
async def retired_get(auth: V1UserAuth = Depends(auth_must)):
    raise _not_found()


@router.post("/provider", name="create provider (retired)", response_model=None)
@router.put("/provider/{id}", name="update provider (retired)", response_model=None)
async def retired_write(auth: V1UserAuth = Depends(auth_must)):
    # No body parameter on purpose: the request body is never read or parsed.
    logger.info("Retired model provider write refused")
    raise HTTPException(status_code=410, detail=RETIRED_WRITE_MESSAGE)
