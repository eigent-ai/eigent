from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

os.environ.setdefault("database_url", "sqlite:///test.db")
os.environ.setdefault("secret_key", "test-secret")
os.environ.setdefault("redis_url", "redis://localhost:6379/0")
os.environ.setdefault("celery_broker_url", "redis://localhost:6379/0")
os.environ.setdefault("celery_result_url", "redis://localhost:6379/0")

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, select

from app.domains.remote_control.schema import (
    CommandEventIn,
    CommandEventsIn,
    ConfirmCommandReceiptIn,
    DeviceRegistrationIn,
    RemoteControlCommandIn,
)
from app.domains.remote_control.service.command_control_service import (
    HIGH_RISK_COMMAND_TYPES,
    CommandControlService,
)
from app.domains.remote_control.service.remote_control_service import (
    RemoteControlRedis,
    RemoteControlService,
)
from app.model.chat.chat_history import ChatHistory
from app.model.project import Project
from app.model.remote_control import (
    DesktopDevice,
    ProjectExecutionRoute,
    RemoteCommandLifecycleEvent,
    RemoteCommandNotificationOutbox,
    RemoteCommandState,
    RemoteControlCommand,
    RemoteControlSession,
)
from app.model.space import Space


@pytest.fixture()
def engine():
    db_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(
        db_engine,
        tables=[
            Space.__table__,
            Project.__table__,
            ChatHistory.__table__,
            DesktopDevice.__table__,
            ProjectExecutionRoute.__table__,
            RemoteControlSession.__table__,
            RemoteControlCommand.__table__,
            RemoteCommandState.__table__,
            RemoteCommandLifecycleEvent.__table__,
            RemoteCommandNotificationOutbox.__table__,
        ],
    )
    now = datetime.now(UTC)
    with Session(db_engine) as db:
        db.add(Space(id="space-1", user_id="7", name="Space"))
        db.flush()
        db.add(
            Project(
                id="project-1",
                user_id="7",
                space_id="space-1",
                name="Project",
            )
        )
        db.flush()
        db.add(
            RemoteControlSession(
                id="session-1",
                user_id=7,
                desktop_instance_id="device-1",
                space_id="space-1",
                project_id="project-1",
                current_project_id="project-1",
                current_brain_session_id="rc_brain_1",
                expires_at=now + timedelta(minutes=10),
            )
        )
        db.flush()
        CommandControlService.register_device(
            "device-1",
            7,
            DeviceRegistrationIn(app_version="1.0"),
            db,
        )
        CommandControlService.claim_project_route("project-1", "device-1", 7, None, db)
        db.commit()
    return db_engine


def _create_command_state(engine) -> None:
    with Session(engine) as db:
        command = RemoteControlCommand(
            id="command-1",
            session_id="session-1",
            user_id=7,
            type="user_message",
            payload={"content": "hello"},
            target_project_id="project-1",
        )
        db.add(command)
        db.flush()
        CommandControlService.create_state_for_command(
            command,
            db.get(RemoteControlSession, "session-1"),
            db,
        )
        db.commit()


def _receipt(lease_token: str) -> ConfirmCommandReceiptIn:
    return ConfirmCommandReceiptIn(
        event_id="receipt-1",
        desktop_event_sequence=1,
        occurred_at=datetime.now(UTC),
        lease_token=lease_token,
    )


def _event(event_id: str, sequence: int, event_type: str) -> CommandEventIn:
    return CommandEventIn(
        event_id=event_id,
        desktop_event_sequence=sequence,
        event_type=event_type,
        occurred_at=datetime.now(UTC),
    )


def test_interaction_decision_is_strict_and_high_risk() -> None:
    request = RemoteControlCommandIn(
        client_request_id="decision-request-1",
        type="interaction_decision",
        payload={
            "run_id": "run-1",
            "interaction_id": "approval-1",
            "expected_version": 0,
            "decision": {"decision": "approved", "scope": "once"},
        },
        target_project_id="project-1",
        target_brain_session_id="rc_brain_1",
    )

    assert request.type in HIGH_RISK_COMMAND_TYPES
    with pytest.raises(ValueError, match="exactly one response shape"):
        RemoteControlCommandIn(
            client_request_id="invalid-decision",
            type="interaction_decision",
            payload={
                "run_id": "run-1",
                "interaction_id": "approval-1",
                "expected_version": 0,
                "decision": {
                    "decision": "approved",
                    "reply": "also do this",
                },
            },
            target_project_id="project-1",
            target_brain_session_id="rc_brain_1",
        )


