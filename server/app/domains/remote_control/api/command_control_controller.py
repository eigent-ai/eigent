from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlmodel import Session

from app.core.database import session
from app.domains.remote_control.schema import (
    CommandEventsIn,
    CommandEventsOut,
    ConfirmCommandReceiptIn,
    ConfirmCommandReceiptOut,
    DeviceRegistrationIn,
    DeviceRegistrationOut,
    PendingCommandsOut,
    ProjectRouteClaimIn,
    ProjectRouteOut,
)
from app.domains.remote_control.service.command_control_service import (
    CommandControlService,
)
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth

router = APIRouter(prefix="/sync", tags=["Remote Command Control"])


class DevicePrincipal:
    __slots__ = ("desktop_instance_id", "user_id")

    def __init__(self, user_id: int, desktop_instance_id: str) -> None:
        self.user_id = user_id
        self.desktop_instance_id = desktop_instance_id


async def device_principal_must(
    auth: Annotated[V1UserAuth, Depends(auth_must)],
    desktop_instance_id: Annotated[str | None, Header(alias="X-Desktop-Instance-ID")] = None,
) -> DevicePrincipal:
    value = (desktop_instance_id or "").strip()
    if not value or len(value) > 128:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail={"code": "desktop_instance_id_required"},
        )
    return DevicePrincipal(user_id=auth.id, desktop_instance_id=value)


@router.post("/devices/register", response_model=DeviceRegistrationOut)
def register_device(
    body: DeviceRegistrationIn,
    principal: Annotated[DevicePrincipal, Depends(device_principal_must)],
    db: Annotated[Session, Depends(session)],
) -> DeviceRegistrationOut:
    result = CommandControlService.register_device(
        principal.desktop_instance_id,
        principal.user_id,
        body,
        db,
    )
    db.commit()
    return result


@router.put(
    "/projects/{project_id}/execution-route",
    response_model=ProjectRouteOut,
)
def claim_project_execution_route(
    project_id: str,
    body: ProjectRouteClaimIn,
    principal: Annotated[DevicePrincipal, Depends(device_principal_must)],
    db: Annotated[Session, Depends(session)],
) -> ProjectRouteOut:
    result = CommandControlService.claim_project_route(
        project_id,
        principal.desktop_instance_id,
        principal.user_id,
        body.expected_route_version,
        db,
    )
    db.commit()
    return result


@router.get("/commands/pending", response_model=PendingCommandsOut)
def pending_commands(
    principal: Annotated[DevicePrincipal, Depends(device_principal_must)],
    db: Annotated[Session, Depends(session)],
    limit: int = Query(default=50, ge=1, le=200),
) -> PendingCommandsOut:
    result = CommandControlService.claim_pending_commands(
        principal.desktop_instance_id,
        principal.user_id,
        limit,
        db,
    )
    db.commit()
    return result


@router.post(
    "/commands/{command_id}/confirm-receipt",
    response_model=ConfirmCommandReceiptOut,
)
def confirm_command_receipt(
    command_id: str,
    body: ConfirmCommandReceiptIn,
    principal: Annotated[DevicePrincipal, Depends(device_principal_must)],
    db: Annotated[Session, Depends(session)],
) -> ConfirmCommandReceiptOut:
    result = CommandControlService.confirm_receipt(
        command_id,
        principal.desktop_instance_id,
        principal.user_id,
        body,
        db,
    )
    db.commit()
    return result


@router.post("/commands/{command_id}/events", response_model=CommandEventsOut)
def ingest_command_events(
    command_id: str,
    body: CommandEventsIn,
    principal: Annotated[DevicePrincipal, Depends(device_principal_must)],
    db: Annotated[Session, Depends(session)],
) -> CommandEventsOut:
    result = CommandControlService.ingest_command_events(
        command_id,
        principal.desktop_instance_id,
        principal.user_id,
        body,
        db,
    )
    db.commit()
    return result
