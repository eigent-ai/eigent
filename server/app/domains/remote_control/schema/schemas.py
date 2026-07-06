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
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.model.project.project import ProjectOut
from app.model.space.apply import ApplyResolutionIn
from app.model.space.space import SpaceOut


RemoteControlCommandType = Literal[
    "user_message",
    "human_reply",
    "stop",
    "skip_task",
    "add_task",
    "remove_task",
    "supplement",
    "switch_project_view",
    "space_project_upsert",
    "space_overlay_list",
    "space_apply_project_run",
    "space_refresh_project",
    "space_discard_project_overlays",
]


class RemoteControlCreateSessionIn(BaseModel):
    desktop_instance_id: str
    space_id: str | None = None
    project_id: str | None = None
    active_task_id: str | None = None
    brain_session_id: str | None = None
    initial_project_id: str | None = None
    initial_task_id: str | None = None
    initial_history_id: str | None = None
    title: str = ""
    expires_in_seconds: int = Field(default=86400, ge=60, le=604800)


class RemoteControlCreateSessionOut(BaseModel):
    session_id: str
    url: str
    expires_at: datetime
    bridge_status: str
    space_id: str | None = None
    space_name: str | None = None
    current_project_id: str | None = None
    current_task_id: str | None = None
    current_history_id: str | None = None
    current_brain_session_id: str | None = None


class RemoteControlSessionOut(BaseModel):
    session_id: str
    desktop_instance_id: str
    space_id: str | None = None
    space_name: str | None = None
    space: SpaceOut | None = None
    project_id: str | None = None
    active_task_id: str | None = None
    brain_session_id: str | None = None
    current_project_id: str | None = None
    current_task_id: str | None = None
    current_history_id: str | None = None
    current_brain_session_id: str | None = None
    title: str
    status: str
    bridge_status: str
    execution_mode: str
    capabilities: dict[str, Any]
    created_at: datetime | None
    expires_at: datetime


class RemoteControlExtendIn(BaseModel):
    extend_seconds: int


class RemoteControlExtendOut(BaseModel):
    expires_at: datetime


class RemoteControlCommandIn(BaseModel):
    source_channel: str = "remote_web"
    type: RemoteControlCommandType
    payload: dict[str, Any] = Field(default_factory=dict)
    space_id: str | None = None
    target_project_id: str | None = None
    target_task_id: str | None = None
    target_brain_session_id: str | None = None


class RemoteControlPatchTargetIn(BaseModel):
    project_id: str
    task_id: str | None = None
    history_id: str | None = None


class RemoteControlPatchTargetOut(BaseModel):
    space_id: str | None = None
    current_project_id: str
    current_task_id: str | None = None
    current_history_id: str | None = None
    current_brain_session_id: str
    desktop_ready: Literal["pending", "ready", "failed"] = "pending"


class RemoteControlCommandOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    command_id: str
    status: str
    next_task_id: str | None = None


class RemoteControlStepOut(BaseModel):
    step_id: int
    task_id: str
    project_id: str | None = None
    step: str
    data: Any
    timestamp: float | None = None


class RemoteControlStepsOut(BaseModel):
    items: list[RemoteControlStepOut]
    has_more: bool
    next_since: int


class RemoteControlProjectListOut(BaseModel):
    space: SpaceOut
    items: list[ProjectOut]


class RemoteControlCreateProjectIn(BaseModel):
    name: str
    description: str | None = None
    mode: Literal["single-agent", "workforce"] = "single-agent"
    workdir_mode: str | None = None
    metadata: dict[str, Any] | None = None


class RemoteControlFolderApplyIn(BaseModel):
    run_id: str
    paths: list[str] | None = None
    force_resolutions: list[ApplyResolutionIn] | None = None
    confirm: bool = False


class RemoteControlFolderDiscardIn(BaseModel):
    run_id: str | None = None
    paths: list[str] | None = None
    confirm: bool = False


class RemoteControlFolderRefreshIn(BaseModel):
    force: bool = False


class RemoteControlOverlayListOut(BaseModel):
    command_id: str
    status: str


class RemoteControlFolderOperationOut(BaseModel):
    command_id: str
    status: str
