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

import logging
from typing import Any

from camel.toolkits import FunctionTool, TodoToolkit
from camel.toolkits.todo_toolkit import TodoItem

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import ActionTodoStateData, Agents, get_task_lock
from app.utils.listen.toolkit_listen import _safe_put_queue

logger = logging.getLogger("observable_todo_toolkit")


class ObservableTodoToolkit(TodoToolkit, AbstractToolkit):
    """CAMEL TodoToolkit with Eigent UI change events.

    This intentionally keeps CAMEL's todo data model and `todo_write` API as
    the source of truth. Eigent only observes successful writes and emits an
    SSE-compatible action for the frontend.
    """

    agent_name: str = Agents.single_agent

    def __init__(
        self,
        api_task_id: str,
        task_id: str,
        agent_id: str | None = None,
        working_dir: str | None = None,
        timeout: float | None = None,
    ) -> None:
        super().__init__(working_dir=working_dir, timeout=timeout)
        self.api_task_id = api_task_id
        self.task_id = task_id
        self.agent_id = agent_id

    def todo_write(self, todos: list[TodoItem]) -> str:
        result = super().todo_write(todos)
        if not result.startswith("[ERROR]"):
            self.emit_todo_state()
        return result

    def emit_todo_state(self) -> None:
        try:
            task_lock = get_task_lock(self.api_task_id)
        except Exception:
            logger.warning(
                "Could not emit todo_state because task lock is missing",
                extra={"project_id": self.api_task_id},
            )
            return

        data = {
            "project_id": self.api_task_id,
            "task_id": self.task_id,
            "agent_id": self.agent_id,
            "todos": self.serialized_todos(),
        }
        _safe_put_queue(task_lock, ActionTodoStateData(data=data))

    def serialized_todos(self) -> list[dict[str, Any]]:
        serialized: list[dict[str, Any]] = []
        for index, item in enumerate(self.todos, start=1):
            serialized.append(
                {
                    "id": f"todo_{index}",
                    "content": item.content,
                    "active_form": item.active_form,
                    "status": item.status,
                }
            )
        return serialized

    def get_tools(self) -> list[FunctionTool]:
        tools = [FunctionTool(self.todo_write)]
        for tool in tools:
            try:
                tool._toolkit_name = self.toolkit_name()
            except Exception:
                pass
        return tools

    @classmethod
    def toolkit_name(cls) -> str:
        return "TodoToolkit"
