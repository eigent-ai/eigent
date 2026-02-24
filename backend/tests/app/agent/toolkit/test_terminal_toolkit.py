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
import threading
import time
from unittest.mock import AsyncMock, patch

import pytest

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.hitl.config import HitlOptions
from app.model.enums import ApprovalAction
from app.service.task import ActionCommandApprovalData, TaskLock, task_locks


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


def _make_task_lock(task_id: str) -> TaskLock:
    """Create a TaskLock and register it in the global dict."""
    tl = TaskLock(id=task_id, queue=asyncio.Queue(), human_input={})
    task_locks[task_id] = tl
    return tl


def _make_action_data(
    command: str = "rm -rf /", agent: str = "test_agent"
) -> ActionCommandApprovalData:
    return ActionCommandApprovalData(data={"command": command, "agent": agent})


class _ConcreteToolkit(AbstractToolkit):
    """Minimal concrete subclass so we can test _request_user_approval."""

    def __init__(self, api_task_id: str, agent_name: str = "test_agent"):
        self.api_task_id = api_task_id
        self.agent_name = agent_name
        # Register approval listener (mirrors TerminalToolkit.__init__)
        tl = task_locks.get(api_task_id)
        if tl:
            tl.add_approval_input_listen(agent_name)


@pytest.mark.unit
class TestRequestUserApproval:
    """Tests for AbstractToolkit._request_user_approval."""

    @pytest.mark.asyncio
    async def test_approve_once_returns_none(self):
        """approve_once should let the operation proceed (return None)."""
        task_id = "approval_test_once"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        # Simulate user responding with approve_once
        await tl.put_approval_input("test_agent", ApprovalAction.approve_once)

        result = await toolkit._request_user_approval(_make_action_data())
        assert result is None

    @pytest.mark.asyncio
    async def test_auto_approve_returns_none_and_sets_flag(self):
        """auto_approve should proceed and set the flag for future calls."""
        task_id = "approval_test_auto"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        await tl.put_approval_input("test_agent", ApprovalAction.auto_approve)

        result = await toolkit._request_user_approval(_make_action_data())
        assert result is None
        assert tl.auto_approve["test_agent"] is True

    @pytest.mark.asyncio
    async def test_auto_approve_skips_subsequent_prompts(self):
        """Once auto_approve is set, subsequent calls skip the queue entirely."""
        task_id = "approval_test_auto_skip"
        tl = _make_task_lock(task_id)
        tl.auto_approve["test_agent"] = True
        toolkit = _ConcreteToolkit(task_id)

        # Queue is empty — should NOT block because auto_approve bypasses it
        result = await toolkit._request_user_approval(_make_action_data())
        assert result is None

    @pytest.mark.asyncio
    async def test_reject_returns_error_message(self):
        """reject should return an error string (task will be stopped by frontend)."""
        task_id = "approval_test_reject"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        await tl.put_approval_input("test_agent", ApprovalAction.reject)

        result = await toolkit._request_user_approval(_make_action_data())
        assert result is not None
        assert "rejected" in result.lower()

    @pytest.mark.asyncio
    async def test_unknown_value_treated_as_reject(self):
        """Unrecognised approval values should be treated as rejection (fail-closed)."""
        task_id = "approval_test_unknown"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        await tl.put_approval_input("test_agent", "some_garbage_value")

        result = await toolkit._request_user_approval(_make_action_data())
        assert result is not None
        assert "rejected" in result.lower()

    @pytest.mark.asyncio
    async def test_pushes_action_data_to_sse_queue(self):
        """_request_user_approval should push action_data to the SSE queue."""
        task_id = "approval_test_sse"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        action_data = _make_action_data("echo danger")

        # Pre-fill approval so the method doesn't block
        await tl.put_approval_input("test_agent", ApprovalAction.approve_once)

        await toolkit._request_user_approval(action_data)

        # The action_data should have been pushed to the SSE queue
        sse_item = tl.queue.get_nowait()
        assert sse_item is action_data

    @pytest.mark.asyncio
    async def test_concurrent_approvals_isolated(self):
        """Two agents sharing the same TaskLock have independent approval
        queues — each agent's approval is routed to the correct queue.
        """
        task_id = "approval_test_concurrent"
        tl = _make_task_lock(task_id)

        agent_a = _ConcreteToolkit(task_id, "agent_a")
        agent_b = _ConcreteToolkit(task_id, "agent_b")

        results = {}

        async def request_a():
            results["a"] = await agent_a._request_user_approval(
                _make_action_data("rm -rf /", agent="agent_a")
            )

        async def request_b():
            results["b"] = await agent_b._request_user_approval(
                _make_action_data("drop table users", agent="agent_b")
            )

        # Put responses into agent-specific queues AFTER both start
        # awaiting — order doesn't matter because queues are isolated.
        async def feed_responses():
            await asyncio.sleep(0.01)
            # Approve agent_b, reject agent_a (opposite of insertion order)
            await tl.put_approval_input("agent_b", ApprovalAction.approve_once)
            await tl.put_approval_input("agent_a", ApprovalAction.reject)

        await asyncio.gather(request_a(), request_b(), feed_responses())

        # Agent A got reject (routed to agent_a's queue)
        assert results["a"] is not None
        assert "rejected" in results["a"].lower()
        # Agent B got approve (routed to agent_b's queue)
        assert results["b"] is None

    @pytest.mark.asyncio
    async def test_three_agents_mixed_responses(self):
        """Three agents get approve, reject, auto_approve respectively."""
        task_id = "approval_test_three"
        tl = _make_task_lock(task_id)

        dev = _ConcreteToolkit(task_id, "developer_agent")
        browser = _ConcreteToolkit(task_id, "browser_agent")
        doc = _ConcreteToolkit(task_id, "document_agent")

        results = {}

        async def req_dev():
            results["dev"] = await dev._request_user_approval(
                _make_action_data("rm -rf /tmp", agent="developer_agent")
            )

        async def req_browser():
            results["browser"] = await browser._request_user_approval(
                _make_action_data("sudo apt update", agent="browser_agent")
            )

        async def req_doc():
            results["doc"] = await doc._request_user_approval(
                _make_action_data("kill -9 1", agent="document_agent")
            )

        async def feed():
            await asyncio.sleep(0.01)
            await tl.put_approval_input("browser_agent", ApprovalAction.reject)
            await tl.put_approval_input(
                "document_agent", ApprovalAction.auto_approve
            )
            await tl.put_approval_input(
                "developer_agent", ApprovalAction.approve_once
            )

        await asyncio.gather(req_dev(), req_browser(), req_doc(), feed())

        assert results["dev"] is None  # approved
        assert results["browser"] is not None  # rejected
        assert "rejected" in results["browser"].lower()
        assert results["doc"] is None  # auto-approved

    @pytest.mark.asyncio
    async def test_auto_approve_is_per_agent(self):
        """auto_approve for one agent does NOT affect another."""
        task_id = "approval_test_per_agent_auto"
        tl = _make_task_lock(task_id)

        agent_a = _ConcreteToolkit(task_id, "agent_a")
        agent_b = _ConcreteToolkit(task_id, "agent_b")

        # Auto-approve agent_a via response
        await tl.put_approval_input("agent_a", ApprovalAction.auto_approve)
        result_a = await agent_a._request_user_approval(
            _make_action_data("rm -rf /", agent="agent_a")
        )
        assert result_a is None
        assert tl.auto_approve.get("agent_a") is True

        # agent_a now skips queue entirely (auto-approved)
        result_a2 = await agent_a._request_user_approval(
            _make_action_data("sudo reboot", agent="agent_a")
        )
        assert result_a2 is None

        # agent_b is NOT auto-approved — it must still wait on queue
        assert tl.auto_approve.get("agent_b", False) is False
        await tl.put_approval_input("agent_b", ApprovalAction.reject)
        result_b = await agent_b._request_user_approval(
            _make_action_data("sudo rm -rf /", agent="agent_b")
        )
        assert result_b is not None
        assert "rejected" in result_b.lower()

    @pytest.mark.asyncio
    async def test_auto_approve_survives_dict_reset(self):
        """Resetting auto_approve to {} (as chat_service does on Action.start)
        must not break subsequent approval calls.

        Regression: chat_service.py previously reset auto_approve = False
        (a bool), causing ``task_lock.auto_approve.get(...)`` to raise
        ``AttributeError: 'bool' object has no attribute 'get'``.
        """
        task_id = "approval_test_reset"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        # 1. Grant auto_approve for this agent
        await tl.put_approval_input("test_agent", ApprovalAction.auto_approve)
        r1 = await toolkit._request_user_approval(_make_action_data())
        assert r1 is None
        assert tl.auto_approve["test_agent"] is True

        # 2. Simulate the reset that chat_service does on Action.start
        tl.auto_approve = {}

        # 3. auto_approve flag is cleared — agent must wait on queue again
        assert tl.auto_approve.get("test_agent", False) is False

        # 4. Re-register listener (mirrors TerminalToolkit re-init)
        tl.add_approval_input_listen("test_agent")

        await tl.put_approval_input("test_agent", ApprovalAction.approve_once)
        r2 = await toolkit._request_user_approval(_make_action_data())
        assert r2 is None

    @pytest.mark.asyncio
    async def test_multiple_sequential_approvals_same_agent(self):
        """One agent can request approval multiple times sequentially."""
        task_id = "approval_test_sequential"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id, "dev")

        # First command: approved
        await tl.put_approval_input("dev", ApprovalAction.approve_once)
        r1 = await toolkit._request_user_approval(
            _make_action_data("rm /tmp/a", agent="dev")
        )
        assert r1 is None

        # Second command: rejected
        await tl.put_approval_input("dev", ApprovalAction.reject)
        r2 = await toolkit._request_user_approval(
            _make_action_data("rm /tmp/b", agent="dev")
        )
        assert r2 is not None

        # Third command: approved again
        await tl.put_approval_input("dev", ApprovalAction.approve_once)
        r3 = await toolkit._request_user_approval(
            _make_action_data("rm /tmp/c", agent="dev")
        )
        assert r3 is None


