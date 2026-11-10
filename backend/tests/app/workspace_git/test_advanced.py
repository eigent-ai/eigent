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

import pytest

from app.run_journal import IdempotencyConflictError, SQLiteRunJournal
from app.workspace_git import (
    AdvancedGitApprovalRequired,
    AdvancedGitCommandClassifier,
    AdvancedGitCommandRejected,
    AdvancedGitOutcomeUnknown,
    AdvancedGitService,
    ContentRepositoryService,
    GitBackend,
    GitBackendError,
    GitCommandTimeoutError,
    RepositoryStateChangedError,
)
from app.workspace_git.publish_policy import (
    GitPublishPolicy,
    GitPublishPolicyError,
)


@pytest.fixture
def advanced_git(tmp_path: Path):
    root = tmp_path / "space"
    root.mkdir()
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    backend = GitBackend(hooks_path=hooks)
    content = ContentRepositoryService(
        journal,
        state_root=tmp_path / "state",
        git_backend=backend,
    )
    bootstrapped = content.bootstrap(
        space_id="space-1",
        space_root=root,
        allow_init=True,
        eigent_owned_space=False,
    )
    service = AdvancedGitService(
        journal,
        content=content,
        git_backend=backend,
    )
    try:
        yield service, journal, backend, content, bootstrapped.repository, root
    finally:
        journal.close()


@pytest.mark.parametrize(
    ("argv", "operation"),
    [
        (("status", "--short"), "git.read"),
        (("branch", "--list"), "git.read"),
        (("commit", "--allow-empty", "-m", "checkpoint"), "git.local_write"),
        (("add", "--", "report.md"), "git.local_write"),
        (("merge", "topic"), "git.integrate"),
        (("reset", "HEAD~1"), "git.history_rewrite"),
        (("clean", "-fd"), "git.destructive"),
        (("fetch", "origin"), "git.remote_read"),
        (("push", "origin", "HEAD"), "git.remote_write"),
        (
            ("remote", "add", "origin", "https://example.com/a.git"),
            "git.config_sensitive",
        ),
    ],
)
def test_advanced_git_grammar_classifies_known_commands(argv, operation):
    assert AdvancedGitCommandClassifier().classify(argv).operation == operation


@pytest.mark.parametrize(
    "argv",
    (
        ("checkout", "-f", "main"),
        ("switch", "main"),
        ("branch", "-f", "topic", "HEAD~1"),
        ("tag", "-f", "v1", "HEAD~1"),
    ),
)
def test_worktree_and_ref_overwrites_are_destructive_and_confirmed(argv):
    classification = AdvancedGitCommandClassifier().classify(argv)

    assert classification.operation == "git.destructive"
    assert classification.always_confirm is True


def test_switch_create_branch_reaches_human_confirmation():
    classification = AdvancedGitCommandClassifier().classify(
        ("switch", "-c", "agent/research")
    )

    assert classification.operation == "git.destructive"
    assert classification.always_confirm is True


def test_git_config_list_is_read_only_but_external_config_files_are_rejected():
    classifier = AdvancedGitCommandClassifier()

    assert classifier.classify(("config", "--list")).operation == "git.read"
    with pytest.raises(AdvancedGitCommandRejected):
        classifier.classify(
            ("config", "--file", "../../.zshenv", "core.dummy", "x")
        )
    with pytest.raises(AdvancedGitCommandRejected):
        classifier.classify(("config", "-f", "../../.gitconfig", "--list"))
    with pytest.raises(AdvancedGitCommandRejected):
        classifier.classify(("config", "-f../../.gitconfig", "--list"))


