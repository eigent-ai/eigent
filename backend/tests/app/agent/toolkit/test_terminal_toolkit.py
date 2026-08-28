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
import os
import signal
import threading
import time
from unittest.mock import MagicMock

import pytest

import app.agent.toolkit.terminal_toolkit as terminal_toolkit_module
from app.agent.toolkit.terminal_toolkit import (
    BaseTerminalToolkit,
    TerminalToolkit,
    _isolated_local_command,
    _restore_isolated_commands_for_log,
)
from app.service.task import TaskLock, task_locks


@pytest.mark.unit
class TestTerminalToolkit:
    """Test to verify the RuntimeError: no running event loop."""

    def test_no_runtime_error_in_sync_context(self):
        """Test  no running event loop."""
        test_api_task_id = "test_api_task_123"

        if test_api_task_id not in task_locks:
            task_locks[test_api_task_id] = TaskLock(
                id=test_api_task_id, queue=asyncio.Queue(), human_input={}
            )
        toolkit = TerminalToolkit("test_api_task_123")

        # This should NOT raise RuntimeError: no running event loop
        # This simulates the exact scenario from the error traceback
        try:
            toolkit._write_to_log("/tmp/test.log", "Test output")
            time.sleep(0.1)  # Give thread time to complete

        except RuntimeError as e:
            if "no running event loop" in str(e):
                pytest.fail(
                    "RuntimeError: no running event loop should not be raised - the fix is not working!"
                )
            else:
                raise  # Re-raise if it's a different RuntimeError

    def test_multiple_calls_no_runtime_error(self):
        """Test that multiple calls don't raise RuntimeError."""
        test_api_task_id = "test_api_task_123"

        if test_api_task_id not in task_locks:
            task_locks[test_api_task_id] = TaskLock(
                id=test_api_task_id, queue=asyncio.Queue(), human_input={}
            )
        toolkit = TerminalToolkit("test_api_task_123")

        # Make multiple calls - none should raise RuntimeError
        try:
            for i in range(5):
                toolkit._write_to_log(f"/tmp/test_{i}.log", f"Output {i}")
            time.sleep(0.2)  # Give threads time to complete
        except RuntimeError as e:
            if "no running event loop" in str(e):
                pytest.fail(
                    "RuntimeError: no running event loop should not be raised!"
                )
            else:
                raise

    def test_thread_safety_no_runtime_error(self):
        """Test thread safety without RuntimeError."""
        test_api_task_id = "test_api_task_123"

        if test_api_task_id not in task_locks:
            task_locks[test_api_task_id] = TaskLock(
                id=test_api_task_id, queue=asyncio.Queue(), human_input={}
            )
        toolkit = TerminalToolkit("test_api_task_123")

        # Create multiple threads that call _write_to_log
        threads = []
        for i in range(5):
            thread = threading.Thread(
                target=toolkit._write_to_log,
                args=(f"/tmp/test_{i}.log", f"Thread {i} output"),
            )
            threads.append(thread)
            thread.start()

        # Wait for all threads to complete
        for thread in threads:
            thread.join()

        time.sleep(0.2)  # Give async operations time to complete

        # Should not have raised any RuntimeError

    def test_async_context_still_works(self):
        """Test that async context still works without RuntimeError."""
        test_api_task_id = "test_api_task_123"

        if test_api_task_id not in task_locks:
            task_locks[test_api_task_id] = TaskLock(
                id=test_api_task_id, queue=asyncio.Queue(), human_input={}
            )
        toolkit = TerminalToolkit("test_api_task_123")

        async def test_async_context():
            toolkit._write_to_log("/tmp/async_test.log", "Async context test")
            await asyncio.sleep(0.1)

        # Should work in async context without RuntimeError
        try:
            asyncio.run(test_async_context())
        except RuntimeError as e:
            if "no running event loop" in str(e):
                pytest.fail(
                    "RuntimeError: no running event loop should not be raised in async context!"
                )
            else:
                raise

    def test_agent_process_environment_excludes_control_credentials(
        self, monkeypatch
    ):
        monkeypatch.setattr(
            BaseTerminalToolkit,
            "_get_env_vars",
            lambda _self: {
                "PATH": "/usr/bin",
                "EIGENT_LOCAL_CONTROL_CAPABILITY": "desktop-secret",
                "EIGENT_WORKSPACE_SECRET_BROKER_ENDPOINT": (
                    "http://127.0.0.1:1234"
                ),
                "EIGENT_WORKSPACE_SECRET_BROKER_CAPABILITY": "broker-secret",
                "EIGENT_OBSOLETE_SECRET_BROKER_ENDPOINT": (
                    "http://127.0.0.1:5678"
                ),
                "EIGENT_OBSOLETE_SECRET_BROKER_CAPABILITY": "obsolete-secret",
                "AUTHORIZATION": "Bearer secret",
                "SERVICE_AUTHORIZATION": "Bearer service-secret",
                "NORMAL_API_KEY": "allowed-tool-secret",
            },
        )
        toolkit = TerminalToolkit("test_api_task_123")

        environment = toolkit._get_env_vars()

        assert environment["PATH"] == "/usr/bin"
        assert environment["NORMAL_API_KEY"] == "allowed-tool-secret"
        assert environment["CAMEL_WORKDIR"] == str(toolkit.working_dir)
        assert environment["file_save_path"] == str(toolkit.working_dir)
        assert "EIGENT_LOCAL_CONTROL_CAPABILITY" not in environment
        assert "EIGENT_WORKSPACE_SECRET_BROKER_ENDPOINT" not in environment
        assert "EIGENT_WORKSPACE_SECRET_BROKER_CAPABILITY" not in environment
        assert "EIGENT_OBSOLETE_SECRET_BROKER_ENDPOINT" not in environment
        assert "EIGENT_OBSOLETE_SECRET_BROKER_CAPABILITY" not in environment
        assert "AUTHORIZATION" not in environment
        assert "SERVICE_AUTHORIZATION" not in environment

    def test_isolated_command_is_sanitized_as_original_user_command(
        self, monkeypatch
    ):
        toolkit = TerminalToolkit.__new__(TerminalToolkit)
        observed: list[str] = []

        def fake_sanitize(_self, command):
            observed.append(command)
            return True, command + " --sanitized"

        monkeypatch.setattr(
            BaseTerminalToolkit,
            "_sanitize_command",
            fake_sanitize,
        )

        is_safe, command = toolkit._sanitize_command(
            _isolated_local_command("sleep 30")
        )

        assert is_safe is True
        assert observed == ["sleep 30"]
        assert "sleep 30 --sanitized" in command

    def test_process_group_bootstrap_is_removed_from_durable_log(self):
        wrapped = _isolated_local_command("python3 report.py")

        restored = _restore_isolated_commands_for_log(
            f"--- Executing ---\n> {wrapped}\n--- Output ---\nok\n"
        )

        assert "> python3 report.py\n" in restored
        assert "os.setsid" not in restored
        assert "sys.executable" not in restored

    @pytest.mark.skipif(os.name == "nt", reason="POSIX process groups only")
    def test_process_group_force_kill_reaps_direct_child(self, monkeypatch):
        toolkit = TerminalToolkit.__new__(TerminalToolkit)
        process = MagicMock(pid=4321)
        sent_signals: list[signal.Signals] = []
        monkeypatch.setattr(
            terminal_toolkit_module,
            "_LOCAL_PROCESS_GROUP_GRACE_SECONDS",
            0,
        )
        monkeypatch.setattr(
            os,
            "killpg",
            lambda _process_group, sent_signal: sent_signals.append(
                sent_signal
            ),
        )
        monkeypatch.setattr(
            toolkit,
            "_process_group_exists",
            lambda _process_group: True,
        )

        toolkit._terminate_local_session(
            {"process": process, "eigent_process_group": process.pid}
        )

        assert sent_signals == [signal.SIGTERM, signal.SIGKILL]
        process.wait.assert_called_once_with(timeout=0)

    @pytest.mark.skipif(os.name == "nt", reason="POSIX process groups only")
    def test_kill_process_terminates_descendants_without_stream_deadlock(
        self, tmp_path
    ):
        task_id = "terminal-process-group-kill"
        task_locks[task_id] = TaskLock(
            id=task_id,
            queue=asyncio.Queue(),
            human_input={},
        )
        toolkit = TerminalToolkit(
            task_id,
            working_directory=str(tmp_path),
            session_logs_dir=str(tmp_path / "logs"),
            safe_mode=False,
        )
        process_group: int | None = None
        try:
            result = toolkit.shell_exec(
                command="sleep 30 & wait",
                id="descendant-holds-stdout",
                block=False,
            )
            assert "started" in result
            session = toolkit.shell_sessions["descendant-holds-stdout"]
            process_group = session["eigent_process_group"]
            assert session["command_history"] == ["sleep 30 & wait"]
            assert os.getpgid(session["process"].pid) == process_group

            started = time.monotonic()
            result = toolkit.shell_kill_process("descendant-holds-stdout")
            elapsed = time.monotonic() - started

            assert result == (
                "Process in session 'descendant-holds-stdout' "
                "has been terminated."
            )
            assert elapsed < 1.5
            assert session["running"] is False

            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline:
                try:
                    os.killpg(process_group, 0)
                except (PermissionError, ProcessLookupError):
                    break
                time.sleep(0.02)
            else:
                pytest.fail("terminal process group survived force kill")
        finally:
            if process_group is not None:
                try:
                    os.killpg(process_group, signal.SIGKILL)
                except (PermissionError, ProcessLookupError):
                    pass
            toolkit.cleanup(remove_venv=False)
            task_locks.pop(task_id, None)
