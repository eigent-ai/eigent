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
from typing import Any

import pytest

import app.agent.factory.toolkit_assembler as assembler
from app.agent.factory import browser as browser_factory
from app.agent.factory.toolkit_assembler import assemble_single_agent_toolkits
from app.model.chat import Chat
from app.service.task import TaskLock, task_locks

pytestmark = pytest.mark.unit

_BROWSER = {"port": 9555}


class DummyTaskLock:
    def add_human_input_listen(self, agent_name: str) -> None:
        pass

    async def put_queue(self, data: Any) -> None:
        pass

    async def get_human_input(self, agent_name: str) -> str:
        return ""


@pytest.fixture(autouse=True)
def cdp_pool(monkeypatch):
    pool = browser_factory.CdpBrowserPoolManager()
    monkeypatch.setattr(browser_factory, "_cdp_pool_manager", pool)
    return pool


def _options(sample_chat_data, *enabled: str) -> Chat:
    return Chat(
        **{
            **sample_chat_data,
            "cdp_browsers": [dict(_BROWSER)],
            "installed_mcp": {
                "mcpServers": {"local": {"command": "python", "args": ["-V"]}}
            },
            "toolkit_config": {
                name: {"enabled": name in enabled}
                for name in assembler.DEFAULT_SINGLE_AGENT_TOOLKIT_CONFIG
            },
        }
    )


def _install_toolkits(monkeypatch, tmp_path, project_id, events, cdp_pool):
    import app.agent.toolkit.human_toolkit as human_toolkit

    monkeypatch.setattr(
        human_toolkit, "get_task_lock", lambda api_task_id: DummyTaskLock()
    )
    monkeypatch.setitem(
        task_locks, project_id, TaskLock(project_id, asyncio.Queue(), {})
    )
    monkeypatch.setenv("file_save_path", str(tmp_path))
    monkeypatch.delenv("EIGENT_RUNTIME", raising=False)

    class FakeTerminalToolkit:
        def __init__(self, *args, **kwargs):
            pass

        @classmethod
        def toolkit_name(cls):
            return "TerminalToolkit"

        def get_tools(self):
            return []

        def cleanup(self):
            events.append("terminal.cleanup")

    class FakeMCPToolkit:
        def __init__(self, **kwargs):
            pass

        async def connect(self):
            events.append(
                "mcp.started:browser-reserved"
                if cdp_pool._occupied_browsers
                else "mcp.started"
            )

        async def disconnect(self):
            events.append("mcp.disconnect")

        def get_tools(self):
            return []

    monkeypatch.setattr(assembler, "TerminalToolkit", FakeTerminalToolkit)
    monkeypatch.setattr(assembler, "MCPToolkit", FakeMCPToolkit)
    return FakeMCPToolkit


def _browser_is_free(cdp_pool) -> bool:
    selected = cdp_pool.acquire_browser([dict(_BROWSER)], "next-session")
    return selected is not None


@pytest.mark.asyncio
async def test_late_assembly_failure_releases_started_toolkits(
    sample_chat_data, monkeypatch, tmp_path, cdp_pool
):
    options = _options(sample_chat_data, "browser", "terminal", "mcp", "agent")
    events: list[str] = []
    _install_toolkits(
        monkeypatch, tmp_path, options.project_id, events, cdp_pool
    )

    class FailingAgentToolkit:
        def __init__(self, **_kwargs):
            raise RuntimeError("delegation toolkit failed")

    monkeypatch.setattr(
        assembler, "DepthLimitedAgentToolkit", FailingAgentToolkit
    )

    with pytest.raises(RuntimeError, match="delegation toolkit failed"):
        await assemble_single_agent_toolkits(
            options,
            task_id=options.task_id,
            working_directory=str(tmp_path),
            hands=None,
            can_delegate=True,
        )

    assert events == [
        "mcp.started:browser-reserved",
        "mcp.disconnect",
        "terminal.cleanup",
    ]
    assert _browser_is_free(cdp_pool)


@pytest.mark.asyncio
async def test_browser_toolkit_failure_releases_the_browser_slot(
    sample_chat_data, monkeypatch, tmp_path, cdp_pool
):
    options = _options(sample_chat_data, "browser")
    _install_toolkits(monkeypatch, tmp_path, options.project_id, [], cdp_pool)

    class FailingBrowserToolkit:
        def __init__(self, *_args, **_kwargs):
            raise TypeError("unsupported browser option")

    monkeypatch.setattr(
        assembler, "HybridBrowserToolkit", FailingBrowserToolkit
    )

    with pytest.raises(TypeError, match="unsupported browser option"):
        await assemble_single_agent_toolkits(
            options,
            task_id=options.task_id,
            working_directory=str(tmp_path),
            hands=None,
            can_delegate=False,
        )

    assert _browser_is_free(cdp_pool)


