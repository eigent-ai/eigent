"""merge hosted compatibility and self-hosted command lineages

Revision ID: merge_self_hosted_rc_lineages
Revises: add_cloud_model_table, add_self_hosted_rc_control
Create Date: 2026-08-27 12:30:00
"""

from collections.abc import Sequence

revision: str = "merge_self_hosted_rc_lineages"
down_revision: tuple[str, str] = (
    "add_cloud_model_table",
    "add_self_hosted_rc_control",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
