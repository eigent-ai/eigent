from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import JSON, Field

from app.model.abstract.model import AbstractModel


def utc_now() -> datetime:
    return datetime.now(UTC)


JSON_DOCUMENT = JSON().with_variant(JSONB(), "postgresql")


class DesktopDevice(AbstractModel, table=True):
    __table_args__ = (Index("ix_desktop_device_user_active", "user_id", "revoked_at"),)

    id: str = Field(sa_column=Column(String(128), primary_key=True))
    user_id: int = Field(sa_column=Column(Integer, nullable=False))
    install_public_key: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    credential_version: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False, server_default="1"),
    )
    app_version: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    capabilities: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON_DOCUMENT, nullable=False),
    )
    last_seen_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    revoked_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ProjectExecutionRoute(AbstractModel, table=True):
    __table_args__ = (
        CheckConstraint(
            "route_version >= 1",
            name="ck_project_execution_route_version_positive",
        ),
        CheckConstraint(
            "owner_kind IN ('desktop_device')",
            name="ck_project_execution_route_owner_kind_valid",
        ),
        Index(
            "ix_project_execution_route_device",
            "target_device_id",
            "updated_at",
        ),
    )

    project_id: str = Field(
        sa_column=Column(
            String(128),
            ForeignKey("project.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    user_id: int = Field(sa_column=Column(Integer, nullable=False))
    owner_kind: str = Field(
        default="desktop_device",
        sa_column=Column(String(32), nullable=False),
    )
    target_device_id: str = Field(sa_column=Column(String(128), ForeignKey("desktop_device.id"), nullable=False))
    route_version: int = Field(
        default=1,
        sa_column=Column(BigInteger, nullable=False, server_default="1"),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class RemoteCommandState(AbstractModel, table=True):
    __table_args__ = (
        CheckConstraint(
            "receipt_state IN ('pending', 'durably_received', 'expired')",
            name="ck_remote_command_receipt_state_valid",
        ),
        CheckConstraint(
            "admission_state IN ('unknown', 'accepted', 'rejected')",
            name="ck_remote_command_admission_state_valid",
        ),
        CheckConstraint(
            "execution_state IN ('not_started', 'running', 'completed', 'failed')",
            name="ck_remote_command_execution_state_valid",
        ),
        CheckConstraint(
            "expected_next_desktop_event_sequence >= 1",
            name="ck_remote_command_next_desktop_sequence_positive",
        ),
        CheckConstraint(
            "server_recorded_version >= 0",
            name="ck_remote_command_server_version_non_negative",
        ),
        CheckConstraint(
            "delivery_attempt_count >= 0",
            name="ck_remote_command_delivery_attempt_non_negative",
        ),
        CheckConstraint(
            "receipt_grace_until >= expires_at",
            name="ck_remote_command_receipt_grace_order",
        ),
        Index(
            "ix_remote_command_delivery_pending",
            "route_device_id",
            "next_delivery_attempt_at",
            "lease_until",
            "expires_at",
            postgresql_where=text("receipt_state = 'pending'"),
            sqlite_where=text("receipt_state = 'pending'"),
        ),
        Index(
            "ix_remote_command_receipt_expiry",
            "receipt_grace_until",
            "lease_until",
            postgresql_where=text("receipt_state = 'pending'"),
            sqlite_where=text("receipt_state = 'pending'"),
        ),
        Index(
            "ix_remote_command_state_project_created",
            "project_id",
            "created_at",
        ),
    )

    command_id: str = Field(
        sa_column=Column(
            String(64),
            ForeignKey("remote_control_command.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    session_id: str = Field(sa_column=Column(String(64), nullable=False))
    user_id: int = Field(sa_column=Column(Integer, nullable=False))
    project_id: str = Field(sa_column=Column(String(128), nullable=False))
    run_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    route_device_id: str = Field(sa_column=Column(String(128), nullable=False))
    route_version: int = Field(sa_column=Column(BigInteger, nullable=False))
    receipt_state: str = Field(
        default="pending",
        sa_column=Column(String(32), nullable=False, server_default="pending"),
    )
    admission_state: str = Field(
        default="unknown",
        sa_column=Column(String(32), nullable=False, server_default="unknown"),
    )
    execution_state: str = Field(
        default="not_started",
        sa_column=Column(String(32), nullable=False, server_default="not_started"),
    )
    actual_execution_state: str | None = Field(default=None, sa_column=Column(String(32), nullable=True))
    expected_next_desktop_event_sequence: int = Field(
        default=1,
        sa_column=Column(BigInteger, nullable=False, server_default="1"),
    )
    server_recorded_version: int = Field(
        default=0,
        sa_column=Column(BigInteger, nullable=False, server_default="0"),
    )
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    receipt_grace_until: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    next_delivery_attempt_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    delivery_attempt_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, server_default="0"),
    )
    delivery_lease_owner: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    lease_token: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    lease_until: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    durably_received_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    admitted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    completed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    expired_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    late_result: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    integrity_alert: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class RemoteCommandLifecycleEvent(AbstractModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "command_id",
            "desktop_event_sequence",
            name="uq_remote_command_event_desktop_sequence",
        ),
        UniqueConstraint(
            "command_id",
            "server_recorded_version",
            name="uq_remote_command_event_server_version",
        ),
        CheckConstraint(
            "producer IN ('desktop', 'server')",
            name="ck_remote_command_event_producer_valid",
        ),
        CheckConstraint(
            "(producer = 'desktop' AND desktop_event_sequence IS NOT NULL "
            "AND server_recorded_version IS NULL) OR "
            "(producer = 'server' AND desktop_event_sequence IS NULL "
            "AND server_recorded_version IS NOT NULL)",
            name="ck_remote_command_event_version_lane",
        ),
        Index(
            "ix_remote_command_event_command_created",
            "command_id",
            "created_at",
        ),
    )

    id: str = Field(sa_column=Column(String(64), primary_key=True))
    command_id: str = Field(
        sa_column=Column(
            String(64),
            ForeignKey("remote_command_state.command_id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    producer: str = Field(sa_column=Column(String(16), nullable=False))
    desktop_event_sequence: int | None = Field(default=None, sa_column=Column(BigInteger, nullable=True))
    server_recorded_version: int | None = Field(default=None, sa_column=Column(BigInteger, nullable=True))
    event_type: str = Field(sa_column=Column(String(64), nullable=False))
    payload: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON_DOCUMENT, nullable=False),
    )
    occurred_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class RemoteCommandNotificationOutbox(AbstractModel, table=True):
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'published')",
            name="ck_remote_command_notification_status_valid",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_remote_command_notification_attempt_non_negative",
        ),
        Index(
            "ix_remote_command_notification_pending",
            "available_at",
            "lease_until",
            "session_id",
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
        Index(
            "ix_remote_command_notification_published",
            "published_at",
            postgresql_where=text("status = 'published'"),
            sqlite_where=text("status = 'published'"),
        ),
    )

    event_id: str = Field(
        sa_column=Column(
            String(64),
            ForeignKey("remote_command_lifecycle_event.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    command_id: str = Field(sa_column=Column(String(64), nullable=False))
    session_id: str = Field(sa_column=Column(String(64), nullable=False))
    status: str = Field(
        default="pending",
        sa_column=Column(String(16), nullable=False, server_default="pending"),
    )
    attempt_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, server_default="0"),
    )
    available_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    lease_token: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    lease_until: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    published_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    last_error: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
