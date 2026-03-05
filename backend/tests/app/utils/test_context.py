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

import time
from unittest.mock import MagicMock, patch

import pytest

from app.service.task import TaskLock
from app.utils.context import (
    build_conversation_context,
    collect_previous_task_context,
    format_task_context,
)

pytestmark = pytest.mark.unit


# --- format_task_context ---


def test_format_task_context_with_working_directory_and_files(temp_dir):
    (temp_dir / "output.txt").write_text("content")
    task_data = {
        "task_content": "Create file",
        "task_result": "Done",
        "working_directory": str(temp_dir),
    }
    result = format_task_context(task_data, skip_files=False)
    assert "Previous Task: Create file" in result
    assert "output.txt" in result
    assert "Generated Files from Previous Task:" in result


def test_format_task_context_skip_files(temp_dir):
    task_data = {
        "task_content": "Task",
        "task_result": "Result",
        "working_directory": str(temp_dir),
    }
    result = format_task_context(task_data, skip_files=True)
    assert "Generated Files from Previous Task:" not in result


# --- collect_previous_task_context ---


def test_collect_previous_task_context_basic(temp_dir):
    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="Create a Python script",
        previous_task_result="Successfully created script.py",
        previous_summary="Python Script Creation Task",
    )
    assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
    assert "Previous Task:" in result
    assert "Create a Python script" in result
    assert "Previous Task Summary:" in result
    assert "Python Script Creation Task" in result
    assert "Previous Task Result:" in result
    assert "Successfully created script.py" in result
    assert "=== END OF PREVIOUS TASK CONTEXT ===" in result


def test_collect_previous_task_context_with_generated_files(temp_dir):
    (temp_dir / "script.py").write_text("print('Hello World')")
    (temp_dir / "config.json").write_text('{"test": true}')
    (temp_dir / "README.md").write_text("# Test Project")
    sub_dir = temp_dir / "utils"
    sub_dir.mkdir()
    (sub_dir / "helper.py").write_text("def helper(): pass")

    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="Create project files",
        previous_task_result="Files created successfully",
        previous_summary="",
    )
    assert "Generated Files from Previous Task:" in result
    assert "script.py" in result
    assert "config.json" in result
    assert "README.md" in result
    assert "utils/helper.py" in result or "utils\\helper.py" in result

    lines = result.split("\n")
    file_lines = [
        line.strip() for line in lines if line.strip().startswith("- ")
    ]
    assert len(file_lines) == 4


def test_collect_previous_task_context_filters_hidden_files(temp_dir):
    (temp_dir / "visible.py").write_text("# Visible file")
    (temp_dir / ".hidden_file").write_text("hidden content")
    (temp_dir / ".env").write_text("SECRET=hidden")
    hidden_dir = temp_dir / ".hidden_dir"
    hidden_dir.mkdir()
    (hidden_dir / "file.txt").write_text("in hidden dir")
    cache_dir = temp_dir / "__pycache__"
    cache_dir.mkdir()
    (cache_dir / "module.pyc").write_text("compiled")
    node_modules = temp_dir / "node_modules"
    node_modules.mkdir()
    (node_modules / "package").mkdir()

    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="Test filtering",
        previous_task_result="Files filtered",
        previous_summary="",
    )
    assert "visible.py" in result
    assert ".hidden_file" not in result
    assert ".env" not in result
    assert "__pycache__" not in result
    assert "node_modules" not in result
    assert ".hidden_dir" not in result


def test_collect_previous_task_context_filters_temp_files(temp_dir):
    (temp_dir / "main.py").write_text("# Main file")
    (temp_dir / "temp.tmp").write_text("temporary")
    (temp_dir / "compiled.pyc").write_text("compiled python")

    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="Test temp filtering",
        previous_task_result="Temp files filtered",
        previous_summary="",
    )
    assert "main.py" in result
    assert "temp.tmp" not in result
    assert "compiled.pyc" not in result


def test_collect_previous_task_context_nonexistent_directory():
    result = collect_previous_task_context(
        working_directory="/nonexistent/directory",
        previous_task_content="Test task",
        previous_task_result="Test result",
        previous_summary="Test summary",
    )
    assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
    assert "Test task" in result
    assert "Test result" in result
    assert "Test summary" in result
    assert "Generated Files from Previous Task:" not in result


def test_collect_previous_task_context_empty_inputs(temp_dir):
    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="",
        previous_task_result="",
        previous_summary="",
    )
    assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
    assert "=== END OF PREVIOUS TASK CONTEXT ===" in result
    assert "Previous Task:" not in result
    assert "Previous Task Summary:" not in result
    assert "Previous Task Result:" not in result


def test_collect_previous_task_context_only_summary(temp_dir):
    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="",
        previous_task_result="",
        previous_summary="Only summary provided",
    )
    assert "Previous Task Summary:" in result
    assert "Only summary provided" in result
    assert "Previous Task:" not in result
    assert "Previous Task Result:" not in result


@patch("app.utils.file_utils.logger")
def test_collect_previous_task_context_file_system_error(
    mock_logger, temp_dir
):
    with patch("os.walk", side_effect=PermissionError("Access denied")):
        result = collect_previous_task_context(
            working_directory=str(temp_dir),
            previous_task_content="Test task",
            previous_task_result="Test result",
            previous_summary="Test summary",
        )
        assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
        assert "Test task" in result
        assert "Generated Files from Previous Task:" not in result
        mock_logger.warning.assert_called_once()


