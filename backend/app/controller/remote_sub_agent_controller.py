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

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.remote_sub_agent.constants import DEFAULT_REMOTE_SUB_AGENT_PROVIDER
from app.remote_sub_agent.provider_registry import (
    ProviderBuildOptions,
    validate_remote_sub_agent_provider,
)

logger = logging.getLogger("remote_sub_agent_controller")

router = APIRouter()


class ValidateRemoteSubAgentRequest(BaseModel):
    provider: str = Field(
        DEFAULT_REMOTE_SUB_AGENT_PROVIDER,
        description="Sub-agent provider",
    )
    api_key: str = Field("", description="Provider API key")
    base_url: str = Field("", description="Provider API base URL")
    agent_name: str = Field("", description="Provider agent id")
    timeout_seconds: float = Field(
        45,
        ge=1,
        le=120,
        description="Validation request timeout in seconds",
    )


class ValidateRemoteSubAgentResponse(BaseModel):
    is_valid: bool
    message: str
    provider: str
    agent_name: str | None = None
    interaction_id: str | None = None
    environment_id: str | None = None
    status: str | None = None


@router.post("/remote-sub-agent/validate")
async def validate_remote_sub_agent(
    request: ValidateRemoteSubAgentRequest,
) -> ValidateRemoteSubAgentResponse:
    """Validate a remote sub-agent provider before saving user config."""
    provider = request.provider.strip() or DEFAULT_REMOTE_SUB_AGENT_PROVIDER
    api_key = request.api_key.strip()
    base_url = request.base_url.strip()
    agent_name = request.agent_name.strip()

    if not api_key or not base_url or not agent_name:
        return ValidateRemoteSubAgentResponse(
            is_valid=False,
            message="API Key, API Host, and Agent ID are required.",
            provider=provider,
            agent_name=agent_name or None,
        )

    logger.info(
        "RemoteSubAgent validation started",
        extra={
            "provider": provider,
            "base_url": base_url,
            "agent_name": agent_name,
        },
    )

    try:
        data = await validate_remote_sub_agent_provider(
            {
                "enabled": True,
                "provider": provider,
                provider: {
                    "api_key": api_key,
                    "base_url": base_url,
                    "agent_name": agent_name,
                },
            },
            options=ProviderBuildOptions(
                timeout_seconds=request.timeout_seconds,
            ),
        )
    except Exception as exc:
        logger.warning(
            "RemoteSubAgent validation failed",
            extra={
                "provider": provider,
                "base_url": base_url,
                "agent_name": agent_name,
                "error": str(exc),
            },
        )
        return ValidateRemoteSubAgentResponse(
            is_valid=False,
            message=str(exc),
            provider=provider,
            agent_name=agent_name,
        )

    interaction_id = data.get("id")
    is_valid = isinstance(interaction_id, str) and bool(interaction_id)
    message = (
        "Remote sub agent validation successful."
        if is_valid
        else "Remote sub agent validation failed: missing interaction id."
    )
    logger.info(
        "RemoteSubAgent validation completed",
        extra={
            "provider": provider,
            "base_url": base_url,
            "agent_name": agent_name,
            "is_valid": is_valid,
            "interaction_id": interaction_id,
            "status": data.get("status"),
        },
    )
    environment_id = data.get("environment_id")
    status = data.get("status")

    return ValidateRemoteSubAgentResponse(
        is_valid=is_valid,
        message=message,
        provider=provider,
        agent_name=agent_name,
        interaction_id=interaction_id
        if isinstance(interaction_id, str)
        else None,
        environment_id=environment_id
        if isinstance(environment_id, str)
        else None,
        status=status if isinstance(status, str) else None,
    )
