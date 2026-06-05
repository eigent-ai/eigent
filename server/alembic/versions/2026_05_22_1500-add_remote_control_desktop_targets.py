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
"""add remote control desktop targets

Revision ID: add_rc_desktop_targets
Revises: add_remote_control_tables
Create Date: 2026-05-22 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_rc_desktop_targets"
down_revision: str | None = "add_remote_control_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("remote_control_session", sa.Column("current_project_id", sa.String(length=128), nullable=True))
    op.add_column("remote_control_session", sa.Column("current_task_id", sa.String(length=128), nullable=True))
    op.add_column("remote_control_session", sa.Column("current_history_id", sa.String(length=128), nullable=True))
    op.add_column("remote_control_session", sa.Column("current_brain_session_id", sa.String(length=128), nullable=True))
    op.create_index(
        op.f("ix_remote_control_session_current_project_id"),
        "remote_control_session",
        ["current_project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_session_current_task_id"),
        "remote_control_session",
        ["current_task_id"],
        unique=False,
    )

    op.add_column("remote_control_command", sa.Column("target_project_id", sa.String(length=128), nullable=True))
    op.add_column("remote_control_command", sa.Column("target_task_id", sa.String(length=128), nullable=True))
    op.add_column("remote_control_command", sa.Column("target_brain_session_id", sa.String(length=128), nullable=True))
    op.create_index(
        op.f("ix_remote_control_command_target_project_id"),
        "remote_control_command",
        ["target_project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remote_control_command_target_task_id"),
        "remote_control_command",
        ["target_task_id"],
        unique=False,
    )
    op.create_index(
        "ix_remote_control_command_target_project_created",
        "remote_control_command",
        ["target_project_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_remote_control_command_target_project_created", table_name="remote_control_command")
    op.drop_index(op.f("ix_remote_control_command_target_task_id"), table_name="remote_control_command")
    op.drop_index(op.f("ix_remote_control_command_target_project_id"), table_name="remote_control_command")
    op.drop_column("remote_control_command", "target_brain_session_id")
    op.drop_column("remote_control_command", "target_task_id")
    op.drop_column("remote_control_command", "target_project_id")

    op.drop_index(op.f("ix_remote_control_session_current_task_id"), table_name="remote_control_session")
    op.drop_index(op.f("ix_remote_control_session_current_project_id"), table_name="remote_control_session")
    op.drop_column("remote_control_session", "current_brain_session_id")
    op.drop_column("remote_control_session", "current_history_id")
    op.drop_column("remote_control_session", "current_task_id")
    op.drop_column("remote_control_session", "current_project_id")
