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

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, Integer
from sqlmodel import JSON, Column, Field, String, UniqueConstraint

from app.model.abstract.model import AbstractModel, DefaultTimes


class OverlayStatus:
    ADDED = "added"
    MODIFIED = "modified"
    DELETED = "deleted"


class SpaceFileIndex(AbstractModel, DefaultTimes, table=True):
    """Lazy cache of Space source files. Apply must still verify live disk."""

    __table_args__ = (
        UniqueConstraint("space_id", "path", name="uix_space_file_index_space_path"),
    )

    id: int = Field(default=None, primary_key=True)
    space_id: str = Field(foreign_key="space.id", index=True)
    path: str = Field(sa_column=Column(String(2048), nullable=False, index=True))
    hash: str | None = Field(default=None, sa_column=Column(String(128), index=True))
    size: int | None = Field(default=None, sa_column=Column(BigInteger))
    mode: int | None = Field(default=None, sa_column=Column(Integer))
    modified_at: datetime | None = None
    indexed_at: datetime | None = None
    row_version: int = Field(default=1, sa_column=Column(BigInteger, nullable=False, server_default="1"))
    metadata_json: dict[str, Any] | None = Field(default=None, sa_column=Column("metadata", JSON))


class SpaceFileIndexOverlay(AbstractModel, DefaultTimes, table=True):
    """Run-scoped pending diff row for a Project workdir."""

    __table_args__ = (
        CheckConstraint(
            "status IN ('added', 'modified', 'deleted')",
            name="ck_space_file_index_overlay_status_valid",
        ),
        UniqueConstraint(
            "space_id",
            "project_id",
            "run_id",
            "path",
            name="uix_space_file_index_overlay_run_path",
        ),
    )

    id: int = Field(default=None, primary_key=True)
    space_id: str = Field(foreign_key="space.id", index=True)
    project_id: str = Field(foreign_key="project.id", index=True)
    run_id: str = Field(sa_column=Column(String(128), nullable=False, index=True))
    path: str = Field(sa_column=Column(String(2048), nullable=False, index=True))
    status: str = Field(sa_column=Column(String(50), nullable=False, index=True))
    hash: str | None = Field(default=None, sa_column=Column(String(128), index=True))
    base_hash: str | None = Field(default=None, sa_column=Column(String(128), index=True))
    base_snapshot_id: str | None = Field(default=None, sa_column=Column(String(128), index=True))
    size: int | None = Field(default=None, sa_column=Column(BigInteger))
    mode: int | None = Field(default=None, sa_column=Column(Integer))
    modified_at: datetime | None = Field(default=None, index=True)
    metadata_json: dict[str, Any] | None = Field(default=None, sa_column=Column("metadata", JSON))
