from __future__ import annotations

import asyncio
import time

import pytest

from app.run_journal import SQLiteRunJournal
from app.run_runtime import RunCoordinator


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
