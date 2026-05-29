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

from typing import Any, Literal, TypeAlias, TypedDict

SkipReasonCode: TypeAlias = Literal[
    "space_disconnected",
    "space_archived",
    "project_archived",
    "resource_cap",
    "direct_write_conflict",
    "workdir_mode_conflict",
    "memory_pressure",
    "apply_conflict",
    "artifact_only_source_edit_attempt",
    "apply_partial_fail",
    "manual_cancelled",
    "unknown",
]


class SkipReason(TypedDict, total=False):
    code: SkipReasonCode
    message: str
    detail: dict[str, Any]
