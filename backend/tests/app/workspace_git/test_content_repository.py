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

from app.run_journal import IdempotencyConflictError, SQLiteRunJournal
from app.workspace_config import canonical_digest
from app.workspace_git import (
    ContentRepositoryConsentRequired,
    ContentRepositoryError,
    ContentRepositoryService,
    GitBackend,
    GitBackendError,
    NestedRepositoryError,
    RepositoryStateChangedError,
)


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def _service(tmp_path: Path, journal: SQLiteRunJournal):
    hooks = tmp_path / "empty-hooks"
    hooks.mkdir(exist_ok=True)
    backend = GitBackend(hooks_path=hooks)
    return (
        ContentRepositoryService(
            journal,
            state_root=tmp_path / "state",
            git_backend=backend,
        ),
        backend,
    )


def _git(repository: Path, *args: str, check: bool = True) -> str:
    completed = subprocess.run(
        ("git", "-C", str(repository), *args),
        check=check,
        capture_output=True,
        text=True,
        env={
            "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_TERMINAL_PROMPT": "0",
        },
    )
    return completed.stdout.strip()


def test_plain_folder_inspection_is_read_only_and_requires_consent(
    tmp_path,
    journal,
):
    space = tmp_path / "user-folder"
    space.mkdir()
    private = space / "private.txt"
    private.write_text("do not stage", encoding="utf-8")
    service, _ = _service(tmp_path, journal)

    inspection = service.inspect(space)

    assert inspection.enablement == "not_enabled"
    assert inspection.consent_required is True
    assert not (space / ".git").exists()
    assert private.read_text(encoding="utf-8") == "do not stage"
    assert journal.get_space_git_repository(space_id="space-1") is None


def test_user_folder_init_creates_empty_baseline_without_staging_files(
    tmp_path,
    journal,
):
    space = tmp_path / "user-folder"
    space.mkdir()
    private = space / "private.txt"
    private.write_text("do not stage", encoding="utf-8")
    service, _ = _service(tmp_path, journal)

    with pytest.raises(ContentRepositoryConsentRequired):
        service.bootstrap(
            space_id="space-1",
            space_root=space,
            allow_init=False,
        )
    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )

    assert result.initialized is True
    assert result.repository.ownership == "adopted"
    assert result.repository.version_coverage == "managed_files_only"
    assert _git(space, "status", "--porcelain") == "?? private.txt"
    head = _git(space, "rev-parse", "--verify", "HEAD")
    assert _git(space, "diff-tree", "--name-only", "-r", "--root", head) == ""


def test_eigent_owned_space_survives_bootstrap_retry_after_git_init(
    tmp_path, journal
):
    space = tmp_path / "blank-space"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    backend.init_repository(space)

    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=False,
        eigent_owned_space=True,
    )

    assert result.initialized is False
    assert result.repository.ownership == "eigent_owned"
    assert backend.current_head(space) is not None


def test_adopt_preserves_branch_remote_and_repository_config(
    tmp_path,
    journal,
):
    space = tmp_path / "repo"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    backend.init_repository(space, initial_branch="trunk")
    seed = space / "seed.txt"
    seed.write_text("seed", encoding="utf-8")
    backend.commit_paths(space, (seed,), message="seed")
    _git(space, "remote", "add", "origin", "https://example.invalid/repo")
    before_config = (space / ".git" / "config").read_bytes()

    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=False,
    )

    assert result.initialized is False
    assert result.repository.ownership == "adopted"
    assert result.probe.branch == "trunk"
    assert result.diagnostics.has_remotes is True
    assert (space / ".git" / "config").read_bytes() == before_config


def test_nested_repository_requires_explicit_parent_binding(
    tmp_path,
    journal,
):
    parent = tmp_path / "parent"
    parent.mkdir()
    child = parent / "child"
    child.mkdir()
    service, backend = _service(tmp_path, journal)
    backend.init_repository(parent)

    inspection = service.inspect(child)
    assert inspection.enablement == "nested_repository_requires_binding"
    with pytest.raises(NestedRepositoryError):
        service.bootstrap(
            space_id="space-1",
            space_root=child,
            allow_init=True,
            repo_subdir="child",
        )
    assert not (child / ".git").exists()


