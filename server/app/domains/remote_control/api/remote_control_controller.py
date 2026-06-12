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

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import os
import secrets
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any

import redis
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from loguru import logger
from sqlmodel import Session, select

from app.core.database import session, session_make
from app.core.environment import env
from app.core.redis_utils import get_redis_manager
from app.domains.remote_control.schema import (
    RemoteControlCommandIn,
    RemoteControlCommandOut,
    RemoteControlCreateProjectIn,
    RemoteControlCreateSessionIn,
    RemoteControlCreateSessionOut,
    RemoteControlExtendIn,
    RemoteControlExtendOut,
    RemoteControlFolderApplyIn,
    RemoteControlFolderDiscardIn,
    RemoteControlFolderOperationOut,
    RemoteControlFolderRefreshIn,
    RemoteControlPatchTargetIn,
    RemoteControlPatchTargetOut,
    RemoteControlProjectListOut,
    RemoteControlSessionOut,
    RemoteControlStepsOut,
)
from app.model.project.project import ProjectOut
from app.model.space.apply import SpaceOverlayListResponse
from app.domains.remote_control.service.remote_control_service import (
    COMMAND_ACKNOWLEDGED,
    COMMAND_FAILED,
    COMMAND_PENDING,
    RemoteControlRedis,
    RemoteControlService,
)
from app.model.remote_control import RemoteControlCommand, RemoteControlSession
from app.model.user.user import User
from app.shared.auth import auth_must
from app.shared.auth.token_blacklist import BLACKLIST_PUBSUB_PREFIX, is_blacklisted
from app.shared.auth.user_auth import V1UserAuth, _get_jti
from app.shared.middleware.rate_limit import rate_limiter_factory
from app.shared.middleware.origins import (
    configured_remote_origins,
    csv_values,
    is_local_dev_origin,
    truthy,
)

router = APIRouter(prefix="/remote-control", tags=["Remote Control"])


def _env_int(name: str, default: int, *, min_value: int = 1) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or raw_value == "":
        return default
    try:
        return max(min_value, int(raw_value))
    except ValueError:
        logger.warning(
            "Invalid integer environment value; using default",
            extra={"name": name, "value": raw_value, "default": default},
        )
        return default


bridge_websockets: dict[str, WebSocket] = {}
bridge_users: dict[str, int] = {}
bridge_token_jtis: dict[str, str] = {}
remote_websockets: dict[str, set[WebSocket]] = {}
remote_projects: dict[int, str] = {}

_pubsub_task: asyncio.Task | None = None
_scanner_task: asyncio.Task | None = None
_last_bridge_ttl_scan_at: datetime | None = None
WS_SUBSCRIBE_TIMEOUT_SECONDS = 5
PUBSUB_RECONNECT_BASE_SECONDS = 1
PUBSUB_RECONNECT_MAX_SECONDS = 30
BRIDGE_BLACKLIST_CHECK_INTERVAL_SECONDS = _env_int(
    "REMOTE_CONTROL_BRIDGE_BLACKLIST_CHECK_INTERVAL_SECONDS",
    60,
    min_value=10,
)
WS_RECONNECT_RATE_LIMIT = _env_int("REMOTE_CONTROL_WS_RECONNECT_LIMIT", 30)
WS_RECONNECT_RATE_WINDOW_SECONDS = _env_int("REMOTE_CONTROL_WS_RECONNECT_WINDOW_SECONDS", 60)
SESSION_CREATE_RATE_LIMIT = _env_int("REMOTE_CONTROL_SESSION_CREATE_LIMIT", 120)
SESSION_CREATE_RATE_WINDOW_SECONDS = _env_int("REMOTE_CONTROL_SESSION_CREATE_WINDOW_SECONDS", 3600)
COMMAND_BURST_RATE_LIMIT = _env_int("REMOTE_CONTROL_COMMAND_BURST_LIMIT", 10)
COMMAND_BURST_RATE_WINDOW_SECONDS = _env_int("REMOTE_CONTROL_COMMAND_BURST_WINDOW_SECONDS", 1)
COMMAND_MINUTE_RATE_LIMIT = _env_int("REMOTE_CONTROL_COMMAND_MINUTE_LIMIT", 120)
COMMAND_MINUTE_RATE_WINDOW_SECONDS = _env_int("REMOTE_CONTROL_COMMAND_MINUTE_WINDOW_SECONDS", 60)
STEPS_RATE_LIMIT = _env_int("REMOTE_CONTROL_STEPS_LIMIT", 120)
STEPS_RATE_WINDOW_SECONDS = _env_int("REMOTE_CONTROL_STEPS_WINDOW_SECONDS", 60)
AUDIT_HASH_HEX_PREFIX_LEN = 16
DEFAULT_TRUSTED_PROXY_HOSTS = ("127.0.0.1", "::1", "localhost")
RATE_LIMIT_HIT_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
"""


def _is_debug_mode() -> bool:
    return str(env("debug", "")).lower() == "on"


def _allow_unsafe_origins() -> bool:
    return truthy(os.getenv("REMOTE_CONTROL_ALLOW_UNSAFE_ORIGINS"))


def _strip_bearer(token: str | None) -> str | None:
    if not token:
        return None
    if token.lower().startswith("bearer "):
        return token[7:].strip()
    return token


def _reject_query_token_in_prod() -> bool:
    value = str(os.getenv("REMOTE_CONTROL_REJECT_QUERY_TOKEN", "")).lower()
    return value in {"1", "true", "yes", "on"}


def _remote_link_token(query_token: str | None, header_token: str | None) -> str | None:
    if header_token:
        return header_token
    if query_token and _reject_query_token_in_prod():
        raise HTTPException(
            status_code=400,
            detail="Remote control link token must be sent via the X-Remote-Control-Token header",
        )
    return query_token


@lru_cache(maxsize=1)
def _trusted_proxy_entries() -> tuple[Any, ...]:
    explicit = csv_values(os.getenv("REMOTE_CONTROL_TRUSTED_PROXY_HOSTS"))
    values = explicit or list(DEFAULT_TRUSTED_PROXY_HOSTS)
    entries: list[Any] = []
    for value in values:
        try:
            entries.append(ipaddress.ip_network(value, strict=False))
        except ValueError:
            entries.append(value)
    return tuple(entries)


def _matches_trusted_proxy(host: str | None, trusted: Any) -> bool:
    if not host:
        return False
    if isinstance(trusted, str):
        return host == trusted
    try:
        return ipaddress.ip_address(host) in trusted
    except ValueError:
        return False


def _is_trusted_proxy_host(host: str | None) -> bool:
    return any(_matches_trusted_proxy(host, trusted) for trusted in _trusted_proxy_entries())


def _trusted_proxy_hosts() -> list[str]:
    hosts: list[str] = []
    for entry in _trusted_proxy_entries():
        if isinstance(entry, str):
            hosts.append(entry)
        else:
            hosts.append(str(entry))
    return hosts


def _first_forwarded_for(value: str | None) -> str | None:
    if not value:
        return None
    return next((part.strip() for part in value.split(",") if part.strip()), None)


def _client_host_from_headers(headers: Any, peer_host: str | None) -> str:
    if _is_trusted_proxy_host(peer_host):
        forwarded_host = _first_forwarded_for(headers.get("x-forwarded-for"))
        if forwarded_host:
            return forwarded_host
        real_ip = (headers.get("x-real-ip") or "").strip()
        if real_ip:
            return real_ip
    return peer_host or "unknown"


def _request_client_host(request: Request) -> str:
    peer_host = request.client.host if request.client else None
    return _client_host_from_headers(request.headers, peer_host)


def _websocket_client_host(websocket: WebSocket) -> str:
    peer_host = websocket.client.host if websocket.client else None
    return _client_host_from_headers(websocket.headers, peer_host)


async def _remote_control_user_rate_key(request: Request) -> str:
    raw = _strip_bearer(request.headers.get("authorization"))
    if raw:
        try:
            auth = V1UserAuth.decode_token(raw)
            return f"remote-control:user:{auth.id}"
        except Exception:
            pass
    return f"remote-control:ip:{_request_client_host(request)}"


async def _remote_control_session_rate_key(request: Request) -> str:
    try:
        session_id = request.path_params.get("session_id") or "unknown"
        return f"remote-control:session:{session_id}"
    except Exception:
        return f"remote-control:ip:{_request_client_host(request)}"


async def _enforce_ws_reconnect_rate_limit(scope: str, identifier: str | None) -> None:
    if not identifier:
        identifier = "unknown"
    digest = hashlib.sha256(identifier.encode("utf-8")).hexdigest()
    key = f"rc:rate:{scope}:{digest}:reconnect"

    def _hit() -> int:
        client = get_redis_manager().client
        return int(client.eval(RATE_LIMIT_HIT_LUA, 1, key, WS_RECONNECT_RATE_WINDOW_SECONDS))

    try:
        count = await asyncio.get_running_loop().run_in_executor(None, _hit)
    except Exception as exc:
        logger.warning(
            "Remote-control websocket rate limiter failed open",
            extra={"scope": scope, "error": str(exc)},
            exc_info=True,
        )
        return

    if count > WS_RECONNECT_RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Remote control websocket reconnect rate limit exceeded",
        )


remote_session_create_rate_limiter = rate_limiter_factory(
    times=SESSION_CREATE_RATE_LIMIT,
    seconds=SESSION_CREATE_RATE_WINDOW_SECONDS,
    identifier=_remote_control_user_rate_key,
)
remote_command_burst_rate_limiter = rate_limiter_factory(
    times=COMMAND_BURST_RATE_LIMIT,
    seconds=COMMAND_BURST_RATE_WINDOW_SECONDS,
    identifier=_remote_control_session_rate_key,
)
remote_command_minute_rate_limiter = rate_limiter_factory(
    times=COMMAND_MINUTE_RATE_LIMIT,
    seconds=COMMAND_MINUTE_RATE_WINDOW_SECONDS,
    identifier=_remote_control_session_rate_key,
)
remote_steps_rate_limiter = rate_limiter_factory(
    times=STEPS_RATE_LIMIT,
    seconds=STEPS_RATE_WINDOW_SECONDS,
    identifier=_remote_control_session_rate_key,
)


def _bridge_allowed_origins() -> set[str]:
    explicit = set(csv_values(os.getenv("REMOTE_CONTROL_BRIDGE_ALLOWED_ORIGINS")))
    return explicit or set(configured_remote_origins())


def _events_allowed_origins() -> set[str]:
    explicit = set(csv_values(os.getenv("REMOTE_CONTROL_EVENTS_ALLOWED_ORIGINS")))
    if explicit:
        return explicit
    # Fall back to the CORS allowlist so the events WS shares the HTTP policy.
    return set(csv_values(os.getenv("CORS_ALLOW_ORIGINS"))) | set(configured_remote_origins())


def _check_ws_origin(websocket: WebSocket, allowed: set[str], *, allow_missing: bool) -> bool:
    """
    Return True iff the WebSocket Origin header is acceptable.

    - Empty allowlist only permits local development origins by default.
    - "*" in allowlist, or REMOTE_CONTROL_ALLOW_UNSAFE_ORIGINS=true, is an
      explicit permissive mode for development and test deployments.
    - allow_missing controls whether non-browser clients (no Origin) may connect.
    """
    if _allow_unsafe_origins() or "*" in allowed:
        return True
    if _is_debug_mode() and not allowed:
        return True
    origin = websocket.headers.get("origin")
    if not origin:
        return allow_missing
    if allowed:
        return origin in allowed
    return is_local_dev_origin(origin)


def _bridge_blacklist_check_interval_seconds() -> int:
    return BRIDGE_BLACKLIST_CHECK_INTERVAL_SECONDS


def _sha256_prefix(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:AUDIT_HASH_HEX_PREFIX_LEN]


def _remote_audit_payload(websocket: WebSocket) -> dict[str, str | None]:
    client_host = _websocket_client_host(websocket)
    user_agent = websocket.headers.get("user-agent")
    return {
        "remote_ip_hash": _sha256_prefix(client_host),
        "user_agent_hash": _sha256_prefix(user_agent),
    }


def _remember_bridge_token_jti(desktop_instance_id: str, token_jti: str | None) -> None:
    if token_jti:
        bridge_token_jtis[desktop_instance_id] = token_jti
    else:
        bridge_token_jtis.pop(desktop_instance_id, None)


async def _auth_token_with_jti(
    token: str | None,
    db: Session,
    *,
    token_is_stripped: bool = False,
) -> tuple[V1UserAuth, str | None]:
    raw = token if token_is_stripped else _strip_bearer(token)
    if not raw:
        raise HTTPException(status_code=401, detail="Authentication required")
    auth = V1UserAuth.decode_token(raw)
    jti = _get_jti(raw)
    if jti and await is_blacklisted(jti):
        raise HTTPException(status_code=401, detail="Token has been revoked")
    user = db.get(User, auth.id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    auth._user = user
    return auth, jti


async def _auth_token(token: str | None, db: Session) -> V1UserAuth:
    auth, _jti = await _auth_token_with_jti(token, db)
    return auth


def _pending_bridge_commands(
    desktop_instance_id: str,
    user_id: int,
    db: Session,
    *,
    limit: int = 50,
) -> list[tuple[RemoteControlSession, RemoteControlCommand]]:
    sessions = db.exec(
        select(RemoteControlSession).where(
            RemoteControlSession.user_id == user_id,
            RemoteControlSession.desktop_instance_id == desktop_instance_id,
            RemoteControlSession.status == "active",
        )
    ).all()
    if not sessions:
        return []

    sessions_by_id = {rc_session.id: rc_session for rc_session in sessions}
    commands = db.exec(
        select(RemoteControlCommand)
        .where(
            RemoteControlCommand.session_id.in_(sessions_by_id.keys()),
            RemoteControlCommand.status == COMMAND_PENDING,
        )
        .order_by(RemoteControlCommand.created_at)
        .limit(limit)
    ).all()
    return [
        (sessions_by_id[command.session_id], command)
        for command in commands
        if command.session_id in sessions_by_id
    ]


async def _send_bridge_command(
    websocket: WebSocket,
    rc_session: RemoteControlSession,
    command: RemoteControlCommand,
) -> bool:
    try:
        await websocket.send_json(RemoteControlService.command_payload(rc_session, command))
        return True
    except Exception as exc:
        logger.warning(
            "Failed to send remote-control command to desktop bridge",
            extra={
                "desktop_instance_id": rc_session.desktop_instance_id,
                "command_id": command.id,
                "error": str(exc),
            },
        )
        return False


async def _flush_pending_bridge_commands(
    desktop_instance_id: str,
    user_id: int,
    db: Session,
    *,
    websocket: WebSocket | None = None,
) -> int:
    target_ws = websocket or bridge_websockets.get(desktop_instance_id)
    if target_ws is None:
        return 0
    if websocket is None and bridge_users.get(desktop_instance_id) != user_id:
        return 0

    delivered_count = 0
    for rc_session, command in _pending_bridge_commands(desktop_instance_id, user_id, db):
        if await _send_bridge_command(target_ws, rc_session, command):
            delivered_count += 1
    return delivered_count


async def _flush_pending_for_session(rc_session: RemoteControlSession, db: Session) -> None:
    delivered_count = await _flush_pending_bridge_commands(
        rc_session.desktop_instance_id,
        rc_session.user_id,
        db,
    )
    if delivered_count:
        logger.info(
            "Flushed pending remote-control commands to local bridge",
            extra={
                "session_id": rc_session.id,
                "desktop_instance_id": rc_session.desktop_instance_id,
                "delivered_count": delivered_count,
            },
        )


@router.post(
    "/sessions",
    response_model=RemoteControlCreateSessionOut,
    dependencies=[remote_session_create_rate_limiter],
)
def create_session(
    data: RemoteControlCreateSessionIn,
    db_session: Session = Depends(session),
    auth: V1UserAuth = Depends(auth_must),
):
    return RemoteControlService.create_session(data, auth.id, db_session)


@router.get("/sessions/{session_id}", response_model=RemoteControlSessionOut)
def get_session(
    session_id: str,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    return RemoteControlService.to_session_out(rc_session)


@router.get("/sessions/{session_id}/projects", response_model=RemoteControlProjectListOut)
def list_session_projects(
    session_id: str,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    return RemoteControlService.list_projects(session_id, rc_session.user_id, db_session)


@router.post(
    "/sessions/{session_id}/projects",
    response_model=ProjectOut,
    dependencies=[remote_command_burst_rate_limiter, remote_command_minute_rate_limiter],
)
def create_session_project(
    session_id: str,
    data: RemoteControlCreateProjectIn,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    return RemoteControlService.create_project(session_id, rc_session.user_id, data, db_session)


@router.post("/sessions/{session_id}/extend", response_model=RemoteControlExtendOut)
def extend_session(
    session_id: str,
    data: RemoteControlExtendIn,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    expires_at = RemoteControlService.extend_session(
        session_id,
        rc_session.user_id,
        data.extend_seconds,
        db_session,
    )
    return RemoteControlExtendOut(expires_at=expires_at)


@router.patch("/sessions/{session_id}/target", response_model=RemoteControlPatchTargetOut)
async def patch_target(
    session_id: str,
    data: RemoteControlPatchTargetIn,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    result = RemoteControlService.patch_target(
        session_id,
        rc_session.user_id,
        data,
        db_session,
    )
    await _flush_pending_for_session(rc_session, db_session)
    return result


@router.delete("/sessions/{session_id}")
def revoke_session(
    session_id: str,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    RemoteControlService.revoke_session(session_id, rc_session.user_id, db_session)
    return Response(status_code=204)


@router.post(
    "/sessions/{session_id}/commands",
    response_model=RemoteControlCommandOut,
    response_model_exclude_none=True,
    dependencies=[remote_command_burst_rate_limiter, remote_command_minute_rate_limiter],
)
async def send_command(
    session_id: str,
    data: RemoteControlCommandIn,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    result = RemoteControlService.send_command(
        session_id,
        rc_session.user_id,
        data,
        db_session,
    )
    await _flush_pending_for_session(rc_session, db_session)
    return result


@router.get(
    "/sessions/{session_id}/steps",
    response_model=RemoteControlStepsOut,
    dependencies=[remote_steps_rate_limiter],
)
def list_steps(
    session_id: str,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    project_id: str | None = None,
    since: int = 0,
    limit: int = 200,
    order: str = "asc",
    db_session: Session = Depends(session),
):
    if order not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail="order must be asc or desc")
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    return RemoteControlService.list_steps(
        session_id,
        rc_session.user_id,
        project_id,
        since,
        limit,
        order,
        db_session,
    )


@router.get(
    "/sessions/{session_id}/projects/{project_id}/overlays",
    response_model=SpaceOverlayListResponse,
    dependencies=[remote_steps_rate_limiter],
)
def list_session_project_overlays(
    session_id: str,
    project_id: str,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    run_id: str | None = Query(None),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    return RemoteControlService.list_overlays(
        session_id,
        rc_session.user_id,
        project_id,
        run_id,
        db_session,
    )


@router.post(
    "/sessions/{session_id}/projects/{project_id}/apply",
    response_model=RemoteControlFolderOperationOut,
    dependencies=[remote_command_burst_rate_limiter, remote_command_minute_rate_limiter],
)
async def apply_session_project_run(
    session_id: str,
    project_id: str,
    data: RemoteControlFolderApplyIn,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    result = RemoteControlService.enqueue_apply_project(
        session_id,
        rc_session.user_id,
        project_id,
        data,
        db_session,
    )
    await _flush_pending_for_session(rc_session, db_session)
    return result


@router.post(
    "/sessions/{session_id}/projects/{project_id}/discard",
    response_model=RemoteControlFolderOperationOut,
    dependencies=[remote_command_burst_rate_limiter, remote_command_minute_rate_limiter],
)
async def discard_session_project_overlays(
    session_id: str,
    project_id: str,
    data: RemoteControlFolderDiscardIn,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    result = RemoteControlService.enqueue_discard_project_overlays(
        session_id,
        rc_session.user_id,
        project_id,
        data,
        db_session,
    )
    await _flush_pending_for_session(rc_session, db_session)
    return result


@router.post(
    "/sessions/{session_id}/projects/{project_id}/refresh",
    response_model=RemoteControlFolderOperationOut,
    dependencies=[remote_command_burst_rate_limiter, remote_command_minute_rate_limiter],
)
async def refresh_session_project(
    session_id: str,
    project_id: str,
    data: RemoteControlFolderRefreshIn,
    t: str | None = Query(None),
    x_remote_control_token: str | None = Header(
        None,
        alias="X-Remote-Control-Token",
    ),
    db_session: Session = Depends(session),
):
    rc_session = RemoteControlService.verify_link(
        session_id,
        _remote_link_token(t, x_remote_control_token),
        None,
        db_session,
    )
    result = RemoteControlService.enqueue_refresh_project(
        session_id,
        rc_session.user_id,
        project_id,
        data,
        db_session,
    )
    await _flush_pending_for_session(rc_session, db_session)
    return result


async def _validate_bridge_token(
    token: str | None,
    db: Session,
    expected_user_id: int,
    *,
    token_is_stripped: bool = False,
) -> tuple[V1UserAuth, datetime, str | None]:
    """
    Re-verify a bridge auth token and confirm it still belongs to the
    same user. Returns (auth, exp, jti) or raises HTTPException.
    """
    auth, jti = await _auth_token_with_jti(token, db, token_is_stripped=token_is_stripped)
    if auth.id != expected_user_id:
        raise HTTPException(status_code=401, detail="Token does not match bridge owner")
    return auth, auth.expired_at, jti


@router.websocket("/bridge/subscribe")
async def bridge_subscribe(websocket: WebSocket):
    if not _check_ws_origin(websocket, _bridge_allowed_origins(), allow_missing=True):
        await websocket.close(code=1008)
        return
    await start_remote_control_workers()
    await websocket.accept()
    desktop_instance_id: str | None = None
    user_id: int | None = None
    db = session_make()

    try:
        try:
            data = await asyncio.wait_for(
                websocket.receive_json(),
                timeout=WS_SUBSCRIBE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            await websocket.close(code=1008)
            return

        if data.get("type") != "subscribe" or not data.get("desktop_instance_id"):
            await websocket.send_json({"type": "error", "message": "Invalid bridge subscription"})
            await websocket.close()
            return

        token_raw = _strip_bearer(data.get("auth_token"))
        client_host = _websocket_client_host(websocket)
        await _enforce_ws_reconnect_rate_limit(
            "bridge",
            client_host,
        )
        auth, token_jti = await _auth_token_with_jti(token_raw, db, token_is_stripped=True)
        user_id = auth.id
        token_expires_at = auth.expired_at
        desktop_instance_id = data["desktop_instance_id"]
        worker_id = f"{os.getpid()}:{id(websocket)}"
        blacklist_check_interval = _bridge_blacklist_check_interval_seconds()
        next_blacklist_check_at = datetime.utcnow() + timedelta(seconds=blacklist_check_interval)

        bridge_websockets[desktop_instance_id] = websocket
        bridge_users[desktop_instance_id] = user_id
        _remember_bridge_token_jti(desktop_instance_id, token_jti)
        RemoteControlRedis.register_bridge(
            desktop_instance_id,
            user_id,
            worker_id,
            app_version=data.get("app_version"),
            capabilities=data.get("capabilities"),
        )

        now = datetime.utcnow()
        sessions = db.exec(
            select(RemoteControlSession).where(
                RemoteControlSession.user_id == user_id,
                RemoteControlSession.desktop_instance_id == desktop_instance_id,
                RemoteControlSession.status == "active",
            )
        ).all()
        for rc_session in sessions:
            rc_session.bridge_status = "online"
            rc_session.last_bridge_seen_at = now
            db.add(rc_session)
            RemoteControlService.record_event(
                rc_session.id,
                "bridge_online",
                {
                    "desktop_instance_id": desktop_instance_id,
                    "app_version": data.get("app_version"),
                    "capabilities": data.get("capabilities"),
                    "last_seen_at": now.isoformat(),
                },
                db,
                commit=False,
            )
            RemoteControlService.publish_status(
                rc_session.id,
                "bridge_status",
                {"status": "online", "last_seen_at": now.isoformat()},
            )
        db.commit()

        await websocket.send_json({"type": "connected", "desktop_instance_id": desktop_instance_id})
        await _flush_pending_bridge_commands(
            desktop_instance_id,
            user_id,
            db,
            websocket=websocket,
        )

        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")
            if msg_type == "ping":
                # Re-validate auth: the JWT has an exp claim that we cached at
                # connect, and may be added to the blacklist mid-flight (e.g.
                # the user logged out or changed their password). Either case
                # must close the bridge. A ping may also carry a fresh token, so
                # validate that first before checking the cached expiry.
                now = datetime.utcnow()
                next_token_raw = _strip_bearer(msg.get("auth_token"))
                if (
                    next_token_raw
                    and (not token_raw or not secrets.compare_digest(next_token_raw, token_raw))
                ):
                    try:
                        new_auth, new_exp, new_jti = await _validate_bridge_token(
                            next_token_raw, db, user_id, token_is_stripped=True
                        )
                        token_expires_at = new_exp
                        token_jti = new_jti
                        token_raw = next_token_raw
                        _remember_bridge_token_jti(desktop_instance_id, token_jti)
                        next_blacklist_check_at = now + timedelta(seconds=blacklist_check_interval)
                    except HTTPException as exc:
                        await websocket.send_json(
                            {"type": "auth_expired", "message": exc.detail}
                        )
                        await websocket.close(code=4401)
                        return
                if token_expires_at <= now:
                    await websocket.send_json({"type": "auth_expired"})
                    await websocket.close(code=4401)
                    return
                if token_jti and now >= next_blacklist_check_at:
                    if await is_blacklisted(token_jti):
                        await websocket.send_json({"type": "revoke_bridge", "reason": "token_revoked"})
                        await websocket.close(code=4401)
                        return
                    next_blacklist_check_at = now + timedelta(seconds=blacklist_check_interval)
                RemoteControlRedis.refresh_bridge(desktop_instance_id, user_id, worker_id)
                await _flush_pending_bridge_commands(
                    desktop_instance_id,
                    user_id,
                    db,
                    websocket=websocket,
                )
                await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat()})
            elif msg_type == "reauth" and msg.get("auth_token"):
                try:
                    next_token_raw = _strip_bearer(msg.get("auth_token"))
                    new_auth, new_exp, new_jti = await _validate_bridge_token(
                        next_token_raw, db, user_id, token_is_stripped=True
                    )
                    token_expires_at = new_exp
                    token_jti = new_jti
                    token_raw = next_token_raw
                    _remember_bridge_token_jti(desktop_instance_id, token_jti)
                    next_blacklist_check_at = datetime.utcnow() + timedelta(seconds=blacklist_check_interval)
                    await websocket.send_json({"type": "reauth_ok"})
                except HTTPException as exc:
                    await websocket.send_json(
                        {"type": "auth_expired", "message": exc.detail}
                    )
                    await websocket.close(code=4401)
                    return
            elif msg_type == "command_delivered" and msg.get("command_id"):
                RemoteControlService.mark_delivered(msg["command_id"], db)
            elif msg_type == "command_ack" and msg.get("command_id"):
                status = msg.get("status") or COMMAND_FAILED
                RemoteControlService.mark_ack(
                    msg["command_id"],
                    COMMAND_ACKNOWLEDGED if status == COMMAND_ACKNOWLEDGED else COMMAND_FAILED,
                    msg.get("error_code"),
                    msg.get("error"),
                    db,
                    msg.get("result"),
                )

    except WebSocketDisconnect:
        logger.info("Remote-control bridge disconnected", extra={"desktop_instance_id": desktop_instance_id})
    except HTTPException as exc:
        await websocket.send_json({"type": "error", "message": exc.detail})
        await websocket.close()
    except Exception as exc:
        logger.error("Remote-control bridge websocket failed", extra={"error": str(exc)}, exc_info=True)
    finally:
        if desktop_instance_id:
            is_current_bridge = bridge_websockets.get(desktop_instance_id) is websocket
            if is_current_bridge:
                bridge_websockets.pop(desktop_instance_id, None)
                bridge_users.pop(desktop_instance_id, None)
                bridge_token_jtis.pop(desktop_instance_id, None)
                RemoteControlRedis.unregister_bridge(desktop_instance_id, worker_id)
            if is_current_bridge and user_id is not None:
                sessions = db.exec(
                    select(RemoteControlSession).where(
                        RemoteControlSession.user_id == user_id,
                        RemoteControlSession.desktop_instance_id == desktop_instance_id,
                        RemoteControlSession.status == "active",
                    )
                ).all()
                for rc_session in sessions:
                    rc_session.bridge_status = "offline"
                    db.add(rc_session)
                    RemoteControlService.record_event(
                        rc_session.id,
                        "bridge_offline",
                        {
                            "desktop_instance_id": desktop_instance_id,
                            "last_seen_at": rc_session.last_bridge_seen_at.isoformat()
                            if rc_session.last_bridge_seen_at
                            else None,
                            "reason": "websocket_disconnect",
                        },
                        db,
                        commit=False,
                    )
                    RemoteControlService.publish_status(
                        rc_session.id,
                        "bridge_status",
                        {
                            "status": "offline",
                            "last_seen_at": rc_session.last_bridge_seen_at.isoformat()
                            if rc_session.last_bridge_seen_at
                            else None,
                            "message": "Desktop is offline",
                        },
                    )
                db.commit()
        db.close()


@router.websocket("/sessions/{session_id}/events/subscribe")
async def events_subscribe(websocket: WebSocket, session_id: str):
    # Browser clients always send Origin; reject anonymous connections in non-dev.
    if not _check_ws_origin(websocket, _events_allowed_origins(), allow_missing=False):
        await websocket.close(code=1008)
        return
    await start_remote_control_workers()
    await websocket.accept()
    db = session_make()
    registered = False

    try:
        try:
            data = await asyncio.wait_for(
                websocket.receive_json(),
                timeout=WS_SUBSCRIBE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            await websocket.close(code=1008)
            return

        if data.get("type") != "subscribe":
            await websocket.send_json({"type": "error", "message": "Invalid event subscription"})
            await websocket.close()
            return

        client_host = _websocket_client_host(websocket)
        link_token = data.get("link_token")
        await _enforce_ws_reconnect_rate_limit(
            "events",
            f"{session_id}:{client_host}",
        )
        rc_session = RemoteControlService.verify_link(
            session_id,
            link_token,
            None,
            db,
        )
        requested_project_id = data.get("subscribed_project_id")
        effective_project_id = requested_project_id or rc_session.current_project_id or rc_session.project_id
        if requested_project_id:
            RemoteControlService._ensure_project_in_session_space(
                rc_session,
                rc_session.user_id,
                requested_project_id,
                db,
            )
        remote_audit = _remote_audit_payload(websocket)
        remote_websockets.setdefault(session_id, set()).add(websocket)
        if effective_project_id:
            remote_projects[id(websocket)] = effective_project_id
        RemoteControlService.record_event(
            session_id,
            "remote_joined",
            {
                "user_id": rc_session.user_id,
                "project_id": effective_project_id,
                **remote_audit,
            },
            db,
        )
        registered = True

        session_out = RemoteControlService.to_session_out(rc_session)
        await websocket.send_json(
            {
                "type": "connected",
                "session_id": session_id,
                "project_id": effective_project_id,
                "current_project_id": session_out.current_project_id,
                "current_task_id": session_out.current_task_id,
                "current_history_id": session_out.current_history_id,
                "current_brain_session_id": session_out.current_brain_session_id,
                "bridge_status": session_out.bridge_status,
            }
        )

        while True:
            msg = await websocket.receive_json()
            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat()})
            elif msg.get("type") == "subscribe_project":
                next_project_id = msg.get("project_id")
                if next_project_id:
                    RemoteControlService._ensure_project_in_session_space(
                        rc_session,
                        rc_session.user_id,
                        next_project_id,
                        db,
                    )
                    remote_projects[id(websocket)] = next_project_id
                else:
                    remote_projects.pop(id(websocket), None)
                await websocket.send_json(
                    {
                        "type": "subscribed_project",
                        "session_id": session_id,
                        "project_id": next_project_id,
                    }
                )

    except WebSocketDisconnect:
        logger.info("Remote-control event websocket disconnected", extra={"session_id": session_id})
    except HTTPException as exc:
        await websocket.send_json({"type": "error", "message": exc.detail})
        await websocket.close()
    except Exception as exc:
        logger.error("Remote-control event websocket failed", extra={"error": str(exc)}, exc_info=True)
    finally:
        if registered:
            RemoteControlService.record_event(
                session_id,
                "remote_left",
                remote_audit,
                db,
            )
            sockets = remote_websockets.get(session_id)
            if sockets and websocket in sockets:
                sockets.remove(websocket)
            if not sockets:
                remote_websockets.pop(session_id, None)
            remote_projects.pop(id(websocket), None)
        db.close()


async def _send_to_remote_session(session_id: str, payload: dict[str, Any]) -> None:
    sockets = list(remote_websockets.get(session_id, set()))
    for ws in sockets:
        try:
            await ws.send_json(payload)
        except Exception:
            remote_websockets.get(session_id, set()).discard(ws)


async def _send_to_remote_socket(session_id: str, websocket: WebSocket, payload: dict[str, Any]) -> None:
    try:
        await websocket.send_json(payload)
    except Exception:
        remote_websockets.get(session_id, set()).discard(websocket)
        remote_projects.pop(id(websocket), None)


async def _close_bridges_for_blacklisted_jti(jti: str | None) -> None:
    if not jti:
        return

    for desktop_instance_id, current_jti in list(bridge_token_jtis.items()):
        if not secrets.compare_digest(current_jti, jti):
            continue
        ws = bridge_websockets.get(desktop_instance_id)
        if not ws:
            continue
        try:
            await ws.send_json({"type": "revoke_bridge", "reason": "token_revoked"})
            await ws.close(code=4401)
        except Exception as exc:
            logger.debug(
                "Failed to close revoked remote-control bridge",
                extra={"desktop_instance_id": desktop_instance_id, "error": str(exc)},
            )


async def _handle_pubsub_message(channel: str, payload: dict[str, Any]) -> None:
    if channel.startswith(BLACKLIST_PUBSUB_PREFIX):
        await _close_bridges_for_blacklisted_jti(payload.get("jti"))
        return

    if channel.startswith("rc:cmd:"):
        desktop_instance_id = channel.removeprefix("rc:cmd:")
        ws = bridge_websockets.get(desktop_instance_id)
        if ws:
            await ws.send_json(payload)
        else:
            logger.warning(
                "Remote-control command pub/sub arrived without a local bridge websocket",
                extra={
                    "desktop_instance_id": desktop_instance_id,
                    "command_id": payload.get("command", {}).get("id"),
                },
            )
        return

    if channel.startswith("rc:ack:"):
        session_id = channel.removeprefix("rc:ack:")
        await _send_to_remote_session(session_id, payload)
        return

    if channel.startswith("project:") and channel.endswith(":step"):
        project_id = channel[len("project:") : -len(":step")]
        for session_id, sockets in list(remote_websockets.items()):
            for ws in list(sockets):
                if remote_projects.get(id(ws)) == project_id:
                    await _send_to_remote_socket(session_id, ws, payload)


async def start_remote_control_workers() -> None:
    global _pubsub_task, _scanner_task

    if _pubsub_task is None or _pubsub_task.done():
        _pubsub_task = asyncio.create_task(_run_pubsub_listener())
    if _scanner_task is None or _scanner_task.done():
        _scanner_task = asyncio.create_task(_run_scanners())


async def _run_pubsub_listener() -> None:
    loop = asyncio.get_running_loop()
    reconnect_delay = PUBSUB_RECONNECT_BASE_SECONDS

    while True:
        redis_url = get_redis_manager().redis_url
        pubsub_client = None
        pubsub = None
        try:
            pubsub_client = redis.from_url(
                redis_url,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            pubsub = pubsub_client.pubsub()
            await loop.run_in_executor(
                None,
                pubsub.psubscribe,
                "rc:cmd:*",
                "rc:ack:*",
                "project:*:step",
                f"{BLACKLIST_PUBSUB_PREFIX}*",
            )
            reconnect_delay = PUBSUB_RECONNECT_BASE_SECONDS
            logger.info("Remote-control pub/sub listener started")

            while True:
                message = await loop.run_in_executor(
                    None,
                    pubsub.get_message,
                    True,
                    1.0,
                )
                if message and message.get("type") == "pmessage":
                    try:
                        payload = json.loads(message["data"])
                        await _handle_pubsub_message(message["channel"], payload)
                    except Exception as exc:
                        logger.error(
                            "Failed to handle remote-control pub/sub message",
                            extra={"error": str(exc)},
                            exc_info=True,
                        )
                await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(
                "Remote-control pub/sub listener disconnected; reconnecting",
                extra={"error": str(exc), "retry_in_seconds": reconnect_delay},
                exc_info=True,
            )
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, PUBSUB_RECONNECT_MAX_SECONDS)
        finally:
            if pubsub is not None:
                pubsub.close()
            if pubsub_client is not None:
                pubsub_client.close()


async def _run_scanners() -> None:
    global _last_bridge_ttl_scan_at
    logger.info("Remote-control retry/TTL scanner started")
    while True:
        await asyncio.sleep(10)
        db = session_make()
        try:
            RemoteControlService.retry_pending_commands(db)
            RemoteControlService.expire_timed_out_commands(db)
            now = datetime.utcnow()
            if _last_bridge_ttl_scan_at is None or now - _last_bridge_ttl_scan_at >= timedelta(seconds=30):
                _last_bridge_ttl_scan_at = now
                RemoteControlService.expire_stale_bridges(db)
        except Exception as exc:
            db.rollback()
            logger.warning("Remote-control scanner iteration failed", extra={"error": str(exc)}, exc_info=True)
        finally:
            db.close()
