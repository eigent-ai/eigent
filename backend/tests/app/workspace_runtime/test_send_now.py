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

"""Send now binds one durable action to one owner before actual stoppage."""

from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import replace
from unittest.mock import patch

import pytest
import pytest_asyncio

from app.run_journal import SCHEMA_VERSION, SQLiteRunJournal
from app.run_policy import TimeoutOutcome, TimeoutScope
from app.run_runtime import RunCoordinator
from app.workspace_runtime.admission import AdmissionConflict, AdmissionStore
from app.workspace_runtime.finalizer import WorkspaceFinalizer
from app.workspace_runtime.service import ExecutionService
from tests.app.workspace_runtime.test_admission import envelope
from tests.app.workspace_runtime.test_service import Op, World, eventually


@pytest_asyncio.fixture
async def world(tmp_path):
    value = World(tmp_path)
    try:
        yield value
    finally:
        await value.service.close()
        await value.coordinator.close()
        value.journal.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["submit", "promote", "foreign"])
@pytest.mark.parametrize("git", [False, True])
async def test_send_now_stops_writer_before_one_successor_handoff(
    world, monkeypatch, mode, git
):
    seen, runtimes = [], {}
    checkpoint_entered, finish_checkpoint = (
        threading.Event(),
        threading.Event(),
    )
    original = WorkspaceFinalizer._checkpoint

    def checkpoint(finalizer, request, *args):
        if request.request_id == "active":
            checkpoint_entered.set()
            assert finish_checkpoint.wait(8)
        return original(finalizer, request, *args)

    monkeypatch.setattr(WorkspaceFinalizer, "_checkpoint", checkpoint)

    async def handler(runtime, request):
        seen.append(request.request_id)
        runtimes[request.request_id] = runtime
        if request.request_id == "active":
            await runtime.execute_worker(
                [
                    Op("write", "partial", b"kept"),
                    Op("sleep", seconds=5),
                    Op("write", "after-send-now", b"late"),
                ],
                mutation_id="partial-program",
            )
        return request.request_id

    policy = world.register("p", handler, git=git)
    await world.submit("p", "active")
    await world.service.start()
    await eventually(
        lambda: (
            "active" in runtimes
            and (
                runtimes["active"].binding.workspace.local_root / "partial"
            ).exists()
        )
    )
    await world.submit("p", "ordinary", followup=True)
    peer_journal = peer_coordinator = peer = None
    try:
        sender = world.service
        if mode == "foreign":
            peer_journal = SQLiteRunJournal(world.journal.path)
            peer_coordinator = RunCoordinator(peer_journal)
            # This API instance need not own/start the actual runtime loop.
            peer = ExecutionService(
                peer_journal, peer_coordinator, world.registry
            )
            sender = peer
        if mode != "submit":
            await world.submit("p", "priority", followup=True)

        async def select():
            if mode == "submit":
                return await sender.submit(
                    request_id="priority",
                    project_id="p",
                    kind="follow_up",
                    envelope=dict(policy.configuration),
                    origin=world.origin,
                    source_follow_up_request_id="priority",
                    follow_up_content="priority",
                    delivery_mode="send_now",
                )
            return await sender.set_delivery(
                "priority",
                origin=world.origin,
                delivery_mode="send_now",
                operation_id="select-priority",
            )

        await select()
        active = world.journal.get_run("active")
        assert active.cancel_request_id is not None
        await eventually(checkpoint_entered.is_set)
        runtime = runtimes["active"]
        assert runtime.sealed
        assert all(
            p.process.returncode is not None for p in runtime._processes
        )
        assert world.journal.get_run("priority") is None
        assert world.service.admission.get_claim("p").state == "handed_off"
        with world.journal._lock:
            c = world.journal._connection
            assert (
                c.execute(
                    "SELECT run_id FROM project_run_execution_leases WHERE project_id='p'"
                ).fetchone()[0]
                == "active"
            )
            assert (
                c.execute(
                    "SELECT state FROM run_workspace_finalizations WHERE run_id='active'"
                ).fetchone()[0]
                != "settled"
            )
            receipt = c.execute(
                "SELECT target_run_id,target_attempt_id,target_generation FROM execution_delivery_operations WHERE request_id='priority'"
            ).fetchone()
            assert tuple(receipt) == (
                "active",
                runtime.binding.attempt_id,
                runtime.binding.generation,
            )
        await select()
        finish_checkpoint.set()
        await eventually(lambda: world.completed("ordinary"))
        assert seen == ["active", "priority", "ordinary"]
        assert world.journal.get_run("active").status == "cancelled"
        await select()  # Late duplicate after selected request was admitted.
        assert seen == ["active", "priority", "ordinary"]
        manifest = await world.service.artifacts("active", origin=world.origin)
        partial = next(
            a for a in manifest["artifacts"] if a["relativePath"] == "partial"
        )
        assert (
            await world.service.read_artifact(
                "active", partial["artifact_id"], origin=world.origin
            )
            == b"kept"
        )
        assert not any(
            a["relativePath"] == "after-send-now"
            for a in manifest["artifacts"]
        )
        with world.journal._lock:
            assert (
                world.journal._connection.execute(
                    "SELECT COUNT(*) FROM run_events WHERE run_id='active' AND event_type='run.cancel_requested'"
                ).fetchone()[0]
                == 1
            )
            assert not world.journal._connection.execute(
                "SELECT 1 FROM workspace_integration_requests WHERE run_id='active'"
            ).fetchone()
    finally:
        finish_checkpoint.set()
        if peer is not None:
            await peer.close()
            await peer_coordinator.close()
            peer_journal.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("explicit", [False, True])
