"""Bounded metadata probes, with no process execution or workspace mutation.

PATH lookup observes the worker's executable search path. Explicit operands and
numbered-file inspection are confined to the supplied workspace; discovering a
command or configured runtime location never grants access or execution rights.
"""

from __future__ import annotations

import os
import re
import stat
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import Any

_MAX_COMMANDS = 32
_MAX_SEQUENCE_FILES = 10_000
_SAMPLE_SIZE = 20
_COMMAND_NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.+-]{0,255}\Z")
_NUMBERED_FILENAME = re.compile(r"[^%/\\]*(?:%d|%0[1-9]d)[^%/\\]*\Z")
_HAS_SCOPED_DIRECTORY_FDS = (
    hasattr(os, "O_NOFOLLOW")
    and hasattr(os, "O_DIRECTORY")
    and os.open in os.supports_dir_fd
    and os.stat in os.supports_dir_fd
    and os.stat in os.supports_follow_symlinks
)
_STORAGE_PURPOSES = {
    "EIGENT_RUNTIME_DIR": "toolchains and dependencies",
    "EIGENT_CACHE_DIR": "runtime caches",
    "EIGENT_INTERMEDIATE_DIR": "recoverable intermediate files",
}
_GUIDANCE = (
    "This is a metadata snapshot, not execution or filesystem authorization. "
    "No command, version probe, login shell, download, install, copy, or render "
    "was run. A command missing from the worker PATH may exist in a login "
    "shell; a shell installation does not update an already running worker. "
    "Ask for explicit user confirmation before downloading/installing tools, "
    "copying recovery files, changing PATH, or requesting a new access root. "
    "Use a real directory inside the current workspace, for example "
    "output/resume_frames, for an authorized recovery handoff. Do not link an "
    "external temporary directory into the workspace or broaden an allowlist. "
    "Runtime/cache/intermediate locations are supplied by the runtime owner; "
    "their presence here does not authorize inspection or writes. Keep final "
    "deliverables in the workspace. Before reusing a complete sequence, verify "
    "its provenance, render settings and file contents through authorized "
    "tools; then continue the remaining assembly step without re-rendering "
    "the existing frames. An incomplete sequence needs review, not an "
    "automatic full re-render. Do not rewrite prior failed or unknown outcomes."
)


class _ScopeError(Exception):
    def __init__(self, status: str):
        self.status = status


def _relative_operand(root: Path, operand: str) -> Path:
    if not operand or "\x00" in operand or len(operand) > 4096:
        raise _ScopeError("invalid_path")
    path = Path(operand)
    if ".." in path.parts or operand.startswith("~"):
        raise _ScopeError("outside_workspace")
    if path.is_absolute():
        try:
            path = path.relative_to(root)
        except ValueError:
            raise _ScopeError("outside_workspace") from None
    if len(path.parts) > 64:
        raise _ScopeError("invalid_path")
    return path


def _is_link(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0)
        & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    )


@contextmanager
def _directory_fd(root: Path, operand: str) -> Iterator[tuple[int, Path]]:
    """Walk from a trusted root without following links, retaining directory fds.

    Keeping the descriptor also prevents a directory replacement during the
    sequence scan from redirecting later probes outside the workspace. Hosts
    without these primitives fail closed instead of using host/path fallbacks.
    """
    relative = _relative_operand(root, operand)
    if not _HAS_SCOPED_DIRECTORY_FDS:
        raise _ScopeError("unsupported_platform")
    descriptors: list[int] = []
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        if _is_link(os.lstat(root)):
            raise _ScopeError("symlink_rejected")
        fd = os.open(root, flags)
        descriptors.append(fd)
        for part in relative.parts:
            info = os.stat(part, dir_fd=fd, follow_symlinks=False)
            if _is_link(info):
                raise _ScopeError("symlink_rejected")
            fd = os.open(part, flags, dir_fd=fd)
            descriptors.append(fd)
        yield fd, root / relative
    except FileNotFoundError:
        raise _ScopeError("missing") from None
    except NotADirectoryError:
        raise _ScopeError("not_directory") from None
    except OSError:
        raise _ScopeError("unreadable") from None
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def _command_probe(
    root: Path, environment: Mapping[str, str] | None, command: str
) -> dict[str, Any]:
    result: dict[str, Any] = {"command": command, "version_checked": False}
    if len(command) > 4096 or "\x00" in command:
        return {**result, "status": "invalid_command"}
    if "/" in command or "\\" in command:
        try:
            relative = _relative_operand(root, command)
            with _directory_fd(root, str(relative.parent)) as (fd, parent):
                info = os.stat(relative.name, dir_fd=fd, follow_symlinks=False)
                if _is_link(info):
                    return {**result, "status": "symlink_rejected"}
                if not stat.S_ISREG(info.st_mode) or not info.st_mode & 0o111:
                    return {**result, "status": "not_executable"}
                return {
                    **result,
                    "status": "found_in_workspace",
                    "path": str(parent / relative.name),
                }
        except _ScopeError as error:
            return {**result, "status": error.status}
    if not _COMMAND_NAME.fullmatch(command):
        return {**result, "status": "invalid_command"}
    if environment is None or "PATH" not in environment:
        return {**result, "status": "path_unavailable"}
    search_path = environment["PATH"]
    if "\x00" in search_path:
        return {**result, "status": "invalid_worker_path"}
    if len(search_path) > 32_768 or len(search_path.split(os.pathsep)) > 256:
        return {**result, "status": "path_too_large"}
    # Never use shutil.which's implicit process PATH or launch a login shell.
    # Resolve relative PATH entries against the worker cwd, not this process cwd.
    if os.name == "nt":
        return {**result, "status": "unsupported_platform"}
    for entry in search_path.split(os.pathsep):
        directory = Path(entry)
        if not directory.is_absolute():
            directory = root / directory
        candidate = directory / command
        try:
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return {
                    **result,
                    "status": "found_on_worker_path",
                    "path": str(candidate),
                    "probe_scope": "worker_path_metadata_only",
                }
        except OSError:
            continue
    return {**result, "status": "not_found"}


