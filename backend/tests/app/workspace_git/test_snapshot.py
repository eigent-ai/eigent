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

from app.run_journal import SQLiteRunJournal
from app.workspace_git import (
    ContentRepositoryService,
    GitBackend,
    WorkspaceGitCoordinator,
    WorkspaceOverlayConflictError,
    WorkspaceSnapshotService,
    WorkspaceSourceChangedError,
)


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
    snapshots = WorkspaceSnapshotService(
        journal,
        state_root=state_root,
        git_backend=backend,
    )
    return content, coordinator, snapshots, backend


def _admit(
    *,
    journal: SQLiteRunJournal,
    coordinator: WorkspaceGitCoordinator,
    run_id: str,
    project_id: str = "project-1",
):
    journal.ensure_run(
        run_id=run_id,
        project_id=project_id,
        status="pending",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id=project_id,
        run_id=run_id,
    )
    assert admission is not None
    return admission


def test_first_read_lazily_pins_git_blob_without_a_worktree(tmp_path, journal):
    content, coordinator, snapshots, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "report.md"
    target.write_bytes(b"stable project bytes")
    base = backend.commit_paths(space, (target,), message="seed")
    _admit(journal=journal, coordinator=coordinator, run_id="run-1")

    assert snapshots.get_snapshot("run-1") is None
    result = snapshots.read_range(
        run_id="run-1",
        relative_path="report.md",
        max_bytes=6,
    )

    assert result.content == b"stable"
    assert result.source_kind == "project_blob"
    assert result.snapshot.project_base_commit == base
    assert result.snapshot.snapshot_ref is not None
    assert backend.ref_oid(space, result.snapshot.snapshot_ref) == base
    run = journal.get_run_git_materialization("run-1")
    assert run is not None
    assert run.materialization_state == "unmaterialized"
    assert run.worktree_path is None


def test_untracked_user_overlay_is_bounded_cached_and_then_pinned(
    tmp_path,
    journal,
):
    content, coordinator, snapshots, _ = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    source = space / "draft.csv"
    source.write_bytes(b"abcdefghi")
    _admit(journal=journal, coordinator=coordinator, run_id="run-1")

    first = snapshots.read_range(
        run_id="run-1",
        relative_path="draft.csv",
        start_offset=0,
        max_bytes=3,
    )
    assert first.content == b"abc"
    assert first.source_kind == "user_overlay"

    source.write_bytes(b"changed-after-pin")
    cached = snapshots.read_range(
        run_id="run-1",
        relative_path="draft.csv",
        start_offset=0,
        max_bytes=3,
    )
    assert cached.content == b"abc"
    with pytest.raises(WorkspaceSourceChangedError):
        snapshots.read_range(
            run_id="run-1",
            relative_path="draft.csv",
            start_offset=3,
            max_bytes=3,
        )


def test_unseen_path_added_after_snapshot_can_expand_overlay(
    tmp_path, journal
):
    content, coordinator, snapshots, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    seed = space / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    backend.commit_paths(space, (seed,), message="seed")
    _admit(journal=journal, coordinator=coordinator, run_id="run-1")
    snapshots.read_range(run_id="run-1", relative_path="seed.txt")

    added = space / "added-after-human-reply.pdf"
    added.write_bytes(b"new source")
    result = snapshots.read_range(
        run_id="run-1",
        relative_path="added-after-human-reply.pdf",
    )

    assert result.content == b"new source"
    assert result.source_kind == "user_overlay"


def test_refresh_creates_a_new_generation_for_changed_user_source(
    tmp_path,
    journal,
):
    content, coordinator, snapshots, _ = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "draft.txt"
    target.write_text("one", encoding="utf-8")
    _admit(journal=journal, coordinator=coordinator, run_id="run-1")
    first = snapshots.read_range(
        run_id="run-1",
        relative_path="draft.txt",
    )

    target.write_text("two-two", encoding="utf-8")
    refreshed = snapshots.refresh_snapshot(
        "run-1",
        expected_user_working_state_digest=snapshots.git.repo_state_token(
            space
        ).digest,
    )
    second = snapshots.read_range(
        run_id="run-1",
        relative_path="draft.txt",
    )

    assert refreshed.generation == first.snapshot.generation + 1
    assert second.snapshot.snapshot_id == refreshed.snapshot_id
    assert second.content == b"two-two"


