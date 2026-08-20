from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app.run_journal import SQLiteRunJournal
from app.workspace_git import (
    ContentRepositoryService,
    GitBackend,
    WorkforceGitService,
    WorkspaceGitCoordinator,
)


@pytest.fixture()
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as value:
        yield value


def _setup(tmp_path: Path, journal: SQLiteRunJournal):
    backend = GitBackend()
    state_root = tmp_path / "state"
    content = ContentRepositoryService(
        journal, state_root=state_root, git_backend=backend
    )
    coordinator = WorkspaceGitCoordinator(
        journal, state_root=state_root, git_backend=backend
    )
    workforce = WorkforceGitService(
        journal,
        state_root=state_root,
        coordinator=coordinator,
        lease_seconds=30,
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(space_id="space-1", space_root=space, allow_init=True)
    seed = space / "shared.txt"
    seed.write_text("base\n", encoding="utf-8")
    backend.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="running"
    )
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
        now=1,
    )
    admission = coordinator.admit_run(
        space_id="space-1", project_id="project-1", run_id="run-1"
    )
    assert admission is not None
    run_workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run",
        expected_repo_state_digest=backend.repo_state_token(space).digest,
        expected_project_version=admission.project.version,
        expected_project_head=admission.project.integration_head,
    )
    return backend, workforce, run_workspace


def _commit_agent_file(backend, workspace, relative_path: str, content: str):
    target = workspace.agent_worktree / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return backend.commit_paths(
        workspace.agent_worktree,
        (target,),
        message=f"Agent writes {relative_path}",
    )


def test_agents_use_unique_worktrees_and_merge_serially(tmp_path, journal):
    backend, workforce, run_workspace = _setup(tmp_path, journal)
    first = workforce.ensure_agent_workspace(
        run_workspace=run_workspace,
        agent_id="researcher",
        operation_request_id="agent-1-write",
        now=2,
    )
    second = workforce.ensure_agent_workspace(
        run_workspace=run_workspace,
        agent_id="developer",
        operation_request_id="agent-2-write",
        now=2,
    )

    assert first.agent_worktree != second.agent_worktree
    assert first.record.agent_ref != second.record.agent_ref

    _commit_agent_file(backend, first, "research.md", "research\n")
    _commit_agent_file(backend, second, "code.py", "print('ok')\n")
    # Both Agents started from the same Run head. Concurrent merge requests
    # are serialized by the repository mutation lock without losing either
    # non-overlapping commit.
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = (
            executor.submit(
                workforce.merge_agent_workspace,
                first,
                operation_request_id="merge-agent-1",
                now=3,
            ),
            executor.submit(
                workforce.merge_agent_workspace,
                second,
                operation_request_id="merge-agent-2",
                now=4,
            ),
        )
        outcomes = [future.result() for future in futures]

    assert all(outcome.status == "merged" for outcome in outcomes)
    assert (run_workspace.run_worktree / "research.md").read_text() == (
        "research\n"
    )
    assert (run_workspace.run_worktree / "code.py").is_file()
    assert backend.is_worktree_clean(run_workspace.run_worktree)
    records = journal.list_git_agent_workspaces(run_id="run-1")
    assert {item.agent_id for item in records} == {"researcher", "developer"}
    assert all(item.lease_token is None for item in records)


def test_conflict_aborts_merge_and_creates_durable_interaction(
    tmp_path, journal
):
    backend, workforce, run_workspace = _setup(tmp_path, journal)
    first = workforce.ensure_agent_workspace(
        run_workspace=run_workspace,
        agent_id="first",
        operation_request_id="first-write",
        now=2,
    )
    second = workforce.ensure_agent_workspace(
        run_workspace=run_workspace,
        agent_id="second",
        operation_request_id="second-write",
        now=2,
    )
    _commit_agent_file(backend, first, "shared.txt", "first\n")
    _commit_agent_file(backend, second, "shared.txt", "second\n")
    workforce.merge_agent_workspace(
        first, operation_request_id="merge-first", now=3
    )

    outcome = workforce.merge_agent_workspace(
        second, operation_request_id="merge-second", now=4
    )

    assert outcome.status == "conflicted"
    assert outcome.conflict_paths == ("shared.txt",)
    assert outcome.interaction_id is not None
    assert backend.is_worktree_clean(run_workspace.run_worktree)
    interaction = journal.get_human_interaction(outcome.interaction_id)
    assert interaction is not None
    assert interaction.interaction_type == "merge_conflict"
    assert interaction.status == "requested"
    assert [
        item.option_id
        for item in journal.list_human_interaction_options(
            outcome.interaction_id
        )
    ] == ["keep_run", "take_agent", "manual"]


