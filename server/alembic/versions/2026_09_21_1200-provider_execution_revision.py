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

"""Add database-owned exact Provider execution references.

Revision ID: provider_execution_revision
Revises: merge_self_hosted_rc_lineages
"""

from uuid import uuid4

import sqlalchemy as sa

from alembic import op
from app.model.provider.execution_revision import (
    install_execution_revision_triggers,
    remove_execution_revision_triggers,
)

revision = "provider_execution_revision"
down_revision = "merge_self_hosted_rc_lineages"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    op.add_column(
        "provider",
        sa.Column("execution_revision", sa.String(32), nullable=False, server_default=sa.text("''")),
    )
    # Existing rows get independent non-secret identities, never key digests.
    for row in connection.execute(sa.text("SELECT id FROM provider")).fetchall():
        connection.execute(
            sa.text("UPDATE provider SET execution_revision=:revision WHERE id=:id"),
            {"revision": uuid4().hex, "id": row[0]},
        )
    install_execution_revision_triggers(connection)


def downgrade():
    remove_execution_revision_triggers(op.get_bind())
    op.drop_column("provider", "execution_revision")
