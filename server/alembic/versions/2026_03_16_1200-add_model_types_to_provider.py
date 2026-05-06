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

"""add model_types to provider

Revision ID: add_model_types_to_provider
Revises: 9464b9d89de7
Create Date: 2026-03-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "add_model_types_to_provider"
down_revision: Union[str, None] = "9464b9d89de7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("provider", sa.Column("model_types", sa.JSON(), nullable=True))

    # Backfill: copy existing model_type into model_types array
    op.execute(
        """
        UPDATE provider
        SET model_types = json_build_array(model_type)
        WHERE model_type IS NOT NULL AND model_type != ''
        AND (model_types IS NULL)
        """
    )


def downgrade() -> None:
    op.drop_column("provider", "model_types")
