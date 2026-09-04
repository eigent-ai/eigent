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

import pytest

from app.run_journal import SQLiteRunJournal
from app.run_runtime import RunCoordinator, RunExecutionError, RunRuntimeError


@pytest.mark.asyncio
async def test_initial_subscriber_is_registered_before_first_publish():
    coordinator = RunCoordinator()

    async def source():
        yield "first"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )

    assert await subscription.__anext__() == "first"
    with pytest.raises(StopAsyncIteration):
        await subscription.__anext__()


@pytest.mark.asyncio
async def test_admission_scope_deduplicates_concurrent_run_start():
    coordinator = RunCoordinator()
    first_admission_entered = asyncio.Event()
    release_first_admission = asyncio.Event()
    finish_execution = asyncio.Event()
    prepare_count = 0

    async def source():
        await finish_execution.wait()
        yield "done"

    async def admit():
        nonlocal prepare_count
        async with coordinator.admission_scope("run-1"):
            existing = await coordinator.attach_if_running("run-1")
            if existing is not None:
                return existing, False

            prepare_count += 1
            first_admission_entered.set()
            await release_first_admission.wait()
            subscription = await coordinator.start_with_subscription(
                run_id="run-1",
                stream_factory=source,
            )
            return subscription, True

    first = asyncio.create_task(admit())
    await first_admission_entered.wait()
    second = asyncio.create_task(admit())
    await asyncio.sleep(0)
    release_first_admission.set()

    (
        (first_subscription, first_started),
        (
            second_subscription,
            second_started,
        ),
    ) = await asyncio.gather(first, second)

    assert prepare_count == 1
    assert first_started is True
    assert second_started is False
    assert first_subscription.handle is second_subscription.handle
    assert first_subscription.handle.subscriber_count == 2

    await first_subscription.aclose()
    await second_subscription.aclose()
    finish_execution.set()
    await first_subscription.handle.wait()


@pytest.mark.asyncio
async def test_terminal_marker_has_reserved_capacity():
    coordinator = RunCoordinator()

    async def source():
        yield "only-event"

    subscription = await coordinator.start_with_subscription(
        run_id="run-small-buffer",
        stream_factory=source,
        subscriber_buffer=1,
    )
    await subscription.handle.wait()

    assert await subscription.__anext__() == "only-event"
    with pytest.raises(StopAsyncIteration):
        await subscription.__anext__()


@pytest.mark.asyncio
async def test_detaching_last_subscriber_does_not_cancel_execution():
    coordinator = RunCoordinator()
    release = asyncio.Event()
    continued = asyncio.Event()

    async def source():
        yield "first"
        await release.wait()
        continued.set()
        yield "second"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    handle = subscription.handle
    assert await subscription.__anext__() == "first"

    await subscription.aclose()
    assert handle.subscriber_count == 0
    assert handle.consumer_alive is True

    release.set()
    await handle.wait()
    assert continued.is_set()


@pytest.mark.asyncio
async def test_rebind_moves_live_consumer_to_follow_up_run():
    coordinator = RunCoordinator()
    release = asyncio.Event()

    async def source():
        await release.wait()
        yield "follow-up"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )

    assert await coordinator.rebind_run("run-1", "run-2") is True
    assert await coordinator.get_handle("run-1") is None
    assert await coordinator.get_handle("run-2") is subscription.handle
    assert subscription.handle.run_id == "run-2"

    release.set()
    assert await subscription.__anext__() == "follow-up"
    with pytest.raises(StopAsyncIteration):
        await subscription.__anext__()
    assert await coordinator.get_handle("run-2") is None


