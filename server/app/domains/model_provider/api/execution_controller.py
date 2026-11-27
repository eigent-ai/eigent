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

"""Device/account-authenticated configuration and exact provider confirmation."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session
from starlette.concurrency import run_in_threadpool

from app.core.database import session
from app.domains.model_provider.service.execution_configuration import ExecutionConfigurationSource
from app.domains.remote_control.api.command_control_controller import DevicePrincipal, device_principal_must
from app.model.provider.metadata import ModelParameters, Number, PlainSettings

router = APIRouter(prefix="/sync/execution", tags=["Managed Execution Configuration"])
Principal = Annotated[DevicePrincipal, Depends(device_principal_must)]
Database = Annotated[Session, Depends(session)]


class ExactProviderReference(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    provider_ref: str = Field(pattern=r"^provider:[1-9][0-9]{0,18}:[0-9a-f]{32}$")
    space_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    session_mode: Literal["single-agent", "workforce"]


class ExecutionIdentity(BaseModel):
    account_owner_id: str
    desktop_instance_id: str
    device_credential_version: int


class ExecutionConstructorParameters(PlainSettings):
    api_mode: str | None = None
    timeout: Number | None = None
    max_retries: int | None = None


class ExecutionProvider(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    provider_ref: str
    model_platform: str
    model_type: str
    api_url: str
    model_config_dict: ModelParameters
    extra_params: ExecutionConstructorParameters


class ExecutionConfiguration(ExecutionIdentity):
    """Everything a run needs from the account except the provider's key.

    The response model is also a filter: a field that is not listed here cannot
    leave through these routes.
    """

    project_id: str
    space_id: str
    space_source_type: str | None
    session_mode: str
    space_root: str
    thinking_effort: str | None
    provider: ExecutionProvider


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.get("/identity", response_model=ExecutionIdentity)
def identity(principal: Principal, db: Database, response: Response):
    private_response(response)
    return ExecutionConfigurationSource.identity(db, principal)


@router.get("/projects/{project_id}/configuration", response_model=ExecutionConfiguration)
def configuration(project_id: str, principal: Principal, db: Database, response: Response):
    private_response(response)
    return ExecutionConfigurationSource.read(db, principal, project_id)


@router.post("/projects/{project_id}/credentials:resolve", response_model=ExecutionConfiguration)
async def resolve(project_id: str, principal: Principal, db: Database, request: Request, response: Response):
    """Confirm that an exact pinned provider revision is still valid for this device.

    The path is historical. The answer holds no credential: the provider's key
    stays on the device and is never stored on or returned by this server.
    """
    private_response(response)
    try:
        raw = b""
        async for chunk in request.stream():
            raw += chunk
            if len(raw) > 2048:
                raise ValueError("oversized reference")
        exact = ExactProviderReference.model_validate_json(raw)
    except ValueError:
        # FastAPI's default validation payload may echo arbitrary input,
        # including an accidentally supplied key. This endpoint never does.
        raise HTTPException(status_code=422, detail={"code": "invalid_execution_reference"}) from None
    return await run_in_threadpool(ExecutionConfigurationSource.read, db, principal, project_id, exact=exact)
