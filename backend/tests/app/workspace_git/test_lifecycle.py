from __future__ import annotations

from pathlib import Path

import pytest

from app.run_context import RunContext
from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.workspace_git import (
    ContentRepositoryService,
    GitBackend,
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


def test_terminal_run_promotes_refreshes_and_archives(tmp_path, journal):
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
    assert coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    ) is not None
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
