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

"""C4 authorization drain through real registration/Workforce/cancel/finalizer."""

import asyncio

import pytest

from app.workspace_runtime import runtime
from tests.app.workspace_runtime import test_registration as reg
from tests.app.workspace_runtime.test_service import eventually

deployment = reg.deployment


@pytest.mark.asyncio
@pytest.mark.parametrize("healthy", [True, False])
@pytest.mark.parametrize("stop", ["cancel", "close"])
async def test_scanner_and_two_worker_authorizations_drain_at_production_deadline(
    deployment, monkeypatch, healthy, stop
):
    d = deployment
    d.service.stop_timeout = 5.0
    d.project("a", mode="workforce")
    envelope = await d.register("a")
    await d.submit("a", "authorization-owner", envelope)
    await d.submit("a", "authorization-successor", envelope)
    entered, release = asyncio.Event(), asyncio.Event()

    async def http_boundary(request):
        if request.url.path.endswith("/projects/a/credentials:resolve"):
            entered.set()
            await release.wait()

    class Script(reg.ModelScript):
        async def respond(self, context, call, messages):
            result = await super().respond(context, call, messages)
            if context.run_id == "authorization-owner" and messages[0][
                "content"
            ].startswith("Coordinate only"):
                # The actual scanner owns the lock before the actual worker
                # preflights. No policy, scheduler or finalizer is substituted.
                d.before_response = http_boundary
                await asyncio.wait_for(entered.wait(), 3)
            return result

    script = Script(monkeypatch)
    await d.service.start()
    try:
        await asyncio.wait_for(entered.wait(), 8)
        execution = d.service._executions["authorization-owner"]
        scanner = d.service._authorization_checks["authorization-owner"]
        await eventually(
            lambda: len(
                [
                    task
                    for task in execution.runtime._authorization_tasks
                    if not task.done()
                ]
            )
            == 2
        )
        owned = tuple(execution.runtime._authorization_tasks)
        stopping = asyncio.create_task(
            d.client.delete("/executions/authorization-owner")
            if stop == "cancel"
            else d.service.close()
        )
        await eventually(
            lambda: d.journal.get_run("authorization-owner").cancel_request_id
            is not None
        )
        if healthy:
            release.set()
        # Repeated caller cancellation must not abandon or repeatedly cancel
        # the owner's cleanup. The second API/close call joins normal ownership.
        stopping.cancel()
        await asyncio.gather(stopping, return_exceptions=True)
        if stop == "cancel":
            response = await d.client.delete("/executions/authorization-owner")
            assert response.status_code == 200, response.text
        else:
            await d.service.close()
        await eventually(
            lambda: all(task.done() for task in owned), timeout=18
        )
        await eventually(lambda: "authorization-owner" not in d.service._tasks)
        with d.journal._lock:
            finalization = d.journal._connection.execute(
                "SELECT state,writer_settlement_json FROM run_workspace_finalizations "
                "WHERE run_id='authorization-owner'"
            ).fetchone()
        assert tuple(finalization)[0] == "settled"
        assert finalization[1] is not None
        assert d.journal.get_run("authorization-owner").status == "cancelled"
        assert d.journal.list_tool_calls("authorization-owner") == []
        assert not [
            role
            for run, role, _ in script.calls
            if run == "authorization-owner" and role in {"author", "editor"}
        ]
        assert not execution.runtime._processes
        assert all(task.done() for task in execution.runtime._tasks)
        if stop == "cancel":
            assert not scanner.cancelled()
            # Another Session can execute while this registration's HTTP is
            # still withheld; cancelling one Run never cancels a global lock.
            d.project("b", space="two")
            await d.submit(
                "b", "authorization-independent", await d.register("b")
            )
            await eventually(
                lambda: d.completed("authorization-independent"), timeout=15
            )
        release.set()
        d.before_response = None
        entry = d.registration.registered[envelope["configuration_revision"]]
        assert await entry.refresh() is True
        if stop == "close":
            await runtime.close_default_execution_service()
            d.initialize()
            await d.service.start()
        await eventually(
            lambda: d.completed("authorization-successor"), timeout=18
        )
        assert len(d.journal.list_run_attempts("authorization-successor")) == 1
        assert not d.journal._connection.execute(
            "SELECT 1 FROM run_events WHERE run_id='authorization-owner' "
            "AND event_type='workspace.finalization.needs_attention'"
        ).fetchone()
    finally:
        release.set()


@pytest.mark.asyncio
async def test_cancelled_inflight_authorization_still_rejects_revoked_credentials(
    deployment, monkeypatch
):
    d = deployment
    d.service.stop_timeout = 5.0
    d.project("a")
    envelope = await d.register("a")
    await d.submit("a", "authorization-owner", envelope)
    await d.submit("a", "authorization-successor", envelope)
    entered = asyncio.Event()
    release = asyncio.Event()

    async def http_boundary(request):
        execution = d.service._executions.get("authorization-owner")
        if (
            request.url.path.endswith("/projects/a/credentials:resolve")
            and execution is not None
            and asyncio.current_task()
            in execution.runtime._authorization_tasks
        ):
            entered.set()
            await release.wait()

    d.before_response = http_boundary
    script = reg.ModelScript(monkeypatch)
    await d.service.start()
    try:
        await asyncio.wait_for(entered.wait(), 8)
        execution = d.service._executions["authorization-owner"]
        await eventually(lambda: bool(execution.runtime._authorization_tasks))
        d.valid_refs.clear()
        response = await d.client.delete("/executions/authorization-owner")
        assert response.status_code == 200
        await eventually(
            lambda: d.service.admission.get_claim("a").state == "released"
        )
        release.set()
        d.before_response = None
        entry = d.registration.registered[envelope["configuration_revision"]]
        assert await entry.refresh() is False
        assert entry.authorize(entry.origin) is False
        await eventually(
            lambda: d.service.admission.get(
                "authorization-successor"
            ).wait_reason
            is not None
        )
        assert d.journal.get_run("authorization-successor") is None
        assert d.journal.get_run("authorization-owner").status == "cancelled"
        assert not script.calls
    finally:
        release.set()