@pytest.mark.parametrize(
    ("argv", "operation"),
    [
        (("merge", "--log=5", "topic"), "git.integrate"),
        (("fetch", "--no-write-fetch-head", "origin"), "git.remote_read"),
        (("fetch", "--unshallow", "origin"), "git.remote_read"),
        (("fetch", "--filter=blob:none", "origin"), "git.remote_read"),
        (("fetch", "--set-upstream", "origin"), "git.remote_read"),
        (("commit", "--verbose", "-m", "checkpoint"), "git.local_write"),
        (("commit", "-s", "-m", "checkpoint"), "git.local_write"),
        (("commit", "--signoff", "-m", "checkpoint"), "git.local_write"),
        (("commit", "--no-edit"), "git.local_write"),
    ],
)
def test_advanced_git_allowlists_cover_supported_complete_option_spellings(
    argv, operation
):
    assert AdvancedGitCommandClassifier().classify(argv).operation == operation


@pytest.mark.parametrize("command", ("fetch", "ls-remote"))
@pytest.mark.parametrize(
    "option",
    (
        "--exec=/tmp/evil.sh",
        "--exe=/tmp/evil.sh",
        "--upload-pack=/tmp/evil.sh",
        "--receive-pack=/tmp/evil.sh",
    ),
)
def test_remote_read_rejects_every_external_program_option(command, option):
    with pytest.raises(AdvancedGitCommandRejected) as rejected:
        AdvancedGitCommandClassifier().classify((command, "origin", option))

    assert rejected.value.reason_code == "git_external_program_option"
    assert rejected.value.human_interaction_required is True


@pytest.mark.parametrize(
    "argv",
    (
        ("commit", "--am", "-m", "checkpoint"),
        ("commit", "--ver", "-m", "checkpoint"),
        ("fetch", "--no-write", "origin"),
        ("merge", "--no-ver", "topic"),
        ("rebase", "--no-up", "main"),
        ("reset", "--har", "HEAD~1"),
        ("cherry-pick", "--no-com", "HEAD"),
        ("revert", "--no-com", "HEAD"),
    ),
)
def test_advanced_git_rejects_abbreviated_options(argv):
    with pytest.raises(AdvancedGitCommandRejected):
        AdvancedGitCommandClassifier().classify(argv)


def test_non_signing_gpg_format_option_is_not_treated_as_a_signer():
    classification = AdvancedGitCommandClassifier().classify(
        ("tag", "--gpg-format=openpgp", "v1.0.0")
    )

    assert classification.operation == "git.local_write"


def test_rejected_advanced_git_preview_is_durable_structured_audit(
    advanced_git,
):
    service, journal, _, _, repository, _ = advanced_git

    with pytest.raises(AdvancedGitCommandRejected) as rejected:
        service.preview(
            space_id="space-1",
            repository_id=repository.repository_id,
            argv=("rebase", "--exec=touch /tmp/pwn", "main"),
            operation_request_id="model-rejected-1",
        )

    assert rejected.value.reason_code == "advanced_git_policy_rejected"
    assert "preview" in rejected.value.remediation.lower()
    row = journal._connection.execute(
        "SELECT * FROM security_audit_events WHERE event_type = ?",
        ("git.advanced.rejected",),
    ).fetchone()
    assert row is not None
    assert row["actor_type"] == "model"
    assert "--exec" not in row["details_json"]


