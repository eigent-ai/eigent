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

"""Isolated activation/cancellation with real temporary journal transactions."""

from __future__ import annotations

import asyncio
import threading

import pytest
import pytest_asyncio

from app.run_journal import InvalidRunTransitionError, SQLiteRunJournal
from app.run_runtime import RunCoordinator, RunExecutionError, RunRuntimeError
from app.workspace_runtime.store import WorkspaceStateStore


@pytest_asyncio.fixture
async def world(tmp_path, monkeypatch):
    with SQLiteRunJournal(tmp_path / "journal.sqlite") as journal:
        coordinator = RunCoordinator(journal)
        legacy_calls = []

        async def unexpected_legacy(*args, **kwargs):
            legacy_calls.append((args, kwargs))
            raise AssertionError(
                "isolated execution entered legacy finalization"
            )

        for name in (
            "_settle_unsuccessful_run",
            "_finalize_artifacts_before_terminal",
            "_commit_execution_terminal",
        ):
            monkeypatch.setattr(coordinator, name, unexpected_legacy)
        try:
            yield journal, coordinator
        finally:
            await coordinator.close()
            assert legacy_calls == []


def pending(journal, tmp_path, *, run_id="run", bind=True):
    journal.ensure_run(run_id=run_id, project_id=run_id, status="pending")
    attempt = journal.create_run_attempt(
        run_id, request_id=run_id, reason="test", activate=False
    )
    if bind:
        root = tmp_path / "source"
        root.mkdir(exist_ok=True)
        state = WorkspaceStateStore(journal)
        target = state.register_target(root)
        with journal._write_transaction() as connection:
            state.bind_run_in_transaction(
                connection,
                run_id=run_id,
                attempt_id=attempt.attempt_id,
                generation=1,
                workspace_id="workspace-" + run_id,
                provider="directory",
                snapshot_revision="input-" + run_id,
                root_path=str(tmp_path / run_id),
                target=target,
                policy_version="isolated-v1",
            )
    return dict(run_id=run_id, attempt_id=attempt.attempt_id, generation=1)


@pytest.mark.asyncio
async def test_register_is_dormant_locatable_and_exactly_idempotent(
    world, tmp_path
):
    journal, coordinator = world
    owner = pending(journal, tmp_path)
    calls = []

    async def runner(handle):
        calls.append(handle)

    handle = await coordinator.register_dormant(**owner, runner=runner)
    assert await coordinator.get_handle("run") is handle
    assert handle.consumer_alive
    assert not handle.activated
    assert not handle.runner_started
    assert (handle.attempt_id, handle.generation) == (owner["attempt_id"], 1)
    assert await coordinator.register_dormant(**owner, runner=runner) is handle
    with pytest.raises(RunRuntimeError, match="owner changed"):
        await coordinator.register_dormant(
            **{**owner, "generation": 2}, runner=runner
        )
    with pytest.raises(RunRuntimeError, match="owner changed"):
        await coordinator.cancel_dormant(**{**owner, "attempt_id": "wrong"})
    with pytest.raises(RunRuntimeError, match="owner changed"):
        await coordinator.activate_dormant(**{**owner, "generation": 2})
    subscription = await coordinator.attach_if_running("run")
    assert subscription.handle is handle
    await asyncio.sleep(0)
    assert calls == []
    assert journal.get_run_attempt(owner["attempt_id"]).status == "pending"
    cancelled = await coordinator.cancel_dormant(**owner)
    assert cancelled is handle
    assert not cancelled.runner_started
    assert cancelled.completed_at is not None
    with pytest.raises(StopAsyncIteration):
        await subscription.__anext__()
    assert await coordinator.cancel_dormant(**owner) is handle