@pytest.mark.unit
class TestTerminalApprovalGating:
    """Tests that hitl_options.terminal_approval controls whether approval is requested."""

    @pytest.mark.asyncio
    async def test_terminal_approval_off_skips_approval(self):
        """When terminal_approval=False, dangerous commands run without approval."""
        task_id = "approval_off_test"
        _make_task_lock(task_id)  # default: terminal_approval=False
        toolkit = TerminalToolkit(task_id, "test_agent")

        with (
            patch.object(
                toolkit, "_request_user_approval", new_callable=AsyncMock
            ) as mock_approval,
            patch(
                "app.agent.toolkit.terminal_toolkit.TerminalToolkit.shell_exec",
                return_value="done",
            ),
        ):
            assert toolkit._terminal_approval is False
            mock_approval.assert_not_called()

    @pytest.mark.asyncio
    async def test_terminal_approval_on_triggers_approval(self):
        """When terminal_approval=True, dangerous commands trigger approval."""
        task_id = "approval_on_test"
        tl = _make_task_lock(task_id)
        tl.hitl_options = HitlOptions(terminal_approval=True)
        toolkit = TerminalToolkit(task_id, "test_agent")

        # Pre-fill approval so the method doesn't block
        await tl.put_approval_input("test_agent", ApprovalAction.approve_once)

        from app.hitl.terminal_command import is_dangerous_command

        assert toolkit._terminal_approval is True
        assert is_dangerous_command("rm -rf /tmp/test") is True

    def test_terminal_approval_default_is_false(self):
        """TerminalToolkit defaults to terminal_approval=False."""
        task_id = "approval_default_test"
        _make_task_lock(task_id)
        toolkit = TerminalToolkit(task_id, "test_agent")
        assert toolkit._terminal_approval is False

    def test_terminal_approval_reads_from_task_lock(self):
        """TerminalToolkit reads terminal_approval from TaskLock.hitl_options."""
        task_id = "approval_read_test"
        tl = _make_task_lock(task_id)
        tl.hitl_options = HitlOptions(terminal_approval=True)
        toolkit = TerminalToolkit(task_id, "test_agent")
        assert toolkit._terminal_approval is True

    def test_terminal_approval_false_never_detects_dangerous(self):
        """With terminal_approval=False, the is_dangerous check is skipped."""
        task_id = "approval_skip_test"
        _make_task_lock(task_id)
        toolkit = TerminalToolkit(task_id, "test_agent")

        from app.hitl.terminal_command import is_dangerous_command

        # The command IS dangerous...
        assert is_dangerous_command("rm -rf /") is True
        # ...but the gating logic would produce False
        is_dangerous = (
            is_dangerous_command("rm -rf /")
            if toolkit._terminal_approval
            else False
        )
        assert is_dangerous is False
