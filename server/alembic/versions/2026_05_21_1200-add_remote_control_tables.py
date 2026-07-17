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
"""add remote control tables

Revision ID: add_remote_control_tables
Revises: add_space_layer_foundation
Create Date: 2026-05-21 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_remote_control_tables"
down_revision: str | None = "add_space_layer_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "remote_control_session",
        *_timestamps(),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("desktop_instance_id", sa.String(length=128), nullable=True),
        sa.Column("project_id", sa.String(length=128), nullable=True),
        sa.Column("active_task_id", sa.String(length=128), nullable=True),
        sa.Column("brain_session_id", sa.String(length=128), nullable=True),
        sa.Column("title", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column("bridge_status", sa.String(length=32), nullable=True),
        sa.Column("execution_mode", sa.String(length=32), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_bridge_seen_at", sa.DateTime(), nullable=True),
        sa.Column("last_remote_seen_at", sa.DateTime(), nullable=True),
        sa.Column("capabilities", sa.JSON(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_remote_control_session_active_task_id"),
        "remote_control_session",
        ["active_task_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_session_desktop_instance_id"),
        "remote_control_session",
        ["desktop_instance_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_session_expires_at"),
        "remote_control_session",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_session_project_id"),
        "remote_control_session",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_session_status"),
        "remote_control_session",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_session_user_id"),
        "remote_control_session",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_remote_control_session_user_project_status",
        "remote_control_session",
        ["user_id", "project_id", "status"],
        unique=False,
    )

    op.create_table(
        "remote_control_link",
        *_timestamps(),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=True),
        sa.Column("token_hash", sa.String(length=128), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("first_used_at", sa.DateTime(), nullable=True),
        sa.Column("use_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_remote_control_link_expires_at"),
        "remote_control_link",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_link_session_id"),
        "remote_control_link",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_link_token_hash"),
        "remote_control_link",
        ["token_hash"],
        unique=False,
    )
    op.create_index(
        "ix_remote_control_link_session_token",
        "remote_control_link",
        ["session_id", "token_hash"],
        unique=False,
    )

    op.create_table(
        "remote_control_command",
        *_timestamps(),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("source_channel", sa.String(length=64), nullable=True),
        sa.Column("type", sa.String(length=64), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("next_task_id", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column("error", sa.String(length=1024), nullable=True),
        sa.Column("error_code", sa.String(length=128), nullable=True),
        sa.Column("delivered_at", sa.DateTime(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_remote_control_command_next_task_id"),
        "remote_control_command",
        ["next_task_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_command_session_id"),
        "remote_control_command",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_command_status"),
        "remote_control_command",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_command_user_id"),
        "remote_control_command",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_remote_control_command_session_status_created",
        "remote_control_command",
        ["session_id", "status", "created_at"],
        unique=False,
    )

    op.create_table(
        "remote_control_event",
        *_timestamps(),
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=True),
        sa.Column("type", sa.String(length=64), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_remote_control_event_session_id"),
        "remote_control_event",
        ["session_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_remote_control_event_session_id"),
        table_name="remote_control_event",
    )
    op.drop_table("remote_control_event")

    op.drop_index(
        "ix_remote_control_command_session_status_created",
        table_name="remote_control_command",
    )
    op.drop_index(
        op.f("ix_remote_control_command_user_id"),
        table_name="remote_control_command",
    )
    op.drop_index(
        op.f("ix_remote_control_command_status"),
        table_name="remote_control_command",
    )
    op.drop_index(
        op.f("ix_remote_control_command_session_id"),
        table_name="remote_control_command",
    )
    op.drop_index(
        op.f("ix_remote_control_command_next_task_id"),
        table_name="remote_control_command",
    )
    op.drop_table("remote_control_command")

    op.drop_index(
        "ix_remote_control_link_session_token",
        table_name="remote_control_link",
    )
    op.drop_index(
        op.f("ix_remote_control_link_token_hash"),
        table_name="remote_control_link",
    )
    op.drop_index(
        op.f("ix_remote_control_link_session_id"),
        table_name="remote_control_link",
    )
    op.drop_index(
        op.f("ix_remote_control_link_expires_at"),
        table_name="remote_control_link",
    )
    op.drop_table("remote_control_link")

    op.drop_index(
        "ix_remote_control_session_user_project_status",
        table_name="remote_control_session",
    )
    op.drop_index(
        op.f("ix_remote_control_session_user_id"),
        table_name="remote_control_session",
    )
    op.drop_index(
        op.f("ix_remote_control_session_status"),
        table_name="remote_control_session",
    )
    op.drop_index(
        op.f("ix_remote_control_session_project_id"),
        table_name="remote_control_session",
    )
    op.drop_index(
        op.f("ix_remote_control_session_expires_at"),
        table_name="remote_control_session",
    )
    op.drop_index(
        op.f("ix_remote_control_session_desktop_instance_id"),
        table_name="remote_control_session",
    )
    op.drop_index(
        op.f("ix_remote_control_session_active_task_id"),
        table_name="remote_control_session",
    )
    op.drop_table("remote_control_session")
