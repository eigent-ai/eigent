from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.domains.remote_control.schema import (
    CommandEventAckOut,
    CommandEventIn,
    CommandEventsIn,
    CommandEventsOut,
    CommandStateEventOut,
    CommandStateOut,
    ConfirmCommandReceiptIn,
    ConfirmCommandReceiptOut,
    DeviceRegistrationIn,
    DeviceRegistrationOut,
    PendingCommandOut,
    PendingCommandsOut,
    ProjectRouteOut,
)
from app.model.project.project import Project
from app.model.remote_control import (
    DesktopDevice,
    ProjectExecutionRoute,
    RemoteCommandLifecycleEvent,
    RemoteCommandNotificationOutbox,
    RemoteCommandState,
    RemoteControlCommand,
    RemoteControlSession,
)

COMMAND_TTL = timedelta(minutes=5)
RECEIPT_GRACE = timedelta(seconds=30)
DELIVERY_LEASE = timedelta(seconds=30)
HIGH_RISK_COMMAND_TYPES = {
    "interaction_decision",
    "stop",
    "stop_task",
    "remove_task",
    "apply_project",
    "discard_project_overlays",
    "space_apply_project_run",
    "space_discard_project_overlays",
}
DESKTOP_EVENT_TYPES = {
    "receipt.durably_received",
    "admission.accepted",
    "admission.rejected",
    "execution.started",
    "execution.completed",
    "execution.failed",
}


def _now() -> datetime:
    return datetime.now(UTC)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _conflict(code: str, message: str, **context: object) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": code, "message": message, **context},
    )


