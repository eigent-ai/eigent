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

"""Ownership and drain boundaries of the actual Agent compatibility hooks."""

import asyncio
import threading

import pytest

from app.run_journal import SQLiteRunJournal
from app.run_journal.runtime import get_default_run_journal, run_journal_scope
from app.run_runtime.owned_tasks import (
    get_task_lock,
    get_task_lock_if_exists,
    owned_tasks_scope,
    run_owned_thread,
    task_lock_scope,
)
from app.service.task import (
    TaskLock,
    task_locks,
)
from app.utils.event_loop_utils import _schedule_async_task
from tests.app.workspace_runtime.test_service import eventually


@pytest.mark.asyncio
async def test_scopes_follow_threads_without_rebinding_globals(tmp_path):
    stores = [
        SQLiteRunJournal(tmp_path / (name + ".sqlite")) for name in ("a", "b")
    ]
    entered = set()
    ready = asyncio.Event()
    original = dict(task_locks)

    async def one(index):
        lock = TaskLock("same-project", asyncio.Queue(), {})
        with run_journal_scope(stores[index]), task_lock_scope(lock):
            entered.add(index)
            if len(entered) == 2:
                ready.set()
            await ready.wait()
            assert get_default_run_journal() is stores[index]
            assert get_task_lock("same-project") is lock
            assert (
                await asyncio.to_thread(get_default_run_journal)
                is stores[index]
            )
            assert (
                await asyncio.to_thread(get_task_lock, "same-project") is lock
            )
            assert get_task_lock_if_exists("other") is None
            with pytest.raises(Exception, match="does not belong"):
                get_task_lock("other")

    try:
        await asyncio.gather(one(0), one(1))
        assert task_locks == original
    finally:
        for store in stores:
            store.close()


@pytest.mark.asyncio
async def test_cancelled_waiter_keeps_thread_and_foreign_projection_owned():
    started = threading.Event()
    release = threading.Event()
    projection_entered = asyncio.Event()
    projection_release = asyncio.Event()
    left = asyncio.Event()

    async def projection():
        projection_entered.set()
        await projection_release.wait()

    def checkpoint():
        started.set()
        assert release.wait(5)
        _schedule_async_task(projection())

    async def execute():
        async with owned_tasks_scope():
            waiter = asyncio.create_task(run_owned_thread(checkpoint))
            await eventually(started.is_set)
            waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)
        left.set()

    execution = asyncio.create_task(execute())
    try:
        await eventually(started.is_set)
        assert not left.is_set()
        release.set()
        await asyncio.wait_for(projection_entered.wait(), 5)
        assert not left.is_set()
        projection_release.set()
        await asyncio.wait_for(execution, 5)
        assert left.is_set()
    finally:
        release.set()
        projection_release.set()
        await execution


@pytest.mark.asyncio
async def test_repeated_scope_cancellation_cannot_orphan_thread():
    started, release = threading.Event(), threading.Event()

    def blocking():
        started.set()
        assert release.wait(5)

    async def run():
        async with owned_tasks_scope():
            await run_owned_thread(blocking)

    task = asyncio.create_task(run())
    try:
        await eventually(started.is_set)
        for _ in range(3):
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_failed_sdk_constructor_closes_partial_clients(monkeypatch):
    from types import SimpleNamespace

    import httpx
    import openai

    from app.workspace_runtime.agent_model_resources import AgentModelResources

    clients = []
    original_sync, original_async = httpx.Client, httpx.AsyncClient

    class ObservedSyncClient(original_sync):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            clients.append(self)

    class ObservedAsyncClient(original_async):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            clients.append(self)

    def failed_sdk(**kwargs):
        raise RuntimeError("synthetic constructor failure")

    monkeypatch.setattr(httpx, "Client", ObservedSyncClient)
    monkeypatch.setattr(httpx, "AsyncClient", ObservedAsyncClient)
    monkeypatch.setattr(openai, "AsyncOpenAI", failed_sdk)
    options = SimpleNamespace(
        model_type="gpt-5",
        api_key="synthetic",
        api_url="https://example.invalid/v1",
        extra_params={"timeout": 30, "max_retries": 0},
    )
    async with owned_tasks_scope():
        with pytest.raises(
            RuntimeError, match="synthetic constructor failure"
        ):
            AgentModelResources(
                options=options,
                tokenizer=SimpleNamespace(for_model=lambda _: None),
                provider_capability=None,
                authorize=lambda: None,
            )
    assert len(clients) == 2 and all(client.is_closed for client in clients)


def test_active_telemetry_is_explicitly_unsupported(monkeypatch):
    import camel.agents.chat_agent as chat_module

    from app.workspace_runtime.agent_configuration import (
        AgentConfigurationUnavailable,
    )
    from app.workspace_runtime.agent_model_resources import (
        require_supported_instrumentation,
    )

    monkeypatch.setattr(chat_module, "observe", lambda function: function)
    with pytest.raises(
        AgentConfigurationUnavailable, match="agent_telemetry_unsupported"
    ):
        require_supported_instrumentation()
