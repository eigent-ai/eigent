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

"""Blocking authority checks remain fresh, independent and owned until drained."""

import asyncio
import threading
from dataclasses import replace
from pathlib import Path

import pytest

from app.permission_policy import PermissionProfileName
from app.workspace_runtime.authorization_check import run_authorization_check
from app.workspace_runtime.integration import WorkspaceIntegrationCoordinator
from tests.app.workspace_runtime import (
    test_registration as reg,
    test_service as svc,
)

deployment = reg.deployment
world = svc.world


@pytest.mark.asyncio
@pytest.mark.parametrize("worker_error", [False, True])
async def test_repeated_cancellation_retains_the_concrete_check(worker_error):
    loop = asyncio.get_running_loop()
    entered, release, finished = (
        asyncio.Event(),
        threading.Event(),
        threading.Event(),
    )

    def check():
        loop.call_soon_threadsafe(entered.set)
        try:
            assert release.wait(5), "test did not release authority check"
            if worker_error:
                raise ValueError("synthetic check failure")
            return True
        finally:
            finished.set()

    task = asyncio.create_task(run_authorization_check(check))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        for _ in range(2):
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
            assert not finished.is_set()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert finished.is_set()


@pytest.mark.asyncio
async def test_worker_result_and_failure_are_not_reinterpreted():
    assert await run_authorization_check(lambda: False) is False

    def fail():
        raise ValueError("synthetic rejection")

    with pytest.raises(ValueError, match="synthetic rejection"):
        await run_authorization_check(fail)


@pytest.mark.asyncio
async def test_generic_policy_keeps_its_event_loop_callback_contract(world):
    loop = asyncio.get_running_loop()
    observed = []

    def authorize(_origin):
        observed.append(asyncio.get_running_loop())
        return True

    policy = replace(
        world.register("a", lambda *_args: None), authorize=authorize
    )
    world.registry.revoke("a")
    world.registry.register("a", policy)
    assert not policy.threaded_authorization
    assert await world.registry.require_async("a", world.origin) is policy
    assert observed == [loop]


@pytest.mark.asyncio
async def test_registry_revocation_before_worker_continuation_is_rejected(
    world,
):
    loop = asyncio.get_running_loop()

    def authorize(_origin):
        # The worker has already selected the policy; its caller must not
        # accept that selection after the loop processes a revocation.
        loop.call_soon_threadsafe(world.registry.revoke, "a")
        return True

    policy = replace(
        world.register("a", lambda *_args: None),
        authorize=authorize,
        threaded_authorization=True,
        authorization_state=lambda: "synthetic-stable-authority",
    )
    world.registry.revoke("a")
    world.registry.register("a", policy)
    with pytest.raises(svc.ExecutionForbidden):
        await world.registry.require_async("a", world.origin)


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["permission", "root", "repository"])
async def test_refresh_checks_the_live_binding_after_worker_suspension(
    deployment, monkeypatch, change
):
    d = deployment
    d.project("a", git=True)
    envelope = await d.register("a")
    entry = d.registration.registered[envelope["configuration_revision"]]
    loop = asyncio.get_running_loop()
    entered, release = asyncio.Event(), threading.Event()
    original = entry.local_binding_valid

    def check():
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(5), "test did not release binding check"
        return original()

    monkeypatch.setattr(entry, "local_binding_valid", check)
    task = asyncio.create_task(entry.refresh())
    try:
        await asyncio.wait_for(entered.wait(), 2)
        assert not task.done()
        root = Path(d.projects["a"]["space_root"])
        if change == "permission":
            d.permission("one", PermissionProfileName.READ_ONLY)
        elif change == "root":
            root.rename(root.with_name("old-root"))
            root.mkdir()
        else:
            (root / ".git").rename(root / ".old-git")
            (root / ".git").mkdir()
    finally:
        release.set()
    assert await task is False
    assert entry._proof is None
    assert entry.authorize(entry.origin) is False


