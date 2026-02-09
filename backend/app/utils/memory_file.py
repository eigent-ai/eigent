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

memory.md in the project's .eigent/ directory acts as an index: only a short
prefix (e.g. first 200 lines) is passed into the system prompt. Topic-specific
memories live in other .md files under .eigent/; the agent reads and writes
them on demand via file operations (no dedicated remember/read tools).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Final

logger = logging.getLogger("memory_file")

_MEMORY_FILENAME: Final[str] = "memory.md"
_EIGENT_DIR: Final[str] = ".eigent"
_DEFAULT_INDEX_LINES: Final[int] = 200
_MAX_INDEX_LINES: Final[int] = 2000

_CONTINUATION_NOTE: Final[str] = "\n\n...(further memory in .eigent/; read files as needed)\n"
_INDEX_HEADER: Final[str] = "=== Project memory index (.eigent/memory.md) ===\n"


class MemoryFileError(Exception):
    """Base exception for memory file operations."""


class MemoryReadError(MemoryFileError):
    """Raised when reading the memory file fails."""


def _validate_working_directory(working_directory: str) -> Path:
    if not working_directory or not working_directory.strip():
        raise ValueError("working_directory cannot be empty")
    path = Path(working_directory).expanduser().resolve()
    if not path.exists():
        raise ValueError(f"working_directory does not exist: {path}")
    if not path.is_dir():
        raise ValueError(f"working_directory is not a directory: {path}")
    return path


def get_memory_file_path(working_directory: str) -> Path:
    """Return the path to the project's memory file (.eigent/memory.md)."""
    base_path = _validate_working_directory(working_directory)
    eigent_dir = base_path / _EIGENT_DIR
    eigent_dir.mkdir(parents=True, exist_ok=True)
    return eigent_dir / _MEMORY_FILENAME


def read_memory(working_directory: str) -> str | None:
    """Read the full content of the memory file, or None if missing/invalid."""
    try:
        memory_path = get_memory_file_path(working_directory)
    except ValueError as e:
        logger.warning("Invalid working directory: %s", e)
        return None

    if not memory_path.exists():
        return None

    try:
        content = memory_path.read_text(encoding="utf-8")
        return content if content.strip() else None
    except OSError as e:
        logger.error("Failed to read memory file %s: %s", memory_path, e)
        return None


MEMORY_ARCHITECTURE_PROMPT: Final[str] = """
Project long-term memory lives under .eigent/ in the project directory.
- .eigent/memory.md is the index: it lists or summarizes memory topics (e.g. user_preferences.md, decisions.md).
- You can read any .eigent/*.md file when you need topic-specific information.
- To remember something: create or edit markdown files under .eigent/ (e.g. append to an existing topic file or create one). Use normal file operations (read/write/append) or shell commands; no dedicated memory tool is required.
"""


def get_index_for_prompt(
    working_directory: str,
    max_lines: int = _DEFAULT_INDEX_LINES,
) -> str | None:
    """
    Return the first max_lines of memory.md formatted for system-prompt injection.
    Callers should use this instead of dumping the full file; topic-specific
    content is read by the agent via file operations.
    """
    if not working_directory or not working_directory.strip():
        return None
    if max_lines <= 0:
        return None
    effective_max = min(max_lines, _MAX_INDEX_LINES)

    content = read_memory(working_directory)
    if not content:
        return None

    lines = content.splitlines()
    if len(lines) > effective_max:
        index_content = "\n".join(lines[:effective_max]) + _CONTINUATION_NOTE
    else:
        index_content = content

    return _INDEX_HEADER + index_content + "\n"
