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
import logging
from dataclasses import dataclass

from app.run_journal import (
    ProjectWorkspaceBindingRecord,
    RunEventDraft,
    SQLiteRunJournal,
    WorkspaceWriterRequestRecord,
    configured_run_journal_path,
    get_default_run_journal,
)
from app.run_journal.semantic_events import semantic_event_fields


class WorkspaceWriterInterruptedError(RuntimeError):
    """Raised when a queued Task is cancelled before it can write."""


@dataclass(frozen=True)
class WorkspaceWriterAdmission:
    request: WorkspaceWriterRequestRecord
    event_type: str


@dataclass(frozen=True)
class WorkspaceWriterReconciliation:
    interrupted_request_ids: tuple[str, ...]
    promoted_request_ids: tuple[str, ...]
    preserved_request_ids: tuple[str, ...]
    failed_request_ids: tuple[str, ...]


logger = logging.getLogger(__name__)


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

    @staticmethod
    def run_id_from_request_id(request_id: str) -> str | None:
        prefix = "workspace-writer:"
        if not request_id.startswith(prefix):
            return None
        run_id = request_id[len(prefix) :].strip()
        return run_id or None

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
            # The transition that made the request terminal already emitted
            # its durable event. Re-emitting here is not an upgrade path: an
            # older app may have stored the same deterministic event_id with
            # a pre-semantic payload, which correctly conflicts with a newer
            # payload. Returning the terminal record makes finish idempotent
            # across restarts and schema-independent event evolution.
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
        self._record_promoted_request(result.next_acquired)
        return result.finished

    def reconcile_orphaned_admissions(
        self,
    ) -> WorkspaceWriterReconciliation:
        """Interrupt pre-Attempt writer requests left by a crashed admission.

        An interrupted Run with at least one Attempt remains resumable and
        deliberately keeps its checkout writer.  Only a request whose Run
        never created any Attempt is a half-finished admission and safe to
        reclaim during startup.
        """

        interrupted: list[str] = []
        promoted: list[str] = []
        preserved: list[str] = []
        failed: list[str] = []
        terminalized_run_ids: set[str] = set()
        for observed in self.journal.list_active_workspace_writer_requests():
            request = self.journal.get_workspace_writer_request(
                observed.request_id
            )
            if request is None or request.status not in {"queued", "acquired"}:
                continue
            run_id = self.run_id_from_request_id(request.request_id)
            if run_id is None:
                failed.append(request.request_id)
                logger.error(
                    "Workspace writer request has no recoverable Run identity",
                    extra={"request_id": request.request_id},
                )
                continue
            run = self.journal.get_run(run_id)
            attempts = (
                self.journal.list_run_attempts(run_id)
                if run is not None
                else []
            )
            if attempts:
                preserved.append(request.request_id)
                continue
            try:
                result = self.journal.interrupt_workspace_writer(
                    request_id=request.request_id,
                    task_id=request.task_id,
                )
                if run is not None:
                    self._record_state(
                        run_id,
                        result.finished,
                        event_type="workspace.writer.interrupted",
                    )
                    self._cancel_orphaned_run(run_id)
                    terminalized_run_ids.add(run_id)
                interrupted.append(result.finished.request_id)
                promoted_run_id = self._record_promoted_request(
                    result.next_acquired
                )
                if promoted_run_id is not None:
                    promoted.append(result.next_acquired.request_id)
            except Exception:
                failed.append(request.request_id)
                logger.exception(
                    "Failed to reconcile orphaned workspace writer admission",
                    extra={
                        "request_id": request.request_id,
                        "run_id": run_id,
                    },
                )
        # A previous startup may already have reclaimed the writer before the
        # process stopped. Finish those half-created Runs too so the UI never
        # offers Resume for a Run that has no Attempt to resume.
        for run in self.journal.list_all_runs():
            if (
                run.run_id in terminalized_run_ids
                or run.origin != "local"
                or run.status in {"completed", "failed", "cancelled"}
                or self.journal.list_run_attempts(run.run_id)
            ):
                continue
            request_id = self.request_id(run.run_id)
            try:
                self._cancel_orphaned_run(run.run_id)
            except Exception:
                failed.append(request_id)
                logger.exception(
                    "Failed to terminalize orphaned pre-Attempt Run",
                    extra={"request_id": request_id, "run_id": run.run_id},
                )
        return WorkspaceWriterReconciliation(
            interrupted_request_ids=tuple(interrupted),
            promoted_request_ids=tuple(promoted),
            preserved_request_ids=tuple(preserved),
            failed_request_ids=tuple(failed),
        )

    def _cancel_orphaned_run(self, run_id: str) -> None:
        run = self.journal.get_run(run_id)
        if run is None or run.status in {"completed", "failed", "cancelled"}:
            return
        request_id = run.cancel_request_id or (
            f"startup-orphaned-admission:{run_id}"
        )
        if run.cancel_request_id is None:
            self.journal.request_cancel(
                run_id,
                request_id=request_id,
                reason="admission_failed_before_attempt",
            )
        self.journal.complete_cancel(run_id, request_id=request_id)

    def _record_promoted_request(
        self,
        request: WorkspaceWriterRequestRecord | None,
    ) -> str | None:
        if request is None:
            return None
        run_id = self.run_id_from_request_id(request.request_id)
        if run_id is None or self.journal.get_run(run_id) is None:
            return None
        self._record_state(
            run_id,
            request,
            event_type="workspace.writer.acquired",
        )
        return run_id

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
                    **semantic_event_fields(
                        kind="workspace_writer",
                        subject_type="writer_request",
                        subject_id=request.request_id,
                        phase={
                            "workspace.writer.queued": "requested",
                            "workspace.writer.acquired": "started",
                            "workspace.writer.released": "completed",
                            "workspace.writer.interrupted": "cancelled",
                        }[event_type],
                        status={
                            "workspace.writer.queued": "pending",
                            "workspace.writer.acquired": "running",
                            "workspace.writer.released": "completed",
                            "workspace.writer.interrupted": "cancelled",
                        }[event_type],
                        source="workspace_writer_scheduler",
                        actor_type="system",
                        correlation={
                            "task_id": request.task_id,
                            "project_id": request.project_id,
                            "checkout_id": request.checkout_id,
                        },
                    ),
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
                    "display_title": {
                        "workspace.writer.queued": "Waiting for workspace",
                        "workspace.writer.acquired": "Workspace available",
                        "workspace.writer.released": "Workspace write completed",
                        "workspace.writer.interrupted": "Workspace wait stopped",
                    }[event_type],
                    "display_summary": (
                        "Another task is updating this Space"
                        if event_type == "workspace.writer.queued"
                        else "This task can continue"
                        if event_type == "workspace.writer.acquired"
                        else "Write access was released"
                        if event_type == "workspace.writer.released"
                        else "Write access ended before completion"
                    ),
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
