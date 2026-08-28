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

import subprocess
from pathlib import Path

import pytest

from app.run_journal import (
    InvalidRunTransitionError,
    OptimisticConcurrencyError,
    SQLiteRunJournal,
)
from app.workspace_git import (
    ContentRepositoryError,
    ContentRepositoryService,
    GitBackend,
    GitBackendError,
    WorkspaceGitCoordinator,
)
from app.workspace_git.content import RepositoryStateChangedError


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def _services(tmp_path: Path, journal: SQLiteRunJournal):
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir(exist_ok=True)
    backend = GitBackend(hooks_path=hooks)
    state_root = tmp_path / "state"
    content = ContentRepositoryService(
        journal,
        state_root=state_root,
        git_backend=backend,
    )
    coordinator = WorkspaceGitCoordinator(
        journal,
        state_root=state_root,
        git_backend=backend,
    )
    return content, coordinator, backend


def _git(repository: Path, *args: str) -> str:
    return subprocess.run(
        ("git", "-C", str(repository), *args),
        check=True,
        capture_output=True,
        text=True,
        env={
            "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_TERMINAL_PROMPT": "0",
        },
    ).stdout.strip()


def test_admission_without_content_repository_is_a_noop(tmp_path, journal):
    _, coordinator, _ = _services(tmp_path, journal)
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )

    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )

    assert admission is None
    assert journal.get_project_git_state("project-1") is None
    assert journal.get_run_git_materialization("run-1") is None


def test_run_admission_pins_base_without_creating_ref_or_worktree(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    repository = content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    ).repository
    seed = space / "seed.txt"
    seed.write_text("v1\n", encoding="utf-8")
    base = backend.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )

    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )

    assert admission is not None
    assert admission.project.repository_id == repository.repository_id
    assert admission.project.integration_ref is None
    assert admission.project.integration_head is None
    assert admission.project.last_synced_user_head == base
    assert admission.run.workspace_base_ref == "refs/heads/main"
    assert admission.run.workspace_base_commit == base
    assert admission.run.materialization_state == "unmaterialized"
    assert admission.run.run_ref is None
    assert admission.run.worktree_path is None
    assert admission.binding.checkout_mode == "primary_checkout"
    assert admission.binding.target_ref == "refs/heads/main"
    assert admission.binding.worktree_path == str(space)
    assert journal.get_project_workspace_binding("project-1") == (
        admission.binding
    )
    assert (
        _git(
            space,
            "for-each-ref",
            "--format=%(refname)",
            "refs/heads/eigent",
        )
        == ""
    )
    assert not (tmp_path / "state" / "worktrees").exists()


