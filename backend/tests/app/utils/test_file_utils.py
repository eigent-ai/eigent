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
from unittest.mock import MagicMock, patch

import pytest

from app.exception.exception import PathEscapesBaseError
from app.utils.file_utils import (
    DEFAULT_SKIP_DIRS,
    get_working_directory,
    is_safe_path,
    join_under_base,
    list_files,
    normalize_working_path,
    resolve_under_base,
)


def test_normalize_working_path_none_raises():
    with pytest.raises(ValueError, match="must be specified"):
        normalize_working_path(None)


def test_normalize_working_path_empty_string_raises():
    with pytest.raises(ValueError, match="must be specified"):
        normalize_working_path("")


def test_normalize_working_path_whitespace_raises():
    with pytest.raises(ValueError, match="must be specified"):
        normalize_working_path("   ")


def test_normalize_working_path_valid_dir_returns_absolute(temp_dir):
    result = normalize_working_path(str(temp_dir))
    assert os.path.isabs(result)
    assert os.path.isdir(result)
    assert os.path.realpath(result) == os.path.realpath(str(temp_dir))


def test_normalize_working_path_accepts_path_object(temp_dir):
    result = normalize_working_path(temp_dir)
    assert os.path.isabs(result)
    assert os.path.realpath(result) == os.path.realpath(str(temp_dir))


def test_normalize_working_path_file_returns_parent(temp_dir):
    f = temp_dir / "some_file.txt"
    f.write_text("x")
    result = normalize_working_path(str(f))
    assert os.path.realpath(result) == os.path.realpath(str(temp_dir))


def test_normalize_working_path_nonexistent_falls_back_to_parent(temp_dir):
    missing = temp_dir / "does_not_exist"
    result = normalize_working_path(str(missing))
    assert os.path.realpath(result) == os.path.realpath(str(temp_dir))


def test_normalize_working_path_nonexistent_deep_falls_back_to_home(tmp_path):
    missing = tmp_path / "a" / "b" / "c"
    result = normalize_working_path(str(missing))
    assert os.path.isdir(result)


def test_resolve_under_base_empty_raises_value_error(temp_dir):
    with pytest.raises(ValueError):
        resolve_under_base("", str(temp_dir))


def test_resolve_under_base_whitespace_raises_value_error(temp_dir):
    with pytest.raises(ValueError):
        resolve_under_base("  ", str(temp_dir))


def test_resolve_under_base_relative_returns_realpath(temp_dir):
    sub = temp_dir / "sub"
    sub.mkdir()
    result = resolve_under_base("sub", str(temp_dir))
    assert result == os.path.realpath(str(sub))


def test_resolve_under_base_absolute_under_base(temp_dir):
    sub = temp_dir / "deep"
    sub.mkdir()
    result = resolve_under_base(str(sub), str(temp_dir))
    assert result == os.path.realpath(str(sub))


def test_resolve_under_base_traversal_raises(temp_dir):
    with pytest.raises(PathEscapesBaseError):
        resolve_under_base("..", str(temp_dir))


def test_resolve_under_base_nested_traversal_raises(temp_dir):
    other = temp_dir / "a" / "b"
    other.mkdir(parents=True)
    with pytest.raises(PathEscapesBaseError):
        resolve_under_base("../..", str(other))


def test_resolve_under_base_nonexistent_base_raises(temp_dir):
    with pytest.raises(PathEscapesBaseError, match="not a directory"):
        resolve_under_base("sub", str(temp_dir / "no_such_dir"))


def test_resolve_under_base_absolute_outside_raises(temp_dir):
    with pytest.raises(PathEscapesBaseError):
        resolve_under_base("/etc/passwd", str(temp_dir))


def test_join_under_base_empty_base_returns_none():
    assert join_under_base("", "a") is None


def test_join_under_base_whitespace_base_returns_none():
    assert join_under_base("   ", "a") is None


def test_join_under_base_nonexistent_base_returns_none():
    assert join_under_base("/nonexistent/path/xyz", "a") is None


