from __future__ import annotations

import asyncio
import time

import pytest

from app.run_journal import SQLiteRunJournal
from app.run_policy import RunTimeoutPolicy
from app.run_runtime import RunCoordinator
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
async def test_coordinator_without_persisted_deadline_keeps_execution_alive(
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
        assert journal.get_run("run-1").status == "completed"
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
            deadline_at=time.time() + 0.05,
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
        await asyncio.sleep(0.01)
        journal.set_timeout_policy(
            "run-1",
            RunTimeoutPolicy(
                policy_version="v2",
                run_deadline_at=time.time() + 0.15,
            ),
        )
        await coordinator.notify_deadline_changed("run-1")
        await asyncio.sleep(0.07)

        assert subscription.handle.consumer_alive
        assert journal.get_run("run-1").status == "running"

        await asyncio.sleep(0.12)
        assert subscription.handle.execution_task is not None
        assert subscription.handle.execution_task.cancelled()
        assert journal.get_run("run-1").status == "failed"
        await coordinator.close()
