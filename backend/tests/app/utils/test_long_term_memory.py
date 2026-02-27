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

"""Unit tests for the markdown-based long-term memory (issue #1099)."""

from pathlib import Path

import pytest

from app.utils import long_term_memory as ltm


def _write_memory(working_dir: str, content: str) -> None:
    """Write content to .eigent/memory.md (tests only; production uses file ops)."""
    path = ltm.get_memory_file_path(working_dir)
    path.write_text(content, encoding="utf-8")


@pytest.mark.unit
class TestLongTermMemory:
    """Test long_term_memory read and get_index_for_prompt."""

    def test_read_nonexistent_memory(self, tmp_path: Path) -> None:
        """Reading memory from a directory without memory.md returns None."""
        content = ltm.read_memory(str(tmp_path))
        assert content is None

    def test_read_memory(self, tmp_path: Path) -> None:
        """Read returns content written to memory.md."""
        working_dir = str(tmp_path)
        _write_memory(
            working_dir,
            "# Project Memory\n\nLong-term memory.\n\nUser prefers dark mode.",
        )
        content = ltm.read_memory(working_dir)
        assert content is not None
        assert "Project Memory" in content
        assert "dark mode" in content

    def test_read_multiple_sections(self, tmp_path: Path) -> None:
        """Read returns full file content."""
        working_dir = str(tmp_path)
        _write_memory(
            working_dir,
            "# Project Memory\n\nFirst entry.\n\n## Section 2\n\nSecond entry.\n\nThird entry.",
        )
        content = ltm.read_memory(working_dir)
        assert content is not None
        assert "First entry" in content
        assert "Second entry" in content
        assert "Third entry" in content

    def test_get_index_for_prompt(self, tmp_path: Path) -> None:
        """get_index_for_prompt returns first portion of memory.md for system prompt."""
        working_dir = str(tmp_path)
        _write_memory(
            working_dir, "# Project Memory\n\nUser prefers Python 3.10."
        )

        ctx = ltm.get_index_for_prompt(working_dir)
        assert ctx is not None
        assert "memory index" in ctx.lower() or "memory.md" in ctx
        assert "Python 3.10" in ctx

    def test_get_index_for_prompt_empty(self, tmp_path: Path) -> None:
        """get_index_for_prompt returns None for empty/nonexistent memory."""
        working_dir = str(tmp_path)
        ctx = ltm.get_index_for_prompt(working_dir)
        assert ctx is None

    def test_get_index_for_prompt_max_lines(self, tmp_path: Path) -> None:
        """get_index_for_prompt limits to first max_lines and adds note with remaining count."""
        working_dir = str(tmp_path)
        lines = ["# Project Memory", ""] + [
            f"Line entry {i}." for i in range(300)
        ]
        _write_memory(working_dir, "\n".join(lines))

        ctx = ltm.get_index_for_prompt(working_dir, max_lines=50)
        assert ctx is not None
        assert "more lines" in ctx or ".eigent" in ctx
        assert len(ctx.splitlines()) <= 55

    def test_memory_file_path(self, tmp_path: Path) -> None:
        """Memory file path is .eigent/memory.md under working dir."""
        working_dir = str(tmp_path)
        memory_path = ltm.get_memory_file_path(working_dir)
        assert ".eigent" in str(memory_path)
        assert str(memory_path).endswith("memory.md")

    def test_invalid_working_directory(self) -> None:
        """Invalid working directory returns None for read."""
        content = ltm.read_memory("/nonexistent/path/that/does/not/exist")
        assert content is None
