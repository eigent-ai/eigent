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
from sqlalchemy import CheckConstraint
from sqlmodel import JSON, Column, Field, String, UniqueConstraint

from app.model.abstract.model import AbstractModel, DefaultTimes


class ProjectMode:
    SINGLE_AGENT = "single-agent"
    WORKFORCE = "workforce"


class ProjectStatus:
    ACTIVE = "active"
    ARCHIVED = "archived"


class ProjectWorkdirMode:
    WORKTREE = "worktree"
    COPY = "copy"
    DIRECT_WRITE = "direct-write"
    ARTIFACT_ONLY = "artifact-only"


class Project(AbstractModel, DefaultTimes, table=True):
    """Session-like execution container scoped under a Space."""

    __table_args__ = (
        UniqueConstraint("user_id", "id", name="uix_project_user_id_id"),
        CheckConstraint(
            "mode IS NULL OR mode IN ('single-agent', 'workforce')",
            name="ck_project_mode_valid",
        ),
        CheckConstraint(
            "status IN ('active', 'archived')",
            name="ck_project_status_valid",
        ),
        CheckConstraint(
            "workdir_mode IS NULL OR workdir_mode IN ('worktree', 'copy', 'direct-write', 'artifact-only')",
            name="ck_project_workdir_mode_valid",
        ),
    )

    id: str = Field(primary_key=True)
    user_id: str = Field(sa_column=Column(String(128), nullable=False, index=True))
    space_id: str = Field(foreign_key="space.id", index=True)
    name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(String(1024)))
    mode: str | None = Field(default=None, sa_column=Column(String(50), index=True))
    status: str = Field(
        default=ProjectStatus.ACTIVE,
        sa_column=Column(String(50), nullable=False, index=True),
    )
    workdir_mode: str | None = Field(default=None, sa_column=Column(String(50), index=True))
    metadata_json: dict[str, Any] | None = Field(default=None, sa_column=Column("metadata", JSON))


class ProjectIn(BaseModel):
    id: str | None = None
    space_id: str | None = None
    name: str
    description: str | None = None
    mode: str | None = None
    status: str = ProjectStatus.ACTIVE
    workdir_mode: str | None = None
    metadata: dict[str, Any] | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    workdir_mode: str | None = None
    metadata: dict[str, Any] | None = None


class ProjectOut(BaseModel):
    id: str
    user_id: str
    space_id: str
    name: str
    description: str | None = None
    mode: str | None = None
    status: str
    workdir_mode: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def from_model(cls, project: Project) -> "ProjectOut":
        metadata = project.metadata_json if isinstance(project.metadata_json, dict) else None
        return cls(
            id=project.id,
            user_id=project.user_id,
            space_id=project.space_id,
            name=project.name or f"Project {project.id}",
            description=project.description,
            mode=project.mode,
            status=project.status or ProjectStatus.ACTIVE,
            workdir_mode=project.workdir_mode,
            metadata=metadata,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )
