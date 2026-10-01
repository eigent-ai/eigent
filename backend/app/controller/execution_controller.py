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

"""Authenticated reference-only admission for explicitly enabled execution.

The legacy Chat payload contains transient credentials and paths and is never
converted into a durable request here. A service must resolve and authorize
the immutable references before it can prepare or launch a runtime.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field

from app.auth import LocalControlPrincipal, require_local_control_principal
from app.workspace_runtime.admission import (
    AdmissionError,
    ExecutionRequest,
    InvalidExecutionEnvelope,
    validate_envelope,
)
from app.workspace_runtime.runtime import (
    get_default_execution_service,
    get_default_registration_service,
)
from app.workspace_runtime.service import (
    ExecutionForbidden,
    ExecutionOrigin,
    ExecutionUnavailable,
)
from app.workspace_runtime.store import WorkspaceStateError


class ExecutionRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def sanitized(request):
            try:
                return await original(request)
            except RequestValidationError:
                return JSONResponse(
                    status_code=422,
                    content={"detail": {"code": "invalid_execution_request"}},
                )

        return sanitized


router = APIRouter(route_class=ExecutionRoute)
Principal = Annotated[
    LocalControlPrincipal, Depends(require_local_control_principal)
]


class ExecutionSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=1, max_length=512)
    kind: Literal["start", "follow_up", "resume"]
    envelope: dict[str, Any]
    target_run_id: str | None = Field(
        default=None, min_length=1, max_length=512
    )
    source_follow_up_request_id: str | None = Field(
        default=None, min_length=1, max_length=512
    )
    follow_up_content: str | None = Field(default=None, max_length=200_000)
    delivery_mode: Literal["wait", "send_now"] = "wait"


class ExecutionDelivery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    delivery_mode: Literal["wait", "send_now"]
    operation_id: str | None = Field(
        default=None, min_length=1, max_length=512
    )


async def _origin(principal: LocalControlPrincipal) -> ExecutionOrigin:
    # The authenticated control principal is authoritative. Neither a caller's
    # user_id nor an opaque envelope reference can establish identity or Hands.
    registration = get_default_registration_service()
    if registration is not None:
        return await registration.source.authenticated_origin(principal)
    return ExecutionOrigin(
        principal_ref=f"{principal.kind}:{principal.user_id}",
        source="local",
    )


def _service():
    service = get_default_execution_service()
    if service is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "execution_service_unavailable",
                "message": "Managed execution is not enabled.",
            },
        )
    return service


def _response(record: ExecutionRequest) -> dict[str, Any]:
    # Configuration, credential/authorization references and private paths do
    # not belong in a queue-status response, including responses to retries.
    return {
        name: getattr(record, name)
        for name in (
            "request_id",
            "project_id",
            "kind",
            "source",
            "delivery_mode",
            "status",
            "wait_reason",
            "admitted_run_id",
            "admitted_attempt_id",
            "created_at",
            "updated_at",
        )
    }


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail="Artifact not found.")
    if isinstance(exc, ExecutionUnavailable):
        return HTTPException(
            status_code=503,
            detail={"code": "execution_service_unavailable"},
        )
    if isinstance(exc, ExecutionForbidden):
        return HTTPException(
            status_code=403,
            detail={"code": "execution_request_forbidden"},
        )
    if isinstance(exc, (InvalidExecutionEnvelope, ValueError)):
        return HTTPException(
            status_code=422,
            detail={
                "code": "invalid_execution_request",
                "message": "The execution request is invalid.",
            },
        )
    if isinstance(exc, (AdmissionError, WorkspaceStateError)):
        return HTTPException(
            status_code=409,
            detail={
                "code": "execution_request_conflict",
                "message": "The execution request cannot be admitted.",
            },
        )
    raise exc


@router.get("/executions/capabilities")
async def execution_capabilities(principal: Principal):
    del principal
    service = get_default_execution_service()
    if service is None:
        return {
            "execution_admission": False,
            "supports_legacy_chat": False,
            "controlled_worker": False,
            "parallel_sessions": False,
            "supports_single_agent": False,
            "supports_workforce": False,
            "resume_transfer": False,
            "capacity": 0,
        }
    return service.capabilities()


@router.post(
    "/projects/{project_id}/execution-configurations", status_code=201
)
async def register_execution_configuration(
    project_id: str,
    principal: Principal,
    request: Request,
    claim_session: bool = False,
):
    registration = get_default_registration_service()
    if registration is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "execution_configuration_registration_unavailable"
            },
        )
    try:
        raw = await request.body()
        if raw not in (b"", b"{}"):
            # The owned Project/Space/provider records supply the config. This
            # route accepts no account, key, path, permission or model payload.
            raise ValueError("registration accepts references only")
        return await registration.register(
            project_id, await _origin(principal), claim_session=claim_session
        )
    except (AdmissionError, ValueError) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/execution-route")
async def session_execution_route(project_id: str, principal: Principal):
    from app.run_journal.runtime import get_default_run_journal
    from app.workspace_runtime.entry_guard import owns_managed_execution

    registration = get_default_registration_service()
    journal = (
        registration.journal if registration else get_default_run_journal()
    )
    owned = owns_managed_execution(journal, project_id=project_id)
    # When deployment is disabled, legacy needs no configuration registration.
    # Expose no stored managed facts without its authenticated account authority.
    if registration is None or not registration.local_single_session_enabled:
        if owned and registration is None:
            raise HTTPException(
                status_code=503,
                detail={"code": "execution_service_unavailable"},
            )
        if owned:
            try:
                await registration.authorize_project_control(
                    project_id, await _origin(principal)
                )
            except (AdmissionError, ValueError) as exc:
                raise _error(exc) from None
        from app.workspace_runtime.routing import queue_window

        with journal._lock:
            window = queue_window(journal._connection, project_id)
        return {
            **window,
            "project_id": project_id,
            "route": "managed" if owned else "legacy",
            "entry_enabled": False,
            "eligible": False,
            "reason": "session_entry_disabled",
            "profile": None,
            "configuration": None,
        }
    try:
        return await registration.session_projection(
            project_id, await _origin(principal)
        )
    except (AdmissionError, ValueError) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/executions")
async def list_session_executions(
    project_id: str,
    principal: Principal,
    after: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
):
    try:
        return await _service().list_requests(
            project_id,
            origin=await _origin(principal),
            after=after,
            limit=limit,
        )
    except (AdmissionError, ValueError) as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/executions", status_code=202)
async def submit_execution(
    project_id: str, body: ExecutionSubmission, principal: Principal
):
    service = _service()
    try:
        envelope = validate_envelope(
            body.envelope, project_id=project_id, kind=body.kind
        )
        record = await service.submit(
            request_id=body.request_id,
            project_id=project_id,
            kind=body.kind,
            envelope=envelope,
            origin=await _origin(principal),
            target_run_id=body.target_run_id,
            source_follow_up_request_id=body.source_follow_up_request_id,
            follow_up_content=body.follow_up_content,
            delivery_mode=body.delivery_mode,
        )
    except (AdmissionError, ValueError) as exc:
        raise _error(exc) from exc
    return _response(record)


@router.get("/executions/{request_id}")
async def get_execution(request_id: str, principal: Principal):
    try:
        record = await _service().get(
            request_id, origin=await _origin(principal)
        )
    except (AdmissionError, ValueError) as exc:
        raise _error(exc) from exc
    if record is None:
        raise HTTPException(
            status_code=404, detail="Execution request not found."
        )
    return _response(record)


@router.delete("/executions/{request_id}")
async def cancel_execution(request_id: str, principal: Principal):
    try:
        record = await _service().cancel(
            request_id, origin=await _origin(principal)
        )
    except (AdmissionError, ValueError) as exc:
        raise _error(exc) from exc
    return _response(record)


@router.post("/executions/{request_id}/delivery")
async def set_execution_delivery(
    request_id: str, body: ExecutionDelivery, principal: Principal
):
    try:
        record = await _service().set_delivery(
            request_id,
            origin=await _origin(principal),
            delivery_mode=body.delivery_mode,
            operation_id=body.operation_id,
        )
    except (AdmissionError, ValueError) as exc:
        raise _error(exc) from exc
    return _response(record)


@router.get("/executions/{request_id}/artifacts")
async def execution_artifacts(request_id: str, principal: Principal):
    try:
        manifest = await _service().artifacts(
            request_id, origin=await _origin(principal)
        )
    except (
        AdmissionError,
        WorkspaceStateError,
        ValueError,
        FileNotFoundError,
    ) as exc:
        raise _error(exc) from exc
    if manifest is None:
        raise HTTPException(
            status_code=404, detail="Artifact manifest not found."
        )
    result = {
        key: manifest[key]
        for key in (
            "schema",
            "run_id",
            "project_id",
            "attempt_id",
            "generation",
            "checkpoint_revision",
            "manifest_digest",
            "provider",
            "scan_status",
            "truncated",
        )
        if key in manifest
    }
    result["artifacts"] = [
        {
            key: artifact[key]
            for key in (
                "artifact_id",
                "filename",
                "relativePath",
                "size",
                "content_digest",
                "checkpoint_revision",
                "storage",
                "uploadPolicy",
            )
            if key in artifact
        }
        for artifact in manifest.get("artifacts", ())
    ]
    result["artifact_count"] = len(result["artifacts"])
    return result


@router.get("/executions/{request_id}/artifacts/{artifact_id}/content")
async def execution_artifact_content(
    request_id: str,
    artifact_id: str,
    principal: Principal,
    offset: Annotated[int, Query(ge=0)] = 0,
    length: Annotated[int, Query(ge=1, le=8 * 1024 * 1024)] = 1024 * 1024,
):
    try:
        content = await _service().read_artifact(
            request_id,
            artifact_id,
            origin=await _origin(principal),
            offset=offset,
            length=length,
        )
    except (
        AdmissionError,
        WorkspaceStateError,
        ValueError,
        FileNotFoundError,
    ) as exc:
        raise _error(exc) from exc
    if content is None:
        raise HTTPException(status_code=404, detail="Artifact not found.")
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": 'attachment; filename="artifact.bin"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )
