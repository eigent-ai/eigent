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

"""Typed, non-interactive Git CLI backend for Eigent-owned operations."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

_UNSAFE_INHERITED_GIT_ENV = {
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_ASKPASS",
    "GIT_COMMON_DIR",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_PAGER",
    "GIT_PROXY_COMMAND",
    "GIT_SEQUENCE_EDITOR",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GIT_WORK_TREE",
    "GIT_EDITOR",
    "GIT_EXTERNAL_DIFF",
    "SSH_ASKPASS",
}
_ADVANCED_COMMAND_SLOTS = threading.BoundedSemaphore(4)


class GitBackendError(RuntimeError):
    """Base error for typed local Git operations."""


class GitCommandError(GitBackendError):
    def __init__(
        self,
        *,
        args: tuple[str, ...],
        returncode: int,
        stderr: str,
    ) -> None:
        self.args_safe = args
        self.returncode = returncode
        self.stderr = stderr
        super().__init__(
            f"git command failed ({returncode}): {' '.join(args)}: {stderr}"
        )


class GitCommandTimeoutError(GitBackendError):
    """Raised when a bounded Git command exceeds its execution budget."""

    def __init__(
        self, *, args: tuple[str, ...], timeout_seconds: float
    ) -> None:
        self.args_safe = args
        self.timeout_seconds = timeout_seconds
        super().__init__(
            f"git command timed out after {timeout_seconds:g}s: {args[0]}"
        )


class NestedRepositoryError(GitBackendError):
    """Raised when init would silently create a nested repository."""


@dataclass(frozen=True)
class GitCommandResult:
    stdout: str
    stderr: str
    returncode: int
    stdout_truncated: bool = False
    stderr_truncated: bool = False


@dataclass(frozen=True)
class RepositoryProbe:
    requested_root: Path
    is_repository: bool
    repository_root: Path | None
    owns_requested_root: bool
    nested_in_parent: bool
    head_oid: str | None
    branch: str | None


@dataclass(frozen=True)
class RepoStateToken:
    head_oid: str | None
    branch_or_detached_head: str
    index_digest: str
    operation_state: str

    @property
    def digest(self) -> str:
        payload = "\0".join(
            (
                self.head_oid or "unborn",
                self.branch_or_detached_head,
                self.index_digest,
                self.operation_state,
            )
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class RepositoryDiagnostics:
    healthy: bool
    issues: tuple[str, ...]
    state_token: RepoStateToken
    has_submodules: bool
    has_remotes: bool


@dataclass(frozen=True)
class GitWorktreeInfo:
    path: Path
    head_oid: str | None
    ref_name: str | None
    detached: bool


@dataclass(frozen=True)
class GitMergeResult:
    commit_oid: str | None
    source_oid: str
    conflict_paths: tuple[str, ...]


@dataclass(frozen=True)
class GitObjectMetadata:
    oid: str
    object_type: str
    size_bytes: int


@dataclass(frozen=True)
class GitPathChange:
    status: str
    relative_path: str


@dataclass(frozen=True)
class GitPathLineStat:
    relative_path: str
    added_lines: int | None
    removed_lines: int | None


@dataclass(frozen=True)
class GitPathBlob:
    relative_path: str
    oid: str
    size_bytes: int


class GitBackend:
    """Small typed backend; arbitrary command execution is intentionally absent."""

    def __init__(
        self,
        git_executable: str | Path | None = None,
        *,
        timeout_seconds: float = 30.0,
        max_output_chars: int = 64_000,
        hooks_path: Path | None = None,
    ) -> None:
        executable = (
            str(git_executable)
            if git_executable is not None
            else os.environ.get("EIGENT_BUNDLED_GIT") or shutil.which("git")
        )
        if not executable:
            raise GitBackendError("Git runtime is not available")
        executable_path = Path(executable).expanduser()
        if executable_path.is_absolute() and not executable_path.is_file():
            raise GitBackendError(
                f"Git executable does not exist: {executable_path}"
            )
        self.git_executable = str(executable_path)
        self.timeout_seconds = timeout_seconds
        self.max_output_chars = max_output_chars
        self.hooks_path = hooks_path or Path(os.devnull)

    def run_advanced_argv(
        self,
        repository_root: Path,
        args: tuple[str, ...],
        *,
        identity: tuple[str, str] | None = None,
    ) -> GitCommandResult:
        """Execute classifier-approved argv with bounded streaming output.

        Classification and policy evaluation intentionally live above this
        transport primitive. This method never invokes a shell, never reads
        stdin, and drains output without retaining more than the configured
        per-stream limit in memory.
        """

        if not args or any(not value or "\x00" in value for value in args):
            raise GitBackendError("advanced Git argv is invalid")
        root = repository_root.expanduser().resolve()
        command = self._command(root, args)
        if not _ADVANCED_COMMAND_SLOTS.acquire(timeout=self.timeout_seconds):
            raise GitBackendError("advanced Git concurrency limit reached")
        try:
            return self._run_advanced_argv_acquired(
                command=command,
                args=args,
                identity=identity,
            )
        finally:
            _ADVANCED_COMMAND_SLOTS.release()

    def _run_advanced_argv_acquired(
        self,
        *,
        command: tuple[str, ...],
        args: tuple[str, ...],
        identity: tuple[str, str] | None,
    ) -> GitCommandResult:
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=self._environment(identity=identity),
            )
        except OSError as exc:
            raise GitBackendError(
                f"failed to execute advanced Git operation: {args[0]}"
            ) from exc

        stdout = bytearray()
        stderr = bytearray()
        truncated = {"stdout": False, "stderr": False}

        def drain(name: str, pipe, destination: bytearray) -> None:
            while True:
                chunk = pipe.read(16 * 1024)
                if not chunk:
                    return
                remaining = self.max_output_chars - len(destination)
                if remaining > 0:
                    destination.extend(chunk[:remaining])
                if len(chunk) > remaining:
                    truncated[name] = True

        assert process.stdout is not None
        assert process.stderr is not None
        threads = (
            threading.Thread(
                target=drain,
                args=("stdout", process.stdout, stdout),
                daemon=True,
            ),
            threading.Thread(
                target=drain,
                args=("stderr", process.stderr, stderr),
                daemon=True,
            ),
        )
        for thread in threads:
            thread.start()
        try:
            returncode = process.wait(timeout=self.timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            process.kill()
            process.wait()
            for thread in threads:
                thread.join(timeout=1)
            raise GitCommandTimeoutError(
                args=args,
                timeout_seconds=self.timeout_seconds,
            ) from exc
        for thread in threads:
            thread.join(timeout=1)
        return GitCommandResult(
            stdout=stdout.decode("utf-8", errors="replace"),
            stderr=stderr.decode("utf-8", errors="replace"),
            returncode=returncode,
            stdout_truncated=truncated["stdout"],
            stderr_truncated=truncated["stderr"],
        )

    def probe(self, root: Path) -> RepositoryProbe:
        requested = root.expanduser().resolve()
        if not requested.is_dir():
            raise GitBackendError(
                f"repository root is not a directory: {root}"
            )
        top = self._run(
            requested,
            ("rev-parse", "--show-toplevel"),
            check=False,
        )
        if top.returncode != 0:
            return RepositoryProbe(
                requested_root=requested,
                is_repository=False,
                repository_root=None,
                owns_requested_root=False,
                nested_in_parent=False,
                head_oid=None,
                branch=None,
            )
        repository_root = Path(top.stdout.strip()).expanduser().resolve()
        owns_root = repository_root == requested
        head = self._run(
            repository_root,
            ("rev-parse", "--verify", "HEAD"),
            check=False,
        )
        branch = self._run(
            repository_root,
            ("symbolic-ref", "--quiet", "--short", "HEAD"),
            check=False,
        )
        return RepositoryProbe(
            requested_root=requested,
            is_repository=True,
            repository_root=repository_root,
            owns_requested_root=owns_root,
            nested_in_parent=not owns_root,
            head_oid=head.stdout.strip() if head.returncode == 0 else None,
            branch=branch.stdout.strip() if branch.returncode == 0 else None,
        )

    def init_repository(
        self,
        root: Path,
        *,
        initial_branch: str = "main",
    ) -> RepositoryProbe:
        requested = root.expanduser().resolve()
        requested.mkdir(parents=True, exist_ok=True)
        before = self.probe(requested)
        if before.nested_in_parent:
            raise NestedRepositoryError(
                f"refusing to initialize nested repository inside "
                f"{before.repository_root}"
            )
        if before.is_repository:
            return before
        self._run(
            requested,
            ("init", f"--initial-branch={initial_branch}", "--"),
        )
        after = self.probe(requested)
        if not after.is_repository or not after.owns_requested_root:
            raise GitBackendError("Git init did not create the expected repo")
        return after

    def create_empty_initial_commit(
        self,
        repository_root: Path,
        *,
        message: str,
    ) -> str:
        """Give a newly initialized repository a real, empty branch head.

        Existing repositories are never changed by this helper.  In
        particular, callers must invoke it only for a repository they just
        initialized (or an Eigent-owned scratch repository being recovered).
        The empty tree deliberately leaves pre-existing user files untracked.
        """

        root = repository_root.expanduser().resolve()
        probe = self.probe(root)
        if not probe.is_repository or not probe.owns_requested_root:
            raise GitBackendError("initial commit requires an owned Git root")
        if probe.head_oid is not None:
            return probe.head_oid
        if not probe.branch:
            raise GitBackendError(
                "unborn repository has no branch for its initial commit"
            )
        commit_oid = self.create_anchor_commit(root, message=message)
        ref_name = f"refs/heads/{probe.branch}"
        self._run(
            root,
            ("update-ref", ref_name, commit_oid, "0" * 40),
        )
        observed = self.probe(root)
        if observed.head_oid != commit_oid or observed.branch != probe.branch:
            raise GitBackendError(
                "Git did not publish the initial branch head"
            )
        return commit_oid

    def current_head(self, repository_root: Path) -> str | None:
        result = self._run(
            repository_root,
            ("rev-parse", "--verify", "HEAD"),
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else None

    def object_metadata(
        self,
        repository_root: Path,
        object_ids: tuple[str, ...],
    ) -> tuple[GitObjectMetadata, ...]:
        """Return bounded object type/size metadata without reading blobs."""

        if not object_ids:
            return ()
        for oid in object_ids:
            self._validate_object_name(oid)
        result = self._run(
            repository_root,
            (
                "cat-file",
                "--batch-check=%(objectname) %(objecttype) %(objectsize)",
            ),
            input_text="\n".join(object_ids) + "\n",
        )
        records: list[GitObjectMetadata] = []
        for line in result.stdout.splitlines():
            oid, separator, remainder = line.partition(" ")
            object_type, separator_two, raw_size = remainder.partition(" ")
            if not separator or not separator_two or not raw_size.isdigit():
                raise GitBackendError("Git returned invalid object metadata")
            records.append(
                GitObjectMetadata(
                    oid=oid,
                    object_type=object_type,
                    size_bytes=int(raw_size),
                )
            )
        if len(records) != len(object_ids):
            raise GitBackendError("Git object metadata response was truncated")
        return tuple(records)

    def is_ancestor(
        self,
        repository_root: Path,
        ancestor_oid: str,
        descendant_oid: str,
    ) -> bool:
        self._validate_object_name(ancestor_oid)
        self._validate_object_name(descendant_oid)
        result = self._run(
            repository_root,
            ("merge-base", "--is-ancestor", ancestor_oid, descendant_oid),
            check=False,
        )
        if result.returncode not in {0, 1}:
            raise GitCommandError(
                args=("merge-base", "--is-ancestor"),
                returncode=result.returncode,
                stderr=result.stderr,
            )
        return result.returncode == 0

    def merge_owned_ref(
        self,
        worktree_root: Path,
        *,
        source_ref: str,
        operation_id: str,
        message: str,
    ) -> GitMergeResult:
        """Merge one Eigent branch and abort cleanly on conflicts."""

        self._validate_eigent_ref(source_ref, branch_only=True)
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", operation_id):
            raise ValueError("invalid Git operation id")
        if not message.strip():
            raise ValueError("merge message is required")
        root = worktree_root.expanduser().resolve()
        owned = next(
            (
                item
                for item in self.list_worktrees(root)
                if item.path == root
                and item.ref_name is not None
                and item.ref_name.startswith("refs/heads/eigent/")
            ),
            None,
        )
        if owned is None:
            raise GitBackendError("merge requires an Eigent-owned worktree")
        if not self.is_worktree_clean(root):
            raise GitBackendError("merge target worktree is not clean")
        source_oid = self.ref_oid(root, source_ref)
        current_oid = self.current_head(root)
        if source_oid is None or current_oid is None:
            raise GitBackendError("merge source or target HEAD is missing")
        if self.is_ancestor(root, source_oid, current_oid):
            return GitMergeResult(
                commit_oid=current_oid,
                source_oid=source_oid,
                conflict_paths=(),
            )
        result = self._run(
            root,
            (
                "merge",
                "--no-ff",
                "--no-edit",
                "-m",
                f"{message}\n\nEigent-Operation: {operation_id}",
                source_ref,
            ),
            check=False,
            identity=("Eigent", "noreply@eigent.ai"),
        )
        if result.returncode != 0:
            conflicts = self._run(
                root,
                ("diff", "--name-only", "--diff-filter=U", "-z"),
                check=False,
            )
            conflict_paths = tuple(
                sorted(path for path in conflicts.stdout.split("\0") if path)
            )
            self._run(root, ("merge", "--abort"), check=False)
            if conflict_paths:
                return GitMergeResult(
                    commit_oid=None,
                    source_oid=source_oid,
                    conflict_paths=conflict_paths,
                )
            raise GitCommandError(
                args=("merge", source_ref),
                returncode=result.returncode,
                stderr=result.stderr,
            )
        merged_oid = self.current_head(root)
        if merged_oid is None:
            raise GitBackendError("merge completed without a target HEAD")
        return GitMergeResult(
            commit_oid=merged_oid,
            source_oid=source_oid,
            conflict_paths=(),
        )

    def repo_state_token(self, repository_root: Path) -> RepoStateToken:
        root = repository_root.expanduser().resolve()
        probe = self.probe(root)
        if not probe.is_repository or not probe.owns_requested_root:
            raise GitBackendError(f"not an owned Git root: {root}")
        index = self._run(root, ("ls-files", "--stage", "-z"))
        status = self._run(
            root,
            ("status", "--porcelain=v1", "-z", "--untracked-files=all"),
        )
        worktree_metadata = self._status_metadata(root, status.stdout)
        index_digest = hashlib.sha256(
            (
                index.stdout + "\0" + status.stdout + "\0" + worktree_metadata
            ).encode("utf-8")
        ).hexdigest()
        return RepoStateToken(
            head_oid=probe.head_oid,
            branch_or_detached_head=(probe.branch or "DETACHED"),
            index_digest=index_digest,
            operation_state=self._operation_state(root),
        )

    def diagnostics(self, repository_root: Path) -> RepositoryDiagnostics:
        root = repository_root.expanduser().resolve()
        token = self.repo_state_token(root)
        issues: list[str] = []
        if token.operation_state != "clean":
            issues.append(f"operation_in_progress:{token.operation_state}")
        if token.head_oid is not None:
            connectivity = self._run(
                root,
                ("cat-file", "-e", f"{token.head_oid}^{{commit}}"),
                check=False,
            )
            if connectivity.returncode != 0:
                issues.append("object_database_unhealthy")
        staged = self._run(root, ("ls-files", "--stage"))
        has_submodules = any(
            line.startswith("160000 ") for line in staged.stdout.splitlines()
        )
        remotes = self._run(root, ("remote",))
        return RepositoryDiagnostics(
            healthy=not issues,
            issues=tuple(issues),
            state_token=token,
            has_submodules=has_submodules,
            has_remotes=bool(remotes.stdout.strip()),
        )

    def changed_paths(
        self,
        repository_root: Path,
        paths: tuple[Path, ...],
    ) -> tuple[str, ...]:
        return tuple(self.path_status(repository_root, paths))

    def path_status(
        self,
        repository_root: Path,
        paths: tuple[Path, ...],
    ) -> dict[str, str]:
        pathspecs = self._relative_pathspecs(repository_root, paths)
        result = self._run(
            repository_root,
            ("status", "--porcelain=v1", "--", *pathspecs),
        )
        return {
            line[3:]: line[:2]
            for line in result.stdout.splitlines()
            if len(line) > 3
        }

    def is_tracked(self, repository_root: Path, path: Path) -> bool:
        pathspec = self._relative_pathspecs(repository_root, (path,))[0]
        result = self._run(
            repository_root,
            ("ls-files", "--error-unmatch", "--", pathspec),
            check=False,
        )
        return result.returncode == 0

    def commit_paths(
        self,
        repository_root: Path,
        paths: tuple[Path, ...],
        *,
        message: str,
        author_name: str = "Eigent",
        author_email: str = "noreply@eigent.ai",
    ) -> str:
        if not message.strip():
            raise ValueError("Git commit message is required")
        pathspecs = self._relative_pathspecs(repository_root, paths)
        self.assert_no_clean_filters(repository_root, pathspecs)
        self._run(repository_root, ("add", "--", *pathspecs))
        staged = self._run(
            repository_root,
            ("diff", "--cached", "--name-only", "--", *pathspecs),
        )
        if not staged.stdout.strip():
            head = self.current_head(repository_root)
            if head is None:
                raise GitBackendError(
                    "configuration repository has no commit and no changes"
                )
            return head
        self._run(
            repository_root,
            (
                "-c",
                f"user.name={author_name}",
                "-c",
                f"user.email={author_email}",
                "-c",
                "commit.gpgSign=false",
                "commit",
                "--only",
                "--no-verify",
                "-m",
                message,
                "--",
                *pathspecs,
            ),
            identity=(author_name, author_email),
        )
        head = self.current_head(repository_root)
        if head is None:
            raise GitBackendError("Git commit did not create HEAD")
        return head

    def empty_tree_oid(self, repository_root: Path) -> str:
        """Return Git's canonical empty-tree object without creating a commit."""

        result = self._run(repository_root, ("mktree",), input_text="")
        oid = result.stdout.strip()
        if not oid:
            raise GitBackendError("Git did not create the empty tree object")
        return oid

    def show_commit_paths(
        self,
        repository_root: Path,
        commit: str = "HEAD",
    ) -> tuple[str, ...]:
        result = self._run(
            repository_root,
            (
                "diff-tree",
                "--no-commit-id",
                "--name-only",
                "-r",
                "--root",
                commit,
            ),
        )
        return tuple(line for line in result.stdout.splitlines() if line)

    def relative_paths(
        self,
        repository_root: Path,
        paths: tuple[Path, ...],
    ) -> tuple[str, ...]:
        return self._relative_pathspecs(repository_root, paths)

    def diff_paths(
        self,
        repository_root: Path,
        paths: tuple[Path, ...],
        *,
        cached: bool = False,
        source: str | None = None,
    ) -> str:
        pathspecs = self._relative_pathspecs(repository_root, paths)
        args = ["diff", "--no-ext-diff", "--no-textconv"]
        if cached:
            args.append("--cached")
        if source is not None:
            self._validate_object_name(source)
            args.append(source)
        args.extend(("--", *pathspecs))
        return self._run(repository_root, tuple(args)).stdout

    def changed_paths_between(
        self,
        repository_root: Path,
        *,
        base_commit: str,
        target_commit: str,
    ) -> tuple[GitPathChange, ...]:
        """Return exact non-rename path changes between two commits."""

        self._validate_object_name(base_commit)
        self._validate_object_name(target_commit)
        result = self._run(
            repository_root,
            (
                "diff",
                "--name-status",
                "-z",
                "--no-renames",
                base_commit,
                target_commit,
                "--",
            ),
        )
        fields = result.stdout.split("\0")
        if fields and fields[-1] == "":
            fields.pop()
        if len(fields) % 2:
            raise GitBackendError("Git returned malformed path changes")
        changes: list[GitPathChange] = []
        for offset in range(0, len(fields), 2):
            status = fields[offset]
            path = self._normalize_relative_git_path(fields[offset + 1])
            if status not in {"A", "M", "D", "T"}:
                raise GitBackendError(
                    f"unsupported Git path change status: {status!r}"
                )
            changes.append(GitPathChange(status=status, relative_path=path))
        return tuple(changes)

    def path_line_stats_between(
        self,
        repository_root: Path,
        *,
        base_commit: str,
        target_commit: str,
    ) -> tuple[GitPathLineStat, ...]:
        """Return text line totals per path; binary files use null totals."""

        self._validate_object_name(base_commit)
        self._validate_object_name(target_commit)
        result = self._run(
            repository_root,
            (
                "diff",
                "--numstat",
                "-z",
                "--no-renames",
                base_commit,
                target_commit,
                "--",
            ),
        )
        stats: list[GitPathLineStat] = []
        for record in result.stdout.split("\0"):
            if not record:
                continue
            raw_added, separator, remainder = record.partition("\t")
            raw_removed, separator_two, raw_path = remainder.partition("\t")
            if not separator or not separator_two or not raw_path:
                raise GitBackendError("Git returned malformed line stats")
            path = self._normalize_relative_git_path(raw_path)
            if raw_added == "-" and raw_removed == "-":
                added_lines = None
                removed_lines = None
            elif raw_added.isdigit() and raw_removed.isdigit():
                added_lines = int(raw_added)
                removed_lines = int(raw_removed)
            else:
                raise GitBackendError("Git returned invalid line stats")
            stats.append(
                GitPathLineStat(
                    relative_path=path,
                    added_lines=added_lines,
                    removed_lines=removed_lines,
                )
            )
        return tuple(stats)

    def hash_worktree_file(
        self,
        repository_root: Path,
        path: Path,
    ) -> str:
        """Hash one regular file as a raw Git blob without clean filters."""

        root = repository_root.expanduser().resolve()
        target = path.expanduser().resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise GitBackendError(
                "file is outside the repository root"
            ) from exc
        if target.is_symlink() or not target.is_file():
            raise GitBackendError("Git blob hashing requires a regular file")
        result = self._run(
            root,
            ("hash-object", "--no-filters", "--", str(target)),
        )
        oid = result.stdout.strip()
        self._validate_object_name(oid)
        return oid

    def commit_parent(
        self,
        repository_root: Path,
        commit_oid: str,
    ) -> str | None:
        self._validate_object_name(commit_oid)
        result = self._run(
            repository_root,
            ("rev-parse", f"{commit_oid}^"),
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else None

    def find_commit_by_operation(
        self,
        repository_root: Path,
        operation_id: str,
    ) -> str | None:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", operation_id):
            raise ValueError("invalid Git operation id")
        result = self._run(
            repository_root,
            (
                "log",
                "--all",
                "--fixed-strings",
                f"--grep=Eigent-Operation: {operation_id}",
                "-1",
                "--format=%H",
            ),
            check=False,
        )
        value = result.stdout.strip()
        return value if result.returncode == 0 and value else None

    def update_eigent_ref(
        self,
        repository_root: Path,
        ref_name: str,
        commit_oid: str,
        *,
        expected_oid: str | None = None,
    ) -> str:
        self._validate_eigent_ref(ref_name)
        self._validate_object_name(commit_oid)
        args = ["update-ref", ref_name, commit_oid]
        if expected_oid is not None:
            self._validate_object_name(expected_oid)
            args.append(expected_oid)
        self._run(repository_root, tuple(args))
        return commit_oid

    def archive_eigent_branch_ref(
        self,
        repository_root: Path,
        *,
        active_ref: str,
        archive_ref: str,
        expected_oid: str,
    ) -> str:
        self._validate_eigent_ref(active_ref, branch_only=True)
        self._validate_eigent_ref(archive_ref)
        if not archive_ref.startswith("refs/eigent/archive/"):
            raise ValueError(
                "archive ref must use the Eigent archive namespace"
            )
        self._validate_object_name(expected_oid)
        root = repository_root.expanduser().resolve()
        active_oid = self.ref_oid(root, active_ref)
        if active_oid not in {None, expected_oid}:
            raise GitBackendError("active Eigent ref changed before archive")
        archived_oid = self.ref_oid(root, archive_ref)
        if archived_oid is None:
            self.update_eigent_ref(root, archive_ref, expected_oid)
        elif archived_oid != expected_oid:
            raise GitBackendError("archive ref already points elsewhere")
        if active_oid == expected_oid:
            self._run(
                root,
                ("update-ref", "-d", active_ref, expected_oid),
            )
        return archive_ref

    def ref_oid(
        self,
        repository_root: Path,
        ref_name: str,
    ) -> str | None:
        self._validate_eigent_ref(ref_name)
        result = self._run(
            repository_root,
            ("rev-parse", "--verify", ref_name),
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else None

    def blob_oid_at_path(
        self,
        repository_root: Path,
        commit_oid: str,
        relative_path: str,
    ) -> str | None:
        """Resolve one regular Git blob without checking out a worktree."""

        self._validate_object_name(commit_oid)
        path = self._normalize_relative_git_path(relative_path)
        result = self._run(
            repository_root,
            ("ls-tree", "-z", commit_oid, "--", path),
            check=False,
        )
        if result.returncode != 0 or not result.stdout:
            return None
        metadata, separator, observed_path = result.stdout.partition("\t")
        if separator != "\t" or observed_path.rstrip("\0") != path:
            return None
        parts = metadata.split()
        if len(parts) != 3 or parts[1] != "blob":
            return None
        oid = parts[2]
        self._validate_object_name(oid)
        return oid

    def blobs_at_paths(
        self,
        repository_root: Path,
        commit_oid: str,
        relative_paths: tuple[str, ...],
    ) -> tuple[GitPathBlob, ...]:
        """Resolve regular blobs and sizes for many paths in one Git call."""

        if not relative_paths:
            return ()
        self._validate_object_name(commit_oid)
        paths = tuple(
            self._normalize_relative_git_path(path) for path in relative_paths
        )
        result = self._run(
            repository_root,
            ("ls-tree", "-z", "-l", commit_oid, "--", *paths),
        )
        blobs: list[GitPathBlob] = []
        for record in result.stdout.split("\0"):
            if not record:
                continue
            metadata, separator, raw_path = record.partition("\t")
            parts = metadata.split()
            if separator != "\t" or len(parts) != 4:
                raise GitBackendError("Git returned malformed blob metadata")
            _mode, object_type, oid, raw_size = parts
            if object_type != "blob" or not raw_size.isdigit():
                continue
            self._validate_object_name(oid)
            blobs.append(
                GitPathBlob(
                    relative_path=self._normalize_relative_git_path(raw_path),
                    oid=oid,
                    size_bytes=int(raw_size),
                )
            )
        return tuple(blobs)

    def object_size(self, repository_root: Path, object_oid: str) -> int:
        self._validate_object_name(object_oid)
        result = self._run(repository_root, ("cat-file", "-s", object_oid))
        try:
            value = int(result.stdout.strip())
        except ValueError as exc:
            raise GitBackendError(
                "Git returned an invalid object size"
            ) from exc
        if value < 0:
            raise GitBackendError("Git returned a negative object size")
        return value

    def read_blob_range(
        self,
        repository_root: Path,
        object_oid: str,
        *,
        start_offset: int,
        max_bytes: int,
    ) -> bytes:
        """Stream a bounded blob range without buffering the whole object."""

        self._validate_object_name(object_oid)
        if start_offset < 0 or max_bytes < 1:
            raise ValueError("invalid Git blob byte range")
        command = self._command(
            repository_root,
            ("cat-file", "blob", object_oid),
        )
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=self._environment(),
            )
        except OSError as exc:
            raise GitBackendError("failed to stream Git blob") from exc
        assert process.stdout is not None
        try:
            remaining = start_offset
            while remaining:
                chunk = process.stdout.read(min(remaining, 64 * 1024))
                if not chunk:
                    break
                remaining -= len(chunk)
            data = process.stdout.read(max_bytes)
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                _, stderr = process.communicate(timeout=self.timeout_seconds)
            except subprocess.TimeoutExpired:
                process.kill()
                _, stderr = process.communicate()
        if remaining:
            return b""
        if process.returncode not in {0, -15}:
            raise GitCommandError(
                args=("cat-file", "blob", object_oid),
                returncode=process.returncode or -1,
                stderr=stderr.decode("utf-8", errors="replace").strip(),
            )
        return data

    def create_anchor_commit(
        self,
        repository_root: Path,
        *,
        message: str,
    ) -> str:
        if not message.strip():
            raise ValueError("anchor commit message is required")
        empty_tree = self._run(
            repository_root,
            ("mktree",),
            input_text="",
        ).stdout.strip()
        if not empty_tree:
            raise GitBackendError("Git did not create an empty tree")
        commit = self._run(
            repository_root,
            ("commit-tree", empty_tree, "-m", message),
            identity=("Eigent", "noreply@eigent.ai"),
        ).stdout.strip()
        self._validate_object_name(commit)
        return commit

    def list_worktrees(
        self,
        repository_root: Path,
    ) -> tuple[GitWorktreeInfo, ...]:
        result = self._run(
            repository_root,
            ("worktree", "list", "--porcelain", "-z"),
        )
        records: list[GitWorktreeInfo] = []
        fields: dict[str, str] = {}
        for value in result.stdout.split("\0"):
            if not value:
                if "worktree" in fields:
                    records.append(self._worktree_from_fields(fields))
                    fields = {}
                continue
            key, _, item = value.partition(" ")
            fields[key] = item
        if "worktree" in fields:
            records.append(self._worktree_from_fields(fields))
        return tuple(records)

    def is_worktree_clean(self, worktree_root: Path) -> bool:
        result = self._run(
            worktree_root,
            ("status", "--porcelain=v1", "-z", "--untracked-files=all"),
        )
        return not result.stdout

    def worktree_status(
        self,
        worktree_root: Path,
        *,
        limit: int = 500,
    ) -> dict[str, str]:
        if limit < 1:
            raise ValueError("status limit must be positive")
        result = self._run(
            worktree_root,
            ("status", "--porcelain=v1", "-z", "--untracked-files=all"),
        )
        values = result.stdout.split("\0")
        records: dict[str, str] = {}
        index = 0
        while index < len(values):
            record = values[index]
            index += 1
            if not record or len(record) < 4:
                continue
            state = record[:2]
            relative_path = record[3:]
            records[relative_path] = state
            if "R" in state or "C" in state:
                index += 1
            if len(records) > limit:
                raise GitBackendError(
                    f"worktree delta exceeds the {limit}-path limit"
                )
        return records

    def restore_owned_worktree_path(
        self,
        worktree_root: Path,
        *,
        relative_path: str,
        source_commit: str | None,
    ) -> None:
        """Restore one private worktree path; never targets User Worktree."""

        path = self._normalize_relative_git_path(relative_path)
        root = worktree_root.expanduser().resolve()
        owned = next(
            (
                item
                for item in self.list_worktrees(root)
                if item.path == root
                and item.ref_name is not None
                and item.ref_name.startswith("refs/heads/eigent/")
            ),
            None,
        )
        if owned is None:
            raise GitBackendError(
                "owned path restore requires an attached private worktree"
            )
        if source_commit is not None:
            self._validate_object_name(source_commit)
        source_blob = (
            self.blob_oid_at_path(root, source_commit, path)
            if source_commit is not None
            else None
        )
        if source_blob is not None:
            self._run(
                root,
                (
                    "restore",
                    f"--source={source_commit}",
                    "--worktree",
                    "--",
                    path,
                ),
            )
            return
        target = root / path
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise GitBackendError(
                "refusing to remove non-regular private projection path"
            )
        target.unlink(missing_ok=True)

    def restore_owned_paths_from_ref(
        self,
        worktree_root: Path,
        *,
        source_ref: str,
        relative_paths: tuple[str, ...],
    ) -> None:
        """Project selected paths from an Eigent ref into a clean worktree."""

        self._validate_eigent_ref(source_ref, branch_only=True)
        if not relative_paths:
            raise ValueError("at least one conflict path is required")
        normalized: list[str] = []
        for value in relative_paths:
            path = PurePosixPath(value)
            if not value or path.is_absolute() or ".." in path.parts:
                raise GitBackendError("conflict paths must be relative")
            normalized.append(path.as_posix())
        if len(set(normalized)) != len(normalized):
            raise GitBackendError("conflict paths must be unique")
        if not self.is_worktree_clean(worktree_root):
            raise GitBackendError(
                "Run integration changed before conflict resolution"
            )
        self._run(
            worktree_root,
            (
                "restore",
                "--source",
                source_ref,
                "--worktree",
                "--",
                *normalized,
            ),
        )

    def worktree_matches_commit(
        self,
        worktree_root: Path,
        commit_oid: str,
    ) -> bool:
        self._validate_object_name(commit_oid)
        changed = self._run(
            worktree_root,
            ("diff", "--quiet", commit_oid, "--"),
            check=False,
        )
        if changed.returncode != 0:
            return False
        untracked = self._run(
            worktree_root,
            ("ls-files", "--others", "--exclude-standard", "-z"),
        )
        return not untracked.stdout

    def refresh_owned_worktree(
        self,
        worktree_root: Path,
        *,
        expected_projected_head: str,
        target_head: str,
    ) -> None:
        self._validate_object_name(expected_projected_head)
        self._validate_object_name(target_head)
        current_head = self.current_head(worktree_root)
        if current_head == target_head and self.worktree_matches_commit(
            worktree_root, target_head
        ):
            return
        if not self.worktree_matches_commit(
            worktree_root,
            expected_projected_head,
        ):
            raise GitBackendError(
                "Project worktree contains external or uncheckpointed changes"
            )
        self._run(worktree_root, ("reset", "--hard", target_head))
        if not self.worktree_matches_commit(worktree_root, target_head):
            raise GitBackendError("Project worktree refresh did not converge")

    def ensure_worktree(
        self,
        repository_root: Path,
        *,
        worktree_path: Path,
        ref_name: str,
        commit_oid: str,
    ) -> GitWorktreeInfo:
        self._validate_eigent_ref(ref_name, branch_only=True)
        self._validate_object_name(commit_oid)
        root = repository_root.expanduser().resolve()
        destination = worktree_path.expanduser().resolve()
        if destination == root or root in destination.parents:
            raise GitBackendError(
                "Eigent worktrees must live outside the User Worktree"
            )
        existing_ref = self.ref_oid(root, ref_name)
        if existing_ref is None:
            self.update_eigent_ref(root, ref_name, commit_oid)
        elif existing_ref != commit_oid:
            raise GitBackendError(
                f"worktree ref {ref_name!r} points to another commit"
            )
        for item in self.list_worktrees(root):
            if item.path == destination:
                if item.ref_name != ref_name:
                    raise GitBackendError(
                        "worktree path is registered for another ref"
                    )
                return item
            if item.ref_name == ref_name:
                raise GitBackendError(
                    "Eigent ref is already checked out in another worktree"
                )
        if destination.exists():
            if not destination.is_dir() or any(destination.iterdir()):
                raise GitBackendError(
                    f"worktree destination is not empty: {destination}"
                )
        destination.parent.mkdir(parents=True, exist_ok=True)
        self._run(
            root,
            (
                "worktree",
                "add",
                str(destination),
                ref_name.removeprefix("refs/heads/"),
            ),
        )
        for item in self.list_worktrees(root):
            if item.path == destination and item.ref_name == ref_name:
                return item
        raise GitBackendError("Git did not register the requested worktree")

    def remove_owned_worktree(
        self,
        repository_root: Path,
        *,
        worktree_path: Path,
        expected_ref: str,
    ) -> None:
        self._validate_eigent_ref(expected_ref, branch_only=True)
        root = repository_root.expanduser().resolve()
        target = worktree_path.expanduser().resolve()
        if target == root or root in target.parents:
            raise GitBackendError("refusing to remove the User Worktree")
        registered = next(
            (
                item
                for item in self.list_worktrees(root)
                if item.path == target
            ),
            None,
        )
        if registered is None:
            if target.exists():
                raise GitBackendError(
                    "unregistered worktree path requires manual attention"
                )
            return
        if registered.ref_name != expected_ref:
            raise GitBackendError("worktree is registered for another ref")
        if not self.is_worktree_clean(target):
            raise GitBackendError("refusing to remove a dirty worktree")
        self._run(root, ("worktree", "remove", str(target)))
        if any(item.path == target for item in self.list_worktrees(root)):
            raise GitBackendError("Git did not remove the owned worktree")

    @staticmethod
    def _worktree_from_fields(fields: dict[str, str]) -> GitWorktreeInfo:
        return GitWorktreeInfo(
            path=Path(fields["worktree"]).expanduser().resolve(),
            head_oid=fields.get("HEAD") or None,
            ref_name=fields.get("branch") or None,
            detached="detached" in fields,
        )

    @staticmethod
    def _validate_eigent_ref(
        ref_name: str,
        *,
        branch_only: bool = False,
    ) -> None:
        allowed_prefixes = (
            ("refs/heads/eigent/",)
            if branch_only
            else ("refs/eigent/", "refs/heads/eigent/")
        )
        if not ref_name.startswith(allowed_prefixes) or not re.fullmatch(
            r"refs/(?:heads/)?eigent/[A-Za-z0-9._/-]+",
            ref_name,
        ):
            raise ValueError("ref must be inside an Eigent-owned namespace")

    def _operation_state(self, repository_root: Path) -> str:
        markers = (
            ("MERGE_HEAD", "merge"),
            ("rebase-merge", "rebase"),
            ("rebase-apply", "rebase"),
            ("CHERRY_PICK_HEAD", "cherry-pick"),
            ("REVERT_HEAD", "revert"),
        )
        for marker, state in markers:
            result = self._run(
                repository_root,
                ("rev-parse", "--git-path", marker),
            )
            path = Path(result.stdout.strip())
            if not path.is_absolute():
                path = repository_root / path
            if path.exists():
                return state
        return "clean"

    @staticmethod
    def _validate_object_name(value: str) -> None:
        if not re.fullmatch(r"[0-9a-fA-F]{4,64}", value):
            raise ValueError("Git object id must be hexadecimal")

    @staticmethod
    def _normalize_relative_git_path(value: str) -> str:
        path = PurePosixPath(value)
        if (
            not value
            or path.is_absolute()
            or ".." in path.parts
            or value.startswith(("~/", "\\\\"))
            or (len(value) > 1 and value[1] == ":")
        ):
            raise ValueError("Git path must stay inside the repository")
        normalized = path.as_posix()
        if normalized in {"", "."}:
            raise ValueError("Git path must name a file")
        return normalized

    def _relative_pathspecs(
        self,
        repository_root: Path,
        paths: tuple[Path, ...],
    ) -> tuple[str, ...]:
        if not paths:
            raise ValueError("at least one Git path is required")
        root = repository_root.expanduser().resolve()
        pathspecs: list[str] = []
        for path in paths:
            candidate = path.expanduser()
            if not candidate.is_absolute():
                candidate = root / candidate
            resolved = candidate.resolve()
            try:
                relative = resolved.relative_to(root)
            except ValueError as exc:
                raise GitBackendError(
                    f"Git path escapes repository root: {path}"
                ) from exc
            if not relative.parts:
                raise GitBackendError(
                    "repository root is not a valid pathspec"
                )
            pathspecs.append(relative.as_posix())
        return tuple(pathspecs)

    @staticmethod
    def _status_metadata(repository_root: Path, status_output: str) -> str:
        records = status_output.split("\0")
        metadata: list[str] = []
        skip_next = False
        for record in records:
            if not record:
                continue
            if skip_next:
                skip_next = False
                continue
            if len(record) < 4:
                continue
            state = record[:2]
            relative_path = record[3:]
            if "R" in state or "C" in state:
                skip_next = True
            path = repository_root / relative_path
            try:
                stat = path.lstat()
                value = (
                    f"{relative_path}\0{stat.st_mode}\0{stat.st_size}\0"
                    f"{stat.st_mtime_ns}\0{stat.st_ino}"
                )
            except FileNotFoundError:
                value = f"{relative_path}\0missing"
            metadata.append(value)
        return "\0".join(sorted(metadata))

    def assert_no_clean_filters(
        self,
        repository_root: Path,
        pathspecs: tuple[str, ...],
    ) -> None:
        attributes = self._run(
            repository_root,
            ("check-attr", "-a", "-z", "--", *pathspecs),
        ).stdout.split("\0")
        for index in range(0, len(attributes) - 2, 3):
            path, attribute, value = attributes[index : index + 3]
            if attribute == "filter" and value not in {
                "unspecified",
                "unset",
                "",
            }:
                raise GitBackendError(
                    f"refusing to execute clean filter {value!r} for {path!r}"
                )

    def _run(
        self,
        cwd: Path,
        args: tuple[str, ...],
        *,
        check: bool = True,
        identity: tuple[str, str] | None = None,
        input_text: str | None = None,
    ) -> GitCommandResult:
        environment = self._environment(identity=identity)
        command = self._command(cwd, args)
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                input=input_text,
                timeout=self.timeout_seconds,
                env=environment,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise GitBackendError(
                f"failed to execute typed Git operation: {args[0]}"
            ) from exc
        stdout = completed.stdout[: self.max_output_chars]
        stderr = completed.stderr[: self.max_output_chars]
        if check and completed.returncode != 0:
            raise GitCommandError(
                args=args,
                returncode=completed.returncode,
                stderr=stderr.strip(),
            )
        return GitCommandResult(
            stdout=stdout,
            stderr=stderr,
            returncode=completed.returncode,
        )

    def _environment(
        self,
        *,
        identity: tuple[str, str] | None = None,
    ) -> dict[str, str]:
        environment: dict[str, str] = dict(os.environ)
        for key in tuple(environment):
            if (
                key in _UNSAFE_INHERITED_GIT_ENV
                or key.startswith("GIT_AUTHOR_")
                or key.startswith("GIT_COMMITTER_")
                or key.startswith("GIT_CONFIG_KEY_")
                or key.startswith("GIT_CONFIG_VALUE_")
            ):
                environment.pop(key)
        environment.update(
            {
                "GIT_EDITOR": "true",
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_LITERAL_PATHSPECS": "1",
                "GIT_MERGE_AUTOEDIT": "no",
                "GIT_PAGER": "cat",
                "GIT_SEQUENCE_EDITOR": "true",
                "GIT_TERMINAL_PROMPT": "0",
                "LC_ALL": "C",
                "PAGER": "cat",
            }
        )
        if identity is not None:
            name, email = identity
            environment.update(
                {
                    "GIT_AUTHOR_NAME": name,
                    "GIT_AUTHOR_EMAIL": email,
                    "GIT_COMMITTER_NAME": name,
                    "GIT_COMMITTER_EMAIL": email,
                }
            )
        return environment

    def _command(self, cwd: Path, args: tuple[str, ...]) -> tuple[str, ...]:
        return (
            self.git_executable,
            "-c",
            f"core.hooksPath={self.hooks_path}",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "-c",
            "protocol.ext.allow=never",
            "-c",
            "protocol.file.allow=never",
            "-C",
            str(cwd),
            *args,
        )