def _sequence_probe(
    fd: int, pattern: str, start: int, end: int | None
) -> dict[str, Any]:
    if (
        not _NUMBERED_FILENAME.fullmatch(pattern)
        or "\x00" in pattern
        or len(pattern) > 255
        or not isinstance(start, int)
        or isinstance(start, bool)
        or not isinstance(end, int)
        or isinstance(end, bool)
        or not 0 <= start <= end <= 1_000_000_000
        or end - start + 1 > _MAX_SEQUENCE_FILES
    ):
        return {
            "status": "invalid_request",
            "guidance": (
                "Supply a single filename with one %d or %0Nd placeholder "
                "(N=1..9) and an inclusive range of at most 10000 files."
            ),
        }
    missing: list[int] = []
    invalid: list[int] = []
    present = missing_count = invalid_count = 0
    for number in range(start, end + 1):
        try:
            info = os.stat(pattern % number, dir_fd=fd, follow_symlinks=False)
            if (
                _is_link(info)
                or not stat.S_ISREG(info.st_mode)
                or info.st_size == 0
            ):
                invalid_count += 1
                if len(invalid) < _SAMPLE_SIZE:
                    invalid.append(number)
            else:
                present += 1
        except FileNotFoundError:
            missing_count += 1
            if len(missing) < _SAMPLE_SIZE:
                missing.append(number)
        except OSError:
            invalid_count += 1
            if len(invalid) < _SAMPLE_SIZE:
                invalid.append(number)
    complete = missing_count == invalid_count == 0
    return {
        "status": "complete" if complete else "incomplete",
        "validation": "regular_nonempty_files_only",
        "filename_pattern": pattern,
        "start_number": start,
        "end_number": end,
        "expected_count": end - start + 1,
        "present_count": present,
        "missing_count": missing_count,
        "invalid_count": invalid_count,
        "missing_sample": missing,
        "invalid_sample": invalid,
        "next_action": (
            "reuse_existing_sequence"
            if complete
            else "review_missing_or_invalid_files"
        ),
    }


def inspect_toolchain(
    *,
    working_directory: Path,
    worker_environment: Mapping[str, str] | None,
    commands: list[str],
    directory: str | None = None,
    filename_pattern: str | None = None,
    start_number: int = 1,
    end_number: int | None = None,
) -> dict[str, Any]:
    """Inspect requested metadata without running or authorizing work."""
    root = Path(os.path.abspath(working_directory))
    report: dict[str, Any] = {
        "execution_authorized": False,
        "working_directory": str(root),
        "environment_source": "worker_environment",
        "login_shell_checked": False,
        "guidance": _GUIDANCE,
        "storage": {
            key: {
                "purpose": purpose,
                "status": "configured_uninspected"
                if worker_environment and worker_environment.get(key)
                else "not_supplied",
                "path": (
                    worker_environment.get(key) if worker_environment else None
                ),
            }
            for key, purpose in _STORAGE_PURPOSES.items()
        },
    }
    if len(commands) > _MAX_COMMANDS:
        report["commands"] = []
        report["command_error"] = (
            "Request at most 32 executable names or paths."
        )
    else:
        report["commands"] = [
            _command_probe(root, worker_environment, command)
            for command in commands
        ]
    try:
        with _directory_fd(
            root, directory if directory is not None else "."
        ) as (fd, path):
            report["directory"] = {
                "status": "ready",
                "path": str(path),
                "write_test_performed": False,
            }
            if filename_pattern is not None:
                report["sequence"] = _sequence_probe(
                    fd, filename_pattern, start_number, end_number
                )
    except _ScopeError as error:
        report["directory"] = {"status": error.status}
        if filename_pattern is not None:
            report["sequence"] = {"status": "not_inspected"}
    return report
