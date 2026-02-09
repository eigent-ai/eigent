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
Long-term memory via markdown files (issue #1099).

Memory is architecture-level: .eigent/memory.md is the index; the agent
reads/writes .eigent/*.md via file operations. This toolkit exposes no tools;
it stays selectable so chat_service can detect "knowledge_base_toolkit" in
data.tools and inject MEMORY_ARCHITECTURE_PROMPT + get_index_for_prompt()
into the system prompt.
"""

from __future__ import annotations

import logging
import os
from typing import Final

from camel.toolkits.base import BaseToolkit
from camel.toolkits.function_tool import FunctionTool

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env

logger = logging.getLogger(__name__)

_DEFAULT_WORKING_DIR: Final[str] = "~/.eigent"


def _resolve_working_directory(working_directory: str | None) -> str:
    if working_directory is None or not str(working_directory).strip():
        working_directory = env("file_save_path", os.path.expanduser(_DEFAULT_WORKING_DIR))
    resolved = os.path.expanduser(str(working_directory).strip())
    try:
        os.makedirs(resolved, exist_ok=True)
    except OSError as e:
        logger.warning("Could not create working directory %s: %s", resolved, e)
    return resolved


class KnowledgeBaseToolkit(BaseToolkit, AbstractToolkit):
    """
    Project long-term memory (architecture-only). Intentionally provides no
    tools; the agent uses file/terminal tools to read and write .eigent/*.md.
    When this toolkit is selected, chat_service injects the memory index and
    architecture into the system prompt.
    """

    def __init__(
        self,
        api_task_id: str,
        working_directory: str | None = None,
        agent_name: str | None = None,
        timeout: float | None = None,
    ) -> None:
        api_task_id = (api_task_id or "").strip()
        if not api_task_id:
            raise ValueError("api_task_id cannot be empty")

        super().__init__(timeout=timeout)
        self.api_task_id = api_task_id
        self.working_directory = _resolve_working_directory(working_directory)
        self.agent_name = (agent_name or "agent").strip() or "agent"

        logger.debug(
            "KnowledgeBaseToolkit initialized",
            extra={
                "api_task_id": self.api_task_id,
                "working_directory": self.working_directory,
                "agent_name": self.agent_name,
            },
        )

    def get_tools(self) -> list[FunctionTool]:
        return []


def get_tools(
    api_task_id: str,
    working_directory: str | None = None,
    agent_name: str | None = None,
) -> list[FunctionTool]:
    return KnowledgeBaseToolkit(
        api_task_id=api_task_id,
        working_directory=working_directory,
        agent_name=agent_name,
    ).get_tools()