def test_merge_commit_before_sqlite_is_recovered_idempotently(
    tmp_path, journal, monkeypatch
):
    backend, workforce, run_workspace = _setup(tmp_path, journal)
    agent = workforce.ensure_agent_workspace(
        run_workspace=run_workspace,
        agent_id="writer",
        operation_request_id="writer-change",
        now=2,
    )
    _commit_agent_file(backend, agent, "result.txt", "done\n")
    original = journal.transition_git_agent_workspace

    def crash_before_sqlite(*args, **kwargs):
        if kwargs.get("state") == "merged":
            raise RuntimeError("simulated crash after Git merge")
        return original(*args, **kwargs)

    monkeypatch.setattr(
        journal, "transition_git_agent_workspace", crash_before_sqlite
    )
    with pytest.raises(RuntimeError, match="simulated crash"):
        workforce.merge_agent_workspace(
            agent, operation_request_id="merge-writer", now=3
        )
    monkeypatch.setattr(journal, "transition_git_agent_workspace", original)

    recovered = workforce.ensure_agent_workspace(
        run_workspace=run_workspace,
        agent_id="writer",
        operation_request_id="recover-writer",
        now=40,
    )

    assert recovered.record.state == "ready"
    assert (run_workspace.run_worktree / "result.txt").read_text() == "done\n"
    merge_events = [
        event
        for event in journal.list_events("run-1")
        if event.event_type == "git.agent_merged"
    ]
    assert len(merge_events) == 1
    operation = journal.get_git_operation(
        recovered.record.last_operation_id or ""
    )
    assert operation is not None
    assert operation.status == "completed"


def test_conflict_interaction_before_workspace_state_is_recovered(
    tmp_path, journal, monkeypatch
):
    backend, workforce, run_workspace = _setup(tmp_path, journal)
    first = workforce.ensure_agent_workspace(
        run_workspace=run_workspace,
        agent_id="first",
        operation_request_id="first-write",
        now=2,
    )
    second = workforce.ensure_agent_workspace(
        run_workspace=run_workspace,
        agent_id="second",
        operation_request_id="second-write",
        now=2,
    )
    _commit_agent_file(backend, first, "shared.txt", "first\n")
    _commit_agent_file(backend, second, "shared.txt", "second\n")
    workforce.merge_agent_workspace(
        first, operation_request_id="merge-first", now=3
    )
    original = journal.transition_git_agent_workspace

    def crash_before_conflict_state(*args, **kwargs):
        if kwargs.get("state") == "conflicted":
            raise RuntimeError("simulated crash after interaction commit")
        return original(*args, **kwargs)

    monkeypatch.setattr(
        journal,
        "transition_git_agent_workspace",
        crash_before_conflict_state,
    )
    with pytest.raises(RuntimeError, match="simulated crash"):
        workforce.merge_agent_workspace(
            second,
            operation_request_id="merge-second",
            now=4,
        )
    monkeypatch.setattr(journal, "transition_git_agent_workspace", original)

    reconciliation = workforce.reconcile_startup(now=40)

    current = journal.get_git_agent_workspace("run-1", "second")
    assert current is not None and current.state == "conflicted"
    assert current.workspace_id in reconciliation.recovered_workspace_ids
    assert reconciliation.needs_attention_workspace_ids == ()
    assert (
        len(
            [
                item
                for item in journal.list_human_interactions("run-1")
                if item.interaction_type == "merge_conflict"
            ]
        )
        == 1
    )
    operation = journal.get_git_operation(current.last_operation_id or "")
    assert operation is not None and operation.status == "completed"