@pytest.mark.parametrize(
    "argv",
    [
        ("push", "--force", "origin", "HEAD"),
        ("push", "origin", "+HEAD:main"),
        ("push", "--all", "origin"),
        ("push", "origin", "main"),
        ("push", "https://example.com/repo.git", "HEAD"),
        ("pull", "origin", "main"),
        ("submodule", "update", "--init"),
        ("clone", "https://example.com/repo.git"),
        ("status", "--git-dir=/tmp/other"),
        ("remote", "add", "origin", "file:///tmp/repo"),
        ("remote", "add", "origin", "https://secret:token@example.com/a.git"),
        ("config", "credential.helper", "store"),
        ("add", "-A"),
        ("add", "--", "."),
        ("worktree", "add", "/tmp/other", "HEAD"),
        ("fetch", "/tmp/other"),
        ("diff", "--output=/tmp/leak", "HEAD"),
        ("show", "--ext-diff", "HEAD"),
        ("log", "--show-signature"),
        ("cat-file", "--filters", "HEAD:README.md"),
        ("rebase", "--exec=touch /tmp/pwn", "main"),
        ("rebase", "--exe=touch /tmp/pwn", "main"),
        ("fetch", "--upload-pa=touch /tmp/pwn", "origin"),
        ("fetch", "--upload=touch /tmp/pwn", "origin"),
        ("merge", "--strategy=evil", "topic"),
        ("commit", "-SDEADBEEF", "-m", "signed"),
        ("commit", "--gpg-sig=DEADBEEF", "-m", "signed"),
        ("commit", "--gpg=DEADBEEF", "-m", "signed"),
        ("tag", "-s", "v1.0.0"),
        ("filter-branch", "--tree-filter", "touch /tmp/pwn"),
        ("stash", "push"),
        ("config", "core.sshCommand", "sh -c pwn"),
        ("config", "alias.pwn", "!touch /tmp/pwn"),
        ("config", "commit.gpgSign", "true"),
        ("config", "core.worktree", "/tmp/other"),
        ("not-a-git-command",),
    ],
)
def test_advanced_git_grammar_fails_closed(argv):
    with pytest.raises(AdvancedGitCommandRejected):
        AdvancedGitCommandClassifier().classify(argv)


def test_mutation_requires_exact_confirmation_and_is_idempotent(advanced_git):
    service, journal, backend, _, repository, root = advanced_git
    argv = ("commit", "--allow-empty", "-m", "Phase 6 checkpoint")
    request_id = "advanced-commit-1"
    preview = service.preview(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=argv,
        operation_request_id=request_id,
    )
    assert preview.requires_confirmation is True
    assert "Phase 6 checkpoint" in preview.display_argv
    expected = backend.repo_state_token(root).digest

    with pytest.raises(AdvancedGitApprovalRequired) as approval:
        service.execute(
            space_id="space-1",
            repository_id=repository.repository_id,
            argv=argv,
            operation_request_id=request_id,
            expected_repo_state_digest=expected,
            confirmed_action_digest=None,
            actor_id="user-1",
        )
    assert approval.value.action_digest == preview.action_digest

    result = service.execute(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=argv,
        operation_request_id=request_id,
        expected_repo_state_digest=expected,
        confirmed_action_digest=preview.action_digest,
        actor_id="user-1",
    )
    assert result["returncode"] == 0
    assert result["replayed"] is False
    assert result["head_oid"] == backend.current_head(root)

    replayed = service.execute(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=argv,
        operation_request_id=request_id,
        expected_repo_state_digest=expected,
        confirmed_action_digest=preview.action_digest,
        actor_id="user-1",
    )
    assert replayed["replayed"] is True
    operations = journal.list_git_operations()
    assert len(operations) == 1
    assert operations[0].status == "completed"


def test_mutation_cas_and_request_payload_conflict_fail_closed(advanced_git):
    service, journal, backend, _, repository, root = advanced_git
    stale = backend.repo_state_token(root).digest
    first_argv = ("commit", "--allow-empty", "-m", "first")
    first = service.preview(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=first_argv,
        operation_request_id="first",
    )
    service.execute(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=first_argv,
        operation_request_id="first",
        expected_repo_state_digest=stale,
        confirmed_action_digest=first.action_digest,
        actor_id="user-1",
    )

    second_argv = ("commit", "--allow-empty", "-m", "second")
    second = service.preview(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=second_argv,
        operation_request_id="second",
    )
    with pytest.raises(RepositoryStateChangedError):
        service.execute(
            space_id="space-1",
            repository_id=repository.repository_id,
            argv=second_argv,
            operation_request_id="second",
            expected_repo_state_digest=stale,
            confirmed_action_digest=second.action_digest,
            actor_id="user-1",
        )
    assert journal.list_git_operations()[-1].status == "failed"

    changed_argv = ("commit", "--allow-empty", "-m", "changed")
    changed = service.preview(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=changed_argv,
        operation_request_id="first",
    )
    with pytest.raises(IdempotencyConflictError):
        service.execute(
            space_id="space-1",
            repository_id=repository.repository_id,
            argv=changed_argv,
            operation_request_id="first",
            expected_repo_state_digest=stale,
            confirmed_action_digest=changed.action_digest,
            actor_id="user-1",
        )