def test_checkpoint_commits_only_explicit_paths_and_preserves_user_index(
    tmp_path,
    journal,
):
    space = tmp_path / "repo"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    backend.init_repository(space)
    first = space / "first.txt"
    unrelated = space / "unrelated.txt"
    first.write_text("baseline", encoding="utf-8")
    unrelated.write_text("baseline", encoding="utf-8")
    backend.commit_paths(space, (first, unrelated), message="baseline")
    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=False,
    )

    first.write_text("agent edit", encoding="utf-8")
    unrelated.write_text("user staged edit", encoding="utf-8")
    _git(space, "add", "--", "unrelated.txt")
    expected = backend.repo_state_token(space)
    checkpoint = service.checkpoint(
        result.repository.repository_id,
        operation_request_id="checkpoint-1",
        expected_repo_state_digest=expected.digest,
        paths=(first,),
        path_sources={"first.txt": "agent_modified"},
        target_role="user",
        target_id="space-1",
        actor_id="user-1",
        trigger="user_save",
        message="Save progress",
    )
    replay = service.checkpoint(
        result.repository.repository_id,
        operation_request_id="checkpoint-1",
        expected_repo_state_digest=expected.digest,
        paths=(first,),
        path_sources={"first.txt": "agent_modified"},
        target_role="user",
        target_id="space-1",
        actor_id="user-1",
        trigger="user_save",
        message="Save progress",
    )

    assert checkpoint == replay
    assert checkpoint.paths == ("first.txt",)
    assert backend.show_commit_paths(space, checkpoint.commit_oid) == (
        "first.txt",
    )
    assert _git(space, "diff", "--cached", "--name-only") == ("unrelated.txt")
    assert journal.list_git_managed_paths(result.repository.repository_id) == (
        "first.txt",
    )

    with pytest.raises(IdempotencyConflictError):
        service.checkpoint(
            result.repository.repository_id,
            operation_request_id="checkpoint-1",
            expected_repo_state_digest=expected.digest,
            paths=(unrelated,),
            path_sources={"unrelated.txt": "user_selected"},
            target_role="user",
            target_id="space-1",
            actor_id="user-1",
            trigger="user_save",
            message="Different payload",
        )


def test_checkpoint_refuses_to_overwrite_selected_path_staging(
    tmp_path,
    journal,
):
    space = tmp_path / "repo"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    backend.init_repository(space)
    target = space / "report.md"
    target.write_text("baseline\n", encoding="utf-8")
    backend.commit_paths(space, (target,), message="baseline")
    head_before = backend.current_head(space)
    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=False,
    )
    target.write_text("user staged version\n", encoding="utf-8")
    _git(space, "add", "--", "report.md")
    staged_blob_before = _git(space, "rev-parse", ":report.md")
    target.write_text("working version\n", encoding="utf-8")
    expected = backend.repo_state_token(space)

    with pytest.raises(ContentRepositoryError, match="staged changes"):
        service.checkpoint(
            result.repository.repository_id,
            operation_request_id="checkpoint-staged-target",
            expected_repo_state_digest=expected.digest,
            paths=(target,),
            path_sources={"report.md": "user_selected"},
            target_role="user",
            target_id="space-1",
            actor_id="user-1",
            trigger="user_save",
            message="Save progress",
        )

    assert _git(space, "rev-parse", ":report.md") == staged_blob_before
    assert target.read_text(encoding="utf-8") == "working version\n"
    assert backend.current_head(space) == head_before


def test_checkpoint_repo_state_cas_rejects_external_change(
    tmp_path,
    journal,
):
    space = tmp_path / "repo"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "report.md"
    target.write_text("v1", encoding="utf-8")
    expected = backend.repo_state_token(space)
    (space / "external.txt").write_text("changed", encoding="utf-8")

    with pytest.raises(RepositoryStateChangedError):
        service.checkpoint(
            result.repository.repository_id,
            operation_request_id="checkpoint-cas",
            expected_repo_state_digest=expected.digest,
            paths=(target,),
            path_sources={"report.md": "agent_created"},
            target_role="user",
            target_id="space-1",
            actor_id="user-1",
            trigger="user_save",
            message="Save progress",
        )

    operation_id = (
        "gitop_"
        + canonical_digest(
            {
                "repository_id": result.repository.repository_id,
                "request_id": "checkpoint-cas",
            }
        )[:32]
    )
    assert journal.get_git_operation(operation_id).status == "failed"
    assert journal.get_git_operation(operation_id).error_code == (
        "repo_state_changed"
    )