@pytest.mark.asyncio
async def test_agent_creation_failure_releases_assembled_toolkits(
    sample_chat_data, monkeypatch, tmp_path, cdp_pool
):
    import app.agent.factory.single_agent as single_agent_factory

    options = _options(sample_chat_data, "browser", "terminal", "mcp")
    events: list[str] = []
    _install_toolkits(
        monkeypatch, tmp_path, options.project_id, events, cdp_pool
    )

    def failing_agent_model(*_args, **_kwargs):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(
        single_agent_factory, "agent_model", failing_agent_model
    )

    with pytest.raises(RuntimeError, match="model unavailable"):
        await single_agent_factory.single_agent(options)

    assert events == [
        "mcp.started:browser-reserved",
        "mcp.disconnect",
        "terminal.cleanup",
    ]
    assert _browser_is_free(cdp_pool)


@pytest.mark.asyncio
async def test_cancelled_mcp_startup_stops_servers_that_started(
    sample_chat_data, monkeypatch, tmp_path, cdp_pool
):
    options = _options(sample_chat_data, "browser", "terminal", "mcp")
    events: list[str] = []
    fake_mcp = _install_toolkits(
        monkeypatch, tmp_path, options.project_id, events, cdp_pool
    )
    started = asyncio.Event()

    class SlowMCPToolkit(fake_mcp):
        async def connect(self):
            await super().connect()
            started.set()
            await asyncio.Event().wait()

    monkeypatch.setattr(assembler, "MCPToolkit", SlowMCPToolkit)
    assembly = asyncio.create_task(
        assemble_single_agent_toolkits(
            options,
            task_id=options.task_id,
            working_directory=str(tmp_path),
            hands=None,
            can_delegate=False,
        )
    )
    await asyncio.wait_for(started.wait(), timeout=5)
    assembly.cancel()

    with pytest.raises(asyncio.CancelledError):
        await assembly

    assert events == [
        "mcp.started:browser-reserved",
        "mcp.disconnect",
        "terminal.cleanup",
    ]
    assert _browser_is_free(cdp_pool)


@pytest.mark.asyncio
async def test_failed_mcp_startup_remains_owned_by_the_agent(
    sample_chat_data, monkeypatch, tmp_path, cdp_pool
):
    options = _options(sample_chat_data, "mcp")
    events: list[str] = []
    fake_mcp = _install_toolkits(
        monkeypatch, tmp_path, options.project_id, events, cdp_pool
    )

    class PartlyFailingMCPToolkit(fake_mcp):
        async def connect(self):
            await super().connect()
            raise RuntimeError("one MCP server failed")

    monkeypatch.setattr(assembler, "MCPToolkit", PartlyFailingMCPToolkit)

    assembly = await assemble_single_agent_toolkits(
        options,
        task_id=options.task_id,
        working_directory=str(tmp_path),
        hands=None,
        can_delegate=False,
    )

    assert "MCPToolkit" not in assembly.tool_names
    assert [type(toolkit) for toolkit in assembly.cleanup_toolkits] == [
        PartlyFailingMCPToolkit
    ]


@pytest.mark.asyncio
async def test_rollback_runs_sync_cleanup_off_the_event_loop(
    sample_chat_data,
):
    import threading

    loop_thread = threading.get_ident()
    cleanup_threads: list[int] = []
    disconnect_threads: list[int] = []

    class BlockingCleanupToolkit:
        def cleanup(self):
            cleanup_threads.append(threading.get_ident())

    class AsyncDisconnectToolkit:
        async def disconnect(self):
            disconnect_threads.append(threading.get_ident())

    options = Chat(**sample_chat_data)
    assembly = assembler.ToolkitAssembly(
        cleanup_toolkits=[BlockingCleanupToolkit(), AsyncDisconnectToolkit()]
    )

    await assembler._rollback_runtime_assembly(
        assembly,
        project_id=options.project_id,
        options=options,
        hands=None,
    )

    assert len(cleanup_threads) == 1
    assert cleanup_threads[0] != loop_thread
    assert disconnect_threads == [loop_thread]