def test_single_agent_queues_on_primary_but_workforce_runs_are_isolated(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    seed = space / "seed.txt"
    seed.write_text("seed\n", encoding="utf-8")
    backend.commit_paths(space, (seed,), message="seed")
    for run_id, project_id in (
        ("run-single-1", "project-single-1"),
        ("run-single-2", "project-single-2"),
        ("run-workforce-1", "project-workforce-1"),
        ("run-workforce-2", "project-workforce-2"),
    ):
        journal.ensure_run(
            run_id=run_id,
            project_id=project_id,
            status="pending",
        )

    first_single = coordinator.admit_run(
        space_id="space-1",
        project_id="project-single-1",
        run_id="run-single-1",
        task_id="task-single-1",
        session_mode="single-agent",
    )
    second_single = coordinator.admit_run(
        space_id="space-1",
        project_id="project-single-2",
        run_id="run-single-2",
        task_id="task-single-2",
        session_mode="single-agent",
    )
    first_workforce = coordinator.admit_run(
        space_id="space-1",
        project_id="project-workforce-1",
        run_id="run-workforce-1",
        task_id="task-workforce-1",
        session_mode="workforce",
    )
    second_workforce = coordinator.admit_run(
        space_id="space-1",
        project_id="project-workforce-2",
        run_id="run-workforce-2",
        task_id="task-workforce-2",
        session_mode="workforce",
    )

    assert first_single is not None
    assert second_single is not None
    assert first_workforce is not None
    assert second_workforce is not None
    assert first_single.writer.request.status == "acquired"
    assert second_single.writer.request.status == "queued"
    assert (
        first_single.writer.request.checkout_id
        == second_single.writer.request.checkout_id
    )
    assert first_workforce.writer.request.status == "acquired"
    assert second_workforce.writer.request.status == "acquired"
    assert (
        first_workforce.writer.request.checkout_id
        != second_workforce.writer.request.checkout_id
    )
    assert first_workforce.binding.checkout_mode == "primary_checkout"
    assert second_workforce.binding.checkout_mode == "primary_checkout"


@pytest.mark.asyncio
async def test_queued_direct_run_refreshes_base_after_writer_acquisition(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "report.md"
    target.write_text("first\n", encoding="utf-8")
    first_head = backend.commit_paths(space, (target,), message="first")
    for run_id, project_id in (
        ("run-1", "project-1"),
        ("run-2", "project-2"),
    ):
        journal.ensure_run(
            run_id=run_id,
            project_id=project_id,
            status="pending",
        )
    attempt = journal.create_run_attempt(
        "run-2",
        request_id="attempt-request-2",
        reason="initial",
        attempt_id="attempt-2",
    )
    first = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="task-1",
        session_mode="single-agent",
    )
    second = coordinator.admit_run(
        space_id="space-1",
        project_id="project-2",
        run_id="run-2",
        task_id="task-2",
        session_mode="single-agent",
    )

    assert first is not None and first.writer.request.status == "acquired"
    assert second is not None and second.writer.request.status == "queued"
    assert second.run.workspace_base_commit == first_head

    target.write_text("second\n", encoding="utf-8")
    second_head = backend.commit_paths(space, (target,), message="second")
    dirty_path = space / "user-draft.txt"
    dirty_path.write_text("not committed\n", encoding="utf-8")
    coordinator.writer_scheduler.finish_task(
        run_id="run-1",
        task_id="task-1",
    )
    await coordinator.writer_scheduler.wait_until_acquired(
        run_id="run-2",
        task_id="task-2",
    )

    refreshed = coordinator.refresh_run_boundary_after_writer_acquired(
        run_id="run-2",
        task_id="task-2",
        attempt_id=attempt.attempt_id,
    )
    replay = coordinator.refresh_run_boundary_after_writer_acquired(
        run_id="run-2",
        task_id="task-2",
        attempt_id=attempt.attempt_id,
    )

    assert refreshed is not None
    assert refreshed.workspace_base_commit == second_head
    assert replay == refreshed
    assert "user-draft.txt" in backend.worktree_status(space)
    assert journal.get_project_git_state("project-2").projected_head == (
        second_head
    )
    agent_output = space / "agent-output.txt"
    agent_output.write_text("run 2\n", encoding="utf-8")
    terminal_head = backend.commit_paths(
        space,
        (agent_output,),
        message="run 2 output",
    )
    assert tuple(
        change.relative_path
        for change in backend.changed_paths_between(
            space,
            base_commit=refreshed.workspace_base_commit,
            target_commit=terminal_head,
        )
    ) == ("agent-output.txt",)
    boundary_events = [
        event
        for event in journal.list_events("run-2")
        if event.event_type == "workspace.run_base_refreshed"
    ]
    assert len(boundary_events) == 1
    assert boundary_events[0].payload == {
        "attempt_id": "attempt-2",
        "request_id": "workspace-writer:run-2",
        "task_id": "task-2",
        "checkout_id": second.binding.checkout_id,
        "base_ref": "refs/heads/main",
        "previous_base_commit": first_head,
        "base_commit": second_head,
        "reason": "writer_lease_acquired",
    }


@pytest.mark.asyncio
async def test_resumed_run_with_change_set_keeps_earned_boundary(
    tmp_path,
    journal,
):
    """Resume admission must not move a boundary a ChangeSet is anchored to.

    An interrupted Run that already mutated files has (a) a durable ChangeSet
    and (b) checkout HEAD advanced past its admission base by its own
    checkpoint commits. Re-admission after restart must keep the earned base
    instead of tripping the journal's fail-closed boundary guard.
    """

    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "report.md"
    target.write_text("first\n", encoding="utf-8")
    admission_head = backend.commit_paths(space, (target,), message="first")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="attempt-request-1",
        reason="initial",
        attempt_id="attempt-1",
    )
    admitted = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="task-1",
        session_mode="single-agent",
    )
    assert admitted is not None
    assert admitted.writer.request.status == "acquired"
    assert admitted.run.workspace_base_commit == admission_head

    # The Run mutates the workspace: its ChangeSet anchors to the admission
    # base while its checkpoint commit advances checkout HEAD past it.
    journal.ensure_git_change_set(
        change_set_id="change-set-1",
        run_id="run-1",
        repository_id=admitted.run.repository_id,
        worktree_ref="refs/heads/main",
        base_commit=admission_head,
    )
    target.write_text("second\n", encoding="utf-8")
    checkpoint_head = backend.commit_paths(
        space,
        (target,),
        message="Checkpoint Task workspace changes",
    )
    assert checkpoint_head != admission_head

    refreshed = coordinator.refresh_run_boundary_after_writer_acquired(
        run_id="run-1",
        task_id="task-1",
        attempt_id=attempt.attempt_id,
    )

    assert refreshed is not None
    assert refreshed.workspace_base_commit == admission_head
    assert (
        journal.get_run_git_materialization("run-1").workspace_base_commit
        == admission_head
    )
    assert [
        event
        for event in journal.list_events("run-1")
        if event.event_type == "workspace.run_base_refreshed"
    ] == []


