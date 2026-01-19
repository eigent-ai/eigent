"""add_password_reset_token_table

Revision ID: add_password_reset_token
Revises: add_timestamp_to_chat_step
Create Date: 2026-01-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "add_password_reset_token"
down_revision: Union[str, None] = "add_timestamp_to_chat_step"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create password_reset_token table."""
    op.create_table(
        "password_reset_token",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_password_reset_token_user_id", "password_reset_token", ["user_id"])
    op.create_index("ix_password_reset_token_token", "password_reset_token", ["token"], unique=True)


def downgrade() -> None:
    """Drop password_reset_token table."""
    op.drop_index("ix_password_reset_token_token", table_name="password_reset_token")
    op.drop_index("ix_password_reset_token_user_id", table_name="password_reset_token")
    op.drop_table("password_reset_token")
