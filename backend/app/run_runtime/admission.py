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

"""Shared in-process activation gate for durable improve commands."""

from __future__ import annotations

import asyncio
import logging

from app.run_journal import SQLiteRunJournal, get_default_run_journal
from app.service.task import ActionImproveData, TaskLock
from app.workspace_git.coordinator import get_default_workspace_git_coordinator
from app.workspace_git.scheduler import WorkspaceWriterScheduler


async def activate_improve_admission(
    task_lock: TaskLock,
    item: ActionImproveData,
    *,
    project_id: str,
    logger: logging.Logger,
) -> bool:
    """Activate a pending Attempt once and discard duplicate queue envelopes."""

    if not item.request_id:
        return True
    if item.request_id in task_lock.processed_improve_request_ids:
        logger.info(
            "Skipping duplicate improve admission",
            extra={"project_id": project_id, "request_id": item.request_id},
        )
        return False
    if item.attempt_id and item.run_id:
        journal = get_default_run_journal()
        if isinstance(journal, SQLiteRunJournal):
            await WorkspaceWriterScheduler(journal).wait_until_acquired(
                run_id=item.run_id,
                task_id=item.new_task_id or item.run_id,
            )
            coordinator = get_default_workspace_git_coordinator()
            await asyncio.to_thread(
                coordinator.refresh_run_boundary_after_writer_acquired,
                run_id=item.run_id,
                task_id=item.new_task_id or item.run_id,
                attempt_id=item.attempt_id,
            )
        await asyncio.to_thread(
            journal.activate_run_attempt,
            item.attempt_id,
            expected_run_id=item.run_id,
        )
    task_lock.processed_improve_request_ids.add(item.request_id)
    return True
