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

from app.model.space.file_index import SpaceFileIndex, SpaceFileIndexOverlay
from app.model.space.apply import (
    AppliedPath,
    ApplyConflict,
    ApplyFailure,
    ApplyResolutionIn,
    ApplyWarning,
    OVERLAY_SOURCE_PATH_METADATA_KEY,
    OVERLAY_SOURCE_ROOT_METADATA_KEY,
    SpaceOverlayDiscardIn,
    SpaceOverlayDiscardResponse,
    SpaceOverlayListResponse,
    SpaceOverlayOut,
    SpaceOverlayWriteIn,
    SpaceProjectRefreshIn,
    SpaceProjectRefreshResponse,
    SpaceProjectApplyIn,
    SpaceProjectApplyResponse,
)
from app.model.space.space import (
    Space,
    SpaceIn,
    SpaceOut,
    SpaceRelocateIn,
    SpaceSourceType,
    SpaceStatus,
    SpaceUpdate,
)
from app.model.space.user_id_canonicalization import UserIdCanonicalization

__all__ = [
    "Space",
    "SpaceIn",
    "SpaceOut",
    "SpaceRelocateIn",
    "SpaceSourceType",
    "SpaceStatus",
    "SpaceUpdate",
    "SpaceFileIndex",
    "SpaceFileIndexOverlay",
    "AppliedPath",
    "ApplyConflict",
    "ApplyFailure",
    "ApplyResolutionIn",
    "ApplyWarning",
    "OVERLAY_SOURCE_PATH_METADATA_KEY",
    "OVERLAY_SOURCE_ROOT_METADATA_KEY",
    "SpaceOverlayDiscardIn",
    "SpaceOverlayDiscardResponse",
    "SpaceOverlayListResponse",
    "SpaceOverlayOut",
    "SpaceOverlayWriteIn",
    "SpaceProjectRefreshIn",
    "SpaceProjectRefreshResponse",
    "SpaceProjectApplyIn",
    "SpaceProjectApplyResponse",
    "UserIdCanonicalization",
]
