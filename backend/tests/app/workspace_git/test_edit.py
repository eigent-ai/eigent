from __future__ import annotations

import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app.run_journal import SQLiteRunJournal
from app.workspace_git import (
    ContentRepositoryService,
    RepositoryStateChangedError,
    RunWorkspaceEditService,
    WorkforceGitService,
    WorkspaceGitCoordinator,
)


@pytest.fixture()
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as value:
        yield value


def _setup(tmp_path: Path, journal: SQLiteRunJournal):
    state_root = tmp_path / "state"
    git = ContentRepositoryService(journal, state_root=state_root)
    space = tmp_path / "space"
    space.mkdir()
    git.bootstrap(space_id="space-1", space_root=space, allow_init=True)
    seed = space / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    git.git.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    coordinator = WorkspaceGitCoordinator(
        journal,
        state_root=state_root,
        git_backend=git.git,
    )
    coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    project = journal.get_project_git_state("project-1")
    repository = journal.get_space_git_repository(space_id="space-1")
    assert project is not None and repository is not None
    workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run",
        expected_repo_state_digest=git.git.repo_state_token(space).digest,
        expected_project_version=project.version,
        expected_project_head=project.integration_head,
    )
    edits = RunWorkspaceEditService(
        journal,
        state_root=state_root,
        coordinator=coordinator,
    )
    workforce = WorkforceGitService(
        journal,
        state_root=state_root,
        coordinator=coordinator,
    )
    return git.git, edits, workforce, workspace


def test_user_edit_is_checkpointed_and_idempotent(tmp_path, journal):
    backend, edits, _, workspace = _setup(tmp_path, journal)

    first = edits.save_text(
        run_id="run-1",
        relative_path="notes/progress.md",
        content="user checkpoint",
        operation_request_id="user-save-1",
        editor_session_id="editor-1",
        actor_id="user-1",
    )
    replay = edits.save_text(
        run_id="run-1",
        relative_path="notes/progress.md",
        content="user checkpoint",
        operation_request_id="user-save-1",
        editor_session_id="editor-1",
        actor_id="user-1",
    )

    assert replay.checkpoint.checkpoint_id == first.checkpoint.checkpoint_id
    assert backend.is_worktree_clean(workspace.run_worktree)
    assert (workspace.run_worktree / "notes/progress.md").read_text() == (
        "user checkpoint"
    )
    assert first.checkpoint.target_role == "run"
    assert first.checkpoint.actor_id == "user-1"


def test_user_edit_rejects_stale_preimage(tmp_path, journal):
    _, edits, _, _ = _setup(tmp_path, journal)

    edits.save_text(
        run_id="run-1",
        relative_path="notes.txt",
        content="one",
        operation_request_id="save-one",
        editor_session_id="editor-1",
        actor_id="user-1",
    )

    with pytest.raises(RepositoryStateChangedError):
        edits.save_text(
            run_id="run-1",
            relative_path="notes.txt",
            content="two",
            operation_request_id="save-two",
            editor_session_id="editor-1",
            actor_id="user-1",
            expected_content_digest=hashlib.sha256(b"stale").hexdigest(),
        )