def test_repository_state_recovers_after_transient_attention_state(
    tmp_path,
    journal,
):
    space = tmp_path / "repo"
    space.mkdir()
    service, _ = _service(tmp_path, journal)
    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    attention = journal.update_git_repository_state(
        result.repository.repository_id,
        state="needs_attention",
        expected_version=result.repository.version,
    )

    status = service.status(result.repository.repository_id)

    assert attention.state == "needs_attention"
    assert status.repository.state == "ready"
    assert status.repository.version == attention.version + 1


def test_checkpoint_recovery_closes_commit_before_journal_window(
    tmp_path,
    journal,
    monkeypatch,
):
    space = tmp_path / "repo"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "result.md"
    target.write_text("done", encoding="utf-8")
    expected = backend.repo_state_token(space)
    original = journal.complete_git_checkpoint

    def crash_before_journal(*_args, **_kwargs):
        raise RuntimeError("simulated crash after git commit")

    monkeypatch.setattr(
        journal, "complete_git_checkpoint", crash_before_journal
    )
    with pytest.raises(RuntimeError, match="simulated crash"):
        service.checkpoint(
            result.repository.repository_id,
            operation_request_id="checkpoint-crash",
            expected_repo_state_digest=expected.digest,
            paths=(target,),
            path_sources={"result.md": "agent_created"},
            target_role="user",
            target_id="space-1",
            actor_id="user-1",
            trigger="run_terminal",
            message="Run checkpoint",
        )
    monkeypatch.setattr(journal, "complete_git_checkpoint", original)

    recovered = service.checkpoint(
        result.repository.repository_id,
        operation_request_id="checkpoint-crash",
        expected_repo_state_digest=expected.digest,
        paths=(target,),
        path_sources={"result.md": "agent_created"},
        target_role="user",
        target_id="space-1",
        actor_id="user-1",
        trigger="run_terminal",
        message="Run checkpoint",
    )

    assert journal.get_git_operation(recovered.operation_id).status == (
        "completed"
    )
    assert (
        backend.find_commit_by_operation(space, recovered.operation_id)
        == recovered.commit_oid
    )


def test_checkpoint_rejects_repository_clean_filter_without_execution(
    tmp_path,
    journal,
):
    space = tmp_path / "repo"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    marker = tmp_path / "filter-executed"
    attributes = space / ".gitattributes"
    attributes.write_text("danger.txt filter=pwn\n", encoding="utf-8")
    danger = space / "danger.txt"
    danger.write_text("secret", encoding="utf-8")
    _git(
        space,
        "config",
        "filter.pwn.clean",
        f"touch {marker}",
    )
    expected = backend.repo_state_token(space)

    with pytest.raises(GitBackendError, match="clean filter"):
        service.checkpoint(
            result.repository.repository_id,
            operation_request_id="checkpoint-filter",
            expected_repo_state_digest=expected.digest,
            paths=(danger,),
            path_sources={"danger.txt": "agent_created"},
            target_role="user",
            target_id="space-1",
            actor_id="user-1",
            trigger="user_save",
            message="Unsafe filter test",
        )

    assert not marker.exists()


def test_restore_candidate_only_creates_private_ref(
    tmp_path,
    journal,
):
    space = tmp_path / "repo"
    space.mkdir()
    service, backend = _service(tmp_path, journal)
    result = service.bootstrap(
        space_id="space-1",
        space_root=space,
        allow_init=True,
    )
    target = space / "report.md"
    target.write_text("checkpoint", encoding="utf-8")
    checkpoint = service.checkpoint(
        result.repository.repository_id,
        operation_request_id="checkpoint-restore-source",
        expected_repo_state_digest=backend.repo_state_token(space).digest,
        paths=(target,),
        path_sources={"report.md": "agent_created"},
        target_role="user",
        target_id="space-1",
        actor_id="user-1",
        trigger="user_save",
        message="Restore source",
    )
    target.write_text("new working edit", encoding="utf-8")
    expected = backend.repo_state_token(space)
    head_before = backend.current_head(space)

    candidate = service.prepare_restore_candidate(
        checkpoint.checkpoint_id,
        operation_request_id="restore-1",
        expected_repo_state_digest=expected.digest,
    )
    replay = service.prepare_restore_candidate(
        checkpoint.checkpoint_id,
        operation_request_id="restore-1",
        expected_repo_state_digest=expected.digest,
    )

    assert candidate == replay
    assert backend.current_head(space) == head_before
    assert target.read_text(encoding="utf-8") == "new working edit"
    assert backend.ref_oid(space, candidate.ref_name) == checkpoint.commit_oid
