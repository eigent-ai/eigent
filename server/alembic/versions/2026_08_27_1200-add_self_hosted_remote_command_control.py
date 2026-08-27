"""add self-hosted durable remote command control

Revision ID: add_self_hosted_rc_control
Revises: add_rc_space_scope
Create Date: 2026-08-27 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "add_self_hosted_rc_control"
down_revision: str | None = "add_rc_space_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "remote_control_command",
        sa.Column("client_request_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "remote_control_command",
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "remote_control_command",
        sa.Column("interaction_decision_key", sa.String(length=64), nullable=True),
    )
    op.create_unique_constraint(
        "uq_remote_control_command_session_request",
        "remote_control_command",
        ["session_id", "client_request_id"],
    )
    op.create_index(
        "uq_remote_control_command_interaction_decision_key",
        "remote_control_command",
        ["interaction_decision_key"],
        unique=True,
    )

    op.create_table(
        "desktop_device",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("install_public_key", sa.Text(), nullable=True),
        sa.Column(
            "credential_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column("app_version", sa.String(length=64), nullable=True),
        sa.Column(
            "capabilities",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_desktop_device_user_active",
        "desktop_device",
        ["user_id", "revoked_at"],
    )

    op.create_table(
        "project_execution_route",
        sa.Column("project_id", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "owner_kind",
            sa.String(length=32),
            server_default="desktop_device",
            nullable=False,
        ),
        sa.Column("target_device_id", sa.String(length=128), nullable=False),
        sa.Column(
            "route_version",
            sa.BigInteger(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "owner_kind IN ('desktop_device')",
            name="ck_project_execution_route_owner_kind_valid",
        ),
        sa.CheckConstraint(
            "route_version >= 1",
            name="ck_project_execution_route_version_positive",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_device_id"], ["desktop_device.id"]),
        sa.PrimaryKeyConstraint("project_id"),
    )
    op.create_index(
        "ix_project_execution_route_device",
        "project_execution_route",
        ["target_device_id", "updated_at"],
    )

    op.create_table(
        "remote_command_state",
        sa.Column("command_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.String(length=128), nullable=False),
        sa.Column("run_id", sa.String(length=128), nullable=True),
        sa.Column("route_device_id", sa.String(length=128), nullable=False),
        sa.Column("route_version", sa.BigInteger(), nullable=False),
        sa.Column(
            "receipt_state",
            sa.String(length=32),
            server_default="pending",
            nullable=False,
        ),
        sa.Column(
            "admission_state",
            sa.String(length=32),
            server_default="unknown",
            nullable=False,
        ),
        sa.Column(
            "execution_state",
            sa.String(length=32),
            server_default="not_started",
            nullable=False,
        ),
        sa.Column("actual_execution_state", sa.String(length=32), nullable=True),
        sa.Column(
            "expected_next_desktop_event_sequence",
            sa.BigInteger(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "server_recorded_version",
            sa.BigInteger(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("receipt_grace_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "next_delivery_attempt_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "delivery_attempt_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("delivery_lease_owner", sa.String(length=128), nullable=True),
        sa.Column("lease_token", sa.String(length=64), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("durably_received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("admitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "late_result",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("integrity_alert", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "receipt_state IN ('pending', 'durably_received', 'expired')",
            name="ck_remote_command_receipt_state_valid",
        ),
        sa.CheckConstraint(
            "admission_state IN ('unknown', 'accepted', 'rejected')",
            name="ck_remote_command_admission_state_valid",
        ),
        sa.CheckConstraint(
            "execution_state IN ('not_started', 'running', 'completed', 'failed')",
            name="ck_remote_command_execution_state_valid",
        ),
        sa.CheckConstraint(
            "expected_next_desktop_event_sequence >= 1",
            name="ck_remote_command_next_desktop_sequence_positive",
        ),
        sa.CheckConstraint(
            "server_recorded_version >= 0",
            name="ck_remote_command_server_version_non_negative",
        ),
        sa.CheckConstraint(
            "delivery_attempt_count >= 0",
            name="ck_remote_command_delivery_attempt_non_negative",
        ),
        sa.CheckConstraint(
            "receipt_grace_until >= expires_at",
            name="ck_remote_command_receipt_grace_order",
        ),
        sa.ForeignKeyConstraint(
            ["command_id"],
            ["remote_control_command.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("command_id"),
    )
    op.create_index(
        "ix_remote_command_delivery_pending",
        "remote_command_state",
        [
            "route_device_id",
            "next_delivery_attempt_at",
            "lease_until",
            "expires_at",
        ],
        postgresql_where=sa.text("receipt_state = 'pending'"),
    )
    op.create_index(
        "ix_remote_command_receipt_expiry",
        "remote_command_state",
        ["receipt_grace_until", "lease_until"],
        postgresql_where=sa.text("receipt_state = 'pending'"),
    )
    op.create_index(
        "ix_remote_command_state_project_created",
        "remote_command_state",
        ["project_id", "created_at"],
    )

    op.create_table(
        "remote_command_lifecycle_event",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("command_id", sa.String(length=64), nullable=False),
        sa.Column("producer", sa.String(length=16), nullable=False),
        sa.Column("desktop_event_sequence", sa.BigInteger(), nullable=True),
        sa.Column("server_recorded_version", sa.BigInteger(), nullable=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "producer IN ('desktop', 'server')",
            name="ck_remote_command_event_producer_valid",
        ),
        sa.CheckConstraint(
            "(producer = 'desktop' AND desktop_event_sequence IS NOT NULL "
            "AND server_recorded_version IS NULL) OR "
            "(producer = 'server' AND desktop_event_sequence IS NULL "
            "AND server_recorded_version IS NOT NULL)",
            name="ck_remote_command_event_version_lane",
        ),
        sa.ForeignKeyConstraint(
            ["command_id"],
            ["remote_command_state.command_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "command_id",
            "desktop_event_sequence",
            name="uq_remote_command_event_desktop_sequence",
        ),
        sa.UniqueConstraint(
            "command_id",
            "server_recorded_version",
            name="uq_remote_command_event_server_version",
        ),
    )
    op.create_index(
        "ix_remote_command_event_command_created",
        "remote_command_lifecycle_event",
        ["command_id", "created_at"],
    )

    op.create_table(
        "remote_command_notification_outbox",
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("command_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default="pending",
            nullable=False,
        ),
        sa.Column(
            "attempt_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "available_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("lease_token", sa.String(length=64), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'published')",
            name="ck_remote_command_notification_status_valid",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_remote_command_notification_attempt_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["remote_command_lifecycle_event.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("event_id"),
    )
    op.create_index(
        "ix_remote_command_notification_pending",
        "remote_command_notification_outbox",
        ["available_at", "lease_until", "session_id"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_remote_command_notification_published",
        "remote_command_notification_outbox",
        ["published_at"],
        postgresql_where=sa.text("status = 'published'"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_remote_command_notification_published",
        table_name="remote_command_notification_outbox",
    )
    op.drop_index(
        "ix_remote_command_notification_pending",
        table_name="remote_command_notification_outbox",
    )
    op.drop_table("remote_command_notification_outbox")
    op.drop_index(
        "ix_remote_command_event_command_created",
        table_name="remote_command_lifecycle_event",
    )
    op.drop_table("remote_command_lifecycle_event")
    op.drop_index(
        "ix_remote_command_state_project_created",
        table_name="remote_command_state",
    )
    op.drop_index(
        "ix_remote_command_receipt_expiry",
        table_name="remote_command_state",
    )
    op.drop_index(
        "ix_remote_command_delivery_pending",
        table_name="remote_command_state",
    )
    op.drop_table("remote_command_state")
    op.drop_index(
        "ix_project_execution_route_device",
        table_name="project_execution_route",
    )
    op.drop_table("project_execution_route")
    op.drop_index("ix_desktop_device_user_active", table_name="desktop_device")
    op.drop_table("desktop_device")
    op.drop_index(
        "uq_remote_control_command_interaction_decision_key",
        table_name="remote_control_command",
    )
    op.drop_constraint(
        "uq_remote_control_command_session_request",
        "remote_control_command",
        type_="unique",
    )
    op.drop_column("remote_control_command", "interaction_decision_key")
    op.drop_column("remote_control_command", "request_fingerprint")
    op.drop_column("remote_control_command", "client_request_id")
