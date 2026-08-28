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

"""Content Repository ownership, checkpoints, and safe restore candidates."""

from __future__ import annotations

import os
import re
import threading
from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from pathlib import Path

from app.run_journal import (
    GitCheckpointRecord,
    GitOperationRecord,
    GitRepositoryRecord,
    SQLiteRunJournal,
)
from app.workspace_config import canonical_digest
from app.workspace_git.backend import (
    GitBackend,
    GitBackendError,
    NestedRepositoryError,
    RepositoryDiagnostics,
    RepositoryProbe,
)

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback
    fcntl = None


class ContentRepositoryError(RuntimeError):
    """Base error for Content Repository operations."""


class ContentRepositoryConsentRequired(ContentRepositoryError):
    """Raised before initializing a user-owned folder without consent."""


class RepositoryStateChangedError(ContentRepositoryError):
    """Raised when optimistic RepoStateToken validation fails."""


class NoCheckpointChangesError(ContentRepositoryError):
    """Raised when none of the explicit checkpoint paths changed."""


@dataclass(frozen=True)
class ContentRepositoryInspection:
    probe: RepositoryProbe
    diagnostics: RepositoryDiagnostics | None
    enablement: str
    consent_required: bool


@dataclass(frozen=True)
class ContentRepositoryResult:
    repository: GitRepositoryRecord
    probe: RepositoryProbe
    diagnostics: RepositoryDiagnostics
    initialized: bool


@dataclass(frozen=True)
class ContentRepositoryStatus:
    repository: GitRepositoryRecord
    diagnostics: RepositoryDiagnostics
    managed_paths: tuple[str, ...]
    pending_managed_paths: tuple[str, ...]
    pending_managed_paths_truncated: bool


@dataclass(frozen=True)
class RestoreCandidate:
    operation: GitOperationRecord
    checkpoint: GitCheckpointRecord
    ref_name: str
    commit_oid: str


_SAFE_IDENTIFIER = re.compile(r"[A-Za-z0-9_.:-]{1,128}")
_MANAGED_SOURCES = {
    "agent_created",
    "agent_modified",
    "user_selected",
    "configuration",
    "overlay_preimage",
}
_TARGET_ROLES = {"user", "project", "run", "agent"}


