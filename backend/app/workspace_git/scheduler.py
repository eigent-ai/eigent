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

"""Durable Task scheduling for a shared physical Git checkout."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.run_journal import (
    ProjectWorkspaceBindingRecord,
    RunEventDraft,
    SQLiteRunJournal,
    WorkspaceWriterRequestRecord,
    configured_run_journal_path,
    get_default_run_journal,
)


class WorkspaceWriterInterruptedError(RuntimeError):
    """Raised when a queued Task is cancelled before it can write."""


@dataclass(frozen=True)
class WorkspaceWriterAdmission:
    request: WorkspaceWriterRequestRecord
    event_type: str


class WorkspaceWriterScheduler:
    """Use RunJournal as the queue; UI/EventBus state is a projection.

    Today every normal Agent Task is admitted as potentially mutating. A
    future explicit read-only capability may skip this lease only when shell,
    scripts, MCPs, and every other write path are disabled.
    """

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        poll_interval_seconds: float = 0.25,
    ) -> None:
        if poll_interval_seconds <= 0:
            raise ValueError("writer queue poll interval must be positive")
        self.journal = journal
        self.poll_interval_seconds = poll_interval_seconds

    @staticmethod
    def request_id(run_id: str) -> str:
        value = run_id.strip()
        if not value:
            raise ValueError("Run id is required for writer admission")
        return f"workspace-writer:{value}"

    def admit_task(
        self,
        *,
        run_id: str,
        task_id: str,
        project_id: str,
        binding: ProjectWorkspaceBindingRecord,
        reason: str = "task.mutating_default",
    ) -> WorkspaceWriterAdmission:
        request = self.journal.enqueue_workspace_writer(
            request_id=self.request_id(run_id),
            repository_id=binding.repository_id,
            checkout_id=binding.checkout_id,
            task_id=task_id,
            project_id=project_id,
            target_ref=binding.target_ref,
            reason=reason,
        )
        event_type = (
            "workspace.writer.acquired"
            if request.status == "acquired"
            else "workspace.writer.queued"
        )
        self._record_state(run_id, request, event_type=event_type)
        return WorkspaceWriterAdmission(
            request=request,
            event_type=event_type,
        )

    async def wait_until_acquired(
        self,
        *,
        run_id: str,
        task_id: str,
    ) -> WorkspaceWriterRequestRecord | None:
        """Wait without a deadline; cancellation belongs to the owning Task."""

        request_id = self.request_id(run_id)
        while True:
            request = await asyncio.to_thread(
                self.journal.get_workspace_writer_request,
                request_id,
            )
            if request is None:
                return None
            if request.task_id != task_id:
                raise WorkspaceWriterInterruptedError(
                    "workspace writer admission belongs to another Task"
                )
            if request.status == "acquired":
                await asyncio.to_thread(
                    self._record_state,
                    run_id,
                    request,
                    event_type="workspace.writer.acquired",
                )
                return request
            if request.status in {"released", "interrupted"}:
                raise WorkspaceWriterInterruptedError(
                    f"workspace writer admission ended as {request.status}"
                )
            await asyncio.sleep(self.poll_interval_seconds)

    def finish_task(
        self,
        *,
        run_id: str,
        task_id: str | None = None,
    ) -> WorkspaceWriterRequestRecord | None:
        """Release an acquired lease or remove a terminal queued request."""

        request_id = self.request_id(run_id)
        request = self.journal.get_workspace_writer_request(request_id)
        if request is None:
            return None
        if task_id is not None and request.task_id != task_id:
            raise WorkspaceWriterInterruptedError(
                "workspace writer finalization belongs to another Task"
            )
        if request.status in {"released", "interrupted"}:
            self._record_state(
                run_id,
                request,
                event_type=(
                    "workspace.writer.released"
                    if request.status == "released"
                    else "workspace.writer.interrupted"
                ),
            )
            return request
        if request.status == "queued":
            result = self.journal.interrupt_workspace_writer(
                request_id=request_id,
                task_id=request.task_id,
            )
            event_type = "workspace.writer.interrupted"
        else:
            result = self.journal.release_workspace_writer(
                request_id=request_id,
                task_id=request.task_id,
            )
            event_type = "workspace.writer.released"
        self._record_state(run_id, result.finished, event_type=event_type)
        return result.finished

    def _record_state(
        self,
        run_id: str,
        request: WorkspaceWriterRequestRecord,
        *,
        event_type: str,
    ) -> None:
        waited = (
            request.acquired_at is not None
            and request.acquired_at > request.created_at
        )
        wait_duration_ms = (
            max(0, round((request.acquired_at - request.created_at) * 1000))
            if waited and request.acquired_at is not None
            else None
        )
        self.journal.append_event(
            run_id,
            RunEventDraft(
                event_id=(
                    f"{event_type}:{request.request_id}:"
                    f"{request.queue_position or 0}:"
                    f"{request.blocker_task_id or 'none'}"
                ),
                event_type=event_type,
                payload={
                    "request_id": request.request_id,
                    "repository_id": request.repository_id,
                    "checkout_id": request.checkout_id,
                    "task_id": request.task_id,
                    "project_id": request.project_id,
                    "target_ref": request.target_ref,
                    "reason": request.reason,
                    "queue_position": request.queue_position,
                    "blocker_task_id": request.blocker_task_id,
                    "waited": waited,
                    "wait_duration_ms": wait_duration_ms,
                },
            ),
            expected_project_id=request.project_id,
        )


def get_default_workspace_writer_scheduler() -> WorkspaceWriterScheduler:
    journal = get_default_run_journal()
    if not isinstance(journal, SQLiteRunJournal):
        raise RuntimeError(
            "Workspace writer scheduling requires a local SQLite RunJournal "
            f"at {configured_run_journal_path()}"
        )
    return WorkspaceWriterScheduler(journal)
