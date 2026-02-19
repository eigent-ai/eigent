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
import shutil
from pathlib import Path

from app.component.environment import env
from app.model.chat import Chat

logger = logging.getLogger(__name__)


def get_working_directory(options: Chat, task_lock=None) -> str:
    """
    Get the correct working directory for file operations.
    First checks if there's an updated path from improve API call,
    then falls back to environment variable or default path.
    """
    if not task_lock:
        from app.service.task import get_task_lock_if_exists

        task_lock = get_task_lock_if_exists(options.project_id)

    if (
        task_lock
        and hasattr(task_lock, "new_folder_path")
        and task_lock.new_folder_path
    ):
        return str(task_lock.new_folder_path)
    else:
        return env("file_save_path", options.file_save_path())


def sync_eigent_skills_to_project(working_directory: str) -> None:
    """
    Copy skills from ~/.eigent/skills into the project's .eigent/skills
    so the agent can load and execute them from the project working directory.
    """
    src = Path.home() / ".eigent" / "skills"
    dst = Path(working_directory) / ".eigent" / "skills"
    if not src.is_dir():
        return
    try:
        dst.mkdir(parents=True, exist_ok=True)
        for skill_dir in src.iterdir():
            if skill_dir.is_dir():
                dest_skill = dst / skill_dir.name
                if dest_skill.exists():
                    shutil.rmtree(dest_skill)
                shutil.copytree(skill_dir, dest_skill)
        logger.debug(
            "Synced eigent skills to project",
            extra={
                "working_directory": working_directory,
                "destination": str(dst),
            },
        )
    except OSError as e:
        logger.warning(
            "Failed to sync ~/.eigent/skills to project %s: %s",
            working_directory,
            e,
            exc_info=True,
        )
