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

"""Legacy queue writes and canonical admission share SQLite writer ordering."""

from __future__ import annotations

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from app.controller import chat_controller as controller
from app.model.chat import FollowUpRequestAdmitted, FollowUpRequestCreate
from app.run_journal import RunJournalError, SQLiteRunJournal
from app.workspace_runtime.admission import AdmissionConflict
from tests.app.workspace_runtime.test_service import World, eventually


async def _submit_message(world):
    return await world.service.submit(
        request_id="message",
        project_id="project",
        kind="follow_up",
        envelope=dict(world.policies["project"].configuration),
        origin=world.origin,
        source_follow_up_request_id="message",
    )


def _legacy_call(action):
    if action == "cancel":
        return controller.cancel_follow_up("project", "message")
    if action == "delivery":
        return controller.send_follow_up_now("project", "message")
    if action == "put":
        return controller.enqueue_follow_up(
            "project",
            FollowUpRequestCreate(
                request_id="legacy-extra",
                content="new legacy message",
                delivery_mode="send_now",
            ),
        )
    return controller.mark_follow_up_admitted(
        "project", "message", FollowUpRequestAdmitted(run_id="message")
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["cancel", "delivery", "put", "admitted"])
async def test_managed_submit_after_legacy_preflight_rejects_whole_mutation(
    tmp_path, monkeypatch, action
):
    world = World(tmp_path)
    legacy = SQLiteRunJournal(tmp_path / "journal.sqlite")
    executed = []

    async def handler(runtime, request):
        executed.append(request.request_id)
        return "done"

    world.register("project", handler)
    world.journal.put_follow_up_request(
        request_id="message", project_id="project", content="message"
    )
    monkeypatch.setattr(controller, "get_default_run_journal", lambda: legacy)
    original_guard = controller.guard_legacy_execution_entry
    checked, proceed = asyncio.Event(), asyncio.Event()

    async def paused_guard(*args, **kwargs):
        await original_guard(*args, **kwargs)
        checked.set()
        await proceed.wait()

    monkeypatch.setattr(
        controller, "guard_legacy_execution_entry", paused_guard
    )
    pending = asyncio.create_task(_legacy_call(action))
    try:
        await asyncio.wait_for(checked.wait(), timeout=3)
        accepted = await _submit_message(world)
        before = world.journal.list_follow_up_requests(project_id="project")
        proceed.set()
        with pytest.raises(HTTPException) as caught:
            await pending
        assert caught.value.status_code == 409
        assert caught.value.detail["code"] == "managed_execution_required"
        assert (
            world.journal.list_follow_up_requests(project_id="project")
            == before
        )
        assert world.service.admission.get("message") == accepted
        assert accepted.status == "pending"
        assert before[0].status == "pending"
        assert before[0].delivery_mode == accepted.delivery_mode == "wait"

        # A rejection must not leave a poisoned FIFO head or a repeated prepare
        # loop. The actual dispatcher runs both durable requests exactly once.
        await world.submit("project", "successor")
        await world.service.start()
        await eventually(lambda: world.completed("successor"))
        assert executed == ["message", "successor"]
        assert len(world.journal.list_run_attempts("message")) == 1
        assert len(world.journal.list_run_attempts("successor")) == 1
    finally:
        proceed.set()
        if not pending.done():
            pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
        await world.service.close()
        await world.coordinator.close()
        legacy.close()
        world.journal.close()


@pytest.mark.asyncio
async def test_legacy_cancel_committed_first_prevents_canonical_admission(
    tmp_path, monkeypatch
):
    world = World(tmp_path)
    legacy = SQLiteRunJournal(tmp_path / "journal.sqlite")

    async def handler(runtime, request):
        return "done"

    world.register("project", handler)
    world.journal.put_follow_up_request(
        request_id="message", project_id="project", content="message"
    )
    monkeypatch.setattr(controller, "get_default_run_journal", lambda: legacy)
    try:
        response = await controller.cancel_follow_up("project", "message")
        assert response["status"] == "cancelled"
        with pytest.raises(AdmissionConflict):
            await _submit_message(world)
        assert world.service.admission.get("message") is None
        assert world.journal.get_run("message") is None
        await world.submit("project", "successor")
        await world.service.start()
        await eventually(lambda: world.completed("successor"))
    finally:
        await world.service.close()
        await world.coordinator.close()
        legacy.close()
        world.journal.close()


