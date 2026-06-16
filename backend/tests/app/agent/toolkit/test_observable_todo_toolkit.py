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

        assert result == "Todos have been modified successfully."
        queued = task_locks[project_id].queue.get_nowait()
        assert queued.action == Action.todo_state
        assert queued.data["project_id"] == project_id
        assert queued.data["task_id"] == task_id
        assert queued.data["agent_id"] == "agent-1"
        assert queued.data["todos"] == [
            {
                "id": "todo_1",
                "content": "Inspect the task",
                "active_form": "Inspecting the task",
                "status": "in_progress",
            }
        ]
    finally:
        task_locks.pop(project_id, None)