def test_agent_merge_conflicts_with_checkpointed_user_edit(tmp_path, journal):
    backend, edits, workforce, workspace = _setup(tmp_path, journal)
    agent = workforce.ensure_agent_workspace(
        run_workspace=workspace,
        agent_id="writer",
        operation_request_id="agent-write",
    )
    agent_file = agent.agent_worktree / "shared.txt"
    agent_file.write_text("agent", encoding="utf-8")
    workforce.content.checkpoint(
        workspace.run.repository_id,
        operation_request_id="agent-checkpoint",
        expected_repo_state_digest=backend.repo_state_token(
            agent.agent_worktree
        ).digest,
        paths=(agent_file,),
        path_sources={"shared.txt": "agent_created"},
        target_role="agent",
        target_id=agent.record.workspace_id,
        actor_id="writer",
        trigger="test",
        message="agent change",
        worktree_root=agent.agent_worktree,
    )
    edits.save_text(
        run_id="run-1",
        relative_path="shared.txt",
        content="user",
        operation_request_id="user-write",
        editor_session_id="editor-1",
        actor_id="user-1",
    )

    outcome = workforce.merge_agent_workspace(
        agent,
        operation_request_id="merge-after-user-edit",
    )

    assert outcome.status == "conflicted"
    assert outcome.conflict_paths == ("shared.txt",)
    assert backend.is_worktree_clean(workspace.run_worktree)
    interaction = journal.get_human_interaction(outcome.interaction_id or "")
    assert interaction is not None
    assert interaction.interaction_type == "merge_conflict"
    assert journal.get_run("run-1").status == "waiting_for_user"

    journal.resolve_human_interaction(
        interaction.interaction_id,
        decision_request_id="resolve-conflict-1",
        decision={"decision": "take_agent"},
        expected_version=interaction.version,
        expected_run_id="run-1",
    )
    resolved = workforce.resolve_merge_conflict(interaction.interaction_id)
    replay = workforce.resolve_merge_conflict(interaction.interaction_id)

    assert resolved.status == "merged"
    assert replay.merged_commit == resolved.merged_commit
    assert (workspace.run_worktree / "shared.txt").read_text() == "agent"
    assert backend.is_worktree_clean(workspace.run_worktree)


def test_user_edit_holds_mutation_lock_through_checkpoint(
    tmp_path, journal, monkeypatch
):
    backend, edits, workforce, workspace = _setup(tmp_path, journal)
    agent = workforce.ensure_agent_workspace(
        run_workspace=workspace,
        agent_id="writer",
        operation_request_id="agent-write",
    )
    agent_file = agent.agent_worktree / "agent.txt"
    agent_file.write_text("agent", encoding="utf-8")
    workforce.content.checkpoint(
        workspace.run.repository_id,
        operation_request_id="agent-checkpoint",
        expected_repo_state_digest=backend.repo_state_token(
            agent.agent_worktree
        ).digest,
        paths=(agent_file,),
        path_sources={"agent.txt": "agent_created"},
        target_role="agent",
        target_id=agent.record.workspace_id,
        actor_id="writer",
        trigger="test",
        message="agent change",
        worktree_root=agent.agent_worktree,
    )

    checkpoint_entered = threading.Event()
    release_checkpoint = threading.Event()
    merge_entered = threading.Event()
    original_checkpoint = edits.content.checkpoint
    original_merge = backend.merge_owned_ref

    def paused_checkpoint(*args, **kwargs):
        if kwargs.get("operation_request_id") == "user-save:checkpoint":
            checkpoint_entered.set()
            assert release_checkpoint.wait(timeout=5)
        return original_checkpoint(*args, **kwargs)

    def observed_merge(*args, **kwargs):
        merge_entered.set()
        return original_merge(*args, **kwargs)

    monkeypatch.setattr(edits.content, "checkpoint", paused_checkpoint)
    monkeypatch.setattr(backend, "merge_owned_ref", observed_merge)

    with ThreadPoolExecutor(max_workers=2) as executor:
        save = executor.submit(
            edits.save_text,
            run_id="run-1",
            relative_path="user.txt",
            content="user",
            operation_request_id="user-save",
            editor_session_id="editor-1",
            actor_id="user-1",
        )
        assert checkpoint_entered.wait(timeout=5)
        merge = executor.submit(
            workforce.merge_agent_workspace,
            agent,
            operation_request_id="merge-after-save",
        )
        assert not merge_entered.wait(timeout=0.2)
        release_checkpoint.set()
        save.result(timeout=5)
        outcome = merge.result(timeout=5)

    assert outcome.status == "merged"
    assert merge_entered.is_set()
    assert (workspace.run_worktree / "user.txt").read_text() == "user"
    assert (workspace.run_worktree / "agent.txt").read_text() == "agent"
    assert backend.is_worktree_clean(workspace.run_worktree)
