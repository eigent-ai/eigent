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
import tempfile
from unittest.mock import MagicMock, patch

from app.utils.file_utils import (
    _ensure_directory_exists,
    get_working_directory,
)


class TestEnsureDirectoryExists:
    """Test _ensure_directory_exists helper function."""

    def test_creates_nonexistent_directory(self):
        """Test that a non-existent directory is created."""
        with tempfile.TemporaryDirectory() as temp_dir:
            new_dir = os.path.join(temp_dir, "subdir", "nested")
            assert not os.path.exists(new_dir)

            result = _ensure_directory_exists(new_dir)

            assert os.path.isdir(new_dir)
            assert result == new_dir

    def test_existing_directory_no_error(self):
        """Test that an existing directory does not raise an error."""
        with tempfile.TemporaryDirectory() as temp_dir:
            result = _ensure_directory_exists(temp_dir)

            assert os.path.isdir(temp_dir)
            assert result == temp_dir

    def test_returns_same_path(self):
        """Test that the function returns the same path it was given."""
        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, "test_dir")
            result = _ensure_directory_exists(path)
            assert result == path


class TestGetWorkingDirectory:
    """Test get_working_directory function."""

    def test_returns_task_lock_new_folder_path(self):
        """Test that task_lock.new_folder_path is returned when available."""
        with tempfile.TemporaryDirectory() as temp_dir:
            new_folder = os.path.join(temp_dir, "new_folder")
            task_lock = MagicMock()
            task_lock.new_folder_path = new_folder

            options = MagicMock()

            result = get_working_directory(options, task_lock=task_lock)

            assert result == new_folder
            # Verify directory was created
            assert os.path.isdir(new_folder)

    def test_creates_directory_from_env(self, temp_dir):
        """Test that the directory from env is created if it doesn't exist."""
        new_dir = str(temp_dir / "env_dir" / "nested")

        options = MagicMock()
        task_lock = MagicMock(spec=[])  # No new_folder_path attribute

        with patch(
            "app.utils.file_utils.env", return_value=new_dir
        ), patch(
            "app.utils.file_utils.get_working_directory.__module__",
            "app.utils.file_utils",
        ):
            # Patch get_task_lock_if_exists to avoid import issues
            with patch(
                "app.service.task.get_task_lock_if_exists",
                return_value=task_lock,
            ):
                result = get_working_directory(options, task_lock=task_lock)

        assert result == new_dir
        assert os.path.isdir(new_dir)

    def test_creates_directory_from_file_save_path(self, temp_dir):
        """Test that file_save_path directory is created."""
        new_dir = str(temp_dir / "save_path")

        options = MagicMock()
        options.file_save_path.return_value = new_dir

        task_lock = MagicMock(spec=[])  # No new_folder_path attribute

        with patch(
            "app.utils.file_utils.env",
            side_effect=lambda key, default: default,
        ):
            result = get_working_directory(options, task_lock=task_lock)

        assert result == new_dir
        assert os.path.isdir(new_dir)

    def test_existing_directory_works(self, temp_dir):
        """Test that an existing directory is returned without error."""
        existing_dir = str(temp_dir)

        options = MagicMock()
        task_lock = MagicMock()
        task_lock.new_folder_path = existing_dir

        result = get_working_directory(options, task_lock=task_lock)

        assert result == existing_dir
        assert os.path.isdir(existing_dir)