def test_collect_previous_task_context_relative_paths(temp_dir):
    deep_dir = temp_dir / "level1" / "level2" / "level3"
    deep_dir.mkdir(parents=True)
    (deep_dir / "deep_file.txt").write_text("deep content")

    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="Test relative paths",
        previous_task_result="Paths converted",
        previous_summary="",
    )
    expected_path = "level1/level2/level3/deep_file.txt"
    windows_path = "level1\\level2\\level3\\deep_file.txt"
    assert expected_path in result or windows_path in result


def test_collect_previous_task_context_os_walk_exception(temp_dir):
    with patch("os.walk", side_effect=OSError("Permission denied")):
        with patch("app.utils.file_utils.logger") as mock_logger:
            result = collect_previous_task_context(
                working_directory=str(temp_dir),
                previous_task_content="Test task",
                previous_task_result="Test result",
                previous_summary="Test summary",
            )
            assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
            assert "Test task" in result
            assert "Test result" in result
            assert "Test summary" in result
            assert "Generated Files from Previous Task:" not in result
            mock_logger.warning.assert_called_once()


def test_collect_previous_task_context_abspath_used(temp_dir):
    (temp_dir / "test.txt").write_text("test content")

    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="Test task",
        previous_task_result="Test result",
        previous_summary="Test summary",
    )
    assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
    assert "test.txt" in result


def test_collect_previous_task_context_unicode_handling(temp_dir):
    (temp_dir / "unicode_file.txt").write_text(
        "Unicode content: 🐍 Python ñáéíóú", encoding="utf-8"
    )

    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="Create files with unicode: 🔥 emojis and ñáéíóú accents",
        previous_task_result="Files created successfully with unicode: ✅ done",
        previous_summary="Unicode Task: 📝 file creation",
    )
    assert "🔥 emojis" in result
    assert "ñáéíóú accents" in result
    assert "✅ done" in result
    assert "📝 file creation" in result
    assert "unicode_file.txt" in result


def test_collect_previous_task_context_very_long_content(temp_dir):
    long_content = "Very long task content. " * 1000
    long_result = "Very long task result. " * 1000
    long_summary = "Very long summary. " * 100

    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content=long_content,
        previous_task_result=long_result,
        previous_summary=long_summary,
    )
    assert len(result) > 49000
    assert "Very long task content." in result
    assert "Very long task result." in result
    assert "Very long summary." in result


def test_collect_previous_task_context_many_files(temp_dir):
    for i in range(100):
        (temp_dir / f"file_{i:03d}.txt").write_text(f"Content {i}")
    for dir_i in range(10):
        sub_dir = temp_dir / f"subdir_{dir_i}"
        sub_dir.mkdir()
        for file_i in range(10):
            (sub_dir / f"subfile_{file_i}.txt").write_text(
                f"Sub content {dir_i}-{file_i}"
            )

    start_time = time.time()
    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="Test many files",
        previous_task_result="Many files processed",
        previous_summary="Performance test",
    )
    execution_time = time.time() - start_time
    assert execution_time < 1.0
    assert "Generated Files from Previous Task:" in result
    file_lines = [line for line in result.split("\n") if "  - " in line]
    assert len(file_lines) == 200


def test_collect_previous_task_context_special_characters_in_filenames(
    temp_dir,
):
    try:
        (temp_dir / "file with spaces.txt").write_text("content")
        (temp_dir / "file-with-dashes.txt").write_text("content")
        (temp_dir / "file_with_underscores.txt").write_text("content")
        (temp_dir / "file.with.dots.txt").write_text("content")
    except OSError:
        pytest.skip(
            "Filesystem doesn't support special characters in filenames"
        )

    result = collect_previous_task_context(
        working_directory=str(temp_dir),
        previous_task_content="Test special chars",
        previous_task_result="Files created",
        previous_summary="",
    )
    assert "file with spaces.txt" in result
    assert "file-with-dashes.txt" in result
    assert "file_with_underscores.txt" in result
    assert "file.with.dots.txt" in result


# --- build_conversation_context ---


def test_build_conversation_context_basic():
    task_lock = MagicMock(spec=TaskLock)
    task_lock.conversation_history = [
        {
            "role": "assistant",
            "content": "I will create a Python script for you",
        },
    ]
    result = build_conversation_context(task_lock)
    assert "=== CONVERSATION HISTORY ===" in result
    assert "I will create a Python script for you" in result


def test_build_conversation_context_empty_history():
    task_lock = MagicMock(spec=TaskLock)
    task_lock.conversation_history = []
    result = build_conversation_context(task_lock)
    assert result == ""


def test_build_conversation_context_task_result_role():
    task_lock = MagicMock(spec=TaskLock)
    task_lock.conversation_history = [
        {
            "role": "task_result",
            "content": "Full task context from previous task",
        },
        {
            "role": "assistant",
            "content": "Task completed successfully",
        },
    ]
    result = build_conversation_context(task_lock)
    assert "Full task context from previous task" in result
    assert "Task completed successfully" in result


def test_build_conversation_context_with_assistant_entries():
    task_lock = MagicMock(spec=TaskLock)
    task_lock.conversation_history = [
        {
            "role": "assistant",
            "content": "Task completed with output.txt",
        },
    ]
    result = build_conversation_context(task_lock)
    assert "=== CONVERSATION HISTORY ===" in result
    assert "Task completed with output.txt" in result


def test_build_conversation_context_missing_attributes():
    task_lock = MagicMock(spec=TaskLock)
    task_lock.conversation_history = None
    result = build_conversation_context(task_lock)
    assert result == ""


def test_build_conversation_context_empty_conversation():
    task_lock = MagicMock(spec=TaskLock)
    task_lock.conversation_history = []
    result = build_conversation_context(task_lock)
    assert result == ""
