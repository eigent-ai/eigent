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

"""Best-effort startup recovery for optional Git-backed workspaces."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.run_journal import SQLiteRunJournal, configured_run_journal_path
from app.workspace_git.backend import GitBackend, GitBackendError
from app.workspace_git.coordinator import WorkspaceGitCoordinator
from app.workspace_git.lifecycle import (
    GitTerminalReconciliation,
    WorkspaceGitLifecycle,
)
from app.workspace_git.mutation import (
    WorkspaceMutationReconciliation,
    WorkspaceMutationService,
)
from app.workspace_git.observer import (
    ExternalGitObservation,
    WorkspaceGitObserver,
)
from app.workspace_git.workforce import (
    GitAgentReconciliation,
    WorkforceGitService,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WorkspaceGitStartupReconciliation:
    """Results from the Git-only portion of Brain startup recovery."""

    workforce: GitAgentReconciliation
    mutations: WorkspaceMutationReconciliation
    terminal: GitTerminalReconciliation
    observation: ExternalGitObservation
    skipped_reason: str | None = None

    @property
    def skipped(self) -> bool:
        return self.skipped_reason is not None


def reconcile_workspace_git_startup(
    journal: SQLiteRunJournal,
) -> WorkspaceGitStartupReconciliation:
    """Recover Git projections without making Git a Brain prerequisite.

    A clean desktop install may not have a system Git executable. Git-backed
    Spaces remain unavailable in that environment, but pure conversation and
    non-Git Spaces must still be able to start. Only Git runtime resolution is
    fail-open here; reconciliation failures after Git resolves still surface.
    """

    try:
        git = GitBackend()
    except GitBackendError as exc:
        reason = str(exc)
        logger.warning(
            "Workspace Git startup reconciliation skipped: %s", reason
        )
        return WorkspaceGitStartupReconciliation(
            workforce=GitAgentReconciliation((), ()),
            mutations=WorkspaceMutationReconciliation((), ()),
            terminal=GitTerminalReconciliation((), ()),
            observation=ExternalGitObservation((), ()),
            skipped_reason=reason,
        )

    state_root = configured_run_journal_path().parent / "workspace-git"
    coordinator = WorkspaceGitCoordinator(
        journal,
        state_root=state_root,
        git_backend=git,
    )
    workforce = WorkforceGitService(
        journal,
        state_root=state_root,
        coordinator=coordinator,
    )
    mutations = WorkspaceMutationService(
        journal,
        state_root=state_root,
        coordinator=coordinator,
        workforce=workforce,
    )
    lifecycle = WorkspaceGitLifecycle(
        journal,
        state_root=state_root,
        coordinator=coordinator,
        workforce=workforce,
    )

    return WorkspaceGitStartupReconciliation(
        workforce=workforce.reconcile_startup(),
        mutations=mutations.reconcile_startup(),
        terminal=lifecycle.finalize_terminal_runs(),
        observation=WorkspaceGitObserver(
            journal,
            git_backend=git,
        ).inspect_all(),
    )
