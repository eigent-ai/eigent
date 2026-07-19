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
"""add remote control space scope

Revision ID: add_rc_space_scope
Revises: add_rc_desktop_targets
Create Date: 2026-06-01 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_rc_space_scope"
down_revision: str | None = "add_rc_desktop_targets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("remote_control_session", sa.Column("space_id", sa.String(length=128), nullable=True))
    op.add_column("remote_control_session", sa.Column("space_name_snapshot", sa.String(length=255), nullable=True))
    op.add_column("remote_control_session", sa.Column("last_target_project_id", sa.String(length=128), nullable=True))
    op.add_column("remote_control_session", sa.Column("last_target_task_id", sa.String(length=128), nullable=True))
    op.add_column("remote_control_session", sa.Column("last_target_history_id", sa.String(length=128), nullable=True))
    op.add_column("remote_control_session", sa.Column("last_target_brain_session_id", sa.String(length=128), nullable=True))
    op.create_index(op.f("ix_remote_control_session_space_id"), "remote_control_session", ["space_id"], unique=False)
    op.create_index(
        op.f("ix_remote_control_session_last_target_project_id"),
        "remote_control_session",
        ["last_target_project_id"],
        unique=False,
    )

    op.add_column("remote_control_command", sa.Column("space_id", sa.String(length=128), nullable=True))
    op.create_index(op.f("ix_remote_control_command_space_id"), "remote_control_command", ["space_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_remote_control_command_space_id"), table_name="remote_control_command")
    op.drop_column("remote_control_command", "space_id")

    op.drop_index(op.f("ix_remote_control_session_last_target_project_id"), table_name="remote_control_session")
    op.drop_index(op.f("ix_remote_control_session_space_id"), table_name="remote_control_session")
    op.drop_column("remote_control_session", "last_target_brain_session_id")
    op.drop_column("remote_control_session", "last_target_history_id")
    op.drop_column("remote_control_session", "last_target_task_id")
    op.drop_column("remote_control_session", "last_target_project_id")
    op.drop_column("remote_control_session", "space_name_snapshot")
    op.drop_column("remote_control_session", "space_id")
