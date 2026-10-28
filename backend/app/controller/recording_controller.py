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

"""Authenticated recording commands; adapter consent has a separate credential."""

from __future__ import annotations

import asyncio
import hmac
import json
import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field

from app.auth import LocalControlPrincipal, require_local_control_principal
from app.auth.local_control import _is_loopback
from app.recording.models import RecordingError
from app.recording.provider import DesktopProvider
from app.recording.runtime import bootstrap_secret, get_recording_service


class RecordingRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            try:
                return await original(request)
            except RecordingError as exc:
                raise HTTPException(
                    exc.status, detail={"code": exc.code, **exc.details}
                ) from None

        return handler


router = APIRouter(route_class=RecordingRoute)
Principal = Annotated[
    LocalControlPrincipal, Depends(require_local_control_principal)
]


def owner(principal):
    return f"{principal.kind}:{principal.user_id}"


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StartBody(Body):
    run_id: str = Field(
        min_length=1, max_length=256, pattern=r"^[a-zA-Z0-9_-]+$"
    )
    grant_id: str = Field(min_length=1, max_length=256)
    idempotency_key: str = Field(min_length=1, max_length=256)


class RegisterBody(Body):
    instance: str = Field(min_length=1, max_length=128)
    spool_root: str = Field(min_length=1, max_length=4096)
    formats: list[Literal["video/mp4"]] = Field(
        default_factory=lambda: ["video/mp4"], max_length=1
    )


class GrantBody(Body):
    run_id: str = Field(
        min_length=1, max_length=256, pattern=r"^[a-zA-Z0-9_-]+$"
    )


class ReportBody(Body):
    sequence: int = Field(ge=0)
    state: Literal[
        "recording",
        "finalizing",
        "completed",
        "interrupted",
        "failed",
        "denied",
    ]
    media: dict | None = None
    reason: (
        Literal[
            "source_ended",
            "grant_revoked",
            "clip_limit",
            "capture_stalled",
            "permission_denied",
            "encoder_unavailable",
            "disk_limit",
            "provider_disconnected",
        ]
        | None
    ) = None


async def bootstrap(request: Request):
    expected = bootstrap_secret()
    supplied = request.headers.get("X-Eigent-Recording-Bootstrap", "")
    if (
        not _is_loopback(getattr(request.client, "host", None))
        or not expected
        or not supplied
        or not hmac.compare_digest(expected, supplied)
    ):
        raise HTTPException(
            401, detail={"code": "recording_adapter_unauthorized"}
        )


async def adapter(request: Request):
    if not _is_loopback(getattr(request.client, "host", None)):
        raise HTTPException(
            403, detail={"code": "recording_adapter_loopback_required"}
        )
    return get_recording_service().authenticate_provider(
        request.headers.get("X-Eigent-Recording-Provider", "")
    )


@router.get("/recordings/capabilities")
async def capabilities(principal: Principal):
    return await asyncio.to_thread(
        get_recording_service().capabilities, owner(principal)
    )


@router.post("/recordings")
async def start(body: StartBody, principal: Principal):
    return await asyncio.to_thread(
        get_recording_service().start,
        body.run_id,
        owner(principal),
        body.grant_id,
        body.idempotency_key,
    )


@router.get("/recordings")
async def listing(
    principal: Principal,
    space_id: str | None = None,
    project_id: str | None = None,
    run_id: str | None = None,
):
    return {
        "recordings": await asyncio.to_thread(
            get_recording_service().listing,
            owner(principal),
            space_id=space_id,
            project_id=project_id,
            run_id=run_id,
        )
    }


@router.get("/recordings/events")
async def events(
    request: Request,
    principal: Principal,
    after: int = Query(default=0, ge=0),
    last_event_id: Annotated[str | None, Header()] = None,
):
    cursor = max(
        after,
        int(last_event_id)
        if last_event_id and last_event_id.isdecimal()
        else 0,
    )

    async def stream():
        nonlocal cursor
        while not await request.is_disconnected():
            rows = await asyncio.to_thread(
                get_recording_service().store.events, owner(principal), cursor
            )
            for row in rows:
                cursor = row["sequence"]
                yield f"id: {cursor}\nevent: recording\ndata: {json.dumps({'schema_version': 1, **row})}\n\n"
            if not rows:
                yield ": heartbeat\n\n"
                await asyncio.sleep(1)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/recordings/{recording_id}")
async def status(recording_id: str, principal: Principal):
    return await asyncio.to_thread(
        get_recording_service().get, recording_id, owner(principal)
    )


@router.post("/recordings/{recording_id}/stop")
async def stop(recording_id: str, principal: Principal):
    return await asyncio.to_thread(
        get_recording_service().stop, recording_id, owner(principal)
    )


@router.post("/recording-adapter/register", dependencies=[Depends(bootstrap)])
async def register(body: RegisterBody):
    return await asyncio.to_thread(
        get_recording_service().register,
        body.instance,
        body.spool_root,
        body.formats,
    )


@router.post("/recording-adapter/grant", dependencies=[Depends(bootstrap)])
async def grant(body: GrantBody):
    # Only main holds the bootstrap. It calls this after a native consent
    # dialog; the renderer's local-control credential cannot issue grants.
    return await asyncio.to_thread(
        get_recording_service().authorize,
        body.run_id,
        "desktop_renderer:local",
    )


@router.post("/recording-adapter/revoke", dependencies=[Depends(bootstrap)])
async def revoke():
    await asyncio.to_thread(get_recording_service().revoke)
    return {"revoked": True}


@router.get("/recording-adapter/commands")
async def commands(
    request: Request, provider: Annotated[DesktopProvider, Depends(adapter)]
):
    service = get_recording_service()
    stream_id = secrets.token_hex(16)
    if provider.stream_id is not None:
        raise HTTPException(409, detail={"code": "provider_stream_exists"})
    provider.stream_id = stream_id

    async def stream():
        try:
            while (
                not await request.is_disconnected()
                and service.provider is provider
            ):
                command = await asyncio.to_thread(service.command, provider)
                yield f"event: command\ndata: {json.dumps(command)}\n\n"
                await asyncio.sleep(1)
        finally:
            if provider.stream_id == stream_id:
                provider.stream_id = None
                if service.provider is provider:
                    await asyncio.to_thread(service.disconnect)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/recording-adapter/{recording_id}/report")
async def report(
    recording_id: str,
    body: ReportBody,
    provider: Annotated[DesktopProvider, Depends(adapter)],
):
    return await asyncio.to_thread(
        get_recording_service().report,
        provider,
        recording_id,
        **body.model_dump(),
    )
