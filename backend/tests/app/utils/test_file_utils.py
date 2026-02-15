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

import os
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.utils.file_utils import (
    DEFAULT_SKIP_DIRS,
    get_working_directory,
    is_safe_path,
    normalize_working_path,
    safe_join_path,
    safe_list_directory,
    safe_resolve_path,
)


@pytest.mark.unit
class TestNormalizeWorkingPath:
    """Tests for normalize_working_path."""

    def test_none_raises(self):
        with pytest.raises(ValueError, match="must be specified"):
            normalize_working_path(None)

    def test_empty_string_raises(self):
        with pytest.raises(ValueError, match="must be specified"):
            normalize_working_path("")
        with pytest.raises(ValueError, match="must be specified"):
            normalize_working_path("   ")

    def test_valid_dir_returns_absolute(self, temp_dir):
        result = normalize_working_path(str(temp_dir))
        assert os.path.isabs(result)
        assert os.path.isdir(result)
        assert os.path.normpath(result) == os.path.normpath(str(temp_dir))


@pytest.mark.unit
class TestSafeResolvePath:
    """Tests for safe_resolve_path."""

    def test_none_or_empty_returns_none(self, temp_dir):
        assert safe_resolve_path("", str(temp_dir)) is None
        assert safe_resolve_path("  ", str(temp_dir)) is None

    def test_relative_under_base_returns_realpath(self, temp_dir):
        sub = temp_dir / "sub"
        sub.mkdir()
        result = safe_resolve_path("sub", str(temp_dir))
        assert result is not None
        assert result == str(sub.resolve())

    def test_escapes_base_returns_none(self, temp_dir):
        assert safe_resolve_path("..", str(temp_dir)) is None
        other = temp_dir / "a" / "b"
        other.mkdir(parents=True)
        assert safe_resolve_path("../..", str(other)) is None


@pytest.mark.unit
class TestSafeJoinPath:
    """Tests for safe_join_path."""

    def test_empty_base_returns_none(self):
        assert safe_join_path("", "a") is None

    def test_join_under_base(self, temp_dir):
        result = safe_join_path(str(temp_dir), "a", "b")
        assert result is not None
        assert result == str((Path(temp_dir) / "a" / "b").resolve())

    def test_dot_dot_returns_none(self, temp_dir):
        assert safe_join_path(str(temp_dir), "..", "etc") is None


@pytest.mark.unit
class TestIsSafePath:
    """Tests for is_safe_path."""

    def test_empty_returns_false(self, temp_dir):
        assert is_safe_path("", str(temp_dir)) is False
        assert is_safe_path(str(temp_dir), "") is False

    def test_path_under_base_true(self, temp_dir):
        sub = temp_dir / "sub"
        sub.mkdir()
        assert is_safe_path(str(sub), str(temp_dir)) is True

    def test_path_escapes_base_false(self, temp_dir):
        assert is_safe_path("/etc/passwd", str(temp_dir)) is False


@pytest.mark.unit
class TestSafeListDirectory:
    """Tests for safe_list_directory."""

    def test_empty_or_invalid_path_returns_empty(self):
        assert safe_list_directory("") == []
        assert safe_list_directory("  ") == []
        assert safe_list_directory("/nonexistent/path/12345") == []

    def test_lists_files_under_base(self, temp_dir):
        (temp_dir / "a.txt").write_text("a")
        (temp_dir / "b.txt").write_text("b")
        sub = temp_dir / "sub"
        sub.mkdir()
        (sub / "c.txt").write_text("c")
        result = safe_list_directory(str(temp_dir), base=str(temp_dir))
        assert len(result) >= 3
        paths = [os.path.basename(p) for p in result]
        assert "a.txt" in paths
        assert "b.txt" in paths
        assert "c.txt" in paths

    def test_skips_default_dirs(self, temp_dir):
        (temp_dir / "keep.txt").write_text("x")
        (temp_dir / "node_modules").mkdir()
        (temp_dir / "__pycache__").mkdir()
        result = safe_list_directory(str(temp_dir), base=str(temp_dir))
        names = [os.path.basename(p) for p in result]
        assert "keep.txt" in names
        assert "node_modules" not in names
        assert "__pycache__" not in names

    def test_uses_default_skip_dirs_constant(self):
        assert ".git" in DEFAULT_SKIP_DIRS
        assert "node_modules" in DEFAULT_SKIP_DIRS
        assert "venv" in DEFAULT_SKIP_DIRS


@pytest.mark.unit
class TestGetWorkingDirectory:
    """Tests for get_working_directory."""

    def test_uses_new_folder_path_when_set(self, temp_dir):
        options = MagicMock()
        options.file_save_path.return_value = "/default"
        task_lock = MagicMock()
        task_lock.new_folder_path = str(temp_dir)
        result = get_working_directory(options, task_lock)
        assert os.path.isdir(result)
        assert os.path.normpath(result) == os.path.normpath(str(temp_dir))

    def test_falls_back_to_options_file_save_path(self):
        options = MagicMock()
        options.file_save_path.return_value = os.path.expanduser("~")
        result = get_working_directory(options, task_lock=None)
        assert os.path.isdir(result)
