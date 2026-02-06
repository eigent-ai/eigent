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

from camel.toolkits.base import BaseToolkit
from camel.toolkits.function_tool import FunctionTool

from app.utils.sqlite_toolkit import add_entry
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class KnowledgeBaseToolkit(BaseToolkit, AbstractToolkit):
    """Toolkit that lets agents save information to the project's knowledge base.

    Args:
        api_task_id: Project identifier used when storing/retrieving entries.
        agent_name: Optional name of the agent using this toolkit.
        timeout: Optional timeout in seconds for tool execution.
    """

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        timeout: float | None = None,
    ):
        super().__init__(timeout=timeout)
        self.api_task_id = api_task_id
        self.agent_name = agent_name or "agent"

    def store_project_knowledge(self, content: str) -> str:
        """Save a fact or piece of information to the project's long-term knowledge base.
        Use this when the user or the task establishes something that should be remembered
        for future conversations (e.g. preferences, decisions, project-specific facts).
        The content will be available in later sessions for this project.

        Args:
            content (str): The information to remember (clear, self-contained text).

        Returns:
            Confirmation message with the new entry id.
        """
        entry_id = add_entry(project_id=self.api_task_id, content=content)
        return f"Saved to long-term memory (id={entry_id}). This will be available in future conversations for this project."

    def get_tools(self) -> list[FunctionTool]:
        return [FunctionTool(self.store_project_knowledge)]


def get_tools(api_task_id: str, agent_name: str | None = None) -> list[FunctionTool]:
    """Return the knowledge-base tool(s) for use by an agent (no toolkit instance).

    Args:
        api_task_id: Project identifier used when storing entries.
        agent_name: Optional name of the agent using the tools.
    """
    return KnowledgeBaseToolkit(api_task_id=api_task_id, agent_name=agent_name).get_tools()