@pytest.mark.asyncio
async def test_activation_commits_before_runner_and_finished_owner_cannot_restart(
    world, tmp_path
):
    journal, coordinator = world
    owner = pending(journal, tmp_path)
    entered, finish = asyncio.Event(), asyncio.Event()
    calls = []

    async def runner(handle):
        with SQLiteRunJournal(journal.path) as observer:
            assert (
                observer.get_run_attempt(owner["attempt_id"]).status
                == "running"
            )
            assert (
                observer.get_run("run").active_attempt_id
                == owner["attempt_id"]
            )
        calls.append(handle)
        handle.publish("started")
        entered.set()
        await finish.wait()

    handle = await coordinator.register_dormant(**owner, runner=runner)
    subscription = await coordinator.subscribe("run")
    assert await coordinator.activate_dormant(**owner) is handle
    await asyncio.wait_for(entered.wait(), timeout=2)
    assert await subscription.__anext__() == "started"
    assert handle.activated and handle.runner_started
    assert await coordinator.activate_dormant(**owner) is handle
    assert calls == [handle]
    finish.set()
    await handle.wait()
    assert await coordinator.get_handle("run") is None
    assert await coordinator.register_dormant(**owner, runner=runner) is handle
    with pytest.raises(RunRuntimeError, match="cannot activate"):
        await coordinator.activate_dormant(**owner)
    # Runner return is not a terminal fact or a writer settlement proof.
    assert journal.get_run("run").status == "running"
    assert (
        journal._connection.execute(
            "SELECT state FROM run_workspace_finalizations WHERE run_id='run'"
        ).fetchone()[0]
        == "pending"
    )
    assert (
        journal._connection.execute(
            "SELECT COUNT(*) FROM project_run_execution_leases"
        ).fetchone()[0]
        == 1
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("guard", ["cancel", "generation", "missing_binding"])
async def test_durable_activation_guard_never_enters_runner(
    world, tmp_path, guard
):
    journal, coordinator = world
    owner = pending(journal, tmp_path, bind=guard != "missing_binding")
    if guard == "generation":
        owner["generation"] = 2
    calls = []

    async def runner(handle):
        calls.append(handle)

    handle = await coordinator.register_dormant(**owner, runner=runner)
    if guard == "cancel":
        journal.request_cancel("run", request_id="cancel", reason="test")
    with pytest.raises(InvalidRunTransitionError):
        await coordinator.activate_dormant(**owner)
    await asyncio.sleep(0)
    assert calls == []
    assert not handle.activated
    assert journal.get_run_attempt(owner["attempt_id"]).status == "pending"


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["before_commit", "after_commit"])
async def test_cancel_while_activation_is_in_flight_cannot_start_late(
    world, tmp_path, monkeypatch, boundary
):
    journal, coordinator = world
    owner = pending(journal, tmp_path)
    reached, release = threading.Event(), threading.Event()
    original = journal.activate_run_attempt
    calls = []

    def pause(*args, **kwargs):
        if boundary == "before_commit":
            reached.set()
            assert release.wait(timeout=3)
        result = original(*args, **kwargs)
        if boundary == "after_commit":
            reached.set()
            assert release.wait(timeout=3)
        return result

    async def runner(handle):
        calls.append(handle)

    monkeypatch.setattr(journal, "activate_run_attempt", pause)
    handle = await coordinator.register_dormant(**owner, runner=runner)
    activation = asyncio.create_task(coordinator.activate_dormant(**owner))
    try:
        assert await asyncio.to_thread(reached.wait, 2)
        with SQLiteRunJournal(journal.path) as sibling:
            sibling.request_cancel("run", request_id="cancel", reason="test")
        await coordinator.cancel_dormant(**owner)
    finally:
        release.set()
    with pytest.raises((InvalidRunTransitionError, RunRuntimeError)):
        await activation
    assert calls == []
    assert not handle.runner_started
    assert not handle.activated
    assert journal.get_run("run").cancel_request_id == "cancel"


@pytest.mark.asyncio
async def test_repeated_cancel_and_close_wait_without_interrupting_runner_cleanup(
    world, tmp_path
):
    journal, coordinator = world
    owner = pending(journal, tmp_path)
    entered, cleanup, stopped = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )
    finished = []

    async def runner(handle):
        try:
            entered.set()
            await asyncio.Event().wait()
        finally:
            assert handle.cancel_event.is_set()
            cleanup.set()
            await stopped.wait()
            finished.append(True)

    handle = await coordinator.register_dormant(**owner, runner=runner)
    await coordinator.activate_dormant(**owner)
    await asyncio.wait_for(entered.wait(), timeout=2)
    first = asyncio.create_task(coordinator.cancel_dormant(**owner))
    await asyncio.wait_for(cleanup.wait(), timeout=2)
    second = asyncio.create_task(coordinator.cancel_dormant(**owner))
    closing = asyncio.create_task(coordinator.close())
    await asyncio.sleep(0)
    assert await coordinator.get_handle("run") is handle
    assert not first.done() and not second.done() and not closing.done()
    stopped.set()
    result = await asyncio.gather(first, second, closing)
    assert result[:2] == [handle, handle]
    assert handle.runner_started
    assert finished == [True]
    assert handle.execution_task.cancelled()
    assert await coordinator.get_handle("run") is None
    assert journal.get_run("run").status == "running"


@pytest.mark.asyncio
async def test_cancelling_cancel_waiter_does_not_cancel_cleanup_again(
    world, tmp_path
):
    journal, coordinator = world
    owner = pending(journal, tmp_path)
    entered, cleanup, stopped = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )
    finished = []

    async def runner(handle):
        try:
            entered.set()
            await asyncio.Event().wait()
        finally:
            cleanup.set()
            await stopped.wait()
            finished.append(True)

    handle = await coordinator.register_dormant(**owner, runner=runner)
    await coordinator.activate_dormant(**owner)
    await entered.wait()
    waiter = asyncio.create_task(coordinator.cancel_dormant(**owner))
    await cleanup.wait()
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert handle.consumer_alive
    stopped.set()
    await coordinator.cancel_dormant(**owner)
    assert finished == [True]


@pytest.mark.asyncio
async def test_close_before_activation_never_enters_runner(world, tmp_path):
    journal, coordinator = world
    owner = pending(journal, tmp_path)
    calls = []

    async def runner(handle):
        calls.append(handle)

    handle = await coordinator.register_dormant(**owner, runner=runner)
    await coordinator.close()
    assert calls == []
    assert handle.cancel_event.is_set()
    assert not handle.runner_started
    assert handle.completed_at is not None
    with pytest.raises(RunRuntimeError):
        await coordinator.activate_dormant(**owner)
    assert journal.get_run_attempt(owner["attempt_id"]).status == "pending"


@pytest.mark.asyncio
async def test_runner_failure_is_transport_error_without_legacy_terminal(
    world, tmp_path
):
    journal, coordinator = world
    owner = pending(journal, tmp_path)

    async def runner(handle):
        raise ValueError("runner cleanup failed")

    handle = await coordinator.register_dormant(**owner, runner=runner)
    subscription = await coordinator.subscribe("run")
    await coordinator.activate_dormant(**owner)
    await handle.wait()
    with pytest.raises(RunExecutionError, match="runner cleanup failed"):
        await subscription.__anext__()
    assert journal.get_run("run").status == "running"
