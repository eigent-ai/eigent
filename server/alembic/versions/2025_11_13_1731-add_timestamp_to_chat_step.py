"""add_timestamp_to_chat_step

Revision ID: add_timestamp_to_chat_step
Revises: eec7242b3a9b
Create Date: 2025-11-13 17:31:51.692506

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "add_timestamp_to_chat_step"
down_revision: Union[str, None] = "eec7242b3a9b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add timestamp column to chat_step table."""
    op.add_column("chat_step", sa.Column("timestamp", sa.Float(), nullable=True))


def downgrade() -> None:
    """Remove timestamp column from chat_step table."""
    op.drop_column("chat_step", "timestamp")
