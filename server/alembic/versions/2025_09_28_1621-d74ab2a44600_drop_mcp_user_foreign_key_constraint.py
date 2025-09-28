"""drop_mcp_user_foreign_key_constraint

Revision ID: d74ab2a44600
Revises: 0001_init
Create Date: 2025-09-28 16:21:06.930093

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision: str = "d74ab2a44600"
down_revision: Union[str, None] = "0001_init"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Drop the foreign key constraint for mcp_id in mcp_user table
    op.drop_constraint("mcp_user_mcp_id_fkey", "mcp_user", type_="foreignkey")


def downgrade() -> None:
    """Downgrade schema."""
    # Re-add the foreign key constraint for mcp_id in mcp_user table
    op.create_foreign_key("mcp_user_mcp_id_fkey", "mcp_user", "mcp", ["mcp_id"], ["id"])
