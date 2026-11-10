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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app.run_context import RunContext
from app.run_journal import (
    OutboxLeaseLostError,
    RunEventDraft,
    SQLiteRunJournal,
    WorkspaceMutationBlockedError,
)
from app.workspace_git import (
    ContentRepositoryError,
    ContentRepositoryService,
    GitBackend,
    RepositoryStateChangedError,
    WorkspaceGitCoordinator,
    WorkspaceGitLifecycle,
    WorkspaceMutationService,
    WorkspaceSnapshotService,
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
    mutations = WorkspaceMutationService(
        journal,
        state_root=state_root,
        coordinator=coordinator,
        snapshots=snapshots,
        primary_checkout_enabled=False,
    )
    return content, coordinator, mutations, backend


def _context(
    space: Path, *, run_id: str = "run-1", task_id: str = "task-1"
) -> RunContext:
    return RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id=run_id,
        task_id=task_id,
        email="user@example.com",
        user_id="user-1",
        working_directory=space,
        task_output_root=space,
        camel_log_dir=space / ".logs",
        binding_source="test",
        workdir_mode="direct-write",
        browser_port=9222,
        session_mode="single-agent",
    )


def _admit(
    journal: SQLiteRunJournal,
    coordinator: WorkspaceGitCoordinator,
    *,
    run_id: str = "run-1",
    task_id: str = "task-1",
):
    journal.ensure_run(
        run_id=run_id,
        project_id="project-1",
        status="pending",
    )
    admission = coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id=run_id,
        task_id=task_id,
        session_mode="single-agent",
    )
    assert admission is not None
    return admission


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
    ).stdout


@pytest.mark.parametrize("second_actor", ["agent-1", "agent-2"])
@pytest.mark.parametrize("second_path", ["download.bin", "references.json"])
def test_direct_writer_operation_admission_serializes_paths(
    tmp_path, journal, second_actor, second_path
):
    content, coordinator, _, backend = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal, state_root=tmp_path / "state", coordinator=coordinator
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(space_id="space-1", space_root=space, allow_init=True)
    _admit(journal, coordinator)
    first = direct.prepare_broad_write(
        context=_context(space),
        operation_request_id="first",
        actor_id="agent-1",
        trigger="terminal.execute",
    )
    (space / "download.bin").write_text("still downloading")
    with ThreadPoolExecutor() as pool:
        future = pool.submit(
            direct.prepare_broad_write,
            context=_context(space),
            operation_request_id="second",
            actor_id=second_actor,
            trigger="terminal.execute",
        )
        with pytest.raises(OutboxLeaseLostError):
            future.result(timeout=5)
    assert len(journal.list_git_mutation_intents()) == 1
    direct.complete_broad_write(
        first,
        operation_request_id="first",
        actor_id="agent-1",
        trigger="terminal.execute",
    )
    second = direct.prepare_broad_write(
        context=_context(space),
        operation_request_id="second",
        actor_id=second_actor,
        trigger="terminal.execute",
    )
    (space / second_path).write_text("second result")
    direct.complete_broad_write(
        second,
        operation_request_id="second",
        actor_id=second_actor,
        trigger="terminal.execute",
    )
    assert backend.is_worktree_clean(space)
    assert not journal.list_git_mutation_intents(statuses=("prepared",))


def test_direct_file_writer_cannot_overlap_broad_writer(tmp_path, journal):
    content, coordinator, _, _ = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal, state_root=tmp_path / "state", coordinator=coordinator
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(space_id="space-1", space_root=space, allow_init=True)
    _admit(journal, coordinator)
    direct.prepare_broad_write(
        context=_context(space),
        operation_request_id="first",
        actor_id="agent-1",
        trigger="terminal.execute",
    )
    with pytest.raises(OutboxLeaseLostError):
        direct.prepare_file_write(
            context=_context(space),
            filename="other.txt",
            operation_request_id="second",
            actor_id="agent-2",
            trigger="filesystem.write",
        )


def test_direct_completion_replay_cannot_capture_a_later_writer(
    tmp_path, journal
):
    content, coordinator, _, _ = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal, state_root=tmp_path / "state", coordinator=coordinator
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(space_id="space-1", space_root=space, allow_init=True)
    _admit(journal, coordinator)

    def prepare(operation):
        return direct.prepare_broad_write(
            context=_context(space),
            operation_request_id=operation,
            actor_id="agent-1",
            trigger="terminal.execute",
        )

    first = prepare("first")
    (space / "file.txt").write_text("first")
    direct.complete_broad_write(
        first,
        operation_request_id="first",
        actor_id="agent-1",
        trigger="terminal.execute",
    )
    with pytest.raises(Exception, match="already completed"):
        prepare("first")
    second = prepare("second")
    (space / "file.txt").write_text("second")
    assert (
        direct.complete_broad_write(
            first,
            operation_request_id="first",
            actor_id="agent-1",
            trigger="terminal.execute",
        )
        == ()
    )
    assert _git(space, "show", "HEAD:file.txt") == "first"
    direct.complete_broad_write(
        second,
        operation_request_id="second",
        actor_id="agent-1",
        trigger="terminal.execute",
    )
    assert _git(space, "show", "HEAD:file.txt") == "second"


