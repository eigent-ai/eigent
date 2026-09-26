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

import asyncio
from types import SimpleNamespace

import pytest

from app.agent.factory.browser import CdpBrowserPoolManager
from app.agent.toolkit.hybrid_browser_toolkit import (
    HybridBrowserToolkit,
    WebSocketConnectionPool,
)
from app.run_journal import SQLiteRunJournal
from app.run_journal.runtime import run_journal_scope
from app.workspace_runtime.bound_runtime import RuntimeBinding
from app.workspace_runtime.native_runtime import NativeAgentRuntime
from app.workspace_runtime.provider import WorkspaceHandle


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_browser_resource_wait_keeps_tool_and_releases_exact_lease(
    tmp_path, cancel
):
    pool = CdpBrowserPoolManager()
    descriptors = [
        {
            "endpoint": "http://127.0.0.1:9222",
            "targetUrl": "about:blank#eigent-browser-toolkit=fixture",
        }
    ]
    assert pool.acquire_browser(descriptors, "first") is not None
    waiting = asyncio.Event()
    toolkit = None
    events = []

    async def noop():
        pass

    async def close():
        await toolkit.close()

    runtime = NativeAgentRuntime(
        RuntimeBinding(
            "second-run",
            "attempt",
            1,
            WorkspaceHandle("workspace", tmp_path, "attempt", 1, "snapshot"),
            "environment",
            {},
        ),
        stop_resources=noop,
        close_resources=close,
    )

    async def handler(runtime):
        nonlocal toolkit
        toolkit = HybridBrowserToolkit(
            "second",
            session_id="second",
            user_data_dir=str(tmp_path),
            cdp_url="http://127.0.0.1:9222",
            download_dir=str(tmp_path),
        )

        def acquire():
            selected = pool.acquire_browser(descriptors, "second", quiet=True)
            return (
                {
                    "cdpUrl": selected["endpoint"],
                    "ownedTargetUrl": selected["targetUrl"],
                    "port": 9222,
                }
                if selected
                else None
            )

        async def record(event):
            events.append(event)
            if event.endswith("waiting"):
                waiting.set()

        toolkit._record_resource_wait = record
        toolkit.configure_resource_lease(
            acquire,
            lambda lease: pool.release_browser(lease["port"], "second"),
        )
        await runtime.run_tool(toolkit._ensure_resource_lease)
        return "acquired"

    pending = asyncio.create_task(runtime.run(handler))
    await asyncio.wait_for(waiting.wait(), timeout=2)
    assert not pending.done()
    assert "browser_visit_page" in {
        tool.func.__name__ for tool in toolkit.get_tools()
    }
    assert pool._session_to_browser_key.keys() == {"first"}
    if cancel:
        await asyncio.wait_for(runtime.stop(), timeout=2)
        await asyncio.gather(pending, return_exceptions=True)
        assert pool._session_to_browser_key.keys() == {"first"}
        assert events == ["browser.resource.waiting"]
        pool.release_browser(9222, "first")
    else:
        pool.release_browser(9222, "first")
        assert await asyncio.wait_for(pending, timeout=2) == "acquired"
        assert pool._session_to_browser_key.keys() == {"second"}
        assert events == [
            "browser.resource.waiting",
            "browser.resource.acquired",
        ]
        await runtime.stop()
    assert not pool._occupied_browsers


@pytest.mark.asyncio
async def test_unhealthy_native_browser_cannot_silently_replace_owner():
    pool = WebSocketConnectionPool()
    wrapper = SimpleNamespace(websocket=None, _native_owner=object())
    pool._connections["owned"] = wrapper
    with pytest.raises(RuntimeError, match="requires settlement"):
        await pool.get_connection("owned", {})
    assert pool._connections["owned"] is wrapper


@pytest.mark.asyncio
async def test_browser_wait_notice_is_durable_and_idempotent(tmp_path):
    async def noop():
        pass

    runtime = NativeAgentRuntime(
        RuntimeBinding(
            "run",
            "attempt",
            1,
            WorkspaceHandle("workspace", tmp_path, "attempt", 1, "snapshot"),
            "environment",
            {},
        ),
        stop_resources=noop,
    )

    async def handler(runtime):
        toolkit = HybridBrowserToolkit(
            "session", user_data_dir=str(tmp_path), session_id="browser"
        )
        for kind in ("waiting", "waiting", "acquired"):
            await toolkit._record_resource_wait("browser.resource." + kind)

    with (
        SQLiteRunJournal(tmp_path / "journal.sqlite") as journal,
        run_journal_scope(journal),
    ):
        journal.ensure_run(
            run_id="run", project_id="session", status="pending"
        )
        await runtime.run(handler)
        await runtime.stop()
        assert [event.event_type for event in journal.list_events("run")] == [
            "browser.resource.waiting",
            "browser.resource.acquired",
        ]