def test_remote_command_creation_is_idempotent(engine, monkeypatch) -> None:
    monkeypatch.setattr(
        RemoteControlRedis,
        "is_bridge_online",
        staticmethod(lambda *_args, **_kwargs: True),
    )
    monkeypatch.setattr(
        RemoteControlService,
        "publish_command",
        staticmethod(lambda *_args, **_kwargs: True),
    )
    monkeypatch.setattr(
        RemoteControlService,
        "record_event",
        staticmethod(lambda *_args, **_kwargs: None),
    )
    request = RemoteControlCommandIn(
        client_request_id="mobile-request-1",
        type="stop",
        target_project_id="project-1",
        target_brain_session_id="rc_brain_1",
    )

    with Session(engine) as db:
        first = RemoteControlService.send_command("session-1", 7, request, db)
        replay = RemoteControlService.send_command("session-1", 7, request, db)
        commands = db.exec(
            select(RemoteControlCommand).where(RemoteControlCommand.client_request_id == "mobile-request-1")
        ).all()

        assert replay.command_id == first.command_id
        assert len(commands) == 1
        assert db.get(RemoteCommandState, first.command_id) is not None


def test_interaction_decision_converges_across_browser_tabs(engine, monkeypatch) -> None:
    monkeypatch.setattr(
        RemoteControlRedis,
        "is_bridge_online",
        staticmethod(lambda *_args, **_kwargs: True),
    )
    monkeypatch.setattr(
        RemoteControlService,
        "publish_command",
        staticmethod(lambda *_args, **_kwargs: True),
    )
    monkeypatch.setattr(
        RemoteControlService,
        "record_event",
        staticmethod(lambda *_args, **_kwargs: None),
    )
    payload = {
        "run_id": "run-1",
        "interaction_id": "approval-1",
        "expected_version": 3,
        "action_digest": "a" * 64,
        "decision": {"decision": "approved", "scope": "once"},
    }

    with Session(engine) as db:
        first = RemoteControlService.send_command(
            "session-1",
            7,
            RemoteControlCommandIn(
                client_request_id="browser-tab-one",
                type="interaction_decision",
                payload=payload,
                target_project_id="project-1",
                target_brain_session_id="rc_brain_1",
            ),
            db,
        )
        replay = RemoteControlService.send_command(
            "session-1",
            7,
            RemoteControlCommandIn(
                client_request_id="browser-tab-two",
                type="interaction_decision",
                payload=payload,
                target_project_id="project-1",
                target_brain_session_id="rc_brain_1",
            ),
            db,
        )

        assert replay.command_id == first.command_id
        with pytest.raises(HTTPException) as conflict:
            RemoteControlService.send_command(
                "session-1",
                7,
                RemoteControlCommandIn(
                    client_request_id="browser-tab-three",
                    type="interaction_decision",
                    payload={
                        **payload,
                        "decision": {
                            "decision": "rejected",
                            "scope": "once",
                        },
                    },
                    target_project_id="project-1",
                    target_brain_session_id="rc_brain_1",
                ),
                db,
            )

    assert conflict.value.status_code == 409
    assert conflict.value.detail["code"] == ("REMOTE_COMMAND_IDEMPOTENCY_CONFLICT")


def test_pending_delivery_lease_and_receipt_are_idempotent(engine) -> None:
    _create_command_state(engine)
    with Session(engine) as db:
        first = CommandControlService.claim_pending_commands("device-1", 7, 10, db)
        db.commit()
        assert [item.command_id for item in first.items] == ["command-1"]
        assert first.items[0].requires_online_receipt_confirmation is False
        assert CommandControlService.claim_pending_commands("device-1", 7, 10, db).items == []
        db.rollback()

    with Session(engine) as db:
        receipt = _receipt(first.items[0].lease_token)
        confirmed = CommandControlService.confirm_receipt("command-1", "device-1", 7, receipt, db)
        db.commit()
        assert confirmed.result == "confirmed"
        assert confirmed.may_execute is True

    with Session(engine) as db:
        duplicate = CommandControlService.confirm_receipt("command-1", "device-1", 7, receipt, db)
        db.commit()
        assert duplicate.result == "already_received"
        receipt_events = db.exec(
            select(RemoteCommandLifecycleEvent).where(RemoteCommandLifecycleEvent.desktop_event_sequence == 1)
        ).all()
        assert len(receipt_events) == 1


