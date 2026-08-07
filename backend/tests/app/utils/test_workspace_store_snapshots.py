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

from app.utils.workspace_resolver import TaskSnapshot, WorkspaceStore


def task_snapshot(task_id: str, task_start_time: float) -> TaskSnapshot:
    return TaskSnapshot(
        task_id=task_id,
        project_id="project-1",
        space_id="space-1",
        user_id="7",
        working_directory=f"/work/{task_id}",
        task_output_root=f"/output/{task_id}",
        task_start_time=task_start_time,
        binding_source="space_local_brain",
        created_at="2026-07-31T00:00:00Z",
        workdir_mode="copy",
    )


def test_get_latest_project_snapshot_uses_persisted_start_time(
    monkeypatch, tmp_path
):
    store = WorkspaceStore()
    monkeypatch.setattr(store, "_state_roots", lambda *_args: (tmp_path,))
    store.save_snapshot("user@example.com", task_snapshot("task-old", 10))
    store.save_snapshot("user@example.com", task_snapshot("task-new", 20))
    store.save_snapshot(
        "user@example.com",
        TaskSnapshot(
            **{
                **task_snapshot("task-other", 30).__dict__,
                "project_id": "project-other",
            }
        ),
    )
    store.save_snapshot(
        "user@example.com",
        TaskSnapshot(
            **{
                **task_snapshot("task-other-user", 40).__dict__,
                "user_id": "99",
            }
        ),
    )

    latest = store.get_latest_project_snapshot(
        "user@example.com", "project-1", "space-1", "7"
    )

    assert latest is not None
    assert latest.task_id == "task-new"
