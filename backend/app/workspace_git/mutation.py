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

"""Pre-dispatch Run worktree materialization and exact-path ChangeSets."""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.run_context import RunContext
from app.run_journal import (
    GitChangeSetRecord,
    GitMutationIntentRecord,
    ProjectWorkspaceBindingRecord,
    SQLiteRunJournal,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.workspace_config import canonical_digest
from app.workspace_git.content import ContentRepositoryError
from app.workspace_git.coordinator import (
    GitRunWorkspace,
    WorkspaceGitCoordinator,
)
from app.workspace_git.snapshot import (
    MaterializedOverlay,
    WorkspacePathNotFoundError,
    WorkspaceSnapshotService,
)
from app.workspace_git.workforce import (
    GitAgentWorkspace,
    WorkforceGitService,
)


@dataclass(frozen=True)
class PreparedWorkspaceWrite:
    context: RunContext
    workspace: GitRunWorkspace | None
    agent_workspace: GitAgentWorkspace | None
    change_set: GitChangeSetRecord
    intent: GitMutationIntentRecord
    relative_path: str
    target_path: Path
    preimage_digest: str | None
    overlay: MaterializedOverlay | None
    direct_binding: ProjectWorkspaceBindingRecord | None = None

    @property
    def mutation_root(self) -> Path:
        if self.direct_binding is not None:
            return Path(self.direct_binding.worktree_path)
        if self.agent_workspace is None:
            raise ContentRepositoryError("prepared write has no mutation root")
        return self.agent_workspace.agent_worktree


@dataclass(frozen=True)
class PreparedWorkspaceExecution:
    context: RunContext
    workspace: GitRunWorkspace | None
    agent_workspace: GitAgentWorkspace | None
    change_set: GitChangeSetRecord
    intent: GitMutationIntentRecord
    imported_overlays: tuple[MaterializedOverlay, ...]
    direct_binding: ProjectWorkspaceBindingRecord | None = None

    @property
    def mutation_root(self) -> Path:
        if self.direct_binding is not None:
            return Path(self.direct_binding.worktree_path)
        if self.agent_workspace is None:
            raise ContentRepositoryError(
                "prepared execution has no mutation root"
            )
        return self.agent_workspace.agent_worktree


@dataclass(frozen=True)
class WorkspaceMutationReconciliation:
    recovered_change_set_ids: tuple[str, ...]
    needs_attention_change_set_ids: tuple[str, ...]


logger = logging.getLogger(__name__)


class WorkspaceMutationService:
    """Enforce materialize-before-dispatch for workspace mutations."""

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        state_root: Path,
        coordinator: WorkspaceGitCoordinator | None = None,
        snapshots: WorkspaceSnapshotService | None = None,
        workforce: WorkforceGitService | None = None,
        primary_checkout_enabled: bool = True,
    ) -> None:
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.coordinator = coordinator or WorkspaceGitCoordinator(
            journal,
            state_root=self.state_root,
        )
        self.snapshots = snapshots or WorkspaceSnapshotService(
            journal,
            state_root=self.state_root,
            git_backend=self.coordinator.git,
        )
        self.content = self.coordinator.content
        self.git = self.coordinator.git
        self.workforce = workforce or WorkforceGitService(
            journal,
            state_root=self.state_root,
            coordinator=self.coordinator,
        )
        self.primary_checkout_enabled = primary_checkout_enabled

    def prepare_file_write(
        self,
        *,
        context: RunContext,
        filename: str,
        operation_request_id: str,
        actor_id: str,
        trigger: str,
    ) -> PreparedWorkspaceWrite | None:
        """Return a private Run target, or None when Git is not enabled."""

        run = self.journal.get_run_git_materialization(context.run_id)
        if run is None:
            return None
        project = self.journal.get_project_git_state(run.project_id)
        repository = self.journal.get_git_repository(run.repository_id)
        if project is None or repository is None:
            raise ContentRepositoryError("Run Git owner is unavailable")
        relative_path = self._relative_workspace_path(
            context=context,
            repository_root=Path(repository.root_path),
            filename=filename,
        )
        binding = self.journal.get_project_workspace_binding(
            context.project_id
        )
        if (
            self.primary_checkout_enabled
            and context.session_mode == "single-agent"
            and binding is not None
            and binding.checkout_mode
            in {"primary_checkout", "explicit_worktree"}
        ):
            return self._prepare_direct_file_write(
                context=context,
                run=run,
                repository_root=Path(repository.root_path),
                binding=binding,
                relative_path=relative_path,
                operation_request_id=operation_request_id,
                actor_id=actor_id,
                trigger=trigger,
            )
        pinned_entry = None
        try:
            pinned_entry = self.snapshots.pin_path(
                run_id=context.run_id,
                relative_path=relative_path,
            )
        except WorkspacePathNotFoundError:
            pass
        user_token = self.git.repo_state_token(Path(repository.root_path))
        workspace = self.coordinator.ensure_run_materialized(
            run_id=context.run_id,
            operation_request_id=self._request_id(
                operation_request_id,
                "materialize",
            ),
            expected_repo_state_digest=user_token.digest,
            expected_project_version=project.version,
            expected_project_head=project.integration_head,
        )
        agent_workspace = self.workforce.ensure_agent_workspace(
            run_workspace=workspace,
            agent_id=actor_id,
            operation_request_id=operation_request_id,
        )
        target = agent_workspace.agent_worktree / relative_path
        overlay = None
        if (
            pinned_entry is not None
            and pinned_entry.source_kind == "user_overlay"
            and pinned_entry.entry_state in {"read_only", "imported_preimage"}
        ):
            overlay = self.snapshots.materialize_user_overlay(
                run_id=context.run_id,
                relative_path=relative_path,
                destination_root=agent_workspace.agent_worktree,
            )
        preimage_digest = (
            overlay.content_digest
            if overlay is not None
            else self._digest_file(target)
        )
        change_set = self.journal.ensure_git_change_set(
            change_set_id=(
                "changeset_"
                + canonical_digest(
                    {
                        "run_id": context.run_id,
                        "worktree_ref": agent_workspace.record.agent_ref,
                    }
                )[:32]
            ),
            run_id=context.run_id,
            repository_id=run.repository_id,
            worktree_ref=agent_workspace.record.agent_ref,
            base_commit=agent_workspace.record.base_commit,
        )
        existing_intent = next(
            (
                item
                for item in self.journal.list_git_mutation_intents()
                if item.change_set_id == change_set.change_set_id
                and item.operation_request_id == operation_request_id
            ),
            None,
        )
        if existing_intent is not None:
            # A retry after checkpoint-but-before-merge observes the Agent
            # result as current content. Its durable intent must retain the
            # original preimage so idempotency and ChangeSet identity do not
            # drift with the worktree projection.
            preimage_digest = existing_intent.preimage_digest
        intent = self.journal.ensure_git_mutation_intent(
            intent_id=self._intent_id(
                change_set.change_set_id,
                operation_request_id,
            ),
            change_set_id=change_set.change_set_id,
            operation_request_id=operation_request_id,
            mutation_scope="exact_path",
            relative_path=relative_path,
            preimage_digest=preimage_digest,
            actor_id=actor_id,
            trigger=trigger,
        )
        return PreparedWorkspaceWrite(
            context=context,
            workspace=workspace,
            agent_workspace=agent_workspace,
            change_set=change_set,
            intent=intent,
            relative_path=relative_path,
            target_path=target,
            preimage_digest=preimage_digest,
            overlay=overlay,
        )

    def prepare_broad_write(
        self,
        *,
        context: RunContext,
        operation_request_id: str,
        actor_id: str,
        trigger: str,
    ) -> PreparedWorkspaceExecution | None:
        """Materialize before spawning terminal/script-like processes.

        Only overlay paths already admitted to the Run snapshot are imported.
        Expanding the import scope is a separate permission decision; this
        method never scans or copies the entire User Worktree.
        """

        run = self.journal.get_run_git_materialization(context.run_id)
        if run is None:
            return None
        project = self.journal.get_project_git_state(run.project_id)
        repository = self.journal.get_git_repository(run.repository_id)
        if project is None or repository is None:
            raise ContentRepositoryError("Run Git owner is unavailable")
        binding = self.journal.get_project_workspace_binding(
            context.project_id
        )
        if (
            self.primary_checkout_enabled
            and context.session_mode == "single-agent"
            and binding is not None
            and binding.checkout_mode
            in {"primary_checkout", "explicit_worktree"}
        ):
            return self._prepare_direct_broad_write(
                context=context,
                run=run,
                repository_root=Path(repository.root_path),
                binding=binding,
                operation_request_id=operation_request_id,
                actor_id=actor_id,
                trigger=trigger,
            )
        user_token = self.git.repo_state_token(Path(repository.root_path))
        workspace = self.coordinator.ensure_run_materialized(
            run_id=context.run_id,
            operation_request_id=self._request_id(
                operation_request_id,
                "materialize",
            ),
            expected_repo_state_digest=user_token.digest,
            expected_project_version=project.version,
            expected_project_head=project.integration_head,
        )
        agent_workspace = self.workforce.ensure_agent_workspace(
            run_workspace=workspace,
            agent_id=actor_id,
            operation_request_id=operation_request_id,
        )
        change_set = self.journal.ensure_git_change_set(
            change_set_id=(
                "changeset_"
                + canonical_digest(
                    {
                        "run_id": context.run_id,
                        "worktree_ref": agent_workspace.record.agent_ref,
                    }
                )[:32]
            ),
            run_id=context.run_id,
            repository_id=run.repository_id,
            worktree_ref=agent_workspace.record.agent_ref,
            base_commit=agent_workspace.record.base_commit,
        )
        intent = self.journal.ensure_git_mutation_intent(
            intent_id=self._intent_id(
                change_set.change_set_id,
                operation_request_id,
            ),
            change_set_id=change_set.change_set_id,
            operation_request_id=operation_request_id,
            mutation_scope="broad_process",
            relative_path=None,
            preimage_digest=None,
            actor_id=actor_id,
            trigger=trigger,
        )
        imported: list[MaterializedOverlay] = []
        snapshot = self.snapshots.get_snapshot(context.run_id)
        if snapshot is not None:
            for entry in self.journal.list_workspace_overlay_entries(
                snapshot.snapshot_id
            ):
                if entry.source_kind != "user_overlay":
                    continue
                if entry.entry_state in {"read_only", "imported_preimage"}:
                    imported.append(
                        self.snapshots.materialize_user_overlay(
                            run_id=context.run_id,
                            relative_path=entry.relative_path,
                            destination_root=agent_workspace.agent_worktree,
                        )
                    )
        return PreparedWorkspaceExecution(
            context=context,
            workspace=workspace,
            agent_workspace=agent_workspace,
            change_set=change_set,
            intent=intent,
            imported_overlays=tuple(imported),
        )

    def complete_broad_write(
        self,
        prepared: PreparedWorkspaceExecution,
        *,
        operation_request_id: str,
        actor_id: str,
        trigger: str,
    ) -> tuple[str, ...]:
        """Capture a bounded terminal/script delta after the process exits."""

        if prepared.direct_binding is not None:
            return self._complete_direct_broad_write(
                prepared,
                operation_request_id=operation_request_id,
                actor_id=actor_id,
                trigger=trigger,
            )
        if prepared.agent_workspace is None:
            raise ContentRepositoryError(
                "legacy broad write has no Agent worktree"
            )
        commits: list[str] = []
        overlay_paths = {
            item.relative_path: item for item in prepared.imported_overlays
        }
        mutation_root = prepared.agent_workspace.agent_worktree
        status = self.git.worktree_status(mutation_root)
        for relative_path, overlay in overlay_paths.items():
            if relative_path not in status:
                continue
            current_digest = self._digest_file(mutation_root / relative_path)
            if current_digest == overlay.content_digest:
                self.git.restore_owned_worktree_path(
                    mutation_root,
                    relative_path=relative_path,
                    source_commit=prepared.agent_workspace.record.base_commit,
                )
                continue
            commit = self.complete_file_write(
                PreparedWorkspaceWrite(
                    context=prepared.context,
                    workspace=prepared.workspace,
                    agent_workspace=prepared.agent_workspace,
                    change_set=prepared.change_set,
                    intent=prepared.intent,
                    relative_path=relative_path,
                    target_path=mutation_root / relative_path,
                    preimage_digest=overlay.content_digest,
                    overlay=overlay,
                ),
                operation_request_id=self._request_id(
                    operation_request_id,
                    f"overlay:{relative_path}",
                ),
                actor_id=actor_id,
                trigger=trigger,
                merge_after_checkpoint=False,
            )
            if commit is not None:
                commits.append(commit)

        status = self.git.worktree_status(mutation_root)
        remaining = {
            path: state
            for path, state in status.items()
            if path not in overlay_paths
        }
        if not remaining:
            self._complete_intent(prepared.intent)
            if commits:
                outcome = self.workforce.merge_agent_workspace(
                    prepared.agent_workspace,
                    operation_request_id=self._request_id(
                        operation_request_id,
                        "merge-agent",
                    ),
                )
                if outcome.merged_commit is not None:
                    commits = [outcome.merged_commit]
            else:
                self.workforce.release_workspace(prepared.agent_workspace)
            return tuple(commits)
        paths: list[Path] = []
        sources: dict[str, str] = {}
        pending_items: list[str] = []
        for relative_path in sorted(remaining):
            target = mutation_root / relative_path
            tracked = self.git.is_tracked(
                mutation_root,
                target,
            )
            result_digest = self._digest_file(target)
            if result_digest is None:
                change_kind = "deleted"
                size = None
            else:
                change_kind = "modified" if tracked else "added"
                size = target.stat().st_size
            source = "agent_modified" if tracked else "agent_created"
            self.journal.put_git_change_set_item(
                change_set_id=prepared.change_set.change_set_id,
                relative_path=relative_path,
                operation_request_id=operation_request_id,
                actor_id=actor_id,
                trigger=trigger,
                change_kind=change_kind,
                source="worktree_delta",
                preimage_digest=None,
                result_digest=result_digest,
                size_bytes=size,
            )
            paths.append(target)
            sources[relative_path] = source
            pending_items.append(relative_path)
        checkpoint = self.content.checkpoint(
            prepared.change_set.repository_id,
            operation_request_id=self._request_id(
                operation_request_id,
                "terminal-delta",
            ),
            expected_repo_state_digest=self.git.repo_state_token(
                mutation_root
            ).digest,
            paths=tuple(paths),
            path_sources=sources,
            target_role="agent",
            target_id=prepared.agent_workspace.record.workspace_id,
            actor_id=actor_id,
            trigger=trigger,
            message="Checkpoint bounded workspace process delta",
            worktree_root=mutation_root,
        )
        for relative_path in pending_items:
            self.journal.update_git_change_set_item_state(
                change_set_id=prepared.change_set.change_set_id,
                relative_path=relative_path,
                expected_state="pending",
                state="checkpointed",
            )
        commits.append(checkpoint.commit_oid)
        self._complete_intent(prepared.intent)
        outcome = self.workforce.merge_agent_workspace(
            prepared.agent_workspace,
            operation_request_id=self._request_id(
                operation_request_id,
                "merge-agent",
            ),
        )
        if outcome.merged_commit is not None:
            commits = [outcome.merged_commit]
        return tuple(commits)

    def renew_broad_write(
        self,
        prepared: PreparedWorkspaceExecution,
        *,
        now: float | None = None,
    ) -> None:
        """Renew the lease while an admitted broad process is still running."""

        if prepared.direct_binding is not None:
            return
        if prepared.agent_workspace is None:
            raise ContentRepositoryError(
                "legacy broad write has no Agent worktree"
            )
        self.workforce.renew_workspace(
            prepared.agent_workspace,
            now=now,
        )

    def complete_file_write(
        self,
        prepared: PreparedWorkspaceWrite,
        *,
        operation_request_id: str,
        actor_id: str,
        trigger: str,
        merge_after_checkpoint: bool = True,
    ) -> str | None:
        """Checkpoint one successful exact-path write and return its commit."""

        if prepared.direct_binding is not None:
            return self._complete_direct_file_write(
                prepared,
                operation_request_id=operation_request_id,
                actor_id=actor_id,
                trigger=trigger,
            )
        if prepared.agent_workspace is None:
            raise ContentRepositoryError(
                "legacy file write has no Agent worktree"
            )
        result_digest = self._digest_file(prepared.target_path)
        if result_digest is None and prepared.preimage_digest is None:
            self._complete_intent(prepared.intent)
            if merge_after_checkpoint:
                self.workforce.release_workspace(prepared.agent_workspace)
            return None
        if result_digest == prepared.preimage_digest:
            if prepared.overlay is not None:
                self.git.restore_owned_worktree_path(
                    prepared.agent_workspace.agent_worktree,
                    relative_path=prepared.relative_path,
                    source_commit=prepared.agent_workspace.record.base_commit,
                )
            self._complete_intent(prepared.intent)
            if merge_after_checkpoint:
                self.workforce.release_workspace(prepared.agent_workspace)
            return None
        size = (
            prepared.target_path.stat().st_size
            if result_digest is not None
            else None
        )
        change_kind = (
            "deleted"
            if result_digest is None
            else ("added" if prepared.preimage_digest is None else "modified")
        )
        source = (
            "agent_created" if change_kind == "added" else "agent_modified"
        )
        item = self.journal.put_git_change_set_item(
            change_set_id=prepared.change_set.change_set_id,
            relative_path=prepared.relative_path,
            operation_request_id=operation_request_id,
            actor_id=actor_id,
            trigger=trigger,
            change_kind=change_kind,
            source=source,
            preimage_digest=prepared.preimage_digest,
            result_digest=result_digest,
            size_bytes=size,
        )
        if item.item_state == "checkpointed":
            self._complete_intent(prepared.intent)
            if merge_after_checkpoint:
                outcome = self.workforce.merge_agent_workspace(
                    prepared.agent_workspace,
                    operation_request_id=self._request_id(
                        operation_request_id,
                        "merge-agent",
                    ),
                )
                return outcome.merged_commit or self.git.current_head(
                    prepared.agent_workspace.agent_worktree
                )
            return self.git.current_head(
                prepared.agent_workspace.agent_worktree
            )

        if prepared.overlay is not None and item.item_state == "pending":
            result_cache = (
                self._cache_result(
                    prepared.target_path,
                    expected_digest=result_digest,
                )
                if result_digest is not None
                else None
            )
            self._replace_from_file(
                prepared.overlay.preimage_path,
                prepared.target_path,
            )
            preimage_checkpoint = self.content.checkpoint(
                prepared.change_set.repository_id,
                operation_request_id=self._request_id(
                    operation_request_id,
                    "overlay-preimage",
                ),
                expected_repo_state_digest=self.git.repo_state_token(
                    prepared.agent_workspace.agent_worktree
                ).digest,
                paths=(prepared.target_path,),
                path_sources={prepared.relative_path: "overlay_preimage"},
                target_role="agent",
                target_id=prepared.agent_workspace.record.workspace_id,
                actor_id="user",
                trigger="overlay_preimage",
                message=(
                    f"Preserve User preimage for {prepared.relative_path}"
                ),
                worktree_root=prepared.agent_workspace.agent_worktree,
            )
            del preimage_checkpoint
            self.journal.update_git_change_set_item_state(
                change_set_id=prepared.change_set.change_set_id,
                relative_path=prepared.relative_path,
                expected_state="pending",
                state="preimage_checkpointed",
            )
            if result_cache is not None:
                self._replace_from_file(result_cache, prepared.target_path)
            else:
                prepared.target_path.unlink(missing_ok=True)
            item = next(
                value
                for value in self.journal.list_git_change_set_items(
                    prepared.change_set.change_set_id,
                )
                if value.relative_path == prepared.relative_path
            )

        checkpoint = self.content.checkpoint(
            prepared.change_set.repository_id,
            operation_request_id=self._request_id(
                operation_request_id,
                "agent-delta",
            ),
            expected_repo_state_digest=self.git.repo_state_token(
                prepared.agent_workspace.agent_worktree
            ).digest,
            paths=(prepared.target_path,),
            path_sources={prepared.relative_path: source},
            target_role="agent",
            target_id=prepared.agent_workspace.record.workspace_id,
            actor_id=actor_id,
            trigger=trigger,
            message=f"Checkpoint {prepared.relative_path}",
            worktree_root=prepared.agent_workspace.agent_worktree,
        )
        expected_state = item.item_state
        self.journal.update_git_change_set_item_state(
            change_set_id=prepared.change_set.change_set_id,
            relative_path=prepared.relative_path,
            expected_state=expected_state,
            state="checkpointed",
        )
        if prepared.overlay is not None:
            self.journal.update_workspace_overlay_entry_state(
                snapshot_id=prepared.overlay.snapshot.snapshot_id,
                relative_path=prepared.relative_path,
                expected_state="imported_preimage",
                state="agent_modified",
            )
        self._complete_intent(prepared.intent)
        if not merge_after_checkpoint:
            return checkpoint.commit_oid
        outcome = self.workforce.merge_agent_workspace(
            prepared.agent_workspace,
            operation_request_id=self._request_id(
                operation_request_id,
                "merge-agent",
            ),
        )
        return outcome.merged_commit or checkpoint.commit_oid

    def _prepare_direct_file_write(
        self,
        *,
        context: RunContext,
        run,
        repository_root: Path,
        binding: ProjectWorkspaceBindingRecord,
        relative_path: str,
        operation_request_id: str,
        actor_id: str,
        trigger: str,
    ) -> PreparedWorkspaceWrite:
        root = self._require_direct_checkout(
            context=context,
            run=run,
            repository_root=repository_root,
            binding=binding,
        )
        run = self._preserve_direct_preimage(
            context=context,
            run=run,
            binding=binding,
            root=root,
            operation_request_id=operation_request_id,
        )
        target = root / relative_path
        preimage_digest = self._digest_file(target)
        change_set = self._ensure_direct_change_set(
            context=context,
            run=run,
            binding=binding,
        )
        existing_intent = next(
            (
                item
                for item in self.journal.list_git_mutation_intents()
                if item.change_set_id == change_set.change_set_id
                and item.operation_request_id == operation_request_id
            ),
            None,
        )
        if existing_intent is not None:
            preimage_digest = existing_intent.preimage_digest
        intent = self.journal.ensure_git_mutation_intent(
            intent_id=self._intent_id(
                change_set.change_set_id,
                operation_request_id,
            ),
            change_set_id=change_set.change_set_id,
            operation_request_id=operation_request_id,
            mutation_scope="exact_path",
            relative_path=relative_path,
            preimage_digest=preimage_digest,
            actor_id=actor_id,
            trigger=trigger,
        )
        return PreparedWorkspaceWrite(
            context=context,
            workspace=None,
            agent_workspace=None,
            change_set=change_set,
            intent=intent,
            relative_path=relative_path,
            target_path=target,
            preimage_digest=preimage_digest,
            overlay=None,
            direct_binding=binding,
        )

    def _prepare_direct_broad_write(
        self,
        *,
        context: RunContext,
        run,
        repository_root: Path,
        binding: ProjectWorkspaceBindingRecord,
        operation_request_id: str,
        actor_id: str,
        trigger: str,
    ) -> PreparedWorkspaceExecution:
        root = self._require_direct_checkout(
            context=context,
            run=run,
            repository_root=repository_root,
            binding=binding,
        )
        run = self._preserve_direct_preimage(
            context=context,
            run=run,
            binding=binding,
            root=root,
            operation_request_id=operation_request_id,
        )
        change_set = self._ensure_direct_change_set(
            context=context,
            run=run,
            binding=binding,
        )
        intent = self.journal.ensure_git_mutation_intent(
            intent_id=self._intent_id(
                change_set.change_set_id,
                operation_request_id,
            ),
            change_set_id=change_set.change_set_id,
            operation_request_id=operation_request_id,
            mutation_scope="broad_process",
            relative_path=None,
            preimage_digest=None,
            actor_id=actor_id,
            trigger=trigger,
        )
        return PreparedWorkspaceExecution(
            context=context,
            workspace=None,
            agent_workspace=None,
            change_set=change_set,
            intent=intent,
            imported_overlays=(),
            direct_binding=binding,
        )

    def _require_direct_checkout(
        self,
        *,
        context: RunContext,
        run,
        repository_root: Path,
        binding: ProjectWorkspaceBindingRecord,
    ) -> Path:
        root = Path(binding.worktree_path).expanduser().resolve()
        repository_root = repository_root.expanduser().resolve()
        if binding.checkout_mode == "primary_checkout":
            if root != repository_root:
                raise ContentRepositoryError(
                    "primary checkout binding no longer matches the Space root"
                )
        elif not any(
            item.path == root and item.ref_name == binding.target_ref
            for item in self.git.list_worktrees(repository_root)
        ):
            raise ContentRepositoryError(
                "explicit Project worktree is no longer registered for its "
                "selected branch"
            )
        if binding.repository_id != run.repository_id:
            raise ContentRepositoryError(
                "Project checkout belongs to another Content Repository"
            )
        probe = self.git.probe(root)
        observed_ref = f"refs/heads/{probe.branch}" if probe.branch else None
        if observed_ref != binding.target_ref:
            raise ContentRepositoryError(
                "bound checkout is on another branch; switch it explicitly "
                "before this Task writes"
            )
        request = self.journal.get_workspace_writer_request(
            f"workspace-writer:{context.run_id}"
        )
        if (
            request is None
            or request.status != "acquired"
            or request.task_id != context.task_id
            or request.checkout_id != binding.checkout_id
        ):
            raise ContentRepositoryError(
                "Task does not own the bound checkout writer lease"
            )
        return root

    def _preserve_direct_preimage(
        self,
        *,
        context: RunContext,
        run,
        binding: ProjectWorkspaceBindingRecord,
        root: Path,
        operation_request_id: str,
    ):
        # A direct ChangeSet freezes the Run's diff base as soon as the first
        # mutation is prepared, not only after it records its first item. A
        # tool can return a no-op after creating incidental files (for example
        # an editor backup). Treating those files as a fresh User preimage on
        # the next tool call rebases the Run while the existing ChangeSet still
        # owns the old base, producing a false "has another owner" conflict.
        if self.journal.get_git_change_set_for_run(context.run_id) is not None:
            return run
        status = self.git.worktree_status(root)
        if not status:
            return run
        paths = tuple(root / path for path in sorted(status))
        checkpoint = self.content.checkpoint(
            run.repository_id,
            operation_request_id=self._request_id(
                operation_request_id,
                "direct-user-preimage",
            ),
            expected_repo_state_digest=self.git.repo_state_token(root).digest,
            paths=paths,
            path_sources={path: "user_selected" for path in sorted(status)},
            target_role="user",
            target_id=context.project_id,
            actor_id=context.user_id or "local-user",
            trigger="workspace.preimage",
            message=f"Save workspace before Task {context.task_id}",
            worktree_root=root,
            commit_trailers={
                "Eigent-Initiator": "User",
                "Eigent-Run-ID": context.run_id,
                "Eigent-Task-ID": context.task_id,
            },
        )
        return self.journal.rebase_unmaterialized_git_run(
            run_id=context.run_id,
            expected_base_commit=run.workspace_base_commit,
            base_commit=checkpoint.commit_oid,
            base_ref=binding.target_ref,
        )

    def _ensure_direct_change_set(
        self,
        *,
        context: RunContext,
        run,
        binding: ProjectWorkspaceBindingRecord,
    ) -> GitChangeSetRecord:
        base_commit = run.workspace_base_commit or self.git.current_head(
            Path(binding.worktree_path)
        )
        if base_commit is None:
            base_commit = self.git.empty_tree_oid(Path(binding.worktree_path))
            run = self.journal.rebase_unmaterialized_git_run(
                run_id=context.run_id,
                expected_base_commit=None,
                base_commit=base_commit,
                base_ref=binding.target_ref,
            )
        return self.journal.ensure_git_change_set(
            change_set_id=(
                "changeset_"
                + canonical_digest(
                    {
                        "run_id": context.run_id,
                        "checkout_id": binding.checkout_id,
                        "target_ref": binding.target_ref,
                    }
                )[:32]
            ),
            run_id=context.run_id,
            repository_id=run.repository_id,
            worktree_ref=binding.target_ref,
            base_commit=base_commit,
        )

    def _complete_direct_file_write(
        self,
        prepared: PreparedWorkspaceWrite,
        *,
        operation_request_id: str,
        actor_id: str,
        trigger: str,
    ) -> str | None:
        result_digest = self._digest_file(prepared.target_path)
        if result_digest == prepared.preimage_digest:
            self._complete_intent(prepared.intent)
            return None
        size = (
            prepared.target_path.stat().st_size
            if result_digest is not None
            else None
        )
        tracked = self.git.is_tracked(
            prepared.mutation_root,
            prepared.target_path,
        )
        change_kind = (
            "deleted"
            if result_digest is None
            else ("modified" if tracked else "added")
        )
        source = (
            "agent_created" if change_kind == "added" else "agent_modified"
        )
        item = self.journal.put_git_change_set_item(
            change_set_id=prepared.change_set.change_set_id,
            relative_path=prepared.relative_path,
            operation_request_id=operation_request_id,
            actor_id=actor_id,
            trigger=trigger,
            change_kind=change_kind,
            source=source,
            preimage_digest=prepared.preimage_digest,
            result_digest=result_digest,
            size_bytes=size,
        )
        if item.item_state == "checkpointed":
            self._complete_intent(prepared.intent)
            return self.git.current_head(prepared.mutation_root)
        checkpoint = self.content.checkpoint(
            prepared.change_set.repository_id,
            operation_request_id=self._request_id(
                operation_request_id,
                "direct-delta",
            ),
            expected_repo_state_digest=self.git.repo_state_token(
                prepared.mutation_root
            ).digest,
            paths=(prepared.target_path,),
            path_sources={prepared.relative_path: source},
            target_role="run",
            target_id=prepared.context.run_id,
            actor_id=actor_id,
            trigger=trigger,
            message=f"Update {prepared.relative_path}",
            worktree_root=prepared.mutation_root,
            commit_trailers=self._direct_commit_trailers(prepared.context),
        )
        self.journal.update_git_change_set_item_state(
            change_set_id=prepared.change_set.change_set_id,
            relative_path=prepared.relative_path,
            expected_state=item.item_state,
            state="checkpointed",
        )
        self._complete_intent(prepared.intent)
        return checkpoint.commit_oid

    def _complete_direct_broad_write(
        self,
        prepared: PreparedWorkspaceExecution,
        *,
        operation_request_id: str,
        actor_id: str,
        trigger: str,
    ) -> tuple[str, ...]:
        root = prepared.mutation_root
        status = self.git.worktree_status(root)
        if not status:
            self._complete_intent(prepared.intent)
            return ()
        paths: list[Path] = []
        sources: dict[str, str] = {}
        items = []
        for relative_path in sorted(status):
            target = root / relative_path
            tracked = self.git.is_tracked(root, target)
            result_digest = self._digest_file(target)
            change_kind = (
                "deleted"
                if result_digest is None
                else ("modified" if tracked else "added")
            )
            source = (
                "agent_created" if change_kind == "added" else "agent_modified"
            )
            item = self.journal.put_git_change_set_item(
                change_set_id=prepared.change_set.change_set_id,
                relative_path=relative_path,
                operation_request_id=operation_request_id,
                actor_id=actor_id,
                trigger=trigger,
                change_kind=change_kind,
                source="worktree_delta",
                preimage_digest=None,
                result_digest=result_digest,
                size_bytes=(
                    target.stat().st_size if target.is_file() else None
                ),
            )
            paths.append(target)
            sources[relative_path] = source
            items.append(item)
        checkpoint = self.content.checkpoint(
            prepared.change_set.repository_id,
            operation_request_id=self._request_id(
                operation_request_id,
                "direct-terminal-delta",
            ),
            expected_repo_state_digest=self.git.repo_state_token(root).digest,
            paths=tuple(paths),
            path_sources=sources,
            target_role="run",
            target_id=prepared.context.run_id,
            actor_id=actor_id,
            trigger=trigger,
            message="Checkpoint Task workspace changes",
            worktree_root=root,
            commit_trailers=self._direct_commit_trailers(prepared.context),
        )
        for item in items:
            if item.item_state != "checkpointed":
                self.journal.update_git_change_set_item_state(
                    change_set_id=prepared.change_set.change_set_id,
                    relative_path=item.relative_path,
                    expected_state=item.item_state,
                    state="checkpointed",
                )
        self._complete_intent(prepared.intent)
        return (checkpoint.commit_oid,)

    @staticmethod
    def _direct_commit_trailers(context: RunContext) -> dict[str, str]:
        return {
            "Eigent-Initiator": "Agent",
            "Eigent-Run-ID": context.run_id,
            "Eigent-Task-ID": context.task_id,
            "Eigent-Task-Status": "checkpointed",
        }

    def _complete_intent(self, intent: GitMutationIntentRecord) -> None:
        self.journal.update_git_mutation_intent_status(
            intent_id=intent.intent_id,
            expected_status="prepared",
            status="completed",
        )

    def reconcile_startup(self) -> WorkspaceMutationReconciliation:
        """Converge interrupted private-worktree checkpoints after restart.

        Recovery never reads a mutable User source as an authoritative
        preimage and never writes into the User Worktree. One ambiguous
        ChangeSet is quarantined without blocking reconciliation of others.
        """

        self.journal.reset_git_agent_workspace_leases_after_restart()
        recovered: list[str] = []
        needs_attention: list[str] = []
        change_sets = {
            item.change_set_id: item
            for item in self.journal.list_git_change_sets()
        }
        for intent in self.journal.list_git_mutation_intents(
            statuses=("prepared",)
        ):
            change_set = change_sets.get(intent.change_set_id)
            if change_set is None or change_set.state != "open":
                continue
            try:
                self._reconcile_intent(change_set, intent)
            except Exception:
                logger.exception(
                    "Workspace mutation intent startup reconciliation needs attention",
                    extra={"intent_id": intent.intent_id},
                )
                self.journal.update_git_mutation_intent_status(
                    intent_id=intent.intent_id,
                    expected_status="prepared",
                    status="needs_attention",
                )
                self.journal.update_git_change_set_state(
                    change_set_id=change_set.change_set_id,
                    expected_state="open",
                    state="needs_attention",
                )
                needs_attention.append(change_set.change_set_id)
                continue
            if change_set.change_set_id not in recovered:
                recovered.append(change_set.change_set_id)
        for change_set in self.journal.list_git_change_sets(states=("open",)):
            items = self.journal.list_git_change_set_items(
                change_set.change_set_id,
                states=("pending", "preimage_checkpointed"),
            )
            if not items:
                continue
            try:
                self._reconcile_change_set(change_set, items)
            except Exception:
                logger.exception(
                    "Workspace ChangeSet startup reconciliation needs attention",
                    extra={"change_set_id": change_set.change_set_id},
                )
                self.journal.update_git_change_set_state(
                    change_set_id=change_set.change_set_id,
                    expected_state="open",
                    state="needs_attention",
                )
                needs_attention.append(change_set.change_set_id)
                continue
            if change_set.change_set_id not in recovered:
                recovered.append(change_set.change_set_id)
        for change_set in self.journal.list_git_change_sets(states=("open",)):
            checkpointed = self.journal.list_git_change_set_items(
                change_set.change_set_id,
                states=("checkpointed",),
            )
            if not checkpointed:
                continue
            agent_record = next(
                (
                    item
                    for item in self.journal.list_git_agent_workspaces(
                        run_id=change_set.run_id,
                        states=("ready",),
                    )
                    if item.agent_ref == change_set.worktree_ref
                ),
                None,
            )
            if agent_record is None:
                continue
            workspace = self._workspace_for_change_set(change_set)
            agent_head = self.git.current_head(
                Path(agent_record.worktree_path)
            )
            run_head = self.git.current_head(workspace.run_worktree)
            if (
                agent_head is None
                or run_head is None
                or agent_head == run_head
            ):
                continue
            try:
                agent_workspace = self.workforce.ensure_agent_workspace(
                    run_workspace=workspace,
                    agent_id=agent_record.agent_id,
                    operation_request_id=(
                        f"startup-checkpointed-merge:{change_set.change_set_id}"
                    ),
                )
                self.workforce.merge_agent_workspace(
                    agent_workspace,
                    operation_request_id=self._request_id(
                        change_set.change_set_id,
                        "merge-agent-recovery",
                    ),
                )
            except Exception:
                logger.exception(
                    "Checkpointed Agent result merge needs attention",
                    extra={"change_set_id": change_set.change_set_id},
                )
                self.journal.update_git_change_set_state(
                    change_set_id=change_set.change_set_id,
                    expected_state="open",
                    state="needs_attention",
                )
                needs_attention.append(change_set.change_set_id)
                continue
            if change_set.change_set_id not in recovered:
                recovered.append(change_set.change_set_id)
        return WorkspaceMutationReconciliation(
            recovered_change_set_ids=tuple(recovered),
            needs_attention_change_set_ids=tuple(needs_attention),
        )

    def _reconcile_intent(self, change_set, intent) -> None:
        workspace = self._workspace_for_change_set(change_set)
        agent_workspace = self.workforce.ensure_agent_workspace(
            run_workspace=workspace,
            agent_id=intent.actor_id,
            operation_request_id=intent.operation_request_id,
        )
        if intent.mutation_scope == "exact_path":
            if intent.relative_path is None:
                raise ContentRepositoryError(
                    "Exact-path mutation intent has no path"
                )
            target = agent_workspace.agent_worktree / intent.relative_path
            overlay = self._materialized_overlay_for_path(
                change_set.run_id,
                intent.relative_path,
                target,
            )
            persisted_item = next(
                (
                    item
                    for item in self.journal.list_git_change_set_items(
                        change_set.change_set_id,
                        states=("pending", "preimage_checkpointed"),
                    )
                    if item.relative_path == intent.relative_path
                ),
                None,
            )
            if persisted_item is not None:
                self._reconcile_exact_item(
                    change_set,
                    workspace,
                    agent_workspace,
                    persisted_item,
                    overlay,
                )
                self._complete_intent(intent)
                self.workforce.merge_agent_workspace(
                    agent_workspace,
                    operation_request_id=self._request_id(
                        intent.operation_request_id,
                        "merge-agent-recovery",
                    ),
                )
                return
            self.complete_file_write(
                PreparedWorkspaceWrite(
                    context=self._reconciliation_context(change_set),
                    workspace=workspace,
                    agent_workspace=agent_workspace,
                    change_set=change_set,
                    intent=intent,
                    relative_path=intent.relative_path,
                    target_path=target,
                    preimage_digest=intent.preimage_digest,
                    overlay=overlay,
                ),
                operation_request_id=intent.operation_request_id,
                actor_id=intent.actor_id,
                trigger=intent.trigger,
            )
            return
        if intent.mutation_scope != "broad_process":
            raise ContentRepositoryError(
                f"Unsupported mutation scope {intent.mutation_scope!r}"
            )
        imported = self._materialized_overlays(
            change_set.run_id,
            agent_workspace.agent_worktree,
        )
        self.complete_broad_write(
            PreparedWorkspaceExecution(
                context=self._reconciliation_context(change_set),
                workspace=workspace,
                agent_workspace=agent_workspace,
                change_set=change_set,
                intent=intent,
                imported_overlays=imported,
            ),
            operation_request_id=intent.operation_request_id,
            actor_id=intent.actor_id,
            trigger=intent.trigger,
        )

    def _workspace_for_change_set(self, change_set) -> GitRunWorkspace:
        run = self.journal.get_run_git_materialization(change_set.run_id)
        if run is None or not run.worktree_path or not run.run_ref:
            raise ContentRepositoryError(
                "ChangeSet Run worktree is unavailable during reconciliation"
            )
        project = self.journal.get_project_git_state(run.project_id)
        if project is None or not project.worktree_path:
            raise ContentRepositoryError(
                "ChangeSet Project worktree is unavailable during reconciliation"
            )
        return GitRunWorkspace(
            project=project,
            run=run,
            project_worktree=Path(project.worktree_path),
            run_worktree=Path(run.worktree_path),
        )

    def _materialized_overlay_for_path(
        self,
        run_id: str,
        relative_path: str,
        destination_path: Path,
    ) -> MaterializedOverlay | None:
        snapshot = self.snapshots.get_snapshot(run_id)
        if snapshot is None:
            return None
        entry = self.journal.get_workspace_overlay_entry(
            snapshot.snapshot_id,
            relative_path,
        )
        if (
            entry is None
            or entry.source_kind != "user_overlay"
            or entry.entry_state == "agent_modified"
        ):
            return None
        if (
            entry.materialized_content_digest is None
            or entry.preimage_cache_key is None
        ):
            raise ContentRepositoryError(
                "Overlay recovery metadata is incomplete"
            )
        return MaterializedOverlay(
            snapshot=snapshot,
            entry=entry,
            relative_path=relative_path,
            content_digest=entry.materialized_content_digest,
            size_bytes=entry.size_bytes,
            preimage_path=(
                self.snapshots.cache_root
                / "preimages"
                / entry.preimage_cache_key[:2]
                / entry.preimage_cache_key
            ),
            destination_path=destination_path,
        )

    def _materialized_overlays(
        self,
        run_id: str,
        worktree_root: Path,
    ) -> tuple[MaterializedOverlay, ...]:
        snapshot = self.snapshots.get_snapshot(run_id)
        if snapshot is None:
            return ()
        values: list[MaterializedOverlay] = []
        for entry in self.journal.list_workspace_overlay_entries(
            snapshot.snapshot_id
        ):
            overlay = self._materialized_overlay_for_path(
                run_id,
                entry.relative_path,
                worktree_root / entry.relative_path,
            )
            if overlay is not None:
                values.append(overlay)
        return tuple(values)

    def _reconciliation_context(self, change_set) -> RunContext:
        repository = self.journal.get_git_repository(change_set.repository_id)
        if repository is None:
            raise ContentRepositoryError(
                "ChangeSet repository is unavailable during reconciliation"
            )
        run = self.journal.get_run(change_set.run_id)
        if run is None:
            raise ContentRepositoryError(
                "ChangeSet Run is unavailable during reconciliation"
            )
        root = Path(repository.root_path)
        return RunContext(
            space_id=repository.space_id,
            project_id=run.project_id,
            run_id=run.run_id,
            task_id=run.run_id,
            email="startup-reconciliation",
            user_id="startup-reconciliation",
            working_directory=root,
            task_output_root=root,
            camel_log_dir=root / ".eigent" / "logs",
            binding_source="startup-reconciliation",
            workdir_mode="direct-write",
            browser_port=0,
        )

    def _reconcile_change_set(self, change_set, items) -> None:
        workspace = self._workspace_for_change_set(change_set)
        agent_workspace = self.workforce.ensure_agent_workspace(
            run_workspace=workspace,
            agent_id=items[0].actor_id,
            operation_request_id=items[0].operation_request_id,
        )
        snapshot = self.snapshots.get_snapshot(change_set.run_id)
        overlay_by_path = {}
        if snapshot is not None:
            overlay_by_path = {
                entry.relative_path: entry
                for entry in self.journal.list_workspace_overlay_entries(
                    snapshot.snapshot_id
                )
                if entry.source_kind == "user_overlay"
            }

        broad = [item for item in items if item.source == "worktree_delta"]
        exact = [item for item in items if item.source != "worktree_delta"]
        if broad:
            self._reconcile_broad_items(
                change_set,
                workspace,
                agent_workspace,
                broad,
            )
        for item in exact:
            overlay_entry = overlay_by_path.get(item.relative_path)
            overlay = None
            if overlay_entry is not None:
                if (
                    snapshot is None
                    or overlay_entry.materialized_content_digest is None
                    or overlay_entry.preimage_cache_key is None
                ):
                    raise ContentRepositoryError(
                        "Overlay recovery metadata is incomplete"
                    )
                overlay = MaterializedOverlay(
                    snapshot=snapshot,
                    entry=overlay_entry,
                    relative_path=item.relative_path,
                    content_digest=overlay_entry.materialized_content_digest,
                    size_bytes=overlay_entry.size_bytes,
                    preimage_path=(
                        self.snapshots.cache_root
                        / "preimages"
                        / overlay_entry.preimage_cache_key[:2]
                        / overlay_entry.preimage_cache_key
                    ),
                    destination_path=agent_workspace.agent_worktree
                    / item.relative_path,
                )
            self._reconcile_exact_item(
                change_set,
                workspace,
                agent_workspace,
                item,
                overlay,
            )
        self.workforce.merge_agent_workspace(
            agent_workspace,
            operation_request_id=self._request_id(
                items[0].operation_request_id,
                "merge-agent-recovery",
            ),
        )

    def _reconcile_broad_items(
        self,
        change_set,
        workspace,
        agent_workspace,
        items,
    ) -> None:
        request_ids = {item.operation_request_id for item in items}
        if len(request_ids) != 1:
            raise ContentRepositoryError(
                "Broad ChangeSet recovery has mixed operation requests"
            )
        paths: list[Path] = []
        sources: dict[str, str] = {}
        for item in items:
            target = agent_workspace.agent_worktree / item.relative_path
            if self._digest_file(target) != item.result_digest:
                raise ContentRepositoryError(
                    f"Run result for {item.relative_path!r} changed before recovery"
                )
            paths.append(target)
            sources[item.relative_path] = (
                "agent_created"
                if item.change_kind == "added"
                else "agent_modified"
            )
        checkpoint_request_id = self._request_id(
            next(iter(request_ids)),
            "terminal-delta",
        )
        self.content.checkpoint(
            change_set.repository_id,
            operation_request_id=checkpoint_request_id,
            expected_repo_state_digest=self._checkpoint_expected_digest(
                repository_id=change_set.repository_id,
                operation_request_id=checkpoint_request_id,
                worktree_root=agent_workspace.agent_worktree,
            ),
            paths=tuple(paths),
            path_sources=sources,
            target_role="agent",
            target_id=agent_workspace.record.workspace_id,
            actor_id=items[0].actor_id,
            trigger=items[0].trigger,
            message="Checkpoint bounded workspace process delta",
            worktree_root=agent_workspace.agent_worktree,
        )
        for item in items:
            self.journal.update_git_change_set_item_state(
                change_set_id=change_set.change_set_id,
                relative_path=item.relative_path,
                expected_state=item.item_state,
                state="checkpointed",
            )

    def _reconcile_exact_item(
        self,
        change_set,
        workspace,
        agent_workspace,
        item,
        overlay: MaterializedOverlay | None,
    ) -> None:
        target = agent_workspace.agent_worktree / item.relative_path
        if overlay is not None:
            result_cache = self._result_cache_path(item.result_digest)
            current_digest = self._digest_file(target)
            if item.result_digest is not None and not result_cache.exists():
                if current_digest != item.result_digest:
                    raise ContentRepositoryError(
                        f"Agent result cache for {item.relative_path!r} is unavailable"
                    )
                self._cache_result(
                    target,
                    expected_digest=item.result_digest,
                )
            if item.item_state == "pending":
                if not overlay.preimage_path.is_file():
                    raise ContentRepositoryError(
                        f"Overlay preimage for {item.relative_path!r} is unavailable"
                    )
                self._replace_from_file(overlay.preimage_path, target)
                checkpoint_request_id = self._request_id(
                    item.operation_request_id,
                    "overlay-preimage",
                )
                self.content.checkpoint(
                    change_set.repository_id,
                    operation_request_id=checkpoint_request_id,
                    expected_repo_state_digest=self._checkpoint_expected_digest(
                        repository_id=change_set.repository_id,
                        operation_request_id=checkpoint_request_id,
                        worktree_root=agent_workspace.agent_worktree,
                    ),
                    paths=(target,),
                    path_sources={item.relative_path: "overlay_preimage"},
                    target_role="agent",
                    target_id=agent_workspace.record.workspace_id,
                    actor_id="user",
                    trigger="overlay_preimage",
                    message=f"Preserve User preimage for {item.relative_path}",
                    worktree_root=agent_workspace.agent_worktree,
                )
                self.journal.update_git_change_set_item_state(
                    change_set_id=change_set.change_set_id,
                    relative_path=item.relative_path,
                    expected_state="pending",
                    state="preimage_checkpointed",
                )
            if item.result_digest is None:
                target.unlink(missing_ok=True)
            else:
                self._replace_from_file(result_cache, target)
        elif self._digest_file(target) != item.result_digest:
            raise ContentRepositoryError(
                f"Run result for {item.relative_path!r} changed before recovery"
            )

        source = (
            "agent_created"
            if item.change_kind == "added"
            else "agent_modified"
        )
        checkpoint_request_id = self._request_id(
            item.operation_request_id,
            "agent-delta",
        )
        self.content.checkpoint(
            change_set.repository_id,
            operation_request_id=checkpoint_request_id,
            expected_repo_state_digest=self._checkpoint_expected_digest(
                repository_id=change_set.repository_id,
                operation_request_id=checkpoint_request_id,
                worktree_root=agent_workspace.agent_worktree,
            ),
            paths=(target,),
            path_sources={item.relative_path: source},
            target_role="agent",
            target_id=agent_workspace.record.workspace_id,
            actor_id=item.actor_id,
            trigger=item.trigger,
            message=f"Checkpoint {item.relative_path}",
            worktree_root=agent_workspace.agent_worktree,
        )
        self.journal.update_git_change_set_item_state(
            change_set_id=change_set.change_set_id,
            relative_path=item.relative_path,
            expected_state=(
                "preimage_checkpointed"
                if overlay is not None
                else item.item_state
            ),
            state="checkpointed",
        )
        if (
            overlay is not None
            and overlay.entry.entry_state == "imported_preimage"
        ):
            self.journal.update_workspace_overlay_entry_state(
                snapshot_id=overlay.snapshot.snapshot_id,
                relative_path=item.relative_path,
                expected_state="imported_preimage",
                state="agent_modified",
            )

    def _result_cache_path(self, digest: str | None) -> Path:
        if digest is None:
            return self.state_root / "snapshots" / "results" / "deleted"
        return self.state_root / "snapshots" / "results" / digest[:2] / digest

    def _checkpoint_expected_digest(
        self,
        *,
        repository_id: str,
        operation_request_id: str,
        worktree_root: Path,
    ) -> str:
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": repository_id,
                    "request_id": operation_request_id,
                }
            )[:32]
        )
        operation = self.journal.get_git_operation(operation_id)
        if (
            operation is not None
            and operation.expected_repo_state_digest is not None
        ):
            return operation.expected_repo_state_digest
        return self.git.repo_state_token(worktree_root).digest

    def _cache_result(self, path: Path, *, expected_digest: str) -> Path:
        target = (
            self.state_root
            / "snapshots"
            / "results"
            / expected_digest[:2]
            / expected_digest
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if self._digest_file(target) != expected_digest:
                raise ContentRepositoryError("result cache digest collision")
            return target
        temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
        try:
            self._replace_from_file(path, temporary)
            if self._digest_file(temporary) != expected_digest:
                raise ContentRepositoryError("result changed during caching")
            temporary.chmod(0o600)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        return target

    @staticmethod
    def _replace_from_file(source: Path, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(
            f".{destination.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with (
                source.open("rb", buffering=0) as reader,
                temporary.open("wb", buffering=0) as writer,
            ):
                while chunk := reader.read(1024 * 1024):
                    writer.write(chunk)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _digest_file(path: Path) -> str | None:
        try:
            if path.is_symlink() or not path.is_file():
                return None
            digest = hashlib.sha256()
            with path.open("rb", buffering=0) as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            return digest.hexdigest()
        except FileNotFoundError:
            return None

    @staticmethod
    def _relative_workspace_path(
        *,
        context: RunContext,
        repository_root: Path,
        filename: str,
    ) -> str:
        root = repository_root.expanduser().resolve()
        candidate = Path(filename).expanduser()
        if not candidate.is_absolute():
            candidate = context.working_directory / candidate
        resolved = candidate.resolve()
        try:
            relative = resolved.relative_to(root)
        except ValueError as exc:
            raise ContentRepositoryError(
                "Workspace write target is outside the Content Repository"
            ) from exc
        if not relative.parts:
            raise ContentRepositoryError(
                "Workspace write target is not a file"
            )
        return relative.as_posix()

    @staticmethod
    def _request_id(value: str, suffix: str) -> str:
        return (
            "workspace-mutation:"
            + canonical_digest({"request_id": value, "phase": suffix})[:48]
        )

    @staticmethod
    def _intent_id(change_set_id: str, operation_request_id: str) -> str:
        return (
            "gitintent_"
            + canonical_digest(
                {
                    "change_set_id": change_set_id,
                    "operation_request_id": operation_request_id,
                }
            )[:32]
        )


def get_default_workspace_mutation_service() -> WorkspaceMutationService:
    return WorkspaceMutationService(
        get_default_run_journal(),
        state_root=configured_run_journal_path().parent / "workspace-git",
    )