def test_direct_run_boundary_cannot_move_after_attempt_activation(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "report.md"
    target.write_text("first\n", encoding="utf-8")
    first_head = backend.commit_paths(space, (target,), message="first")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="attempt-request-1",
        reason="initial",
        attempt_id="attempt-1",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="task-1",
        session_mode="single-agent",
    )
    assert admission is not None
    journal.activate_run_attempt(attempt.attempt_id, expected_run_id="run-1")
    target.write_text("second\n", encoding="utf-8")
    backend.commit_paths(space, (target,), message="second")

    with pytest.raises(
        InvalidRunTransitionError,
        match="after Attempt activation",
    ):
        coordinator.refresh_run_boundary_after_writer_acquired(
            run_id="run-1",
            task_id="task-1",
            attempt_id=attempt.attempt_id,
        )

    persisted = journal.get_run_git_materialization("run-1")
    assert persisted is not None
    assert persisted.workspace_base_commit == first_head


def test_internal_workforce_run_keeps_immutable_admission_base(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "report.md"
    target.write_text("first\n", encoding="utf-8")
    first_head = backend.commit_paths(space, (target,), message="first")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="attempt-request-1",
        reason="initial",
        attempt_id="attempt-1",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="task-1",
        session_mode="workforce",
    )
    assert admission is not None
    target.write_text("second\n", encoding="utf-8")
    backend.commit_paths(space, (target,), message="second")

    refreshed = coordinator.refresh_run_boundary_after_writer_acquired(
        run_id="run-1",
        task_id="task-1",
        attempt_id=attempt.attempt_id,
    )

    assert refreshed is not None
    assert refreshed.workspace_base_commit == first_head
    assert not any(
        event.event_type == "workspace.run_base_refreshed"
        for event in journal.list_events("run-1")
    )


def test_unmaterialized_project_tracks_new_user_head_but_run_replay_stays_pinned(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "report.md"
    target.write_text("v1\n", encoding="utf-8")
    first_head = backend.commit_paths(space, (target,), message="first")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    first = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert first is not None

    target.write_text("v2\n", encoding="utf-8")
    second_head = backend.commit_paths(space, (target,), message="second")
    journal.ensure_run(
        run_id="run-2",
        project_id="project-1",
        status="pending",
    )
    second = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-2",
    )
    replay = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )

    assert second is not None
    assert replay is not None
    assert first_head != second_head
    assert first.run.workspace_base_commit == first_head
    assert second.run.workspace_base_commit == second_head
    assert replay.run.workspace_base_commit == first_head
    assert second.project.integration_head is None
    assert second.project.last_synced_user_head == second_head
    assert second.project.version == first.project.version + 1


