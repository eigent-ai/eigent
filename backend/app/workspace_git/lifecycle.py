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
import os
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from app.run_journal import (
    GitAgentWorkspaceRecord,
    SQLiteRunJournal,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.utils.workspace_paths import get_eigent_root
from app.workspace_config import canonical_digest
from app.workspace_git.content import ContentRepositoryError
from app.workspace_git.coordinator import WorkspaceGitCoordinator
from app.workspace_git.workforce import WorkforceGitService

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
        workforce: WorkforceGitService | None = None,
    ) -> None:
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.coordinator = coordinator or WorkspaceGitCoordinator(
            journal,
            state_root=self.state_root,
        )
        self.git = self.coordinator.git
        self.content = self.coordinator.content
        self.workforce = workforce or WorkforceGitService(
            journal,
            state_root=self.state_root,
            coordinator=self.coordinator,
        )

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
        try:
            return self._finalize_terminal_run(
                run_id,
                terminal_status=canonical_run.status,
            )
        finally:
            # Git projection/finalization may need attention, but a terminal
            # Task must never retain the physical checkout writer forever.
            self.coordinator.writer_scheduler.finish_task(run_id=run_id)

    def _finalize_terminal_run(
        self,
        run_id: str,
        *,
        terminal_status: str,
    ) -> GitRunFinalization:
        run = self.journal.get_run_git_materialization(run_id)
        binding = (
            self.journal.get_project_workspace_binding(run.project_id)
            if run is not None
            else None
        )
        if (
            run is not None
            and run.materialization_state == "unmaterialized"
            and binding is not None
            and binding.checkout_mode
            in {"primary_checkout", "explicit_worktree"}
        ):
            root = Path(binding.worktree_path)
            ref_suffix = (
                "completed"
                if terminal_status == "completed"
                else f"recovery-{terminal_status}"
            )
            task_ref = (
                "refs/eigent/tasks/"
                + canonical_digest({"run_id": run_id})[:32]
                + f"/{ref_suffix}"
            )
            if run.promoted_commit is not None:
                # Startup reconciliation visits every terminal Run. The
                # shared checkout may have advanced through many later Runs,
                # so replay must use the Run's persisted boundary rather than
                # interpreting today's HEAD as a new terminal commit.
                self.git.update_eigent_ref(
                    root,
                    task_ref,
                    run.promoted_commit,
                )
                return GitRunFinalization(
                    run_id,
                    (
                        "committed_primary"
                        if terminal_status == "completed"
                        else f"preserved_primary_{terminal_status}"
                    ),
                    run.promoted_commit,
                    task_ref,
                )
            terminal_commit = self.git.current_head(root)
            if terminal_commit is None:
                return GitRunFinalization(
                    run_id,
                    "direct_no_commit",
                    None,
                    None,
                )
            self.git.update_eigent_ref(root, task_ref, terminal_commit)
            completed = self.journal.complete_direct_git_run(
                run_id=run_id,
                expected_base_commit=run.workspace_base_commit,
                terminal_commit=terminal_commit,
            )
            return GitRunFinalization(
                run_id,
                (
                    "committed_primary"
                    if terminal_status == "completed"
                    else f"preserved_primary_{terminal_status}"
                ),
                completed.promoted_commit,
                task_ref,
            )
        if run is None or run.materialization_state == "unmaterialized":
            return GitRunFinalization(run_id, "not_materialized", None, None)
        if run.materialization_state == "archived":
            try:
                self._auto_apply_project_to_space(run_id)
            except Exception:
                logger.exception(
                    "Archived Project output apply needs attention",
                    extra={"run_id": run_id, "project_id": run.project_id},
                )
            return GitRunFinalization(
                run_id,
                "archived",
                run.promoted_commit,
                run.run_ref,
            )
        agent_workspaces = self.journal.list_git_agent_workspaces(
            run_id=run_id
        )
        run_head = (
            self.git.current_head(Path(run.worktree_path))
            if run.worktree_path
            else None
        )
        if any(
            self._agent_workspace_requires_deferral(item, run_head)
            for item in agent_workspaces
        ):
            return GitRunFinalization(
                run_id,
                "deferred_agent_workspace",
                run.promoted_commit,
                None,
            )
        change_sets = [
            item
            for item in self.journal.list_git_change_sets()
            if item.run_id == run_id
        ]
        pending_mutation_intents = self.journal.list_git_mutation_intents(
            statuses=("prepared", "needs_attention")
        )
        for change_set in change_sets:
            pending_intents = [
                item
                for item in pending_mutation_intents
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
        self._archive_agent_workspaces(run_id)
        self._refresh_project_projection(run.project_id)
        try:
            self._auto_apply_project_to_space(run_id)
        except Exception:
            logger.exception(
                "Terminal Project output apply needs attention",
                extra={"run_id": run_id, "project_id": run.project_id},
            )
        archived = self._archive(run_id)
        return GitRunFinalization(
            run_id,
            "archived",
            archived.promoted_commit,
            archived.run_ref,
        )

    def prepare_successful_run(self, run_id: str) -> GitRunFinalization:
        """Promote and safely expose a successful Run before its manifest.

        Agent and Run worktrees remain internal implementation details. For an
        Eigent-created Space, a conflict-free Project result is projected into
        the visible Space root before Artifact discovery. Archival still waits
        for the durable terminal event.
        """

        canonical_run = self.journal.get_run(run_id)
        if canonical_run is None:
            raise ContentRepositoryError(f"Run {run_id!r} is unavailable")
        if canonical_run.status in {"completed", "failed", "cancelled"}:
            return GitRunFinalization(run_id, "already_terminal", None, None)
        run = self.journal.get_run_git_materialization(run_id)
        if run is None or run.materialization_state == "unmaterialized":
            return GitRunFinalization(run_id, "not_materialized", None, None)
        agent_workspaces = self.journal.list_git_agent_workspaces(
            run_id=run_id
        )
        run_head = (
            self.git.current_head(Path(run.worktree_path))
            if run.worktree_path
            else None
        )
        if any(
            self._agent_workspace_requires_deferral(item, run_head)
            for item in agent_workspaces
        ):
            return GitRunFinalization(
                run_id, "deferred_agent_workspace", run.promoted_commit, None
            )
        change_sets = [
            item
            for item in self.journal.list_git_change_sets()
            if item.run_id == run_id
        ]
        pending_mutation_intents = self.journal.list_git_mutation_intents(
            statuses=("prepared", "needs_attention")
        )
        for change_set in change_sets:
            if (
                change_set.state == "needs_attention"
                or any(
                    item.change_set_id == change_set.change_set_id
                    for item in pending_mutation_intents
                )
                or self.journal.list_git_change_set_items(
                    change_set.change_set_id,
                    states=("pending", "preimage_checkpointed"),
                )
            ):
                return GitRunFinalization(
                    run_id, "deferred_mutation", run.promoted_commit, None
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
        try:
            applied = self._auto_apply_project_to_space(run_id)
        except Exception:
            logger.exception(
                "Automatic Project output apply needs attention",
                extra={"run_id": run_id, "project_id": run.project_id},
            )
            applied = False
        return GitRunFinalization(
            run_id,
            "prepared_space" if applied else "prepared_project",
            run.promoted_commit,
            None,
        )

    def _auto_apply_project_to_space(self, run_id: str) -> bool:
        run = self.journal.get_run_git_materialization(run_id)
        if (
            run is None
            or run.materialization_state not in {"promoted", "archived"}
            or run.workspace_base_commit is None
            or run.promoted_commit is None
        ):
            return False
        project = self.journal.get_project_git_state(run.project_id)
        repository = self.journal.get_git_repository(run.repository_id)
        if (
            project is None
            or repository is None
            or not project.pending_apply
            or project.integration_head != run.promoted_commit
            or project.projected_head != run.promoted_commit
            or project.worktree_path is None
            or not self._is_eigent_managed_space(
                repository.root_path, repository.ownership
            )
        ):
            return False

        root = Path(repository.root_path).expanduser().resolve()
        source_root = Path(project.worktree_path).expanduser().resolve()
        changes = self.git.changed_paths_between(
            root,
            base_commit=run.workspace_base_commit,
            target_commit=run.promoted_commit,
        )
        # Deletions and type changes require an explicit user-visible Apply;
        # automatic projection is intentionally limited to regular outputs.
        if len(changes) > 5000 or any(
            item.status in {"D", "T"} for item in changes
        ):
            return False
        paths = tuple(item.relative_path for item in changes)
        path_sources = {
            item.relative_path: (
                "agent_created" if item.status == "A" else "agent_modified"
            )
            for item in changes
        }
        if not paths:
            return False

        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": repository.repository_id,
                    "request_id": f"terminal-auto-apply:{run_id}",
                }
            )[:32]
        )
        payload = {
            "run_id": run_id,
            "project_id": run.project_id,
            "base_commit": run.workspace_base_commit,
            "target_commit": run.promoted_commit,
            "paths": list(paths),
        }
        with self.content.repository_lock(
            self.content.repository_lock_path(repository.space_id)
        ):
            current_token = self.git.repo_state_token(root)
            existing_operation = self.journal.get_git_operation(operation_id)
            expected_digest = (
                existing_operation.expected_repo_state_digest
                if existing_operation is not None
                else current_token.digest
            )
            if expected_digest is None:
                raise ContentRepositoryError(
                    "Project auto-apply has no expected RepoStateToken"
                )
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=repository.repository_id,
                request_id=f"terminal-auto-apply:{run_id}",
                operation_type="project.auto_apply",
                payload_digest=canonical_digest(payload),
                expected_repo_state_digest=expected_digest,
            )
            if operation.status == "completed":
                return True

            plan: list[tuple[Path, Path, str, str | None]] = []
            for relative_path in paths:
                relative = Path(relative_path)
                if ".git" in relative.parts:
                    return False
                source = source_root / relative
                target = root / relative
                try:
                    target.resolve(strict=False).relative_to(root)
                except ValueError:
                    return False
                if source.is_symlink() or not source.is_file():
                    return False
                desired_oid = self.git.blob_oid_at_path(
                    root, run.promoted_commit, relative_path
                )
                if desired_oid is None:
                    return False
                base_oid = self.git.blob_oid_at_path(
                    root, run.workspace_base_commit, relative_path
                )
                if target.exists() or target.is_symlink():
                    if target.is_symlink() or not target.is_file():
                        return False
                    observed_oid = self.git.hash_worktree_file(root, target)
                    if observed_oid == desired_oid:
                        continue
                    if base_oid is None or observed_oid != base_oid:
                        return False
                    expected_target_oid = observed_oid
                elif base_oid is not None:
                    return False
                else:
                    expected_target_oid = None
                plan.append((source, target, desired_oid, expected_target_oid))

            if operation.status == "prepared":
                self.journal.mark_git_operation_dispatched(
                    operation_id,
                    observed_repo_state_digest=current_token.digest,
                )
            elif operation.status != "dispatched":
                raise ContentRepositoryError(
                    f"Project auto-apply is {operation.status!r}"
                )

            for source, target, desired_oid, expected_target_oid in plan:
                target.parent.mkdir(parents=True, exist_ok=True)
                descriptor, temporary_name = tempfile.mkstemp(
                    prefix=".eigent-apply-", dir=target.parent
                )
                os.close(descriptor)
                temporary = Path(temporary_name)
                try:
                    shutil.copy2(source, temporary)
                    if (
                        self.git.hash_worktree_file(root, temporary)
                        != desired_oid
                    ):
                        raise ContentRepositoryError(
                            "Project output changed during automatic apply"
                        )
                    if target.exists() or target.is_symlink():
                        if target.is_symlink() or not target.is_file():
                            raise ContentRepositoryError(
                                "Space output target changed during apply"
                            )
                        current_target_oid = self.git.hash_worktree_file(
                            root, target
                        )
                        if current_target_oid == desired_oid:
                            continue
                        if (
                            expected_target_oid is None
                            or current_target_oid != expected_target_oid
                        ):
                            raise ContentRepositoryError(
                                "Space output target changed during apply"
                            )
                    elif expected_target_oid is not None:
                        raise ContentRepositoryError(
                            "Space output target disappeared during apply"
                        )
                    os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)

            observed = self.git.repo_state_token(root)
            self.journal.complete_project_auto_apply(
                operation_id=operation_id,
                project_id=run.project_id,
                expected_version=project.version,
                expected_integration_head=run.promoted_commit,
                applied_path_sources=path_sources,
                observed_repo_state_digest=observed.digest,
            )
        return True

    @staticmethod
    def _is_eigent_managed_space(root_path: str, ownership: str) -> bool:
        if ownership == "eigent_owned":
            return True
        # Compatibility for blank Spaces created while the Renderer always
        # sent eigent_owned_space=false. Only the Brain-managed Space layout is
        # eligible; arbitrary adopted folders keep explicit Apply semantics.
        root = Path(root_path).expanduser().resolve()
        managed_root = get_eigent_root().expanduser().resolve()
        try:
            relative = root.relative_to(managed_root)
        except ValueError:
            return False
        return (
            len(relative.parts) == 2
            and relative.parts[0].startswith("user_")
            and relative.parts[1].startswith("space_")
        )

    def _archive_agent_workspaces(self, run_id: str) -> None:
        for record in self.journal.list_git_agent_workspaces(run_id=run_id):
            if record.state == "archived":
                continue
            if (
                record.state not in {"ready", "merged"}
                or record.head_commit is None
            ):
                raise ContentRepositoryError(
                    f"Agent workspace {record.workspace_id!r} is not converged"
                )
            repository = self.journal.get_git_repository(record.repository_id)
            if repository is None:
                raise ContentRepositoryError(
                    "Agent workspace repository is unavailable"
                )
            timestamp = time.time()
            request_id = f"terminal-agent-archive:{record.workspace_id}"
            lease_token = canonical_digest(
                {"workspace_id": record.workspace_id, "request": request_id}
            )
            claimed = self.journal.claim_git_agent_workspace(
                workspace_id=record.workspace_id,
                run_id=record.run_id,
                repository_id=record.repository_id,
                agent_id=record.agent_id,
                agent_ref=record.agent_ref,
                worktree_path=record.worktree_path,
                base_commit=record.base_commit,
                lease_owner=request_id,
                lease_token=lease_token,
                lease_until=timestamp + self.workforce.lease_seconds,
                now=timestamp,
            )
            operation_id = self._agent_archive_operation_id(record)
            archive_ref = self._agent_archive_ref(record)
            root = Path(repository.root_path)
            worktree = Path(record.worktree_path)
            with self.content.repository_lock(
                self.content.repository_lock_path(repository.space_id)
            ):
                current_state = self.git.repo_state_token(root)
                existing = self.journal.get_git_operation(operation_id)
                operation = self.journal.begin_git_operation(
                    operation_id=operation_id,
                    repository_id=record.repository_id,
                    request_id=request_id,
                    operation_type="agent.archive",
                    payload_digest=canonical_digest(
                        {
                            "workspace_id": record.workspace_id,
                            "active_ref": record.agent_ref,
                            "archive_ref": archive_ref,
                            "head_commit": record.head_commit,
                        }
                    ),
                    expected_repo_state_digest=(
                        existing.expected_repo_state_digest
                        if existing is not None
                        else current_state.digest
                    ),
                )
                if operation.status == "prepared":
                    self.journal.mark_git_operation_dispatched(
                        operation_id,
                        observed_repo_state_digest=current_state.digest,
                    )
                self.git.remove_owned_worktree(
                    root,
                    worktree_path=worktree,
                    expected_ref=record.agent_ref,
                )
                self.git.archive_eigent_branch_ref(
                    root,
                    active_ref=record.agent_ref,
                    archive_ref=archive_ref,
                    expected_oid=record.head_commit,
                )
                observed = self.git.repo_state_token(root)
                self.journal.complete_git_operation(
                    operation_id,
                    result={
                        "workspace_id": record.workspace_id,
                        "archive_ref": archive_ref,
                        "commit_oid": record.head_commit,
                    },
                    observed_repo_state_digest=observed.digest,
                )
                self.journal.transition_git_agent_workspace(
                    claimed.workspace_id,
                    lease_token=lease_token,
                    expected_state=claimed.state,
                    state="archived",
                    head_commit=record.head_commit,
                    last_operation_id=operation_id,
                    release_lease=True,
                )

    def _agent_workspace_requires_deferral(
        self,
        record: GitAgentWorkspaceRecord,
        run_head: str | None,
    ) -> bool:
        if record.state in {
            "admitted",
            "materializing",
            "merging",
            "conflicted",
            "needs_attention",
        }:
            return True
        if record.state != "ready":
            return False
        if record.head_commit != run_head:
            return True
        worktree = Path(record.worktree_path)
        if worktree.exists():
            return not self.git.is_worktree_clean(worktree)
        # Terminal archival updates Git before SQLite. A missing no-op Agent
        # worktree is therefore converged only when the deterministic archive
        # ref already holds the exact durable Agent head; finalization can
        # safely replay the remaining operation/state writes.
        repository = self.journal.get_git_repository(record.repository_id)
        return (
            repository is None
            or record.head_commit is None
            or self.git.ref_oid(
                Path(repository.root_path),
                self._agent_archive_ref(record),
            )
            != record.head_commit
        )

    @staticmethod
    def _agent_archive_operation_id(record: GitAgentWorkspaceRecord) -> str:
        return (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": record.repository_id,
                    "request_id": (
                        f"terminal-agent-archive:{record.workspace_id}"
                    ),
                }
            )[:32]
        )

    @staticmethod
    def _agent_archive_ref(record: GitAgentWorkspaceRecord) -> str:
        return (
            "refs/eigent/archive/runs/"
            + canonical_digest(
                {
                    "repository_id": record.repository_id,
                    "run_id": record.run_id,
                }
            )[:32]
            + "/agents/"
            + canonical_digest({"agent_id": record.agent_id})[:24]
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