@pytest.mark.asyncio
async def test_detached_warm_consumer_owns_follow_up_trigger_and_terminal(
    tmp_path,
):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    coordinator = RunCoordinator(journal)
    command_queue: asyncio.Queue[str] = asyncio.Queue()
    consumer_started = asyncio.Event()
    active_consumers = 0
    max_consumers = 0
    consumed: list[tuple[str, str]] = []
    handle_box = {}
    try:
        journal.ensure_run(run_id="run-old", project_id="project-1")

        async def source():
            nonlocal active_consumers, max_consumers
            active_consumers += 1
            max_consumers = max(max_consumers, active_consumers)
            consumer_started.set()
            try:
                while True:
                    command = await command_queue.get()
                    current_run_id = handle_box["handle"].run_id
                    consumed.append((current_run_id, command))
                    assert await coordinator.complete_turn(
                        current_run_id,
                        project_id="project-1",
                        assistant_data=f"handled {command}",
                    )
                    yield f"{current_run_id}:{command}"
            finally:
                active_consumers -= 1

        subscription = await coordinator.start_with_subscription(
            run_id="run-old",
            stream_factory=source,
            command_queue=command_queue,
        )
        handle_box["handle"] = subscription.handle
        await consumer_started.wait()
        assert await coordinator.complete_turn(
            "run-old",
            project_id="project-1",
            assistant_data="old result",
        )

        # Browser transport abort only detaches its subscriber. The queue
        # consumer intentionally remains warm for a follow-up rebind.
        await subscription.aclose()
        assert subscription.handle.subscriber_count == 0
        assert subscription.handle.consumer_alive is True

        journal.ensure_run(run_id="run-new", project_id="project-1")
        assert await coordinator.rebind_run("run-old", "run-new") is True
        follow_up = await coordinator.subscribe("run-new")
        await command_queue.put("scheduled-trigger")

        assert await follow_up.__anext__() == "run-new:scheduled-trigger"
        assert consumed == [("run-new", "scheduled-trigger")]
        assert max_consumers == 1
        assert journal.get_run("run-new").status == "completed"
        final = journal.get_run_final_result_event("run-new")
        assert final is not None
        assert final.payload == {"message": "handled scheduled-trigger"}
    finally:
        await coordinator.close()
        journal.close()


@pytest.mark.asyncio
async def test_task_lock_queue_rejects_a_second_live_consumer():
    coordinator = RunCoordinator()
    command_queue: asyncio.Queue[str] = asyncio.Queue()
    release = asyncio.Event()

    async def source():
        await release.wait()
        yield "done"

    first = await coordinator.start_with_subscription(
        run_id="run-old",
        stream_factory=source,
        command_queue=command_queue,
    )
    with pytest.raises(RunRuntimeError, match="already has a live consumer"):
        await coordinator.start_with_subscription(
            run_id="run-new",
            stream_factory=source,
            command_queue=command_queue,
        )

    assert await coordinator.get_queue_owner(command_queue) is first.handle
    release.set()
    await first.handle.wait()


@pytest.mark.asyncio
async def test_execution_failure_is_forwarded_without_unhandled_task_error():
    coordinator = RunCoordinator()

    async def source():
        yield "first"
        raise ValueError("boom")

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    assert await subscription.__anext__() == "first"
    with pytest.raises(RunExecutionError, match="boom"):
        await subscription.__anext__()


@pytest.mark.asyncio
async def test_explicit_coordinator_close_cancels_execution():
    coordinator = RunCoordinator()
    started = asyncio.Event()

    async def source():
        started.set()
        await asyncio.Event().wait()
        yield "never"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    handle = subscription.handle
    await started.wait()

    await coordinator.close()

    assert handle.execution_task is not None
    assert handle.execution_task.cancelled()
    assert handle.completed_at is not None


