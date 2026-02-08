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
Toolkit for long-term memory using markdown files (issue #1099).

Agents can both read and write to the project's memory file (.eigent/memory.md).
This provides a simple, file-based approach for persistent knowledge storage.
"""

from __future__ import annotations

import logging
import os
from typing import Final

from camel.toolkits.base import BaseToolkit
from camel.toolkits.function_tool import FunctionTool

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.utils.memory_file import append_memory, read_memory

logger = logging.getLogger(__name__)

_DEFAULT_WORKING_DIR: Final[str] = "~/.eigent"
_NO_MEMORY_MESSAGE: Final[str] = (
    "No project memory exists yet. Use remember_this to save information."
)
_SUCCESS_MESSAGE: Final[str] = (
    "Saved to project memory (.eigent/memory.md). "
    "This will be available in future conversations."
)
_FAILURE_MESSAGE: Final[str] = "Failed to save to project memory. Please try again."


def _resolve_working_directory(working_directory: str | None) -> str:
    """Resolve and validate the working directory path."""
    if working_directory is None:
        working_directory = env("file_save_path", os.path.expanduser(_DEFAULT_WORKING_DIR))
    resolved = os.path.expanduser(working_directory)
    os.makedirs(resolved, exist_ok=True)
    return resolved


class KnowledgeBaseToolkit(BaseToolkit, AbstractToolkit):
    """Toolkit for reading and writing project long-term memory.

    Uses a simple markdown file (.eigent/memory.md) in the project's working
    directory. Agents can both read existing memories and write new ones.
    """

    def __init__(
        self,
        api_task_id: str,
        working_directory: str | None = None,
        agent_name: str | None = None,
        timeout: float | None = None,
    ) -> None:
        if not api_task_id or not api_task_id.strip():
            raise ValueError("api_task_id cannot be empty")

        super().__init__(timeout=timeout)
        self.api_task_id = api_task_id.strip()
        self.working_directory = _resolve_working_directory(working_directory)
        self.agent_name = agent_name.strip() if agent_name else "agent"

        logger.debug(
            "KnowledgeBaseToolkit initialized",
            extra={
                "api_task_id": self.api_task_id,
                "working_directory": self.working_directory,
                "agent_name": self.agent_name,
            },
        )

    def read_project_memory(self) -> str:
        """Read the project's long-term memory file.

        Returns the content of .eigent/memory.md which contains facts,
        preferences, and decisions that should persist across sessions.

        Returns:
            str: The memory file content, or a message if no memory exists yet.
        """
        try:
            content = read_memory(self.working_directory)
            if content is None:
                return _NO_MEMORY_MESSAGE
            return content
        except Exception as e:
            logger.error(
                f"Error reading project memory: {e}",
                extra={"working_directory": self.working_directory},
            )
            return _NO_MEMORY_MESSAGE

    def remember_this(self, content: str) -> str:
        """Save a fact or piece of information to the project's long-term memory.

        Use this when the user or task establishes something that should be
        remembered for future conversations (e.g. preferences, decisions,
        project-specific facts). The content will be appended to .eigent/memory.md.

        Args:
            content (str): The information to remember (clear, self-contained text).

        Returns:
            str: Confirmation message indicating success or failure.
        """
        if not content or not content.strip():
            return "Cannot save empty content. Please provide information to remember."

        try:
            success = append_memory(self.working_directory, content)
            if success:
                logger.info(
                    "Memory saved successfully",
                    extra={
                        "api_task_id": self.api_task_id,
                        "content_length": len(content),
                    },
                )
                return _SUCCESS_MESSAGE
            return _FAILURE_MESSAGE
        except Exception as e:
            logger.error(
                f"Error saving to project memory: {e}",
                extra={"working_directory": self.working_directory},
            )
            return _FAILURE_MESSAGE

    def get_tools(self) -> list[FunctionTool]:
        """Return the list of tools provided by this toolkit."""
        return [
            FunctionTool(self.read_project_memory),
            FunctionTool(self.remember_this),
        ]


def get_tools(
    api_task_id: str,
    working_directory: str | None = None,
    agent_name: str | None = None,
) -> list[FunctionTool]:
    """Return the memory tools for use by an agent."""
    return KnowledgeBaseToolkit(
        api_task_id=api_task_id,
        working_directory=working_directory,
        agent_name=agent_name,
    ).get_tools()