def test_remote_timeout_becomes_outcome_unknown_and_never_replays(
    advanced_git, monkeypatch
):
    service, journal, backend, _, repository, root = advanced_git
    argv = ("fetch", "origin")
    preview = service.preview(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=argv,
        operation_request_id="fetch-1",
    )

    def timeout(_root, _argv, **_kwargs):
        raise GitCommandTimeoutError(args=argv, timeout_seconds=1)

    monkeypatch.setattr(backend, "run_advanced_argv", timeout)
    kwargs = {
        "space_id": "space-1",
        "repository_id": repository.repository_id,
        "argv": argv,
        "operation_request_id": "fetch-1",
        "expected_repo_state_digest": backend.repo_state_token(root).digest,
        "confirmed_action_digest": preview.action_digest,
        "actor_id": "user-1",
    }
    with pytest.raises(AdvancedGitOutcomeUnknown):
        service.execute(**kwargs)
    assert journal.list_git_operations()[-1].status == "outcome_unknown"
    with pytest.raises(AdvancedGitOutcomeUnknown):
        service.execute(**kwargs)


def test_history_is_metadata_only_and_declares_conservative_retention(
    advanced_git, monkeypatch
):
    service, journal, backend, _, repository, root = advanced_git
    expected = backend.repo_state_token(root).digest
    argv = ("commit", "--allow-empty", "-m", "history subject")
    preview = service.preview(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=argv,
        operation_request_id="history-seed",
    )
    service.execute(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=argv,
        operation_request_id="history-seed",
        expected_repo_state_digest=expected,
        confirmed_action_digest=preview.action_digest,
        actor_id="user-1",
    )
    backend.run_advanced_argv(root, ("branch", "eigent/project/project-1"))
    monkeypatch.setattr(
        journal,
        "list_project_git_states",
        lambda: [
            SimpleNamespace(
                repository_id=repository.repository_id,
                integration_ref="refs/heads/eigent/project/project-1",
                project_id="project-1",
            )
        ],
    )

    history = service.history(repository_id=repository.repository_id)

    assert history["commits"][0]["subject"] == "history subject"
    assert history["commits"][0]["kind"] == "commit"
    assert history["commits"][0]["initiated_by"] == "user"
    assert history["branches"][0]["ref"].startswith("refs/heads/")
    project_branch = next(
        branch
        for branch in history["branches"]
        if branch["ref"] == "refs/heads/eigent/project/project-1"
    )
    assert project_branch["project_id"] == "project-1"
    assert history["retention_policy"]["automatic_object_gc"] is False
    assert (
        history["retention_policy"]["automatic_archive_ref_deletion"] is False
    )
    assert history["backup"]["configured"] is False


def test_history_uses_checkpoint_provenance_for_strict_initiator_labels(
    advanced_git,
):
    service, _, backend, content, repository, root = advanced_git
    report = root / "report.md"
    report.write_text("user save\n", encoding="utf-8")
    user_checkpoint = content.checkpoint(
        repository.repository_id,
        operation_request_id="user-save",
        expected_repo_state_digest=backend.repo_state_token(root).digest,
        paths=(report,),
        path_sources={"report.md": "user_selected"},
        target_role="user",
        target_id="space-1",
        actor_id="user-1",
        trigger="user.save_point",
        message="Save progress",
    )
    report.write_text("agent update\n", encoding="utf-8")
    agent_checkpoint = content.checkpoint(
        repository.repository_id,
        operation_request_id="agent-checkpoint",
        expected_repo_state_digest=backend.repo_state_token(root).digest,
        paths=(report,),
        path_sources={"report.md": "agent_modified"},
        target_role="user",
        target_id="space-1",
        actor_id="Agents.single_agent",
        trigger="terminal.execute",
        message="Checkpoint bounded workspace process delta",
    )

    history = service.history(repository_id=repository.repository_id)
    commits = {commit["oid"]: commit for commit in history["commits"]}

    assert commits[user_checkpoint.commit_oid]["kind"] == "save_point"
    assert commits[user_checkpoint.commit_oid]["initiated_by"] == "user"
    assert commits[user_checkpoint.commit_oid]["actor_id"] == "user-1"
    assert commits[agent_checkpoint.commit_oid]["kind"] == "checkpoint"
    assert commits[agent_checkpoint.commit_oid]["initiated_by"] == "agent"
    assert (
        commits[agent_checkpoint.commit_oid]["actor_id"]
        == "Agents.single_agent"
    )


