from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from loguru import logger
from sqlalchemy import delete, or_, update
from sqlmodel import select

from app.core.database import session_make
from app.core.redis_utils import get_redis_manager
from app.model.remote_control import (
    RemoteCommandLifecycleEvent,
    RemoteCommandNotificationOutbox,
    RemoteCommandState,
)

OUTBOX_BATCH_SIZE = 200
OUTBOX_LEASE_SECONDS = 30
OUTBOX_MAX_BACKOFF_SECONDS = 300
OUTBOX_RETENTION = timedelta(days=7)


@dataclass(frozen=True)
class ClaimedCommandNotification:
    event_id: str
    lease_token: str
    attempt_count: int
    channel: str
    payload: str


def _claim_batch(limit: int) -> list[ClaimedCommandNotification]:
    now = datetime.now(UTC)
    lease_until = now + timedelta(seconds=OUTBOX_LEASE_SECONDS)
    claimed: list[ClaimedCommandNotification] = []
    with session_make() as db:
        rows = list(
            db.exec(
                select(RemoteCommandNotificationOutbox)
                .where(
                    RemoteCommandNotificationOutbox.status == "pending",
                    RemoteCommandNotificationOutbox.available_at <= now,
                    or_(
                        RemoteCommandNotificationOutbox.lease_until.is_(None),
                        RemoteCommandNotificationOutbox.lease_until < now,
                    ),
                )
                .order_by(
                    RemoteCommandNotificationOutbox.session_id,
                    RemoteCommandNotificationOutbox.available_at,
                    RemoteCommandNotificationOutbox.event_id,
                )
                .limit(limit)
                .with_for_update(skip_locked=True)
            ).all()
        )
        for row in rows:
            event = db.get(RemoteCommandLifecycleEvent, row.event_id)
            state = db.get(RemoteCommandState, row.command_id)
            if event is None or state is None:
                row.attempt_count += 1
                row.available_at = now + timedelta(seconds=OUTBOX_MAX_BACKOFF_SECONDS)
                row.last_error = "command event or state missing"
                db.add(row)
                continue
            token = uuid4().hex
            row.lease_token = token
            row.lease_until = lease_until
            db.add(row)
            claimed.append(
                ClaimedCommandNotification(
                    event_id=row.event_id,
                    lease_token=token,
                    attempt_count=row.attempt_count,
                    channel=f"rc:ack:{row.session_id}",
                    payload=json.dumps(
                        {
                            "type": "command_event",
                            "session_id": row.session_id,
                            "command_id": row.command_id,
                            "event": {
                                "event_id": event.id,
                                "producer": event.producer,
                                "desktop_event_sequence": (event.desktop_event_sequence),
                                "server_recorded_version": (event.server_recorded_version),
                                # Temporary wire alias for older Desktop and
                                # Remote Web clients during self-host rollout.
                                "cloud_recorded_version": (event.server_recorded_version),
                                "event_type": event.event_type,
                                "payload": event.payload,
                                "occurred_at": event.occurred_at.isoformat(),
                            },
                            "projection": {
                                "receipt_state": state.receipt_state,
                                "admission_state": state.admission_state,
                                "execution_state": state.execution_state,
                                "actual_execution_state": (state.actual_execution_state),
                                "late_result": state.late_result,
                                "integrity_alert": state.integrity_alert,
                            },
                        }
                    ),
                )
            )
        db.commit()
    return claimed


def _finish(item: ClaimedCommandNotification, *, error: Exception | None = None) -> bool:
    values: dict = {"lease_token": None, "lease_until": None}
    if error is None:
        values.update(
            status="published",
            published_at=datetime.now(UTC),
            last_error=None,
        )
    else:
        attempt_count = item.attempt_count + 1
        values.update(
            attempt_count=attempt_count,
            available_at=datetime.now(UTC)
            + timedelta(
                seconds=min(
                    2 ** min(attempt_count, 8),
                    OUTBOX_MAX_BACKOFF_SECONDS,
                )
            ),
            last_error=str(error)[:4000],
        )
    with session_make() as db:
        result = db.execute(
            update(RemoteCommandNotificationOutbox)
            .where(
                RemoteCommandNotificationOutbox.event_id == item.event_id,
                RemoteCommandNotificationOutbox.status == "pending",
                RemoteCommandNotificationOutbox.lease_token == item.lease_token,
            )
            .values(**values)
        )
        db.commit()
        return result.rowcount == 1


def drain_command_notification_outbox(
    limit: int = OUTBOX_BATCH_SIZE,
) -> int:
    published = 0
    for item in _claim_batch(limit):
        try:
            get_redis_manager().client.publish(item.channel, item.payload)
        except Exception as exc:  # noqa: BLE001
            _finish(item, error=exc)
            logger.warning(
                "Command notification publish failed",
                extra={"event_id": item.event_id, "error": str(exc)},
            )
            continue
        if _finish(item):
            published += 1
    return published


def cleanup_published_command_outbox(*, retention: timedelta = OUTBOX_RETENTION) -> int:
    cutoff = datetime.now(UTC) - retention
    with session_make() as db:
        result = db.execute(
            delete(RemoteCommandNotificationOutbox).where(
                RemoteCommandNotificationOutbox.status == "published",
                RemoteCommandNotificationOutbox.published_at < cutoff,
            )
        )
        db.commit()
        return int(result.rowcount or 0)