async def test_old_delivery_retry_cannot_stop_new_owner_after_demotion(
    world, explicit
):
    entered, release = asyncio.Event(), asyncio.Event()
    seen = []

    async def handler(runtime, request):
        seen.append(request.request_id)
        if request.request_id == "b":
            entered.set()
            await runtime.cancelled.wait()
        return request.request_id

    world.register("p", handler)
    await world.submit("p", "a", followup=True)
    await world.submit("p", "b", followup=True)
    operation = {"operation_id": "a-original"} if explicit else {}
    await world.service.set_delivery(
        "a", origin=world.origin, delivery_mode="send_now", **operation
    )
    await world.service.set_delivery(
        "b",
        origin=world.origin,
        delivery_mode="send_now",
        operation_id="b-new",
    )
    await world.service.start()
    await asyncio.wait_for(entered.wait(), 5)
    try:
        with SQLiteRunJournal(world.journal.path) as observer:
            coordinator = RunCoordinator(observer)
            peer = ExecutionService(observer, coordinator, world.registry)
            try:
                retried = await peer.set_delivery(
                    "a",
                    origin=world.origin,
                    delivery_mode="send_now",
                    **operation,
                )
                assert retried.delivery_mode == "wait"
                assert observer.get_run("b").cancel_request_id is None
                assert seen == ["b"]
                # A genuinely new user action has a fresh id and may stop b.
                await peer.set_delivery(
                    "a",
                    origin=world.origin,
                    delivery_mode="send_now",
                    operation_id="a-new",
                )
                assert observer.get_run("b").cancel_request_id is not None
                await eventually(lambda: world.completed("a"))
                assert world.journal.get_run("b").status == "cancelled"
                assert seen == ["b", "a"]
            finally:
                await peer.close()
                await coordinator.close()
    finally:
        release.set()


