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
import threading
import time
from unittest.mock import patch

import pytest

from app.agent.toolkit.terminal_toolkit import (
    TerminalToolkit,
    _is_dangerous_command,
    _validate_cd_within_working_dir,
)
from app.service.task import TaskLock, task_locks


@pytest.mark.unit
class TestIsDangerousCommand:
    """Tests for HITL dangerous command detection (issue #1306)."""

    def test_rm_is_dangerous(self):
        assert _is_dangerous_command("rm") is True
        assert _is_dangerous_command("rm -rf /tmp/x") is True
        assert _is_dangerous_command("  rm  file") is True
        assert _is_dangerous_command("rm -f foo") is True

    def test_safe_commands_not_dangerous(self):
        assert _is_dangerous_command("ls") is False
        assert _is_dangerous_command("echo hello") is False
        assert _is_dangerous_command("cat file") is False
        assert _is_dangerous_command("pwd") is False
        assert _is_dangerous_command("") is False
        assert _is_dangerous_command("   ") is False

    def test_other_dangerous_commands(self):
        assert _is_dangerous_command("sudo rm -rf x") is True
        assert _is_dangerous_command("systemctl restart foo") is True
        assert _is_dangerous_command("chown user file") is True
        assert _is_dangerous_command("/usr/bin/sudo ls") is True


@pytest.mark.unit
class TestValidateCdWithinWorkingDir:
    """Tests for cd validation in non-Docker mode (issue #1306)."""

    def test_cd_under_working_dir_allowed(self):
        import tempfile
        with tempfile.TemporaryDirectory() as work:
            sub = os.path.join(work, "sub")
            os.makedirs(sub, exist_ok=True)
            ok, err = _validate_cd_within_working_dir(f"cd {sub}", work)
            assert ok is True
            assert err is None

    def test_cd_outside_working_dir_rejected(self):
        import tempfile
        with tempfile.TemporaryDirectory() as work:
            with tempfile.TemporaryDirectory() as other:
                ok, err = _validate_cd_within_working_dir(f"cd {other}", work)
                assert ok is False
                assert "escape" in (err or "")


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


@pytest.mark.unit
class TestTerminalToolkitSafeModeHITL:
    """Tests for Safe Mode HITL approval flow (issue #1306)."""

    def test_safe_mode_reject_returns_rejection_message(self):
        """When safe_mode=True and user rejects, shell_exec returns rejection message."""
        test_api_task_id = "test_hitl_reject_123"
        if test_api_task_id in task_locks:
            del task_locks[test_api_task_id]
        task_locks[test_api_task_id] = TaskLock(
            id=test_api_task_id, queue=asyncio.Queue(), human_input={}
        )
        toolkit = TerminalToolkit(test_api_task_id, safe_mode=True)

        result_holder = {}

        def run_shell_exec():
            result_holder["out"] = toolkit.shell_exec(
                "rm -rf /tmp/some_file", block=True
            )

        thread = threading.Thread(target=run_shell_exec)
        thread.start()
        # Allow thread to put approval request and block on get()
        time.sleep(0.5)
        task_locks[test_api_task_id].terminal_approval_response.put("reject")
        thread.join(timeout=2)
        assert not thread.is_alive()
        assert result_holder["out"] == "Command rejected by user."

    def test_safe_mode_approve_once_proceeds_to_execute(self):
        """When safe_mode=True and user approves, shell_exec proceeds (base is mocked)."""
        test_api_task_id = "test_hitl_approve_123"
        if test_api_task_id in task_locks:
            del task_locks[test_api_task_id]
        task_locks[test_api_task_id] = TaskLock(
            id=test_api_task_id, queue=asyncio.Queue(), human_input={}
        )
        toolkit = TerminalToolkit(test_api_task_id, safe_mode=True)

        with patch(
            "app.agent.toolkit.terminal_toolkit.BaseTerminalToolkit.shell_exec",
            return_value="ok",
        ) as mock_base_shell:
            result_holder = {}

            def run_shell_exec():
                result_holder["out"] = toolkit.shell_exec(
                    "rm -rf /tmp/x", block=True
                )

            thread = threading.Thread(target=run_shell_exec)
            thread.start()
            time.sleep(0.5)
            task_locks[test_api_task_id].terminal_approval_response.put(
                "approve_once"
            )
            thread.join(timeout=2)
            assert not thread.is_alive()
            assert result_holder["out"] == "ok"
            mock_base_shell.assert_called_once()

    def test_safe_mode_off_dangerous_command_no_hitl(self):
        """When safe_mode=False, dangerous command does not trigger HITL."""
        test_api_task_id = "test_hitl_off_123"
        if test_api_task_id in task_locks:
            del task_locks[test_api_task_id]
        task_locks[test_api_task_id] = TaskLock(
            id=test_api_task_id, queue=asyncio.Queue(), human_input={}
        )
        toolkit = TerminalToolkit(test_api_task_id, safe_mode=False)

        with patch(
            "app.agent.toolkit.terminal_toolkit.BaseTerminalToolkit.shell_exec",
            return_value="done",
        ) as mock_base_shell:
            out = toolkit.shell_exec("rm /tmp/x", block=True)
            assert out == "done"
            mock_base_shell.assert_called_once()
            # Approval queue should never have been read
            assert task_locks[test_api_task_id].terminal_approval_response.empty()

    def test_safe_mode_on_safe_command_no_hitl(self):
        """When safe_mode=True but command is safe, no HITL."""
        test_api_task_id = "test_hitl_safe_cmd_123"
        if test_api_task_id in task_locks:
            del task_locks[test_api_task_id]
        task_locks[test_api_task_id] = TaskLock(
            id=test_api_task_id, queue=asyncio.Queue(), human_input={}
        )
        toolkit = TerminalToolkit(test_api_task_id, safe_mode=True)

        with patch(
            "app.agent.toolkit.terminal_toolkit.BaseTerminalToolkit.shell_exec",
            return_value="hello",
        ) as mock_base_shell:
            out = toolkit.shell_exec("echo hello", block=True)
            assert out == "hello"
            mock_base_shell.assert_called_once()
            assert task_locks[test_api_task_id].terminal_approval_response.empty()
