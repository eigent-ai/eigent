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

import json
import logging
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from camel.toolkits import FunctionTool, TodoToolkit
from camel.toolkits.todo_toolkit import TodoItem
from pydantic import ValidationError

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.run_context import get_current_run_context
from app.run_journal import get_default_run_journal
from app.run_runtime.step_coordinator import PlanStepInput, RunStepCoordinator
from app.service.task import ActionTodoStateData, Agents, get_task_lock
from app.utils.listen.toolkit_listen import _safe_put_queue

logger = logging.getLogger("observable_todo_toolkit")


class ObservableTodoItem(TodoItem):
    """CAMEL todo item extended with a runtime-owned stable identity."""

    # OpenAI strict function schemas require every object property to appear
    # in ``required``. New plan items therefore send ``id: null``; Eigent
    # replaces that value with a runtime-owned stable identity.
    id: str | None


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

    def _load(self) -> list[ObservableTodoItem]:
        if not self._json_path.exists():
            return []
        try:
            data = json.loads(self._json_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning(
                "Failed to read %s, starting with empty list: %s",
                self._json_path,
                exc,
            )
            return []
        if not isinstance(data, list):
            logger.warning(
                "Expected a JSON array in %s, got %s; starting with empty list.",
                self._json_path,
                type(data).__name__,
            )
            return []
        items: list[ObservableTodoItem] = []
        for entry in data:
            try:
                # Run-local todo files created before stable identities did
                # not contain ``id``. Keep those files readable even though
                # the model-facing strict schema now requires a nullable id.
                payload = dict(entry) if isinstance(entry, dict) else entry
                if isinstance(payload, dict):
                    payload.setdefault("id", None)
                item = ObservableTodoItem.model_validate(payload)
            except ValidationError as exc:
                logger.warning(
                    "Skipping malformed todo entry in %s: %s",
                    self._json_path,
                    exc,
                )
                continue
            if not item.id:
                item.id = f"pli_{uuid.uuid4().hex}"
            items.append(item)
        return items

    def _match_key(self, item: ObservableTodoItem) -> tuple[str, str]:
        return (item.content.strip(), item.active_form.strip())

    def _validated_with_stable_ids(
        self, todos: list[ObservableTodoItem]
    ) -> list[ObservableTodoItem]:
        validated: list[ObservableTodoItem] = []
        for item in todos:
            if isinstance(item, ObservableTodoItem):
                validated.append(item)
                continue
            payload = (
                item.model_dump() if hasattr(item, "model_dump") else item
            )
            if isinstance(payload, dict):
                payload = {**payload, "id": payload.get("id")}
            validated.append(ObservableTodoItem.model_validate(payload))
        previous = [
            item
            if isinstance(item, ObservableTodoItem)
            else ObservableTodoItem.model_validate(
                {**item.model_dump(), "id": getattr(item, "id", None)}
            )
            for item in self.todos
        ]
        known = {item.id: item for item in previous if item.id}
        by_key: dict[tuple[str, str], list[ObservableTodoItem]] = {}
        for item in previous:
            by_key.setdefault(self._match_key(item), []).append(item)

        claimed: set[str] = set()
        normalized: list[ObservableTodoItem] = []
        for item in validated:
            stable_id = (
                item.id
                if item.id in known and item.id not in claimed
                else None
            )
            if stable_id is None:
                matches = [
                    candidate
                    for candidate in by_key.get(self._match_key(item), [])
                    if candidate.id and candidate.id not in claimed
                ]
                if len(matches) == 1:
                    stable_id = matches[0].id
            stable_id = stable_id or f"pli_{uuid.uuid4().hex}"
            claimed.add(stable_id)
            normalized.append(item.model_copy(update={"id": stable_id}))
        return normalized

    def todo_write(self, todos: list[ObservableTodoItem]) -> str:
        """Create or update the current task todo list.

        Use this tool to track task progress with concise todo items. Each
        todo must include content, active_form, status, and id fields. Pass
        id as null for a new item and preserve the returned stable id in
        later updates.

        Args:
            todos (list[ObservableTodoItem]): The full ordered todo list to
                store. Use null as the id for a new item. Preserve an
                existing item's id when updating or reordering it.

        Returns:
            str: A message indicating whether the todo list was updated.
        """
        try:
            validated = self._validated_with_stable_ids(todos)
        except ValidationError as exc:
            return f"[ERROR] Failed to update todos: {exc}"

        with self._lock:
            previous = list(self.todos)
            self.todos = validated
            self._save()
        try:
            self._reconcile_authored_steps()
        except Exception as exc:
            with self._lock:
                self.todos = previous
                self._save()
            logger.exception("Failed to persist authored Step lifecycle")
            return f"[ERROR] Failed to update todos: {exc}"

        self.emit_todo_state()
        identities = ", ".join(item.id or "" for item in validated)
        return (
            "Todos have been modified successfully. Preserve these item IDs "
            f"in later updates: {identities}"
        )

    def _reconcile_authored_steps(self) -> None:
        run_context = get_current_run_context()
        if run_context is None or run_context.run_id != self.task_id:
            return
        committed = RunStepCoordinator(
            get_default_run_journal()
        ).reconcile_plan(
            project_id=self.api_task_id,
            run_id=self.task_id,
            agent_id=self.agent_id,
            items=[
                PlanStepInput(
                    plan_item_id=item.id or "",
                    title=item.content,
                    active_form=item.active_form,
                    status=item.status,
                    ordinal=index,
                )
                for index, item in enumerate(self.todos, start=1)
            ],
        )
        if committed:
            from app.run_sync.runtime import notify_default_cloud_sync_worker

            notify_default_cloud_sync_worker()

    def step_update(self, plan_item_id: str, summary: str) -> str:
        """Record a concise, user-meaningful update for the active plan item.

        Args:
            plan_item_id: Stable ID returned by ``todo_write``.
            summary: A short factual progress update. Do not include secrets,
                raw command output, or absolute local paths.

        Returns:
            str: Confirmation that the durable authored Step was updated.
        """

        current = next(
            (item for item in self.todos if item.id == plan_item_id),
            None,
        )
        if current is None:
            return f"[ERROR] Unknown plan item id: {plan_item_id}"
        if current.status != "in_progress":
            return (
                f"[ERROR] Plan item {plan_item_id} is not currently "
                "in_progress"
            )
        run_context = get_current_run_context()
        if run_context is None or run_context.run_id != self.task_id:
            return "[ERROR] Authored Step update requires an active Run"
        try:
            RunStepCoordinator(get_default_run_journal()).record_progress(
                project_id=self.api_task_id,
                run_id=self.task_id,
                plan_item_id=plan_item_id,
                summary=summary,
                agent_id=self.agent_id,
            )
        except Exception as exc:
            logger.exception("Failed to persist authored Step progress")
            return f"[ERROR] Failed to update Step: {exc}"
        from app.run_sync.runtime import notify_default_cloud_sync_worker

        notify_default_cloud_sync_worker()
        return "Step progress recorded successfully."

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
        for item in self.todos:
            serialized.append(
                {
                    "id": getattr(item, "id", None)
                    or f"pli_{uuid.uuid4().hex}",
                    "content": item.content,
                    "active_form": item.active_form,
                    "status": item.status,
                }
            )
        return serialized

    def get_tools(self) -> list[FunctionTool]:
        tools = [FunctionTool(self.todo_write), FunctionTool(self.step_update)]
        for tool in tools:
            try:
                tool._toolkit_name = self.toolkit_name()
            except Exception:
                pass
        return tools

    @classmethod
    def toolkit_name(cls) -> str:
        return "TodoToolkit"