def test_refresh_rejects_stale_user_working_state_token(tmp_path, journal):
    content, coordinator, snapshots, _ = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "draft.txt"
    target.write_text("one", encoding="utf-8")
    _admit(journal=journal, coordinator=coordinator, run_id="run-1")
    snapshots.read_range(run_id="run-1", relative_path="draft.txt")
    stale = snapshots.git.repo_state_token(space).digest
    target.write_text("two", encoding="utf-8")

    with pytest.raises(WorkspaceSourceChangedError) as caught:
        snapshots.refresh_snapshot(
            "run-1",
            expected_user_working_state_digest=stale,
        )

    assert caught.value.retryable is True
    assert caught.value.refresh_available is True
    assert caught.value.automatic_retry_limit == 2


def test_project_and_user_changes_from_common_base_require_interaction(
    tmp_path,
    journal,
):
    content, coordinator, snapshots, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    repository = content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    ).repository
    target = space / "shared.txt"
    target.write_text("base", encoding="utf-8")
    backend.commit_paths(space, (target,), message="base")
    first = _admit(
        journal=journal,
        coordinator=coordinator,
        run_id="run-1",
    )
    run_workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run-1",
        expected_repo_state_digest=backend.repo_state_token(space).digest,
        expected_project_version=first.project.version,
        expected_project_head=first.project.integration_head,
    )
    run_file = run_workspace.run_worktree / "shared.txt"
    run_file.write_text("project change", encoding="utf-8")
    run_token = backend.repo_state_token(run_workspace.run_worktree)
    checkpoint = content.checkpoint(
        repository.repository_id,
        operation_request_id="checkpoint-run-1",
        expected_repo_state_digest=run_token.digest,
        paths=(run_file,),
        path_sources={"shared.txt": "agent_modified"},
        target_role="run",
        target_id="run-1",
        actor_id="agent-1",
        trigger="tool",
        message="project change",
        worktree_root=run_workspace.run_worktree,
    )
    coordinator.promote_run(
        run_id="run-1",
        operation_request_id="promote-run-1",
        expected_run_state_digest=backend.repo_state_token(
            run_workspace.run_worktree
        ).digest,
        expected_project_version=run_workspace.project.version,
        expected_project_head=run_workspace.project.integration_head or "",
        expected_run_head=checkpoint.commit_oid,
    )
    target.write_text("user change", encoding="utf-8")
    _admit(journal=journal, coordinator=coordinator, run_id="run-2")

    with pytest.raises(WorkspaceOverlayConflictError):
        snapshots.read_range(
            run_id="run-2",
            relative_path="shared.txt",
        )


def test_visible_project_projection_matching_blob_is_not_user_conflict(
    tmp_path,
    journal,
):
    content, coordinator, snapshots, backend = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    repository = content.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    ).repository
    target = space / "shared.txt"
    target.write_text("base", encoding="utf-8")
    backend.commit_paths(space, (target,), message="base")
    first = _admit(
        journal=journal,
        coordinator=coordinator,
        run_id="run-1",
    )
    run_workspace = coordinator.ensure_run_materialized(
        run_id="run-1",
        operation_request_id="materialize-run-1",
        expected_repo_state_digest=backend.repo_state_token(space).digest,
        expected_project_version=first.project.version,
        expected_project_head=first.project.integration_head,
    )
    run_file = run_workspace.run_worktree / "shared.txt"
    run_file.write_text("project change", encoding="utf-8")
    checkpoint = content.checkpoint(
        repository.repository_id,
        operation_request_id="checkpoint-run-1",
        expected_repo_state_digest=backend.repo_state_token(
            run_workspace.run_worktree
        ).digest,
        paths=(run_file,),
        path_sources={"shared.txt": "agent_modified"},
        target_role="run",
        target_id="run-1",
        actor_id="agent-1",
        trigger="tool",
        message="project change",
        worktree_root=run_workspace.run_worktree,
    )
    coordinator.promote_run(
        run_id="run-1",
        operation_request_id="promote-run-1",
        expected_run_state_digest=backend.repo_state_token(
            run_workspace.run_worktree
        ).digest,
        expected_project_version=run_workspace.project.version,
        expected_project_head=run_workspace.project.integration_head or "",
        expected_run_head=checkpoint.commit_oid,
    )
    target.write_text("project change", encoding="utf-8")
    _admit(journal=journal, coordinator=coordinator, run_id="run-2")

    result = snapshots.read_range(
        run_id="run-2",
        relative_path="shared.txt",
    )

    assert result.content == b"project change"
    assert result.source_kind == "project_blob"
