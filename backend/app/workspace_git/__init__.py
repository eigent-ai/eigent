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

from app.workspace_git.backend import (
    GitBackend,
    GitBackendError,
    GitCommandError,
    GitCommandResult,
    NestedRepositoryError,
    RepositoryDiagnostics,
    RepositoryProbe,
    RepoStateToken,
)
from app.workspace_git.configuration import (
    ConfigurationRepositoryError,
    ConfigurationRepositoryResult,
    ConfigurationRepositoryService,
)
from app.workspace_git.content import (
    ContentRepositoryConsentRequired,
    ContentRepositoryError,
    ContentRepositoryInspection,
    ContentRepositoryResult,
    ContentRepositoryService,
    ContentRepositoryStatus,
    NoCheckpointChangesError,
    RepositoryStateChangedError,
    RestoreCandidate,
)
from app.workspace_git.coordinator import (
    GitRunAdmission,
    GitRunWorkspace,
    WorkspaceGitCoordinator,
    get_default_workspace_git_coordinator,
)
from app.workspace_git.snapshot import (
    WorkspaceOverlayConflictError,
    WorkspacePathNotFoundError,
    WorkspaceSnapshotError,
    WorkspaceSnapshotRead,
    WorkspaceSnapshotService,
    WorkspaceSnapshotUnavailableError,
    WorkspaceSourceChangedError,
)

__all__ = [
    "ConfigurationRepositoryError",
    "ConfigurationRepositoryResult",
    "ConfigurationRepositoryService",
    "ContentRepositoryConsentRequired",
    "ContentRepositoryError",
    "ContentRepositoryInspection",
    "ContentRepositoryResult",
    "ContentRepositoryService",
    "ContentRepositoryStatus",
    "GitBackend",
    "GitBackendError",
    "GitCommandError",
    "GitCommandResult",
    "GitRunAdmission",
    "GitRunWorkspace",
    "NestedRepositoryError",
    "NoCheckpointChangesError",
    "RepoStateToken",
    "RepositoryDiagnostics",
    "RepositoryStateChangedError",
    "RepositoryProbe",
    "RestoreCandidate",
    "WorkspaceGitCoordinator",
    "WorkspaceOverlayConflictError",
    "WorkspacePathNotFoundError",
    "WorkspaceSnapshotError",
    "WorkspaceSnapshotRead",
    "WorkspaceSnapshotService",
    "WorkspaceSnapshotUnavailableError",
    "WorkspaceSourceChangedError",
    "get_default_workspace_git_coordinator",
]
