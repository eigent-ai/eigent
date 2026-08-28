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

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import artifacts
from app.run_context import RunContext
from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.workspace_git import (
    ContentRepositoryService,
    GitBackend,
    WorkforceGitService,
    WorkspaceGitCoordinator,
    WorkspaceGitLifecycle,
    WorkspaceMutationService,
)


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def _context(space: Path) -> RunContext:
    return RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="task-1",
        email="user@example.com",
        user_id="user-1",
        working_directory=space,
        task_output_root=space,
        camel_log_dir=space / ".logs",
        binding_source="test",
        workdir_mode="direct-write",
        browser_port=9222,
    )


def test_terminal_run_promotes_refreshes_and_archives(
    tmp_path, journal, monkeypatch
):
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir()
    git = GitBackend(hooks_path=hooks)
    state_root = tmp_path / "state"
    content = ContentRepositoryService(
        journal,
        state_root=state_root,
        git_backend=git,
    )
    coordinator = WorkspaceGitCoordinator(
        journal,
        state_root=state_root,
        git_backend=git,
    )
    mutations = WorkspaceMutationService(
        journal,
        state_root=state_root,
        coordinator=coordinator,
        primary_checkout_enabled=False,
    )
    lifecycle = WorkspaceGitLifecycle(
        journal,
        state_root=state_root,
        coordinator=coordinator,
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
        eigent_owned_space=True,
    )
    seed = space / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    git.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert admission is not None
    prepared = mutations.prepare_file_write(
        context=_context(space),
        filename="generated.txt",
        operation_request_id="tool-call-1",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert prepared is not None
    active_ref = prepared.workspace.run.run_ref
    run_worktree = prepared.workspace.run_worktree
    prepared.target_path.write_text("project continuity", encoding="utf-8")
    mutations.complete_file_write(
        prepared,
        operation_request_id="tool-call-1",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    agent_before = journal.get_git_agent_workspace("run-1", "agent-1")
    assert agent_before is not None
    agent_worktree = Path(agent_before.worktree_path)
    agent_ref = agent_before.agent_ref
    agent_head = agent_before.head_commit

    original_complete_apply = journal.complete_project_auto_apply
    crashed = False

    def crash_after_files_before_sqlite(**kwargs):
        nonlocal crashed
        if not crashed:
            crashed = True
            raise RuntimeError("simulated crash after Space file projection")
        return original_complete_apply(**kwargs)

    monkeypatch.setattr(
        journal, "complete_project_auto_apply", crash_after_files_before_sqlite
    )
    interrupted_apply = lifecycle.prepare_successful_run("run-1")

    assert interrupted_apply.outcome == "prepared_project"
    assert (space / "generated.txt").read_text() == "project continuity"
    interrupted_project = journal.get_project_git_state("project-1")
    assert interrupted_project is not None
    assert interrupted_project.pending_apply is True

    monkeypatch.setattr(
        journal, "complete_project_auto_apply", original_complete_apply
    )
    prepared_result = lifecycle.prepare_successful_run("run-1")

    assert prepared_result.outcome == "prepared_space"
    assert (space / "generated.txt").read_text() == "project continuity"
    prepared_project = journal.get_project_git_state("project-1")
    assert prepared_project is not None
    assert prepared_project.pending_apply is False
    snapshot = SimpleNamespace(
        task_id="run-1",
        project_id="project-1",
        space_id="space-1",
        user_id="user-1",
        task_output_root=str(tmp_path / "missing-output-root"),
        working_directory=str(space),
        # Deliberately exclude every mtime. The committed Git delta remains
        # authoritative and must still produce the Artifact manifest.
        task_start_time=10_000_000_000,
        artifact_manifest=None,
    )
    resolver = MagicMock()
    resolver.store.find_snapshot.return_value = ("user@example.com", snapshot)
    monkeypatch.setattr(artifacts, "get_workspace_resolver", lambda: resolver)
    canonical_run = journal.get_run("run-1")
    assert canonical_run is not None
    manifest = artifacts.finalize_run_artifacts(journal, canonical_run)
    generated_artifact = next(
        item
        for item in manifest.payload["artifacts"]
        if item["relativePath"] == "generated.txt"
    )
    assert generated_artifact["path"] == str(
        (space / "generated.txt").resolve()
    )
    assert generated_artifact["uploadPolicy"] == "agent_generated"
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="run-1-completed",
            event_type="run.completed",
            payload={"reason": "test"},
        ),
    )

    result = lifecycle.finalize_run("run-1")
    replay = lifecycle.finalize_run("run-1")

    assert result.outcome == "archived"
    assert replay == result
    writer = journal.get_workspace_writer_request("workspace-writer:run-1")
    assert writer is not None and writer.status == "released"
    run = journal.get_run_git_materialization("run-1")
    project = journal.get_project_git_state("project-1")
    assert run is not None and project is not None
    assert run.materialization_state == "archived"
    assert run.worktree_path is None
    assert run.run_ref == result.archive_ref
    assert project.integration_head == run.promoted_commit
    assert project.projected_head == run.promoted_commit
    assert (Path(project.worktree_path) / "generated.txt").read_text() == (
        "project continuity"
    )
    assert not run_worktree.exists()
    assert active_ref is not None
    assert git.ref_oid(space, active_ref) is None
    assert result.archive_ref is not None
    assert git.ref_oid(space, result.archive_ref) == run.promoted_commit
    agent_after = journal.get_git_agent_workspace("run-1", "agent-1")
    assert agent_after is not None
    assert agent_after.state == "archived"
    assert agent_after.lease_token is None
    assert not agent_worktree.exists()
    assert git.ref_oid(space, agent_ref) is None
    assert agent_head is not None
    archive_operation = journal.get_git_operation(
        agent_after.last_operation_id or ""
    )
    assert archive_operation is not None
    assert archive_operation.status == "completed"
    assert archive_operation.result is not None
    agent_archive_ref = archive_operation.result["archive_ref"]
    assert git.ref_oid(space, agent_archive_ref) == agent_head