def test_history_includes_completed_user_pushes(advanced_git):
    service, journal, backend, _, repository, root = advanced_git
    state = backend.repo_state_token(root)
    operation = journal.begin_git_operation(
        operation_id="gitop_user_push",
        repository_id=repository.repository_id,
        request_id="user-push",
        operation_type="advanced.git.remote_write",
        payload_digest="a" * 64,
        expected_repo_state_digest=state.digest,
    )
    journal.mark_git_operation_dispatched(
        operation.operation_id,
        observed_repo_state_digest=state.digest,
    )
    journal.complete_git_operation(
        operation.operation_id,
        result={
            "subcommand": "push",
            "head_oid": state.head_oid,
            "publish_scan": {
                "head_oid": state.head_oid,
                "remote_name": "origin",
            },
        },
        observed_repo_state_digest=state.digest,
    )

    history = service.history(repository_id=repository.repository_id)

    assert history["operations"] == [
        {
            "operation_id": "gitop_user_push",
            "kind": "push",
            "initiated_by": "user",
            "occurred_at": int(
                journal.get_git_operation("gitop_user_push").updated_at
            ),
            "head_oid": state.head_oid,
            "remote_name": "origin",
        }
    ]


def test_advanced_output_is_bounded_while_process_is_drained(tmp_path: Path):
    root = tmp_path / "repo"
    root.mkdir()
    (root / ("x" * 120)).write_text("value", encoding="utf-8")
    GitBackend().init_repository(root)
    backend = GitBackend(max_output_chars=32)

    result = backend.run_advanced_argv(
        root,
        ("status", "--porcelain=v1", "--untracked-files=all"),
    )

    assert len(result.stdout.encode("utf-8")) <= 32
    assert result.stdout_truncated is True


def test_advanced_environment_drops_process_execution_overrides(
    monkeypatch,
):
    monkeypatch.setenv("GIT_SSH_COMMAND", "touch /tmp/pwn")
    monkeypatch.setenv("GIT_EXTERNAL_DIFF", "touch /tmp/pwn")
    monkeypatch.setenv("GIT_EDITOR", "touch /tmp/pwn")
    environment = GitBackend()._environment()

    assert environment["GIT_EDITOR"] == "true"
    assert environment["GIT_PAGER"] == "cat"
    assert environment["GIT_SEQUENCE_EDITOR"] == "true"
    assert "GIT_SSH_COMMAND" not in environment
    assert "GIT_EXTERNAL_DIFF" not in environment


def test_advanced_add_rejects_clean_filter_before_dispatch(
    advanced_git,
    tmp_path: Path,
):
    service, journal, backend, _, repository, root = advanced_git
    marker = tmp_path / "filter-executed"
    (root / ".gitattributes").write_text(
        "danger.txt filter=pwn\n",
        encoding="utf-8",
    )
    (root / "danger.txt").write_text("secret", encoding="utf-8")
    backend.run_advanced_argv(
        root,
        ("config", "filter.pwn.clean", f"touch {marker}"),
    )
    argv = ("add", "--", "danger.txt")
    preview = service.preview(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=argv,
        operation_request_id="unsafe-filter-add",
    )

    with pytest.raises(GitBackendError, match="clean filter"):
        service.execute(
            space_id="space-1",
            repository_id=repository.repository_id,
            argv=argv,
            operation_request_id="unsafe-filter-add",
            expected_repo_state_digest=backend.repo_state_token(root).digest,
            confirmed_action_digest=preview.action_digest,
            actor_id="user-1",
        )

    assert not marker.exists()
    assert journal.list_git_operations()[-1].status == "failed"