@pytest.mark.asyncio
async def test_completed_run_references_its_canonical_assistant_result(
    tmp_path,
):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    coordinator = RunCoordinator(journal)
    release = asyncio.Event()
    try:
        journal.ensure_run(run_id="run-result", project_id="project-1")

        async def source():
            await release.wait()
            yield "transport closes later"

        await coordinator.start_with_subscription(
            run_id="run-result",
            stream_factory=source,
        )
        assert await coordinator.complete_turn(
            "run-result",
            project_id="project-1",
            assistant_data="The durable answer",
        )
        final = journal.get_run_final_result_event("run-result")
        assert final is not None

        completed = next(
            event
            for event in journal.list_events("run-result")
            if event.event_type == "run.completed"
        )
        manifest = journal.get_run_artifact_manifest_event("run-result")
        assert manifest is not None
        assert manifest.sequence < completed.sequence
        assert (
            completed.payload["artifact_manifest_event_id"]
            == manifest.event_id
        )
        assert completed.payload["artifact_count"] == 0
        assert completed.payload["result_event_id"] == final.event_id
    finally:
        release.set()
        await coordinator.close()
        journal.close()


@pytest.mark.asyncio
async def test_logical_turn_completes_without_disposing_warm_runtime(tmp_path):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    coordinator = RunCoordinator(journal)
    release = asyncio.Event()
    try:
        journal.ensure_run(run_id="run-turn", project_id="project-1")

        async def source():
            await release.wait()
            yield "later"

        subscription = await coordinator.start_with_subscription(
            run_id="run-turn",
            stream_factory=source,
        )
        assert (
            await coordinator.complete_turn(
                "run-turn",
                project_id="project-1",
                assistant_data="Done",
            )
            is True
        )
        assert journal.get_run("run-turn").status == "completed"
        final = journal.get_run_final_result_event("run-turn")
        assert final is not None
        completed = next(
            event
            for event in journal.list_events("run-turn")
            if event.event_type == "run.completed"
        )
        assert completed.payload["result_event_id"] == final.event_id
        assert await coordinator.get_handle("run-turn") is subscription.handle
    finally:
        release.set()
        await coordinator.close()
        journal.close()


@pytest.mark.asyncio
async def test_completed_run_quiesces_background_terminal_mutations(
    tmp_path,
    monkeypatch,
):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    coordinator = RunCoordinator(journal)
    release = asyncio.Event()
    calls: list[str] = []

    class _TerminalToolkit:
        def quiesce_run_background_sessions(self, run_id):
            calls.append(run_id)
            return ()

    task_lock = type(
        "TaskLockStub",
        (),
        {"registered_toolkits": [_TerminalToolkit()]},
    )()
    monkeypatch.setattr(
        "app.service.task.get_task_lock_if_exists",
        lambda project_id: task_lock if project_id == "project-1" else None,
    )
    try:
        journal.ensure_run(run_id="run-turn", project_id="project-1")

        async def source():
            await release.wait()
            yield "later"

        await coordinator.start_with_subscription(
            run_id="run-turn",
            stream_factory=source,
        )

        assert await coordinator.complete_turn(
            "run-turn",
            project_id="project-1",
            assistant_data="Done",
        )
        assert calls == ["run-turn"]
        assert journal.get_run("run-turn").status == "completed"
    finally:
        release.set()
        await coordinator.close()
        journal.close()


@pytest.mark.asyncio
async def test_warm_turn_cancel_never_becomes_success_on_legacy_end(tmp_path):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    coordinator = RunCoordinator(journal)
    release = asyncio.Event()
    try:
        journal.ensure_run(run_id="run-cancel", project_id="project-1")
        journal.create_run_attempt(
            "run-cancel",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )

        async def source():
            await release.wait()
            yield "legacy end transport"

        await coordinator.start_with_subscription(
            run_id="run-cancel",
            stream_factory=source,
        )
        await coordinator.complete_cancelled_turn(
            "run-cancel",
            request_id="user-stop:run-cancel",
        )

        assert (
            await coordinator.complete_turn(
                "run-cancel",
                project_id="project-1",
                assistant_data="Task stopped by user",
            )
            is True
        )
        assert journal.get_run("run-cancel").status == "cancelled"
        assert journal.get_run_final_result_event("run-cancel") is None
        assert "run.completed" not in {
            event.event_type for event in journal.list_events("run-cancel")
        }
    finally:
        release.set()
        await coordinator.close()
        journal.close()
