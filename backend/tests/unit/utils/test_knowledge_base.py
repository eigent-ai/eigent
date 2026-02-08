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

"""Unit tests for the markdown-based memory file (issue #1099)."""

from pathlib import Path

import pytest

from app.agent.toolkit.knowledge_base_toolkit import KnowledgeBaseToolkit
from app.utils import memory_file as mf


@pytest.mark.unit
class TestMemoryFile:
    """Test memory_file read, write, append, and get_context_for_prompt."""

    def test_read_nonexistent_memory(self, tmp_path: Path) -> None:
        """Reading memory from a directory without memory.md returns None."""
        content = mf.read_memory(str(tmp_path))
        assert content is None

    def test_append_and_read_memory(self, tmp_path: Path) -> None:
        """Append entries and read them back."""
        working_dir = str(tmp_path)

        success = mf.append_memory(working_dir, "User prefers dark mode.")
        assert success is True

        memory_path = mf.get_memory_file_path(working_dir)
        assert memory_path.exists()

        content = mf.read_memory(working_dir)
        assert content is not None
        assert "Project Memory" in content
        assert "dark mode" in content

    def test_append_multiple_entries(self, tmp_path: Path) -> None:
        """Multiple appends add entries with timestamps."""
        working_dir = str(tmp_path)

        mf.append_memory(working_dir, "First entry.")
        mf.append_memory(working_dir, "Second entry.")
        mf.append_memory(working_dir, "Third entry.")

        content = mf.read_memory(working_dir)
        assert content is not None
        assert "First entry" in content
        assert "Second entry" in content
        assert "Third entry" in content

    def test_write_memory_overwrites(self, tmp_path: Path) -> None:
        """write_memory overwrites existing content."""
        working_dir = str(tmp_path)

        mf.append_memory(working_dir, "Original content.")
        mf.write_memory(working_dir, "# New Content\n\nCompletely replaced.")

        content = mf.read_memory(working_dir)
        assert content is not None
        assert "Original content" not in content
        assert "Completely replaced" in content

    def test_get_context_for_prompt(self, tmp_path: Path) -> None:
        """get_context_for_prompt returns formatted string."""
        working_dir = str(tmp_path)

        mf.append_memory(working_dir, "User prefers Python 3.10.")

        ctx = mf.get_context_for_prompt(working_dir)
        assert ctx is not None
        assert "Project Memory" in ctx
        assert "Python 3.10" in ctx

    def test_get_context_for_prompt_empty(self, tmp_path: Path) -> None:
        """get_context_for_prompt returns None for empty/nonexistent memory."""
        working_dir = str(tmp_path)
        ctx = mf.get_context_for_prompt(working_dir)
        assert ctx is None

    def test_get_context_for_prompt_truncation(self, tmp_path: Path) -> None:
        """get_context_for_prompt truncates long content."""
        working_dir = str(tmp_path)
        long_content = "A" * 5000
        mf.append_memory(working_dir, long_content)

        ctx = mf.get_context_for_prompt(working_dir, max_chars=100)
        assert ctx is not None
        assert "truncated" in ctx
        assert len(ctx) < 200

    def test_memory_file_path(self, tmp_path: Path) -> None:
        """Memory file is created in .eigent subdirectory."""
        working_dir = str(tmp_path)
        memory_path = mf.get_memory_file_path(working_dir)

        assert ".eigent" in str(memory_path)
        assert str(memory_path).endswith("memory.md")

    def test_append_empty_content_fails(self, tmp_path: Path) -> None:
        """Appending empty content returns False."""
        working_dir = str(tmp_path)
        success = mf.append_memory(working_dir, "")
        assert success is False

        success = mf.append_memory(working_dir, "   ")
        assert success is False

    def test_invalid_working_directory(self) -> None:
        """Invalid working directory returns None for read."""
        content = mf.read_memory("/nonexistent/path/that/does/not/exist")
        assert content is None


@pytest.mark.unit
class TestKnowledgeBaseToolkit:
    """Test the KnowledgeBaseToolkit read and write tools."""

    def test_toolkit_remember_and_read(self, tmp_path: Path) -> None:
        """Toolkit can remember and read back information."""
        working_dir = str(tmp_path)
        toolkit = KnowledgeBaseToolkit(
            api_task_id="test-task", working_directory=working_dir
        )

        result = toolkit.read_project_memory()
        assert "No project memory exists" in result

        result = toolkit.remember_this("The API uses FastAPI.")
        assert "Saved to project memory" in result

        result = toolkit.read_project_memory()
        assert "FastAPI" in result

    def test_toolkit_get_tools(self, tmp_path: Path) -> None:
        """Toolkit returns both read and write tools."""
        working_dir = str(tmp_path)
        toolkit = KnowledgeBaseToolkit(
            api_task_id="test-task", working_directory=working_dir
        )

        tools = toolkit.get_tools()
        assert len(tools) == 2

        tool_names = [t.get_function_name() for t in tools]
        assert "read_project_memory" in tool_names
        assert "remember_this" in tool_names

    def test_toolkit_empty_content_rejected(self, tmp_path: Path) -> None:
        """Toolkit rejects empty content."""
        working_dir = str(tmp_path)
        toolkit = KnowledgeBaseToolkit(
            api_task_id="test-task", working_directory=working_dir
        )

        result = toolkit.remember_this("")
        assert "Cannot save empty content" in result

        result = toolkit.remember_this("   ")
        assert "Cannot save empty content" in result

    def test_toolkit_invalid_api_task_id(self, tmp_path: Path) -> None:
        """Toolkit raises ValueError for empty api_task_id."""
        with pytest.raises(ValueError, match="api_task_id cannot be empty"):
            KnowledgeBaseToolkit(api_task_id="", working_directory=str(tmp_path))

        with pytest.raises(ValueError, match="api_task_id cannot be empty"):
            KnowledgeBaseToolkit(api_task_id="   ", working_directory=str(tmp_path))

    def test_toolkit_default_working_directory(self) -> None:
        """Toolkit uses default working directory when not specified."""
        toolkit = KnowledgeBaseToolkit(api_task_id="test-task")
        assert toolkit.working_directory is not None
        assert len(toolkit.working_directory) > 0