class CommandControlService:
    """Self-hosted durable command plane; callers own transactions."""

    @staticmethod
    def register_device(
        device_id: str,
        user_id: int,
        body: DeviceRegistrationIn,
        db: Session,
    ) -> DeviceRegistrationOut:
        now = _now()
        device = db.get(DesktopDevice, device_id)
        if device is None:
            candidate = DesktopDevice(
                id=device_id,
                user_id=user_id,
                install_public_key=body.install_public_key,
                app_version=body.app_version,
                capabilities=body.capabilities,
                last_seen_at=now,
                created_at=now,
                updated_at=now,
            )
            try:
                with db.begin_nested():
                    db.add(candidate)
                    db.flush()
                device = candidate
            except IntegrityError:
                device = db.get(DesktopDevice, device_id)
                if device is None:
                    raise
        if device.user_id != user_id:
            raise _conflict(
                "device_owner_mismatch",
                "Desktop device belongs to another user",
            )
        if device.revoked_at is not None:
            raise HTTPException(status_code=403, detail={"code": "device_revoked"})
        if body.install_public_key:
            if device.install_public_key and device.install_public_key != body.install_public_key:
                raise _conflict(
                    "install_key_mismatch",
                    "Device install key requires explicit credential rotation",
                )
            device.install_public_key = body.install_public_key
        device.app_version = body.app_version or device.app_version
        device.capabilities = body.capabilities
        device.last_seen_at = now
        device.updated_at = now
        db.add(device)
        db.flush()
        return DeviceRegistrationOut(
            device_id=device.id,
            account_owner_id=str(user_id),
            credential_version=device.credential_version,
            registered_at=device.created_at,
        )

    @staticmethod
    def require_device(device_id: str, user_id: int, db: Session) -> DesktopDevice:
        device = db.get(DesktopDevice, device_id)
        if device is None:
            raise HTTPException(
                status_code=401,
                detail={"code": "device_not_registered"},
            )
        if device.user_id != user_id:
            raise HTTPException(status_code=403, detail={"code": "device_owner_mismatch"})
        if device.revoked_at is not None:
            raise HTTPException(status_code=403, detail={"code": "device_revoked"})
        return device

    @staticmethod
    def _require_project_owner(project_id: str, user_id: int, db: Session) -> Project:
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        if str(project.user_id) != str(user_id):
            raise HTTPException(
                status_code=403,
                detail="Project does not belong to this user",
            )
        return project

    @staticmethod
    def claim_project_route(
        project_id: str,
        device_id: str,
        user_id: int,
        expected_route_version: int | None,
        db: Session,
    ) -> ProjectRouteOut:
        CommandControlService.require_device(device_id, user_id, db)
        CommandControlService._require_project_owner(project_id, user_id, db)
        route = db.exec(
            select(ProjectExecutionRoute).where(ProjectExecutionRoute.project_id == project_id).with_for_update()
        ).one_or_none()
        now = _now()
        if route is None:
            if expected_route_version is not None:
                raise _conflict(
                    "route_version_conflict",
                    "Project has no execution route",
                    current_route_version=None,
                )
            candidate = ProjectExecutionRoute(
                project_id=project_id,
                user_id=user_id,
                target_device_id=device_id,
                route_version=1,
                created_at=now,
                updated_at=now,
            )
            try:
                with db.begin_nested():
                    db.add(candidate)
                    db.flush()
                route = candidate
            except IntegrityError:
                route = db.get(ProjectExecutionRoute, project_id)
                if route is None:
                    raise
                if route.user_id != user_id:
                    raise _conflict(
                        "route_owner_mismatch",
                        "Project route belongs to another user",
                    )
                if route.target_device_id != device_id:
                    raise _conflict(
                        "route_version_conflict",
                        "Project route was concurrently claimed",
                        current_route_version=route.route_version,
                        target_device_id=route.target_device_id,
                    )
        elif route.user_id != user_id:
            raise _conflict(
                "route_owner_mismatch",
                "Project route belongs to another user",
            )
        elif route.target_device_id != device_id:
            if expected_route_version != route.route_version:
                raise _conflict(
                    "route_version_conflict",
                    "Route transfer requires the current route version",
                    current_route_version=route.route_version,
                    target_device_id=route.target_device_id,
                )
            route.target_device_id = device_id
            route.route_version += 1
            route.updated_at = now
        db.add(route)
        db.flush()
        return ProjectRouteOut(
            project_id=route.project_id,
            target_device_id=route.target_device_id,
            route_version=route.route_version,
        )

    @staticmethod
    def _append_server_event(
        state: RemoteCommandState,
        event_type: str,
        payload: dict,
        db: Session,
        *,
        occurred_at: datetime | None = None,
    ) -> RemoteCommandLifecycleEvent:
        state.server_recorded_version += 1
        event = RemoteCommandLifecycleEvent(
            id=_id("rcse"),
            command_id=state.command_id,
            producer="server",
            server_recorded_version=state.server_recorded_version,
            event_type=event_type,
            payload=payload,
            occurred_at=occurred_at or _now(),
        )
        db.add(event)
        db.flush()
        db.add(
            RemoteCommandNotificationOutbox(
                event_id=event.id,
                command_id=state.command_id,
                session_id=state.session_id,
            )
        )
        return event

    @staticmethod
    def create_state_for_command(
        command: RemoteControlCommand,
        rc_session: RemoteControlSession,
        db: Session,
    ) -> RemoteCommandState:
        existing = db.get(RemoteCommandState, command.id)
        if existing is not None:
            return existing
        project_id = command.target_project_id or rc_session.current_project_id or rc_session.project_id
        if not project_id:
            raise HTTPException(status_code=400, detail={"code": "REMOTE_TARGET_REQUIRED"})
        route = db.get(ProjectExecutionRoute, project_id)
        if route is None:
            device = CommandControlService.require_device(rc_session.desktop_instance_id, command.user_id, db)
            route_out = CommandControlService.claim_project_route(
                project_id,
                device.id,
                command.user_id,
                expected_route_version=None,
                db=db,
            )
            route = db.get(ProjectExecutionRoute, route_out.project_id)
        if route is None or route.user_id != command.user_id:
            raise _conflict(
                "route_owner_mismatch",
                "Project execution route is invalid",
            )
        if route.target_device_id != rc_session.desktop_instance_id:
            raise _conflict(
                "project_routed_to_another_device",
                "Remote session is not attached to the execution owner",
                target_device_id=route.target_device_id,
                route_version=route.route_version,
            )
        now = _now()
        expires_at = min(_utc(rc_session.expires_at), now + COMMAND_TTL)
        state = RemoteCommandState(
            command_id=command.id,
            session_id=command.session_id,
            user_id=command.user_id,
            project_id=project_id,
            run_id=command.target_task_id,
            route_device_id=route.target_device_id,
            route_version=route.route_version,
            expires_at=expires_at,
            receipt_grace_until=expires_at + RECEIPT_GRACE,
            next_delivery_attempt_at=now,
            created_at=now,
            updated_at=now,
        )
        try:
            with db.begin_nested():
                db.add(state)
                db.flush()
        except IntegrityError:
            winner = db.get(RemoteCommandState, command.id)
            if winner is None:
                raise
            if (
                winner.user_id != command.user_id
                or winner.session_id != command.session_id
                or winner.project_id != project_id
                or winner.route_device_id != route.target_device_id
                or winner.route_version != route.route_version
            ):
                raise _conflict(
                    "command_state_conflict",
                    "Concurrent command state has different ownership",
                )
            return winner
        CommandControlService._append_server_event(
            state,
            "command.pending",
            {
                "route_device_id": route.target_device_id,
                "route_version": route.route_version,
            },
            db,
            occurred_at=now,
        )
        db.flush()
        return state

    @staticmethod
    def claim_pending_commands(
        device_id: str,
        user_id: int,
        limit: int,
        db: Session,
    ) -> PendingCommandsOut:
        CommandControlService.require_device(device_id, user_id, db)
        now = _now()
        rows = list(
            db.exec(
                select(RemoteCommandState)
                .where(
                    RemoteCommandState.user_id == user_id,
                    RemoteCommandState.route_device_id == device_id,
                    RemoteCommandState.receipt_state == "pending",
                    RemoteCommandState.expires_at >= now,
                    RemoteCommandState.next_delivery_attempt_at <= now,
                    or_(
                        RemoteCommandState.lease_until.is_(None),
                        RemoteCommandState.lease_until < now,
                    ),
                )
                .order_by(
                    RemoteCommandState.created_at,
                    RemoteCommandState.command_id,
                )
                .limit(limit)
                .with_for_update(skip_locked=True)
            ).all()
        )
        items: list[PendingCommandOut] = []
        for state in rows:
            command = db.get(RemoteControlCommand, state.command_id)
            if command is None:
                state.integrity_alert = "missing_remote_control_command"
                state.updated_at = now
                db.add(state)
                continue
            state.delivery_attempt_count += 1
            state.delivery_lease_owner = device_id
            state.lease_token = uuid4().hex
            state.lease_until = min(_utc(state.expires_at), now + DELIVERY_LEASE)
            state.next_delivery_attempt_at = state.lease_until
            state.updated_at = now
            CommandControlService._append_server_event(
                state,
                "delivery.leased",
                {
                    "attempt": state.delivery_attempt_count,
                    "lease_until": state.lease_until.isoformat(),
                },
                db,
                occurred_at=now,
            )
            db.add(state)
            items.append(
                PendingCommandOut(
                    command_id=command.id,
                    session_id=command.session_id,
                    user_id=command.user_id,
                    project_id=state.project_id,
                    run_id=state.run_id,
                    route_version=state.route_version,
                    command_type=command.type,
                    payload=command.payload,
                    space_id=command.space_id,
                    target_brain_session_id=command.target_brain_session_id,
                    source_channel=command.source_channel,
                    next_task_id=command.next_task_id,
                    expires_at=state.expires_at,
                    receipt_grace_until=state.receipt_grace_until,
                    requires_online_receipt_confirmation=(command.type in HIGH_RISK_COMMAND_TYPES),
                    lease_token=state.lease_token,
                )
            )
        db.flush()
        return PendingCommandsOut(items=items)

    @staticmethod
    def lease_command_for_delivery(
        command_id: str,
        device_id: str,
        user_id: int,
        db: Session,
    ) -> RemoteCommandState:
        CommandControlService.require_device(device_id, user_id, db)
        state = db.exec(
            select(RemoteCommandState).where(RemoteCommandState.command_id == command_id).with_for_update()
        ).one_or_none()
        if state is None:
            raise HTTPException(status_code=404, detail="Command not found")
        if state.user_id != user_id or state.route_device_id != device_id:
            raise HTTPException(
                status_code=403,
                detail={"code": "command_device_mismatch"},
            )
        now = _now()
        if state.receipt_state != "pending" or _utc(state.expires_at) < now:
            return state
        if (
            state.lease_token
            and state.delivery_lease_owner == device_id
            and state.lease_until is not None
            and _utc(state.lease_until) >= now
        ):
            return state
        state.delivery_attempt_count += 1
        state.delivery_lease_owner = device_id
        state.lease_token = uuid4().hex
        state.lease_until = min(_utc(state.expires_at), now + DELIVERY_LEASE)
        state.next_delivery_attempt_at = state.lease_until
        state.updated_at = now
        CommandControlService._append_server_event(
            state,
            "delivery.leased",
            {
                "attempt": state.delivery_attempt_count,
                "lease_until": state.lease_until.isoformat(),
            },
            db,
            occurred_at=now,
        )
        db.add(state)
        db.flush()
        return state

    @staticmethod
    def _lock_owned_state(
        command_id: str,
        device_id: str,
        user_id: int,
        db: Session,
    ) -> RemoteCommandState:
        state = db.exec(
            select(RemoteCommandState).where(RemoteCommandState.command_id == command_id).with_for_update()
        ).one_or_none()
        if state is None:
            raise HTTPException(status_code=404, detail="Command not found")
        if state.user_id != user_id or state.route_device_id != device_id:
            raise HTTPException(
                status_code=403,
                detail={"code": "command_device_mismatch"},
            )
        return state

    @staticmethod
    def _require_current_delivery_lease(
        state: RemoteCommandState,
        *,
        device_id: str,
        lease_token: str | None,
        now: datetime,
    ) -> None:
        if state.receipt_state != "pending":
            return
        if (
            not lease_token
            or state.delivery_lease_owner != device_id
            or state.lease_token != lease_token
            or state.lease_until is None
            or (_utc(state.lease_until) < now and now <= _utc(state.receipt_grace_until))
        ):
            raise _conflict(
                "stale_command_delivery_lease",
                "Command receipt does not own the current delivery lease",
            )

    @staticmethod
    def _same_desktop_event(
        existing: RemoteCommandLifecycleEvent,
        event: CommandEventIn,
    ) -> bool:
        return (
            existing.desktop_event_sequence == event.desktop_event_sequence
            and existing.event_type == event.event_type
            and existing.payload == event.payload
            and _utc(existing.occurred_at) == _utc(event.occurred_at)
        )

    @staticmethod
    def _insert_desktop_event(
        state: RemoteCommandState,
        event: CommandEventIn,
        db: Session,
    ) -> RemoteCommandLifecycleEvent:
        row = RemoteCommandLifecycleEvent(
            id=event.event_id,
            command_id=state.command_id,
            producer="desktop",
            desktop_event_sequence=event.desktop_event_sequence,
            event_type=event.event_type,
            payload=event.payload,
            occurred_at=_utc(event.occurred_at),
        )
        db.add(row)
        db.flush()
        db.add(
            RemoteCommandNotificationOutbox(
                event_id=row.id,
                command_id=state.command_id,
                session_id=state.session_id,
            )
        )
        return row

    @staticmethod
    def _mark_legacy_command_expired(command_id: str, db: Session) -> None:
        command = db.get(RemoteControlCommand, command_id)
        if command is not None and command.status in {"pending", "delivered"}:
            command.status = "expired"
            command.error_code = "COMMAND_EXPIRED"
            command.error = "Remote command expired before durable receipt"
            db.add(command)

    @staticmethod
    def _expire_pending_receipt(
        state: RemoteCommandState,
        db: Session,
        *,
        now: datetime,
        reason: str,
        integrity_alert: str | None = None,
    ) -> bool:
        if state.receipt_state != "pending":
            if state.receipt_state == "expired":
                CommandControlService._mark_legacy_command_expired(state.command_id, db)
            return False
        state.receipt_state = "expired"
        state.expired_at = now
        state.delivery_lease_owner = None
        state.lease_token = None
        state.lease_until = None
        state.updated_at = now
        if integrity_alert:
            state.integrity_alert = state.integrity_alert or integrity_alert
        CommandControlService._append_server_event(
            state,
            "receipt.expired",
            {"reason": reason},
            db,
            occurred_at=now,
        )
        CommandControlService._mark_legacy_command_expired(state.command_id, db)
        db.add(state)
        return True

    @staticmethod
    def confirm_receipt(
        command_id: str,
        device_id: str,
        user_id: int,
        body: ConfirmCommandReceiptIn,
        db: Session,
    ) -> ConfirmCommandReceiptOut:
        CommandControlService.require_device(device_id, user_id, db)
        state = CommandControlService._lock_owned_state(command_id, device_id, user_id, db)
        event = CommandEventIn(
            event_id=body.event_id,
            desktop_event_sequence=body.desktop_event_sequence,
            event_type="receipt.durably_received",
            occurred_at=body.occurred_at,
        )
        existing = db.get(RemoteCommandLifecycleEvent, body.event_id)
        if existing is not None:
            if existing.command_id != command_id or not CommandControlService._same_desktop_event(existing, event):
                raise _conflict(
                    "command_event_id_conflict",
                    "event_id has different canonical content",
                )
            result = "expired_late" if state.receipt_state == "expired" else "already_received"
            return ConfirmCommandReceiptOut(
                result=result,
                command_id=command_id,
                receipt_state=state.receipt_state,
                expected_next_desktop_event_sequence=(state.expected_next_desktop_event_sequence),
                may_execute=state.receipt_state == "durably_received",
            )
        if body.desktop_event_sequence != state.expected_next_desktop_event_sequence:
            raise _conflict(
                "command_sequence_gap",
                "Receipt is not the next Desktop command event",
                expected_next_desktop_event_sequence=(state.expected_next_desktop_event_sequence),
            )
        if state.receipt_state == "durably_received":
            raise _conflict(
                "duplicate_receipt_event",
                "Receipt was already confirmed with another event_id",
            )
        now = _now()
        CommandControlService._require_current_delivery_lease(
            state,
            device_id=device_id,
            lease_token=body.lease_token,
            now=now,
        )
        CommandControlService._insert_desktop_event(state, event, db)
        state.expected_next_desktop_event_sequence += 1
        state.delivery_lease_owner = None
        state.lease_token = None
        state.lease_until = None
        if state.receipt_state == "expired" or now > _utc(state.receipt_grace_until):
            CommandControlService._expire_pending_receipt(
                state,
                db,
                now=now,
                reason="durable_receipt_after_grace",
                integrity_alert="durable_receipt_after_grace",
            )
            state.late_result = True
            result = "expired_late"
            may_execute = False
        else:
            state.receipt_state = "durably_received"
            state.durably_received_at = now
            result = "confirmed"
            may_execute = True
        state.updated_at = now
        db.add(state)
        db.flush()
        return ConfirmCommandReceiptOut(
            result=result,
            command_id=command_id,
            receipt_state=state.receipt_state,
            expected_next_desktop_event_sequence=(state.expected_next_desktop_event_sequence),
            may_execute=may_execute,
        )

    @staticmethod
    def _project_event(
        state: RemoteCommandState,
        event: CommandEventIn,
        now: datetime,
        db: Session,
    ) -> None:
        event_type = event.event_type
        if event_type == "receipt.durably_received":
            if state.receipt_state == "pending" and now <= _utc(state.receipt_grace_until):
                state.receipt_state = "durably_received"
                state.durably_received_at = now
            elif state.receipt_state == "pending":
                CommandControlService._expire_pending_receipt(
                    state,
                    db,
                    now=now,
                    reason="durable_receipt_after_grace",
                    integrity_alert="durable_receipt_after_grace",
                )
                state.late_result = True
            elif state.receipt_state == "expired":
                state.late_result = True
        elif event_type == "admission.accepted":
            if state.admission_state == "unknown":
                state.admission_state = "accepted"
                state.admitted_at = now
            elif state.admission_state != "accepted":
                state.integrity_alert = "contradictory_admission_result"
        elif event_type == "admission.rejected":
            if state.admission_state == "unknown":
                state.admission_state = "rejected"
                state.admitted_at = now
            elif state.admission_state != "rejected":
                state.integrity_alert = "contradictory_admission_result"
        elif event_type == "execution.started":
            if state.execution_state == "not_started":
                state.execution_state = "running"
            elif state.execution_state not in {
                "running",
                "completed",
                "failed",
            }:
                state.integrity_alert = "invalid_execution_transition"
        elif event_type in {"execution.completed", "execution.failed"}:
            target = "completed" if event_type.endswith("completed") else "failed"
            if state.execution_state in {"not_started", "running"}:
                state.execution_state = target
                state.completed_at = now
            elif state.execution_state != target:
                state.integrity_alert = "contradictory_execution_result"
            if (
                event_type == "execution.failed"
                and event.payload.get("error_code") == "COMMAND_OUTCOME_UNKNOWN_AFTER_RESTART"
            ):
                state.actual_execution_state = "outcome_unknown"

        if event_type.startswith("execution.") and state.admission_state != "accepted":
            state.integrity_alert = state.integrity_alert or "execution_without_accepted_admission"
        if state.receipt_state == "expired" and event_type != "receipt.durably_received":
            state.late_result = True
            if event_type.startswith("execution."):
                state.actual_execution_state = {
                    "execution.started": "running",
                    "execution.completed": "completed",
                    "execution.failed": "failed",
                }[event_type]

    @staticmethod
    def ingest_command_events(
        command_id: str,
        device_id: str,
        user_id: int,
        body: CommandEventsIn,
        db: Session,
    ) -> CommandEventsOut:
        CommandControlService.require_device(device_id, user_id, db)
        state = CommandControlService._lock_owned_state(command_id, device_id, user_id, db)
        results: list[CommandEventAckOut] = []
        inserted_new = False
        for event in body.events:
            if event.event_type not in DESKTOP_EVENT_TYPES:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "unsupported_command_event_type"},
                )
            existing = db.get(RemoteCommandLifecycleEvent, event.event_id)
            if existing is not None:
                if inserted_new:
                    raise _conflict(
                        "duplicate_after_new_command_event",
                        "A retried prefix may not follow newly inserted events",
                    )
                if existing.command_id != command_id or not CommandControlService._same_desktop_event(existing, event):
                    raise _conflict(
                        "command_event_id_conflict",
                        "event_id has different canonical content",
                    )
                results.append(
                    CommandEventAckOut(
                        event_id=event.event_id,
                        desktop_event_sequence=event.desktop_event_sequence,
                        inserted=False,
                    )
                )
                continue
            if event.desktop_event_sequence != state.expected_next_desktop_event_sequence:
                raise _conflict(
                    "command_sequence_gap",
                    "Command event is not the next Desktop sequence",
                    expected_next_desktop_event_sequence=(state.expected_next_desktop_event_sequence),
                    first_failed_event_id=event.event_id,
                )
            if event.event_type == "receipt.durably_received":
                CommandControlService._require_current_delivery_lease(
                    state,
                    device_id=device_id,
                    lease_token=body.delivery_lease_token,
                    now=_now(),
                )
            CommandControlService._insert_desktop_event(state, event, db)
            state.expected_next_desktop_event_sequence += 1
            now = _now()
            CommandControlService._project_event(state, event, now, db)
            state.updated_at = now
            db.add(state)
            inserted_new = True
            results.append(
                CommandEventAckOut(
                    event_id=event.event_id,
                    desktop_event_sequence=event.desktop_event_sequence,
                    inserted=True,
                )
            )
        db.flush()
        return CommandEventsOut(
            command_id=command_id,
            expected_next_desktop_event_sequence=(state.expected_next_desktop_event_sequence),
            receipt_state=state.receipt_state,
            admission_state=state.admission_state,
            execution_state=state.execution_state,
            late_result=state.late_result,
            items=results,
        )

    @staticmethod
    def expire_pending_commands(db: Session, *, limit: int = 200) -> int:
        now = _now()
        states = list(
            db.exec(
                select(RemoteCommandState)
                .where(
                    RemoteCommandState.receipt_state == "pending",
                    RemoteCommandState.receipt_grace_until < now,
                    or_(
                        RemoteCommandState.lease_until.is_(None),
                        RemoteCommandState.lease_until < now,
                    ),
                )
                .order_by(RemoteCommandState.receipt_grace_until)
                .limit(limit)
                .with_for_update(skip_locked=True)
            ).all()
        )
        for state in states:
            CommandControlService._expire_pending_receipt(
                state,
                db,
                now=now,
                reason="receipt_grace_elapsed",
            )
        db.flush()
        return len(states)

    @staticmethod
    def get_command_state(command_id: str, user_id: int, db: Session) -> CommandStateOut:
        state = db.get(RemoteCommandState, command_id)
        if state is None:
            raise HTTPException(status_code=404, detail="Command not found")
        if state.user_id != user_id:
            raise HTTPException(
                status_code=403,
                detail="Command does not belong to this user",
            )
        rows = list(
            db.exec(
                select(RemoteCommandLifecycleEvent)
                .where(RemoteCommandLifecycleEvent.command_id == command_id)
                .order_by(
                    RemoteCommandLifecycleEvent.created_at,
                    RemoteCommandLifecycleEvent.id,
                )
            ).all()
        )
        return CommandStateOut(
            command_id=state.command_id,
            project_id=state.project_id,
            run_id=state.run_id,
            route_device_id=state.route_device_id,
            route_version=state.route_version,
            receipt_state=state.receipt_state,
            admission_state=state.admission_state,
            execution_state=state.execution_state,
            actual_execution_state=state.actual_execution_state,
            late_result=state.late_result,
            integrity_alert=state.integrity_alert,
            expires_at=state.expires_at,
            receipt_grace_until=state.receipt_grace_until,
            events=[
                CommandStateEventOut(
                    event_id=row.id,
                    producer=row.producer,
                    desktop_event_sequence=row.desktop_event_sequence,
                    server_recorded_version=row.server_recorded_version,
                    cloud_recorded_version=row.server_recorded_version,
                    event_type=row.event_type,
                    payload=row.payload,
                    occurred_at=row.occurred_at,
                )
                for row in rows
            ],
        )