@pytest.mark.asyncio
async def test_preparing_claim_is_not_interrupted_by_promotion_or_old_retry(
    world,
):
    preparing, continue_prepare = threading.Event(), threading.Event()
    entered, continue_run = asyncio.Event(), asyncio.Event()

    async def handler(_runtime, request):
        if request.request_id == "a":
            entered.set()
            await continue_run.wait()
        return request.request_id

    policy = world.register("p", handler)

    def resolve(request, workspace):
        if request.request_id == "a":
            preparing.set()
            assert continue_prepare.wait(8)
        return policy.resolve_runtime(request, workspace)

    world.registry.revoke("p")
    world.registry.register("p", replace(policy, resolve_runtime=resolve))
    await world.submit("p", "a")
    await world.service.start()
    await eventually(preparing.is_set)
    await world.submit("p", "b", followup=True)
    claim = world.service.admission.get_claim("p")
    try:
        await world.service.set_delivery(
            "b",
            origin=world.origin,
            delivery_mode="send_now",
            operation_id="while-preparing",
        )
        assert world.service.admission.get_claim("p") == claim
        with world.journal._lock:
            assert (
                world.journal._connection.execute(
                    "SELECT target_run_id FROM execution_delivery_operations WHERE request_id='b'"
                ).fetchone()[0]
                is None
            )
        continue_prepare.set()
        await asyncio.wait_for(entered.wait(), 5)
        await world.service.set_delivery(
            "b",
            origin=world.origin,
            delivery_mode="send_now",
            operation_id="while-preparing",
        )
        assert world.journal.get_run("a").cancel_request_id is None
        continue_run.set()
        await eventually(lambda: world.completed("b"))
    finally:
        continue_prepare.set()
        continue_run.set()


@pytest.mark.asyncio
async def test_delivery_operation_identity_reuse_is_rejected_without_priority_change(
    world,
):
    async def handler(_runtime, _request):
        return "done"

    world.register("p", handler)
    await world.submit("p", "a", followup=True)
    await world.submit("p", "b", followup=True)
    await world.service.set_delivery(
        "a",
        origin=world.origin,
        delivery_mode="send_now",
        operation_id="one-action",
    )
    for request_id, mode in (("b", "send_now"), ("a", "wait")):
        with pytest.raises(AdmissionConflict):
            await world.service.set_delivery(
                request_id,
                origin=world.origin,
                delivery_mode=mode,
                operation_id="one-action",
            )
    assert world.service.admission.get("a").delivery_mode == "send_now"
    assert world.service.admission.get("b").delivery_mode == "wait"
    await world.service.cancel("a", origin=world.origin)
    assert (
        await world.service.set_delivery(
            "a",
            origin=world.origin,
            delivery_mode="send_now",
            operation_id="one-action",
        )
    ).status == "cancelled"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["submit", "promote"])
