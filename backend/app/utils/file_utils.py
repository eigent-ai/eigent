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
import tempfile
from collections.abc import Callable
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


def normalize_working_path(path: str | None) -> str:
    """
    Normalize and validate a working directory path.
    Returns a safe default (user home or cwd) if path is None, empty, or invalid.
    """
    if not path or not str(path).strip():
        fallback = os.path.expanduser("~")
        logger.debug("Empty working path, using fallback: %s", fallback)
        return fallback
    path = str(path).strip()
    try:
        resolved = os.path.abspath(os.path.expanduser(path))
        if len(resolved) > _max_path_length():
            logger.warning("Working path too long, using parent: %s", resolved)
            resolved = str(Path(resolved).parent)
        if not os.path.exists(resolved):
            parent = os.path.dirname(resolved)
            if parent and parent != resolved and os.path.isdir(parent):
                return parent
            return os.path.expanduser("~")
        return (
            resolved if os.path.isdir(resolved) else str(Path(resolved).parent)
        )
    except (OSError, RuntimeError) as e:
        logger.warning("Invalid working path %r: %s", path, e)
        return os.path.expanduser("~")


def safe_list_directory(
    dir_path: str,
    base: str | None = None,
    *,
    max_entries: int = 10_000,
    skip_dirs: set[str] | None = None,
    skip_extensions: tuple[str, ...] = (".pyc", ".tmp", ".temp"),
    skip_prefix: str = ".",
    follow_symlinks: bool = False,
    path_filter: Callable[[str], bool] | None = None,
) -> list[str]:
    """
    List files under dir_path with optional base confinement and filters.
    If base is set, only returns paths that resolve under base (no traversal).
    Returns list of absolute file paths; skips directories matching skip_dirs
    and files starting with skip_prefix or ending with skip_extensions.

    dir_path is validated against base (or cwd when base is None) before use
    to satisfy path safety; only the resolved, confined path is used for I/O.
    """
    if not dir_path or not dir_path.strip():
        return []
    # Validate user-provided dir_path: resolve under base (or cwd) so path is confined
    resolve_base = base if base else os.getcwd()
    validated_dir = safe_resolve_path(dir_path, resolve_base)
    if validated_dir is None:
        logger.debug(
            "safe_list_directory: dir_path not under base or invalid: %r",
            dir_path,
        )
        return []
    if not os.path.isdir(validated_dir):
        return []
    skip_dirs = skip_dirs or {
        ".git",
        "node_modules",
        "__pycache__",
        "venv",
        ".venv",
    }
    base_real = os.path.realpath(resolve_base)
    result: list[str] = []
    try:
        for root, dirs, files in os.walk(
            validated_dir, followlinks=follow_symlinks
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


def safe_read_file(
    path: str,
    base: str | None = None,
    max_size: int = DEFAULT_MAX_FILE_SIZE_READ,
    encoding: str = DEFAULT_ENCODING,
) -> str | None:
    """
    Read file content with path confinement, size limit, and encoding fallback.
    Returns None on path escape, OSError, or size exceed.
    """
    if base and not is_safe_path(path, base):
        logger.warning("safe_read_file: path not under base: %r", path)
        return None
    path_to_use = path
    if base and not os.path.isabs(path):
        joined = safe_join_path(base, path)
        if joined is None:
            return None
        path_to_use = joined
    if not os.path.isfile(path_to_use):
        return None
    try:
        size = os.path.getsize(path_to_use)
        if size > max_size:
            logger.warning(
                "safe_read_file: file too large %d > %d", size, max_size
            )
            return None
        for enc in (encoding,) + FALLBACK_ENCODINGS:
            if enc == encoding and enc in FALLBACK_ENCODINGS:
                continue
            try:
                with open(path_to_use, encoding=enc) as f:
                    return f.read()
            except (UnicodeDecodeError, LookupError):
                continue
        return None
    except OSError as e:
        logger.debug("safe_read_file failed: %s", e)
        return None


def safe_write_file(
    path: str,
    content: str,
    base: str | None = None,
    encoding: str = DEFAULT_ENCODING,
    create_dirs: bool = True,
) -> bool:
    """
    Write content to path with optional base confinement.
    Returns False on path escape or OSError.
    """
    if base and not os.path.isabs(path):
        resolved = safe_resolve_path(path, base)
        if resolved is None:
            return False
        path = resolved
    elif base and not is_safe_path(path, base):
        return False
    try:
        parent = os.path.dirname(path)
        if parent and create_dirs and not os.path.isdir(parent):
            os.makedirs(parent, exist_ok=True)
        with open(path, "w", encoding=encoding) as f:
            f.write(content)
        return True
    except OSError as e:
        logger.warning("safe_write_file failed: %s", e)
        return False


def create_temp_dir(
    prefix: str = "eigent_", base: str | None = None
) -> str | None:
    """
    Create a temporary directory. If base is set, it must exist and be a directory;
    the temp dir will be created under base. Returns None on failure.
    """
    try:
        if base and os.path.isdir(base):
            return tempfile.mkdtemp(prefix=prefix, dir=base)
        return tempfile.mkdtemp(prefix=prefix)
    except OSError as e:
        logger.warning("create_temp_dir failed: %s", e)
        return None


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

    raw: str
    if (
        task_lock
        and hasattr(task_lock, "new_folder_path")
        and task_lock.new_folder_path
    ):
        raw = str(task_lock.new_folder_path)
    else:
        raw = env("file_save_path", options.file_save_path())

    return normalize_working_path(raw)