def test_initialized_repository_admission_uses_visible_empty_baseline(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )

    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )

    assert admission is not None
    assert admission.run.workspace_base_commit is not None
    assert admission.run.workspace_base_ref == "refs/heads/main"
    assert backend.current_head(space) == admission.run.workspace_base_commit


def test_first_write_lazily_materializes_project_and_run_worktrees(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    seed = space / "seed.txt"
    seed.write_text("user content\n", encoding="utf-8")
    user_head = backend.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert admission is not None
    expected_repo = backend.repo_state_token(space)

    workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run-1",
        expected_repo_state_digest=expected_repo.digest,
        expected_project_version=admission.project.version,
        expected_project_head=admission.project.integration_head,
    )
    replay = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run-1",
        expected_repo_state_digest=expected_repo.digest,
        expected_project_version=admission.project.version,
        expected_project_head=admission.project.integration_head,
    )

    assert replay == workspace
    assert workspace.project.state == "ready"
    assert workspace.project.integration_head == user_head
    assert workspace.project.projected_head == user_head
    assert workspace.project.worktree_path == str(workspace.project_worktree)
    assert workspace.run.materialization_state == "materialized"
    assert workspace.run.workspace_base_commit == user_head
    assert workspace.run.worktree_path == str(workspace.run_worktree)
    assert workspace.project_worktree.is_dir()
    assert workspace.run_worktree.is_dir()
    assert space not in workspace.project_worktree.parents
    assert space not in workspace.run_worktree.parents
    assert (workspace.project_worktree / "seed.txt").read_text() == (
        "user content\n"
    )
    assert (workspace.run_worktree / "seed.txt").read_text() == (
        "user content\n"
    )
    assert backend.current_head(space) == user_head
    assert seed.read_text(encoding="utf-8") == "user content\n"


def test_empty_repo_materialization_reuses_visible_baseline(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert admission is not None

    workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-unborn",
        expected_repo_state_digest=backend.repo_state_token(space).digest,
        expected_project_version=admission.project.version,
        expected_project_head=None,
    )

    visible_head = backend.current_head(space)
    assert visible_head is not None
    assert workspace.project.integration_head == visible_head
    assert workspace.run.workspace_base_commit == (
        workspace.project.integration_head
    )
    assert backend.current_head(space) == visible_head
    assert list(space.iterdir()) == [space / ".git"]


def test_materialization_replay_closes_git_before_sqlite_window(
    tmp_path,
    journal,
    monkeypatch,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    seed = space / "seed.txt"
    seed.write_text("seed\n", encoding="utf-8")
    backend.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert admission is not None
    expected = backend.repo_state_token(space).digest
    original = journal.complete_git_run_materialization

    def crash_before_sqlite(*_args, **_kwargs):
        raise RuntimeError("simulated materialization crash")

    monkeypatch.setattr(
        journal,
        "complete_git_run_materialization",
        crash_before_sqlite,
    )
    with pytest.raises(RuntimeError, match="simulated materialization crash"):
        coordinator.ensure_run_materialized(
            run_id="run-1",
            operation_request_id="materialize-crash",
            expected_repo_state_digest=expected,
            expected_project_version=admission.project.version,
            expected_project_head=None,
        )
    monkeypatch.setattr(
        journal,
        "complete_git_run_materialization",
        original,
    )

    recovered = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-crash",
        expected_repo_state_digest=expected,
        expected_project_version=admission.project.version,
        expected_project_head=None,
    )

    assert recovered.run.materialization_state == "materialized"
    assert recovered.project_worktree.is_dir()
    assert recovered.run_worktree.is_dir()
    assert len(backend.list_worktrees(space)) == 3


