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

"""SpaceService default workdir_mode regression tests.

Locks in the contract after the copy → direct-write default switch
(see docs/core/space-folder-output-copy-bug-analysis.md):
- folder-backed Space defaults newly-created Projects to direct-write so
  the agent writes into the user's selected folder by default
- non-folder Spaces continue to default to artifact-only
"""

from __future__ import annotations

import os
from types import SimpleNamespace

os.environ.setdefault(
    "database_url",
    "sqlite:////private/tmp/eigent_default_workdir_mode_test.db",
)

from app.domains.space.service.space_service import SpaceService
from app.model.project.project import ProjectWorkdirMode
from app.model.space.space import SpaceSourceType


def test_folder_space_defaults_to_direct_write():
    folder_space = SimpleNamespace(source_type=SpaceSourceType.FOLDER)

    assert (
        SpaceService._default_project_workdir_mode(folder_space)
        == ProjectWorkdirMode.DIRECT_WRITE
    )


def test_blank_space_defaults_to_artifact_only():
    blank_space = SimpleNamespace(source_type=SpaceSourceType.BLANK)

    assert (
        SpaceService._default_project_workdir_mode(blank_space)
        == ProjectWorkdirMode.ARTIFACT_ONLY
    )


def test_default_is_a_member_of_validation_set():
    """If the default ever drifts to a value the validator rejects,
    SpaceService.create_project + ensure_project would raise on every
    Project creation. Lock the relationship explicitly."""

    folder_default = SpaceService._default_project_workdir_mode(
        SimpleNamespace(source_type=SpaceSourceType.FOLDER)
    )
    blank_default = SpaceService._default_project_workdir_mode(
        SimpleNamespace(source_type=SpaceSourceType.BLANK)
    )

    assert folder_default in SpaceService.PROJECT_WORKDIR_MODES
    assert blank_default in SpaceService.PROJECT_WORKDIR_MODES
