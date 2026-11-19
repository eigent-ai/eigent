"""preserve the shared-to-hosted migration boundary

Revision ID: add_cloud_model_table
Revises: add_rc_space_scope
Create Date: 2026-06-10 12:00:00

The Eigent-hosted distribution used this revision ID immediately after the
last schema revision shared with the self-hosted server.  Some development
databases therefore record it as their current Alembic revision.

This self-hosted compatibility marker intentionally performs no DDL.  It lets
those databases rejoin the self-hosted migration chain without importing the
hosted-only model registry or mutating any hosted-only tables that may already
exist.
"""

from collections.abc import Sequence

revision: str = "add_cloud_model_table"
down_revision: str | None = "add_rc_space_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