def test_eigent_space_auto_apply_never_overwrites_a_user_edit(
    tmp_path, journal
):
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir()
    git = GitBackend(hooks_path=hooks)
    state_root = tmp_path / "state"
    content = ContentRepositoryService(
        journal, state_root=state_root, git_backend=git
    )
    coordinator = WorkspaceGitCoordinator(
        journal, state_root=state_root, git_backend=git
    )
    mutations = WorkspaceMutationService(
        journal,
        state_root=state_root,
        coordinator=coordinator,
        primary_checkout_enabled=False,
    )
    lifecycle = WorkspaceGitLifecycle(
        journal, state_root=state_root, coordinator=coordinator
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
        eigent_owned_space=True,
    )
    seed = space / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    git.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    assert (
        coordinator.admit_run(
            space_id="space-1", project_id="project-1", run_id="run-1"
        )
        is not None
    )
    prepared = mutations.prepare_file_write(
        context=_context(space),
        filename="generated.txt",
        operation_request_id="tool-call-conflict",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert prepared is not None
    prepared.target_path.write_text("agent result", encoding="utf-8")
    mutations.complete_file_write(
        prepared,
        operation_request_id="tool-call-conflict",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    visible = space / "generated.txt"
    visible.write_text("user edit", encoding="utf-8")

    result = lifecycle.prepare_successful_run("run-1")

    assert result.outcome == "prepared_project"
    assert visible.read_text(encoding="utf-8") == "user edit"
    project = journal.get_project_git_state("project-1")
    assert project is not None
    assert project.pending_apply is True
    change_set = journal.get_git_change_set_for_run("run-1")
    assert change_set is not None
    assert change_set.state == "checkpointed"


def test_terminal_run_waits_for_unfinished_change_set_item(tmp_path, journal):
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir()
    git = GitBackend(hooks_path=hooks)
    state_root = tmp_path / "state"
    content = ContentRepositoryService(
        journal,
        state_root=state_root,
        git_backend=git,
    )
    coordinator = WorkspaceGitCoordinator(
        journal,
        state_root=state_root,
        git_backend=git,
    )
    mutations = WorkspaceMutationService(
        journal,
        state_root=state_root,
        coordinator=coordinator,
        primary_checkout_enabled=False,
    )
    lifecycle = WorkspaceGitLifecycle(
        journal,
        state_root=state_root,
        coordinator=coordinator,
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    seed = space / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    git.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    assert (
        coordinator.admit_run(
            space_id="space-1",
            project_id="project-1",
            run_id="run-1",
        )
        is not None
    )
    prepared = mutations.prepare_file_write(
        context=_context(space),
        filename="generated.txt",
        operation_request_id="unfinished-write",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert prepared is not None
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="run-1-completed",
            event_type="run.completed",
            payload={},
        ),
    )

    result = lifecycle.finalize_run("run-1")

    assert result.outcome == "deferred_mutation"
    run = journal.get_run_git_materialization("run-1")
    assert run is not None
    assert run.materialization_state == "materialized"
    assert prepared.workspace.run_worktree.exists()


def test_terminal_unmaterialized_run_creates_no_archive_ref(tmp_path, journal):
    lifecycle = WorkspaceGitLifecycle(journal, state_root=tmp_path / "state")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="run-1-completed",
            event_type="run.completed",
            payload={},
        ),
    )

    result = lifecycle.finalize_run("run-1")

    assert result.outcome == "not_materialized"
    assert result.archive_ref is None