class ContentRepositoryService:
    """Single typed owner for local Content Repository mutations.

    Checkpoints only stage caller-supplied paths. Restore creates an
    Eigent-owned recovery ref; it never checks out, resets, or cleans the User
    Worktree.
    """

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        state_root: Path,
        git_backend: GitBackend | None = None,
    ) -> None:
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.git = git_backend or GitBackend()
        self._lock = threading.RLock()

    def inspect(self, space_root: Path) -> ContentRepositoryInspection:
        root = space_root.expanduser().resolve()
        if not root.is_dir():
            raise ContentRepositoryError(
                f"Space root is not a directory: {space_root}"
            )
        probe = self.git.probe(root)
        if probe.nested_in_parent:
            return ContentRepositoryInspection(
                probe=probe,
                diagnostics=None,
                enablement="nested_repository_requires_binding",
                consent_required=True,
            )
        if not probe.is_repository:
            return ContentRepositoryInspection(
                probe=probe,
                diagnostics=None,
                enablement="not_enabled",
                consent_required=True,
            )
        diagnostics = self.git.diagnostics(root)
        return ContentRepositoryInspection(
            probe=probe,
            diagnostics=diagnostics,
            enablement=("ready" if diagnostics.healthy else "needs_attention"),
            consent_required=False,
        )

    def bootstrap(
        self,
        *,
        space_id: str,
        space_root: Path,
        allow_init: bool,
        eigent_owned_space: bool = False,
        repo_subdir: str | None = None,
    ) -> ContentRepositoryResult:
        self._validate_identifier("space_id", space_id)
        root = space_root.expanduser().resolve()
        if not root.is_dir():
            raise ContentRepositoryError(
                f"Space root is not a directory: {space_root}"
            )
        lock_path = self.repository_lock_path(space_id)
        with self.repository_lock(lock_path):
            before = self.git.probe(root)
            if before.nested_in_parent:
                raise NestedRepositoryError(
                    "Space root is inside a parent repository; explicit "
                    "parent binding and repo_subdir confirmation are required"
                )
            initialized = False
            if not before.is_repository:
                if not allow_init:
                    raise ContentRepositoryConsentRequired(
                        "enabling local version management requires explicit "
                        "consent for this folder"
                    )
                self.git.init_repository(root)
                initialized = True
            # A branch without a commit cannot be used as a stable Run diff
            # boundary.  Publish an empty root commit without staging any
            # existing user files.  An Eigent-owned scratch Space also heals
            # the narrow crash window between `git init` and this commit.
            if initialized or (
                eigent_owned_space and self.git.current_head(root) is None
            ):
                self.git.create_empty_initial_commit(
                    root,
                    message="Initialize Eigent Space version history",
                )
            probe = self.git.probe(root)
            if not probe.is_repository or not probe.owns_requested_root:
                raise ContentRepositoryError(
                    "Content Repository did not resolve to the Space root"
                )
            diagnostics = self.git.diagnostics(root)
            repository_id = (
                "repo_"
                + canonical_digest({"space_id": space_id, "role": "content"})[
                    :32
                ]
            )
            # Ownership describes the Space, not whether this particular
            # request happened to run `git init`. A retry after init but before
            # the SQLite binding must preserve an Eigent-created blank Space.
            ownership = "eigent_owned" if eigent_owned_space else "adopted"
            repository = self.journal.put_git_repository(
                repository_id=repository_id,
                space_id=space_id,
                repository_role="content",
                root_path=str(root),
                root_path_digest=canonical_digest(str(root)),
                ownership=ownership,
                state=("ready" if diagnostics.healthy else "needs_attention"),
                version_coverage="managed_files_only",
                hooks_mode="disabled",
                repo_subdir=repo_subdir,
            )
            return ContentRepositoryResult(
                repository=repository,
                probe=probe,
                diagnostics=diagnostics,
                initialized=initialized,
            )

    def status(self, repository_id: str) -> ContentRepositoryStatus:
        repository = self._repository(repository_id)
        root = Path(repository.root_path)
        diagnostics = self.git.diagnostics(root)
        repository = self._converge_repository_state(
            repository,
            diagnostics,
        )
        managed_paths = self.journal.list_git_managed_paths(repository_id)
        pending_managed_paths, pending_truncated = self._pending_managed_paths(
            root,
            managed_paths,
            limit=500,
        )
        return ContentRepositoryStatus(
            repository=repository,
            diagnostics=diagnostics,
            managed_paths=managed_paths,
            pending_managed_paths=pending_managed_paths,
            pending_managed_paths_truncated=pending_truncated,
        )

    def _pending_managed_paths(
        self,
        root: Path,
        managed_paths: tuple[str, ...],
        *,
        limit: int,
    ) -> tuple[tuple[str, ...], bool]:
        """Return only managed deltas without scanning unrelated files."""

        if limit < 1:
            raise ValueError("pending managed path limit must be positive")
        pending: list[str] = []
        chunk_size = 500
        for offset in range(0, len(managed_paths), chunk_size):
            chunk = managed_paths[offset : offset + chunk_size]
            changed = self.git.path_status(
                root,
                tuple(root / value for value in chunk),
            )
            for relative_path in chunk:
                if relative_path not in changed:
                    continue
                pending.append(relative_path)
                if len(pending) > limit:
                    return tuple(pending[:limit]), True
        return tuple(pending), False

    def diff(
        self,
        repository_id: str,
        *,
        paths: tuple[Path, ...],
        source_commit: str | None = None,
    ) -> str:
        repository = self._repository(repository_id)
        return self.git.diff_paths(
            Path(repository.root_path),
            paths,
            source=source_commit,
        )

    def checkpoint(
        self,
        repository_id: str,
        *,
        operation_request_id: str,
        expected_repo_state_digest: str,
        paths: tuple[Path, ...],
        path_sources: dict[str, str],
        target_role: str,
        target_id: str,
        actor_id: str,
        trigger: str,
        message: str,
        worktree_root: Path | None = None,
        repository_lock_held: bool = False,
        commit_trailers: dict[str, str] | None = None,
    ) -> GitCheckpointRecord:
        self._validate_identifier("operation_request_id", operation_request_id)
        self._validate_text("actor_id", actor_id)
        self._validate_text("trigger", trigger)
        self._validate_text("message", message, max_length=500)
        self._validate_text("target_id", target_id, max_length=256)
        trailers = dict(commit_trailers or {})
        for key, value in trailers.items():
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,63}", key):
                raise ValueError("invalid commit trailer key")
            self._validate_text("commit trailer value", value, max_length=256)
        if target_role not in _TARGET_ROLES:
            raise ValueError(f"unsupported checkpoint target {target_role!r}")
        repository = self._repository(repository_id)
        root = self._checkpoint_root(repository, worktree_root)
        self._assert_no_symlink_components(root, paths)
        relative_paths = tuple(sorted(self.git.relative_paths(root, paths)))
        self._validate_checkpoint_paths(paths, relative_paths)
        if set(path_sources) != set(relative_paths):
            raise ValueError(
                "path_sources must use the exact repository-relative paths"
            )
        invalid_sources = set(path_sources.values()) - _MANAGED_SOURCES
        if invalid_sources:
            raise ValueError(
                "unsupported managed path source: "
                + ", ".join(sorted(invalid_sources))
            )
        payload = {
            "repository_id": repository_id,
            "paths": list(relative_paths),
            "path_sources": path_sources,
            "target_role": target_role,
            "target_id": target_id,
            "actor_id": actor_id,
            "trigger": trigger,
            "message": message,
            "commit_trailers": trailers,
            "worktree_ref": self._worktree_ref(repository, root),
        }
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": repository_id,
                    "request_id": operation_request_id,
                }
            )[:32]
        )
        checkpoint_id = "checkpoint_" + operation_id.removeprefix("gitop_")

        lock = (
            nullcontext()
            if repository_lock_held
            else self.repository_lock(
                self.repository_lock_path(repository.space_id)
            )
        )
        with lock:
            diagnostics = self.git.diagnostics(root)
            repository = self._converge_repository_state(
                repository,
                diagnostics,
            )
            if repository.state != "ready":
                raise ContentRepositoryError(
                    f"repository {repository_id!r} is {repository.state!r}"
                )
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=repository_id,
                request_id=operation_request_id,
                operation_type="checkpoint.create",
                payload_digest=canonical_digest(payload),
                expected_repo_state_digest=expected_repo_state_digest,
            )
            if operation.status == "completed":
                checkpoint = self.journal.get_git_checkpoint(checkpoint_id)
                if checkpoint is None:
                    raise ContentRepositoryError(
                        "completed checkpoint operation has no checkpoint"
                    )
                return checkpoint
            if operation.status == "dispatched":
                recovered = self.git.find_commit_by_operation(
                    root, operation_id
                )
                if recovered is not None:
                    return self._persist_checkpoint(
                        repository=repository,
                        operation_id=operation_id,
                        checkpoint_id=checkpoint_id,
                        commit_oid=recovered,
                        relative_paths=relative_paths,
                        path_sources=path_sources,
                        target_role=target_role,
                        target_id=target_id,
                        actor_id=actor_id,
                        trigger=trigger,
                        message=message,
                        root=root,
                    )
                raise ContentRepositoryError(
                    "checkpoint outcome is unresolved and requires "
                    "reconciliation"
                )
            current = self.git.repo_state_token(root)
            if current.digest != expected_repo_state_digest:
                self.journal.fail_git_operation(
                    operation_id,
                    error_code="repo_state_changed",
                    error_message="Repository changed before checkpoint",
                )
                raise RepositoryStateChangedError(
                    "Repository changed before checkpoint; refresh status"
                )
            changed = self.git.path_status(root, paths)
            if not changed:
                self.journal.fail_git_operation(
                    operation_id,
                    error_code="no_changes",
                    error_message="No selected path has a pending change",
                )
                raise NoCheckpointChangesError(
                    "No selected path has a pending change"
                )
            staged = sorted(
                path
                for path, state in changed.items()
                if state != "??" and state[0] != " "
            )
            if staged:
                self.journal.fail_git_operation(
                    operation_id,
                    error_code="selected_paths_already_staged",
                    error_message=(
                        "Selected checkpoint paths already contain user-staged "
                        "changes"
                    ),
                )
                raise ContentRepositoryError(
                    "Selected checkpoint paths already contain staged changes; "
                    "commit or unstage them before saving an Eigent checkpoint"
                )
            parent_oid = current.head_oid
            self.journal.mark_git_operation_dispatched(
                operation_id,
                observed_repo_state_digest=current.digest,
            )
            commit_message = (
                f"{message}\n\n"
                f"Eigent-Operation: {operation_id}\n"
                f"Eigent-Actor: {actor_id}\n"
                f"Eigent-Trigger: {trigger}"
            )
            if trailers:
                commit_message += "\n" + "\n".join(
                    f"{key}: {value}"
                    for key, value in sorted(trailers.items())
                )
            try:
                commit_oid = self.git.commit_paths(
                    root,
                    paths,
                    message=commit_message,
                    author_name="Eigent User",
                    author_email="noreply@eigent.ai",
                )
            except Exception as exc:
                recovered = self.git.find_commit_by_operation(
                    root, operation_id
                )
                if recovered is not None:
                    commit_oid = recovered
                else:
                    after = self.git.repo_state_token(root)
                    self.journal.fail_git_operation(
                        operation_id,
                        error_code="git_checkpoint_failed",
                        error_message=str(exc)[:1000],
                        outcome_unknown=after.head_oid != parent_oid,
                    )
                    raise
            return self._persist_checkpoint(
                repository=repository,
                operation_id=operation_id,
                checkpoint_id=checkpoint_id,
                commit_oid=commit_oid,
                relative_paths=relative_paths,
                path_sources=path_sources,
                target_role=target_role,
                target_id=target_id,
                actor_id=actor_id,
                trigger=trigger,
                message=message,
                root=root,
            )

    def prepare_restore_candidate(
        self,
        checkpoint_id: str,
        *,
        operation_request_id: str,
        expected_repo_state_digest: str,
    ) -> RestoreCandidate:
        self._validate_identifier("operation_request_id", operation_request_id)
        checkpoint = self.journal.get_git_checkpoint(checkpoint_id)
        if checkpoint is None:
            raise ContentRepositoryError(
                f"unknown checkpoint {checkpoint_id!r}"
            )
        repository = self._repository(checkpoint.repository_id)
        root = Path(repository.root_path)
        operation_id = (
            "gitop_"
            + canonical_digest(
                {
                    "repository_id": repository.repository_id,
                    "request_id": operation_request_id,
                }
            )[:32]
        )
        ref_name = (
            f"refs/eigent/recovery/{repository.repository_id}/{operation_id}"
        )
        payload = {
            "checkpoint_id": checkpoint_id,
            "ref_name": ref_name,
            "commit_oid": checkpoint.commit_oid,
        }
        with self.repository_lock(
            self.repository_lock_path(repository.space_id)
        ):
            operation = self.journal.begin_git_operation(
                operation_id=operation_id,
                repository_id=repository.repository_id,
                request_id=operation_request_id,
                operation_type="checkpoint.restore_candidate",
                payload_digest=canonical_digest(payload),
                expected_repo_state_digest=expected_repo_state_digest,
            )
            if operation.status == "completed":
                return RestoreCandidate(
                    operation=operation,
                    checkpoint=checkpoint,
                    ref_name=ref_name,
                    commit_oid=checkpoint.commit_oid,
                )
            current = self.git.repo_state_token(root)
            if operation.status == "dispatched":
                existing_oid = self.git.ref_oid(root, ref_name)
                if existing_oid == checkpoint.commit_oid:
                    operation = self.journal.complete_git_operation(
                        operation_id,
                        result=payload,
                        observed_repo_state_digest=current.digest,
                    )
                    return RestoreCandidate(
                        operation=operation,
                        checkpoint=checkpoint,
                        ref_name=ref_name,
                        commit_oid=checkpoint.commit_oid,
                    )
            if current.digest != expected_repo_state_digest:
                self.journal.fail_git_operation(
                    operation_id,
                    error_code="repo_state_changed",
                    error_message="Repository changed before restore preview",
                )
                raise RepositoryStateChangedError(
                    "Repository changed before restore preview"
                )
            existing_oid = self.git.ref_oid(root, ref_name)
            if operation.status == "prepared":
                self.journal.mark_git_operation_dispatched(
                    operation_id,
                    observed_repo_state_digest=current.digest,
                )
            if existing_oid is None:
                self.git.update_eigent_ref(
                    root,
                    ref_name,
                    checkpoint.commit_oid,
                )
            elif existing_oid != checkpoint.commit_oid:
                self.journal.fail_git_operation(
                    operation_id,
                    error_code="restore_ref_conflict",
                    error_message="Recovery ref points to a different commit",
                    outcome_unknown=True,
                )
                raise ContentRepositoryError(
                    "Recovery ref conflicts with the requested checkpoint"
                )
            observed = self.git.repo_state_token(root)
            operation = self.journal.complete_git_operation(
                operation_id,
                result=payload,
                observed_repo_state_digest=observed.digest,
            )
            return RestoreCandidate(
                operation=operation,
                checkpoint=checkpoint,
                ref_name=ref_name,
                commit_oid=checkpoint.commit_oid,
            )

    def _persist_checkpoint(
        self,
        *,
        repository: GitRepositoryRecord,
        operation_id: str,
        checkpoint_id: str,
        commit_oid: str,
        relative_paths: tuple[str, ...],
        path_sources: dict[str, str],
        target_role: str,
        target_id: str,
        actor_id: str,
        trigger: str,
        message: str,
        root: Path,
    ) -> GitCheckpointRecord:
        observed = self.git.repo_state_token(root)
        return self.journal.complete_git_checkpoint(
            checkpoint_id=checkpoint_id,
            operation_id=operation_id,
            repository_id=repository.repository_id,
            target_role=target_role,
            target_id=target_id,
            commit_oid=commit_oid,
            parent_oid=self.git.commit_parent(root, commit_oid),
            paths=relative_paths,
            managed_path_sources=path_sources,
            actor_id=actor_id,
            trigger=trigger,
            message=message,
            observed_repo_state_digest=observed.digest,
        )

    def _repository(self, repository_id: str) -> GitRepositoryRecord:
        repository = self.journal.get_git_repository(repository_id)
        if repository is None:
            raise ContentRepositoryError(
                f"unknown Content Repository {repository_id!r}"
            )
        if repository.repository_role != "content":
            raise ContentRepositoryError(
                f"repository {repository_id!r} is not a Content Repository"
            )
        return repository

    def _checkpoint_root(
        self,
        repository: GitRepositoryRecord,
        requested: Path | None,
    ) -> Path:
        user_root = Path(repository.root_path).expanduser().resolve()
        if requested is None:
            return user_root
        target = requested.expanduser().resolve()
        for worktree in self.git.list_worktrees(user_root):
            if worktree.path != target:
                continue
            if target == user_root:
                return target
            if worktree.ref_name and worktree.ref_name.startswith(
                "refs/heads/eigent/"
            ):
                return target
            raise ContentRepositoryError(
                "checkpoint target is not an Eigent-owned worktree"
            )
        raise ContentRepositoryError(
            "checkpoint target is not registered with the Content Repository"
        )

    def _worktree_ref(
        self,
        repository: GitRepositoryRecord,
        root: Path,
    ) -> str:
        user_root = Path(repository.root_path).expanduser().resolve()
        if root == user_root:
            return "USER_WORKTREE"
        for worktree in self.git.list_worktrees(user_root):
            if worktree.path == root and worktree.ref_name:
                return worktree.ref_name
        raise ContentRepositoryError("checkpoint worktree ref is unavailable")

    def _converge_repository_state(
        self,
        repository: GitRepositoryRecord,
        diagnostics: RepositoryDiagnostics,
    ) -> GitRepositoryRecord:
        state = "ready" if diagnostics.healthy else "needs_attention"
        if repository.state == state:
            return repository
        return self.journal.update_git_repository_state(
            repository.repository_id,
            state=state,
            expected_version=repository.version,
        )

    @staticmethod
    def _validate_identifier(name: str, value: str) -> None:
        if not _SAFE_IDENTIFIER.fullmatch(value):
            raise ValueError(f"invalid {name}")

    @staticmethod
    def _validate_text(
        name: str,
        value: str,
        *,
        max_length: int = 200,
    ) -> None:
        if not value.strip() or len(value) > max_length or "\x00" in value:
            raise ValueError(f"invalid {name}")
        if "\r" in value or "\n" in value:
            raise ValueError(f"{name} must be a single line")

    @staticmethod
    def _validate_checkpoint_paths(
        original_paths: tuple[Path, ...],
        relative_paths: tuple[str, ...],
    ) -> None:
        if len(original_paths) != len(relative_paths) or len(
            set(relative_paths)
        ) != len(relative_paths):
            raise ValueError("checkpoint paths must be unique")
        for relative in relative_paths:
            if relative == ".git" or relative.startswith(".git/"):
                raise GitBackendError(".git cannot be checkpointed")

    @staticmethod
    def _assert_no_symlink_components(
        root: Path,
        paths: tuple[Path, ...],
    ) -> None:
        for original in paths:
            candidate = original.expanduser()
            if not candidate.is_absolute():
                candidate = root / candidate
            try:
                lexical = candidate.absolute().relative_to(root)
            except ValueError as exc:
                raise GitBackendError(
                    f"checkpoint path escapes repository: {original}"
                ) from exc
            cursor = root
            for part in lexical.parts:
                cursor = cursor / part
                if cursor.is_symlink():
                    raise GitBackendError(
                        "symlink checkpoint path is not allowed: "
                        f"{lexical.as_posix()}"
                    )

    def repository_lock_path(self, space_id: str) -> Path:
        return (
            self.state_root
            / "git-operation-locks"
            / f"content-{space_id}.lock"
        )

    @contextmanager
    def repository_lock(self, lock_path: Path) -> Iterator[None]:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
            try:
                if fcntl is not None:
                    fcntl.flock(descriptor, fcntl.LOCK_EX)
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)
