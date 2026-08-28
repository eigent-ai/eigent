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

from app.workspace_git.advanced import (
    AdvancedGitApprovalRequired,
    AdvancedGitCommandClassifier,
    AdvancedGitCommandRejected,
    AdvancedGitError,
    AdvancedGitOutcomeUnknown,
    AdvancedGitPreview,
    AdvancedGitService,
    get_default_advanced_git_service,
)
from app.workspace_git.backend import (
    GitBackend,
    GitBackendError,
    GitCommandError,
    GitCommandResult,
    GitCommandTimeoutError,
    GitPathBlob,
    GitPathLineStat,
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
from app.workspace_git.edit import (
    RunWorkspaceEditResult,
    RunWorkspaceEditService,
    get_default_run_workspace_edit_service,
)
from app.workspace_git.lifecycle import (
    GitRunFinalization,
    GitTerminalReconciliation,
    WorkspaceGitLifecycle,
    get_default_workspace_git_lifecycle,
)
from app.workspace_git.mutation import (
    PreparedWorkspaceExecution,
    PreparedWorkspaceWrite,
    WorkspaceMutationReconciliation,
    WorkspaceMutationService,
    get_default_workspace_mutation_service,
)
from app.workspace_git.observer import (
    ExternalGitChange,
    ExternalGitObservation,
    WorkspaceGitObserver,
)
from app.workspace_git.retention import (
    DEFAULT_GIT_RETENTION_POLICY,
    GitRetentionPolicy,
)
from app.workspace_git.scheduler import (
    WorkspaceWriterAdmission,
    WorkspaceWriterInterruptedError,
    WorkspaceWriterReconciliation,
    WorkspaceWriterScheduler,
    get_default_workspace_writer_scheduler,
)
from app.workspace_git.snapshot import (
    MaterializedOverlay,
    WorkspaceOverlayConflictError,
    WorkspacePathNotFoundError,
    WorkspaceSnapshotError,
    WorkspaceSnapshotRead,
    WorkspaceSnapshotService,
    WorkspaceSnapshotUnavailableError,
    WorkspaceSourceChangedError,
)
from app.workspace_git.workforce import (
    GitAgentMergeOutcome,
    GitAgentReconciliation,
    GitAgentWorkspace,
    WorkforceGitService,
    get_default_workforce_git_service,
)

__all__ = [
    "AdvancedGitApprovalRequired",
    "AdvancedGitCommandClassifier",
    "AdvancedGitCommandRejected",
    "AdvancedGitError",
    "AdvancedGitOutcomeUnknown",
    "AdvancedGitPreview",
    "AdvancedGitService",
    "get_default_advanced_git_service",
    "ConfigurationRepositoryError",
    "ConfigurationRepositoryResult",
    "ConfigurationRepositoryService",
    "ContentRepositoryConsentRequired",
    "ContentRepositoryError",
    "ContentRepositoryInspection",
    "ContentRepositoryResult",
    "ContentRepositoryService",
    "ContentRepositoryStatus",
    "ExternalGitChange",
    "ExternalGitObservation",
    "GitBackend",
    "GitBackendError",
    "GitCommandError",
    "GitCommandResult",
    "GitCommandTimeoutError",
    "GitPathBlob",
    "GitPathLineStat",
    "GitRunAdmission",
    "GitRunFinalization",
    "GitRunWorkspace",
    "GitRetentionPolicy",
    "GitTerminalReconciliation",
    "MaterializedOverlay",
    "NestedRepositoryError",
    "NoCheckpointChangesError",
    "PreparedWorkspaceWrite",
    "PreparedWorkspaceExecution",
    "RepoStateToken",
    "RepositoryDiagnostics",
    "RepositoryStateChangedError",
    "RepositoryProbe",
    "RestoreCandidate",
    "RunWorkspaceEditResult",
    "RunWorkspaceEditService",
    "WorkspaceGitCoordinator",
    "WorkspaceGitLifecycle",
    "WorkspaceGitObserver",
    "WorkspaceMutationService",
    "WorkspaceMutationReconciliation",
    "WorkspaceWriterAdmission",
    "WorkspaceWriterInterruptedError",
    "WorkspaceWriterReconciliation",
    "WorkspaceWriterScheduler",
    "WorkspaceOverlayConflictError",
    "WorkspacePathNotFoundError",
    "WorkspaceSnapshotError",
    "WorkspaceSnapshotRead",
    "WorkspaceSnapshotService",
    "GitAgentMergeOutcome",
    "GitAgentReconciliation",
    "GitAgentWorkspace",
    "WorkforceGitService",
    "get_default_workforce_git_service",
    "get_default_run_workspace_edit_service",
    "WorkspaceSnapshotUnavailableError",
    "WorkspaceSourceChangedError",
    "get_default_workspace_git_coordinator",
    "get_default_workspace_git_lifecycle",
    "get_default_workspace_mutation_service",
    "get_default_workspace_writer_scheduler",
    "DEFAULT_GIT_RETENTION_POLICY",
]