def test_file_write_materializes_before_target_is_available(tmp_path, journal):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    _admit(journal, coordinator)

    prepared = mutations.prepare_file_write(
        context=_context(space),
        filename="generated.txt",
        operation_request_id="tool-call-1",
        actor_id="agent-1",
        trigger="filesystem.write",
    )

    assert prepared is not None
    assert prepared.workspace.run.materialization_state == "materialized"
    assert (
        prepared.target_path.parent == prepared.agent_workspace.agent_worktree
    )
    assert not (space / "generated.txt").exists()
    prepared.target_path.write_text("agent output", encoding="utf-8")
    commit = mutations.complete_file_write(
        prepared,
        operation_request_id="tool-call-1",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert commit == backend.current_head(prepared.workspace.run_worktree)
    assert backend.is_worktree_clean(prepared.workspace.run_worktree)
    assert not (space / "generated.txt").exists()
    items = journal.list_git_change_set_items(
        prepared.change_set.change_set_id
    )
    assert len(items) == 1
    assert items[0].relative_path == "generated.txt"
    assert items[0].change_kind == "added"
    assert items[0].item_state == "checkpointed"


def test_overlay_modified_by_agent_commits_exact_user_preimage_first(
    tmp_path,
    journal,
):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    user_file = space / "draft.txt"
    user_file.write_text("user preimage", encoding="utf-8")
    _admit(journal, coordinator)

    prepared = mutations.prepare_file_write(
        context=_context(space),
        filename="draft.txt",
        operation_request_id="tool-call-overlay",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert prepared is not None
    assert prepared.overlay is not None
    assert prepared.target_path.read_text() == "user preimage"
    prepared.target_path.write_text("agent result", encoding="utf-8")

    commit = mutations.complete_file_write(
        prepared,
        operation_request_id="tool-call-overlay",
        actor_id="agent-1",
        trigger="filesystem.write",
    )

    assert commit is not None
    assert (
        _git(
            prepared.workspace.run_worktree,
            "show",
            f"{commit}^2^:draft.txt",
        )
        == "user preimage"
    )
    assert (
        _git(
            prepared.workspace.run_worktree,
            "show",
            f"{commit}^2:draft.txt",
        )
        == "agent result"
    )
    assert user_file.read_text() == "user preimage"
    items = journal.list_git_change_set_items(
        prepared.change_set.change_set_id
    )
    assert items[0].preimage_digest == prepared.overlay.content_digest
    assert items[0].item_state == "checkpointed"
    entry = journal.get_workspace_overlay_entry(
        prepared.overlay.snapshot.snapshot_id,
        "draft.txt",
    )
    assert entry is not None
    assert entry.entry_state == "agent_modified"


def test_startup_reconciles_crash_after_overlay_preimage_commit(
    tmp_path,
    journal,
    monkeypatch,
):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    user_file = space / "draft.txt"
    user_file.write_text("user preimage", encoding="utf-8")
    _admit(journal, coordinator)

    prepared = mutations.prepare_file_write(
        context=_context(space),
        filename="draft.txt",
        operation_request_id="tool-call-crash",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert prepared is not None
    assert prepared.overlay is not None
    prepared.target_path.write_text("agent result", encoding="utf-8")
    original_update = journal.update_git_change_set_item_state

    def crash_before_state_commit(**kwargs):
        if (
            kwargs["expected_state"] == "pending"
            and kwargs["state"] == "preimage_checkpointed"
        ):
            raise RuntimeError("simulated crash before state commit")
        return original_update(**kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(
            journal,
            "update_git_change_set_item_state",
            crash_before_state_commit,
        )
        with pytest.raises(RuntimeError, match="simulated crash"):
            mutations.complete_file_write(
                prepared,
                operation_request_id="tool-call-crash",
                actor_id="agent-1",
                trigger="filesystem.write",
            )

    assert prepared.target_path.read_text() == "user preimage"
    before = _git(
        prepared.workspace.run_worktree, "rev-list", "--count", "HEAD"
    )
    reconciliation = mutations.reconcile_startup()
    after = _git(
        prepared.workspace.run_worktree, "rev-list", "--count", "HEAD"
    )

    assert reconciliation.recovered_change_set_ids == (
        prepared.change_set.change_set_id,
    )
    assert reconciliation.needs_attention_change_set_ids == ()
    # The recovered history contains the User preimage checkpoint, Agent
    # result checkpoint, and one serialized merge into Run integration.
    assert int(after) == int(before) + 3
    assert prepared.target_path.read_text() == "agent result"
    assert user_file.read_text() == "user preimage"
    item = journal.list_git_change_set_items(
        prepared.change_set.change_set_id
    )[0]
    assert item.item_state == "checkpointed"
    assert item.operation_request_id == "tool-call-crash"


def test_startup_reconciles_exact_write_before_change_set_item_exists(
    tmp_path,
    journal,
):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    _admit(journal, coordinator)
    prepared = mutations.prepare_file_write(
        context=_context(space),
        filename="generated.txt",
        operation_request_id="tool-call-before-complete",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert prepared is not None
    prepared.target_path.write_text("durable result", encoding="utf-8")
    assert (
        journal.list_git_change_set_items(prepared.change_set.change_set_id)
        == []
    )

    reconciliation = mutations.reconcile_startup()

    assert reconciliation.recovered_change_set_ids == (
        prepared.change_set.change_set_id,
    )
    assert backend.is_worktree_clean(prepared.workspace.run_worktree)
    assert (
        _git(
            prepared.workspace.run_worktree,
            "show",
            "HEAD:generated.txt",
        )
        == "durable result"
    )
    intents = journal.list_git_mutation_intents()
    assert len(intents) == 1
    assert intents[0].status == "completed"


def test_startup_reconciles_broad_process_before_delta_scan(
    tmp_path,
    journal,
):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    _admit(journal, coordinator)
    prepared = mutations.prepare_broad_write(
        context=_context(space),
        operation_request_id="terminal-before-scan",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    assert prepared is not None
    (prepared.agent_workspace.agent_worktree / "generated.csv").write_text(
        "a,b\n1,2",
        encoding="utf-8",
    )

    reconciliation = mutations.reconcile_startup()

    assert reconciliation.recovered_change_set_ids == (
        prepared.change_set.change_set_id,
    )
    assert backend.is_worktree_clean(prepared.workspace.run_worktree)
    assert (
        _git(
            prepared.workspace.run_worktree,
            "show",
            "HEAD:generated.csv",
        )
        == "a,b\n1,2"
    )
    assert journal.list_git_mutation_intents()[0].status == "completed"


def test_checkpointed_agent_result_recovers_pending_merge_on_startup(
    tmp_path,
    journal,
    monkeypatch,
):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    _admit(journal, coordinator)
    prepared = mutations.prepare_file_write(
        context=_context(space),
        filename="result.txt",
        operation_request_id="checkpoint-before-merge",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert prepared is not None
    prepared.target_path.write_text("durable", encoding="utf-8")
    with monkeypatch.context() as patch:
        patch.setattr(
            mutations.workforce,
            "merge_agent_workspace",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(
                RuntimeError("simulated crash before merge")
            ),
        )
        with pytest.raises(RuntimeError, match="simulated crash"):
            mutations.complete_file_write(
                prepared,
                operation_request_id="checkpoint-before-merge",
                actor_id="agent-1",
                trigger="filesystem.write",
            )

    reconciliation = mutations.reconcile_startup()

    assert prepared.change_set.change_set_id in (
        reconciliation.recovered_change_set_ids
    )
    assert (
        _git(prepared.workspace.run_worktree, "show", "HEAD:result.txt")
        == "durable"
    )


def test_same_path_can_be_checkpointed_again_without_reimporting_user_source(
    tmp_path,
    journal,
):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    user_file = space / "draft.txt"
    user_file.write_text("user preimage", encoding="utf-8")
    _admit(journal, coordinator)

    first = mutations.prepare_file_write(
        context=_context(space),
        filename="draft.txt",
        operation_request_id="tool-call-first",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert first is not None and first.overlay is not None
    first.target_path.write_text("agent first", encoding="utf-8")
    mutations.complete_file_write(
        first,
        operation_request_id="tool-call-first",
        actor_id="agent-1",
        trigger="filesystem.write",
    )

    second = mutations.prepare_file_write(
        context=_context(space),
        filename="draft.txt",
        operation_request_id="tool-call-second",
        actor_id="agent-1",
        trigger="filesystem.write",
    )
    assert second is not None
    assert second.overlay is None
    assert second.target_path.read_text() == "agent first"
    second.target_path.write_text("agent second", encoding="utf-8")
    commit = mutations.complete_file_write(
        second,
        operation_request_id="tool-call-second",
        actor_id="agent-1",
        trigger="filesystem.write",
    )

    assert commit is not None
    assert _git(second.workspace.run_worktree, "show", "HEAD^:draft.txt") == (
        "agent first"
    )
    assert _git(second.workspace.run_worktree, "show", "HEAD:draft.txt") == (
        "agent second"
    )
    assert user_file.read_text() == "user preimage"
    item = journal.list_git_change_set_items(second.change_set.change_set_id)[
        0
    ]
    assert item.operation_request_id == "tool-call-second"
    assert item.item_state == "checkpointed"


def test_space_without_git_keeps_legacy_write_target(tmp_path, journal):
    _, _, mutations, _ = _services(tmp_path, journal)
    space = tmp_path / "space"
    space.mkdir()
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )

    prepared = mutations.prepare_file_write(
        context=_context(space),
        filename="legacy.txt",
        operation_request_id="tool-call-legacy",
        actor_id="agent-1",
        trigger="filesystem.write",
    )

    assert prepared is None


def test_broad_write_imports_only_overlay_paths_already_pinned_by_run(
    tmp_path,
    journal,
):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    visible = space / "visible.txt"
    hidden = space / "not-read.txt"
    visible.write_text("visible user data", encoding="utf-8")
    hidden.write_text("not admitted", encoding="utf-8")
    _admit(journal, coordinator)
    mutations.snapshots.pin_path(
        run_id="run-1",
        relative_path="visible.txt",
    )

    prepared = mutations.prepare_broad_write(
        context=_context(space),
        operation_request_id="terminal-call-1",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )

    assert prepared is not None
    assert (
        prepared.agent_workspace.agent_worktree / "visible.txt"
    ).read_text() == ("visible user data")
    assert not (
        prepared.agent_workspace.agent_worktree / "not-read.txt"
    ).exists()
    assert [item.relative_path for item in prepared.imported_overlays] == [
        "visible.txt"
    ]

    commits = mutations.complete_broad_write(
        prepared,
        operation_request_id="terminal-call-1",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    assert commits == ()
    assert backend.is_worktree_clean(prepared.workspace.run_worktree)
    assert visible.read_text() == "visible user data"

    prepared_again = mutations.prepare_broad_write(
        context=_context(space),
        operation_request_id="terminal-call-retry",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    assert prepared_again is not None
    assert (
        prepared_again.agent_workspace.agent_worktree / "visible.txt"
    ).read_text() == "visible user data"


def test_broad_write_renews_lease_for_long_running_process(
    tmp_path,
    journal,
):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    _admit(journal, coordinator)
    prepared = mutations.prepare_broad_write(
        context=_context(space),
        operation_request_id="terminal-call-long-running",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    assert prepared is not None
    before = journal.get_git_agent_workspace("run-1", "developer-agent")
    assert before is not None and before.lease_until is not None

    mutations.renew_broad_write(
        prepared,
        now=before.lease_until - 1.0,
    )

    renewed = journal.get_git_agent_workspace("run-1", "developer-agent")
    assert renewed is not None and renewed.lease_until is not None
    assert renewed.lease_token == before.lease_token
    assert renewed.lease_until > before.lease_until
    mutations.complete_broad_write(
        prepared,
        operation_request_id="terminal-call-long-running",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )


def test_broad_write_checkpoints_only_actual_process_delta(tmp_path, journal):
    content, coordinator, mutations, backend = _services(tmp_path, journal)
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
    _admit(journal, coordinator)
    prepared = mutations.prepare_broad_write(
        context=_context(space),
        operation_request_id="terminal-call-2",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    assert prepared is not None
    (prepared.agent_workspace.agent_worktree / "seed.txt").write_text(
        "updated"
    )
    (prepared.agent_workspace.agent_worktree / "generated.csv").write_text(
        "a,b\n1,2"
    )

    commits = mutations.complete_broad_write(
        prepared,
        operation_request_id="terminal-call-2",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )

    assert len(commits) == 1
    assert backend.is_worktree_clean(prepared.workspace.run_worktree)
    items = journal.list_git_change_set_items(
        prepared.change_set.change_set_id
    )
    assert [
        (item.relative_path, item.change_kind, item.item_state)
        for item in items
    ] == [
        ("generated.csv", "added", "checkpointed"),
        ("seed.txt", "modified", "checkpointed"),
    ]
    assert seed.read_text() == "seed"


def test_primary_checkout_write_commits_in_place_and_records_run_oids(
    tmp_path,
    journal,
):
    content, coordinator, _, backend = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal,
        state_root=tmp_path / "state",
        coordinator=coordinator,
    )
    lifecycle = WorkspaceGitLifecycle(
        journal,
        state_root=tmp_path / "state",
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
    base = backend.commit_paths(space, (seed,), message="seed")
    admission = _admit(journal, coordinator)

    prepared = direct.prepare_file_write(
        context=_context(space),
        filename="generated.txt",
        operation_request_id="direct-file-1",
        actor_id="developer-agent",
        trigger="filesystem.write",
    )
    assert prepared is not None
    assert prepared.workspace is None
    assert prepared.agent_workspace is None
    assert prepared.mutation_root == space
    prepared.target_path.write_text("visible now", encoding="utf-8")

    checkpoint = direct.complete_file_write(
        prepared,
        operation_request_id="direct-file-1",
        actor_id="developer-agent",
        trigger="filesystem.write",
    )

    assert checkpoint == backend.current_head(space)
    assert (space / "generated.txt").read_text() == "visible now"
    assert not (tmp_path / "state" / "worktrees").exists()
    message = _git(space, "show", "-s", "--format=%B", checkpoint or "HEAD")
    assert "Eigent-Task-ID: task-1" in message
    assert "Eigent-Run-ID: run-1" in message
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="run-1-completed",
            event_type="run.completed",
            payload={"reason": "test"},
        ),
    )

    finalized = lifecycle.finalize_run("run-1")
    persisted = journal.get_run_git_materialization("run-1")

    assert finalized.outcome == "committed_primary"
    assert persisted is not None
    assert persisted.workspace_base_commit == base
    assert persisted.promoted_commit == checkpoint
    assert tuple(
        item.relative_path
        for item in backend.changed_paths_between(
            space,
            base_commit=base,
            target_commit=checkpoint or "HEAD",
        )
    ) == ("generated.txt",)
    assert admission.writer.request.status == "acquired"
    writer = journal.get_workspace_writer_request("workspace-writer:run-1")
    assert writer is not None and writer.status == "released"


def test_primary_checkout_preserves_dirty_user_preimage_before_agent_diff(
    tmp_path,
    journal,
):
    content, coordinator, _, backend = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal,
        state_root=tmp_path / "state",
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
    backend.commit_paths(space, (seed,), message="seed")
    seed.write_text("user draft", encoding="utf-8")
    _admit(journal, coordinator)

    prepared = direct.prepare_file_write(
        context=_context(space),
        filename="generated.txt",
        operation_request_id="direct-file-2",
        actor_id="developer-agent",
        trigger="filesystem.write",
    )
    assert prepared is not None
    preserved_base = backend.current_head(space)
    assert preserved_base is not None
    assert _git(space, "show", f"{preserved_base}:seed.txt") == "user draft"
    prepared.target_path.write_text("agent output", encoding="utf-8")
    terminal = direct.complete_file_write(
        prepared,
        operation_request_id="direct-file-2",
        actor_id="developer-agent",
        trigger="filesystem.write",
    )

    run = journal.get_run_git_materialization("run-1")
    assert run is not None and run.workspace_base_commit == preserved_base
    assert tuple(
        item.relative_path
        for item in backend.changed_paths_between(
            space,
            base_commit=preserved_base,
            target_commit=terminal or "HEAD",
        )
    ) == ("generated.txt",)


def test_primary_checkout_noop_keeps_change_set_base_after_tool_side_effect(
    tmp_path,
    journal,
):
    content, coordinator, _, backend = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal,
        state_root=tmp_path / "state",
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
    backend.commit_paths(space, (seed,), message="seed")
    (space / "user-draft.txt").write_text("user preimage", encoding="utf-8")
    _admit(journal, coordinator)

    first = direct.prepare_file_write(
        context=_context(space),
        filename="seed.txt",
        operation_request_id="direct-noop-1",
        actor_id="developer-agent",
        trigger="filesystem.edit",
    )
    assert first is not None
    frozen_base = first.change_set.base_commit

    # Some editor adapters create a backup even when their exact replacement
    # is a no-op. The next mutation must not reclassify that Agent side effect
    # as a new User preimage and move the already-created ChangeSet base.
    (space / "seed.txt.20260823_122919.bak").write_text(
        "seed", encoding="utf-8"
    )
    assert (
        direct.complete_file_write(
            first,
            operation_request_id="direct-noop-1",
            actor_id="developer-agent",
            trigger="filesystem.edit",
        )
        is None
    )
    assert (
        journal.list_git_change_set_items(first.change_set.change_set_id) == []
    )

    second = direct.prepare_file_write(
        context=_context(space),
        filename="seed.txt",
        operation_request_id="direct-noop-2",
        actor_id="developer-agent",
        trigger="filesystem.edit",
    )

    assert second is not None
    assert second.change_set.change_set_id == first.change_set.change_set_id
    assert second.change_set.base_commit == frozen_base
    run = journal.get_run_git_materialization("run-1")
    assert run is not None and run.workspace_base_commit == frozen_base


def test_primary_checkout_broad_process_commits_only_visible_checkout(
    tmp_path,
    journal,
):
    content, coordinator, _, backend = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal,
        state_root=tmp_path / "state",
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
    backend.commit_paths(space, (seed,), message="seed")
    _admit(journal, coordinator)

    prepared = direct.prepare_broad_write(
        context=_context(space),
        operation_request_id="direct-terminal-1",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    assert prepared is not None
    (prepared.mutation_root / "seed.txt").write_text(
        "updated", encoding="utf-8"
    )
    (prepared.mutation_root / "generated.csv").write_text(
        "a,b\n1,2", encoding="utf-8"
    )

    commits = direct.complete_broad_write(
        prepared,
        operation_request_id="direct-terminal-1",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )

    assert len(commits) == 1
    assert backend.is_worktree_clean(space)
    assert _git(space, "show", "HEAD:seed.txt") == "updated"
    assert _git(space, "show", "HEAD:generated.csv") == "a,b\n1,2"
    assert not (tmp_path / "state" / "worktrees").exists()


def test_primary_checkout_broad_process_preserves_nested_repository_boundary(
    tmp_path,
    journal,
):
    content, coordinator, _, backend = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal,
        state_root=tmp_path / "state",
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
    backend.commit_paths(space, (seed,), message="seed")
    parent_head = backend.current_head(space)
    parent_state = backend.repo_state_token(space)
    _admit(journal, coordinator)

    prepared = direct.prepare_broad_write(
        context=_context(space),
        operation_request_id="direct-terminal-clone",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    assert prepared is not None
    nested = prepared.mutation_root / "child-repository"
    nested.mkdir()
    _git(nested, "init", "--initial-branch=main")
    (nested / "README.md").write_text("# Child\n", encoding="utf-8")
    _git(nested, "add", "README.md")
    _git(
        nested,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "seed child",
    )

    assert (
        _git(space, "status", "--porcelain=v1", "--untracked-files=all")
        == "?? child-repository/\n"
    )
    commits = direct.complete_broad_write(
        prepared,
        operation_request_id="direct-terminal-clone",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )

    assert commits == ()
    assert backend.current_head(space) == parent_head
    assert backend.repo_state_token(space) == parent_state
    assert backend.worktree_status(space) == {}
    # Physical Git status still exposes the independent repository boundary;
    # only Eigent's parent Content Repository ownership view excludes it.
    assert not backend.is_worktree_clean(space)
    assert backend.worktree_matches_commit(space, parent_head)
    assert _git(nested, "show", "HEAD:README.md") == "# Child\n"
    assert _git(space, "ls-files", "child-repository") == ""
    items = journal.list_git_change_set_items(
        prepared.change_set.change_set_id
    )
    assert items == []


def test_failed_primary_checkout_run_keeps_a_recovery_ref(tmp_path, journal):
    content, coordinator, _, backend = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal,
        state_root=tmp_path / "state",
        coordinator=coordinator,
    )
    lifecycle = WorkspaceGitLifecycle(
        journal,
        state_root=tmp_path / "state",
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
    backend.commit_paths(space, (seed,), message="seed")
    _admit(journal, coordinator)
    prepared = direct.prepare_file_write(
        context=_context(space),
        filename="partial.txt",
        operation_request_id="direct-partial-1",
        actor_id="developer-agent",
        trigger="filesystem.write",
    )
    assert prepared is not None
    prepared.target_path.write_text("recoverable", encoding="utf-8")
    terminal = direct.complete_file_write(
        prepared,
        operation_request_id="direct-partial-1",
        actor_id="developer-agent",
        trigger="filesystem.write",
    )
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="run-1-failed",
            event_type="run.failed",
            payload={"reason": "test"},
        ),
    )

    finalized = lifecycle.finalize_run("run-1")

    assert finalized.outcome == "preserved_primary_failed"
    assert finalized.archive_ref is not None
    assert finalized.archive_ref.endswith("/recovery-failed")
    assert backend.ref_oid(space, finalized.archive_ref) == terminal


def _direct_space(tmp_path: Path, journal: SQLiteRunJournal):
    content, coordinator, _, backend = _services(tmp_path, journal)
    direct = WorkspaceMutationService(
        journal,
        state_root=tmp_path / "state",
        coordinator=coordinator,
    )
    space = tmp_path / "space"
    space.mkdir()
    content.bootstrap(space_id="space-1", space_root=space, allow_init=True)
    seed = space / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    backend.commit_paths(space, (seed,), message="seed")
    return coordinator, direct, backend, space


def _stop_run(journal, coordinator, run_id: str = "run-1") -> None:
    journal.append_event(
        run_id,
        RunEventDraft(
            event_id=f"{run_id}-failed",
            event_type="run.failed",
            payload={"reason": "test"},
        ),
    )
    coordinator.writer_scheduler.finish_task(run_id=run_id)


def _prepare_direct(
    direct, space, operation, filename, *, run_id="run-1", task_id="task-1"
):
    prepared = direct.prepare_file_write(
        context=_context(space, run_id=run_id, task_id=task_id),
        filename=filename,
        operation_request_id=operation,
        actor_id="developer-agent",
        trigger="filesystem.edit",
    )
    assert prepared is not None
    return prepared


def test_unsettled_direct_write_fences_the_checkout_with_diagnostics(
    tmp_path, journal
):
    coordinator, direct, _, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    first = _prepare_direct(direct, space, "edit-1", "seed.txt")

    with pytest.raises(WorkspaceMutationBlockedError) as blocked:
        _prepare_direct(direct, space, "write-2", "other.txt")

    assert isinstance(blocked.value, OutboxLeaseLostError)
    assert blocked.value.intent_id == first.intent.intent_id
    assert blocked.value.run_id == "run-1"
    assert blocked.value.status == "prepared"
    assert "still active or needs attention" in str(blocked.value)


def test_failed_direct_edit_settles_as_noop_and_the_next_write_proceeds(
    tmp_path, journal
):
    coordinator, direct, backend, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    head = backend.current_head(space)
    failed = _prepare_direct(direct, space, "edit-1", "seed.txt")
    # The edit's old_content was not found, so the file never changed.
    assert (
        direct.complete_file_write(
            failed,
            operation_request_id="edit-1",
            actor_id="developer-agent",
            trigger="filesystem.edit",
        )
        is None
    )

    second = _prepare_direct(direct, space, "write-2", "report.md")
    second.target_path.write_text("written", encoding="utf-8")
    commit = direct.complete_file_write(
        second,
        operation_request_id="write-2",
        actor_id="developer-agent",
        trigger="filesystem.write",
    )

    assert backend.current_head(space) == commit != head
    assert {item.status for item in journal.list_git_mutation_intents()} == {
        "completed"
    }


def test_startup_settles_an_unchanged_direct_write_so_a_new_run_can_write(
    tmp_path, journal
):
    coordinator, direct, backend, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    head = backend.current_head(space)
    crashed = _prepare_direct(direct, space, "edit-1", "seed.txt")

    reconciliation = direct.reconcile_startup()

    assert reconciliation.needs_attention_change_set_ids == ()
    assert reconciliation.recovered_change_set_ids == (
        crashed.change_set.change_set_id,
    )
    assert [item.status for item in journal.list_git_mutation_intents()] == [
        "completed"
    ]
    assert backend.current_head(space) == head
    _stop_run(journal, coordinator)
    _admit(journal, coordinator, run_id="run-2", task_id="task-2")
    later = _prepare_direct(
        direct,
        space,
        "write-run-2",
        "later.txt",
        run_id="run-2",
        task_id="task-2",
    )
    later.target_path.write_text("later", encoding="utf-8")
    direct.complete_file_write(
        later,
        operation_request_id="write-run-2",
        actor_id="developer-agent",
        trigger="filesystem.write",
    )
    assert _git(space, "show", "HEAD:later.txt") == "later"


def test_startup_resumes_a_recorded_direct_result_with_its_checkpoint(
    tmp_path, journal
):
    coordinator, direct, backend, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    crashed = _prepare_direct(direct, space, "write-1", "report.md")
    crashed.target_path.write_text("agent result", encoding="utf-8")
    # Crash after the result was recorded but before its checkpoint.
    journal.put_git_change_set_item(
        change_set_id=crashed.change_set.change_set_id,
        relative_path="report.md",
        operation_request_id="write-1",
        actor_id="developer-agent",
        trigger="filesystem.write",
        change_kind="added",
        source="agent_created",
        preimage_digest=None,
        result_digest=direct._digest_file(crashed.target_path),
        size_bytes=len("agent result"),
    )

    reconciliation = direct.reconcile_startup()

    assert reconciliation.needs_attention_change_set_ids == ()
    assert _git(space, "show", "HEAD:report.md") == "agent result"
    assert backend.is_worktree_clean(space)
    assert journal.list_git_mutation_intents()[0].status == "completed"


def test_startup_quarantines_a_changed_direct_write_for_user_review(
    tmp_path, journal
):
    coordinator, direct, backend, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    head = backend.current_head(space)
    crashed = _prepare_direct(direct, space, "edit-1", "seed.txt")
    (space / "seed.txt").write_text("changed after the crash", "utf-8")

    reconciliation = direct.reconcile_startup()

    assert reconciliation.needs_attention_change_set_ids == (
        crashed.change_set.change_set_id,
    )
    assert journal.list_git_mutation_intents()[0].status == "needs_attention"
    # Nothing is guessed: the file and HEAD are exactly as the user left them.
    assert (space / "seed.txt").read_text() == "changed after the crash"
    assert backend.current_head(space) == head


def test_startup_keeps_a_direct_broad_process_for_user_review(
    tmp_path, journal
):
    coordinator, direct, _, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    direct.prepare_broad_write(
        context=_context(space),
        operation_request_id="terminal-1",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    (space / "build.log").write_text("output", encoding="utf-8")

    direct.reconcile_startup()

    assert journal.list_git_mutation_intents()[0].status == "needs_attention"
    assert (space / "build.log").read_text() == "output"


def test_blocked_operation_resolution_waits_for_the_task_to_stop(
    tmp_path, journal
):
    coordinator, direct, _, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    prepared = _prepare_direct(direct, space, "edit-1", "seed.txt")
    repository_id = prepared.change_set.repository_id

    (blocked,) = direct.list_blocked_operations(repository_id)

    assert blocked.intent.intent_id == prepared.intent.intent_id
    assert blocked.actionable is False
    with pytest.raises(ContentRepositoryError, match="Stop the Task"):
        direct.dismiss_blocked_operation(
            repository_id=repository_id,
            intent_id=prepared.intent.intent_id,
        )
    assert journal.list_git_mutation_intents()[0].status == "prepared"


def test_dismiss_blocked_operation_leaves_files_and_tool_outcomes_untouched(
    tmp_path, journal
):
    coordinator, direct, backend, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    head = backend.current_head(space)
    prepared = _prepare_direct(direct, space, "edit-1", "seed.txt")
    (space / "seed.txt").write_text("half-written", "utf-8")
    direct.reconcile_startup()
    _stop_run(journal, coordinator)
    repository_id = prepared.change_set.repository_id
    tool_calls_before = journal.list_tool_calls("run-1")

    (blocked,) = direct.list_blocked_operations(repository_id)
    assert blocked.actionable and blocked.can_checkpoint
    dismissed = direct.dismiss_blocked_operation(
        repository_id=repository_id,
        intent_id=prepared.intent.intent_id,
    )

    assert dismissed.status == "abandoned"
    assert direct.list_blocked_operations(repository_id) == ()
    assert (space / "seed.txt").read_text() == "half-written"
    assert backend.current_head(space) == head
    assert journal.list_tool_calls("run-1") == tool_calls_before
    (change_set,) = journal.list_git_change_sets()
    assert change_set.state == "discarded"
    _admit(journal, coordinator, run_id="run-2", task_id="task-2")
    later = _prepare_direct(
        direct,
        space,
        "write-run-2",
        "later.txt",
        run_id="run-2",
        task_id="task-2",
    )
    assert later.intent.status == "prepared"
    with pytest.raises(ContentRepositoryError, match="already abandoned"):
        direct.dismiss_blocked_operation(
            repository_id=repository_id,
            intent_id=prepared.intent.intent_id,
        )


def test_checkpoint_blocked_operation_saves_reviewed_content(
    tmp_path, journal
):
    coordinator, direct, backend, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    prepared = _prepare_direct(direct, space, "edit-1", "seed.txt")
    (space / "seed.txt").write_text("keep this", "utf-8")
    direct.reconcile_startup()
    _stop_run(journal, coordinator)
    repository_id = prepared.change_set.repository_id
    (blocked,) = direct.list_blocked_operations(repository_id)
    assert blocked.repo_state_digest is not None

    with pytest.raises(RepositoryStateChangedError):
        direct.checkpoint_blocked_operation(
            repository_id=repository_id,
            intent_id=prepared.intent.intent_id,
            operation_request_id="user-save-stale",
            expected_repo_state_digest="0" * 64,
        )
    assert journal.list_git_mutation_intents()[0].status == "needs_attention"

    commits = direct.checkpoint_blocked_operation(
        repository_id=repository_id,
        intent_id=prepared.intent.intent_id,
        operation_request_id="user-save-1",
        expected_repo_state_digest=blocked.repo_state_digest,
    )

    assert commits == (backend.current_head(space),)
    assert _git(space, "show", "HEAD:seed.txt") == "keep this"
    message = _git(space, "show", "-s", "--format=%B", "HEAD")
    assert "Eigent-Initiator: Agent" in message
    assert "Eigent-Task-ID: task-1" in message
    assert backend.is_worktree_clean(space)
    assert journal.list_git_mutation_intents()[0].status == "completed"
    assert direct.list_blocked_operations(repository_id) == ()


def test_checkpoint_blocked_broad_process_captures_the_checkout_delta(
    tmp_path, journal
):
    coordinator, direct, backend, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    prepared = direct.prepare_broad_write(
        context=_context(space),
        operation_request_id="terminal-1",
        actor_id="developer-agent",
        trigger="terminal.execute",
    )
    (space / "build.log").write_text("output", encoding="utf-8")
    direct.mark_broad_write_needs_attention(prepared)
    _stop_run(journal, coordinator)
    repository_id = prepared.change_set.repository_id
    (blocked,) = direct.list_blocked_operations(repository_id)

    direct.checkpoint_blocked_operation(
        repository_id=repository_id,
        intent_id=prepared.intent.intent_id,
        operation_request_id="user-save-1",
        expected_repo_state_digest=blocked.repo_state_digest,
    )

    assert _git(space, "show", "HEAD:build.log") == "output"
    assert journal.list_git_mutation_intents()[0].status == "completed"
    (change_set,) = journal.list_git_change_sets()
    assert change_set.state == "open"


def test_failed_completion_is_quarantined_instead_of_left_prepared(
    tmp_path, journal
):
    coordinator, direct, _, space = _direct_space(tmp_path, journal)
    _admit(journal, coordinator)
    prepared = _prepare_direct(direct, space, "edit-1", "seed.txt")

    direct.mark_file_write_needs_attention(prepared)

    assert journal.list_git_mutation_intents()[0].status == "needs_attention"
    (change_set,) = journal.list_git_change_sets()
    assert change_set.state == "needs_attention"
    with pytest.raises(WorkspaceMutationBlockedError) as blocked:
        _prepare_direct(direct, space, "write-2", "other.txt")
    assert blocked.value.status == "needs_attention"