def test_finalized_direct_run_replays_its_persisted_commit_after_head_moves(
    tmp_path,
    journal,
):
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir()
    git = GitBackend(hooks_path=hooks)
    state_root = tmp_path / "state"
    content = ContentRepositoryService(
        journal,
        state_root=state_root,
        git_backend=git,
    )
    coordinator = WorkspaceGitCoordinator(
        journal,
        state_root=state_root,
        git_backend=git,
    )
    lifecycle = WorkspaceGitLifecycle(
        journal,
        state_root=state_root,
        coordinator=coordinator,
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "result.txt"
    target.write_text("seed\n", encoding="utf-8")
    git.commit_paths(space, (target,), message="seed")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="run-1",
        session_mode="single-agent",
    )
    assert admission is not None
    target.write_text("run one\n", encoding="utf-8")
    first_terminal_head = git.commit_paths(
        space,
        (target,),
        message="run one",
    )
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="run-1-completed",
            event_type="run.completed",
            payload={},
        ),
    )

    first = lifecycle.finalize_run("run-1")
    target.write_text("later work\n", encoding="utf-8")
    later_head = git.commit_paths(space, (target,), message="later work")
    replay = lifecycle.finalize_run("run-1")

    assert later_head != first_terminal_head
    assert first.promoted_commit == first_terminal_head
    assert replay == first
    assert replay.promoted_commit != later_head
    writer = journal.get_workspace_writer_request("workspace-writer:run-1")
    assert writer is not None and writer.status == "released"
    assert [event.event_type for event in journal.list_events("run-1")].count(
        "workspace.writer.released"
    ) == 1


def test_noop_agent_archive_recovers_after_git_before_sqlite_crash(
    tmp_path,
    journal,
    monkeypatch,
):
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir()
    git = GitBackend(hooks_path=hooks)
    state_root = tmp_path / "state"
    content = ContentRepositoryService(
        journal,
        state_root=state_root,
        git_backend=git,
    )
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
    lifecycle = WorkspaceGitLifecycle(
        journal,
        state_root=state_root,
        coordinator=coordinator,
        workforce=workforce,
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(space_id="space-1", space_root=space, allow_init=True)
    seed = space / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    git.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert admission is not None
    workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run",
        expected_repo_state_digest=git.repo_state_token(space).digest,
        expected_project_version=admission.project.version,
        expected_project_head=admission.project.integration_head,
    )
    agent = workforce.ensure_agent_workspace(
        run_workspace=workspace,
        agent_id="reader",
        operation_request_id="materialize-agent",
    )
    agent_worktree = agent.agent_worktree
    workforce.release_workspace(agent)
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="run-1-completed",
            event_type="run.completed",
            payload={},
        ),
    )
    original_transition = journal.transition_git_agent_workspace
    crashed = False

    def crash_before_archive_state(*args, **kwargs):
        nonlocal crashed
        if kwargs.get("state") == "archived" and not crashed:
            crashed = True
            raise RuntimeError("simulated crash after Agent Git archive")
        return original_transition(*args, **kwargs)

    monkeypatch.setattr(
        journal,
        "transition_git_agent_workspace",
        crash_before_archive_state,
    )
    with pytest.raises(RuntimeError, match="simulated crash"):
        lifecycle.finalize_run("run-1")
    monkeypatch.setattr(
        journal,
        "transition_git_agent_workspace",
        original_transition,
    )

    partial = journal.get_git_agent_workspace("run-1", "reader")
    assert partial is not None and partial.state == "ready"
    assert not agent_worktree.exists()

    recovered = lifecycle.finalize_run("run-1")

    assert recovered.outcome == "archived"
    final_agent = journal.get_git_agent_workspace("run-1", "reader")
    assert final_agent is not None and final_agent.state == "archived"
