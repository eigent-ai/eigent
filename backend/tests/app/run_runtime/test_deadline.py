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

from __future__ import annotations

import asyncio
import time

import pytest

from app.run_journal import SQLiteRunJournal
from app.run_policy import RunTimeoutPolicy
from app.run_runtime import RunCoordinator, RunInterruptedError
from app.run_runtime.coordinator import RuntimeHandle


@pytest.mark.asyncio
async def test_coordinator_enforces_only_a_persisted_run_deadline(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        deadline = time.time() + 0.05
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            deadline_at=deadline,
        )
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        coordinator = RunCoordinator(journal)

        async def source():
            await asyncio.Event().wait()
            yield "never"

        subscription = await coordinator.start_with_subscription(
            run_id="run-1",
            stream_factory=source,
        )
        await asyncio.sleep(0.1)

        assert subscription.handle.execution_task is not None
        assert subscription.handle.execution_task.cancelled()
        assert journal.get_run("run-1").status == "failed"
        assert (
            journal.list_events("run-1")[-1].event_type
            == "run.deadline_reached"
        )
        await coordinator.close()


@pytest.mark.asyncio
async def test_coordinator_without_persisted_deadline_interrupts_without_final(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        coordinator = RunCoordinator(journal)
        release = asyncio.Event()

        async def source():
            await release.wait()
            yield "done"

        subscription = await coordinator.start_with_subscription(
            run_id="run-1",
            stream_factory=source,
        )
        await asyncio.sleep(0.06)
        assert subscription.handle.consumer_alive
        release.set()
        assert await subscription.__anext__() == "done"
        with pytest.raises(StopAsyncIteration):
            await subscription.__anext__()
        assert journal.get_run("run-1").status == "interrupted"
        await coordinator.close()


@pytest.mark.asyncio
async def test_watcher_without_deadline_waits_for_policy_signal(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        coordinator = RunCoordinator(journal)
        handle = RuntimeHandle(run_id="run-1")
        reads = 0
        original_get_run = journal.get_run

        def counted_get_run(run_id: str):
            nonlocal reads
            reads += 1
            return original_get_run(run_id)

        journal.get_run = counted_get_run  # type: ignore[method-assign]
        watcher = asyncio.create_task(coordinator._watch_deadline(handle))
        await asyncio.sleep(0.05)
        assert reads == 1

        handle.deadline_changed_event.set()
        await asyncio.sleep(0.01)
        assert reads == 2
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)
        await coordinator.close()


@pytest.mark.asyncio
async def test_execution_backend_failure_is_a_durable_terminal_event(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        coordinator = RunCoordinator(journal)

        async def source():
            yield "started"
            raise RuntimeError("backend crashed")

        subscription = await coordinator.start_with_subscription(
            run_id="run-1",
            stream_factory=source,
        )
        assert await subscription.__anext__() == "started"
        with pytest.raises(Exception, match="backend crashed"):
            await subscription.__anext__()
        assert journal.get_run("run-1").status == "failed"
        assert journal.list_events("run-1")[-1].event_type == "run.failed"
        await coordinator.close()


@pytest.mark.asyncio
async def test_retryable_execution_failure_is_durably_interrupted(
    tmp_path, caplog
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        coordinator = RunCoordinator(journal)

        async def source():
            yield "error-frame"
            raise RunInterruptedError(
                "Client Closed Request", reason="model_transport_error"
            )

        subscription = await coordinator.start_with_subscription(
            run_id="run-1",
            stream_factory=source,
        )
        assert await subscription.__anext__() == "error-frame"
        with pytest.raises(StopAsyncIteration):
            await subscription.__anext__()

        run = journal.get_run("run-1")
        attempts = journal.list_run_attempts("run-1")
        event = journal.list_events("run-1")[-1]
        assert run is not None and run.status == "interrupted"
        assert attempts[-1].status == "interrupted"
        assert attempts[-1].ended_at is not None
        assert event.event_type == "runtime.interrupted"
        assert event.payload["reason"] == "model_transport_error"
        assert event.payload["retryable"] is True
        warning = next(
            record
            for record in caplog.records
            if record.getMessage() == "Detached Run execution interrupted"
        )
        assert warning.interruption_message == "Client Closed Request"
        await coordinator.close()


@pytest.mark.asyncio
async def test_deadline_configured_after_admission_is_enforced(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        coordinator = RunCoordinator(journal)

        async def source():
            await asyncio.Event().wait()
            yield "never"

        subscription = await coordinator.start_with_subscription(
            run_id="run-1",
            stream_factory=source,
        )
        journal.set_timeout_policy(
            "run-1",
            RunTimeoutPolicy(
                policy_version="v2",
                run_deadline_at=time.time() + 0.05,
            ),
        )
        await coordinator.notify_deadline_changed("run-1")
        await asyncio.sleep(0.1)

        assert subscription.handle.execution_task is not None
        assert subscription.handle.execution_task.cancelled()
        assert journal.get_run("run-1").status == "failed"
        await coordinator.close()


@pytest.mark.asyncio
async def test_extending_deadline_reschedules_existing_watcher(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            deadline_at=time.time() + 30,
        )
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        coordinator = RunCoordinator(journal)
        handle = RuntimeHandle(run_id="run-1")
        first_read = asyncio.Event()
        second_read = asyncio.Event()
        observed_deadlines: list[float | None] = []
        loop = asyncio.get_running_loop()
        original_get_run = journal.get_run

        def observed_get_run(run_id: str):
            run = original_get_run(run_id)
            observed_deadlines.append(run.deadline_at if run else None)
            event = first_read if len(observed_deadlines) == 1 else second_read
            loop.call_soon_threadsafe(event.set)
            return run

        journal.get_run = observed_get_run  # type: ignore[method-assign]
        watcher = asyncio.create_task(coordinator._watch_deadline(handle))
        await asyncio.wait_for(first_read.wait(), timeout=2)

        extended_deadline = time.time() + 60
        journal.set_timeout_policy(
            "run-1",
            RunTimeoutPolicy(
                policy_version="v2",
                run_deadline_at=extended_deadline,
            ),
        )
        handle.deadline_changed_event.set()
        await asyncio.wait_for(second_read.wait(), timeout=2)

        assert journal.get_run("run-1").status == "running"
        assert observed_deadlines[0] is not None
        assert observed_deadlines[0] < extended_deadline
        assert observed_deadlines[1] == extended_deadline

        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)
        await coordinator.close()
