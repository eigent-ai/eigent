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

"""
Markdown-based long-term memory for agents (issue #1099).

Stores project knowledge in a simple .eigent/memory.md file that agents
can both read and write using standard file operations.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Final

logger = logging.getLogger("memory_file")

_LOCK: Final[threading.Lock] = threading.Lock()
_MEMORY_FILENAME: Final[str] = "memory.md"
_EIGENT_DIR: Final[str] = ".eigent"
_DEFAULT_HEADER: Final[str] = "# Project Memory\n\nLong-term memory for this project.\n"
_MAX_ENTRY_LENGTH: Final[int] = 10000


class MemoryFileError(Exception):
    """Base exception for memory file operations."""

    pass


class MemoryReadError(MemoryFileError):
    """Raised when reading memory file fails."""

    pass


class MemoryWriteError(MemoryFileError):
    """Raised when writing memory file fails."""

    pass


def _validate_working_directory(working_directory: str) -> Path:
    """Validate and return the working directory as a Path object."""
    if not working_directory or not working_directory.strip():
        raise ValueError("working_directory cannot be empty")
    path = Path(working_directory).expanduser().resolve()
    if not path.exists():
        raise ValueError(f"working_directory does not exist: {path}")
    if not path.is_dir():
        raise ValueError(f"working_directory is not a directory: {path}")
    return path


def _validate_content(content: str, max_length: int = _MAX_ENTRY_LENGTH) -> str:
    """Validate and sanitize content for storage."""
    if not content or not content.strip():
        raise ValueError("content cannot be empty")
    content = content.strip()
    if len(content) > max_length:
        raise ValueError(f"content exceeds maximum length of {max_length} characters")
    return content


def get_memory_file_path(working_directory: str) -> Path:
    """Get the path to the memory file for a project."""
    base_path = _validate_working_directory(working_directory)
    eigent_dir = base_path / _EIGENT_DIR
    eigent_dir.mkdir(parents=True, exist_ok=True)
    return eigent_dir / _MEMORY_FILENAME


def read_memory(working_directory: str) -> str | None:
    """Read the memory file content."""
    try:
        memory_path = get_memory_file_path(working_directory)
    except ValueError as e:
        logger.warning(f"Invalid working directory: {e}")
        return None

    if not memory_path.exists():
        return None

    try:
        content = memory_path.read_text(encoding="utf-8")
        return content if content.strip() else None
    except OSError as e:
        logger.error(f"Failed to read memory file {memory_path}: {e}")
        return None


def write_memory(working_directory: str, content: str) -> bool:
    """Write content to the memory file (overwrites existing content)."""
    try:
        memory_path = get_memory_file_path(working_directory)
        validated_content = _validate_content(content, max_length=_MAX_ENTRY_LENGTH * 10)
    except ValueError as e:
        logger.error(f"Validation failed: {e}")
        return False

    with _LOCK:
        try:
            memory_path.write_text(validated_content, encoding="utf-8")
            logger.info(f"Memory file updated", extra={"path": str(memory_path)})
            return True
        except OSError as e:
            logger.error(f"Failed to write memory file: {e}")
            return False


def append_memory(working_directory: str, entry: str) -> bool:
    """Append an entry to the memory file with timestamp."""
    try:
        memory_path = get_memory_file_path(working_directory)
        validated_entry = _validate_content(entry)
    except ValueError as e:
        logger.error(f"Validation failed: {e}")
        return False

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    formatted_entry = f"\n## {timestamp}\n\n{validated_entry}\n"

    with _LOCK:
        try:
            if not memory_path.exists():
                memory_path.write_text(_DEFAULT_HEADER, encoding="utf-8")

            with memory_path.open("a", encoding="utf-8") as f:
                f.write(formatted_entry)

            logger.info(
                f"Memory entry appended",
                extra={"path": str(memory_path), "entry_length": len(validated_entry)},
            )
            return True
        except OSError as e:
            logger.error(f"Failed to append to memory file: {e}")
            return False


def get_context_for_prompt(
    working_directory: str,
    max_chars: int = 4000,
) -> str | None:
    """Get memory content formatted for injection into prompts."""
    if max_chars <= 0:
        return None

    content = read_memory(working_directory)
    if not content:
        return None

    if len(content) > max_chars:
        truncation_marker = "...(truncated)\n"
        available_chars = max_chars - len(truncation_marker)
        if available_chars > 0:
            content = truncation_marker + content[-available_chars:]
        else:
            content = content[-max_chars:]

    return f"=== Project Memory (long-term) ===\n{content}\n"
