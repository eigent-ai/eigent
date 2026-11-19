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

from typing import Literal

from pydantic import BaseModel, Field

OVERLAY_SOURCE_PATH_METADATA_KEY = "source_path"
OVERLAY_SOURCE_ROOT_METADATA_KEY = "source_root"


class ApplyResolutionIn(BaseModel):
    path: str
    action: Literal["apply_mine", "keep_theirs", "write_chosen"] = "apply_mine"
    content_ref: str | None = None
    hash: str | None = None


class SpaceProjectApplyIn(BaseModel):
    run_id: str
    paths: list[str] | None = None
    force_resolutions: list[ApplyResolutionIn] | None = None


class SpaceOverlayWriteIn(BaseModel):
    run_id: str
    path: str
    status: Literal["added", "modified", "deleted"]
    hash: str | None = None
    base_hash: str | None = None
    base_snapshot_id: str | None = None
    size: int | None = None
    mode: int | None = None
    modified_at: str | None = None
    source_path: str | None = Field(
        default=None,
        description="Server-side Apply source file reference for this overlay row.",
    )
    source_root: str | None = Field(
        default=None,
        description="Root that source_path must stay under; same-machine bridge until opaque FS handles land.",
    )
    metadata: dict[str, str | int | float | bool | None] | None = None


class SpaceOverlayOut(BaseModel):
    id: int
    space_id: str
    project_id: str
    run_id: str
    path: str
    status: str
    hash: str | None = None
    base_hash: str | None = None
    base_snapshot_id: str | None = None
    size: int | None = None
    mode: int | None = None
    metadata: dict | None = None


class SpaceOverlayListResponse(BaseModel):
    space_id: str
    project_id: str
    overlays: list[SpaceOverlayOut] = Field(default_factory=list)


class SpaceOverlayDiscardIn(BaseModel):
    run_id: str | None = None
    paths: list[str] | None = None


class SpaceOverlayDiscardResponse(BaseModel):
    space_id: str
    project_id: str
    discarded: int
    run_ids: list[str] = Field(default_factory=list)


class SpaceProjectRefreshIn(BaseModel):
    force: bool = False


class SpaceProjectRefreshResponse(BaseModel):
    kind: Literal["refreshed"]
    space_id: str
    project_id: str
    base_snapshot_id: str


class ApplyWarning(BaseModel):
    code: str
    message: str
    path: str | None = None


class AppliedPath(BaseModel):
    path: str
    status: str
    hash: str | None = None


class ApplyFailure(BaseModel):
    path: str
    reason: str
    message: str


class ApplyConflict(BaseModel):
    path: str
    status: str
    base_hash: str | None = None
    current_hash: str | None = None
    mine_hash: str | None = None
    message: str


class SpaceProjectApplyResponse(BaseModel):
    kind: str
    space_id: str
    project_id: str
    run_id: str
    applied: list[AppliedPath] = Field(default_factory=list)
    failed: list[ApplyFailure] = Field(default_factory=list)
    conflicts: list[ApplyConflict] = Field(default_factory=list)
    warnings: list[ApplyWarning] = Field(default_factory=list)
