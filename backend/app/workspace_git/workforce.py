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

"""Per-agent worktrees and serialized integration into a Run workspace."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path

from app.run_journal import (
    GitAgentWorkspaceRecord,
    RunEventDraft,
    SQLiteRunJournal,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.run_journal.semantic_events import semantic_event_fields
from app.workspace_config import canonical_digest
from app.workspace_git.content import ContentRepositoryError
from app.workspace_git.coordinator import (
    GitRunWorkspace,
    WorkspaceGitCoordinator,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GitAgentWorkspace:
    record: GitAgentWorkspaceRecord
    run_workspace: GitRunWorkspace
    agent_worktree: Path
    lease_token: str


@dataclass(frozen=True)
class GitAgentMergeOutcome:
    workspace: GitAgentWorkspaceRecord
    status: str
    merged_commit: str | None
    conflict_paths: tuple[str, ...]
    interaction_id: str | None


@dataclass(frozen=True)
class GitAgentReconciliation:
    recovered_workspace_ids: tuple[str, ...]
    needs_attention_workspace_ids: tuple[str, ...]


class WorkforceGitService:
    """Own one writable worktree per Run/Agent and merge under one lock."""

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        state_root: Path,
        coordinator: WorkspaceGitCoordinator | None = None,
        lease_seconds: float = 300.0,
    ) -> None:
        if lease_seconds <= 0:
            raise ValueError("Agent workspace lease must be positive")
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.coordinator = coordinator or WorkspaceGitCoordinator(
            journal,
            state_root=self.state_root,
        )
        self.git = self.coordinator.git
        self.content = self.coordinator.content
        self.lease_seconds = lease_seconds

    def ensure_agent_workspace(
        self,
        *,
        run_workspace: GitRunWorkspace,
        agent_id: str,
        operation_request_id: str,
        now: float | None = None,
    ) -> GitAgentWorkspace:
        timestamp = now if now is not None else time.time()
        if not agent_id.strip() or not operation_request_id.strip():
            raise ValueError("Agent id and operation request id are required")
        run = run_workspace.run
        repository = self.journal.get_git_repository(run.repository_id)
        if repository is None or run.run_ref is None:
            raise ContentRepositoryError(
                "Run Agent workspace owner is missing"
            )
        run_head = self.git.current_head(run_workspace.run_worktree)
        if run_head is None:
            raise ContentRepositoryError("Run workspace has no HEAD")
        existing = self.journal.get_git_agent_workspace(run.run_id, agent_id)
        if existing is not None and existing.state in {
            "conflicted",
            "needs_attention",
            "archived",
        }:
            raise ContentRepositoryError(
                f"Agent workspace is {existing.state!r}"
            )
        base_commit = (
            existing.base_commit if existing is not None else run_head
        )
        workspace_id = (
            "agentws_"
            + canonical_digest({"run_id": run.run_id, "agent_id": agent_id})[
                :32
            ]
        )
        agent_ref = (
            existing.agent_ref
            if existing is not None
            else self._agent_ref(run.repository_id, run.run_id, agent_id)
        )
        agent_worktree = (
            Path(existing.worktree_path)
            if existing is not None
            else self._agent_worktree(
                repository.space_id, run.run_id, agent_id
            )
        )
        lease_token = canonical_digest(
            {
                "workspace_id": workspace_id,
                "operation_request_id": operation_request_id,
            }
        )
        record = self.journal.claim_git_agent_workspace(
            workspace_id=workspace_id,
            run_id=run.run_id,
            repository_id=run.repository_id,
            agent_id=agent_id,
            agent_ref=agent_ref,
            worktree_path=str(agent_worktree),
            base_commit=base_commit,
            lease_owner=operation_request_id,
            lease_token=lease_token,
            lease_until=timestamp + self.lease_seconds,
            now=timestamp,
        )

        if record.state in {"admitted", "materializing"}:
            record = self._materialize(
                record,
                run_workspace=run_workspace,
                lease_token=lease_token,
                operation_request_id=operation_request_id,
                now=timestamp,
            )
        elif record.state == "merging":
            record = self._recover_dispatched_merge(
                record,
                run_workspace=run_workspace,
                lease_token=lease_token,
                now=timestamp,
            )
        if record.state in {"ready", "merged"}:
            record = self._refresh_agent_projection(
                record,
                run_workspace=run_workspace,
                lease_token=lease_token,
                run_head=run_head,
                now=timestamp,
            )
        if record.state != "ready":
            raise ContentRepositoryError(
                f"Agent workspace is {record.state!r}"
            )
        return GitAgentWorkspace(
            record=record,
            run_workspace=run_workspace,
            agent_worktree=agent_worktree,
            lease_token=lease_token,
        )

    def merge_agent_workspace(
        self,
        workspace: GitAgentWorkspace,
        *,
        operation_request_id: str,
        now: float | None = None,
    ) -> GitAgentMergeOutcome:
        timestamp = now if now is not None else time.time()
        record = self.journal.get_git_agent_workspace(
            workspace.record.run_id, workspace.record.agent_id
        )
        if record is None or record.lease_token != workspace.lease_token:
            raise ContentRepositoryError(
                "Agent workspace lease is no longer held"
            )
        if record.state not in {"ready", "merging"}:
            raise ContentRepositoryError(
                f"Agent workspace cannot merge from {record.state!r}"
            )
        if not self.git.is_worktree_clean(workspace.agent_worktree):
            raise ContentRepositoryError(
                "Agent worktree has uncheckpointed changes"
            )
        repository = self.journal.get_git_repository(record.repository_id)
        if repository is None:
            raise ContentRepositoryError("Agent repository is unavailable")
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": record.repository_id,
                    "request_id": operation_request_id,
                }
            )[:32]
        )
        payload = {
            "workspace_id": record.workspace_id,
            "run_id": record.run_id,
            "agent_id": record.agent_id,
            "agent_ref": record.agent_ref,
            "agent_head": self.git.current_head(workspace.agent_worktree),
        }
        run_root = workspace.run_workspace.run_worktree
        with self.content.repository_lock(
            self.content.repository_lock_path(repository.space_id)
        ):
            current_run_state = self.git.repo_state_token(run_root)
            existing_operation = self.journal.get_git_operation(operation_id)
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=record.repository_id,
                request_id=operation_request_id,
                operation_type="agent.merge",
                payload_digest=canonical_digest(payload),
                expected_repo_state_digest=(
                    existing_operation.expected_repo_state_digest
                    if existing_operation is not None
                    else current_run_state.digest
                ),
            )
            if record.state == "ready":
                record = self.journal.transition_git_agent_workspace(
                    record.workspace_id,
                    lease_token=workspace.lease_token,
                    expected_state="ready",
                    state="merging",
                    last_operation_id=operation_id,
                    now=timestamp,
                )
            if operation.status == "prepared":
                self.journal.mark_git_operation_dispatched(
                    operation_id,
                    observed_repo_state_digest=current_run_state.digest,
                )
            recovered = self.git.find_commit_by_operation(
                run_root, operation_id
            )
            if recovered is not None:
                return self._complete_merge(
                    record,
                    workspace=workspace,
                    operation_id=operation_id,
                    merged_commit=recovered,
                    now=timestamp,
                )
            result = self.git.merge_owned_ref(
                run_root,
                source_ref=record.agent_ref,
                operation_id=operation_id,
                message=f"Merge Agent {record.agent_id} into Run {record.run_id}",
            )
            if result.conflict_paths:
                return self._record_conflict(
                    record,
                    workspace=workspace,
                    operation_id=operation_id,
                    conflict_paths=result.conflict_paths,
                    now=timestamp,
                )
            assert result.commit_oid is not None
            return self._complete_merge(
                record,
                workspace=workspace,
                operation_id=operation_id,
                merged_commit=result.commit_oid,
                now=timestamp,
            )

    def release_workspace(self, workspace: GitAgentWorkspace) -> None:
        self.journal.release_git_agent_workspace_lease(
            workspace.record.workspace_id,
            lease_token=workspace.lease_token,
        )

    def renew_workspace(
        self,
        workspace: GitAgentWorkspace,
        *,
        now: float | None = None,
    ) -> GitAgentWorkspace:
        """Keep a long-running Agent operation's workspace lease alive."""

        timestamp = now if now is not None else time.time()
        record = self.journal.renew_git_agent_workspace_lease(
            workspace.record.workspace_id,
            lease_token=workspace.lease_token,
            lease_until=timestamp + self.lease_seconds,
            now=timestamp,
        )
        return GitAgentWorkspace(
            record=record,
            run_workspace=workspace.run_workspace,
            agent_worktree=workspace.agent_worktree,
            lease_token=workspace.lease_token,
        )

    def reconcile_startup(
        self, *, now: float | None = None
    ) -> GitAgentReconciliation:
        timestamp = now if now is not None else time.time()
        recovered: list[str] = []
        attention: list[str] = []
        self.journal.reset_git_agent_workspace_leases_after_restart(
            now=timestamp
        )
        for record in self.journal.list_git_agent_workspaces(
            states=("materializing", "merging")
        ):
            run = self.journal.get_run_git_materialization(record.run_id)
            project = (
                self.journal.get_project_git_state(run.project_id)
                if run is not None
                else None
            )
            if (
                run is None
                or project is None
                or run.worktree_path is None
                or project.worktree_path is None
            ):
                attention.append(record.workspace_id)
                continue
            run_workspace = GitRunWorkspace(
                project=project,
                run=run,
                project_worktree=Path(project.worktree_path),
                run_worktree=Path(run.worktree_path),
            )
            try:
                recovered_workspace = self.ensure_agent_workspace(
                    run_workspace=run_workspace,
                    agent_id=record.agent_id,
                    operation_request_id=(
                        f"startup-agent-reconcile:{record.workspace_id}"
                    ),
                    now=timestamp,
                )
                self.release_workspace(recovered_workspace)
            except Exception:
                current = self.journal.get_git_agent_workspace(
                    record.run_id, record.agent_id
                )
                if current is not None and current.state == "conflicted":
                    recovered.append(record.workspace_id)
                else:
                    logger.exception(
                        "Agent workspace startup reconciliation needs attention",
                        extra={"workspace_id": record.workspace_id},
                    )
                    attention.append(record.workspace_id)
            else:
                if record.workspace_id not in recovered:
                    recovered.append(record.workspace_id)
        for record in self.journal.list_git_agent_workspaces(
            states=("conflicted",)
        ):
            interaction_id = record.conflict_interaction_id
            interaction = (
                self.journal.get_human_interaction(interaction_id)
                if interaction_id
                else None
            )
            if interaction is None or interaction.status != "resolved":
                continue
            try:
                self.resolve_merge_conflict(interaction.interaction_id)
            except Exception:
                logger.exception(
                    "Resolved Agent merge conflict needs attention",
                    extra={"workspace_id": record.workspace_id},
                )
                attention.append(record.workspace_id)
            else:
                if record.workspace_id not in recovered:
                    recovered.append(record.workspace_id)
        return GitAgentReconciliation(tuple(recovered), tuple(attention))

    def resolve_merge_conflict(
        self,
        interaction_id: str,
        *,
        now: float | None = None,
    ) -> GitAgentMergeOutcome:
        """Apply one durable merge-conflict decision idempotently."""

        timestamp = now if now is not None else time.time()
        interaction = self.journal.get_human_interaction(interaction_id)
        if (
            interaction is None
            or interaction.interaction_type != "merge_conflict"
            or interaction.status != "resolved"
        ):
            raise ContentRepositoryError(
                "Merge conflict has no resolved HumanInteraction"
            )
        decisions = self.journal.list_human_interaction_decisions(
            interaction_id
        )
        if not decisions:
            raise ContentRepositoryError("Merge conflict decision is missing")
        decision_record = decisions[-1]
        decision = self._conflict_decision(decision_record.decision)
        record = next(
            (
                item
                for item in self.journal.list_git_agent_workspaces(
                    run_id=interaction.run_id
                )
                if item.conflict_interaction_id == interaction_id
            ),
            None,
        )
        if record is None:
            raise ContentRepositoryError(
                "Merge conflict Agent workspace is unavailable"
            )
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": record.repository_id,
                    "request_id": (
                        f"merge-conflict:{decision_record.decision_id}"
                    ),
                }
            )[:32]
        )
        if record.state == "merged":
            operation = self.journal.get_git_operation(operation_id)
            run_state = self.journal.get_run_git_materialization(record.run_id)
            if (
                operation is not None
                and operation.status == "dispatched"
                and run_state is not None
                and run_state.worktree_path
                and record.head_commit is not None
            ):
                self.journal.complete_git_operation(
                    operation_id,
                    result={
                        "workspace_id": record.workspace_id,
                        "decision": decision,
                        "commit_oid": record.head_commit,
                    },
                    observed_repo_state_digest=self.git.repo_state_token(
                        Path(run_state.worktree_path)
                    ).digest,
                    now=timestamp,
                )
            return GitAgentMergeOutcome(
                record,
                "merged",
                record.head_commit,
                (),
                interaction_id,
            )
        if record.state == "needs_attention" and decision == "manual":
            return GitAgentMergeOutcome(
                record,
                "needs_attention",
                None,
                tuple(interaction.request.get("conflict_paths") or ()),
                interaction_id,
            )
        run = self.journal.get_run_git_materialization(record.run_id)
        project = (
            self.journal.get_project_git_state(run.project_id)
            if run is not None
            else None
        )
        repository = self.journal.get_git_repository(record.repository_id)
        if (
            run is None
            or project is None
            or repository is None
            or not run.worktree_path
            or not project.worktree_path
        ):
            raise ContentRepositoryError(
                "Merge conflict Run workspace is unavailable"
            )
        run_workspace = GitRunWorkspace(
            project=project,
            run=run,
            project_worktree=Path(project.worktree_path),
            run_worktree=Path(run.worktree_path),
        )
        lease_owner = f"resolve:{interaction_id}"
        lease_token = canonical_digest(
            {
                "workspace_id": record.workspace_id,
                "decision_id": decision_record.decision_id,
            }
        )
        record = self.journal.claim_git_agent_workspace(
            workspace_id=record.workspace_id,
            run_id=record.run_id,
            repository_id=record.repository_id,
            agent_id=record.agent_id,
            agent_ref=record.agent_ref,
            worktree_path=record.worktree_path,
            base_commit=record.base_commit,
            lease_owner=lease_owner,
            lease_token=lease_token,
            lease_until=timestamp + self.lease_seconds,
            now=timestamp,
        )
        conflict_paths = tuple(
            str(path) for path in interaction.request.get("conflict_paths", [])
        )
        if decision == "manual":
            record = self.journal.transition_git_agent_workspace(
                record.workspace_id,
                lease_token=lease_token,
                expected_state="conflicted",
                state="needs_attention",
                conflict_interaction_id=interaction_id,
                release_lease=True,
                run_event=self._conflict_resolved_event(
                    record,
                    interaction_id=interaction_id,
                    decision=decision,
                    commit_oid=None,
                    now=timestamp,
                ),
                now=timestamp,
            )
            return GitAgentMergeOutcome(
                record,
                "needs_attention",
                None,
                conflict_paths,
                interaction_id,
            )

        run_root = run_workspace.run_worktree
        agent_root = Path(record.worktree_path)
        with self.content.repository_lock(
            self.content.repository_lock_path(repository.space_id)
        ):
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=record.repository_id,
                request_id=f"merge-conflict:{decision_record.decision_id}",
                operation_type="agent.resolve_conflict",
                payload_digest=canonical_digest(
                    {
                        "workspace_id": record.workspace_id,
                        "interaction_id": interaction_id,
                        "decision": decision,
                        "paths": conflict_paths,
                    }
                ),
                expected_repo_state_digest=self.git.repo_state_token(
                    run_root
                ).digest,
            )
            if operation.status == "prepared":
                self.journal.mark_git_operation_dispatched(
                    operation_id,
                    observed_repo_state_digest=self.git.repo_state_token(
                        run_root
                    ).digest,
                    now=timestamp,
                )
            recovered = self.git.find_commit_by_operation(
                run_root, operation_id
            )
            if decision == "take_agent" and recovered is None:
                self.git.restore_owned_paths_from_ref(
                    run_root,
                    source_ref=record.agent_ref,
                    relative_paths=conflict_paths,
                )
                recovered = self.git.commit_paths(
                    run_root,
                    tuple(run_root / path for path in conflict_paths),
                    message=(
                        "Resolve Agent merge conflict\n\n"
                        f"Eigent-Operation: {operation_id}\n"
                        f"Eigent-Interaction: {interaction_id}"
                    ),
                    author_name="Eigent User",
                    author_email="noreply@eigent.ai",
                )
            if recovered is None:
                recovered = self.git.current_head(run_root)
            if recovered is None:
                raise ContentRepositoryError("Run workspace has no HEAD")
            current_agent_head = self.git.current_head(agent_root)
            if current_agent_head is None:
                raise ContentRepositoryError("Agent workspace has no HEAD")
            self.git.refresh_owned_worktree(
                agent_root,
                expected_projected_head=current_agent_head,
                target_head=recovered,
            )
            self.journal.complete_git_operation(
                operation_id,
                result={
                    "workspace_id": record.workspace_id,
                    "decision": decision,
                    "commit_oid": recovered,
                },
                observed_repo_state_digest=self.git.repo_state_token(
                    run_root
                ).digest,
                now=timestamp,
            )
            record = self.journal.transition_git_agent_workspace(
                record.workspace_id,
                lease_token=lease_token,
                expected_state="conflicted",
                state="merged",
                head_commit=recovered,
                last_operation_id=operation_id,
                conflict_interaction_id=interaction_id,
                release_lease=True,
                run_event=self._conflict_resolved_event(
                    record,
                    interaction_id=interaction_id,
                    decision=decision,
                    commit_oid=recovered,
                    now=timestamp,
                ),
                now=timestamp,
            )
        return GitAgentMergeOutcome(
            record,
            "merged",
            recovered,
            (),
            interaction_id,
        )

    def _materialize(
        self,
        record: GitAgentWorkspaceRecord,
        *,
        run_workspace: GitRunWorkspace,
        lease_token: str,
        operation_request_id: str,
        now: float,
    ) -> GitAgentWorkspaceRecord:
        repository = self.journal.get_git_repository(record.repository_id)
        if repository is None:
            raise ContentRepositoryError("Agent repository is unavailable")
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": record.repository_id,
                    "request_id": f"{operation_request_id}:materialize-agent",
                }
            )[:32]
        )
        with self.content.repository_lock(
            self.content.repository_lock_path(repository.space_id)
        ):
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=record.repository_id,
                request_id=f"{operation_request_id}:materialize-agent",
                operation_type="agent.materialize",
                payload_digest=canonical_digest(
                    {
                        "workspace_id": record.workspace_id,
                        "agent_ref": record.agent_ref,
                        "base_commit": record.base_commit,
                    }
                ),
                expected_repo_state_digest=self.git.repo_state_token(
                    Path(repository.root_path)
                ).digest,
            )
            if record.state == "admitted":
                record = self.journal.transition_git_agent_workspace(
                    record.workspace_id,
                    lease_token=lease_token,
                    expected_state="admitted",
                    state="materializing",
                    last_operation_id=operation_id,
                    now=now,
                )
            if operation.status == "prepared":
                self.journal.mark_git_operation_dispatched(
                    operation_id,
                    observed_repo_state_digest=self.git.repo_state_token(
                        Path(repository.root_path)
                    ).digest,
                )
            self.git.ensure_worktree(
                Path(repository.root_path),
                worktree_path=Path(record.worktree_path),
                ref_name=record.agent_ref,
                commit_oid=record.base_commit,
            )
            head = self.git.current_head(Path(record.worktree_path))
            if head is None:
                raise ContentRepositoryError("Agent worktree has no HEAD")
            self.journal.complete_git_operation(
                operation_id,
                result={"workspace_id": record.workspace_id, "head": head},
                observed_repo_state_digest=self.git.repo_state_token(
                    Path(record.worktree_path)
                ).digest,
                now=now,
            )
            return self.journal.transition_git_agent_workspace(
                record.workspace_id,
                lease_token=lease_token,
                expected_state="materializing",
                state="ready",
                head_commit=head,
                last_operation_id=operation_id,
                now=now,
            )

    def _refresh_agent_projection(
        self,
        record: GitAgentWorkspaceRecord,
        *,
        run_workspace: GitRunWorkspace,
        lease_token: str,
        run_head: str,
        now: float,
    ) -> GitAgentWorkspaceRecord:
        root = Path(record.worktree_path)
        current = self.git.current_head(root)
        if current is None:
            raise ContentRepositoryError("Agent worktree has no HEAD")
        if current != run_head:
            if not self.git.is_worktree_clean(root):
                raise ContentRepositoryError(
                    "Agent worktree changed before projection refresh"
                )
            if self.git.is_ancestor(root, run_head, current):
                # The Agent already has checkpointed commits which have not
                # yet been merged into Run integration (for example after a
                # crash between checkpoint and merge). Preserve that durable
                # result for reconciliation instead of resetting it away.
                return self.journal.transition_git_agent_workspace(
                    record.workspace_id,
                    lease_token=lease_token,
                    expected_state=record.state,
                    state="ready",
                    head_commit=current,
                    conflict_interaction_id=None,
                    now=now,
                )
            if not self.git.is_ancestor(root, current, run_head):
                raise ContentRepositoryError(
                    "Agent branch diverged from Run integration"
                )
            self.git.refresh_owned_worktree(
                root,
                expected_projected_head=current,
                target_head=run_head,
            )
        return self.journal.transition_git_agent_workspace(
            record.workspace_id,
            lease_token=lease_token,
            expected_state=record.state,
            state="ready",
            head_commit=run_head,
            conflict_interaction_id=None,
            now=now,
        )

    def _recover_dispatched_merge(
        self,
        record: GitAgentWorkspaceRecord,
        *,
        run_workspace: GitRunWorkspace,
        lease_token: str,
        now: float,
    ) -> GitAgentWorkspaceRecord:
        operation_id = record.last_operation_id
        recovered = (
            self.git.find_commit_by_operation(
                run_workspace.run_worktree, operation_id
            )
            if operation_id
            else None
        )
        if recovered is not None:
            if operation_id is not None:
                self.journal.complete_git_operation(
                    operation_id,
                    result={
                        "workspace_id": record.workspace_id,
                        "merged_commit": recovered,
                    },
                    observed_repo_state_digest=self.git.repo_state_token(
                        run_workspace.run_worktree
                    ).digest,
                    now=now,
                )
            return self.journal.transition_git_agent_workspace(
                record.workspace_id,
                lease_token=lease_token,
                expected_state="merging",
                state="merged",
                head_commit=recovered,
                last_operation_id=operation_id,
                run_event=RunEventDraft(
                    event_id=f"git-agent-merge:{operation_id}",
                    event_type="git.agent_merged",
                    payload={
                        **semantic_event_fields(
                            kind="git_integration",
                            subject_type="agent_workspace",
                            subject_id=record.workspace_id,
                            phase="completed",
                            status="completed",
                            source="workforce_git",
                            actor_type="agent",
                            actor_id=record.agent_id,
                            correlation={
                                "run_id": record.run_id,
                                "operation_id": operation_id,
                            },
                        ),
                        "workspace_id": record.workspace_id,
                        "agent_id": record.agent_id,
                        "commit_oid": recovered,
                        "recovered": True,
                        "display_title": "Integrated agent changes",
                        "display_summary": (
                            f"Recovered merge at {recovered[:8]}"
                        ),
                    },
                    created_at=now,
                ),
                now=now,
            )
        pending_conflict = next(
            (
                interaction
                for interaction in self.journal.list_human_interactions(
                    record.run_id
                )
                if interaction.interaction_type == "merge_conflict"
                and interaction.status in {"requested", "presented"}
                and interaction.request.get("agent_id") == record.agent_id
            ),
            None,
        )
        operation = (
            self.journal.get_git_operation(operation_id)
            if operation_id is not None
            else None
        )
        conflict_result = operation.result if operation is not None else None
        if pending_conflict is not None or (
            conflict_result is not None
            and conflict_result.get("status")
            in {"conflicted", "needs_attention"}
        ):
            interaction_id = (
                pending_conflict.interaction_id
                if pending_conflict is not None
                else conflict_result.get("interaction_id")
            )
            conflict_paths = tuple(
                str(path)
                for path in (
                    pending_conflict.request.get("conflict_paths", [])
                    if pending_conflict is not None
                    else conflict_result.get("conflict_paths", [])
                )
            )
            state = "conflicted" if interaction_id else "needs_attention"
            if operation_id is not None:
                self.journal.complete_git_operation(
                    operation_id,
                    result={
                        "workspace_id": record.workspace_id,
                        "status": state,
                        "conflict_paths": list(conflict_paths),
                        "interaction_id": interaction_id,
                    },
                    observed_repo_state_digest=self.git.repo_state_token(
                        run_workspace.run_worktree
                    ).digest,
                    now=now,
                )
            return self.journal.transition_git_agent_workspace(
                record.workspace_id,
                lease_token=lease_token,
                expected_state="merging",
                state=state,
                last_operation_id=operation_id,
                conflict_interaction_id=(
                    str(interaction_id) if interaction_id else None
                ),
                release_lease=True,
                now=now,
            )
        if not self.git.is_worktree_clean(run_workspace.run_worktree):
            raise ContentRepositoryError(
                "Interrupted Run merge left an unclean integration worktree"
            )
        return self.journal.transition_git_agent_workspace(
            record.workspace_id,
            lease_token=lease_token,
            expected_state="merging",
            state="ready",
            now=now,
        )

    def _complete_merge(
        self,
        record: GitAgentWorkspaceRecord,
        *,
        workspace: GitAgentWorkspace,
        operation_id: str,
        merged_commit: str,
        now: float,
    ) -> GitAgentMergeOutcome:
        agent_head = self.git.current_head(workspace.agent_worktree)
        if agent_head is None:
            raise ContentRepositoryError("Agent worktree has no HEAD")
        if agent_head != merged_commit:
            self.git.refresh_owned_worktree(
                workspace.agent_worktree,
                expected_projected_head=agent_head,
                target_head=merged_commit,
            )
        self.journal.complete_git_operation(
            operation_id,
            result={
                "workspace_id": record.workspace_id,
                "merged_commit": merged_commit,
            },
            observed_repo_state_digest=self.git.repo_state_token(
                workspace.run_workspace.run_worktree
            ).digest,
            now=now,
        )
        record = self.journal.transition_git_agent_workspace(
            record.workspace_id,
            lease_token=workspace.lease_token,
            expected_state="merging",
            state="merged",
            head_commit=merged_commit,
            last_operation_id=operation_id,
            release_lease=True,
            run_event=RunEventDraft(
                event_id=f"git-agent-merge:{operation_id}",
                event_type="git.agent_merged",
                payload={
                    **semantic_event_fields(
                        kind="git_integration",
                        subject_type="agent_workspace",
                        subject_id=record.workspace_id,
                        phase="completed",
                        status="completed",
                        source="workforce_git",
                        actor_type="agent",
                        actor_id=record.agent_id,
                        correlation={
                            "run_id": record.run_id,
                            "operation_id": operation_id,
                        },
                    ),
                    "workspace_id": record.workspace_id,
                    "agent_id": record.agent_id,
                    "commit_oid": merged_commit,
                    "display_title": "Integrated agent changes",
                    "display_summary": (
                        f"Merged agent work at {merged_commit[:8]}"
                    ),
                },
                created_at=now,
            ),
            now=now,
        )
        return GitAgentMergeOutcome(record, "merged", merged_commit, (), None)

    def _record_conflict(
        self,
        record: GitAgentWorkspaceRecord,
        *,
        workspace: GitAgentWorkspace,
        operation_id: str,
        conflict_paths: tuple[str, ...],
        now: float,
    ) -> GitAgentMergeOutcome:
        run = self.journal.get_run(record.run_id)
        interaction_id: str | None = None
        if run is not None and run.status not in {
            "completed",
            "failed",
            "cancelled",
        }:
            interaction_id = (
                "merge-conflict:"
                + canonical_digest(
                    {
                        "workspace_id": record.workspace_id,
                        "operation_id": operation_id,
                        "paths": conflict_paths,
                    }
                )[:32]
            )
            self.journal.create_human_interaction(
                interaction_id=interaction_id,
                run_id=record.run_id,
                attempt_id=run.active_attempt_id,
                interaction_type="merge_conflict",
                request={
                    "title": "Agent changes need conflict resolution",
                    "question": (
                        f"Agent {record.agent_id} changed files that also "
                        "changed in the Run workspace."
                    ),
                    "agent_id": record.agent_id,
                    "agent_ref": record.agent_ref,
                    "conflict_paths": list(conflict_paths),
                },
                options=[
                    {
                        "id": "keep_run",
                        "label": "Keep Run version",
                    },
                    {
                        "id": "take_agent",
                        "label": "Use Agent version",
                    },
                    {"id": "manual", "label": "Resolve manually"},
                ],
                requested_by="workspace_git",
                now=now,
            )
        target_state = "conflicted" if interaction_id else "needs_attention"
        self.journal.complete_git_operation(
            operation_id,
            result={
                "workspace_id": record.workspace_id,
                "status": target_state,
                "conflict_paths": list(conflict_paths),
                "interaction_id": interaction_id,
            },
            observed_repo_state_digest=self.git.repo_state_token(
                workspace.run_workspace.run_worktree
            ).digest,
            now=now,
        )
        record = self.journal.transition_git_agent_workspace(
            record.workspace_id,
            lease_token=workspace.lease_token,
            expected_state="merging",
            state=target_state,
            last_operation_id=operation_id,
            conflict_interaction_id=interaction_id,
            release_lease=True,
            now=now,
        )
        return GitAgentMergeOutcome(
            record,
            "conflicted",
            None,
            conflict_paths,
            interaction_id,
        )

    @staticmethod
    def _conflict_decision(value: dict) -> str:
        decision = value.get("decision")
        if decision is None:
            decision = value.get("option_id", value.get("choice"))
        if decision not in {"keep_run", "take_agent", "manual"}:
            raise ContentRepositoryError(
                "Merge conflict decision must be keep_run, take_agent, or manual"
            )
        return str(decision)

    @staticmethod
    def _conflict_resolved_event(
        record: GitAgentWorkspaceRecord,
        *,
        interaction_id: str,
        decision: str,
        commit_oid: str | None,
        now: float,
    ) -> RunEventDraft:
        return RunEventDraft(
            event_id=f"git-agent-conflict:{interaction_id}:{decision}",
            event_type="git.agent_conflict_resolved",
            payload={
                **semantic_event_fields(
                    kind="git_conflict_resolution",
                    subject_type="agent_workspace",
                    subject_id=record.workspace_id,
                    phase="completed",
                    status="completed",
                    source="workforce_git",
                    actor_type="user",
                    correlation={
                        "run_id": record.run_id,
                        "interaction_id": interaction_id,
                    },
                ),
                "workspace_id": record.workspace_id,
                "agent_id": record.agent_id,
                "interaction_id": interaction_id,
                "decision": decision,
                "commit_oid": commit_oid,
                "display_title": "Resolved merge conflict",
                "display_summary": (
                    f"Resolution: {decision.replace('_', ' ')}"
                ),
            },
            created_at=now,
        )

    @staticmethod
    def _segment(*values: str) -> str:
        return canonical_digest(list(values))[:24]

    def _agent_ref(
        self, repository_id: str, run_id: str, agent_id: str
    ) -> str:
        return (
            # Run integration already owns refs/heads/eigent/run/<run> as a
            # leaf. Git cannot create child refs below an existing leaf, so
            # Agent branches live in a sibling namespace.
            "refs/heads/eigent/agent/"
            + self._segment(repository_id, run_id)
            + "/"
            + self._segment(agent_id)
        )

    def _agent_worktree(
        self, space_id: str, run_id: str, agent_id: str
    ) -> Path:
        return (
            self.state_root
            / "worktrees"
            / self._segment("space", space_id)
            / "runs"
            / self._segment("run", run_id)
            / "agents"
            / self._segment("agent", agent_id)
        )


def get_default_workforce_git_service() -> WorkforceGitService:
    return WorkforceGitService(
        get_default_run_journal(),
        state_root=configured_run_journal_path().parent / "workspace-git",
    )
