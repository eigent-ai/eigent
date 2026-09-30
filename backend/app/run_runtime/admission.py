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
import uuid
from collections.abc import Awaitable, Callable
from concurrent.futures import Future
from typing import ParamSpec, TypeVar

from app.run_context import RunContext
from app.run_journal import (
    InvalidRunTransitionError,
    SQLiteRunJournal,
    get_default_run_journal,
)
from app.run_journal.models import (
    AttemptEnvironmentBinding,
    RunAttemptRecord,
    WarmAdmissionReceipt,
)
from app.service.task import ActionImproveData, TaskLock
from app.workspace_git.coordinator import get_default_workspace_git_coordinator
from app.workspace_git.scheduler import WorkspaceWriterScheduler

_Result = TypeVar("_Result")
_Params = ParamSpec("_Params")


async def drain_admission(
    awaitable: Awaitable[_Result], *, propagate_cancellation: bool = True
) -> _Result:
    """Do not abandon an admission worker or its cleanup on HTTP cancellation."""
    task = asyncio.ensure_future(awaitable)
    cancelled = False
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError:
            cancelled = True
            if task.done():
                result = task.result()
                break
    if cancelled and propagate_cancellation:
        raise asyncio.CancelledError
    return result


async def admission_to_thread(
    function: Callable[_Params, _Result],
    /,
    *args: _Params.args,
    **kwargs: _Params.kwargs,
) -> _Result:
    return await drain_admission(asyncio.to_thread(function, *args, **kwargs))


class WarmRunAdmission:
    """Prepare -> stage -> publish, or retryable abort before publication.

    The existing Session admission gate serializes callers. Cancellation drains
    each worker before abort; a staged envelope waits for the publication result
    and can never execute an aborted preparation.
    """

    def __init__(
        self,
        journal: SQLiteRunJournal,
        task_lock: TaskLock,
        *,
        logger: logging.Logger,
        run_id: str | None = None,
    ) -> None:
        self.journal = journal
        self.task_lock = task_lock
        self.logger = logger
        self.receipt: WarmAdmissionReceipt | None = None
        self.publication: Future[bool] = Future()
        self.published = False
        self.run_id = run_id
        self._owner = asyncio.current_task()
        self._finished: Future[None] = Future()
        self._aborted = False

    def finish(self) -> None:
        """Signal only after the controller has drained workers and rollback."""
        self._finished.set_result(None)

    async def cancel_before_publication(self) -> bool:
        """Stop may not terminalize while a preparatory worker can acquire Git."""
        owner = self._owner
        if owner is None:
            return False

        def cancel_owner() -> None:
            # Execute on the request loop: publication may have committed while
            # the consumer was scheduling this callback from another loop.
            if (
                not self._finished.done()
                and not self.published
                and not (self.receipt is not None and self.receipt.published)
            ):
                owner.cancel()

        owner.get_loop().call_soon_threadsafe(cancel_owner)
        await drain_admission(asyncio.wrap_future(self._finished))
        if (
            not self.published
            and self.receipt is not None
            and self.receipt.owned
        ):
            raise InvalidRunTransitionError(
                "warm admission rollback did not release ownership"
            )
        return self._aborted

    async def prepare(
        self,
        context: RunContext,
        *,
        request_id: str,
        environment: AttemptEnvironmentBinding | None,
    ) -> RunAttemptRecord:
        if not isinstance(self.journal, SQLiteRunJournal):
            return await admission_to_thread(
                self.journal.create_run_attempt,
                context.run_id,
                request_id=request_id,
                reason="follow_up_execution",
                activate=False,
                environment=environment,
            )
        self.receipt = WarmAdmissionReceipt(
            run_id=context.run_id,
            project_id=context.project_id,
            task_id=context.task_id,
            request_id=request_id,
            token=uuid.uuid4().hex,
        )
        attempt = await admission_to_thread(
            self.journal.begin_warm_admission,
            self.receipt,
            environment=environment,
        )
        receipt = self.receipt
        if receipt.owned:

            def admit_git():
                try:
                    return get_default_workspace_git_coordinator().admit_run(
                        space_id=context.space_id,
                        project_id=context.project_id,
                        run_id=context.run_id,
                        task_id=context.task_id,
                        session_mode=context.session_mode,
                    )
                finally:
                    # Admission can fail after creating the writer. Capture its
                    # exact acquisition even on failure, before draining returns.
                    receipt.writer = self.journal.get_workspace_writer_request(
                        WorkspaceWriterScheduler.request_id(context.run_id)
                    )

            await admission_to_thread(admit_git)
        return attempt

    async def publish(self, item: ActionImproveData) -> None:
        item._publication = self.publication
        try:
            await self.task_lock.put_queue(item)
            if self.receipt is not None:
                await admission_to_thread(
                    self.journal.publish_warm_admission, self.receipt
                )
            self.published = True
        finally:
            # A cancelled caller can observe a committed publication. Ownership
            # has transferred to the consumer; never roll it back in that case.
            if self.receipt is not None and self.receipt.published:
                self.published = True
            if self.published and not self.publication.done():
                self.publication.set_result(True)

    async def abort(self) -> None:
        if self.published:
            return
        if not self.publication.done():
            self.publication.set_result(False)
        if self.receipt is None:
            self._aborted = True
            return
        if not self.receipt.owned:
            self._aborted = self.receipt.attempt_id is None
            return
        result = await asyncio.to_thread(
            self.journal.abort_warm_admission, self.receipt
        )
        self._aborted = True
        if result is not None:
            scheduler = WorkspaceWriterScheduler(self.journal)
            await asyncio.to_thread(
                scheduler._record_state,
                self.receipt.run_id,
                result.finished,
                event_type="workspace.writer.interrupted",
            )
            await asyncio.to_thread(
                scheduler._record_promoted_request, result.next_acquired
            )


async def abort_pending_warm_admission(task_lock: TaskLock) -> bool:
    """Consume Stop as a retryable abort when its turn is still unpublished."""
    admission = getattr(task_lock, "_warm_admission", None)
    context = getattr(task_lock, "run_context", None)
    if (
        not isinstance(admission, WarmRunAdmission)
        or not isinstance(context, RunContext)
        or admission.run_id not in {context.run_id, task_lock.current_task_id}
    ):
        return False
    return await admission.cancel_before_publication()


async def activate_improve_admission(
    task_lock: TaskLock,
    item: ActionImproveData,
    *,
    project_id: str,
    logger: logging.Logger,
) -> bool:
    """Activate a pending Attempt once and discard duplicate queue envelopes."""

    if item._publication is not None and not await asyncio.shield(
        asyncio.wrap_future(item._publication)
    ):
        return False
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
