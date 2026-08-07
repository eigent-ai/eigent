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

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

_UNSAFE_INHERITED_GIT_ENV = {
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_WORK_TREE",
}


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


class NestedRepositoryError(GitBackendError):
    """Raised when init would silently create a nested repository."""


@dataclass(frozen=True)
class GitCommandResult:
    stdout: str
    stderr: str
    returncode: int


@dataclass(frozen=True)
class RepositoryProbe:
    requested_root: Path
    is_repository: bool
    repository_root: Path | None
    owns_requested_root: bool
    nested_in_parent: bool
    head_oid: str | None
    branch: str | None


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

    def current_head(self, repository_root: Path) -> str | None:
        result = self._run(
            repository_root,
            ("rev-parse", "--verify", "HEAD"),
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else None

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
            resolved = path.expanduser().resolve()
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

    def _run(
        self,
        cwd: Path,
        args: tuple[str, ...],
        *,
        check: bool = True,
        identity: tuple[str, str] | None = None,
    ) -> GitCommandResult:
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
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_LITERAL_PATHSPECS": "1",
                "GIT_TERMINAL_PROMPT": "0",
                "LC_ALL": "C",
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
        command = (
            self.git_executable,
            "-c",
            f"core.hooksPath={self.hooks_path}",
            "-C",
            str(cwd),
            *args,
        )
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
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