def test_publish_policy_scans_outgoing_history_without_retaining_secret(
    advanced_git,
):
    _, _, backend, _, _, root = advanced_git
    secret = "sk_live_" + "A" * 24
    credential = root / "credentials.txt"
    credential.write_text(f"token={secret}\n", encoding="utf-8")
    backend.commit_paths(
        root,
        (credential,),
        message="Accidental credential",
        author_name="Test User",
        author_email="test@example.com",
    )
    credential.unlink()
    backend.commit_paths(
        root,
        (credential,),
        message="Remove credential",
        author_name="Test User",
        author_email="test@example.com",
    )

    with pytest.raises(GitPublishPolicyError) as rejected:
        GitPublishPolicy(backend).scan_head(root, remote_name="origin")

    assert "stripe_secret" in str(rejected.value)
    assert secret not in str(rejected.value)


def test_publish_policy_comment_does_not_suppress_real_secret():
    secret = "AKIA" + "A1B2C3D4E5F6G7H8"
    assert (
        GitPublishPolicy._secret_type(
            f"AWS_ACCESS_KEY_ID={secret}  # sample config"
        )
        == "aws_access_key"
    )
    assert (
        GitPublishPolicy._secret_type('password="sample-placeholder"') is None
    )


def test_publish_policy_checks_later_secret_after_same_pattern_placeholder():
    placeholder = "AKIAEXAMPLEEXAMPLE12"
    secret = "AKIAQ1W2E3R4T5Y6U7I8"

    assert (
        GitPublishPolicy._secret_type(
            f'example="{placeholder}" production="{secret}"'
        )
        == "aws_access_key"
    )


def test_publish_policy_allows_documented_placeholder_credential_url():
    value = "# Example: postgres://user:pass@localhost:5432/app"

    assert GitPublishPolicy._secret_type(value) is None


def test_publish_policy_still_rejects_real_credential_url():
    value = "DATABASE_URL=postgres://admin:real-production-secret@db/app"

    assert GitPublishPolicy._secret_type(value) == "credential_url"


def test_publish_policy_returns_bounded_metadata_for_clean_history(
    advanced_git,
):
    _, _, backend, _, _, root = advanced_git
    report = root / "report.md"
    report.write_text("safe report\n", encoding="utf-8")
    head = backend.commit_paths(
        root,
        (report,),
        message="Clean report",
        author_name="Test User",
        author_email="test@example.com",
    )

    result = GitPublishPolicy(backend).scan_head(
        root,
        remote_name="origin",
    )

    assert result.head_oid == head
    assert result.outgoing_blob_count == 1
    assert len(result.scan_digest) == 64


def test_advanced_push_fails_policy_before_network_dispatch(
    advanced_git,
):
    service, journal, backend, _, repository, root = advanced_git
    secret = "sk_live_" + "B" * 24
    credential = root / "credential.txt"
    credential.write_text(secret, encoding="utf-8")
    backend.commit_paths(
        root,
        (credential,),
        message="Unsafe publish candidate",
        author_name="Test User",
        author_email="test@example.com",
    )
    argv = ("push", "origin", "HEAD")
    preview = service.preview(
        space_id="space-1",
        repository_id=repository.repository_id,
        argv=argv,
        operation_request_id="push-secret",
    )

    with pytest.raises(GitPublishPolicyError):
        service.execute(
            space_id="space-1",
            repository_id=repository.repository_id,
            argv=argv,
            operation_request_id="push-secret",
            expected_repo_state_digest=backend.repo_state_token(root).digest,
            confirmed_action_digest=preview.action_digest,
            actor_id="user-1",
        )

    operation = journal.list_git_operations()[-1]
    assert operation.status == "failed"
    assert operation.error_code == "git_publish_policy_failed"
    assert secret not in (operation.error_message or "")
