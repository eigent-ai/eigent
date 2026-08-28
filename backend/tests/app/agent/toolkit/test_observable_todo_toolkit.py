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

import asyncio

import pytest

from app.agent.toolkit.observable_todo_toolkit import ObservableTodoToolkit
from app.service.task import Action, TaskLock, task_locks


@pytest.mark.unit
def test_todo_write_tool_schema_has_description(tmp_path):
    toolkit = ObservableTodoToolkit(
        api_task_id="project_single_agent_todo_schema",
        task_id="task_single_agent_todo_schema",
        working_dir=str(tmp_path),
    )

    tools = toolkit.get_tools()
    tool = next(
        item
        for item in tools
        if item.openai_tool_schema["function"]["name"] == "todo_write"
    )

    assert tool.openai_tool_schema["function"]["name"] == "todo_write"
    assert tool.openai_tool_schema["function"]["description"]
    item_schema = tool.openai_tool_schema["function"]["parameters"]["$defs"][
        "ObservableTodoItem"
    ]
    assert set(item_schema["required"]) == set(item_schema["properties"])
    assert {
        variant["type"] for variant in item_schema["properties"]["id"]["anyOf"]
    } == {
        "string",
        "null",
    }
    assert {item.openai_tool_schema["function"]["name"] for item in tools} == {
        "todo_write",
        "step_update",
    }


@pytest.mark.unit
def test_todo_write_emits_todo_state(tmp_path):
    project_id = "project_single_agent_todo"
    task_id = "task_single_agent_todo"
    task_locks[project_id] = TaskLock(project_id, asyncio.Queue(), {})

    try:
        toolkit = ObservableTodoToolkit(
            api_task_id=project_id,
            task_id=task_id,
            agent_id="agent-1",
            working_dir=str(tmp_path),
        )

        result = toolkit.todo_write(
            [
                {
                    "content": "Inspect the task",
                    "active_form": "Inspecting the task",
                    "status": "in_progress",
                }
            ]
        )

        assert result.startswith("Todos have been modified successfully.")
        queued = task_locks[project_id].queue.get_nowait()
        assert queued.action == Action.todo_state
        assert queued.data["project_id"] == project_id
        assert queued.data["task_id"] == task_id
        assert queued.data["agent_id"] == "agent-1"
        assert queued.data["todos"] == [
            {
                "id": toolkit.todos[0].id,
                "content": "Inspect the task",
                "active_form": "Inspecting the task",
                "status": "in_progress",
            }
        ]
    finally:
        task_locks.pop(project_id, None)


@pytest.mark.unit
def test_todo_state_is_isolated_per_run_and_restored_on_resume(tmp_path):
    def working_dir_for_task(task_id: str):
        return tmp_path / task_id

    toolkit = ObservableTodoToolkit(
        api_task_id="project_run_scoped_todo",
        task_id="run-one",
        working_dir_for_task=working_dir_for_task,
    )
    toolkit.todo_write(
        [
            {
                "content": "Plan for run one",
                "active_form": "Planning run one",
                "status": "in_progress",
            }
        ]
    )

    toolkit.bind_run("run-two")

    assert toolkit.serialized_todos() == []
    toolkit.todo_write(
        [
            {
                "content": "Plan for run two",
                "active_form": "Planning run two",
                "status": "completed",
            }
        ]
    )

    toolkit.bind_run("run-one")

    restored = toolkit.serialized_todos()
    assert restored == [
        {
            "id": toolkit.todos[0].id,
            "content": "Plan for run one",
            "active_form": "Planning run one",
            "status": "in_progress",
        }
    ]
    assert (tmp_path / "run-one" / ".todo.json").exists()
    assert (tmp_path / "run-two" / ".todo.json").exists()


@pytest.mark.unit
def test_todo_ids_survive_reorder_and_resume(tmp_path):
    toolkit = ObservableTodoToolkit(
        api_task_id="project-stable-plan",
        task_id="run-stable-plan",
        working_dir=str(tmp_path),
    )
    toolkit.todo_write(
        [
            {
                "content": "Inspect",
                "active_form": "Inspecting",
                "status": "in_progress",
            },
            {
                "content": "Verify",
                "active_form": "Verifying",
                "status": "pending",
            },
        ]
    )
    first_ids = {item.content: item.id for item in toolkit.todos}

    toolkit.todo_write(
        [
            {
                "content": "Verify",
                "active_form": "Verifying",
                "status": "in_progress",
            },
            {
                "content": "Inspect",
                "active_form": "Inspecting",
                "status": "completed",
            },
        ]
    )

    assert {item.content: item.id for item in toolkit.todos} == first_ids
    restored = ObservableTodoToolkit(
        api_task_id="project-stable-plan",
        task_id="run-stable-plan",
        working_dir=str(tmp_path),
    )
    assert {item.content: item.id for item in restored.todos} == first_ids


@pytest.mark.unit
def test_legacy_todo_without_id_is_loaded_with_stable_identity(tmp_path):
    (tmp_path / ".todo.json").write_text(
        '[{"content":"Inspect","active_form":"Inspecting",'
        '"status":"in_progress"}]',
        encoding="utf-8",
    )

    toolkit = ObservableTodoToolkit(
        api_task_id="project-legacy-plan",
        task_id="run-legacy-plan",
        working_dir=str(tmp_path),
    )

    assert toolkit.todos[0].content == "Inspect"
    assert toolkit.todos[0].id.startswith("pli_")
