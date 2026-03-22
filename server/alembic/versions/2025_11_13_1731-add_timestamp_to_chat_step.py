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
