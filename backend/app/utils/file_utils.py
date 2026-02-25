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

"""File system utilities with robust path handling and edge-case safety."""

import logging
import os
import platform
import shutil
from pathlib import Path

from app.component.environment import env
from app.exception.exception import PathEscapesBaseError
from app.model.chat import Chat

logger = logging.getLogger("file_utils")

# Windows has a 260-character path limit unless long path support is enabled
MAX_PATH_LENGTH_WIN = 260
MAX_PATH_LENGTH_UNIX = 4096
# Default directory names to skip when listing (list_files)
DEFAULT_SKIP_DIRS = frozenset(
    {".git", "node_modules", "__pycache__", "venv", ".venv"}
)
# Default file extensions to skip when listing (list_files)
DEFAULT_SKIP_EXTENSIONS: tuple[str, ...] = (".pyc", ".tmp", ".temp")


def _max_path_length() -> int:
    """Return the platform-appropriate max path length for validation."""
    return (
        MAX_PATH_LENGTH_WIN
        if platform.system() == "Windows"
        else MAX_PATH_LENGTH_UNIX
    )


def _is_under_base(path_real: str, base_real: str) -> bool:
    """Return True if path_real is at or under base_real (both already realpath'd)."""
    base = base_real.rstrip(os.sep)
    return path_real.startswith(base + os.sep) or path_real == base


def _should_skip(
    name: str,
    skip_prefix: str,
    skip_extensions: tuple[str, ...] = (),
) -> bool:
    """Return True if a file or directory name should be excluded from listing."""
    if name.startswith(skip_prefix):
        return True
    return any(name.endswith(ext) for ext in skip_extensions)


def join_under_base(base: str, *parts: str) -> str | None:
    """Join path parts onto base, ensuring the result stays under base.

    Args:
        base (str): Base directory; must exist as a directory.
        *parts (str): Path components to join onto base.

    Returns:
        str | None: Resolved absolute path if valid and under base, None otherwise.
    """
    if not base or not base.strip():
        return None
    try:
        base_resolved = Path(base).resolve()
        if not base_resolved.is_dir():
            return None
        combined = base_resolved
        for p in parts:
            if p is None or (isinstance(p, str) and ".." in p.split(os.sep)):
                return None
            combined = combined / p
        resolved = combined.resolve()
        try:
            resolved.relative_to(base_resolved)
        except ValueError:
            return None
        if len(str(resolved)) > _max_path_length():
            return None
        return str(resolved)
    except (OSError, RuntimeError) as e:
        logger.debug("join_under_base failed: %s", e)
        return None


def is_safe_path(path: str, base: str) -> bool:
    """Return True if path is under base (realpath) and within path length limits.

    Args:
        path (str): Path to validate (file or directory).
        base (str): Base directory that path must be under.

    Returns:
        bool: True if path resolves under base and within path length limits.
    """
    if not path or not base:
        return False
    try:
        base_real = os.path.realpath(base)
        path_real = os.path.realpath(path)
        if not _is_under_base(path_real, base_real):
            return False
        return len(path_real) <= _max_path_length()
    except (OSError, RuntimeError):
        return False


def resolve_under_base(path: str, base: str) -> str:
    """Resolve path and verify it stays under base. Raises if it escapes.

    Args:
        path (str): Path to resolve (relative or absolute).
        base (str): Base directory that path must be confined to.

    Returns:
        str: Resolved real path.

    Raises:
        ValueError: If path is empty or whitespace.
        PathEscapesBaseError: If path resolves outside base or exceeds path length.
        OSError: If path resolution fails due to filesystem error.
    """
    if not path or not path.strip():
        raise ValueError(f"Path must be non-empty, got: {path!r}")
    base_abs = os.path.abspath(base)
    if not os.path.isdir(base_abs):
        raise PathEscapesBaseError(f"Base is not a directory: {base!r}")
    resolved = os.path.normpath(os.path.join(base_abs, path))
    resolved_real = os.path.realpath(resolved)
    base_real = os.path.realpath(base_abs)
    if not _is_under_base(resolved_real, base_real):
        raise PathEscapesBaseError(
            f"Path escapes base: path={path!r} base={base!r}"
        )
    if len(resolved_real) > _max_path_length():
        raise PathEscapesBaseError(
            f"Path exceeds max length ({len(resolved_real)}): {resolved_real!r}"
        )
    return resolved_real


