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

from pydantic import BaseModel
from sqlalchemy import CheckConstraint, Integer
from sqlmodel import JSON, Column, Field, String

from app.model.abstract.model import AbstractModel, DefaultTimes


class SpaceSourceType:
    BLANK = "blank"
    FOLDER = "folder"
    LEGACY = "legacy"


class SpaceStatus:
    ACTIVE = "active"
    DISCONNECTED = "disconnected"
    ARCHIVED = "archived"


class Space(AbstractModel, DefaultTimes, table=True):
    """Top-level source container shared by many projects/sessions."""

    __table_args__ = (
        CheckConstraint(
            "source_type IN ('blank', 'folder', 'legacy')",
            name="ck_space_source_type_valid",
        ),
        CheckConstraint(
            "status IN ('active', 'disconnected', 'archived')",
            name="ck_space_status_valid",
        ),
    )

    id: str = Field(primary_key=True)
    user_id: str = Field(sa_column=Column(String(128), nullable=False, index=True))
    name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(String(1024)))
    source_type: str = Field(
        default=SpaceSourceType.BLANK,
        sa_column=Column(String(50), nullable=False, index=True),
    )
    root_path: str | None = Field(default=None, sa_column=Column(String(2048)))
    root_fingerprint: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    status: str = Field(
        default=SpaceStatus.ACTIVE,
        sa_column=Column(String(50), nullable=False, index=True),
    )
    schema_version: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False, server_default="1"),
    )
    metadata_json: dict[str, Any] | None = Field(default=None, sa_column=Column("metadata", JSON))


class SpaceIn(BaseModel):
    id: str | None = None
    name: str
    description: str | None = None
    source_type: str = SpaceSourceType.BLANK
    root_path: str | None = None
    root_fingerprint: dict[str, Any] | None = None
    status: str = SpaceStatus.ACTIVE
    schema_version: int = 1
    metadata: dict[str, Any] | None = None


class SpaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    metadata: dict[str, Any] | None = None


class SpaceRelocateIn(BaseModel):
    root_path: str
    force: bool = False
    # Optional client-supplied fingerprint of the new root. When present, the
    # server uses it for identity comparison instead of stat-ing root_path
    # locally — required for cloud / multi-host Brain deployments where the
    # server cannot resolve the user's filesystem path.
    root_fingerprint: dict[str, Any] | None = None


class SpaceOut(BaseModel):
    id: str
    user_id: str
    name: str
    description: str | None = None
    source_type: str
    root_path: str | None = None
    root_fingerprint: dict[str, Any] | None = None
    status: str
    schema_version: int
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def from_model(cls, space: Space) -> "SpaceOut":
        return cls(
            id=space.id,
            user_id=space.user_id,
            name=space.name,
            description=space.description,
            source_type=space.source_type,
            root_path=space.root_path,
            root_fingerprint=space.root_fingerprint,
            status=space.status,
            schema_version=space.schema_version,
            metadata=space.metadata_json,
            created_at=space.created_at,
            updated_at=space.updated_at,
        )
