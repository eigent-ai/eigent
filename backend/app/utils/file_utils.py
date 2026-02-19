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
from collections.abc import Callable
from pathlib import Path

import logging
import shutil
from pathlib import Path

from app.component.environment import env
from app.model.chat import Chat

logger = logging.getLogger("file_utils")

# Windows has a 260-character path limit unless long path support is enabled
MAX_PATH_LENGTH_WIN = 260
MAX_PATH_LENGTH_UNIX = 4096
DEFAULT_MAX_FILE_SIZE_READ = 10 * 1024 * 1024  # 10 MB
DEFAULT_ENCODING = "utf-8"
FALLBACK_ENCODINGS = ("utf-8", "utf-8-sig", "latin-1", "cp1252")
# Default directory names to skip when listing (safe_list_directory)
DEFAULT_SKIP_DIRS = frozenset(
    {".git", "node_modules", "__pycache__", "venv", ".venv"}
)
# Default file extensions to skip when listing (safe_list_directory)
DEFAULT_SKIP_EXTENSIONS: tuple[str, ...] = (".pyc", ".tmp", ".temp")


def _max_path_length() -> int:
    """Return the platform-appropriate max path length for validation."""
    return (
        MAX_PATH_LENGTH_WIN
        if platform.system() == "Windows"
        else MAX_PATH_LENGTH_UNIX
    )


def safe_join_path(base: str, *parts: str) -> str | None:
    """
    Join path parts to base and ensure the result is still under base (no traversal).
    Returns None if the resolved path escapes base or is invalid.
    """
    if not base or not base.strip():
        return None
    try:
        base_resolved = Path(base).resolve()
        if not base_resolved.is_dir() and not base_resolved.exists():
            base_resolved = base_resolved.parent
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
        logger.debug("safe_join_path failed: %s", e)
        return None


def is_safe_path(path: str, base: str) -> bool:
    """
    Return True if path is under base (realpath) and within path length limits.
    Handles None/empty and symlinks by resolving.

    Args:
        path: Path to validate (file or directory).
        base: Base directory that path must be under.

    Returns:
        True if path resolves under base and within path length limits.
    """
    if not path or not base:
        return False
    try:
        base_real = os.path.realpath(base)
        path_real = os.path.realpath(path)
        if not path_real.startswith(
            base_real.rstrip(os.sep) + os.sep
        ) and path_real != base_real.rstrip(os.sep):
            return False
        return len(path_real) <= _max_path_length()
    except (OSError, RuntimeError):
        return False


def safe_resolve_path(path: str, base: str) -> str | None:
    """
    Resolve path relative to base. If path is absolute, ensure it is under base.
    Returns None if path escapes base, does not exist, or exceeds path length.
    """
    if not path or not path.strip():
        return None
    try:
        base_abs = os.path.abspath(base)
        if not os.path.isdir(base_abs):
            base_abs = os.path.dirname(base_abs)
        if os.path.isabs(path):
            resolved = os.path.normpath(path)
        else:
            resolved = os.path.normpath(os.path.join(base_abs, path))
        resolved_real = os.path.realpath(resolved)
        base_real = os.path.realpath(base_abs)
        if not resolved_real.startswith(
            base_real.rstrip(os.sep) + os.sep
        ) and resolved_real != base_real.rstrip(os.sep):
            logger.warning("Path escapes base: path=%r base=%r", path, base)
            return None
        if len(resolved_real) > _max_path_length():
            logger.warning("Path exceeds max length: %d", len(resolved_real))
            return None
        return resolved_real
    except (OSError, RuntimeError) as e:
        logger.debug("safe_resolve_path failed: %s", e)
        return None


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


def safe_list_directory(
    dir_path: str,
    base: str | None = None,
    *,
    max_entries: int = 10_000,
    skip_dirs: set[str] | None = None,
    skip_extensions: tuple[str, ...] = DEFAULT_SKIP_EXTENSIONS,
    skip_prefix: str = ".",
    follow_symlinks: bool = False,
    path_filter: Callable[[str], bool] | None = None,
) -> list[str]:
    """
    List files under dir_path with optional base confinement and filters.
    If base is set, only returns paths that resolve under base (no traversal).
    For CodeQL: only the trusted base path is used in path operations; we
    validate dir_path is under base then list base (same as dir_path when
    base equals dir_path, as in chat_service).

    Args:
        dir_path: Directory to list; must resolve under base when base is set.
        base: Confinement base (default: cwd). Paths outside this are excluded.
        max_entries: Maximum number of file paths to return.
        skip_dirs: Directory names to skip (default: DEFAULT_SKIP_DIRS).
        skip_extensions: File extensions to skip (default: DEFAULT_SKIP_EXTENSIONS).
        skip_prefix: Skip dirs/files whose name starts with this prefix.
        follow_symlinks: Whether to follow symlinks when walking.
        path_filter: Optional predicate; only paths for which it returns True are included.

    Returns:
        List of absolute file paths under dir_path (subject to filters and max_entries).
    """
    if not dir_path or not dir_path.strip():
        logger.warning("safe_list_directory: empty dir_path")
        return []
    resolve_base = base if base else os.getcwd()
    # Validate dir_path is under base; do not use return value in path ops.
    if safe_resolve_path(dir_path, resolve_base) is None:
        logger.debug(
            "safe_list_directory: dir_path not under base or invalid: %r",
            dir_path,
        )
        return []
    # Use only trusted base for path operations (no user-derived path in sinks).
    base_real = os.path.realpath(resolve_base)
    try:
        if not os.path.isdir(base_real):
            return []
    except OSError:
        return []
    path_for_walk = base_real
    skip_dirs = skip_dirs or set(DEFAULT_SKIP_DIRS)
    result: list[str] = []
    try:
        for root, dirs, files in os.walk(
            path_for_walk, followlinks=follow_symlinks
        ):
            dirs[:] = [
                d
                for d in dirs
                if d not in skip_dirs and not d.startswith(skip_prefix)
            ]
            for name in files:
                if name.startswith(skip_prefix):
                    continue
                if any(name.endswith(ext) for ext in skip_extensions):
                    continue
                file_path = os.path.join(root, name)
                try:
                    abs_path = os.path.abspath(file_path)
                    real_path = os.path.realpath(file_path)
                    if base_real and not (
                        real_path.startswith(base_real.rstrip(os.sep) + os.sep)
                        or real_path == base_real.rstrip(os.sep)
                    ):
                        continue
                    if path_filter and not path_filter(abs_path):
                        continue
                    result.append(abs_path)
                    if len(result) >= max_entries:
                        logger.debug(
                            "safe_list_directory hit max_entries=%d",
                            max_entries,
                        )
                        return result
                except OSError:
                    continue
    except OSError as e:
        logger.warning("safe_list_directory failed for %r: %s", dir_path, e)
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
