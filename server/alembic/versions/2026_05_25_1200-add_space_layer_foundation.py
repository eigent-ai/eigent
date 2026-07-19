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
"""add space layer foundation

Revision ID: add_space_layer_foundation
Revises: add_remote_sub_agent_provider
Create Date: 2026-05-25 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_space_layer_foundation"
down_revision: str | None = "add_remote_sub_agent_provider"
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
        "space",
        *_timestamps(),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("root_path", sa.String(length=2048), nullable=True),
        sa.Column("root_fingerprint", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("schema_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.CheckConstraint("source_type IN ('blank', 'folder', 'legacy')", name="ck_space_source_type_valid"),
        sa.CheckConstraint("status IN ('active', 'disconnected', 'archived')", name="ck_space_status_valid"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_space_source_type"), "space", ["source_type"], unique=False)
    op.create_index(op.f("ix_space_status"), "space", ["status"], unique=False)
    op.create_index(op.f("ix_space_user_id"), "space", ["user_id"], unique=False)

    op.create_table(
        "project",
        *_timestamps(),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("space_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column("mode", sa.String(length=50), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("workdir_mode", sa.String(length=50), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["space_id"], ["space.id"]),
        sa.CheckConstraint("mode IS NULL OR mode IN ('single-agent', 'workforce')", name="ck_project_mode_valid"),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_project_status_valid"),
        sa.CheckConstraint(
            "workdir_mode IS NULL OR workdir_mode IN ('worktree', 'copy', 'direct-write', 'artifact-only')",
            name="ck_project_workdir_mode_valid",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "id", name="uix_project_user_id_id"),
    )
    op.create_index(op.f("ix_project_mode"), "project", ["mode"], unique=False)
    op.create_index(op.f("ix_project_space_id"), "project", ["space_id"], unique=False)
    op.create_index(op.f("ix_project_status"), "project", ["status"], unique=False)
    op.create_index(op.f("ix_project_user_id"), "project", ["user_id"], unique=False)
    op.create_index(op.f("ix_project_workdir_mode"), "project", ["workdir_mode"], unique=False)

    op.create_table(
        "space_memory",
        *_timestamps(),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("space_id", sa.String(), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("value", sa.JSON(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["space_id"], ["space.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("space_id", "key", name="uix_space_memory_space_key"),
    )
    op.create_index(op.f("ix_space_memory_key"), "space_memory", ["key"], unique=False)
    op.create_index(op.f("ix_space_memory_space_id"), "space_memory", ["space_id"], unique=False)
    op.create_index(op.f("ix_space_memory_user_id"), "space_memory", ["user_id"], unique=False)

    op.create_table(
        "project_memory",
        *_timestamps(),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("space_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("value", sa.JSON(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
        sa.ForeignKeyConstraint(["space_id"], ["space.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "key", name="uix_project_memory_project_key"),
    )
    op.create_index(op.f("ix_project_memory_key"), "project_memory", ["key"], unique=False)
    op.create_index(op.f("ix_project_memory_project_id"), "project_memory", ["project_id"], unique=False)
    op.create_index(op.f("ix_project_memory_space_id"), "project_memory", ["space_id"], unique=False)
    op.create_index(op.f("ix_project_memory_user_id"), "project_memory", ["user_id"], unique=False)

    op.create_table(
        "space_file_index",
        *_timestamps(),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("space_id", sa.String(), nullable=False),
        sa.Column("path", sa.String(length=2048), nullable=False),
        sa.Column("hash", sa.String(length=128), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("mode", sa.Integer(), nullable=True),
        sa.Column("modified_at", sa.DateTime(), nullable=True),
        sa.Column("indexed_at", sa.DateTime(), nullable=True),
        sa.Column("row_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["space_id"], ["space.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("space_id", "path", name="uix_space_file_index_space_path"),
    )
    op.create_index(op.f("ix_space_file_index_hash"), "space_file_index", ["hash"], unique=False)
    op.create_index(op.f("ix_space_file_index_path"), "space_file_index", ["path"], unique=False)
    op.create_index(op.f("ix_space_file_index_space_id"), "space_file_index", ["space_id"], unique=False)

    op.create_table(
        "space_file_index_overlay",
        *_timestamps(),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("space_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("run_id", sa.String(length=128), nullable=False),
        sa.Column("path", sa.String(length=2048), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("hash", sa.String(length=128), nullable=True),
        sa.Column("base_hash", sa.String(length=128), nullable=True),
        sa.Column("base_snapshot_id", sa.String(length=128), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("mode", sa.Integer(), nullable=True),
        sa.Column("modified_at", sa.DateTime(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
        sa.ForeignKeyConstraint(["space_id"], ["space.id"]),
        sa.CheckConstraint("status IN ('added', 'modified', 'deleted')", name="ck_space_file_index_overlay_status_valid"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "space_id",
            "project_id",
            "run_id",
            "path",
            name="uix_space_file_index_overlay_run_path",
        ),
    )
    op.create_index(
        op.f("ix_space_file_index_overlay_base_hash"),
        "space_file_index_overlay",
        ["base_hash"],
        unique=False,
    )
    op.create_index(
        op.f("ix_space_file_index_overlay_base_snapshot_id"),
        "space_file_index_overlay",
        ["base_snapshot_id"],
        unique=False,
    )
    op.create_index(op.f("ix_space_file_index_overlay_hash"), "space_file_index_overlay", ["hash"], unique=False)
    op.create_index(
        op.f("ix_space_file_index_overlay_modified_at"),
        "space_file_index_overlay",
        ["modified_at"],
        unique=False,
    )
    op.create_index(op.f("ix_space_file_index_overlay_path"), "space_file_index_overlay", ["path"], unique=False)
    op.create_index(
        op.f("ix_space_file_index_overlay_project_id"),
        "space_file_index_overlay",
        ["project_id"],
        unique=False,
    )
    op.create_index(op.f("ix_space_file_index_overlay_run_id"), "space_file_index_overlay", ["run_id"], unique=False)
    op.create_index(
        op.f("ix_space_file_index_overlay_space_id"),
        "space_file_index_overlay",
        ["space_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_space_file_index_overlay_status"),
        "space_file_index_overlay",
        ["status"],
        unique=False,
    )

    op.create_table(
        "user_id_canonicalization",
        *_timestamps(),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("canonical_id", sa.String(length=128), nullable=False),
        sa.PrimaryKeyConstraint("source", "source_id"),
    )
    op.create_index(
        op.f("ix_user_id_canonicalization_canonical_id"),
        "user_id_canonicalization",
        ["canonical_id"],
        unique=False,
    )

    op.add_column("chat_history", sa.Column("space_id", sa.String(), nullable=True))
    op.add_column("chat_history", sa.Column("run_id", sa.String(), nullable=True))
    op.add_column("chat_history", sa.Column("skip_reason", sa.JSON(), nullable=True))
    op.create_index(op.f("ix_chat_history_space_id"), "chat_history", ["space_id"], unique=False)
    op.create_index(op.f("ix_chat_history_run_id"), "chat_history", ["run_id"], unique=False)

    op.add_column("chat_step", sa.Column("run_id", sa.String(), nullable=True))
    op.create_index(op.f("ix_chat_step_run_id"), "chat_step", ["run_id"], unique=False)

    op.add_column("chat_snapshot", sa.Column("storage_key", sa.String(), nullable=True))
    op.create_index(op.f("ix_chat_snapshot_storage_key"), "chat_snapshot", ["storage_key"], unique=False)

    op.add_column("trigger", sa.Column("space_id", sa.String(), nullable=True))
    op.create_index(op.f("ix_trigger_space_id"), "trigger", ["space_id"], unique=False)

    op.add_column("trigger_execution", sa.Column("skip_reason", sa.JSON(), nullable=True))

    op.execute("UPDATE chat_history SET project_id = task_id WHERE project_id IS NULL")
    op.execute("UPDATE chat_history SET run_id = task_id WHERE run_id IS NULL")
    # chat_history has no FK to Space; seed legacy ids before creating rows so
    # later backfill CTEs can use a single shape for old and new records.
    op.execute("UPDATE chat_history SET space_id = 'legacy_' || CAST(user_id AS TEXT) WHERE space_id IS NULL")
    op.execute(
        "UPDATE chat_step SET run_id = task_id WHERE run_id IS NULL"
    )
    op.execute(
        "UPDATE chat_snapshot SET storage_key = 'local://' || ltrim(image_path, '/') WHERE storage_key IS NULL"
    )
    op.execute("UPDATE trigger SET space_id = 'legacy_' || CAST(user_id AS TEXT) WHERE space_id IS NULL")

    op.execute(
        """
        INSERT INTO user_id_canonicalization (source, source_id, canonical_id, created_at, updated_at)
        SELECT DISTINCT 'chat_history', CAST(user_id AS TEXT), CAST(user_id AS TEXT), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM chat_history
        ON CONFLICT (source, source_id) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO user_id_canonicalization (source, source_id, canonical_id, created_at, updated_at)
        SELECT DISTINCT 'trigger', CAST(user_id AS TEXT), CAST(user_id AS TEXT), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM trigger
        ON CONFLICT (source, source_id) DO NOTHING
        """
    )

    op.execute(
        """
        INSERT INTO space (
            id, user_id, name, description, source_type, status, schema_version, metadata, created_at, updated_at
        )
        SELECT
            'legacy_' || canonical_id,
            canonical_id,
            'Legacy Space',
            'Projects migrated from the pre-Space app model.',
            'legacy',
            'active',
            1,
            json_build_object('legacy', true, 'schemaVersion', 1),
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        FROM (
            SELECT DISTINCT canonical_id FROM user_id_canonicalization
        ) users
        ON CONFLICT (id) DO NOTHING
        """
    )

    op.execute(
        """
        WITH backfill_source AS (
            SELECT
                CAST(user_id AS TEXT) AS user_id,
                COALESCE(project_id, task_id) AS project_id,
                NULLIF(project_name, '') AS project_name,
                MAX(updated_at) AS updated_at
            FROM chat_history
            WHERE COALESCE(project_id, task_id) IS NOT NULL
            GROUP BY CAST(user_id AS TEXT), COALESCE(project_id, task_id), NULLIF(project_name, '')
            UNION
            SELECT
                CAST(user_id AS TEXT) AS user_id,
                project_id,
                NULLIF(name, '') AS project_name,
                MAX(updated_at) AS updated_at
            FROM trigger
            WHERE project_id IS NOT NULL
            GROUP BY CAST(user_id AS TEXT), project_id, NULLIF(name, '')
        ),
        normalized AS (
            SELECT DISTINCT
                user_id,
                project_id,
                COALESCE(project_name, 'Project ' || project_id) AS project_name
            FROM backfill_source
        ),
        collisions AS (
            SELECT project_id, COUNT(DISTINCT user_id) AS user_count
            FROM normalized
            GROUP BY project_id
        ),
        resolved AS (
            SELECT
                CASE
                    WHEN collisions.user_count > 1 THEN normalized.user_id || ':' || normalized.project_id
                    ELSE normalized.project_id
                END AS resolved_project_id,
                normalized.user_id,
                normalized.project_id AS legacy_project_id,
                normalized.project_name,
                collisions.user_count
            FROM normalized
            JOIN collisions ON collisions.project_id = normalized.project_id
        )
        INSERT INTO project (
            id, user_id, space_id, name, status, workdir_mode, metadata, created_at, updated_at
        )
        SELECT
            resolved_project_id,
            user_id,
            'legacy_' || user_id,
            project_name,
            'active',
            'artifact-only',
            CASE
                WHEN user_count > 1 THEN json_build_object('legacy', true, 'legacyAlias', legacy_project_id)
                ELSE json_build_object('legacy', true)
            END,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        FROM resolved
        ON CONFLICT (id) DO NOTHING
        """
    )

    op.execute(
        """
        WITH collision_aliases AS (
            SELECT DISTINCT metadata ->> 'legacyAlias' AS project_id
            FROM project
            WHERE metadata ->> 'legacyAlias' IS NOT NULL
        )
        UPDATE chat_history
        SET project_id = CAST(chat_history.user_id AS TEXT) || ':' || COALESCE(chat_history.project_id, chat_history.task_id)
        FROM collision_aliases
        WHERE collision_aliases.project_id = COALESCE(chat_history.project_id, chat_history.task_id)
        """
    )
    op.execute(
        """
        WITH collision_aliases AS (
            SELECT DISTINCT metadata ->> 'legacyAlias' AS project_id
            FROM project
            WHERE metadata ->> 'legacyAlias' IS NOT NULL
        )
        UPDATE trigger
        SET project_id = CAST(trigger.user_id AS TEXT) || ':' || trigger.project_id
        FROM collision_aliases
        WHERE collision_aliases.project_id = trigger.project_id
        """
    )


def downgrade() -> None:
    op.drop_column("trigger_execution", "skip_reason")
    op.drop_index(op.f("ix_trigger_space_id"), table_name="trigger")
    op.drop_column("trigger", "space_id")
    op.drop_index(op.f("ix_chat_snapshot_storage_key"), table_name="chat_snapshot")
    op.drop_column("chat_snapshot", "storage_key")
    op.drop_index(op.f("ix_chat_step_run_id"), table_name="chat_step")
    op.drop_column("chat_step", "run_id")
    op.drop_index(op.f("ix_chat_history_run_id"), table_name="chat_history")
    op.drop_index(op.f("ix_chat_history_space_id"), table_name="chat_history")
    op.drop_column("chat_history", "skip_reason")
    op.drop_column("chat_history", "run_id")
    op.drop_column("chat_history", "space_id")

    op.drop_index(op.f("ix_user_id_canonicalization_canonical_id"), table_name="user_id_canonicalization")
    op.drop_table("user_id_canonicalization")

    op.drop_index(op.f("ix_space_file_index_overlay_status"), table_name="space_file_index_overlay")
    op.drop_index(op.f("ix_space_file_index_overlay_space_id"), table_name="space_file_index_overlay")
    op.drop_index(op.f("ix_space_file_index_overlay_run_id"), table_name="space_file_index_overlay")
    op.drop_index(op.f("ix_space_file_index_overlay_project_id"), table_name="space_file_index_overlay")
    op.drop_index(op.f("ix_space_file_index_overlay_path"), table_name="space_file_index_overlay")
    op.drop_index(op.f("ix_space_file_index_overlay_modified_at"), table_name="space_file_index_overlay")
    op.drop_index(op.f("ix_space_file_index_overlay_hash"), table_name="space_file_index_overlay")
    op.drop_index(op.f("ix_space_file_index_overlay_base_snapshot_id"), table_name="space_file_index_overlay")
    op.drop_index(op.f("ix_space_file_index_overlay_base_hash"), table_name="space_file_index_overlay")
    op.drop_table("space_file_index_overlay")

    op.drop_index(op.f("ix_space_file_index_space_id"), table_name="space_file_index")
    op.drop_index(op.f("ix_space_file_index_path"), table_name="space_file_index")
    op.drop_index(op.f("ix_space_file_index_hash"), table_name="space_file_index")
    op.drop_table("space_file_index")

    op.drop_index(op.f("ix_project_memory_user_id"), table_name="project_memory")
    op.drop_index(op.f("ix_project_memory_space_id"), table_name="project_memory")
    op.drop_index(op.f("ix_project_memory_project_id"), table_name="project_memory")
    op.drop_index(op.f("ix_project_memory_key"), table_name="project_memory")
    op.drop_table("project_memory")

    op.drop_index(op.f("ix_space_memory_user_id"), table_name="space_memory")
    op.drop_index(op.f("ix_space_memory_space_id"), table_name="space_memory")
    op.drop_index(op.f("ix_space_memory_key"), table_name="space_memory")
    op.drop_table("space_memory")

    op.drop_index(op.f("ix_project_workdir_mode"), table_name="project")
    op.drop_index(op.f("ix_project_user_id"), table_name="project")
    op.drop_index(op.f("ix_project_status"), table_name="project")
    op.drop_index(op.f("ix_project_space_id"), table_name="project")
    op.drop_index(op.f("ix_project_mode"), table_name="project")
    op.drop_table("project")

    op.drop_index(op.f("ix_space_user_id"), table_name="space")
    op.drop_index(op.f("ix_space_status"), table_name="space")
    op.drop_index(op.f("ix_space_source_type"), table_name="space")
    op.drop_table("space")
