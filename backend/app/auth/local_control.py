"""Authentication boundary for Desktop-local Run and Command control APIs."""

from __future__ import annotations

import hmac
import ipaddress
import os
from dataclasses import dataclass

from fastapi import HTTPException, Request

from app.auth.brain_auth import (
    get_brain_auth_context,
    get_brain_auth_provider,
)
from app.auth.interface import NoneAuth

LOCAL_CONTROL_CAPABILITY_ENV = "EIGENT_LOCAL_CONTROL_CAPABILITY"
LOCAL_CONTROL_CAPABILITY_HEADER = "X-Eigent-Local-Capability"
_CAPABILITY_UNSET = object()
_process_local_control_capability: str | object = _CAPABILITY_UNSET


def capture_local_control_capability() -> None:
    """Move the one-process renderer capability out of the OS environment."""

    global _process_local_control_capability
    if _process_local_control_capability is not _CAPABILITY_UNSET:
        return
    candidate = os.environ.pop(LOCAL_CONTROL_CAPABILITY_ENV, "")
    if candidate or os.environ.get("EIGENT_RUNTIME", "").lower() == "electron":
        _process_local_control_capability = candidate


def _expected_local_control_capability() -> str:
    capture_local_control_capability()
    if _process_local_control_capability is _CAPABILITY_UNSET:
        return ""
    return str(_process_local_control_capability or "")


@dataclass(frozen=True)
class LocalControlPrincipal:
    kind: str
    user_id: str


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


async def require_local_control_principal(
    request: Request,
) -> LocalControlPrincipal:
    """Authorize the renderer capability or an authenticated remote Brain user.

    Electron injects a random capability into the child Brain process and gives
    it to the trusted renderer through IPC. It is deliberately separate from
    Cloud device credentials, user bearer tokens, and Remote Control link tokens.
    """

    expected = _expected_local_control_capability()
    if expected:
        if not _is_loopback(getattr(request.client, "host", None)):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "local_control_loopback_required",
                    "message": "Desktop control APIs only accept loopback clients.",
                },
            )
        presented = request.headers.get(LOCAL_CONTROL_CAPABILITY_HEADER, "")
        if not presented or not hmac.compare_digest(presented, expected):
            raise HTTPException(
                status_code=401,
                detail={
                    "code": "local_control_capability_required",
                    "message": "A valid Desktop control capability is required.",
                },
            )
        principal = LocalControlPrincipal(
            kind="desktop_renderer", user_id="local"
        )
        request.state.local_control_principal = principal
        return principal

    if os.environ.get("EIGENT_RUNTIME", "").lower() == "electron":
        raise HTTPException(
            status_code=503,
            detail={
                "code": "local_control_capability_unconfigured",
                "message": "Desktop control capability is not configured.",
            },
        )

    # Non-Electron deployments must configure a real Brain auth provider.
    # Header presence alone is not authentication while NoneAuth is active.
    if isinstance(get_brain_auth_provider(), NoneAuth):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "local_control_auth_unconfigured",
                "message": "Control API authentication is not configured.",
            },
        )
    brain_auth = await get_brain_auth_context(request)
    if not brain_auth.authorization_present:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "brain_auth_required_for_control",
                "message": "Brain authentication is required for control APIs.",
            },
        )
    principal = LocalControlPrincipal(
        kind="brain_user", user_id=brain_auth.user_id
    )
    request.state.local_control_principal = principal
    return principal
