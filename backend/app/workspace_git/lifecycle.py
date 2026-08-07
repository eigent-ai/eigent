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

"""Promote terminal Run output and archive short-lived Run refs."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from app.run_journal import (
    SQLiteRunJournal,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.workspace_config import canonical_digest
from app.workspace_git.content import ContentRepositoryError
from app.workspace_git.coordinator import WorkspaceGitCoordinator

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GitRunFinalization:
    run_id: str
    outcome: str
    promoted_commit: str | None
    archive_ref: str | None


@dataclass(frozen=True)
class GitTerminalReconciliation:
    finalizations: tuple[GitRunFinalization, ...]
    failed_run_ids: tuple[str, ...]


class WorkspaceGitLifecycle:
    """Finalize only converged private worktrees; never force user state."""

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        state_root: Path,
        coordinator: WorkspaceGitCoordinator | None = None,
    ) -> None:
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.coordinator = coordinator or WorkspaceGitCoordinator(
            journal,
            state_root=self.state_root,
        )
        self.git = self.coordinator.git
        self.content = self.coordinator.content

    def finalize_terminal_runs(self) -> GitTerminalReconciliation:
        values: list[GitRunFinalization] = []
        failed: list[str] = []
        for run in self.journal.list_all_runs():
            if run.status not in {"completed", "failed", "cancelled"}:
                continue
            try:
                value = self.finalize_run(run.run_id)
            except Exception:
                logger.exception(
                    "Terminal Git Run finalization failed",
                    extra={"run_id": run.run_id},
                )
                failed.append(run.run_id)
                continue
            values.append(value)
        return GitTerminalReconciliation(
            finalizations=tuple(values),
            failed_run_ids=tuple(failed),
        )

    def finalize_run(self, run_id: str) -> GitRunFinalization:
        canonical_run = self.journal.get_run(run_id)
        if canonical_run is None:
            raise ContentRepositoryError(f"Run {run_id!r} is unavailable")
        if canonical_run.status not in {"completed", "failed", "cancelled"}:
            return GitRunFinalization(run_id, "deferred_active", None, None)
        run = self.journal.get_run_git_materialization(run_id)
        if run is None or run.materialization_state == "unmaterialized":
            return GitRunFinalization(run_id, "not_materialized", None, None)
        if run.materialization_state == "archived":
            return GitRunFinalization(
                run_id,
                "archived",
                run.promoted_commit,
                run.run_ref,
            )
        change_set = self.journal.get_git_change_set_for_run(run_id)
        if change_set is not None:
            pending_intents = [
                item
                for item in self.journal.list_git_mutation_intents(
                    statuses=("prepared", "needs_attention")
                )
                if item.change_set_id == change_set.change_set_id
            ]
            pending_items = self.journal.list_git_change_set_items(
                change_set.change_set_id,
                states=("pending", "preimage_checkpointed"),
            )
            if (
                pending_intents
                or pending_items
                or change_set.state == "needs_attention"
            ):
                return GitRunFinalization(
                    run_id,
                    "deferred_mutation",
                    run.promoted_commit,
                    None,
                )
            if change_set.state == "open":
                self.journal.update_git_change_set_state(
                    change_set_id=change_set.change_set_id,
                    expected_state="open",
                    state="checkpointed",
                )
        if run.materialization_state == "materialized":
            run = self._promote(run_id)
        if run.materialization_state != "promoted":
            return GitRunFinalization(
                run_id,
                f"deferred_{run.materialization_state}",
                run.promoted_commit,
                None,
            )
        self._refresh_project_projection(run.project_id)
        archived = self._archive(run_id)
        return GitRunFinalization(
            run_id,
            "archived",
            archived.promoted_commit,
            archived.run_ref,
        )

    def _promote(self, run_id: str):
        run = self.journal.get_run_git_materialization(run_id)
        if run is None or not run.worktree_path:
            raise ContentRepositoryError("Run worktree is unavailable")
        project = self.journal.get_project_git_state(run.project_id)
        if project is None or project.integration_head is None:
            raise ContentRepositoryError("Project Integration is unavailable")
        worktree = Path(run.worktree_path)
        if not self.git.is_worktree_clean(worktree):
            return self.journal.mark_run_git_attention(
                run_id=run_id,
                expected_version=run.version,
            )
        head = self.git.current_head(worktree)
        workspace = self.coordinator.promote_run(
            run_id=run_id,
            operation_request_id=f"terminal-promote:{run_id}",
            expected_run_state_digest=self.git.repo_state_token(
                worktree
            ).digest,
            expected_project_version=project.version,
            expected_project_head=project.integration_head,
            expected_run_head=head,
        )
        return workspace.run

    def _refresh_project_projection(self, project_id: str) -> None:
        project = self.journal.get_project_git_state(project_id)
        if (
            project is None
            or project.integration_head is None
            or project.projected_head is None
            or project.worktree_path is None
            or project.integration_head == project.projected_head
        ):
            return
        worktree = Path(project.worktree_path)
        self.coordinator.refresh_project_projection(
            project_id=project_id,
            operation_request_id=f"terminal-project-refresh:{project_id}:{project.version}",
            expected_projection_state_digest=self.git.repo_state_token(
                worktree
            ).digest,
            expected_project_version=project.version,
            expected_integration_head=project.integration_head,
            expected_projected_head=project.projected_head,
        )

    def _archive(self, run_id: str):
        run = self.journal.get_run_git_materialization(run_id)
        if (
            run is None
            or run.materialization_state != "promoted"
            or run.run_ref is None
            or run.worktree_path is None
            or run.promoted_commit is None
        ):
            raise ContentRepositoryError("Run is not ready for archive")
        repository = self.journal.get_git_repository(run.repository_id)
        if repository is None:
            raise ContentRepositoryError("Run repository is unavailable")
        root = Path(repository.root_path)
        worktree = Path(run.worktree_path)
        archive_ref = (
            "refs/eigent/archive/runs/"
            + canonical_digest(
                {
                    "repository_id": run.repository_id,
                    "run_id": run.run_id,
                }
            )[:32]
            + "/integration"
        )
        request_id = f"terminal-archive:{run_id}"
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": run.repository_id,
                    "request_id": request_id,
                }
            )[:32]
        )
        existing_operation = self.journal.get_git_operation(operation_id)
        expected_digest = (
            existing_operation.expected_repo_state_digest
            if existing_operation is not None
            else self.git.repo_state_token(worktree).digest
        )
        if expected_digest is None:
            raise ContentRepositoryError(
                "Run archive operation has no expected RepoStateToken"
            )
        payload = {
            "run_id": run_id,
            "active_ref": run.run_ref,
            "archive_ref": archive_ref,
            "commit_oid": run.promoted_commit,
        }
        with self.content.repository_lock(
            self.content.repository_lock_path(repository.space_id)
        ):
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=run.repository_id,
                request_id=request_id,
                operation_type="run.archive",
                payload_digest=canonical_digest(payload),
                expected_repo_state_digest=expected_digest,
            )
            if operation.status == "completed":
                current = self.journal.get_run_git_materialization(run_id)
                if current is None:
                    raise ContentRepositoryError(
                        "completed archive has no Run state"
                    )
                return current
            if operation.status == "prepared":
                self.journal.mark_git_operation_dispatched(
                    operation_id,
                    observed_repo_state_digest=expected_digest,
                )
            elif operation.status != "dispatched":
                raise ContentRepositoryError(
                    f"Run archive is {operation.status!r}"
                )
            self.git.remove_owned_worktree(
                root,
                worktree_path=worktree,
                expected_ref=run.run_ref,
            )
            self.git.archive_eigent_branch_ref(
                root,
                active_ref=run.run_ref,
                archive_ref=archive_ref,
                expected_oid=run.promoted_commit,
            )
            observed = self.git.repo_state_token(root)
            return self.journal.archive_run_git_materialization(
                operation_id=operation_id,
                run_id=run_id,
                expected_version=run.version,
                expected_run_ref=run.run_ref,
                archive_ref=archive_ref,
                expected_head=run.promoted_commit,
                observed_repo_state_digest=observed.digest,
            )


def get_default_workspace_git_lifecycle() -> WorkspaceGitLifecycle:
    return WorkspaceGitLifecycle(
        get_default_run_journal(),
        state_root=configured_run_journal_path().parent / "workspace-git",
    )
