# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

"""Policy-gated Advanced Git argv grammar and durable execution gateway."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from app.permission_policy import (
    ActionDescriptor,
    PermissionPolicyService,
    PolicyEffect,
)
from app.run_journal import (
    SQLiteRunJournal,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.run_policy import ToolSafetyClass
from app.workspace_config import canonical_digest
from app.workspace_git.backend import (
    GitBackend,
    GitBackendError,
    GitCommandTimeoutError,
)
from app.workspace_git.content import (
    ContentRepositoryError,
    ContentRepositoryService,
    RepositoryStateChangedError,
)
from app.workspace_git.publish_policy import GitPublishPolicy
from app.workspace_git.retention import DEFAULT_GIT_RETENTION_POLICY

_MAX_ARGV_ITEMS = 128
_MAX_ARG_CHARS = 4096
_READ_COMMANDS = frozenset(
    {
        "blame",
        "cat-file",
        "describe",
        "diff",
        "for-each-ref",
        "log",
        "ls-files",
        "ls-tree",
        "reflog",
        "rev-list",
        "rev-parse",
        "shortlog",
        "show",
        "status",
    }
)
_LOCAL_WRITE_COMMANDS = frozenset({"add", "switch", "tag"})
_INTEGRATE_COMMANDS = frozenset({"cherry-pick", "merge", "revert"})
_HISTORY_REWRITE_COMMANDS = frozenset({"rebase", "reset"})
_DESTRUCTIVE_COMMANDS = frozenset({"clean", "gc", "prune"})
_REMOTE_READ_COMMANDS = frozenset({"fetch", "ls-remote"})
_REMOTE_READ_FLAG_OPTIONS: dict[str, frozenset[str]] = {
    "fetch": frozenset(
        {
            "--all",
            "--append",
            "--atomic",
            "--dry-run",
            "--force",
            "--keep",
            "--multiple",
            "--no-auto-gc",
            "--no-recurse-submodules",
            "--no-tags",
            "--porcelain",
            "--prune",
            "--prune-tags",
            "--quiet",
            "--recurse-submodules",
            "--show-forced-updates",
            "--tags",
            "--update-head-ok",
            "--verbose",
            "-a",
            "-f",
            "-j",
            "-k",
            "-m",
            "-n",
            "-p",
            "-q",
            "-t",
            "-v",
        }
    ),
    "ls-remote": frozenset(
        {
            "--exit-code",
            "--get-url",
            "--heads",
            "--quiet",
            "--refs",
            "--symref",
            "--tags",
            "-h",
            "-q",
            "-t",
        }
    ),
}
_REMOTE_READ_VALUE_OPTIONS: dict[str, frozenset[str]] = {
    "fetch": frozenset(
        {
            "--depth",
            "--deepen",
            "--jobs",
            "--negotiation-tip",
            "--recurse-submodules",
            "--refmap",
            "--server-option",
            "--shallow-exclude",
            "--shallow-since",
            "--submodule-prefix",
        }
    ),
    "ls-remote": frozenset({"--server-option", "--sort"}),
}
_COMMIT_FLAG_OPTIONS = frozenset(
    {
        "--allow-empty",
        "--allow-empty-message",
        "--dry-run",
        "--no-post-rewrite",
        "--no-verify",
        "--quiet",
        "--reset-author",
        "--short",
        "--status",
        "-n",
        "-q",
    }
)
_COMMIT_VALUE_OPTIONS = frozenset(
    {
        "--author",
        "--cleanup",
        "--date",
        "--file",
        "--fixup",
        "--message",
        "--pathspec-from-file",
        "--reuse-message",
        "--squash",
        "-C",
        "-F",
        "-c",
        "-m",
    }
)
_PROHIBITED_GLOBAL_PREFIXES = (
    "-c",
    "--config-env",
    "--exec-path",
    "--git-dir",
    "--namespace",
    "--super-prefix",
    "--work-tree",
)
_SENSITIVE_CONFIG_FRAGMENTS = (
    "credential.",
    "alias.",
    "core.askpass",
    "core.attributesfile",
    "core.editor",
    "core.gitproxy",
    "core.fsmonitor",
    "core.hookspath",
    "core.pager",
    "core.sshcommand",
    "core.worktree",
    "core.bare",
    "commit.gpgsign",
    "diff.",
    "filter.",
    "http.",
    "include.",
    "interactive.",
    "gpg.",
    "merge.",
    "protocol.",
    "remote.",
    "sequence.editor",
    "tag.gpgsign",
    "user.signingkey",
    "url.",
    "extensions.",
)
_READ_EXECUTION_OPTIONS = (
    "--ext-diff",
    "--filters",
    "--output",
    "--show-signature",
    "--textconv",
)
_EXECUTABLE_OPERATION_OPTIONS = (
    "--exec",
    "--strategy",
    "--strategy-option",
    "--upload-pack",
    "--receive-pack",
)
_MUTATING_FLAG_OPTIONS: dict[str, frozenset[str]] = {
    "merge": frozenset(
        {
            "--abort",
            "--autostash",
            "--commit",
            "--continue",
            "--edit",
            "--ff",
            "--ff-only",
            "--no-autostash",
            "--no-commit",
            "--no-edit",
            "--no-ff",
            "--no-log",
            "--no-squash",
            "--no-stat",
            "--no-verify",
            "--no-verify-signatures",
            "--quit",
            "--squash",
            "--stat",
            "--verify",
            "--verify-signatures",
        }
    ),
    "cherry-pick": frozenset(
        {
            "-e",
            "-n",
            "-s",
            "-x",
            "--abort",
            "--continue",
            "--edit",
            "--ff",
            "--no-commit",
            "--no-rerere-autoupdate",
            "--quit",
            "--rerere-autoupdate",
            "--signoff",
        }
    ),
    "revert": frozenset(
        {
            "-e",
            "-n",
            "-s",
            "--abort",
            "--continue",
            "--edit",
            "--no-commit",
            "--no-rerere-autoupdate",
            "--quit",
            "--rerere-autoupdate",
            "--signoff",
        }
    ),
    "rebase": frozenset(
        {
            "-m",
            "--abort",
            "--apply",
            "--autostash",
            "--continue",
            "--fork-point",
            "--keep-base",
            "--keep-empty",
            "--merge",
            "--no-autostash",
            "--no-fork-point",
            "--no-keep-base",
            "--no-keep-empty",
            "--no-rerere-autoupdate",
            "--no-stat",
            "--no-update-refs",
            "--no-verify",
            "--quit",
            "--rerere-autoupdate",
            "--root",
            "--skip",
            "--stat",
            "--update-refs",
            "--verify",
        }
    ),
    "reset": frozenset(
        {
            "-N",
            "-q",
            "--hard",
            "--keep",
            "--merge",
            "--mixed",
            "--no-recurse-submodules",
            "--no-refresh",
            "--quiet",
            "--recurse-submodules",
            "--refresh",
            "--soft",
        }
    ),
}
_MUTATING_VALUE_OPTIONS: dict[str, frozenset[str]] = {
    "merge": frozenset({"-m", "--message"}),
    "cherry-pick": frozenset({"-m", "--mainline", "--cleanup", "--empty"}),
    "revert": frozenset({"-m", "--mainline", "--cleanup"}),
    "rebase": frozenset({"--empty", "--onto"}),
    "reset": frozenset(),
}
_URL_WITH_CREDENTIALS = re.compile(
    r"\b[a-z][a-z0-9+.-]*://[^\s/@]+:[^\s/@]+@", re.I
)
_URL_USERINFO = re.compile(r"(\b[a-z][a-z0-9+.-]*://)[^\s/@]+@", re.I)


class AdvancedGitError(RuntimeError):
    code = "advanced_git_error"


class AdvancedGitCommandRejected(AdvancedGitError):
    code = "advanced_git_command_rejected"


class AdvancedGitApprovalRequired(AdvancedGitError):
    code = "advanced_git_approval_required"

    def __init__(self, message: str, *, action_digest: str) -> None:
        self.action_digest = action_digest
        super().__init__(message)


class AdvancedGitOutcomeUnknown(AdvancedGitError):
    code = "advanced_git_outcome_unknown"


@dataclass(frozen=True)
class AdvancedGitClassification:
    operation: str
    safety_class: ToolSafetyClass
    subcommand: str
    external_side_effect: bool
    risk_tags: tuple[str, ...] = ()
    always_confirm: bool = False


@dataclass(frozen=True)
class AdvancedGitPreview:
    classification: AdvancedGitClassification
    action_digest: str
    effect: PolicyEffect
    reason: str
    display_argv: tuple[str, ...]

    @property
    def requires_confirmation(self) -> bool:
        return (
            self.classification.always_confirm
            or self.effect is PolicyEffect.PROMPT
        )


class AdvancedGitCommandClassifier:
    """Strict grammar: unknown and ambiguous commands fail closed."""

    def classify(self, argv: tuple[str, ...]) -> AdvancedGitClassification:
        self._validate_argv(argv)
        command = argv[0].lower()
        lowered = tuple(value.lower() for value in argv[1:])
        self._reject_sensitive_transport(argv)

        if command in _READ_COMMANDS:
            self._reject_options(argv, _READ_EXECUTION_OPTIONS)
            return self._classification("git.read", command)
        if command == "branch":
            branch_mutations = {"-d", "-D", "--delete", "--move", "-m", "-M"}
            if any(value in branch_mutations for value in argv[1:]):
                operation = (
                    "git.destructive"
                    if any(value in {"-D", "-M"} for value in argv[1:])
                    else "git.local_write"
                )
                return self._classification(
                    operation,
                    command,
                    always_confirm=True,
                )
            options = tuple(
                value for value in argv[1:] if value.startswith("-")
            )
            operands = tuple(
                value for value in argv[1:] if not value.startswith("-")
            )
            if operands and not any(
                value in {"--list", "-l", "--show-current"}
                for value in options
            ):
                return self._classification("git.local_write", command)
            return self._classification("git.read", command)
        if command == "commit":
            self._validate_exact_options(
                argv,
                command="commit",
                flags=_COMMIT_FLAG_OPTIONS,
                value_options=_COMMIT_VALUE_OPTIONS,
            )
            self._reject_signing(argv, tag_mode=False)
            if "--amend" in lowered:
                return self._classification(
                    "git.history_rewrite",
                    command,
                    always_confirm=True,
                )
            if any(value in {"-a", "--all"} for value in lowered):
                raise AdvancedGitCommandRejected(
                    "broad commit staging is disabled; checkpoint explicit paths"
                )
            return self._classification("git.local_write", command)
        if command == "checkout":
            if "--" in argv:
                raise AdvancedGitCommandRejected(
                    "advanced checkout cannot restore paths; use typed restore"
                )
            return self._classification("git.local_write", command)
        if command in _LOCAL_WRITE_COMMANDS:
            if command == "add":
                self._validate_explicit_add_paths(argv)
            if command == "tag":
                self._reject_signing(argv, tag_mode=True)
            if command == "tag" and any(
                value in {"-d", "--delete"} for value in argv[1:]
            ):
                return self._classification(
                    "git.destructive",
                    command,
                    always_confirm=True,
                )
            return self._classification("git.local_write", command)
        if command in _INTEGRATE_COMMANDS:
            self._validate_mutating_options(argv, command)
            self._reject_signing(argv, tag_mode=False)
            self._reject_options(argv, _EXECUTABLE_OPERATION_OPTIONS)
            return self._classification("git.integrate", command)
        if command in _HISTORY_REWRITE_COMMANDS:
            self._validate_mutating_options(argv, command)
            self._reject_options(argv, _EXECUTABLE_OPERATION_OPTIONS + ("-x",))
            return self._classification(
                "git.history_rewrite",
                command,
                always_confirm=True,
            )
        if command in _DESTRUCTIVE_COMMANDS:
            return self._classification(
                "git.destructive", command, always_confirm=True
            )
        if command in _REMOTE_READ_COMMANDS:
            self._validate_exact_options(
                argv,
                command=command,
                flags=_REMOTE_READ_FLAG_OPTIONS[command],
                value_options=_REMOTE_READ_VALUE_OPTIONS[command],
            )
            self._validate_remote_target(argv)
            return self._classification(
                "git.remote_read", command, external=True
            )
        if command == "pull":
            raise AdvancedGitCommandRejected(
                "use fetch followed by an explicit merge"
            )
        if command == "push":
            if any(
                value in {"-f", "--force", "--force-with-lease"}
                or value.startswith(("--force", "+"))
                for value in argv[1:]
            ):
                raise AdvancedGitCommandRejected("force push is disabled")
            self._validate_remote_target(argv)
            self._validate_push(argv)
            return self._classification(
                "git.remote_write",
                command,
                external=True,
                always_confirm=True,
                risk_tags=("external_publish",),
            )
        if command == "remote":
            verb = next(
                (value for value in lowered if not value.startswith("-")), ""
            )
            if (
                verb in {"", "get-url"}
                or "-v" in lowered
                or "--verbose" in lowered
            ):
                return self._classification("git.read", command)
            if verb == "show" and "-n" not in lowered:
                return self._classification(
                    "git.remote_read", command, external=True
                )
            self._validate_remote_target(argv)
            return self._classification(
                "git.config_sensitive",
                command,
                always_confirm=True,
            )
        if command == "config":
            joined = " ".join(lowered)
            if any(
                fragment in joined for fragment in _SENSITIVE_CONFIG_FRAGMENTS
            ):
                raise AdvancedGitCommandRejected(
                    "sensitive Git configuration is disabled"
                )
            return self._classification(
                "git.config_sensitive",
                command,
                always_confirm=True,
            )
        if command == "worktree":
            verb = next(
                (value for value in lowered if not value.startswith("-")),
                "list",
            )
            if verb == "list":
                return self._classification("git.read", command)
            raise AdvancedGitCommandRejected(
                "worktree mutations require the typed Workspace Git service"
            )
        if command in {"clone", "filter-branch", "stash", "submodule"}:
            raise AdvancedGitCommandRejected(
                f"{command} requires a separately authorized typed operation"
            )
        raise AdvancedGitCommandRejected(
            f"Git command {command!r} is not in the Advanced Git grammar"
        )

    @staticmethod
    def _classification(
        operation: str,
        subcommand: str,
        *,
        external: bool = False,
        always_confirm: bool = False,
        risk_tags: tuple[str, ...] = (),
    ) -> AdvancedGitClassification:
        safety = (
            ToolSafetyClass.SAFE_READ
            if operation == "git.read"
            else ToolSafetyClass.IDEMPOTENT_WRITE
            if operation in {"git.local_write", "git.integrate"}
            else ToolSafetyClass.UNSAFE_WRITE
        )
        return AdvancedGitClassification(
            operation=operation,
            safety_class=safety,
            subcommand=subcommand,
            external_side_effect=external,
            risk_tags=risk_tags,
            always_confirm=always_confirm,
        )

    @staticmethod
    def _validate_argv(argv: tuple[str, ...]) -> None:
        if not argv or len(argv) > _MAX_ARGV_ITEMS:
            raise AdvancedGitCommandRejected("Git argv length is invalid")
        for index, value in enumerate(argv):
            if not value or "\x00" in value or len(value) > _MAX_ARG_CHARS:
                raise AdvancedGitCommandRejected(
                    "Git argv contains an invalid value"
                )
            if index == 0 and value.startswith("-"):
                raise AdvancedGitCommandRejected(
                    "Git global options are disabled"
                )
            lowered = value.lower()
            if any(
                lowered == prefix or lowered.startswith(prefix + "=")
                for prefix in _PROHIBITED_GLOBAL_PREFIXES
            ):
                raise AdvancedGitCommandRejected(
                    "Git execution-scope overrides are disabled"
                )

    @staticmethod
    def _reject_sensitive_transport(argv: tuple[str, ...]) -> None:
        for value in argv:
            lowered = value.lower()
            if _URL_WITH_CREDENTIALS.search(value):
                raise AdvancedGitCommandRejected(
                    "credentials must not be embedded in Git argv"
                )
            if lowered.startswith("file://"):
                raise AdvancedGitCommandRejected(
                    "Git file protocol is disabled"
                )
            if lowered.startswith(("ext::", "fd::")):
                raise AdvancedGitCommandRejected(
                    "Git remote helpers are disabled"
                )
            if lowered.startswith(("--upload-p", "--receive-p")):
                raise AdvancedGitCommandRejected(
                    "custom remote executables are disabled"
                )
            if "://" in value:
                parsed = urlsplit(value)
                if parsed.username is not None or parsed.password is not None:
                    raise AdvancedGitCommandRejected(
                        "credentials must use the credential broker"
                    )

    @staticmethod
    def _validate_explicit_add_paths(argv: tuple[str, ...]) -> None:
        if any(value in {"-a", "-A", "--all"} for value in argv[1:]):
            raise AdvancedGitCommandRejected("broad Git add is disabled")
        try:
            separator = argv.index("--")
        except ValueError as exc:
            raise AdvancedGitCommandRejected(
                "Git add requires -- followed by explicit relative paths"
            ) from exc
        paths = argv[separator + 1 :]
        if not paths:
            raise AdvancedGitCommandRejected("Git add requires explicit paths")
        for value in paths:
            parts = Path(value).parts
            if (
                value in {".", "*"}
                or Path(value).is_absolute()
                or ".." in parts
                or value.startswith(("~/", "\\\\"))
            ):
                raise AdvancedGitCommandRejected(
                    "Git add paths must be scoped relative files or directories"
                )

    @staticmethod
    def _validate_remote_target(argv: tuple[str, ...]) -> None:
        for value in argv[1:]:
            lowered = value.lower()
            if value.startswith("-"):
                continue
            if lowered.startswith(
                ("/", "./", "../", "~/", "file:", "ext::", "fd::")
            ):
                raise AdvancedGitCommandRejected(
                    "local-path and helper Git transports are disabled"
                )

    @staticmethod
    def _validate_push(argv: tuple[str, ...]) -> None:
        allowed_options = {
            "-n",
            "-u",
            "--dry-run",
            "--no-verify",
            "--porcelain",
            "--set-upstream",
        }
        operands: list[str] = []
        for value in argv[1:]:
            if value.startswith("-"):
                if value not in allowed_options:
                    raise AdvancedGitCommandRejected(
                        f"Git push option {value!r} is outside the safe grammar"
                    )
                continue
            operands.append(value)
        if len(operands) != 2:
            raise AdvancedGitCommandRejected(
                "Git push requires one configured remote and one HEAD refspec"
            )
        remote, refspec = operands
        try:
            GitPublishPolicy.validate_remote_name(remote)
        except GitBackendError as exc:
            raise AdvancedGitCommandRejected(str(exc)) from exc
        if not re.fullmatch(
            r"HEAD(?::(?:refs/heads/)?[A-Za-z0-9][A-Za-z0-9._/-]*)?",
            refspec,
        ) or any(value in refspec for value in ("..", "//", "@{", "\\")):
            raise AdvancedGitCommandRejected(
                "Advanced Git may only publish the reviewed HEAD"
            )

    @staticmethod
    def push_remote(argv: tuple[str, ...]) -> str:
        AdvancedGitCommandClassifier._validate_push(argv)
        return next(value for value in argv[1:] if not value.startswith("-"))

    @staticmethod
    def _reject_options(
        argv: tuple[str, ...],
        rejected: tuple[str, ...],
    ) -> None:
        for value in argv[1:]:
            lowered = value.lower()
            if any(
                lowered == option
                or lowered.startswith(option + "=")
                or (
                    len(option) == 2
                    and option.startswith("-")
                    and lowered.startswith(option)
                )
                for option in rejected
            ):
                raise AdvancedGitCommandRejected(
                    f"Git option {value!r} can execute code or write outside "
                    "the typed operation boundary"
                )

    @staticmethod
    def _validate_mutating_options(
        argv: tuple[str, ...],
        command: str,
    ) -> None:
        """Reject unknown and abbreviated options for high-risk mutations."""

        flags = _MUTATING_FLAG_OPTIONS[command]
        value_options = _MUTATING_VALUE_OPTIONS[command]
        consume_value = False
        after_separator = False
        for value in argv[1:]:
            if consume_value:
                consume_value = False
                continue
            if value == "--":
                after_separator = True
                continue
            if after_separator or not value.startswith("-"):
                continue
            if value in flags:
                continue
            if value in value_options:
                consume_value = True
                continue
            option_name, separator, _ = value.partition("=")
            if separator and option_name in value_options:
                continue
            raise AdvancedGitCommandRejected(
                f"Git {command} option {value!r} is outside the safe grammar"
            )
        if consume_value:
            raise AdvancedGitCommandRejected(
                f"Git {command} option is missing its value"
            )

    @staticmethod
    def _validate_exact_options(
        argv: tuple[str, ...],
        *,
        command: str,
        flags: frozenset[str],
        value_options: frozenset[str],
    ) -> None:
        """Accept only complete option spellings; Git abbreviations are unsafe."""

        consume_value = False
        after_separator = False
        for value in argv[1:]:
            if consume_value:
                consume_value = False
                continue
            if value == "--":
                after_separator = True
                continue
            if after_separator or not value.startswith("-"):
                continue
            if value in flags:
                continue
            if value in value_options:
                consume_value = True
                continue
            option_name, separator, _ = value.partition("=")
            if separator and option_name in value_options:
                continue
            raise AdvancedGitCommandRejected(
                f"Git {command} option {value!r} is outside the safe grammar"
            )
        if consume_value:
            raise AdvancedGitCommandRejected(
                f"Git {command} option is missing its value"
            )

    @staticmethod
    def _reject_signing(
        argv: tuple[str, ...],
        *,
        tag_mode: bool,
    ) -> None:
        for value in argv[1:]:
            if (
                value == "-S"
                or value.startswith("-S")
                or value.startswith("--gpg-s")
                or (
                    tag_mode
                    and value in {"-s", "-u", "--sign", "--local-user"}
                )
            ):
                raise AdvancedGitCommandRejected(
                    "Git signing requires a separately bound signer policy"
                )


class AdvancedGitService:
    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        content: ContentRepositoryService,
        git_backend: GitBackend | None = None,
        classifier: AdvancedGitCommandClassifier | None = None,
    ) -> None:
        self.journal = journal
        self.content = content
        self.git = git_backend or content.git
        self.classifier = classifier or AdvancedGitCommandClassifier()
        self.policy = PermissionPolicyService(journal)

    def preview(
        self,
        *,
        space_id: str,
        repository_id: str,
        argv: tuple[str, ...],
        operation_request_id: str,
    ) -> AdvancedGitPreview:
        classification = self.classifier.classify(argv)
        descriptor = self._descriptor(
            space_id=space_id,
            repository_id=repository_id,
            argv=argv,
            operation_request_id=operation_request_id,
            classification=classification,
        )
        decision = self.policy.evaluate(descriptor, space_id=space_id)
        return AdvancedGitPreview(
            classification=classification,
            action_digest=descriptor.action_digest,
            effect=decision.effect,
            reason=decision.reason,
            display_argv=self._display_argv(argv),
        )

    def execute(
        self,
        *,
        space_id: str,
        repository_id: str,
        argv: tuple[str, ...],
        operation_request_id: str,
        expected_repo_state_digest: str | None,
        confirmed_action_digest: str | None,
        actor_id: str,
    ) -> dict:
        repository = self.journal.get_git_repository(repository_id)
        if repository is None or repository.space_id != space_id:
            raise ContentRepositoryError("Content Repository is unavailable")
        preview = self.preview(
            space_id=space_id,
            repository_id=repository_id,
            argv=argv,
            operation_request_id=operation_request_id,
        )
        if preview.effect is PolicyEffect.DENY:
            raise AdvancedGitCommandRejected(preview.reason)
        if (
            preview.requires_confirmation
            and confirmed_action_digest != preview.action_digest
        ):
            raise AdvancedGitApprovalRequired(
                "The exact Advanced Git action requires confirmation",
                action_digest=preview.action_digest,
            )

        classification = preview.classification
        root = Path(repository.root_path)
        if classification.safety_class is ToolSafetyClass.SAFE_READ:
            result = self.git.run_advanced_argv(root, argv)
            return self._result_payload(
                result=result,
                preview=preview,
                repo_state_digest=self.git.repo_state_token(root).digest,
                replayed=False,
            )
        if expected_repo_state_digest is None:
            raise RepositoryStateChangedError(
                "mutating Advanced Git operations require RepoStateToken CAS"
            )

        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": repository_id,
                    "request_id": operation_request_id,
                }
            )[:32]
        )
        operation = self.journal.begin_git_operation(
            operation_id=operation_id,
            repository_id=repository_id,
            request_id=operation_request_id,
            operation_type=f"advanced.{classification.operation}",
            payload_digest=preview.action_digest,
            expected_repo_state_digest=expected_repo_state_digest,
        )
        if operation.status == "completed":
            return {**(operation.result or {}), "replayed": True}
        if operation.status == "outcome_unknown":
            raise AdvancedGitOutcomeUnknown(
                "The previous Git attempt has an unknown outcome and cannot be replayed"
            )
        if operation.status == "failed":
            raise AdvancedGitError(
                operation.error_message or "The Git operation failed"
            )
        if operation.status == "dispatched":
            raise AdvancedGitOutcomeUnknown(
                "The previous Git attempt was dispatched without a durable outcome"
            )

        lock_path = self.content.repository_lock_path(repository.space_id)
        publish_scan: dict | None = None
        with self.content.repository_lock(lock_path):
            current = self.git.repo_state_token(root)
            if current.digest != expected_repo_state_digest:
                self.journal.fail_git_operation(
                    operation_id,
                    error_code="repo_state_changed",
                    error_message="Content Repository changed before execution",
                )
                raise RepositoryStateChangedError(
                    "Content Repository changed before Advanced Git execution"
                )
            if classification.subcommand == "add":
                separator = argv.index("--")
                try:
                    self.git.assert_no_clean_filters(
                        root,
                        argv[separator + 1 :],
                    )
                except GitBackendError as exc:
                    self.journal.fail_git_operation(
                        operation_id,
                        error_code="unsafe_git_filter",
                        error_message=str(exc),
                    )
                    self._audit(
                        operation_id=operation_id,
                        space_id=space_id,
                        actor_id=actor_id,
                        preview=preview,
                        outcome="denied",
                    )
                    raise
            if classification.subcommand == "push":
                try:
                    publish_scan = (
                        GitPublishPolicy(self.git)
                        .scan_head(
                            root,
                            remote_name=self.classifier.push_remote(argv),
                        )
                        .to_dict()
                    )
                except GitBackendError as exc:
                    self.journal.fail_git_operation(
                        operation_id,
                        error_code="git_publish_policy_failed",
                        error_message=str(exc),
                    )
                    self._audit(
                        operation_id=operation_id,
                        space_id=space_id,
                        actor_id=actor_id,
                        preview=preview,
                        outcome="denied",
                    )
                    raise
            self.journal.mark_git_operation_dispatched(
                operation_id,
                observed_repo_state_digest=current.digest,
            )
            try:
                result = self.git.run_advanced_argv(
                    root,
                    argv,
                    identity=(
                        ("Eigent User", "noreply@eigent.ai")
                        if classification.subcommand == "commit"
                        else None
                    ),
                )
            except GitCommandTimeoutError as exc:
                self.journal.fail_git_operation(
                    operation_id,
                    error_code="git_timeout",
                    error_message=str(exc),
                    outcome_unknown=classification.external_side_effect,
                )
                self._audit(
                    operation_id=operation_id,
                    space_id=space_id,
                    actor_id=actor_id,
                    preview=preview,
                    outcome=(
                        "outcome_unknown"
                        if classification.external_side_effect
                        else "failed"
                    ),
                )
                if classification.external_side_effect:
                    raise AdvancedGitOutcomeUnknown(str(exc)) from exc
                raise
            except GitBackendError as exc:
                self.journal.fail_git_operation(
                    operation_id,
                    error_code="git_execution_failed",
                    error_message=str(exc),
                    outcome_unknown=classification.external_side_effect,
                )
                self._audit(
                    operation_id=operation_id,
                    space_id=space_id,
                    actor_id=actor_id,
                    preview=preview,
                    outcome=(
                        "outcome_unknown"
                        if classification.external_side_effect
                        else "failed"
                    ),
                )
                if classification.external_side_effect:
                    raise AdvancedGitOutcomeUnknown(str(exc)) from exc
                raise
            if result.returncode != 0:
                message = (
                    self._redact(result.stderr).strip() or "Git command failed"
                )
                self.journal.fail_git_operation(
                    operation_id,
                    error_code="git_nonzero_exit",
                    error_message=message[:1000],
                )
                self._audit(
                    operation_id=operation_id,
                    space_id=space_id,
                    actor_id=actor_id,
                    preview=preview,
                    outcome="failed",
                    returncode=result.returncode,
                )
                raise AdvancedGitError(message)
            observed = self.git.repo_state_token(root)
            payload = self._result_payload(
                result=result,
                preview=preview,
                repo_state_digest=observed.digest,
                replayed=False,
            )
            if publish_scan is not None:
                payload["publish_scan"] = publish_scan
            self.journal.complete_git_operation(
                operation_id,
                result=payload,
                observed_repo_state_digest=observed.digest,
            )
            self._audit(
                operation_id=operation_id,
                space_id=space_id,
                actor_id=actor_id,
                preview=preview,
                outcome="completed",
                returncode=result.returncode,
            )
            return payload

    def history(self, *, repository_id: str, limit: int = 50) -> dict:
        repository = self.journal.get_git_repository(repository_id)
        if repository is None:
            raise ContentRepositoryError("Content Repository is unavailable")
        root = Path(repository.root_path)
        branches = self.git.run_advanced_argv(
            root,
            (
                "for-each-ref",
                "--sort=-committerdate",
                "--format=%(refname)%00%(objectname)%00"
                "%(committerdate:unix)%00%(subject)",
                "refs/heads",
                "refs/eigent/archive",
            ),
        )
        commits = self.git.run_advanced_argv(
            root,
            (
                "log",
                f"--max-count={limit}",
                "--date-order",
                "--format=%H%x00%P%x00%an%x00%at%x00%s",
                "--all",
            ),
        )
        remotes = self.git.run_advanced_argv(root, ("remote",))
        objects = self.git.run_advanced_argv(root, ("count-objects", "-v"))
        object_stats = self._parse_object_stats(objects.stdout)
        estimated_bytes = (
            object_stats.get("size", 0) + object_stats.get("size-pack", 0)
        ) * 1024
        policy = DEFAULT_GIT_RETENTION_POLICY
        return {
            "repository_id": repository_id,
            "repo_state_digest": self.git.repo_state_token(root).digest,
            "branches": self._parse_branches(branches.stdout),
            "commits": self._parse_commits(commits.stdout),
            "remotes": [
                value for value in remotes.stdout.splitlines() if value
            ],
            "large_repository": {
                "estimated_object_bytes": estimated_bytes,
                "warning": estimated_bytes
                >= policy.large_repository_warning_bytes,
                "lfs_recommended_for_blob_bytes": policy.lfs_recommendation_blob_bytes,
                "object_stats": object_stats,
            },
            "retention_policy": policy.to_dict(),
            "backup": {
                "configured": False,
                "message": "Encrypted Space backup requires separate explicit setup.",
            },
        }

    @staticmethod
    def _descriptor(
        *,
        space_id: str,
        repository_id: str,
        argv: tuple[str, ...],
        operation_request_id: str,
        classification: AdvancedGitClassification,
    ) -> ActionDescriptor:
        argv_digest = canonical_digest({"argv": list(argv)})
        return ActionDescriptor(
            action_id=f"git:{operation_request_id}",
            tool_name="WorkspaceGitToolkit.advanced",
            operation=classification.operation,
            safety_class=classification.safety_class,
            normalized_arguments={
                "subcommand": classification.subcommand,
                "argument_count": len(argv),
                "argv_digest": argv_digest,
            },
            target_resources=(f"repository:{repository_id}",),
            external_side_effect=classification.external_side_effect,
            idempotency_key=(
                operation_request_id
                if classification.safety_class
                is ToolSafetyClass.IDEMPOTENT_WRITE
                else None
            ),
            run_id=f"space:{space_id}",
            attempt_id="direct-user-action",
            environment_spec_digest=canonical_digest(
                {"space_id": space_id, "repository_id": repository_id}
            ),
            risk_tags=classification.risk_tags,
        )

    @staticmethod
    def _display_argv(argv: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(AdvancedGitService._redact(value) for value in argv)

    @staticmethod
    def _redact(value: str) -> str:
        return _URL_USERINFO.sub(r"\1[redacted]@", value)

    @staticmethod
    def _result_payload(
        *,
        result,
        preview,
        repo_state_digest: str,
        replayed: bool,
    ) -> dict:
        return {
            "classification": preview.classification.operation,
            "subcommand": preview.classification.subcommand,
            "action_digest": preview.action_digest,
            "stdout": AdvancedGitService._redact(result.stdout),
            "stderr": AdvancedGitService._redact(result.stderr),
            "returncode": result.returncode,
            "stdout_truncated": result.stdout_truncated,
            "stderr_truncated": result.stderr_truncated,
            "repo_state_digest": repo_state_digest,
            "replayed": replayed,
        }

    def _audit(
        self,
        *,
        operation_id: str,
        space_id: str,
        actor_id: str,
        preview: AdvancedGitPreview,
        outcome: str,
        returncode: int | None = None,
    ) -> None:
        self.journal.append_security_audit_event(
            audit_event_id=f"advanced-git:{operation_id}:{outcome}",
            space_id=space_id,
            event_type=f"git.advanced.{outcome}",
            actor_type="user",
            actor_id=actor_id,
            action_digest=preview.action_digest,
            details={
                "operation": preview.classification.operation,
                "subcommand": preview.classification.subcommand,
                "returncode": returncode,
            },
        )

    @staticmethod
    def _parse_branches(value: str) -> list[dict]:
        records = []
        for line in value.splitlines():
            parts = line.split("\x00", 3)
            if len(parts) != 4:
                continue
            ref, oid, timestamp, subject = parts
            records.append(
                {
                    "ref": ref,
                    "oid": oid,
                    "committed_at": int(timestamp or 0),
                    "subject": subject,
                    "archived": ref.startswith("refs/eigent/archive/"),
                }
            )
        return records

    @staticmethod
    def _parse_commits(value: str) -> list[dict]:
        records = []
        for line in value.splitlines():
            parts = line.split("\x00", 4)
            if len(parts) != 5:
                continue
            oid, parents, author, timestamp, subject = parts
            records.append(
                {
                    "oid": oid,
                    "parent_oids": parents.split() if parents else [],
                    "author": author,
                    "committed_at": int(timestamp or 0),
                    "subject": subject,
                }
            )
        return records

    @staticmethod
    def _parse_object_stats(value: str) -> dict[str, int]:
        result: dict[str, int] = {}
        for line in value.splitlines():
            key, separator, raw = line.partition(": ")
            if separator and raw.isdigit():
                result[key] = int(raw)
        return result


def get_default_advanced_git_service() -> AdvancedGitService:
    journal = get_default_run_journal()
    content = ContentRepositoryService(
        journal,
        state_root=configured_run_journal_path().parent / "workspace-git",
    )
    return AdvancedGitService(
        journal, content=content, git_backend=content.git
    )
