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

import hashlib
import json
import secrets
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any
from urllib.parse import quote
from uuid import uuid4

from fastapi import HTTPException
from loguru import logger
from sqlalchemy import desc
from sqlmodel import Session, select

from app.core.environment import env
from app.core.redis_utils import get_redis_manager
from app.domains.chat.service import ChatService
from app.domains.remote_control.schema import (
    RemoteControlCommandIn,
    RemoteControlCommandOut,
    RemoteControlCreateProjectIn,
    RemoteControlCreateSessionIn,
    RemoteControlCreateSessionOut,
    RemoteControlFolderApplyIn,
    RemoteControlFolderDiscardIn,
    RemoteControlFolderOperationOut,
    RemoteControlFolderRefreshIn,
    RemoteControlPatchTargetIn,
    RemoteControlPatchTargetOut,
    RemoteControlProjectListOut,
    RemoteControlSessionOut,
    RemoteControlStepOut,
    RemoteControlStepsOut,
)
from app.domains.space.service.overlay_service import SpaceOverlayService
from app.domains.space.service.space_service import SpaceService
from app.model.chat.chat_history import ChatHistory, ChatStatus
from app.model.chat.chat_step import ChatStep
from app.model.project.project import Project, ProjectIn, ProjectMode, ProjectOut
from app.model.provider.provider import Provider
from app.model.remote_control import (
    RemoteControlCommand,
    RemoteControlEvent,
    RemoteControlLink,
    RemoteControlSession,
)
from app.model.space.space import Space, SpaceOut, SpaceSourceType

SESSION_ACTIVE = "active"
SESSION_REVOKED = "revoked"
SESSION_EXPIRED = "expired"

COMMAND_PENDING = "pending"
COMMAND_DELIVERED = "delivered"
COMMAND_ACKNOWLEDGED = "acknowledged"
COMMAND_FAILED = "failed"
COMMAND_EXPIRED = "expired"

BRIDGE_ONLINE_TTL_SECONDS = 90
COMMAND_ACK_TIMEOUT_SECONDS = 120
SWITCH_PROJECT_VIEW_ACK_TIMEOUT_SECONDS = 45
REMOTE_SESSION_TITLE_MAX_LENGTH = 256
DEFAULT_CAPABILITIES = {
    "bridge_version": 1,
    "commands": [
        "user_message",
        "human_reply",
        "stop",
        "skip_task",
        "add_task",
        "remove_task",
        "supplement",
        "switch_project_view",
        "space_project_upsert",
        "space_overlay_list",
        "space_apply_project_run",
        "space_refresh_project",
        "space_discard_project_overlays",
    ],
}
SWITCH_PROJECT_VIEW = "switch_project_view"
SPACE_PROJECT_UPSERT = "space_project_upsert"
SPACE_OVERLAY_LIST = "space_overlay_list"
SPACE_APPLY_PROJECT_RUN = "space_apply_project_run"
SPACE_REFRESH_PROJECT = "space_refresh_project"
SPACE_DISCARD_PROJECT_OVERLAYS = "space_discard_project_overlays"
SPACE_COMMANDS = {
    SPACE_PROJECT_UPSERT,
    SPACE_OVERLAY_LIST,
    SPACE_APPLY_PROJECT_RUN,
    SPACE_REFRESH_PROJECT,
    SPACE_DISCARD_PROJECT_OVERLAYS,
}
NON_BRAIN_COMMANDS = {SWITCH_PROJECT_VIEW, *SPACE_COMMANDS}


def _now() -> datetime:
    return datetime.utcnow()


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utc_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _truncate(value: str | None, max_length: int) -> str:
    text = (value or "").strip()
    if len(text) <= max_length:
        return text
    return text[: max_length - 3].rstrip() + "..."


def _legacy_dual_write_enabled() -> bool:
    value = str(env("REMOTE_CONTROL_LEGACY_DUAL_WRITE", "true")).lower()
    return value not in {"0", "false", "no", "off"}


def _normalize_origin(value: str | None) -> str:
    origin = (value or "").strip().rstrip("/")
    if not origin:
        return ""
    lower = origin.lower()
    for suffix in ("/api/v1", "/api/v2", "/api"):
        if lower.endswith(suffix):
            return origin[: -len(suffix)].rstrip("/")
    return origin


class RemoteControlRedis:
    @staticmethod
    def bridge_key(desktop_instance_id: str) -> str:
        return f"rc:bridge:{desktop_instance_id}"

    @staticmethod
    def command_channel(desktop_instance_id: str) -> str:
        return f"rc:cmd:{desktop_instance_id}"

    @staticmethod
    def ack_channel(session_id: str) -> str:
        return f"rc:ack:{session_id}"

    @staticmethod
    def step_channel(project_id: str) -> str:
        return f"project:{project_id}:step"

    @staticmethod
    def register_bridge(
        desktop_instance_id: str,
        user_id: int,
        worker_id: str,
        app_version: str | None = None,
        capabilities: dict[str, Any] | None = None,
    ) -> None:
        existing = RemoteControlRedis.get_bridge(desktop_instance_id)
        if existing and str(existing.get("user_id")) != str(user_id):
            raise ValueError("Desktop instance is already registered to another user")
        payload = {
            "user_id": user_id,
            "desktop_instance_id": desktop_instance_id,
            "worker_id": worker_id,
            "app_version": app_version,
            "capabilities": capabilities or DEFAULT_CAPABILITIES,
            "connected_at": _now().isoformat(),
            "last_heartbeat": _now().isoformat(),
        }
        get_redis_manager().client.setex(
            RemoteControlRedis.bridge_key(desktop_instance_id),
            BRIDGE_ONLINE_TTL_SECONDS,
            json.dumps(payload),
        )

    @staticmethod
    def refresh_bridge(desktop_instance_id: str, user_id: int, worker_id: str) -> None:
        existing = RemoteControlRedis.get_bridge(desktop_instance_id) or {}
        if existing.get("user_id") and str(existing.get("user_id")) != str(user_id):
            return
        if existing.get("worker_id") and existing.get("worker_id") != worker_id:
            return
        RemoteControlRedis.register_bridge(
            desktop_instance_id,
            user_id,
            worker_id,
            app_version=existing.get("app_version"),
            capabilities=existing.get("capabilities"),
        )

    @staticmethod
    def unregister_bridge(desktop_instance_id: str, worker_id: str | None = None) -> None:
        if worker_id:
            existing = RemoteControlRedis.get_bridge(desktop_instance_id)
            if existing and existing.get("worker_id") != worker_id:
                return
        get_redis_manager().client.delete(RemoteControlRedis.bridge_key(desktop_instance_id))

    @staticmethod
    def get_bridge(desktop_instance_id: str) -> dict[str, Any] | None:
        data = get_redis_manager().client.get(RemoteControlRedis.bridge_key(desktop_instance_id))
        if not data:
            return None
        try:
            return json.loads(data)
        except Exception:
            return None

    @staticmethod
    def is_bridge_online(desktop_instance_id: str, user_id: int) -> bool:
        bridge = RemoteControlRedis.get_bridge(desktop_instance_id)
        return bool(bridge and str(bridge.get("user_id")) == str(user_id))

    @staticmethod
    def publish(channel: str, payload: dict[str, Any]) -> bool:
        try:
            subscriber_count = get_redis_manager().client.publish(channel, json.dumps(payload))
            if subscriber_count == 0 and channel.startswith("rc:cmd:"):
                logger.warning(
                    "Remote control command publish had no Redis subscribers",
                    extra={"channel": channel},
                )
            return subscriber_count > 0
        except Exception as exc:
            logger.warning("Remote control Redis publish failed", extra={"channel": channel, "error": str(exc)})
            return False