def test_desktop_event_sequence_is_monotonic(engine) -> None:
    _create_command_state(engine)
    with Session(engine) as db:
        lease = CommandControlService.lease_command_for_delivery("command-1", "device-1", 7, db)
        receipt = _receipt(lease.lease_token)
        CommandControlService.confirm_receipt("command-1", "device-1", 7, receipt, db)
        result = CommandControlService.ingest_command_events(
            "command-1",
            "device-1",
            7,
            CommandEventsIn(
                events=[
                    _event("admission-1", 2, "admission.accepted"),
                    _event("execution-1", 3, "execution.completed"),
                ]
            ),
            db,
        )
        db.commit()
        assert result.admission_state == "accepted"
        assert result.execution_state == "completed"
        assert result.expected_next_desktop_event_sequence == 4

    with Session(engine) as db:
        with pytest.raises(HTTPException) as gap:
            CommandControlService.ingest_command_events(
                "command-1",
                "device-1",
                7,
                CommandEventsIn(events=[_event("execution-gap", 5, "execution.failed")]),
                db,
            )
        assert gap.value.detail["code"] == "command_sequence_gap"


def test_internal_version_lane_keeps_legacy_wire_alias(engine) -> None:
    _create_command_state(engine)
    with Session(engine) as db:
        state = CommandControlService.get_command_state("command-1", 7, db)

    server_events = [event for event in state.events if event.producer == "server"]
    assert server_events
    assert server_events[0].server_recorded_version == 1
    assert server_events[0].cloud_recorded_version == server_events[0].server_recorded_version


def test_legacy_pending_command_without_state_still_retries(engine, monkeypatch) -> None:
    with Session(engine) as db:
        db.add(
            RemoteControlCommand(
                id="legacy-command",
                session_id="session-1",
                user_id=7,
                type="switch_project_view",
                payload={},
                target_project_id="project-1",
                status="pending",
                created_at=datetime.now(UTC) - timedelta(minutes=2),
            )
        )
        db.commit()

    published: list[tuple[str, RemoteCommandState | None]] = []
    monkeypatch.setattr(
        RemoteControlRedis,
        "is_bridge_online",
        staticmethod(lambda *_args, **_kwargs: True),
    )
    monkeypatch.setattr(
        RemoteControlService,
        "publish_command",
        staticmethod(lambda _session, command, state=None: published.append((command.id, state)) or True),
    )

    with Session(engine) as db:
        RemoteControlService.retry_pending_commands(db)

    assert published == [("legacy-command", None)]


def test_retry_persists_delivery_lease_before_notification(engine, monkeypatch) -> None:
    _create_command_state(engine)
    with Session(engine) as db:
        command = db.get(RemoteControlCommand, "command-1")
        command.created_at = datetime.now(UTC) - timedelta(minutes=2)
        db.add(command)
        db.commit()

    observed_lease_tokens: list[str | None] = []
    monkeypatch.setattr(
        RemoteControlRedis,
        "is_bridge_online",
        staticmethod(lambda *_args, **_kwargs: True),
    )

    def publish_after_commit(_session, command, _state=None) -> bool:
        with Session(engine) as verification_db:
            stored = verification_db.get(RemoteCommandState, command.id)
            observed_lease_tokens.append(stored.lease_token)
        return True

    monkeypatch.setattr(
        RemoteControlService,
        "publish_command",
        staticmethod(publish_after_commit),
    )

    with Session(engine) as db:
        RemoteControlService.retry_pending_commands(db)
        RemoteControlService.retry_pending_commands(db)

    assert len(observed_lease_tokens) == 1
    assert observed_lease_tokens[0]
