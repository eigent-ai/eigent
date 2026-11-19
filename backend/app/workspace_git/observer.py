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

"""Detect non-Eigent changes in long-lived private Git worktrees."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from app.run_journal import SQLiteRunJournal
from app.workspace_git.backend import GitBackend

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ExternalGitChange:
    repository_id: str
    owner_role: str
    owner_id: str
    worktree_path: str
    expected_head: str | None
    observed_head: str | None
    operation_state: str


@dataclass(frozen=True)
class ExternalGitObservation:
    changes: tuple[ExternalGitChange, ...]
    failed_repository_ids: tuple[str, ...]


class WorkspaceGitObserver:
    """Classify private-worktree divergence without touching User files."""

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        git_backend: GitBackend | None = None,
    ) -> None:
        self.journal = journal
        self.git = git_backend or GitBackend()

    def inspect_all(self) -> ExternalGitObservation:
        changes: list[ExternalGitChange] = []
        failed: list[str] = []
        projects = self.journal.list_project_git_states()
        runs = self.journal.list_run_git_materializations()
        open_change_sets = {
            value.change_set_id: value
            for value in self.journal.list_git_change_sets(states=("open",))
        }
        runs_with_pending_intents = {
            open_change_sets[intent.change_set_id].run_id
            for intent in self.journal.list_git_mutation_intents(
                statuses=("prepared",)
            )
            if intent.change_set_id in open_change_sets
        }
        repositories_with_dispatched_operations = {
            operation.repository_id
            for operation in self.journal.list_git_operations(
                statuses=("dispatched",)
            )
        }

        for repository in self.journal.list_git_repositories():
            if repository.repository_role != "content":
                continue
            try:
                if repository.repository_id in (
                    repositories_with_dispatched_operations
                ):
                    continue
                for project in projects:
                    if project.repository_id != repository.repository_id:
                        continue
                    change = self._inspect_project(project)
                    if change is not None:
                        changes.append(change)
                for run in runs:
                    if (
                        run.repository_id != repository.repository_id
                        or run.run_id in runs_with_pending_intents
                    ):
                        continue
                    change = self._inspect_run(run)
                    if change is not None:
                        changes.append(change)
            except Exception:
                logger.exception(
                    "Git external-mutation observation failed for one repository",
                    extra={"repository_id": repository.repository_id},
                )
                failed.append(repository.repository_id)
        return ExternalGitObservation(
            changes=tuple(changes),
            failed_repository_ids=tuple(failed),
        )

    def _inspect_project(self, project) -> ExternalGitChange | None:
        if (
            project.state != "ready"
            or project.worktree_path is None
            or project.projected_head is None
        ):
            return None
        root = Path(project.worktree_path)
        diagnostics = self.git.diagnostics(root)
        if self.git.worktree_matches_commit(root, project.projected_head):
            return None
        self.journal.mark_project_git_attention(
            project_id=project.project_id,
            expected_version=project.version,
        )
        return ExternalGitChange(
            repository_id=project.repository_id,
            owner_role="project",
            owner_id=project.project_id,
            worktree_path=str(root),
            expected_head=project.projected_head,
            observed_head=diagnostics.state_token.head_oid,
            operation_state=diagnostics.state_token.operation_state,
        )

    def _inspect_run(self, run) -> ExternalGitChange | None:
        if (
            run.materialization_state not in {"materialized", "promoted"}
            or run.worktree_path is None
        ):
            return None
        root = Path(run.worktree_path)
        checkpoint = self.journal.get_latest_git_checkpoint_for_target(
            repository_id=run.repository_id,
            target_role="run",
            target_id=run.run_id,
        )
        expected_head = (
            checkpoint.commit_oid
            if checkpoint is not None
            else run.workspace_base_commit
        )
        if expected_head is None:
            return None
        diagnostics = self.git.diagnostics(root)
        if self.git.worktree_matches_commit(root, expected_head):
            return None
        self.journal.mark_run_git_attention(
            run_id=run.run_id,
            expected_version=run.version,
        )
        return ExternalGitChange(
            repository_id=run.repository_id,
            owner_role="run",
            owner_id=run.run_id,
            worktree_path=str(root),
            expected_head=expected_head,
            observed_head=diagnostics.state_token.head_oid,
            operation_state=diagnostics.state_token.operation_state,
        )
