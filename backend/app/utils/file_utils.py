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
"""File system utilities."""

import logging
from pathlib import Path

from app.component.environment import env
from app.model.chat import Chat

logger = logging.getLogger("file_utils")


def _ensure_directory_exists(directory: str) -> str:
    """
    Ensure the given directory exists, creating it if necessary.

    Args:
        directory: Path string for the directory.

    Returns:
        The same directory path string.
    """
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    return directory


def get_working_directory(options: Chat, task_lock=None) -> str:
    """
    Get the correct working directory for file operations.
    First checks if there's an updated path from improve API call,
    then falls back to environment variable or default path.

    The returned directory is guaranteed to exist on the filesystem.
    """
    if not task_lock:
        from app.service.task import get_task_lock_if_exists

        task_lock = get_task_lock_if_exists(options.project_id)

    if (
        task_lock
        and hasattr(task_lock, "new_folder_path")
        and task_lock.new_folder_path
    ):
        directory = str(task_lock.new_folder_path)
    else:
        directory = env("file_save_path", options.file_save_path())

    return _ensure_directory_exists(directory)
