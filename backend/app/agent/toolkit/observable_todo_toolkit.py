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
from collections.abc import Callable
from pathlib import Path
from typing import Any

from camel.toolkits.todo_toolkit import TodoItem

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import ActionTodoStateData, Agents, get_task_lock
from app.utils.listen.toolkit_listen import _safe_put_queue
from camel.toolkits import FunctionTool, TodoToolkit

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
        working_dir_for_task: Callable[[str], str | Path] | None = None,
        timeout: float | None = None,
    ) -> None:
        self._working_dir_for_task = working_dir_for_task
        initial_working_dir = (
            working_dir_for_task(task_id)
            if working_dir_for_task is not None
            else working_dir
        )
        super().__init__(working_dir=initial_working_dir, timeout=timeout)
        self.api_task_id = api_task_id
        self.task_id = task_id
        self.agent_id = agent_id

    def bind_run(self, task_id: str, *, agent_id: str | None = None) -> None:
        """Bind persisted Todo state to one durable Run.

        A single Agent instance can be reused across follow-up Runs in the
        same Project. Reloading on a Run switch prevents one Run's plan from
        leaking into the next while preserving it for Resume.
        """

        next_working_dir = (
            Path(self._working_dir_for_task(task_id))
            if self._working_dir_for_task is not None
            else self._working_dir
        )
        with self._lock:
            run_changed = task_id != self.task_id
            directory_changed = next_working_dir != self._working_dir
            self.task_id = task_id
            self.agent_id = agent_id
            if run_changed or directory_changed:
                self._working_dir = next_working_dir
                self._md_path = next_working_dir / "todo.md"
                self._json_path = next_working_dir / ".todo.json"
                self.todos = self._load()

    def todo_write(self, todos: list[TodoItem]) -> str:
        """Create or update the current task todo list.

        Use this tool to track task progress with concise todo items. Each
        todo should include content, active_form, and status fields.

        Args:
            todos (list[TodoItem]): The full ordered todo list to store.

        Returns:
            str: A message indicating whether the todo list was updated.
        """
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
