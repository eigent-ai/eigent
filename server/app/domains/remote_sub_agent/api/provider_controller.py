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

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi_babel import _

from app.domains.remote_sub_agent.service.provider_service import (
    RemoteSubAgentProviderService,
)
from app.model.remote_sub_agent.provider import (
    RemoteSubAgentProviderIn,
    RemoteSubAgentProviderOut,
)
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth

router = APIRouter(tags=["Remote Sub Agent Provider Management"])


@router.get(
    "/remote-sub-agent-providers",
    name="list remote sub agent providers",
    response_model=list[RemoteSubAgentProviderOut],
)
async def list_remote_sub_agent_providers(
    provider_name: str | None = None,
    enabled: Optional[bool] = Query(None),
    auth: V1UserAuth = Depends(auth_must),
) -> list[RemoteSubAgentProviderOut]:
    return RemoteSubAgentProviderService.list_for_user(
        auth.id,
        provider_name=provider_name,
        enabled=enabled,
    )


@router.get(
    "/remote-sub-agent-providers/{provider_id}",
    name="get remote sub agent provider detail",
    response_model=RemoteSubAgentProviderOut,
)
async def get_remote_sub_agent_provider(
    provider_id: int,
    auth: V1UserAuth = Depends(auth_must),
):
    model = RemoteSubAgentProviderService.get(provider_id, auth.id)
    if not model:
        raise HTTPException(
            status_code=404,
            detail=_("Remote sub agent provider not found"),
        )
    return model


@router.post(
    "/remote-sub-agent-providers",
    name="create remote sub agent provider",
    response_model=RemoteSubAgentProviderOut,
)
async def create_remote_sub_agent_provider(
    data: RemoteSubAgentProviderIn,
    auth: V1UserAuth = Depends(auth_must),
):
    result = RemoteSubAgentProviderService.create(
        auth.id,
        data.model_dump(),
    )
    return result["provider"]


@router.put(
    "/remote-sub-agent-providers/{provider_id}",
    name="update remote sub agent provider",
    response_model=RemoteSubAgentProviderOut,
)
async def update_remote_sub_agent_provider(
    provider_id: int,
    data: RemoteSubAgentProviderIn,
    auth: V1UserAuth = Depends(auth_must),
):
    result = RemoteSubAgentProviderService.update(
        provider_id,
        auth.id,
        data.model_dump(),
    )
    if not result["success"]:
        raise HTTPException(
            status_code=404,
            detail=_("Remote sub agent provider not found"),
        )
    return result["provider"]


@router.delete(
    "/remote-sub-agent-providers/{provider_id}",
    name="delete remote sub agent provider",
)
async def delete_remote_sub_agent_provider(
    provider_id: int,
    auth: V1UserAuth = Depends(auth_must),
):
    if not RemoteSubAgentProviderService.delete(provider_id, auth.id):
        raise HTTPException(
            status_code=404,
            detail=_("Remote sub agent provider not found"),
        )
    return Response(status_code=204)