def test_join_under_base_single_part(temp_dir):
    result = join_under_base(str(temp_dir), "child")
    assert result == str((Path(temp_dir) / "child").resolve())


def test_join_under_base_multiple_parts(temp_dir):
    result = join_under_base(str(temp_dir), "a", "b")
    assert result is not None
    assert result == str((Path(temp_dir) / "a" / "b").resolve())


def test_join_under_base_traversal_part_returns_none(temp_dir):
    assert join_under_base(str(temp_dir), "..", "etc") is None


def test_join_under_base_none_part_returns_none(temp_dir):
    assert join_under_base(str(temp_dir), None) is None  # type: ignore[arg-type]


def test_is_safe_path_empty_path_returns_false(temp_dir):
    assert is_safe_path("", str(temp_dir)) is False


def test_is_safe_path_empty_base_returns_false(temp_dir):
    assert is_safe_path(str(temp_dir), "") is False


def test_is_safe_path_subdir_returns_true(temp_dir):
    sub = temp_dir / "sub"
    sub.mkdir()
    assert is_safe_path(str(sub), str(temp_dir)) is True


def test_is_safe_path_base_itself_returns_true(temp_dir):
    assert is_safe_path(str(temp_dir), str(temp_dir)) is True


def test_is_safe_path_escapes_base_returns_false(temp_dir):
    assert is_safe_path("/etc/passwd", str(temp_dir)) is False


def test_is_safe_path_sibling_dir_returns_false(tmp_path):
    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()
    assert is_safe_path(str(dir_b), str(dir_a)) is False


def test_list_files_empty_path_returns_empty():
    assert list_files("") == []


def test_list_files_whitespace_path_returns_empty():
    assert list_files("  ") == []


def test_list_files_nonexistent_path_returns_empty():
    assert list_files("/nonexistent/path/12345") == []


def test_list_files_lists_files_recursively(temp_dir):
    (temp_dir / "a.txt").write_text("a")
    (temp_dir / "b.txt").write_text("b")
    sub = temp_dir / "sub"
    sub.mkdir()
    (sub / "c.txt").write_text("c")
    result = list_files(str(temp_dir), base=str(temp_dir))
    names = [os.path.basename(p) for p in result]
    assert "a.txt" in names
    assert "b.txt" in names
    assert "c.txt" in names


def test_list_files_skips_default_dirs(temp_dir):
    (temp_dir / "keep.txt").write_text("x")
    (temp_dir / "node_modules").mkdir()
    (temp_dir / "__pycache__").mkdir()
    result = list_files(str(temp_dir), base=str(temp_dir))
    names = [os.path.basename(p) for p in result]
    assert "keep.txt" in names
    assert "node_modules" not in names
    assert "__pycache__" not in names


def test_list_files_skips_default_extensions(temp_dir):
    (temp_dir / "good.txt").write_text("x")
    (temp_dir / "bad.pyc").write_bytes(b"")
    (temp_dir / "bad.tmp").write_text("")
    result = list_files(str(temp_dir), base=str(temp_dir))
    names = [os.path.basename(p) for p in result]
    assert "good.txt" in names
    assert "bad.pyc" not in names
    assert "bad.tmp" not in names


def test_list_files_skips_dotfiles(temp_dir):
    (temp_dir / "visible.txt").write_text("x")
    (temp_dir / ".hidden").write_text("h")
    result = list_files(str(temp_dir), base=str(temp_dir))
    names = [os.path.basename(p) for p in result]
    assert "visible.txt" in names
    assert ".hidden" not in names


def test_list_files_respects_max_entries(temp_dir):
    for i in range(10):
        (temp_dir / f"file{i}.txt").write_text(str(i))
    result = list_files(str(temp_dir), base=str(temp_dir), max_entries=3)
    assert len(result) == 3


def test_list_files_dir_path_is_file_returns_empty(temp_dir):
    f = temp_dir / "file.txt"
    f.write_text("x")
    result = list_files(str(f), base=str(temp_dir))
    assert result == []


