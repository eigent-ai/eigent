import asyncio
import threading
import time
import pytest
from app.service.task import task_locks, TaskLock
from app.utils.toolkit.terminal_toolkit import TerminalToolkit


@pytest.mark.unit
class TestTerminalToolkit:
    """Test to verify the RuntimeError: no running event loop."""

    def test_no_runtime_error_in_sync_context(self):
        """Test  no running event loop."""
        test_api_task_id = "test_api_task_123"

        if test_api_task_id not in task_locks:
            task_locks[test_api_task_id] = TaskLock(id=test_api_task_id, queue=asyncio.Queue(), human_input={})
        toolkit = TerminalToolkit("test_api_task_123")
        
        # This should NOT raise RuntimeError: no running event loop
        # This simulates the exact scenario from the error traceback
        try:
            toolkit._write_to_log("/tmp/test.log", "Test output")
            time.sleep(0.1)  # Give thread time to complete

        except RuntimeError as e:
            if "no running event loop" in str(e):
                pytest.fail("RuntimeError: no running event loop should not be raised - the fix is not working!")
            else:
                raise  # Re-raise if it's a different RuntimeError

    def test_multiple_calls_no_runtime_error(self):
        """Test that multiple calls don't raise RuntimeError."""
        test_api_task_id = "test_api_task_123"

        if test_api_task_id not in task_locks:
            task_locks[test_api_task_id] = TaskLock(id=test_api_task_id, queue=asyncio.Queue(), human_input={})
        toolkit = TerminalToolkit("test_api_task_123")
        
        # Make multiple calls - none should raise RuntimeError
        try:
            for i in range(5):
                toolkit._write_to_log(f"/tmp/test_{i}.log", f"Output {i}")
            time.sleep(0.2)  # Give threads time to complete
        except RuntimeError as e:
            if "no running event loop" in str(e):
                pytest.fail("RuntimeError: no running event loop should not be raised!")
            else:
                raise

    def test_thread_safety_no_runtime_error(self):
        """Test thread safety without RuntimeError."""
        test_api_task_id = "test_api_task_123"

        if test_api_task_id not in task_locks:
            task_locks[test_api_task_id] = TaskLock(id=test_api_task_id, queue=asyncio.Queue(), human_input={})
        toolkit = TerminalToolkit("test_api_task_123")

        # Create multiple threads that call _write_to_log
        threads = []
        for i in range(5):
            thread = threading.Thread(
                target=toolkit._write_to_log,
                args=(f"/tmp/test_{i}.log", f"Thread {i} output")
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
            task_locks[test_api_task_id] = TaskLock(id=test_api_task_id, queue=asyncio.Queue(), human_input={})
        toolkit = TerminalToolkit("test_api_task_123")

        async def test_async_context():
            toolkit._write_to_log("/tmp/async_test.log", "Async context test")
            await asyncio.sleep(0.1)
        
        # Should work in async context without RuntimeError
        try:
            asyncio.run(test_async_context())
        except RuntimeError as e:
            if "no running event loop" in str(e):
                pytest.fail("RuntimeError: no running event loop should not be raised in async context!")
            else:
                raise



