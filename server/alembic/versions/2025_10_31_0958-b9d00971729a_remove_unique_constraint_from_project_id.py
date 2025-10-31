"""remove_unique_constraint_from_project_id

Revision ID: b9d00971729a
Revises: eec7242b3a9b
Create Date: 2025-10-31 09:58:03.586654

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision: str = 'b9d00971729a'
down_revision: Union[str, None] = 'eec7242b3a9b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Remove any unique constraint on project_id to allow multiple tasks per project
    # This addresses the issue where POST /api/chat/history fails when trying to create
    # multiple records with the same project_id but different task_id values
    
    try:
        # Try to drop any unique index on project_id if it exists
        # This might have been created manually or by a previous version
        op.drop_index("ix_chat_history_project_id", table_name="chat_history")
        # Recreate as non-unique index
        op.create_index(op.f("ix_chat_history_project_id"), "chat_history", ["project_id"], unique=False)
    except Exception:
        # If the index doesn't exist or is already non-unique, that's fine
        pass


def downgrade() -> None:
    """Downgrade schema."""
    # Restore unique constraint on project_id (this would prevent the desired functionality)
    try:
        op.drop_index(op.f("ix_chat_history_project_id"), table_name="chat_history")
        op.create_index(op.f("ix_chat_history_project_id"), "chat_history", ["project_id"], unique=True)
    except Exception:
        pass
