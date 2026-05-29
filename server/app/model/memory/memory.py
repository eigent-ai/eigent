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

from typing import Any

from sqlmodel import JSON, Column, Field, String, UniqueConstraint

from app.model.abstract.model import AbstractModel, DefaultTimes


class SpaceMemory(AbstractModel, DefaultTimes, table=True):
    """Future shared knowledge scoped to a Space."""

    __table_args__ = (
        UniqueConstraint("space_id", "key", name="uix_space_memory_space_key"),
    )

    id: int = Field(default=None, primary_key=True)
    user_id: str = Field(sa_column=Column(String(128), nullable=False, index=True))
    space_id: str = Field(foreign_key="space.id", index=True)
    key: str = Field(sa_column=Column(String(255), nullable=False, index=True))
    value: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    metadata_json: dict[str, Any] | None = Field(default=None, sa_column=Column("metadata", JSON))


class ProjectMemory(AbstractModel, DefaultTimes, table=True):
    """Future knowledge scoped to a Project/session."""

    __table_args__ = (
        UniqueConstraint("project_id", "key", name="uix_project_memory_project_key"),
    )

    id: int = Field(default=None, primary_key=True)
    user_id: str = Field(sa_column=Column(String(128), nullable=False, index=True))
    space_id: str = Field(foreign_key="space.id", index=True)
    project_id: str = Field(foreign_key="project.id", index=True)
    key: str = Field(sa_column=Column(String(255), nullable=False, index=True))
    value: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    metadata_json: dict[str, Any] | None = Field(default=None, sa_column=Column("metadata", JSON))