class RemoteControlService:
    @staticmethod
    def web_origin() -> str:
        return _normalize_origin(
            env("REMOTE_CONTROL_WEB_ORIGIN")
            or env("WEB_APP_ORIGIN")
            or env("VITE_REMOTE_CONTROL_WEB_ORIGIN")
            or env("web_app_origin")
            or env("VITE_WEB_APP_ORIGIN")
            or env("VITE_SITE_URL")
            or env("SITE_URL")
        )

    @staticmethod
    def remote_url(session_id: str, token: str) -> str:
        origin = RemoteControlService.web_origin()
        path = f"/remote-control/{session_id}#t={quote(token, safe='')}"
        return f"{origin}{path}" if origin else path

    @staticmethod
    def _ensure_active(session: RemoteControlSession, db: Session) -> None:
        if session.status != SESSION_ACTIVE:
            raise HTTPException(status_code=410, detail="Remote control session is not active")
        if session.expires_at <= _now():
            session.status = SESSION_EXPIRED
            db.add(session)
            db.commit()
            raise HTTPException(status_code=410, detail="Remote control session has expired")

    @staticmethod
    def _owned_session(session_id: str, user_id: int, db: Session) -> RemoteControlSession:
        session = db.get(RemoteControlSession, session_id)
        if not session or session.user_id != user_id:
            raise HTTPException(status_code=404, detail="Remote control session not found")
        RemoteControlService._ensure_active(session, db)
        return session

    @staticmethod
    def _effective_target(session: RemoteControlSession) -> tuple[str | None, str | None, str | None, str | None]:
        return (
            session.current_project_id or session.project_id,
            session.current_task_id or session.active_task_id,
            session.current_history_id,
            session.current_brain_session_id or session.brain_session_id,
        )

    @staticmethod
    def _effective_space_id(session: RemoteControlSession) -> str | None:
        return session.space_id

    @staticmethod
    def _get_owned_space(user_id: int, space_id: str, db: Session) -> Space:
        try:
            return SpaceService._get_owned_space(space_id, user_id, db)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @staticmethod
    def _get_owned_project(user_id: int, project_id: str, db: Session) -> Project | None:
        canonical_user_id = SpaceService.canonical_user_id(user_id)
        return db.exec(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == canonical_user_id,
            )
        ).first()

    @staticmethod
    def _space_for_project(user_id: int, project_id: str, db: Session) -> Space | None:
        project = RemoteControlService._get_owned_project(user_id, project_id, db)
        if project:
            return RemoteControlService._get_owned_space(user_id, project.space_id, db)
        history = RemoteControlService._find_project_template(user_id, project_id, db)
        if not history:
            history = RemoteControlService._find_task_history(user_id, project_id, db)
        if history and history.space_id:
            return RemoteControlService._get_owned_space(user_id, history.space_id, db)
        return None

    @staticmethod
    def _session_space(session: RemoteControlSession, user_id: int, db: Session) -> Space:
        if session.space_id:
            return RemoteControlService._get_owned_space(user_id, session.space_id, db)
        project_id, _, _, _ = RemoteControlService._effective_target(session)
        if project_id:
            space = RemoteControlService._space_for_project(user_id, project_id, db)
            if space:
                session.space_id = space.id
                session.space_name_snapshot = space.name
                db.add(session)
                db.flush()
                return space
        space = SpaceService.ensure_legacy_space(user_id, db)
        session.space_id = space.id
        session.space_name_snapshot = space.name
        db.add(session)
        db.flush()
        return space

    @staticmethod
    def _ensure_folder_space(space: Space) -> None:
        if space.source_type != SpaceSourceType.FOLDER:
            raise HTTPException(status_code=400, detail={"code": "SPACE_NOT_FOLDER_BACKED"})

    @staticmethod
    def _ensure_project_in_session_space(
        session: RemoteControlSession,
        user_id: int,
        project_id: str,
        db: Session,
    ) -> Project | None:
        project = RemoteControlService._get_owned_project(user_id, project_id, db)
        session_space_id = RemoteControlService._effective_space_id(session)
        if project:
            if session_space_id and project.space_id != session_space_id:
                raise HTTPException(status_code=403, detail="Project is outside this remote Space")
            return project

        history = RemoteControlService._find_project_template(user_id, project_id, db)
        if not history:
            history = RemoteControlService._find_task_history(user_id, project_id, db)
        if not history:
            raise HTTPException(status_code=403, detail="Project not found or access denied")
        if session_space_id and history.space_id and history.space_id != session_space_id:
            raise HTTPException(status_code=403, detail="Project is outside this remote Space")
        return None

    @staticmethod
    def _is_legacy_target_request(session: RemoteControlSession, normalized: dict[str, Any]) -> bool:
        if session.current_brain_session_id is not None or not session.brain_session_id:
            return False
        if (
            normalized["target_project_id"] is None
            and normalized["target_task_id"] is None
            and normalized["target_brain_session_id"] is None
        ):
            return True
        return (
            normalized["target_project_id"] == session.project_id
            and normalized["target_brain_session_id"] == session.brain_session_id
            and (
                normalized["target_task_id"] is None
                or normalized["target_task_id"] == session.active_task_id
            )
        )

    @staticmethod
    def _find_task_history(user_id: int, task_id: str, db: Session) -> ChatHistory | None:
        return db.exec(
            select(ChatHistory).where(
                ChatHistory.user_id == user_id,
                ChatHistory.task_id == task_id,
            )
        ).first()

    @staticmethod
    def _find_project_template(user_id: int, project_id: str, db: Session) -> ChatHistory | None:
        return db.exec(
            select(ChatHistory)
            .where(
                ChatHistory.user_id == user_id,
                ChatHistory.project_id == project_id,
            )
            .order_by(desc(ChatHistory.created_at), desc(ChatHistory.id))
        ).first()

    @staticmethod
    def _ensure_project_owner(user_id: int, project_id: str, db: Session) -> ChatHistory:
        project = RemoteControlService._get_owned_project(user_id, project_id, db)
        history = RemoteControlService._find_project_template(user_id, project_id, db)
        if not history:
            history = RemoteControlService._find_task_history(user_id, project_id, db)
        if not history:
            if project:
                return None  # type: ignore[return-value]
            raise HTTPException(status_code=403, detail="Project not found or access denied")
        return history

    @staticmethod
    def _ensure_target_owner(
        user_id: int,
        project_id: str,
        task_id: str | None,
        db: Session,
    ) -> ChatHistory:
        RemoteControlService._ensure_project_owner(user_id, project_id, db)
        if not task_id:
            template = RemoteControlService._find_project_template(user_id, project_id, db)
            if not template:
                template = RemoteControlService._find_task_history(user_id, project_id, db)
            if not template:
                if RemoteControlService._get_owned_project(user_id, project_id, db):
                    return None  # type: ignore[return-value]
                raise HTTPException(status_code=403, detail="Project not found or access denied")
            return template
        history = RemoteControlService._find_task_history(user_id, task_id, db)
        if not history:
            raise HTTPException(status_code=403, detail="Task not found or access denied")
        history_project_id = history.project_id or history.task_id
        if history_project_id != project_id:
            raise HTTPException(status_code=403, detail="Task does not belong to target project")
        return history

    @staticmethod
    def verify_link(
        session_id: str,
        token: str | None,
        user_id: int | None,
        db: Session,
    ) -> RemoteControlSession:
        if not token:
            raise HTTPException(status_code=400, detail="Remote control link token is required")
        if user_id is None:
            session = db.get(RemoteControlSession, session_id)
            if not session:
                raise HTTPException(status_code=404, detail="Remote control session not found")
            RemoteControlService._ensure_active(session, db)
        else:
            session = RemoteControlService._owned_session(session_id, user_id, db)
        link = db.exec(
            select(RemoteControlLink)
            .where(
                RemoteControlLink.session_id == session_id,
                RemoteControlLink.token_hash == _token_hash(token),
            )
        ).first()
        if not link or link.expires_at <= _now():
            raise HTTPException(status_code=403, detail="Remote control link is invalid or expired")
        # Bump use_count only on first activation: every subsequent request
        # (step polling, command, extend, ...) bumps last_remote_seen_at on
        # the session instead. This keeps use_count meaningful as a "has-been-
        # used" indicator for anomaly detection rather than a request counter.
        if link.first_used_at is None:
            link.first_used_at = _now()
            link.use_count = (link.use_count or 0) + 1
            db.add(link)
        session.last_remote_seen_at = _now()
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    @staticmethod
    def create_session(
        data: RemoteControlCreateSessionIn,
        user_id: int,
        db: Session,
    ) -> RemoteControlCreateSessionOut:
        if not RemoteControlRedis.is_bridge_online(data.desktop_instance_id, user_id):
            raise HTTPException(status_code=409, detail={"code": "BRIDGE_OFFLINE"})

        is_v2_request = any(
            value is not None
            for value in (data.initial_project_id, data.initial_task_id, data.initial_history_id)
        ) or data.space_id is not None or not (data.project_id and data.active_task_id)
        target_project_id = data.initial_project_id if data.initial_project_id is not None else data.project_id
        target_task_id = data.initial_task_id if data.initial_task_id is not None else data.active_task_id
        target_history_id = data.initial_history_id if is_v2_request else None
        target_history: ChatHistory | None = None
        if target_project_id:
            target_history = RemoteControlService._ensure_target_owner(user_id, target_project_id, target_task_id, db)
            if target_history and target_task_id is None:
                target_task_id = target_history.task_id
            if target_history and target_history_id is None and target_history.id is not None:
                target_history_id = str(target_history.id)
        if data.space_id:
            space = RemoteControlService._get_owned_space(user_id, data.space_id, db)
        elif target_project_id:
            space = RemoteControlService._space_for_project(user_id, target_project_id, db)
            if not space:
                space = SpaceService.ensure_legacy_space(user_id, db)
        else:
            space = SpaceService.ensure_legacy_space(user_id, db)
        if target_project_id:
            project = RemoteControlService._get_owned_project(user_id, target_project_id, db)
            if project and project.space_id != space.id:
                raise HTTPException(status_code=403, detail="Project is outside this remote Space")
            if target_history and target_history.space_id and target_history.space_id != space.id:
                raise HTTPException(status_code=403, detail="Project is outside this remote Space")

        expires_at = _now() + timedelta(seconds=data.expires_in_seconds)
        title = _truncate(data.title or space.name or "Eigent Desktop", REMOTE_SESSION_TITLE_MAX_LENGTH)
        current_brain_session_id = _id("rc_brain") if is_v2_request and target_project_id else None
        legacy_brain_session_id = data.brain_session_id or (_id("rc_brain") if target_project_id else None)
        session = None
        if not is_v2_request and target_project_id and target_task_id:
            session = db.exec(
                select(RemoteControlSession).where(
                    RemoteControlSession.user_id == user_id,
                    RemoteControlSession.desktop_instance_id == data.desktop_instance_id,
                    RemoteControlSession.project_id == target_project_id,
                    RemoteControlSession.active_task_id == target_task_id,
                    RemoteControlSession.status == SESSION_ACTIVE,
                )
            ).first()
        if session is None:
            session = RemoteControlSession(
                id=_id("rcs"),
                user_id=user_id,
                desktop_instance_id=data.desktop_instance_id,
                space_id=space.id,
                space_name_snapshot=space.name,
                project_id=target_project_id if (not is_v2_request or _legacy_dual_write_enabled()) else None,
                active_task_id=target_task_id if (not is_v2_request or _legacy_dual_write_enabled()) else None,
                brain_session_id=(
                    current_brain_session_id
                    if is_v2_request and _legacy_dual_write_enabled()
                    else (legacy_brain_session_id if not is_v2_request else None)
                ),
                current_project_id=target_project_id if is_v2_request else None,
                current_task_id=target_task_id if is_v2_request else None,
                current_history_id=target_history_id if is_v2_request else None,
                current_brain_session_id=current_brain_session_id,
                last_target_project_id=target_project_id,
                last_target_task_id=target_task_id,
                last_target_history_id=target_history_id,
                last_target_brain_session_id=current_brain_session_id or legacy_brain_session_id,
                title=title,
                status=SESSION_ACTIVE,
                bridge_status="online",
                execution_mode="desktop_ui",
                expires_at=expires_at,
                last_bridge_seen_at=_now(),
                capabilities=DEFAULT_CAPABILITIES,
            )
        else:
            session.brain_session_id = data.brain_session_id or session.brain_session_id or legacy_brain_session_id
            session.space_id = space.id
            session.space_name_snapshot = space.name
            session.title = title or session.title
            session.expires_at = expires_at
            session.bridge_status = "online"
            session.last_bridge_seen_at = _now()
            session.last_target_project_id = target_project_id or session.last_target_project_id
            session.last_target_task_id = target_task_id or session.last_target_task_id
            session.last_target_history_id = target_history_id or session.last_target_history_id
            session.last_target_brain_session_id = (
                current_brain_session_id
                or legacy_brain_session_id
                or session.last_target_brain_session_id
            )

        token = secrets.token_urlsafe(32)
        link = RemoteControlLink(
            id=_id("rcl"),
            session_id=session.id,
            token_hash=_token_hash(token),
            expires_at=expires_at,
        )
        db.add(session)
        db.add(link)
        db.commit()
        db.refresh(session)
        RemoteControlService.record_event(
            session.id,
            "session_created",
            {
                "user_id": user_id,
                "desktop_instance_id": session.desktop_instance_id,
                "space_id": session.space_id,
                "project_id": session.project_id,
                "active_task_id": session.active_task_id,
                "current_project_id": session.current_project_id,
                "current_task_id": session.current_task_id,
                "expires_at": _utc_iso(session.expires_at),
            },
            db,
        )
        return RemoteControlCreateSessionOut(
            session_id=session.id,
            url=RemoteControlService.remote_url(session.id, token),
            expires_at=session.expires_at,
            bridge_status=session.bridge_status,
            space_id=session.space_id,
            space_name=session.space_name_snapshot,
            current_project_id=session.current_project_id,
            current_task_id=session.current_task_id,
            current_history_id=session.current_history_id,
            current_brain_session_id=session.current_brain_session_id,
        )

    @staticmethod
    def to_session_out(session: RemoteControlSession) -> RemoteControlSessionOut:
        project_id, task_id, history_id, brain_session_id = RemoteControlService._effective_target(session)
        return RemoteControlSessionOut(
            session_id=session.id,
            desktop_instance_id=session.desktop_instance_id,
            space_id=session.space_id,
            space_name=session.space_name_snapshot,
            project_id=project_id,
            active_task_id=task_id,
            brain_session_id=brain_session_id,
            current_project_id=project_id,
            current_task_id=task_id,
            current_history_id=history_id,
            current_brain_session_id=brain_session_id,
            title=session.title,
            status=session.status,
            bridge_status="online"
            if RemoteControlRedis.is_bridge_online(session.desktop_instance_id, session.user_id)
            else "offline",
            execution_mode=session.execution_mode,
            capabilities=session.capabilities or DEFAULT_CAPABILITIES,
            created_at=session.created_at,
            expires_at=session.expires_at,
        )

    @staticmethod
    def extend_session(session_id: str, user_id: int, extend_seconds: int, db: Session) -> datetime:
        if extend_seconds not in {86400, 259200, 604800}:
            raise HTTPException(status_code=400, detail="Unsupported extension duration")
        session = RemoteControlService._owned_session(session_id, user_id, db)
        max_expires_at = (session.created_at or _now()) + timedelta(days=7)
        requested = session.expires_at + timedelta(seconds=extend_seconds)
        if requested > max_expires_at:
            raise HTTPException(status_code=400, detail="Remote control session cannot exceed 7 days")
        session.expires_at = requested
        db.add(session)
        links = db.exec(select(RemoteControlLink).where(RemoteControlLink.session_id == session.id)).all()
        for link in links:
            link.expires_at = min(link.expires_at + timedelta(seconds=extend_seconds), session.expires_at)
            db.add(link)
        db.commit()
        db.refresh(session)
        return session.expires_at

    @staticmethod
    def patch_target(
        session_id: str,
        user_id: int,
        data: RemoteControlPatchTargetIn,
        db: Session,
    ) -> RemoteControlPatchTargetOut:
        session = RemoteControlService._owned_session(session_id, user_id, db)
        if not RemoteControlRedis.is_bridge_online(session.desktop_instance_id, user_id):
            raise HTTPException(status_code=409, detail={"code": "BRIDGE_OFFLINE"})
        RemoteControlService._ensure_project_in_session_space(session, user_id, data.project_id, db)
        history = RemoteControlService._ensure_target_owner(user_id, data.project_id, data.task_id, db)
        current_task_id = data.task_id or (history.task_id if history else None)
        current_history_id = data.history_id or (str(history.id) if history and history.id is not None else None)
        previous_project_id, previous_task_id, previous_history_id, previous_brain_session_id = (
            RemoteControlService._effective_target(session)
        )
        current_brain_session_id = _id("rc_brain")

        session.current_project_id = data.project_id
        session.current_task_id = current_task_id
        session.current_history_id = current_history_id
        session.current_brain_session_id = current_brain_session_id
        session.last_target_project_id = data.project_id
        session.last_target_task_id = current_task_id
        session.last_target_history_id = current_history_id
        session.last_target_brain_session_id = current_brain_session_id
        if _legacy_dual_write_enabled():
            session.project_id = data.project_id
            session.active_task_id = current_task_id
            session.brain_session_id = current_brain_session_id
        db.add(session)
        switch_payload = RemoteControlService._enrich_switch_project_payload(
            user_id,
            data.project_id,
            {
                "target_project_id": data.project_id,
                "target_task_id": current_task_id,
                "target_history_id": current_history_id,
                "previous_project_id": previous_project_id,
                "previous_task_id": previous_task_id,
                "previous_history_id": previous_history_id,
                "previous_brain_session_id": previous_brain_session_id,
            },
            db,
        )
        command = RemoteControlCommand(
            id=_id("rc_cmd"),
            session_id=session.id,
            user_id=user_id,
            source_channel="remote_web",
            type=SWITCH_PROJECT_VIEW,
            payload=switch_payload,
            space_id=session.space_id,
            target_project_id=data.project_id,
            target_task_id=current_task_id,
            target_brain_session_id=current_brain_session_id,
            status=COMMAND_PENDING,
        )
        db.add(command)
        RemoteControlService.record_event(
            session.id,
            "target_changed",
            {
                "from_project_id": previous_project_id,
                "to_project_id": data.project_id,
                "from_task_id": previous_task_id,
                "to_task_id": current_task_id,
                "new_brain_session_id": current_brain_session_id,
            },
            db,
            commit=False,
        )
        db.commit()
        db.refresh(session)
        db.refresh(command)
        RemoteControlService.publish_status(
            session.id,
            "target_changed",
            {
                "space_id": session.space_id,
                "current_project_id": session.current_project_id or data.project_id,
                "current_task_id": session.current_task_id,
                "current_history_id": session.current_history_id,
                "current_brain_session_id": (
                    session.current_brain_session_id or current_brain_session_id
                ),
                "previous_project_id": previous_project_id,
                "previous_task_id": previous_task_id,
            },
        )
        RemoteControlService.publish_command(session, command)
        return RemoteControlPatchTargetOut(
            space_id=session.space_id,
            current_project_id=session.current_project_id or data.project_id,
            current_task_id=session.current_task_id,
            current_history_id=session.current_history_id,
            current_brain_session_id=session.current_brain_session_id or current_brain_session_id,
            desktop_ready="pending",
        )

    @staticmethod
    def revoke_session(session_id: str, user_id: int, db: Session) -> None:
        session = RemoteControlService._owned_session(session_id, user_id, db)
        now = _now()
        session.status = SESSION_REVOKED
        session.revoked_at = now
        db.add(session)
        links = db.exec(
            select(RemoteControlLink).where(
                RemoteControlLink.session_id == session.id,
                RemoteControlLink.expires_at > now,
            )
        ).all()
        for link in links:
            link.expires_at = now
            db.add(link)
        RemoteControlService.record_event(
            session.id,
            "session_revoked",
            {"user_id": user_id, "reason": "owner_request"},
            db,
            commit=False,
        )
        db.commit()
        RemoteControlService.publish_status(session.id, "session_revoked", {"session_id": session.id})

    @staticmethod
    def revoke_user_sessions(user_id: int, db: Session, reason: str) -> int:
        sessions = db.exec(
            select(RemoteControlSession).where(
                RemoteControlSession.user_id == user_id,
                RemoteControlSession.status == SESSION_ACTIVE,
            )
        ).all()
        now = _now()
        session_ids = [session.id for session in sessions]
        if session_ids:
            links = db.exec(
                select(RemoteControlLink).where(
                    RemoteControlLink.session_id.in_(session_ids),
                    RemoteControlLink.expires_at > now,
                )
            ).all()
            for link in links:
                link.expires_at = now
                db.add(link)
        for session in sessions:
            session.status = SESSION_REVOKED
            session.revoked_at = now
            db.add(session)
            RemoteControlService.record_event(
                session.id,
                "session_revoked",
                {"user_id": user_id, "reason": reason},
                db,
                commit=False,
            )
        db.commit()
        for session in sessions:
            RemoteControlService.publish_status(
                session.id,
                "session_revoked",
                {"session_id": session.id, "reason": reason},
            )
        return len(sessions)

    @staticmethod
    def _history_template(
        user_id: int,
        target_project_id: str,
        target_task_id: str | None,
        db: Session,
    ) -> ChatHistory | SimpleNamespace:
        if target_task_id:
            active = RemoteControlService._find_task_history(user_id, target_task_id, db)
            if active:
                return active
        fallback = RemoteControlService._find_project_template(user_id, target_project_id, db)
        if not fallback:
            fallback = db.exec(
                select(ChatHistory)
                .where(ChatHistory.user_id == user_id)
                .order_by(desc(ChatHistory.created_at), desc(ChatHistory.id))
            ).first()
        if fallback:
            return fallback

        provider = db.exec(
            select(Provider)
            .where(Provider.user_id == user_id, Provider.prefer == True, Provider.no_delete())  # noqa: E712
            .order_by(desc(Provider.updated_at), desc(Provider.id))
        ).first()
        if not provider:
            raise HTTPException(
                status_code=400,
                detail={"code": "REMOTE_MODEL_PROVIDER_REQUIRED"},
            )
        return SimpleNamespace(
            language="en",
            model_platform=provider.provider_name,
            model_type=provider.model_type or "",
            api_key=provider.api_key or "",
            api_url=provider.endpoint_url or "",
            max_retries=3,
            file_save_path=None,
            installed_mcp={},
            project_name="",
        )

    @staticmethod
    def _create_history_for_command(
        user_id: int,
        space_id: str | None,
        target_project_id: str,
        target_task_id: str | None,
        command: RemoteControlCommandIn,
        next_task_id: str,
        db: Session,
    ) -> ChatHistory:
        template = RemoteControlService._history_template(user_id, target_project_id, target_task_id, db)
        history = ChatHistory(
            user_id=user_id,
            task_id=next_task_id,
            project_id=target_project_id,
            space_id=space_id,
            question=str(command.payload.get("content") or command.payload.get("question") or ""),
            language=template.language,
            model_platform=template.model_platform,
            model_type=template.model_type,
            api_key=template.api_key,
            api_url=template.api_url,
            max_retries=template.max_retries,
            file_save_path=template.file_save_path,
            installed_mcp=template.installed_mcp,
            project_name=template.project_name,
            summary="",
            tokens=0,
            spend=0,
            status=ChatStatus.ongoing.value,
        )
        db.add(history)
        return history

    @staticmethod
    def _enrich_switch_project_payload(
        user_id: int,
        target_project_id: str,
        payload: dict[str, Any],
        db: Session,
    ) -> dict[str, Any]:
        project = RemoteControlService._get_owned_project(user_id, target_project_id, db)
        space = RemoteControlService._space_for_project(user_id, target_project_id, db)
        project_group = None
        try:
            project_group = ChatService.get_grouped_project(user_id, target_project_id, True, db)
        except Exception:
            project_group = None

        tasks = project_group.tasks if project_group and project_group.tasks else []
        task_ids = [task.task_id for task in tasks]
        representative = tasks[0] if tasks else None
        if not project and not representative:
            raise HTTPException(status_code=404, detail="Project not found")
        project_name = (
            (project_group.project_name if project_group else None)
            or (project.name if project else None)
            or target_project_id
        )
        enriched = dict(payload)
        enriched.update(
            {
                "space_id": space.id if space else None,
                "space": SpaceOut.from_model(space).model_dump(mode="json") if space else None,
                "project": ProjectOut.from_model(project).model_dump(mode="json") if project else None,
                "target_project_id": target_project_id,
                "task_ids": task_ids,
                "question": (
                    (project_group.last_prompt if project_group else None)
                    or (representative.question if representative else None)
                    or (project.description if project else None)
                    or project_name
                    or ""
                ),
                "history_id": str(representative.id) if representative and representative.id is not None else None,
                "project_name": project_name,
            }
        )
        return enriched

    @staticmethod
    def _enqueue_bridge_command(
        session: RemoteControlSession,
        user_id: int,
        command_type: str,
        payload: dict[str, Any],
        db: Session,
        *,
        target_project_id: str | None = None,
        target_task_id: str | None = None,
        target_brain_session_id: str | None = None,
        source_channel: str = "remote_web",
    ) -> RemoteControlCommandOut:
        command = RemoteControlCommand(
            id=_id("rc_cmd"),
            session_id=session.id,
            user_id=user_id,
            source_channel=source_channel,
            type=command_type,
            payload=payload,
            space_id=session.space_id,
            target_project_id=target_project_id,
            target_task_id=target_task_id,
            target_brain_session_id=target_brain_session_id,
            status=COMMAND_PENDING,
        )
        db.add(command)
        db.commit()
        db.refresh(command)
        RemoteControlService.record_event(
            session.id,
            "command_created",
            {
                "command_id": command.id,
                "type": command.type,
                "space_id": command.space_id,
                "target_project_id": command.target_project_id,
            },
            db,
        )
        RemoteControlService.publish_command(session, command)
        return RemoteControlCommandOut(command_id=command.id, status=command.status)

    @staticmethod
    def _restore_switch_target_if_current(command: RemoteControlCommand, db: Session) -> dict[str, Any]:
        payload = getattr(command, "payload", None) or {}
        if "previous_project_id" not in payload or "previous_brain_session_id" not in payload:
            return {}

        session = db.get(RemoteControlSession, command.session_id)
        if not session:
            return {}
        # Only roll back when the session still points at the exact target
        # produced by this failed switch. This protects a newer switch in the
        # same project from being overwritten by an older failed command.
        if (
            session.current_project_id != command.target_project_id
            or session.current_task_id != command.target_task_id
            or session.current_brain_session_id != command.target_brain_session_id
        ):
            return {}

        previous_project_id = payload.get("previous_project_id")
        previous_task_id = payload.get("previous_task_id")
        previous_history_id = payload.get("previous_history_id")
        previous_brain_session_id = payload.get("previous_brain_session_id")
        session.current_project_id = previous_project_id
        session.current_task_id = previous_task_id
        session.current_history_id = previous_history_id
        session.current_brain_session_id = previous_brain_session_id
        session.last_target_project_id = previous_project_id
        session.last_target_task_id = previous_task_id
        session.last_target_history_id = previous_history_id
        session.last_target_brain_session_id = previous_brain_session_id
        if _legacy_dual_write_enabled():
            session.project_id = previous_project_id
            session.active_task_id = previous_task_id
            session.brain_session_id = previous_brain_session_id
        db.add(session)
        return {
            "restored_project_id": previous_project_id,
            "restored_task_id": previous_task_id,
            "restored_history_id": previous_history_id,
            "restored_brain_session_id": previous_brain_session_id,
        }

    @staticmethod
    def list_projects(
        session_id: str,
        user_id: int,
        db: Session,
    ) -> RemoteControlProjectListOut:
        session = RemoteControlService._owned_session(session_id, user_id, db)
        space = RemoteControlService._session_space(session, user_id, db)
        projects = SpaceService.list_projects(space.id, user_id, db)
        return RemoteControlProjectListOut(space=SpaceOut.from_model(space), items=projects)

    @staticmethod
    def create_project(
        session_id: str,
        user_id: int,
        data: RemoteControlCreateProjectIn,
        db: Session,
    ) -> ProjectOut:
        session = RemoteControlService._owned_session(session_id, user_id, db)
        if not RemoteControlRedis.is_bridge_online(session.desktop_instance_id, user_id):
            raise HTTPException(status_code=409, detail={"code": "BRIDGE_OFFLINE"})
        space = RemoteControlService._session_space(session, user_id, db)
        project = SpaceService.create_project(
            space.id,
            ProjectIn(
                name=data.name,
                description=data.description,
                mode=data.mode or ProjectMode.SINGLE_AGENT,
                workdir_mode=data.workdir_mode,
                metadata=data.metadata,
            ),
            user_id,
            db,
        )
        project_out = ProjectOut.from_model(project)
        RemoteControlService._enqueue_bridge_command(
            session,
            user_id,
            SPACE_PROJECT_UPSERT,
            {
                "space": SpaceOut.from_model(space).model_dump(mode="json"),
                "project": project_out.model_dump(mode="json"),
            },
            db,
            target_project_id=project.id,
        )
        RemoteControlService.publish_status(
            session.id,
            "space_project_upserted",
            {"space_id": space.id, "project": project_out.model_dump(mode="json")},
        )
        return project_out

    @staticmethod
    def list_overlays(
        session_id: str,
        user_id: int,
        project_id: str,
        run_id: str | None,
        db: Session,
    ):
        session = RemoteControlService._owned_session(session_id, user_id, db)
        space = RemoteControlService._session_space(session, user_id, db)
        RemoteControlService._ensure_folder_space(space)
        RemoteControlService._ensure_project_in_session_space(session, user_id, project_id, db)
        try:
            return SpaceOverlayService.list_overlays(
                space.id,
                project_id,
                user_id,
                db,
                run_id=run_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @staticmethod
    def enqueue_apply_project(
        session_id: str,
        user_id: int,
        project_id: str,
        data: RemoteControlFolderApplyIn,
        db: Session,
    ) -> RemoteControlFolderOperationOut:
        if not data.confirm:
            raise HTTPException(status_code=400, detail={"code": "REMOTE_CONFIRM_REQUIRED"})
        session = RemoteControlService._owned_session(session_id, user_id, db)
        if not RemoteControlRedis.is_bridge_online(session.desktop_instance_id, user_id):
            raise HTTPException(status_code=409, detail={"code": "BRIDGE_OFFLINE"})
        space = RemoteControlService._session_space(session, user_id, db)
        RemoteControlService._ensure_folder_space(space)
        RemoteControlService._ensure_project_in_session_space(session, user_id, project_id, db)
        out = RemoteControlService._enqueue_bridge_command(
            session,
            user_id,
            SPACE_APPLY_PROJECT_RUN,
            {
                "space_id": space.id,
                "project_id": project_id,
                "run_id": data.run_id,
                "paths": data.paths,
                "force_resolutions": [
                    item.model_dump(mode="json") for item in (data.force_resolutions or [])
                ],
            },
            db,
            target_project_id=project_id,
        )
        return RemoteControlFolderOperationOut(command_id=out.command_id, status=out.status)

    @staticmethod
    def enqueue_discard_project_overlays(
        session_id: str,
        user_id: int,
        project_id: str,
        data: RemoteControlFolderDiscardIn,
        db: Session,
    ) -> RemoteControlFolderOperationOut:
        if not data.confirm:
            raise HTTPException(status_code=400, detail={"code": "REMOTE_CONFIRM_REQUIRED"})
        session = RemoteControlService._owned_session(session_id, user_id, db)
        if not RemoteControlRedis.is_bridge_online(session.desktop_instance_id, user_id):
            raise HTTPException(status_code=409, detail={"code": "BRIDGE_OFFLINE"})
        space = RemoteControlService._session_space(session, user_id, db)
        RemoteControlService._ensure_folder_space(space)
        RemoteControlService._ensure_project_in_session_space(session, user_id, project_id, db)
        out = RemoteControlService._enqueue_bridge_command(
            session,
            user_id,
            SPACE_DISCARD_PROJECT_OVERLAYS,
            {
                "space_id": space.id,
                "project_id": project_id,
                "run_id": data.run_id,
                "paths": data.paths,
            },
            db,
            target_project_id=project_id,
        )
        return RemoteControlFolderOperationOut(command_id=out.command_id, status=out.status)

    @staticmethod
    def enqueue_refresh_project(
        session_id: str,
        user_id: int,
        project_id: str,
        data: RemoteControlFolderRefreshIn,
        db: Session,
    ) -> RemoteControlFolderOperationOut:
        session = RemoteControlService._owned_session(session_id, user_id, db)
        if not RemoteControlRedis.is_bridge_online(session.desktop_instance_id, user_id):
            raise HTTPException(status_code=409, detail={"code": "BRIDGE_OFFLINE"})
        space = RemoteControlService._session_space(session, user_id, db)
        RemoteControlService._ensure_folder_space(space)
        RemoteControlService._ensure_project_in_session_space(session, user_id, project_id, db)
        out = RemoteControlService._enqueue_bridge_command(
            session,
            user_id,
            SPACE_REFRESH_PROJECT,
            {"space_id": space.id, "project_id": project_id, "force": data.force},
            db,
            target_project_id=project_id,
        )
        return RemoteControlFolderOperationOut(command_id=out.command_id, status=out.status)

    @staticmethod
    def send_command(
        session_id: str,
        user_id: int,
        data: RemoteControlCommandIn,
        db: Session,
    ) -> RemoteControlCommandOut:
        session = RemoteControlService._owned_session(session_id, user_id, db)
        if not RemoteControlRedis.is_bridge_online(session.desktop_instance_id, user_id):
            raise HTTPException(status_code=409, detail={"code": "BRIDGE_OFFLINE"})
        session_space = RemoteControlService._session_space(session, user_id, db)

        normalized = {
            "space_id": data.space_id or session_space.id,
            "target_project_id": data.target_project_id,
            "target_task_id": data.target_task_id,
            "target_brain_session_id": data.target_brain_session_id,
            "type": data.type,
            "payload": dict(data.payload or {}),
        }
        if data.space_id and data.space_id != session_space.id:
            raise HTTPException(status_code=403, detail="Command is outside this remote Space")
        is_legacy_request = (
            normalized["target_project_id"] is None
            and normalized["target_task_id"] is None
            and normalized["target_brain_session_id"] is None
        )
        is_legacy_target = RemoteControlService._is_legacy_target_request(session, normalized)
        if is_legacy_target and is_legacy_request:
            normalized["target_project_id"] = session.project_id
            normalized["target_task_id"] = session.active_task_id
            normalized["target_brain_session_id"] = session.brain_session_id

        target_project_id = normalized["target_project_id"]
        target_task_id = normalized["target_task_id"]
        target_brain_session_id = normalized["target_brain_session_id"]
        command_type = normalized["type"]
        if not target_project_id:
            raise HTTPException(status_code=400, detail={"code": "REMOTE_TARGET_REQUIRED"})
        if command_type not in NON_BRAIN_COMMANDS and not target_brain_session_id:
            raise HTTPException(status_code=400, detail={"code": "REMOTE_BRAIN_SESSION_REQUIRED"})
        if (
            not is_legacy_target
            and target_brain_session_id
            and not str(target_brain_session_id).startswith("rc_brain_")
        ):
            raise HTTPException(status_code=400, detail={"code": "REMOTE_BRAIN_SESSION_FORMAT_INVALID"})
        if command_type == "remove_task" and not normalized["payload"].get("task_id"):
            raise HTTPException(status_code=400, detail={"code": "REMOTE_TASK_ID_REQUIRED"})

        RemoteControlService._ensure_project_in_session_space(session, user_id, target_project_id, db)
        RemoteControlService._ensure_target_owner(user_id, target_project_id, target_task_id, db)
        if command_type == SWITCH_PROJECT_VIEW:
            normalized["payload"] = RemoteControlService._enrich_switch_project_payload(
                user_id,
                target_project_id,
                normalized["payload"],
                db,
            )

        next_task_id = _id("task") if data.type == "user_message" else None
        command = RemoteControlCommand(
            id=_id("rc_cmd"),
            session_id=session.id,
            user_id=user_id,
            source_channel=data.source_channel,
            type=command_type,
            payload=normalized["payload"],
            space_id=normalized["space_id"],
            next_task_id=next_task_id,
            target_project_id=target_project_id,
            target_task_id=target_task_id,
            target_brain_session_id=target_brain_session_id,
            status=COMMAND_PENDING,
        )

        if next_task_id:
            try:
                history = RemoteControlService._create_history_for_command(
                    user_id,
                    normalized["space_id"],
                    target_project_id,
                    target_task_id,
                    data,
                    next_task_id,
                    db,
                )
                db.flush()
                normalized["payload"]["remote_history_id"] = history.id
                command.payload = normalized["payload"]
            except HTTPException:
                raise
        db.add(command)
        db.commit()
        db.refresh(command)
        RemoteControlService.record_event(
            session.id,
            "command_created",
            {
                "command_id": command.id,
                "type": command.type,
                "source_channel": command.source_channel,
                "next_task_id": command.next_task_id,
                "target_project_id": command.target_project_id,
                "target_task_id": command.target_task_id,
                "is_legacy_target": is_legacy_target,
            },
            db,
        )

        RemoteControlService.publish_command(session, command)
        return RemoteControlCommandOut(
            command_id=command.id,
            status=command.status,
            next_task_id=command.next_task_id,
        )

    @staticmethod
    def command_payload(session: RemoteControlSession, command: RemoteControlCommand) -> dict[str, Any]:
        project_id = command.target_project_id or session.current_project_id or session.project_id
        task_id = command.target_task_id or session.current_task_id or session.active_task_id
        brain_session_id = command.target_brain_session_id or session.current_brain_session_id or session.brain_session_id
        payload: dict[str, Any] = {
            "type": "remote_command",
            "command": {
                "id": command.id,
                "session_id": session.id,
                "user_id": session.user_id,
                "desktop_instance_id": session.desktop_instance_id,
                "space_id": command.space_id or session.space_id,
                "project_id": project_id,
                "active_task_id": task_id,
                "brain_session_id": brain_session_id,
                "target_project_id": command.target_project_id,
                "target_task_id": command.target_task_id,
                "target_brain_session_id": command.target_brain_session_id,
                "source_channel": command.source_channel,
                "type": command.type,
                "payload": command.payload,
            },
        }
        if command.next_task_id:
            payload["command"]["next_task_id"] = command.next_task_id
        return payload

    @staticmethod
    def publish_command(session: RemoteControlSession, command: RemoteControlCommand) -> bool:
        had_subscriber = RemoteControlRedis.publish(
            RemoteControlRedis.command_channel(session.desktop_instance_id),
            RemoteControlService.command_payload(session, command),
        )
        logger.info(
            "[RC-TRACE] command published",
            extra={
                "command_id": command.id,
                "type": command.type,
                "session_id": session.id,
                "desktop_instance_id": session.desktop_instance_id,
                "had_subscriber": had_subscriber,
            },
        )
        return had_subscriber

    @staticmethod
    def publish_status(session_id: str, event_type: str, payload: dict[str, Any]) -> bool:
        return RemoteControlRedis.publish(
            RemoteControlRedis.ack_channel(session_id),
            {"type": event_type, "session_id": session_id, **payload},
        )

    @staticmethod
    def mark_delivered(command_id: str, db: Session) -> RemoteControlCommand | None:
        command = db.get(RemoteControlCommand, command_id)
        if not command:
            return None
        if command.status == COMMAND_PENDING:
            command.status = COMMAND_DELIVERED
            command.delivered_at = _now()
            db.add(command)
            RemoteControlService.record_event(
                command.session_id,
                "command_delivered",
                {"command_id": command.id, "type": command.type},
                db,
                commit=False,
            )
            db.commit()
            db.refresh(command)
        RemoteControlService.publish_status(
            command.session_id,
            "command_status",
            {"command_id": command.id, "status": command.status},
        )
        return command

    @staticmethod
    def mark_ack(
        command_id: str,
        status: str,
        error_code: str | None,
        error: str | None,
        db: Session,
        result: dict[str, Any] | None = None,
    ) -> RemoteControlCommand | None:
        command = db.get(RemoteControlCommand, command_id)
        if not command:
            return None
        if command.status in {COMMAND_ACKNOWLEDGED, COMMAND_FAILED, COMMAND_EXPIRED}:
            RemoteControlService.publish_status(
                command.session_id,
                "command_status",
                {
                    "command_id": command.id,
                    "status": command.status,
                    "error_code": command.error_code,
                    "error": command.error,
                    "result": result,
                },
            )
            return command
        command.status = COMMAND_ACKNOWLEDGED if status == COMMAND_ACKNOWLEDGED else COMMAND_FAILED
        command.error_code = error_code
        command.error = error
        command.acknowledged_at = _now()
        restored_payload: dict[str, Any] = {}
        if command.type == SWITCH_PROJECT_VIEW and command.status == COMMAND_FAILED:
            restored_payload = RemoteControlService._restore_switch_target_if_current(command, db)
        db.add(command)
        RemoteControlService.record_event(
            command.session_id,
            "command_ack" if command.status == COMMAND_ACKNOWLEDGED else "command_error",
            {
                "command_id": command.id,
                "type": command.type,
                "status": command.status,
                "error_code": command.error_code,
                "error": command.error,
                "result": result,
            },
            db,
            commit=False,
        )
        db.commit()
        db.refresh(command)
        status_payload = {
            "command_id": command.id,
            "status": command.status,
            "error_code": command.error_code,
            "error": command.error,
            "result": result,
        }
        RemoteControlService.publish_status(command.session_id, "command_status", status_payload)
        if command.type == SWITCH_PROJECT_VIEW:
            target_payload = {
                "space_id": command.space_id,
                "current_project_id": command.target_project_id,
                "current_task_id": command.target_task_id,
                "current_brain_session_id": command.target_brain_session_id,
                "command_id": command.id,
            }
            if command.status == COMMAND_ACKNOWLEDGED:
                RemoteControlService.publish_status(
                    command.session_id,
                    "desktop_target_ready",
                    target_payload,
                )
            else:
                RemoteControlService.publish_status(
                    command.session_id,
                    "desktop_target_failed",
                    {
                        **target_payload,
                        "error_code": command.error_code,
                        "error": command.error,
                        **restored_payload,
                    },
                )
        return command

    @staticmethod
    def record_event(
        session_id: str,
        event_type: str,
        payload: dict[str, Any],
        db: Session,
        commit: bool = True,
    ) -> None:
        db.add(
            RemoteControlEvent(
                id=_id("rc_evt"),
                session_id=session_id,
                type=event_type,
                payload=payload,
            )
        )
        if commit:
            db.commit()

    @staticmethod
    def list_steps(
        session_id: str,
        user_id: int,
        project_id: str | None,
        since: int,
        limit: int,
        order: str,
        db: Session,
    ) -> RemoteControlStepsOut:
        session = RemoteControlService._owned_session(session_id, user_id, db)
        effective_project_id, _, _, _ = RemoteControlService._effective_target(session)
        target_project_id = project_id or effective_project_id
        if not target_project_id:
            raise HTTPException(status_code=400, detail={"code": "REMOTE_TARGET_REQUIRED"})
        RemoteControlService._ensure_project_in_session_space(session, user_id, target_project_id, db)
        limit = min(max(limit, 1), 1000)
        histories = db.exec(
            select(ChatHistory).where(
                ChatHistory.user_id == user_id,
                ChatHistory.project_id == target_project_id,
            )
            .order_by(ChatHistory.created_at.asc(), ChatHistory.id.asc())
        ).all()
        task_ids = [history.task_id for history in histories if history.task_id]
        if not task_ids:
            legacy_history = RemoteControlService._find_task_history(user_id, target_project_id, db)
            if legacy_history:
                task_ids = [legacy_history.task_id]
        if not task_ids:
            return RemoteControlStepsOut(items=[], has_more=False, next_since=since)
        stmt = select(ChatStep).where(ChatStep.task_id.in_(task_ids), ChatStep.id > since)
        stmt = stmt.order_by(ChatStep.id.desc() if order == "desc" else ChatStep.id.asc()).limit(limit + 1)
        rows = list(db.exec(stmt).all())
        has_more = len(rows) > limit
        rows = rows[:limit]
        if order == "desc":
            rows = list(reversed(rows))
        project_by_task = {task_id: target_project_id for task_id in task_ids}
        items = [
            RemoteControlStepOut(
                step_id=row.id,
                task_id=row.task_id,
                project_id=project_by_task.get(row.task_id),
                step=row.step,
                data=row.data,
                timestamp=row.timestamp,
            )
            for row in rows
        ]
        next_since = items[-1].step_id if items else since
        return RemoteControlStepsOut(items=items, has_more=has_more, next_since=next_since)

    @staticmethod
    def publish_chat_step(step: ChatStep, db: Session) -> None:
        history = db.exec(select(ChatHistory).where(ChatHistory.task_id == step.task_id)).first()
        if not history:
            logger.warning("Skipping remote-control step publish for orphan step", extra={"task_id": step.task_id})
            return
        project_id = history.project_id or history.task_id
        RemoteControlRedis.publish(
            RemoteControlRedis.step_channel(project_id),
            {
                "type": "step",
                "project_id": project_id,
                "task_id": step.task_id,
                "step_id": step.id,
                "step": step.step,
                "data": step.data,
                "timestamp": step.timestamp,
            },
        )

    @staticmethod
    def retry_pending_commands(db: Session) -> None:
        cutoff = _now() - timedelta(seconds=30)
        commands = db.exec(
            select(RemoteControlCommand).where(
                RemoteControlCommand.status == COMMAND_PENDING,
                RemoteControlCommand.created_at < cutoff,
            )
        ).all()
        for command in commands:
            session = db.get(RemoteControlSession, command.session_id)
            if not session or session.status != SESSION_ACTIVE:
                continue
            if not RemoteControlRedis.is_bridge_online(session.desktop_instance_id, session.user_id):
                logger.warning(
                    "[RC-TRACE] pending command waiting, bridge offline",
                    extra={
                        "command_id": command.id,
                        "session_id": command.session_id,
                        "age_seconds": (_now() - command.created_at).total_seconds(),
                    },
                )
                continue
            logger.warning(
                "[RC-TRACE] re-publishing stuck pending command",
                extra={
                    "command_id": command.id,
                    "session_id": command.session_id,
                    "age_seconds": (_now() - command.created_at).total_seconds(),
                },
            )
            RemoteControlService.publish_command(session, command)

    @staticmethod
    def expire_timed_out_commands(db: Session) -> None:
        now = _now()
        delivered_cutoff = now - timedelta(
            seconds=min(COMMAND_ACK_TIMEOUT_SECONDS, SWITCH_PROJECT_VIEW_ACK_TIMEOUT_SECONDS)
        )
        pending_cutoff = now - timedelta(
            seconds=min(COMMAND_ACK_TIMEOUT_SECONDS, SWITCH_PROJECT_VIEW_ACK_TIMEOUT_SECONDS)
        )
        commands = list(
            db.exec(
                select(RemoteControlCommand).where(
                    RemoteControlCommand.status == COMMAND_DELIVERED,
                    RemoteControlCommand.delivered_at < delivered_cutoff,
                )
            ).all()
        )
        commands.extend(
            db.exec(
                select(RemoteControlCommand).where(
                    RemoteControlCommand.status == COMMAND_PENDING,
                    RemoteControlCommand.created_at < pending_cutoff,
                )
            ).all()
        )

        seen_command_ids: set[str] = set()
        for command in commands:
            if command.id in seen_command_ids:
                continue
            seen_command_ids.add(command.id)

            timeout_seconds = (
                SWITCH_PROJECT_VIEW_ACK_TIMEOUT_SECONDS
                if command.type == SWITCH_PROJECT_VIEW
                else COMMAND_ACK_TIMEOUT_SECONDS
            )
            if command.status == COMMAND_PENDING:
                if command.created_at >= now - timedelta(seconds=timeout_seconds):
                    continue
                error_code = "PENDING_TIMEOUT"
                error_message = "Remote command was not delivered before timeout"
            else:
                if not command.delivered_at or command.delivered_at >= now - timedelta(seconds=timeout_seconds):
                    continue
                error_code = "BRIDGE_TIMEOUT"
                error_message = "Remote command delivery timed out"
            command.status = COMMAND_FAILED
            command.error_code = error_code
            command.error = error_message
            command.acknowledged_at = _now()
            restored_payload: dict[str, Any] = {}
            if command.type == SWITCH_PROJECT_VIEW:
                restored_payload = RemoteControlService._restore_switch_target_if_current(command, db)
            db.add(command)
            RemoteControlService.record_event(
                command.session_id,
                "command_error",
                {
                    "command_id": command.id,
                    "type": command.type,
                    "status": command.status,
                    "error_code": command.error_code,
                    "error": command.error,
                },
                db,
                commit=False,
            )
            RemoteControlService.publish_status(
                command.session_id,
                "command_status",
                {
                    "command_id": command.id,
                    "status": command.status,
                    "error_code": command.error_code,
                    "error": command.error,
                },
            )
            if command.type == SWITCH_PROJECT_VIEW:
                RemoteControlService.publish_status(
                    command.session_id,
                    "desktop_target_failed",
                    {
                        "space_id": command.space_id,
                        "current_project_id": command.target_project_id,
                        "current_task_id": command.target_task_id,
                        "current_brain_session_id": command.target_brain_session_id,
                        "command_id": command.id,
                        "error_code": command.error_code,
                        "error": command.error,
                        **restored_payload,
                    },
                )
        db.commit()

    @staticmethod
    def expire_stale_bridges(db: Session) -> None:
        sessions = db.exec(
            select(RemoteControlSession).where(
                RemoteControlSession.status == SESSION_ACTIVE,
                RemoteControlSession.bridge_status == "online",
            )
        ).all()
        for session in sessions:
            if RemoteControlRedis.is_bridge_online(session.desktop_instance_id, session.user_id):
                continue
            session.bridge_status = "offline"
            db.add(session)
            RemoteControlService.record_event(
                session.id,
                "bridge_offline",
                {
                    "desktop_instance_id": session.desktop_instance_id,
                    "last_seen_at": _utc_iso(session.last_bridge_seen_at),
                    "reason": "ttl_expired",
                },
                db,
                commit=False,
            )
            RemoteControlService.publish_status(
                session.id,
                "bridge_status",
                {
                    "status": "offline",
                    "last_seen_at": _utc_iso(session.last_bridge_seen_at),
                    "message": "Desktop is offline",
                },
            )
        db.commit()
