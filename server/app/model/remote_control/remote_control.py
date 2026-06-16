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

from sqlalchemy import Column, String
from sqlmodel import JSON, Field

from app.model.abstract.model import AbstractModel, DefaultTimes


class RemoteControlSession(AbstractModel, DefaultTimes, table=True):
    id: str = Field(sa_column=Column(String(64), primary_key=True))
    user_id: int = Field(index=True)
    desktop_instance_id: str = Field(sa_column=Column(String(128), index=True))
    space_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    space_name_snapshot: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    project_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    active_task_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    brain_session_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    current_project_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    current_task_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    current_history_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    current_brain_session_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    last_target_project_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    last_target_task_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    last_target_history_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    last_target_brain_session_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    title: str = Field(default="", sa_column=Column(String(256)))
    status: str = Field(default="active", sa_column=Column(String(32), index=True))
    bridge_status: str = Field(default="offline", sa_column=Column(String(32)))
    execution_mode: str = Field(default="desktop_ui", sa_column=Column(String(32)))
    expires_at: datetime = Field(index=True)
    last_bridge_seen_at: datetime | None = None
    last_remote_seen_at: datetime | None = None
    capabilities: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    revoked_at: datetime | None = None


class RemoteControlLink(AbstractModel, DefaultTimes, table=True):
    id: str = Field(sa_column=Column(String(64), primary_key=True))
    session_id: str = Field(sa_column=Column(String(64), index=True))
    token_hash: str = Field(sa_column=Column(String(128), index=True))
    expires_at: datetime = Field(index=True)
    first_used_at: datetime | None = None
    use_count: int = Field(default=0)


class RemoteControlCommand(AbstractModel, DefaultTimes, table=True):
    id: str = Field(sa_column=Column(String(64), primary_key=True))
    session_id: str = Field(sa_column=Column(String(64), index=True))
    user_id: int = Field(index=True)
    source_channel: str = Field(default="remote_web", sa_column=Column(String(64)))
    type: str = Field(sa_column=Column(String(64)))
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    space_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    next_task_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    target_project_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    target_task_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True, index=True))
    target_brain_session_id: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    status: str = Field(default="pending", sa_column=Column(String(32), index=True))
    error: str | None = Field(default=None, sa_column=Column(String(1024), nullable=True))
    error_code: str | None = Field(default=None, sa_column=Column(String(128), nullable=True))
    delivered_at: datetime | None = None
    acknowledged_at: datetime | None = None


class RemoteControlEvent(AbstractModel, DefaultTimes, table=True):
    id: str = Field(sa_column=Column(String(64), primary_key=True))
    session_id: str = Field(sa_column=Column(String(64), index=True))
    type: str = Field(sa_column=Column(String(64)))
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