def test_legacy_cancel_holds_writer_lock_after_final_guard(
    tmp_path, monkeypatch
):
    world = World(tmp_path)
    legacy = SQLiteRunJournal(tmp_path / "journal.sqlite")

    async def handler(runtime, request):
        return "done"

    world.register("project", handler)
    world.journal.put_follow_up_request(
        request_id="message", project_id="project", content="message"
    )
    guarded = threading.Event()
    proceed = threading.Event()
    admission_begin = threading.Event()
    real_guard = legacy._require_legacy_follow_up_in_transaction

    def paused_writer_guard(connection, *, project_id):
        real_guard(connection, project_id=project_id)
        assert connection is legacy._connection
        assert connection.in_transaction
        guarded.set()
        assert proceed.wait(timeout=5)

    def trace(statement):
        if statement == "BEGIN IMMEDIATE":
            admission_begin.set()

    monkeypatch.setattr(
        legacy, "_require_legacy_follow_up_in_transaction", paused_writer_guard
    )
    world.journal._connection.set_trace_callback(trace)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            cancelled = executor.submit(
                legacy.cancel_follow_up_request,
                request_id="message",
                project_id="project",
                reject_managed=True,
            )
            try:
                assert guarded.wait(timeout=3)
                admission = executor.submit(
                    lambda: asyncio.run(_submit_message(world))
                )
                assert admission_begin.wait(timeout=3)
                # BEGIN IMMEDIATE on the other connection has been attempted,
                # but cannot pass the legacy writer's check-to-mutation span.
                assert not admission.done()
            finally:
                proceed.set()
            assert cancelled.result(timeout=3).status == "cancelled"
            with pytest.raises(AdmissionConflict):
                admission.result(timeout=3)
        assert world.service.admission.get("message") is None
    finally:
        proceed.set()
        world.journal._connection.set_trace_callback(None)
        legacy.close()
        world.journal.close()


@pytest.mark.asyncio
async def test_continuation_rejection_rechecks_canonical_owner(tmp_path):
    world = World(tmp_path)

    async def handler(runtime, request):
        return "done"

    world.register("project", handler)
    world.journal.put_follow_up_request(
        request_id="message", project_id="project", content="message"
    )
    try:
        await _submit_message(world)
        before = world.journal.list_follow_up_requests(project_id="project")
        with pytest.raises(HTTPException) as caught:
            await controller._reject_pending_continuation(
                world.journal,
                project_id="project",
                request_id="message",
                code_value="clarification_required",
                message="synthetic",
            )
        assert caught.value.status_code == 409
        assert caught.value.detail["code"] == "managed_execution_required"
        assert (
            world.journal.list_follow_up_requests(project_id="project")
            == before
        )
        assert world.service.admission.get("message").status == "pending"
    finally:
        await world.service.close()
        await world.coordinator.close()
        world.journal.close()


def test_final_legacy_guard_requires_the_owning_write_transaction(tmp_path):
    with (
        SQLiteRunJournal(tmp_path / "journal.sqlite") as journal,
        SQLiteRunJournal(tmp_path / "journal.sqlite") as other,
    ):
        with pytest.raises(RunJournalError):
            journal._require_legacy_follow_up_in_transaction(
                journal._connection, project_id="project"
            )
        with other._write_transaction() as connection:
            with pytest.raises(RunJournalError):
                journal._require_legacy_follow_up_in_transaction(
                    connection, project_id="project"
                )
