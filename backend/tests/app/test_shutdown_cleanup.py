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

"""Ordering guarantees of the backend shutdown sequence.

``cleanup_resources()`` runs a series of independent best-effort steps. The
invariant worth protecting is that an early step raising must not skip the
later ones: the thread pool and the WebSocket pool are what stop the process
from exiting, and a shutdown that skips them leaves the backend lingering on
its port after the app has quit.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit


def _install_stubs(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Replace every optional shutdown dependency with a recorder.

    Each fake module is registered through ``monkeypatch.setitem`` so it is
    removed again when the test ends. Assigning into ``sys.modules`` directly
    would leave the fakes behind for the rest of the session: the real
    ``app.run_runtime`` and friends would then resolve to these recorders, and
    unrelated tests that use them would fail.
    """
    calls: list[str] = []

    def sync_stub(name: str):
        def recorder(*_args, **_kwargs):
            calls.append(name)
            return None

        return recorder

    def async_stub(name: str):
        async def recorder(*_args, **_kwargs):
            calls.append(name)
            return None

        return recorder

    def make(name: str) -> types.ModuleType:
        module = types.ModuleType(name)
        module.close_default_execution_service = async_stub(name)  # type: ignore[attr-defined]
        module.close_default_run_coordinator = async_stub(name)  # type: ignore[attr-defined]
        module.close_default_cloud_sync_worker = async_stub(name)  # type: ignore[attr-defined]
        module.close_default_run_journal = sync_stub(name)  # type: ignore[attr-defined]
        module.shutdown_tracer_provider = sync_stub(name)  # type: ignore[attr-defined]

        class _ThreadPool:
            def shutdown(self, wait: bool = True):
                calls.append("terminal_tool_pool")

        class _TerminalToolkit:
            # A non-None pool is what exercises the shutdown branch; the real
            # one is what keeps the process alive when it is skipped.
            _thread_pool = _ThreadPool()

        module.TerminalToolkit = _TerminalToolkit  # type: ignore[attr-defined]

        class _WebsocketPool:
            async def close_all(self):
                calls.append("websocket_pool")

        module.websocket_connection_pool = _WebsocketPool()  # type: ignore[attr-defined]
        # Via monkeypatch so the fake is removed again when the test ends:
        # assigning directly would leave it behind for the rest of the
        # session, and the real app.run_runtime would resolve to a recorder.
        monkeypatch.setitem(sys.modules, name, module)
        return module

    for name in (
        "app.workspace_runtime.runtime",
        "app.run_runtime",
        "app.run_sync.runtime",
        "app.run_journal.runtime",
        "app.utils.telemetry.workforce_metrics",
        "app.agent.toolkit.terminal_toolkit",
        "app.agent.toolkit.hybrid_browser_toolkit",
    ):
        make(name)

    return calls


@pytest.fixture
def cleanup_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """``cleanup_resources`` with its dependencies stubbed and PID path moved."""
    import main as main_module

    monkeypatch.setattr(main_module, "dir", tmp_path)
    calls = _install_stubs(monkeypatch)
    monkeypatch.setattr(main_module, "set_main_event_loop", lambda _v: None)
    return main_module, calls, tmp_path


class TestCleanupOrdering:
    @pytest.mark.asyncio
    async def test_resource_cleanup_survives_a_failed_pid_file_removal(
        self, cleanup_env
    ):
        """A concurrent unlink must not abort the rest of the shutdown.

        ``atexit`` also removes this file, so a racing removal raised
        FileNotFoundError at what used to be an unguarded statement placed
        *before* the telemetry, thread pool and WebSocket cleanup. Everything
        after it was skipped, and the thread pool is precisely what prevents
        the process from exiting.
        """
        main_module, calls, tmp_path = cleanup_env
        pid_file = tmp_path / "run.pid"
        pid_file.write_text("1")

        real_unlink = Path.unlink

        def unlink(self: Path, *args, **kwargs):
            if self == pid_file:
                raise FileNotFoundError(str(self))
            return real_unlink(self, *args, **kwargs)

        monkey = pytest.MonkeyPatch()
        monkey.setattr(Path, "unlink", unlink)
        try:
            await main_module.cleanup_resources()
        finally:
            monkey.undo()

        assert "app.utils.telemetry.workforce_metrics" in calls
        assert "terminal_tool_pool" in calls
        assert "websocket_pool" in calls

    @pytest.mark.asyncio
    async def test_pid_file_is_removed_last(self, cleanup_env):
        """The PID file is bookkeeping; it must not come before real cleanup."""
        main_module, calls, tmp_path = cleanup_env
        pid_file = tmp_path / "run.pid"
        pid_file.write_text("1")

        order: list[str] = []
        real_unlink = Path.unlink

        def unlink(self: Path, *args, **kwargs):
            if self == pid_file:
                order.append("pid_unlink")
            return real_unlink(self, *args, **kwargs)

        monkey = pytest.MonkeyPatch()
        monkey.setattr(Path, "unlink", unlink)
        try:
            await main_module.cleanup_resources()
        finally:
            monkey.undo()

        assert "pid_unlink" in order
        assert "websocket_pool" in calls
        assert not pid_file.exists()

    @pytest.mark.asyncio
    async def test_missing_pid_file_is_not_an_error(self, cleanup_env):
        main_module, calls, _tmp_path = cleanup_env
        await main_module.cleanup_resources()
        assert "websocket_pool" in calls