def test_materialization_rejects_user_worktree_change_before_side_effect(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    seed = space / "seed.txt"
    seed.write_text("seed\n", encoding="utf-8")
    backend.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert admission is not None
    expected = backend.repo_state_token(space)
    seed.write_text("changed before dispatch\n", encoding="utf-8")

    with pytest.raises(RepositoryStateChangedError):
        coordinator.ensure_run_materialized(
            run_id="run-1",
            operation_request_id="materialize-stale",
            expected_repo_state_digest=expected.digest,
            expected_project_version=admission.project.version,
            expected_project_head=None,
        )

    assert (
        journal.get_run_git_materialization("run-1").materialization_state
        == "unmaterialized"
    )
    assert len(backend.list_worktrees(space)) == 1


def test_checkpointed_run_promotes_by_cas_without_touching_user_worktree(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    repository = content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    ).repository
    report = space / "report.md"
    report.write_text("user version\n", encoding="utf-8")
    user_head = backend.commit_paths(space, (report,), message="seed")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert admission is not None
    workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run-1",
        expected_repo_state_digest=backend.repo_state_token(space).digest,
        expected_project_version=admission.project.version,
        expected_project_head=None,
    )
    run_report = workspace.run_worktree / "report.md"
    run_report.write_text("agent version\n", encoding="utf-8")
    checkpoint = content.checkpoint(
        repository.repository_id,
        operation_request_id="checkpoint-run-1",
        expected_repo_state_digest=backend.repo_state_token(
            workspace.run_worktree
        ).digest,
        paths=(run_report,),
        path_sources={"report.md": "agent_modified"},
        target_role="run",
        target_id="run-1",
        actor_id="agent-1",
        trigger="run_terminal",
        message="Checkpoint Run output",
        worktree_root=workspace.run_worktree,
    )
    project_before = journal.get_project_git_state("project-1")
    assert project_before is not None

    promoted = coordinator.promote_run(
        run_id="run-1",
        operation_request_id="promote-run-1",
        expected_run_state_digest=backend.repo_state_token(
            workspace.run_worktree
        ).digest,
        expected_project_version=project_before.version,
        expected_project_head=str(project_before.integration_head),
        expected_run_head=checkpoint.commit_oid,
    )

    assert promoted.run.materialization_state == "promoted"
    assert promoted.run.promoted_commit == checkpoint.commit_oid
    assert promoted.project.integration_head == checkpoint.commit_oid
    assert promoted.project.projected_head == user_head
    assert promoted.project.pending_apply is True
    assert backend.ref_oid(space, str(promoted.project.integration_ref)) == (
        checkpoint.commit_oid
    )
    assert backend.current_head(space) == user_head
    assert report.read_text(encoding="utf-8") == "user version\n"

    project_copy = workspace.project_worktree / "report.md"
    project_copy.write_text("external project edit\n", encoding="utf-8")
    with pytest.raises(GitBackendError, match="external"):
        coordinator.refresh_project_projection(
            project_id="project-1",
            operation_request_id="refresh-with-external-edit",
            expected_projection_state_digest=backend.repo_state_token(
                workspace.project_worktree
            ).digest,
            expected_project_version=promoted.project.version,
            expected_integration_head=str(promoted.project.integration_head),
            expected_projected_head=str(promoted.project.projected_head),
        )
    assert project_copy.read_text(encoding="utf-8") == (
        "external project edit\n"
    )
    attention = journal.get_project_git_state("project-1")
    assert attention is not None
    assert attention.projected_head == user_head
    assert attention.state == "needs_attention"

    journal.ensure_run(
        run_id="run-2",
        project_id="project-1",
        status="pending",
    )
    follow_up = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-2",
    )
    assert follow_up is not None
    assert follow_up.run.workspace_base_commit == checkpoint.commit_oid