def test_list_files_escaping_base_returns_empty(temp_dir):
    parent = str(temp_dir.parent)
    result = list_files(parent, base=str(temp_dir))
    assert result == []


def test_list_files_default_skip_dirs_constant():
    assert ".git" in DEFAULT_SKIP_DIRS
    assert "node_modules" in DEFAULT_SKIP_DIRS
    assert "venv" in DEFAULT_SKIP_DIRS
    assert "__pycache__" in DEFAULT_SKIP_DIRS
    assert ".venv" in DEFAULT_SKIP_DIRS


def test_get_working_directory_uses_new_folder_path(temp_dir):
    options = MagicMock()
    options.file_save_path.return_value = "/default"
    task_lock = MagicMock()
    task_lock.new_folder_path = str(temp_dir)
    result = get_working_directory(options, task_lock)
    assert os.path.isdir(result)
    assert os.path.realpath(result) == os.path.realpath(str(temp_dir))


def test_get_working_directory_falls_back_to_file_save_path():
    options = MagicMock()
    options.file_save_path.return_value = os.path.expanduser("~")
    result = get_working_directory(options, task_lock=None)
    assert os.path.isdir(result)


def test_get_working_directory_no_new_folder_path_uses_env(temp_dir):
    options = MagicMock()
    task_lock = MagicMock()
    task_lock.new_folder_path = None
    with patch("app.utils.file_utils.env", return_value=str(temp_dir)):
        result = get_working_directory(options, task_lock)
    assert os.path.realpath(result) == os.path.realpath(str(temp_dir))


def test_get_working_directory_task_lock_without_attribute(temp_dir):
    options = MagicMock()
    task_lock = MagicMock(spec=[])  # no new_folder_path attribute
    with patch("app.utils.file_utils.env", return_value=str(temp_dir)):
        result = get_working_directory(options, task_lock)
    assert os.path.realpath(result) == os.path.realpath(str(temp_dir))


def test_normalize_working_path_tilde_expands():
    result = normalize_working_path("~")
    assert os.path.isabs(result)
    assert os.path.isdir(result)
    assert result == os.path.expanduser("~")


def test_resolve_under_base_file_as_base_raises(temp_dir):
    f = temp_dir / "file.txt"
    f.write_text("x")
    with pytest.raises(PathEscapesBaseError, match="not a directory"):
        resolve_under_base("sub", str(f))


def test_join_under_base_no_parts_returns_base(temp_dir):
    result = join_under_base(str(temp_dir))
    assert result == str(Path(temp_dir).resolve())


def test_is_safe_path_file_under_base_returns_true(temp_dir):
    f = temp_dir / "file.txt"
    f.write_text("x")
    assert is_safe_path(str(f), str(temp_dir)) is True


def test_list_files_custom_skip_dirs(temp_dir):
    (temp_dir / "keep.txt").write_text("x")
    custom = temp_dir / "custom_skip"
    custom.mkdir()
    (custom / "inside.txt").write_text("y")
    result = list_files(
        str(temp_dir), base=str(temp_dir), skip_dirs={"custom_skip"}
    )
    names = [os.path.basename(p) for p in result]
    assert "keep.txt" in names
    assert "inside.txt" not in names


def test_list_files_custom_skip_extensions(temp_dir):
    (temp_dir / "keep.txt").write_text("x")
    (temp_dir / "skip.log").write_text("y")
    result = list_files(
        str(temp_dir), base=str(temp_dir), skip_extensions=(".log",)
    )
    names = [os.path.basename(p) for p in result]
    assert "keep.txt" in names
    assert "skip.log" not in names


def test_list_files_custom_skip_prefix(temp_dir):
    (temp_dir / "keep.txt").write_text("x")
    (temp_dir / "_private.txt").write_text("y")
    result = list_files(str(temp_dir), base=str(temp_dir), skip_prefix="_")
    names = [os.path.basename(p) for p in result]
    assert "keep.txt" in names
    assert "_private.txt" not in names