async def test_priority_cancel_and_receipt_roll_back_together(
    world, monkeypatch, mode
):
    entered, release = asyncio.Event(), asyncio.Event()

    async def handler(_runtime, _request):
        entered.set()
        await release.wait()
        return "done"

    policy = world.register("p", handler)
    await world.submit("p", "active")
    await world.service.start()
    await asyncio.wait_for(entered.wait(), 5)
    if mode == "promote":
        await world.submit("p", "priority", followup=True)
    original = world.journal._request_cancel_in_transaction

    def fail_after_intent(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("injected after durable cancel write")

    monkeypatch.setattr(
        world.journal, "_request_cancel_in_transaction", fail_after_intent
    )
    try:
        with pytest.raises(RuntimeError, match="injected"):
            if mode == "submit":
                await world.service.submit(
                    request_id="priority",
                    project_id="p",
                    kind="follow_up",
                    envelope=dict(policy.configuration),
                    origin=world.origin,
                    source_follow_up_request_id="priority",
                    follow_up_content="priority",
                    delivery_mode="send_now",
                )
            else:
                await world.service.set_delivery(
                    "priority",
                    origin=world.origin,
                    delivery_mode="send_now",
                    operation_id="rollback",
                )
        assert world.journal.get_run("active").cancel_request_id is None
        with world.journal._lock:
            c = world.journal._connection
            assert not c.execute(
                "SELECT 1 FROM execution_delivery_operations"
            ).fetchone()
            assert not c.execute(
                "SELECT 1 FROM run_events WHERE event_type='run.cancel_requested'"
            ).fetchone()
            message = c.execute(
                "SELECT delivery_mode FROM follow_up_requests WHERE request_id='priority'"
            ).fetchone()
            assert (
                (message is None)
                if mode == "submit"
                else tuple(message) == ("wait",)
            )
        if mode == "submit":
            assert world.service.admission.get("priority") is None
        else:
            assert (
                world.service.admission.get("priority").delivery_mode == "wait"
            )
    finally:
        release.set()
        monkeypatch.setattr(
            world.journal, "_request_cancel_in_transaction", original
        )


@pytest.mark.asyncio
async def test_promotion_preserves_existing_cancel_intent(world, monkeypatch):
    entered = asyncio.Event()

    async def handler(runtime, request):
        if request.request_id == "active":
            entered.set()
            await runtime.cancelled.wait()
        return request.request_id

    world.register("p", handler)
    await world.submit("p", "active")
    await world.service.start()
    await asyncio.wait_for(entered.wait(), 5)
    await world.submit("p", "priority", followup=True)
    scan = world.service._dispatch_cancellations
    monkeypatch.setattr(world.service, "_dispatch_cancellations", lambda: None)
    try:
        world.journal.request_cancel(
            "active", request_id="original-stop", reason="user"
        )
        await world.service.set_delivery(
            "priority",
            origin=world.origin,
            delivery_mode="send_now",
            operation_id="same-owner",
        )
        assert (
            world.journal.get_run("active").cancel_request_id
            == "original-stop"
        )
        with world.journal._lock:
            row = world.journal._connection.execute(
                "SELECT target_run_id,cancel_request_id FROM execution_delivery_operations WHERE request_id='priority'"
            ).fetchone()
            assert tuple(row) == ("active", "original-stop")
    finally:
        monkeypatch.setattr(world.service, "_dispatch_cancellations", scan)
        world.service._wake.set()
    await eventually(lambda: world.completed("priority"))


@pytest.mark.asyncio
async def test_duplicate_initial_submit_does_not_repromote_or_stop_new_owner(
    world,
):
    entered, release = asyncio.Event(), asyncio.Event()

    async def handler(_runtime, request):
        if request.request_id == "b":
            entered.set()
            await release.wait()
        return request.request_id

    policy = world.register("p", handler)

    async def initial():
        return await world.service.submit(
            request_id="a",
            project_id="p",
            kind="follow_up",
            envelope=dict(policy.configuration),
            origin=world.origin,
            source_follow_up_request_id="a",
            follow_up_content="a",
            delivery_mode="send_now",
        )

    await initial()
    await world.submit("p", "b", followup=True)
    await world.service.set_delivery(
        "b",
        origin=world.origin,
        delivery_mode="send_now",
        operation_id="select-b",
    )
    await world.service.start()
    await asyncio.wait_for(entered.wait(), 5)
    try:
        assert (await initial()).delivery_mode == "wait"
        assert world.journal.get_run("b").cancel_request_id is None
        with world.journal._lock:
            assert (
                world.journal._connection.execute(
                    "SELECT target_run_id FROM execution_delivery_operations WHERE request_id='a'"
                ).fetchone()[0]
                is None
            )
    finally:
        release.set()


def test_v38_upgrade_preserves_v37_rows_and_delivery_receipt_across_reopen(
    tmp_path,
):
    path = tmp_path / "v37.sqlite"
    with (
        patch("app.run_journal.store.MIGRATION_V38", ""),
        patch("app.run_journal.store.MIGRATION_V39", ""),
        patch("app.run_journal.store.MIGRATION_V40", ""),
    ):
        with SQLiteRunJournal(path) as old:
            assert old.schema_version == 37
            old.ensure_run(run_id="historical", project_id="p1")
            old.put_follow_up_request(
                request_id="legacy", project_id="p1", content="kept"
            )
            AdmissionStore(old).submit(
                request_id="queued",
                project_id="p1",
                kind="start",
                envelope=envelope(),
            )
            tables = ("runs", "follow_up_requests", "execution_requests")
            before = {
                table: [
                    tuple(row)
                    for row in old._connection.execute(
                        "SELECT * FROM " + table
                    )
                ]
                for table in tables
            }
    with SQLiteRunJournal(path) as current:
        assert current.schema_version == SCHEMA_VERSION
        assert before == {
            table: [
                tuple(row)
                for row in current._connection.execute(
                    "SELECT * FROM " + table
                )
            ]
            for table in tables
        }
        request = AdmissionStore(current).set_delivery_mode(
            "queued", "send_now", operation_id="survives-restart"
        )
        receipt = tuple(
            current._connection.execute(
                "SELECT * FROM execution_delivery_operations"
            ).fetchone()
        )
        assert not current._connection.execute(
            "PRAGMA foreign_key_check"
        ).fetchall()
    with SQLiteRunJournal(path) as reopened:
        assert (
            AdmissionStore(reopened).set_delivery_mode(
                "queued", "send_now", operation_id="survives-restart"
            )
            == request
        )
        assert (
            tuple(
                reopened._connection.execute(
                    "SELECT * FROM execution_delivery_operations"
                ).fetchone()
            )
            == receipt
        )
        assert (
            reopened._connection.execute(
                "SELECT COUNT(*) FROM run_journal_migrations WHERE version=38"
            ).fetchone()[0]
            == 1
        )


@pytest.mark.asyncio
async def test_interrupted_run_still_stops_its_exact_retained_writer(world):
    runtimes = {}

    async def handler(runtime, request):
        runtimes[request.request_id] = runtime
        if request.request_id == "active":
            await runtime.execute_worker(
                [
                    Op("write", "partial", b"kept"),
                    Op("sleep", seconds=5),
                    Op("write", "late", b"unexpected"),
                ],
                mutation_id="writer",
            )
        return request.request_id

    world.register("p", handler)
    await world.submit("p", "active")
    await world.service.start()
    await eventually(
        lambda: (
            "active" in runtimes
            and (
                runtimes["active"].binding.workspace.local_root / "partial"
            ).exists()
        )
    )
    runtime = runtimes["active"]
    now = time.time()
    world.journal.record_timeout_outcome(
        TimeoutOutcome(
            scope=TimeoutScope.RUNTIME_LIVENESS,
            policy_version="v1",
            reason="runtime_liveness_lost",
            started_at=now - 1,
            ended_at=now,
            run_id="active",
            attempt_id=runtime.binding.attempt_id,
        )
    )
    assert world.journal.get_run("active").status == "interrupted"
    assert world.journal.get_run("active").active_attempt_id is None
    await world.submit("p", "priority", followup=True)
    await world.service.set_delivery(
        "priority",
        origin=world.origin,
        delivery_mode="send_now",
        operation_id="stop-retained-owner",
    )
    assert world.journal.get_run("active").cancel_request_id is not None
    await eventually(lambda: world.completed("priority"))
    assert world.journal.get_run("active").status == "cancelled"
    assert runtime.sealed
    assert all(p.process.returncode is not None for p in runtime._processes)
    assert not (runtime.binding.workspace.local_root / "late").exists()


@pytest.mark.asyncio
async def test_send_now_before_activation_finalizes_without_starting_old_handler(
    world, monkeypatch
):
    registered, release = asyncio.Event(), asyncio.Event()
    seen = []
    original = world.coordinator.register_dormant

    async def blocked(**kwargs):
        handle = await original(**kwargs)
        if kwargs["run_id"] == "active":
            registered.set()
            await release.wait()
        return handle

    monkeypatch.setattr(world.coordinator, "register_dormant", blocked)

    async def handler(_runtime, request):
        seen.append(request.request_id)
        return request.request_id

    world.register("p", handler)
    await world.submit("p", "active")
    await world.service.start()
    await asyncio.wait_for(registered.wait(), 5)
    try:
        await world.submit("p", "priority", followup=True)
        await world.service.set_delivery(
            "priority",
            origin=world.origin,
            delivery_mode="send_now",
            operation_id="stop-dormant-owner",
        )
        assert world.journal.get_run("active").cancel_request_id is not None
        release.set()
        await eventually(lambda: world.completed("priority"))
        assert world.journal.get_run("active").status == "cancelled"
        assert seen == ["priority"]
    finally:
        release.set()