def test_promotion_refuses_uncheckpointed_run_changes(tmp_path, journal):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    seed = space / "seed.txt"
    seed.write_text("seed\n", encoding="utf-8")
    backend.commit_paths(space, (seed,), message="seed")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
    )
    assert admission is not None
    workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run-1",
        expected_repo_state_digest=backend.repo_state_token(space).digest,
        expected_project_version=admission.project.version,
        expected_project_head=None,
    )
    (workspace.run_worktree / "uncommitted.txt").write_text(
        "not checkpointed\n",
        encoding="utf-8",
    )
    project = journal.get_project_git_state("project-1")
    assert project is not None

    with pytest.raises(ContentRepositoryError, match="uncheckpointed"):
        coordinator.promote_run(
            run_id="run-1",
            operation_request_id="promote-dirty",
            expected_run_state_digest=backend.repo_state_token(
                workspace.run_worktree
            ).digest,
            expected_project_version=project.version,
            expected_project_head=str(project.integration_head),
            expected_run_head=str(
                backend.current_head(workspace.run_worktree)
            ),
        )

    assert backend.ref_oid(space, str(project.integration_ref)) == (
        project.integration_head
    )


def test_stale_concurrent_run_cannot_overwrite_new_project_head(
    tmp_path,
    journal,
):
    content, coordinator, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    repository = content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    ).repository
    seed = space / "seed.txt"
    seed.write_text("seed\n", encoding="utf-8")
    backend.commit_paths(space, (seed,), message="seed")
    workspaces = []
    for number in (1, 2):
        run_id = f"run-{number}"
        journal.ensure_run(
            run_id=run_id,
            project_id="project-1",
            status="pending",
        )
        admission = coordinator.admit_run(
            space_id="space-1",
            project_id="project-1",
            run_id=run_id,
        )
        assert admission is not None
        current_project = journal.get_project_git_state("project-1")
        assert current_project is not None
        workspace = coordinator.ensure_run_materialized(
            run_id=run_id,
            operation_request_id=f"materialize-{run_id}",
            expected_repo_state_digest=backend.repo_state_token(space).digest,
            expected_project_version=current_project.version,
            expected_project_head=current_project.integration_head,
        )
        workspaces.append(workspace)

    checkpoints = []
    for number, workspace in enumerate(workspaces, start=1):
        target = workspace.run_worktree / f"run-{number}.txt"
        target.write_text(f"run {number}\n", encoding="utf-8")
        checkpoints.append(
            content.checkpoint(
                repository.repository_id,
                operation_request_id=f"checkpoint-run-{number}",
                expected_repo_state_digest=backend.repo_state_token(
                    workspace.run_worktree
                ).digest,
                paths=(target,),
                path_sources={f"run-{number}.txt": "agent_created"},
                target_role="run",
                target_id=f"run-{number}",
                actor_id=f"agent-{number}",
                trigger="run_terminal",
                message=f"Checkpoint Run {number}",
                worktree_root=workspace.run_worktree,
            )
        )
    shared_project = journal.get_project_git_state("project-1")
    assert shared_project is not None
    coordinator.promote_run(
        run_id="run-1",
        operation_request_id="promote-run-1",
        expected_run_state_digest=backend.repo_state_token(
            workspaces[0].run_worktree
        ).digest,
        expected_project_version=shared_project.version,
        expected_project_head=str(shared_project.integration_head),
        expected_run_head=checkpoints[0].commit_oid,
    )

    with pytest.raises(OptimisticConcurrencyError):
        coordinator.promote_run(
            run_id="run-2",
            operation_request_id="promote-run-2",
            expected_run_state_digest=backend.repo_state_token(
                workspaces[1].run_worktree
            ).digest,
            expected_project_version=shared_project.version,
            expected_project_head=str(shared_project.integration_head),
            expected_run_head=checkpoints[1].commit_oid,
        )

    latest = journal.get_project_git_state("project-1")
    assert latest is not None
    assert latest.integration_head == checkpoints[0].commit_oid
    assert backend.ref_oid(space, str(latest.integration_ref)) == (
        checkpoints[0].commit_oid
    )
