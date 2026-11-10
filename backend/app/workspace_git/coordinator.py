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

"""Project/Run Git workspace ownership and lazy admission contracts."""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

from app.run_journal import (
    OptimisticConcurrencyError,
    ProjectGitStateRecord,
    ProjectWorkspaceBindingRecord,
    RunGitMaterializationRecord,
    SQLiteRunJournal,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.workspace_config import canonical_digest
from app.workspace_git.backend import GitBackend, GitBackendError
from app.workspace_git.content import (
    ContentRepositoryError,
    ContentRepositoryService,
    RepositoryStateChangedError,
)
from app.workspace_git.scheduler import (
    WorkspaceWriterAdmission,
    WorkspaceWriterScheduler,
)


@dataclass(frozen=True)
class GitRunAdmission:
    project: ProjectGitStateRecord
    run: RunGitMaterializationRecord
    binding: ProjectWorkspaceBindingRecord
    writer: WorkspaceWriterAdmission


@dataclass(frozen=True)
class GitRunWorkspace:
    project: ProjectGitStateRecord
    run: RunGitMaterializationRecord
    project_worktree: Path
    run_worktree: Path


class WorkspaceGitCoordinator:
    """Own Project/Run workspace state without eager worktree creation."""

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        state_root: Path,
        git_backend: GitBackend | None = None,
        writer_scheduler: WorkspaceWriterScheduler | None = None,
    ) -> None:
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.git = git_backend or GitBackend()
        self.content = ContentRepositoryService(
            journal,
            state_root=self.state_root,
            git_backend=self.git,
        )
        self.writer_scheduler = writer_scheduler or WorkspaceWriterScheduler(
            journal
        )

    def admit_run(
        self,
        *,
        space_id: str,
        project_id: str,
        run_id: str,
        task_id: str | None = None,
        session_mode: str = "workforce",
    ) -> GitRunAdmission | None:
        """Pin the latest Project/User commit and remain unmaterialized.

        A Space without an enabled Content Repository remains a valid non-Git
        execution environment. A direct Run waiting for the shared checkout
        may refresh this provisional base exactly once after it acquires the
        writer lease and before its Attempt starts. After activation, replay
        always returns the final pinned boundary.

        TODO(project-fork): when Project forking is implemented, admission
        must carry the user's explicit workspace choice: continue the source
        Project worktree/branch, or create a new Project worktree/branch. Do
        not infer that choice from the prompt or silently fork every Run.
        """

        repository = self.journal.get_space_git_repository(space_id=space_id)
        if repository is None:
            return None
        status = self.content.status(repository.repository_id)
        probe = self.git.probe(Path(repository.root_path))
        user_ref = f"refs/heads/{probe.branch}" if probe.branch else None
        binding = self.journal.get_project_workspace_binding(project_id)
        if binding is None:
            binding = self.journal.ensure_project_workspace_binding(
                project_id=project_id,
                repository_id=repository.repository_id,
                checkout_id=(
                    "checkout_"
                    + canonical_digest(
                        {
                            "kind": "primary_checkout",
                            "repository_id": repository.repository_id,
                            "root_path_digest": repository.root_path_digest,
                        }
                    )[:32]
                ),
                checkout_mode="primary_checkout",
                target_ref=user_ref or "refs/heads/main",
                worktree_path=repository.root_path,
            )
        elif binding.repository_id != repository.repository_id:
            raise ContentRepositoryError(
                f"Project {project_id!r} is bound to another repository"
            )
        project, run = self.journal.admit_git_run_workspace(
            run_id=run_id,
            project_id=project_id,
            repository_id=repository.repository_id,
            user_head=status.diagnostics.state_token.head_oid,
            user_ref=user_ref,
        )
        writer_binding = binding
        if session_mode != "single-agent":
            isolated_digest = canonical_digest(
                {
                    "kind": "internal_run_checkout",
                    "repository_id": repository.repository_id,
                    "run_id": run_id,
                }
            )[:32]
            writer_binding = replace(
                binding,
                checkout_id=f"checkout_internal_{isolated_digest}",
                checkout_mode="explicit_worktree",
                target_ref=f"refs/eigent/runs/{isolated_digest}/integration",
                worktree_path=str(
                    self.state_root / "worktrees" / "runs" / isolated_digest
                ),
            )
        writer = self.writer_scheduler.admit_task(
            run_id=run_id,
            task_id=task_id or run_id,
            project_id=project_id,
            binding=writer_binding,
        )
        return GitRunAdmission(
            project=project,
            run=run,
            binding=binding,
            writer=writer,
        )

    def refresh_run_boundary_after_writer_acquired(
        self,
        *,
        run_id: str,
        task_id: str,
        attempt_id: str,
    ) -> RunGitMaterializationRecord | None:
        """Align a queued direct Run with checkout HEAD before activation.

        Internal workforce checkouts retain their immutable admission base.
        A normal Project checkout is refreshed only while its writer lease is
        acquired and its Attempt is still pending; the journal enforces both
        facts atomically with the boundary audit event.
        """

        run = self.journal.get_run_git_materialization(run_id)
        if run is None:
            return None
        if self.journal.get_git_change_set_for_run(run_id) is not None:
            # The Run already executed on this boundary: durable ChangeSet
            # preimages are anchored to it, so a resumed Attempt must keep
            # the earned base even though checkout HEAD moved (the Run's own
            # checkpoints advance HEAD past the admission commit). Refresh
            # exists only for queued Runs that never started; the journal
            # guard rejects any other attempt to move this boundary.
            return run
        binding = self.journal.get_project_workspace_binding(run.project_id)
        if binding is None:
            raise ContentRepositoryError(
                f"Project {run.project_id!r} has no workspace binding"
            )
        request_id = self.writer_scheduler.request_id(run_id)
        request = self.journal.get_workspace_writer_request(request_id)
        if request is None:
            # Git admission is optional and can fail after the Run boundary
            # row is created. File mutation will remain fail-closed because it
            # separately requires this lease, while pure conversation can run.
            return run
        if (
            request.project_id != run.project_id
            or request.repository_id != run.repository_id
            or request.task_id != task_id
        ):
            raise ContentRepositoryError(
                "Run workspace writer admission does not match its Git state"
            )
        if request.checkout_id != binding.checkout_id:
            # Multi-Agent execution owns an internal checkout which is lazily
            # materialized from the immutable admission boundary.
            isolated_digest = canonical_digest(
                {
                    "kind": "internal_run_checkout",
                    "repository_id": run.repository_id,
                    "run_id": run_id,
                }
            )[:32]
            if (
                request.checkout_id == f"checkout_internal_{isolated_digest}"
                and request.target_ref
                == f"refs/eigent/runs/{isolated_digest}/integration"
            ):
                return run
            raise ContentRepositoryError(
                "Run workspace writer targets an unknown checkout"
            )
        if request.target_ref != binding.target_ref:
            raise ContentRepositoryError(
                "Run workspace writer targets another Project branch"
            )
        root = Path(binding.worktree_path).expanduser().resolve()
        probe = self.git.probe(root)
        observed_ref = f"refs/heads/{probe.branch}" if probe.branch else None
        if not probe.is_repository or not probe.owns_requested_root:
            raise ContentRepositoryError(
                "bound Project checkout is not the Content Repository root"
            )
        if observed_ref != binding.target_ref:
            raise ContentRepositoryError(
                "bound Project checkout changed branch while the Run waited"
            )
        current_head = probe.head_oid
        if current_head is None or current_head == run.workspace_base_commit:
            return run
        return self.journal.refresh_git_run_base_after_writer_acquired(
            run_id=run_id,
            attempt_id=attempt_id,
            writer_request_id=request_id,
            expected_task_id=task_id,
            expected_checkout_id=binding.checkout_id,
            expected_base_commit=run.workspace_base_commit,
            base_commit=current_head,
            base_ref=binding.target_ref,
        )

    def ensure_run_materialized(
        self,
        *,
        run_id: str,
        operation_request_id: str,
        expected_repo_state_digest: str,
        expected_project_version: int,
        expected_project_head: str | None,
    ) -> GitRunWorkspace:
        run = self.journal.get_run_git_materialization(run_id)
        if run is None:
            raise ContentRepositoryError(
                f"Run {run_id!r} has no admitted Git workspace"
            )
        project = self.journal.get_project_git_state(run.project_id)
        if project is None:
            raise ContentRepositoryError(
                f"Project {run.project_id!r} has no Git state"
            )
        repository = self.journal.get_git_repository(run.repository_id)
        if repository is None:
            raise ContentRepositoryError("Run Content Repository is missing")
        if run.materialization_state == "materialized":
            if not run.worktree_path or not project.worktree_path:
                raise ContentRepositoryError(
                    "materialized Run is missing a persisted worktree"
                )
            return GitRunWorkspace(
                project=project,
                run=run,
                project_worktree=Path(project.worktree_path),
                run_worktree=Path(run.worktree_path),
            )
        if run.materialization_state not in {
            "unmaterialized",
            "materializing",
        }:
            raise ContentRepositoryError(
                f"Run workspace is {run.materialization_state!r}"
            )
        if project.state == "needs_attention":
            raise ContentRepositoryError(
                "Project Integration needs attention before materialization"
            )
        if (
            project.version != expected_project_version
            or project.integration_head != expected_project_head
        ):
            raise OptimisticConcurrencyError(
                "Project Integration changed before Run materialization"
            )
        root = Path(repository.root_path)
        status = self.content.status(repository.repository_id)
        observed = status.diagnostics.state_token
        if observed.digest != expected_repo_state_digest:
            raise RepositoryStateChangedError(
                "User Worktree changed before Run materialization"
            )
        if status.repository.state != "ready":
            raise ContentRepositoryError(
                f"repository is {status.repository.state!r}"
            )

        project_ref = project.integration_ref or self._project_ref(
            run.repository_id,
            run.project_id,
        )
        run_ref = run.run_ref or self._run_ref(run.repository_id, run.run_id)
        project_worktree = self._project_worktree(
            repository.space_id,
            run.project_id,
        )
        run_worktree = self._run_worktree(repository.space_id, run.run_id)
        payload = {
            "run_id": run.run_id,
            "project_id": run.project_id,
            "expected_project_version": expected_project_version,
            "expected_project_head": expected_project_head,
            "project_ref": project_ref,
            "run_ref": run_ref,
            "workspace_base_commit": run.workspace_base_commit,
        }
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": repository.repository_id,
                    "request_id": operation_request_id,
                }
            )[:32]
        )

        lock_path = self.content.repository_lock_path(repository.space_id)
        with self.content.repository_lock(lock_path):
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=repository.repository_id,
                request_id=operation_request_id,
                operation_type="run.materialize",
                payload_digest=canonical_digest(payload),
                expected_repo_state_digest=expected_repo_state_digest,
            )
            if operation.status == "completed":
                persisted = self.journal.get_run_git_materialization(run_id)
                current_project = self.journal.get_project_git_state(
                    run.project_id
                )
                if (
                    persisted is None
                    or current_project is None
                    or not persisted.worktree_path
                    or not current_project.worktree_path
                ):
                    raise ContentRepositoryError(
                        "completed materialization has incomplete state"
                    )
                return GitRunWorkspace(
                    project=current_project,
                    run=persisted,
                    project_worktree=Path(current_project.worktree_path),
                    run_worktree=Path(persisted.worktree_path),
                )
            self.journal.dispatch_git_run_materialization(
                operation_id=operation_id,
                run_id=run_id,
                observed_repo_state_digest=observed.digest,
            )

            project_head = project.integration_head
            if project_head is None:
                project_head = self.git.ref_oid(root, project_ref)
            if project_head is None:
                project_head = run.workspace_base_commit
            if project_head is None:
                project_head = self.git.create_anchor_commit(
                    root,
                    message=(
                        f"Initialize Eigent Project workspace {run.project_id}"
                    ),
                )
            self.git.ensure_worktree(
                root,
                worktree_path=project_worktree,
                ref_name=project_ref,
                commit_oid=project_head,
            )
            run_base_commit = run.workspace_base_commit or project_head
            run_base_ref = run.workspace_base_ref or project_ref
            self.git.ensure_worktree(
                root,
                worktree_path=run_worktree,
                ref_name=run_ref,
                commit_oid=run_base_commit,
            )
            observed_after = self.git.repo_state_token(root)
            project, run = self.journal.complete_git_run_materialization(
                operation_id=operation_id,
                run_id=run_id,
                expected_project_version=expected_project_version,
                expected_project_head=expected_project_head,
                project_ref=project_ref,
                project_head=project_head,
                project_worktree_path=str(project_worktree),
                run_base_ref=run_base_ref,
                run_base_commit=run_base_commit,
                run_ref=run_ref,
                run_worktree_path=str(run_worktree),
                observed_repo_state_digest=observed_after.digest,
            )
            return GitRunWorkspace(
                project=project,
                run=run,
                project_worktree=project_worktree,
                run_worktree=run_worktree,
            )

    def promote_run(
        self,
        *,
        run_id: str,
        operation_request_id: str,
        expected_run_state_digest: str,
        expected_project_version: int,
        expected_project_head: str,
        expected_run_head: str,
    ) -> GitRunWorkspace:
        run = self.journal.get_run_git_materialization(run_id)
        if run is None:
            raise ContentRepositoryError(
                f"Run {run_id!r} has no admitted Git workspace"
            )
        project = self.journal.get_project_git_state(run.project_id)
        repository = self.journal.get_git_repository(run.repository_id)
        if project is None or repository is None:
            raise ContentRepositoryError("Run Git owner is unavailable")
        if run.materialization_state == "promoted":
            if not run.worktree_path or not project.worktree_path:
                raise ContentRepositoryError(
                    "promoted Run is missing its worktree record"
                )
            return GitRunWorkspace(
                project=project,
                run=run,
                project_worktree=Path(project.worktree_path),
                run_worktree=Path(run.worktree_path),
            )
        if run.materialization_state != "materialized":
            raise ContentRepositoryError(
                f"Run workspace cannot promote from "
                f"{run.materialization_state!r}"
            )
        if project.state == "needs_attention":
            raise ContentRepositoryError(
                "Project Integration needs attention before promotion"
            )
        if (
            project.version != expected_project_version
            or project.integration_head != expected_project_head
        ):
            raise OptimisticConcurrencyError(
                "Project Integration changed before Run promotion"
            )
        if run.workspace_base_commit != expected_project_head:
            raise OptimisticConcurrencyError(
                "Run base is stale and requires merge simulation"
            )
        if (
            not run.worktree_path
            or not run.run_ref
            or not project.integration_ref
        ):
            raise ContentRepositoryError("Run materialization is incomplete")
        run_worktree = Path(run.worktree_path)
        project_worktree = Path(project.worktree_path or "")
        if not project.worktree_path:
            raise ContentRepositoryError("Project worktree is unavailable")
        run_token = self.git.repo_state_token(run_worktree)
        if run_token.digest != expected_run_state_digest:
            raise RepositoryStateChangedError(
                "Run worktree changed before promotion"
            )
        if not self.git.is_worktree_clean(run_worktree):
            raise ContentRepositoryError(
                "Run worktree has uncheckpointed changes"
            )
        run_head = self.git.current_head(run_worktree)
        if run_head != expected_run_head:
            raise RepositoryStateChangedError(
                "Run HEAD changed before promotion"
            )
        payload = {
            "run_id": run_id,
            "expected_project_version": expected_project_version,
            "expected_project_head": expected_project_head,
            "expected_run_head": expected_run_head,
        }
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": repository.repository_id,
                    "request_id": operation_request_id,
                }
            )[:32]
        )

        with self.content.repository_lock(
            self.content.repository_lock_path(repository.space_id)
        ):
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=repository.repository_id,
                request_id=operation_request_id,
                operation_type="run.promote",
                payload_digest=canonical_digest(payload),
                expected_repo_state_digest=expected_run_state_digest,
            )
            if operation.status != "completed":
                self.journal.mark_git_operation_dispatched(
                    operation_id,
                    observed_repo_state_digest=run_token.digest,
                )
                project_ref_head = self.git.ref_oid(
                    Path(repository.root_path),
                    project.integration_ref,
                )
                if project_ref_head == expected_project_head:
                    self.git.update_eigent_ref(
                        Path(repository.root_path),
                        project.integration_ref,
                        expected_run_head,
                        expected_oid=expected_project_head,
                    )
                elif project_ref_head != expected_run_head:
                    raise OptimisticConcurrencyError(
                        "Project ref changed outside the persisted CAS"
                    )
                observed_after = self.git.repo_state_token(run_worktree)
                project, run = self.journal.complete_git_run_promotion(
                    operation_id=operation_id,
                    run_id=run_id,
                    expected_project_version=expected_project_version,
                    expected_project_head=expected_project_head,
                    promoted_commit=expected_run_head,
                    observed_repo_state_digest=observed_after.digest,
                )
            else:
                project = self.journal.get_project_git_state(run.project_id)
                run = self.journal.get_run_git_materialization(run_id)
                if project is None or run is None:
                    raise ContentRepositoryError(
                        "completed promotion has incomplete state"
                    )
            return GitRunWorkspace(
                project=project,
                run=run,
                project_worktree=project_worktree,
                run_worktree=run_worktree,
            )

    def refresh_project_projection(
        self,
        *,
        project_id: str,
        operation_request_id: str,
        expected_projection_state_digest: str,
        expected_project_version: int,
        expected_integration_head: str,
        expected_projected_head: str,
    ) -> ProjectGitStateRecord:
        project = self.journal.get_project_git_state(project_id)
        if project is None:
            raise ContentRepositoryError(
                f"Project {project_id!r} has no Git state"
            )
        repository = self.journal.get_git_repository(project.repository_id)
        if repository is None:
            raise ContentRepositoryError(
                "Project Content Repository is missing"
            )
        if not project.worktree_path or not project.integration_ref:
            raise ContentRepositoryError(
                "Project workspace is not materialized"
            )
        worktree = Path(project.worktree_path).expanduser().resolve()
        if self.state_root not in worktree.parents:
            raise ContentRepositoryError(
                "Project worktree is outside the Eigent state root"
            )
        payload = {
            "project_id": project_id,
            "expected_project_version": expected_project_version,
            "expected_integration_head": expected_integration_head,
            "expected_projected_head": expected_projected_head,
        }
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": repository.repository_id,
                    "request_id": operation_request_id,
                }
            )[:32]
        )
        result = {
            "project_id": project_id,
            "projected_head": expected_integration_head,
        }

        with self.content.repository_lock(
            self.content.repository_lock_path(repository.space_id)
        ):
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=repository.repository_id,
                request_id=operation_request_id,
                operation_type="project.projection.refresh",
                payload_digest=canonical_digest(payload),
                expected_repo_state_digest=expected_projection_state_digest,
            )
            if operation.status == "completed":
                current = self.journal.get_project_git_state(project_id)
                if current is None:
                    raise ContentRepositoryError(
                        "completed projection refresh has no Project state"
                    )
                return current
            current = self.journal.get_project_git_state(project_id)
            if current is None:
                raise ContentRepositoryError("Project Git state disappeared")
            if operation.status == "prepared":
                if (
                    current.version != expected_project_version
                    or current.integration_head != expected_integration_head
                    or current.projected_head != expected_projected_head
                ):
                    raise OptimisticConcurrencyError(
                        "Project projection changed before refresh"
                    )
                token = self.git.repo_state_token(worktree)
                if token.digest != expected_projection_state_digest:
                    raise RepositoryStateChangedError(
                        "Project worktree changed before projection refresh"
                    )
                self.journal.mark_git_operation_dispatched(
                    operation_id,
                    observed_repo_state_digest=token.digest,
                )
            elif operation.status != "dispatched":
                raise ContentRepositoryError(
                    f"projection refresh is {operation.status!r}"
                )
            if (
                current.integration_head != expected_integration_head
                or current.projected_head
                not in {expected_projected_head, expected_integration_head}
            ):
                raise OptimisticConcurrencyError(
                    "Project projection changed during refresh"
                )
            try:
                self.git.refresh_owned_worktree(
                    worktree,
                    expected_projected_head=expected_projected_head,
                    target_head=expected_integration_head,
                )
            except GitBackendError:
                self.journal.mark_project_git_attention(
                    project_id=project_id,
                    expected_version=current.version,
                )
                raise
            current = self.journal.update_project_git_projection(
                project_id=project_id,
                expected_version=expected_project_version,
                expected_integration_head=expected_integration_head,
                expected_projected_head=expected_projected_head,
                projected_head=expected_integration_head,
            )
            observed = self.git.repo_state_token(worktree)
            self.journal.complete_git_operation(
                operation_id,
                result=result,
                observed_repo_state_digest=observed.digest,
            )
            return current

    @staticmethod
    def _ref_segment(*values: str) -> str:
        return canonical_digest(list(values))[:24]

    def _project_ref(self, repository_id: str, project_id: str) -> str:
        return "refs/heads/eigent/project/" + self._ref_segment(
            repository_id, project_id
        )

    def _run_ref(self, repository_id: str, run_id: str) -> str:
        return "refs/heads/eigent/run/" + self._ref_segment(
            repository_id, run_id
        )

    def _project_worktree(self, space_id: str, project_id: str) -> Path:
        return (
            self.state_root
            / "worktrees"
            / self._ref_segment("space", space_id)
            / "projects"
            / self._ref_segment("project", project_id)
            / "integration"
        )

    def _run_worktree(self, space_id: str, run_id: str) -> Path:
        return (
            self.state_root
            / "worktrees"
            / self._ref_segment("space", space_id)
            / "runs"
            / self._ref_segment("run", run_id)
            / "integration"
        )


def get_default_workspace_git_coordinator() -> WorkspaceGitCoordinator:
    return WorkspaceGitCoordinator(
        get_default_run_journal(),
        state_root=configured_run_journal_path().parent / "workspace-git",
    )