def normalize_working_path(path: str | Path | None) -> str:
    """
    Normalize and validate a working directory path using pathlib.
    Requires a non-empty path; raises ValueError if path is None or empty.
    For invalid or nonexistent paths, falls back to parent or user home.

    Args:
        path: Working directory path (str or Path). Must be specified.

    Returns:
        Absolute, resolved directory path as a string.

    Raises:
        ValueError: If path is None or empty/whitespace.
    """
    if path is None or not str(path).strip():
        raise ValueError("Working directory path must be specified.")
    p = Path(path).expanduser().resolve()
    try:
        if len(str(p)) > _max_path_length():
            logger.warning("Working path too long, using parent: %s", p)
            p = p.parent
        if not p.exists():
            if p.parent.exists() and p.parent.is_dir():
                return str(p.parent)
            return str(Path.home())
        if p.is_dir():
            return str(p)
        return str(p.parent)
    except (OSError, RuntimeError) as e:
        logger.warning("Invalid working path %r: %s", path, e)
        return str(Path.home())


def list_files(
    dir_path: str,
    base: str | None = None,
    *,
    max_entries: int = 10_000,
    skip_dirs: set[str] | None = None,
    skip_extensions: tuple[str, ...] = DEFAULT_SKIP_EXTENSIONS,
    skip_prefix: str = ".",
) -> list[str]:
    """List files under dir_path with optional base confinement and filters.
    If base is set, only returns paths that resolve under base (no traversal).

    Args:
        dir_path (str): Directory to list; must resolve under base when base is set.
        base (str | None): Confinement base (default: cwd). Paths outside this are excluded.
        max_entries (int): Maximum number of file paths to return.
        skip_dirs (set[str] | None): Directory names to skip (default: DEFAULT_SKIP_DIRS).
        skip_extensions (tuple[str, ...]): File extensions to skip (default: DEFAULT_SKIP_EXTENSIONS).
        skip_prefix (str): Skip dirs/files whose name starts with this prefix.

    Returns:
        List of real absolute file paths under dir_path (subject to filters and max_entries).
    """
    if not dir_path or not dir_path.strip():
        logger.warning("list_files: empty dir_path")
        return []
    resolve_base = base if base else os.getcwd()
    try:
        resolved_dir = resolve_under_base(dir_path, resolve_base)
    except PathEscapesBaseError as e:
        logger.warning("list_files: %s", e)
        return []
    except (ValueError, OSError) as e:
        logger.warning("list_files: invalid dir_path %r: %s", dir_path, e)
        return []
    try:
        if not os.path.isdir(resolved_dir):
            return []
    except OSError:
        return []
    base_real = os.path.realpath(resolve_base)
    skip_dirs = set(DEFAULT_SKIP_DIRS) if skip_dirs is None else skip_dirs
    result: list[str] = []
    try:
        for root, dirs, files in os.walk(resolved_dir, followlinks=False):
            dirs[:] = [
                d
                for d in dirs
                if d not in skip_dirs and not _should_skip(d, skip_prefix)
            ]
            for name in files:
                if _should_skip(name, skip_prefix, skip_extensions):
                    continue
                try:
                    file_path = os.path.join(root, name)
                    real_path = os.path.realpath(file_path)
                    if not _is_under_base(real_path, base_real):
                        logger.debug(
                            "list_files: skipping %r (escapes base)", file_path
                        )
                        continue
                    result.append(real_path)
                    if len(result) >= max_entries:
                        logger.debug(
                            "list_files hit max_entries=%d", max_entries
                        )
                        return result
                except OSError:
                    continue
    except OSError as e:
        logger.warning("list_files failed for %r: %s", dir_path, e)
    return result


def get_working_directory(options: Chat, task_lock=None) -> str:
    """
    Get the correct working directory for file operations.
    First checks if there's an updated path from improve API call,
    then falls back to environment variable or default path.
    Result is normalized for safety (traversal, length, existence).
    """
    if not task_lock:
        from app.service.task import get_task_lock_if_exists

        task_lock = get_task_lock_if_exists(options.project_id)

    raw: Path | str
    if (
        task_lock
        and hasattr(task_lock, "new_folder_path")
        and task_lock.new_folder_path
    ):
        raw = Path(task_lock.new_folder_path)
    else:
        raw = Path(env("file_save_path", options.file_save_path()))

    return normalize_working_path(raw)


def sync_eigent_skills_to_project(working_directory: str) -> None:
    """
    Copy skills from ~/.eigent/skills into the project's .eigent/skills
    so the agent can load and execute them from the project working directory.
    """
    src = Path.home() / ".eigent" / "skills"
    dst = Path(working_directory) / ".eigent" / "skills"
    if not src.is_dir():
        return
    try:
        dst.mkdir(parents=True, exist_ok=True)
        for skill_dir in src.iterdir():
            if skill_dir.is_dir():
                dest_skill = dst / skill_dir.name
                if dest_skill.exists():
                    shutil.rmtree(dest_skill)
                shutil.copytree(skill_dir, dest_skill)
        logger.debug(
            "Synced eigent skills to project",
            extra={
                "working_directory": working_directory,
                "destination": str(dst),
            },
        )
    except OSError as e:
        logger.warning(
            "Failed to sync ~/.eigent/skills to project %s: %s",
            working_directory,
            e,
            exc_info=True,
        )
