"""Isolated workspace path-budget and runtime-storage regressions."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from app import artifacts
from app.run_journal import (
    InvalidRunTransitionError,
    RunEventDraft,
    SQLiteRunJournal,
)
from app.utils.runtime_storage import runtime_storage
from app.workspace_git import GitBackend, WorkspaceMutationService
from app.workspace_git.backend import WorkspaceDeltaLimitExceeded
from app.workspace_git.content import ContentRepositoryError

from .test_mutation import (
    _admit,
    _context,
    _services,
)


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as value:
        yield value


def _files(root, count):
    root.mkdir(parents=True, exist_ok=True)
    for index in range(count):
        (root / f"file-{index:04}.txt").write_text(str(index))


def _scan(root, **kwargs):
    return artifacts.discover_task_changed_files(
        SimpleNamespace(
            working_directory=str(root),
            task_output_root=str(root),
            task_start_time=0,
        ),
        **kwargs,
    )


@pytest.mark.parametrize("count", [499, 500, 501])
def test_path_budget_boundary_has_structured_diagnostic(tmp_path, count):
    git = GitBackend()
    git.init_repository(tmp_path)
    _files(tmp_path / "outputs", count)
    if count <= 500:
        assert len(git.worktree_status(tmp_path)) == count
    else:
        with pytest.raises(Exception) as caught:
            git.worktree_status(tmp_path)
        assert type(caught.value).__name__ == "WorkspaceDeltaLimitExceeded"
        diagnostic = caught.value.diagnostic
        assert diagnostic["limit"] == 500
        assert diagnostic["observed_count"] == 501
        assert diagnostic["count_is_exact"] is True
        assert diagnostic["top_directories"][0] == {
            "path": "outputs",
            "count": 501,
        }
        assert diagnostic["recovery_actions"]


def test_legacy_venv_does_not_poison_checkpoint_or_artifacts(tmp_path):
    git = GitBackend()
    git.init_repository(tmp_path)
    venv = tmp_path / "tools" / "vision-env"
    _files(venv / "lib" / "python3.11" / "site-packages", 1880)
    (venv / "pyvenv.cfg").write_text("home = /mock/python\n")
    (tmp_path / "final.mp4").write_bytes(b"fixture")
    assert git.worktree_status(tmp_path) == {"final.mp4": "??"}
    result = _scan(tmp_path)
    assert [item["relativePath"] for item in result.artifacts] == ["final.mp4"]
    assert result.scan_status == "complete"


def test_git_ignore_applies_before_artifact_limit(tmp_path):
    git = GitBackend()
    git.init_repository(tmp_path)
    (tmp_path / ".gitignore").write_text("/ignored/\n")
    _files(tmp_path / "ignored", 1001)
    (tmp_path / "final.blend").write_bytes(b"fixture")
    result = _scan(tmp_path, max_entries=1)
    assert [item["relativePath"] for item in result.artifacts] == [
        "final.blend"
    ]
    assert result.scan_status == "complete"


def test_git_nested_ignores_negation_info_exclude_and_artifact_safety(
    tmp_path,
):
    git = GitBackend()
    git.init_repository(tmp_path)
    (tmp_path / ".gitignore").write_text("ignored/*\n!ignored/keep.txt\n")
    (tmp_path / ".git" / "info" / "exclude").write_text("private/\n")
    _files(tmp_path / "ignored", 501)
    _files(tmp_path / "private", 501)
    keep = tmp_path / "ignored" / "keep.txt"
    keep.write_text("deliverable")
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / ".gitignore").write_text("cache/\n")
    _files(nested / "cache", 501)
    (nested / "result.txt").write_text("deliverable")
    (tmp_path / "unsafe-link").symlink_to(
        tmp_path.parent, target_is_directory=True
    )
    files = {a["relativePath"] for a in _scan(tmp_path).artifacts}
    assert files == {"ignored/keep.txt", "nested/result.txt"}
    status = git.worktree_status(tmp_path)
    assert all(not p.startswith(("private/", "nested/cache/")) for p in status)


def test_artifact_classification_failure_is_partial_and_never_falls_back(
    tmp_path, monkeypatch
):
    git = GitBackend()
    git.init_repository(tmp_path)
    (tmp_path / "secret.txt").write_text("private")

    def unavailable(*args, **kwargs):
        from app.workspace_git.backend import GitBackendError

        raise GitBackendError("ignore service unavailable")

    monkeypatch.setattr(GitBackend, "ignored_paths", unavailable)
    result = _scan(tmp_path)
    assert result.artifacts == []
    assert result.scan_status == "partial" and result.truncated


def test_git_and_fallback_artifact_classification_agree(tmp_path):
    git = GitBackend()
    git.init_repository(tmp_path)
    base = git.create_empty_initial_commit(tmp_path, message="Empty base")
    _files(tmp_path / "venv", 1001)
    final = tmp_path / "scene.blend"
    final.write_bytes(b"fixture")
    head = git.commit_paths(tmp_path, (final,), message="Final scene")
    journal = SimpleNamespace(
        get_run_git_materialization=lambda run_id: SimpleNamespace(
            workspace_base_commit=base,
            promoted_commit=head,
            materialization_state="promoted",
            repository_id="repo",
        ),
        get_git_repository=lambda repo_id: SimpleNamespace(
            root_path=str(tmp_path)
        ),
        get_project_git_state=lambda project_id: SimpleNamespace(
            pending_apply=False
        ),
    )
    native = artifacts._git_run_changed_artifacts(
        journal, SimpleNamespace(run_id="run-1", project_id="project-1")
    )
    fallback = _scan(tmp_path)
    assert native.artifacts == fallback.artifacts
    assert native.scan_status == fallback.scan_status == "complete"


def _direct(tmp_path, journal):
    content, coordinator, _, git = _services(tmp_path, journal)
    root = tmp_path / "space"
    root.mkdir()
    content.bootstrap(space_id="space-1", space_root=root, allow_init=True)
    _admit(journal, coordinator)
    mutations = WorkspaceMutationService(
        journal, state_root=tmp_path / "state", coordinator=coordinator
    )
    return root, mutations, git


def test_legacy_agent_checkpoint_merge_tolerates_operational_files(
    tmp_path, journal
):
    content, coordinator, mutations, git = _services(tmp_path, journal)
    root = tmp_path / "space"
    root.mkdir()
    content.bootstrap(space_id="space-1", space_root=root, allow_init=True)
    _admit(journal, coordinator)
    prepared = mutations.prepare_broad_write(
        context=_context(root),
        operation_request_id="legacy-runtime",
        actor_id="agent",
        trigger="terminal.execute",
    )
    _files(prepared.mutation_root / ".venv" / "lib", 1880)
    (prepared.mutation_root / "final.mp4").write_bytes(b"fixture")
    commits = mutations.complete_broad_write(
        prepared,
        operation_request_id="legacy-runtime",
        actor_id="agent",
        trigger="terminal.execute",
    )
    assert commits
    assert (
        prepared.workspace.run_worktree / "final.mp4"
    ).read_bytes() == b"fixture"
    assert git.is_worktree_clean(prepared.mutation_root)


def test_unresolved_broad_write_blocks_success_even_without_tool_row(
    tmp_path, journal
):
    root, mutations, _ = _direct(tmp_path, journal)
    prepared = mutations.prepare_broad_write(
        context=_context(root),
        operation_request_id="write-1",
        actor_id="agent",
        trigger="terminal.execute",
    )
    assert prepared is not None
    manifest = artifacts.record_artifact_manifest(
        journal, run_id="run-1", project_id="project-1", artifacts=[]
    )
    with pytest.raises(InvalidRunTransitionError, match="workspace mutation"):
        journal.complete_successful_run(
            "run-1",
            assistant_final=RunEventDraft(
                event_id="final",
                event_type="assistant.final",
                payload={"message": "done"},
            ),
            terminal=RunEventDraft(
                event_id="completed",
                event_type="run.completed",
                payload={},
            ),
            artifact_manifest=manifest,
            expected_project_id="project-1",
        )
    assert not any(
        e.event_type == "run.completed" for e in journal.list_events("run-1")
    )


def test_status_output_truncation_is_never_success(tmp_path):
    git = GitBackend(max_status_output_chars=200)
    git.init_repository(tmp_path)
    _files(tmp_path / "long-name-output-directory", 501)
    with pytest.raises(WorkspaceDeltaLimitExceeded) as caught:
        git.worktree_status(tmp_path)
    assert caught.value.diagnostic["count_is_exact"] is False
    assert git.path_budget(tmp_path)["blocked"] is True
    assert git.path_budget(tmp_path)["exceeded"] is None


def test_tracked_operational_and_ignored_files_stay_content(tmp_path):
    git = GitBackend()
    git.init_repository(tmp_path)
    path = tmp_path / ".venv" / "user-owned.txt"
    path.parent.mkdir()
    path.write_text("user file")
    git.commit_paths(
        tmp_path, (path,), message="Explicitly track user content"
    )
    (tmp_path / ".gitignore").write_text(".venv/\n")
    path.write_text("user edit")
    assert ".venv/user-owned.txt" in git.worktree_status(tmp_path)
    assert ".venv/user-owned.txt" in {
        a["relativePath"] for a in _scan(tmp_path).artifacts
    }


def test_720_intermediate_frames_survive_and_finals_are_deliverables(
    tmp_path, monkeypatch
):
    test_home = tmp_path / "owner"
    test_home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: test_home))
    root = tmp_path / "space"
    root.mkdir()
    git = GitBackend()
    git.init_repository(root)
    storage = runtime_storage(_context(root), create=True)
    _files(storage.intermediates / "frames", 720)
    _files(storage.runtime / "vision-env" / "lib", 1880)
    _files(storage.cache / "models", 1001)
    for name in ("final.mp4", "scene.blend"):
        (root / name).write_bytes(b"fixture")
    assert set(git.worktree_status(root)) == {"final.mp4", "scene.blend"}
    result = _scan(root)
    assert len(result.artifacts) == 2
    assert {item["artifactRole"] for item in result.artifacts} == {
        "deliverable"
    }
    assert result.scan_status == "complete"
    with SQLiteRunJournal(tmp_path / "artifacts.sqlite3") as manifest_journal:
        manifest_journal.ensure_run(run_id="run-1", project_id="project-1")
        artifacts.record_artifact_manifest(
            manifest_journal,
            run_id="run-1",
            project_id="project-1",
            artifacts=result.artifacts,
        )
        manifest_journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="completed", event_type="run.completed", payload={}
            ),
        )
        uploads = manifest_journal.claim_ready_artifact_uploads(
            now=float("inf")
        )
        assert {upload.filename for upload in uploads} == {
            "final.mp4",
            "scene.blend",
        }
    from app.agent.toolkit.terminal_toolkit import (
        BaseTerminalToolkit,
        TerminalToolkit,
    )
    from app.utils.listen import toolkit_listen

    monkeypatch.setattr(BaseTerminalToolkit, "cleanup", lambda self: None)
    monkeypatch.setattr(
        toolkit_listen, "get_task_lock", lambda task_id: object()
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_get_context",
        lambda *args: ("TerminalToolkit", "cleanup", None, True),
    )
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    toolkit.cloned_env_path = str(storage.runtime / "temporary-clone")
    Path(toolkit.cloned_env_path).mkdir()
    toolkit.cleanup()
    assert not Path(toolkit.cloned_env_path).exists()
    assert len(list(storage.intermediates.rglob("*.txt"))) == 720
    assert runtime_storage(_context(root)) == storage
    assert runtime_storage(_context(root, run_id="run-2")).root != storage.root


def test_runtime_storage_rejects_escape_symlink(tmp_path, monkeypatch):
    test_home = tmp_path / "owner"
    test_home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: test_home))
    root = tmp_path / "space"
    root.mkdir()
    storage = runtime_storage(_context(root), create=True)
    cache = storage.cache / "pip"
    cache.rmdir()
    cache.symlink_to(root, target_is_directory=True)
    with pytest.raises(ValueError, match="redirect"):
        runtime_storage(_context(root), create=True)
    assert not list(root.iterdir())


def test_ordinary_720_frames_are_not_silently_ignored(tmp_path):
    git = GitBackend()
    git.init_repository(tmp_path)
    _files(tmp_path / "frames", 720)
    with pytest.raises(WorkspaceDeltaLimitExceeded) as caught:
        git.worktree_status(tmp_path)
    assert caught.value.diagnostic["observed_count"] == 720
    assert len(list((tmp_path / "frames").iterdir())) == 720


def test_legacy_frames_do_not_starve_final_deliverables(tmp_path):
    git = GitBackend()
    git.init_repository(tmp_path)
    _files(tmp_path / "a-frames", 720)
    finals = tmp_path / "z-final"
    finals.mkdir()
    for name in ("movie.mp4", "scene.blend"):
        (finals / name).write_bytes(b"fixture")
    result = _scan(tmp_path)
    paths = {item["relativePath"] for item in result.artifacts}
    assert {"z-final/movie.mp4", "z-final/scene.blend"} <= paths
    assert len(result.artifacts) == 500
    assert result.truncated and result.scan_status == "partial"
    assert len(list((tmp_path / "a-frames").iterdir())) == 720


def test_pre_dispatch_overflow_retry_preserves_user_files(tmp_path, journal):
    root, mutations, git = _direct(tmp_path, journal)
    _files(root / "user-content", 501)
    head = git.current_head(root)
    with pytest.raises(WorkspaceDeltaLimitExceeded) as caught:
        mutations.prepare_broad_write(
            context=_context(root),
            operation_request_id="pre-1",
            actor_id="agent",
            trigger="terminal.execute",
        )
    assert caught.value.diagnostic["phase"] == "pre_dispatch"
    assert journal.list_git_mutation_intents(statuses=("prepared",)) == []
    assert git.current_head(root) == head
    # Explicit reviewed checkpoint, using the already existing <=500-path API.
    repository = journal.get_space_git_repository(space_id="space-1")
    paths = tuple(sorted((root / "user-content").iterdir())[:500])
    mutations.content.checkpoint(
        repository.repository_id,
        operation_request_id="user-review",
        expected_repo_state_digest=git.repo_state_token(root).digest,
        paths=paths,
        path_sources={
            p.relative_to(root).as_posix(): "user_selected" for p in paths
        },
        target_role="user",
        target_id="project-1",
        actor_id="user",
        trigger="workspace.preimage",
        message="Reviewed user files",
    )
    prepared = mutations.prepare_broad_write(
        context=_context(root),
        operation_request_id="pre-2",
        actor_id="agent",
        trigger="terminal.execute",
    )
    assert prepared is not None
    assert len(list((root / "user-content").iterdir())) == 501


def test_post_dispatch_overflow_recovers_capture_after_review(
    tmp_path, journal
):
    root, mutations, git = _direct(tmp_path, journal)
    prepared = mutations.prepare_broad_write(
        context=_context(root),
        operation_request_id="post-1",
        actor_id="agent",
        trigger="terminal.execute",
    )
    _files(root / "outputs", 501)
    with pytest.raises(WorkspaceDeltaLimitExceeded):
        mutations.complete_broad_write(
            prepared,
            operation_request_id="post-1",
            actor_id="agent",
            trigger="terminal.execute",
        )
    from app.run_policy import ToolSafetyClass

    for status in ("prepared", "dispatched", "outcome_unknown"):
        journal.checkpoint_tool_call(
            tool_call_id="original-write",
            run_id="run-1",
            attempt_id=None,
            tool_name="shell_exec",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            status=status,
            request={"command": "original operation"},
            outcome="outcome_unknown" if status == "outcome_unknown" else None,
        )
    assert journal.list_git_mutation_intents(statuses=("prepared",))
    paths = tuple(sorted((root / "outputs").iterdir())[:500])
    mutations.content.checkpoint(
        prepared.change_set.repository_id,
        operation_request_id="post-review",
        expected_repo_state_digest=git.repo_state_token(root).digest,
        paths=paths,
        path_sources={
            p.relative_to(root).as_posix(): "user_selected" for p in paths
        },
        target_role="run",
        target_id="run-1",
        actor_id="user",
        trigger="workspace.recovery",
        message="Reviewed generated files",
        worktree_root=root,
    )
    commits = mutations.retry_broad_write_checkpoint(
        prepared, expected_repo_state_digest=git.repo_state_token(root).digest
    )
    assert commits
    assert not journal.list_git_mutation_intents(statuses=("prepared",))
    assert git.worktree_status(root) == {}
    assert len(list((root / "outputs").iterdir())) == 501
    assert any(
        e.event_type == "workspace.path_budget.capture_recovered"
        for e in journal.list_events("run-1")
    )
    assert not any(
        e.event_type == "run.completed" for e in journal.list_events("run-1")
    )
    assert journal.list_tool_calls("run-1")[0].status == "outcome_unknown"


def test_post_overflow_ignore_change_cannot_fake_recovery(tmp_path, journal):
    root, mutations, git = _direct(tmp_path, journal)
    prepared = mutations.prepare_broad_write(
        context=_context(root),
        operation_request_id="post-1",
        actor_id="agent",
        trigger="terminal.execute",
    )
    _files(root / "outputs", 501)
    with pytest.raises(WorkspaceDeltaLimitExceeded):
        mutations.complete_broad_write(
            prepared,
            operation_request_id="post-1",
            actor_id="agent",
            trigger="terminal.execute",
        )
    (root / ".gitignore").write_text("outputs/\n")
    with pytest.raises(ContentRepositoryError, match="uncheckpointed"):
        mutations.retry_broad_write_checkpoint(
            prepared,
            expected_repo_state_digest=git.repo_state_token(root).digest,
        )
    assert journal.list_git_mutation_intents(statuses=("prepared",))
