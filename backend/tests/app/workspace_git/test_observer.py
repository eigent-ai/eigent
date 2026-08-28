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

import pytest

from app.run_context import RunContext
from app.run_journal import SQLiteRunJournal
from app.workspace_git import (
    ContentRepositoryService,
    GitBackend,
    WorkspaceGitCoordinator,
    WorkspaceGitObserver,
    WorkspaceMutationService,
)


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def _setup(tmp_path: Path, journal: SQLiteRunJournal):
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
    observer = WorkspaceGitObserver(journal, git_backend=git)
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
    workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run-1",
        expected_repo_state_digest=git.repo_state_token(space).digest,
        expected_project_version=admission.project.version,
        expected_project_head=admission.project.integration_head,
    )
    context = RunContext(
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
    return git, mutations, observer, workspace, context


def test_project_external_change_enters_needs_attention(tmp_path, journal):
    _, _, observer, workspace, _ = _setup(tmp_path, journal)
    (workspace.project_worktree / "external.txt").write_text(
        "not Eigent",
        encoding="utf-8",
    )

    result = observer.inspect_all()

    assert [(item.owner_role, item.owner_id) for item in result.changes] == [
        ("project", "project-1")
    ]
    project = journal.get_project_git_state("project-1")
    assert project is not None
    assert project.state == "needs_attention"


def test_run_external_change_is_ignored_while_mutation_intent_is_prepared(
    tmp_path,
    journal,
):
    _, mutations, observer, workspace, context = _setup(tmp_path, journal)
    prepared = mutations.prepare_broad_write(
        context=context,
        operation_request_id="terminal-active",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    assert prepared is not None
    (workspace.run_worktree / "generated.txt").write_text(
        "in-flight",
        encoding="utf-8",
    )

    result = observer.inspect_all()

    assert result.changes == ()
    run = journal.get_run_git_materialization("run-1")
    assert run is not None
    assert run.materialization_state == "materialized"


def test_run_external_change_without_intent_enters_needs_attention(
    tmp_path,
    journal,
):
    _, _, observer, workspace, _ = _setup(tmp_path, journal)
    (workspace.run_worktree / "external.txt").write_text(
        "not Eigent",
        encoding="utf-8",
    )

    result = observer.inspect_all()

    assert [(item.owner_role, item.owner_id) for item in result.changes] == [
        ("run", "run-1")
    ]
    run = journal.get_run_git_materialization("run-1")
    assert run is not None
    assert run.materialization_state == "needs_attention"
