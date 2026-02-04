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
"""drop_mcp_user_foreign_key_constraint

Revision ID: d74ab2a44600
Revises: 0001_init
Create Date: 2025-09-28 16:21:06.930093

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d74ab2a44600"
down_revision: str | None = "0001_init"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Drop the foreign key constraint for mcp_id in mcp_user table
    # Use try-catch to handle cases where constraint might not exist or have different name

    try:
        op.drop_constraint("mcp_user_mcp_id_fkey", "mcp_user", type_="foreignkey")
    except Exception:
        # If the expected constraint name doesn't work, try to find it dynamically
        try:
            connection = op.get_bind()
            inspector = sa.inspect(connection)
            fk_constraints = inspector.get_foreign_keys("mcp_user")

            # Find the constraint that references mcp_id -> mcp.id
            target_constraint = None
            for fk in fk_constraints:
                if (
                    fk.get("constrained_columns") == ["mcp_id"]
                    and fk.get("referred_table") == "mcp"
                    and fk.get("referred_columns") == ["id"]
                ):
                    target_constraint = fk.get("name")
                    break

            if target_constraint:
                op.drop_constraint(target_constraint, "mcp_user", type_="foreignkey")
            else:
                print("Warning: No foreign key constraint found for mcp_user.mcp_id -> mcp.id")
        except Exception as e2:
            print(f"Warning: Could not drop foreign key constraint: {e2}")


def downgrade() -> None:
    """Downgrade schema."""
    # Re-add the foreign key constraint for mcp_id in mcp_user table
    # Check if the constraint already exists before creating it

    try:
        connection = op.get_bind()
        inspector = sa.inspect(connection)
        fk_constraints = inspector.get_foreign_keys("mcp_user")

        # Check if the constraint already exists
        constraint_exists = False
        for fk in fk_constraints:
            if (
                fk.get("constrained_columns") == ["mcp_id"]
                and fk.get("referred_table") == "mcp"
                and fk.get("referred_columns") == ["id"]
            ):
                constraint_exists = True
                break

        if not constraint_exists:
            op.create_foreign_key("mcp_user_mcp_id_fkey", "mcp_user", "mcp", ["mcp_id"], ["id"])
        else:
            print("Info: Foreign key constraint for mcp_user.mcp_id -> mcp.id already exists")
    except Exception as e:
        print(f"Warning: Could not check or create foreign key constraint: {e}")