@pytest.mark.asyncio
async def test_cancelled_refresh_drains_reader_before_invalidating_proof(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    envelope = await d.register("a")
    entry = d.registration.registered[envelope["configuration_revision"]]
    loop = asyncio.get_running_loop()
    entered, release, finished = (
        asyncio.Event(),
        threading.Event(),
        threading.Event(),
    )
    original = entry.local_binding_valid

    def check():
        loop.call_soon_threadsafe(entered.set)
        try:
            assert release.wait(5), "test did not release binding reader"
            return original()
        finally:
            finished.set()

    monkeypatch.setattr(entry, "local_binding_valid", check)
    task = asyncio.create_task(entry.refresh())
    try:
        await asyncio.wait_for(entered.wait(), 2)
        for _ in range(2):
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
        assert not finished.is_set()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert finished.is_set()
    assert entry._proof is None
    assert not entry._refresh_lock.locked()


@pytest.mark.asyncio
@pytest.mark.parametrize("cross_space", [False, True])
async def test_slow_local_check_does_not_hold_other_sessions_and_close_drains_it(
    deployment, monkeypatch, cross_space
):
    d = deployment
    model_entered = asyncio.Event()
    model_release = asyncio.Event()

    async def worker(context, _role, _call, _messages):
        if context.project_id == "a":
            model_entered.set()
            await model_release.wait()
        return reg.response(content="done")

    reg.ModelScript(monkeypatch, worker_reply=worker)
    d.project("a")
    await d.submit("a", "held-check", await d.register("a"))
    await d.service.start()
    await asyncio.wait_for(model_entered.wait(), 8)
    loop = asyncio.get_running_loop()
    entered, release, finished = (
        asyncio.Event(),
        threading.Event(),
        threading.Event(),
    )
    original = d.service._policy

    def check(request):
        if request.request_id == "held-check":
            loop.call_soon_threadsafe(entered.set)
            try:
                assert release.wait(15), "test did not release local check"
                return original(request)
            finally:
                finished.set()
        return original(request)

    monkeypatch.setattr(d.service, "_policy", check)
    try:
        await asyncio.wait_for(entered.wait(), 2)
        d.project("b", space="two" if cross_space else "one")
        await d.submit("b", "independent", await d.register("b"))
        await svc.eventually(lambda: d.completed("independent"))
        assert not finished.is_set()
        closing = asyncio.create_task(d.service.close())
        await svc.eventually(
            lambda: d.journal.get_run("held-check").status == "cancelled"
        )
        assert not d.service._close_task.done()
        for _ in range(2):
            closing.cancel()
            await asyncio.sleep(0)
        await asyncio.gather(closing, return_exceptions=True)
        assert not d.service._close_task.done()
        assert not finished.is_set()
    finally:
        release.set()
        model_release.set()
        await d.service.close()
    assert finished.is_set()
    assert not d.service._local_authorization_checks
    assert not d.service._authorization_checks


@pytest.mark.asyncio
async def test_publication_timeout_and_close_wait_for_its_authorization_reader(
    deployment, monkeypatch
):
    d = deployment
    d.project("a")
    envelope = await d.register("a")
    await d.submit("a", "publication-reader", envelope)
    entry = d.registration.registered[envelope["configuration_revision"]]
    loop = asyncio.get_running_loop()
    entered, process_finished = asyncio.Event(), asyncio.Event()
    enable, release, finished = (threading.Event() for _ in range(3))
    original = entry.local_binding_valid

    def check():
        if enable.is_set():
            loop.call_soon_threadsafe(entered.set)
            try:
                assert release.wait(12), "test did not release reader"
                return original()
            finally:
                finished.set()
        return original()

    def process(coordinator, _request_id):
        # Delay a fresh check across the real six-second publication fence.
        # No target write or SQLite operation is replaced by this boundary.
        enable.set()
        assert coordinator.authorize({}) is False
        loop.call_soon_threadsafe(process_finished.set)

    monkeypatch.setattr(entry, "local_binding_valid", check)
    monkeypatch.setattr(WorkspaceIntegrationCoordinator, "process", process)
    publication = asyncio.create_task(
        d.service._publish("synthetic", "publication-reader")
    )
    d.service._publications["synthetic"] = publication
    try:
        await asyncio.wait_for(entered.wait(), 2)
        await asyncio.wait_for(process_finished.wait(), 8)
        assert not finished.is_set()
        assert not publication.done()
        closing = asyncio.create_task(d.service.close())
        await svc.eventually(lambda: d.service._close_task is not None)
        closing.cancel()
        await asyncio.gather(closing, return_exceptions=True)
        assert not d.service._close_task.done()
    finally:
        release.set()
        await d.service.close()
    assert publication.done()
    assert finished.is_set()
    assert entry._proof is None
