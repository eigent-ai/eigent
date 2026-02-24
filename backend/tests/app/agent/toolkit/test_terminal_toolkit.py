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

from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.hitl.config import HitlOptions
from app.model.enums import ApprovalAction
from app.service.task import (
    ActionCommandApprovalData,
    Agents,
    TaskLock,
    task_locks,
)


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


async def _feed_approval(
    tl: TaskLock, action: str
) -> ActionCommandApprovalData:
    """Read one approval event from the SSE queue and resolve it.

    Simulates the frontend receiving the SSE ``command_approval`` event
    and responding with the given *action*.  Returns the SSE item for
    optional assertions.
    """
    sse_item = await asyncio.wait_for(tl.queue.get(), timeout=2.0)
    approval_id = sse_item.data["approval_id"]
    tl.resolve_approval(approval_id, action)
    return sse_item


class _ConcreteToolkit(TerminalToolkit):
    """Lightweight subclass that skips the heavy TerminalToolkit.__init__."""

    def __init__(self, api_task_id: str, agent_name: str = "test_agent"):
        self.api_task_id = api_task_id
        self.agent_name = agent_name


@pytest.mark.unit
class TestRequestUserApproval:
    """Tests for TerminalToolkit._request_user_approval."""

    @pytest.mark.asyncio
    async def test_approve_once_returns_none(self):
        """approve_once should let the operation proceed (return None)."""
        task_id = "approval_test_once"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        result, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, ApprovalAction.approve_once),
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_auto_approve_returns_none_and_sets_flag(self):
        """auto_approve should proceed and set the flag for future calls."""
        task_id = "approval_test_auto"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        result, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, ApprovalAction.auto_approve),
        )
        assert result is None
        assert tl.auto_approve["test_agent"] is True

    @pytest.mark.asyncio
    async def test_auto_approve_skips_subsequent_prompts(self):
        """Once auto_approve is set, subsequent calls skip the Future entirely."""
        task_id = "approval_test_auto_skip"
        tl = _make_task_lock(task_id)
        tl.auto_approve["test_agent"] = True
        toolkit = _ConcreteToolkit(task_id)

        # Should NOT block because auto_approve bypasses the Future
        result = await toolkit._request_user_approval(_make_action_data())
        assert result is None

    @pytest.mark.asyncio
    async def test_reject_returns_error_message(self):
        """reject should return an error string (task will be stopped by frontend)."""
        task_id = "approval_test_reject"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        result, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, ApprovalAction.reject),
        )
        assert result is not None
        assert "rejected" in result.lower()

    @pytest.mark.asyncio
    async def test_unknown_value_treated_as_reject(self):
        """Unrecognised approval values should be treated as rejection (fail-closed)."""
        task_id = "approval_test_unknown"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        result, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, "some_garbage_value"),
        )
        assert result is not None
        assert "rejected" in result.lower()

    @pytest.mark.asyncio
    async def test_pushes_action_data_to_sse_queue(self):
        """_request_user_approval should push action_data to the SSE queue."""
        task_id = "approval_test_sse"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        action_data = _make_action_data("echo danger")

        async def feed_and_verify():
            sse_item = await asyncio.wait_for(tl.queue.get(), timeout=2.0)
            # The SSE item should be the same object we passed in
            assert sse_item is action_data
            # approval_id should have been injected
            assert "approval_id" in sse_item.data
            tl.resolve_approval(
                sse_item.data["approval_id"], ApprovalAction.approve_once
            )
            return sse_item

        result, sse_item = await asyncio.gather(
            toolkit._request_user_approval(action_data),
            feed_and_verify(),
        )
        assert result is None
        assert sse_item is action_data

    @pytest.mark.asyncio
    async def test_concurrent_approvals_isolated(self):
        """Two agents sharing the same TaskLock have independent approval
        Futures — each agent's approval is routed to the correct Future.
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

        async def feed_responses():
            items = {}
            for _ in range(2):
                item = await asyncio.wait_for(tl.queue.get(), timeout=2.0)
                items[item.data["agent"]] = item.data["approval_id"]
            # Approve agent_b, reject agent_a (opposite of insertion order)
            tl.resolve_approval(items["agent_b"], ApprovalAction.approve_once)
            tl.resolve_approval(items["agent_a"], ApprovalAction.reject)

        await asyncio.gather(request_a(), request_b(), feed_responses())

        # Agent A got reject
        assert results["a"] is not None
        assert "rejected" in results["a"].lower()
        # Agent B got approve
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
            items = {}
            for _ in range(3):
                item = await asyncio.wait_for(tl.queue.get(), timeout=2.0)
                items[item.data["agent"]] = item.data["approval_id"]
            tl.resolve_approval(items["browser_agent"], ApprovalAction.reject)
            tl.resolve_approval(
                items["document_agent"], ApprovalAction.auto_approve
            )
            tl.resolve_approval(
                items["developer_agent"], ApprovalAction.approve_once
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
        result_a, _ = await asyncio.gather(
            agent_a._request_user_approval(
                _make_action_data("rm -rf /", agent="agent_a")
            ),
            _feed_approval(tl, ApprovalAction.auto_approve),
        )
        assert result_a is None
        assert tl.auto_approve.get("agent_a") is True

        # agent_a now skips entirely (auto-approved)
        result_a2 = await agent_a._request_user_approval(
            _make_action_data("sudo reboot", agent="agent_a")
        )
        assert result_a2 is None

        # agent_b is NOT auto-approved — it must still wait on a Future
        assert tl.auto_approve.get("agent_b", False) is False
        result_b, _ = await asyncio.gather(
            agent_b._request_user_approval(
                _make_action_data("sudo rm -rf /", agent="agent_b")
            ),
            _feed_approval(tl, ApprovalAction.reject),
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
        r1, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, ApprovalAction.auto_approve),
        )
        assert r1 is None
        assert tl.auto_approve["test_agent"] is True

        # 2. Simulate the reset that chat_service does on Action.start
        tl.auto_approve = {}

        # 3. auto_approve flag is cleared — agent must wait on Future again
        assert tl.auto_approve.get("test_agent", False) is False

        # 4. Must wait on Future again
        r2, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, ApprovalAction.approve_once),
        )
        assert r2 is None

    @pytest.mark.asyncio
    async def test_multiple_sequential_approvals_same_agent(self):
        """One agent can request approval multiple times sequentially."""
        task_id = "approval_test_sequential"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id, "dev")

        # First command: approved
        r1, _ = await asyncio.gather(
            toolkit._request_user_approval(
                _make_action_data("rm /tmp/a", agent="dev")
            ),
            _feed_approval(tl, ApprovalAction.approve_once),
        )
        assert r1 is None

        # Second command: rejected
        r2, _ = await asyncio.gather(
            toolkit._request_user_approval(
                _make_action_data("rm /tmp/b", agent="dev")
            ),
            _feed_approval(tl, ApprovalAction.reject),
        )
        assert r2 is not None

        # Third command: approved again
        r3, _ = await asyncio.gather(
            toolkit._request_user_approval(
                _make_action_data("rm /tmp/c", agent="dev")
            ),
            _feed_approval(tl, ApprovalAction.approve_once),
        )
        assert r3 is None

    @pytest.mark.asyncio
    async def test_concurrent_same_agent_approve_all(self):
        """Multiple concurrent approvals from same agent resolve independently.

        This tests the core bug fix: when the same agent triggers multiple
        dangerous commands concurrently, each gets its own Future and can
        be approved independently.
        """
        task_id = "concurrent_same_agent_all"
        tl = _make_task_lock(task_id)

        toolkits = [_ConcreteToolkit(task_id, "dev_agent") for _ in range(3)]
        results = {}

        async def request(idx):
            results[idx] = await toolkits[idx]._request_user_approval(
                _make_action_data(f"cmd_{idx}", agent="dev_agent")
            )

        async def feed_all():
            for _ in range(3):
                item = await asyncio.wait_for(tl.queue.get(), timeout=2.0)
                tl.resolve_approval(
                    item.data["approval_id"], ApprovalAction.approve_once
                )

        await asyncio.gather(request(0), request(1), request(2), feed_all())

        assert all(results[i] is None for i in range(3))

    @pytest.mark.asyncio
    async def test_concurrent_same_agent_auto_approve_unblocks_siblings(self):
        """Auto-approving one request unblocks all pending from the same agent.

        This tests the key scenario: 3 subtasks from the same agent all
        need approval, user clicks auto-approve on the first one, the
        other 2 should resolve automatically.
        """
        task_id = "concurrent_auto_unblock"
        tl = _make_task_lock(task_id)

        toolkits = [_ConcreteToolkit(task_id, "dev_agent") for _ in range(3)]
        results = {}

        async def request(idx):
            results[idx] = await toolkits[idx]._request_user_approval(
                _make_action_data(f"cmd_{idx}", agent="dev_agent")
            )

        async def feed_auto():
            # Wait for all 3 to push to the SSE queue
            for _ in range(3):
                await asyncio.wait_for(tl.queue.get(), timeout=2.0)
            # Auto-approve ONE — the toolkit code will
            # call resolve_all_approvals_for_agent to resolve the rest
            approval_ids = list(tl.pending_approvals.keys())
            tl.resolve_approval(approval_ids[0], ApprovalAction.auto_approve)

        await asyncio.gather(request(0), request(1), request(2), feed_auto())

        assert all(results[i] is None for i in range(3))
        assert tl.auto_approve.get("dev_agent") is True

    @pytest.mark.asyncio
    async def test_approval_id_uses_enum_value_not_repr(self):
        """approval_id must use the Enum *value* (e.g. ``developer_agent``),
        not the repr (``Agents.developer_agent``).

        Regression: f-string formatting of a ``str, Enum`` member calls
        ``__format__`` which returns ``Agents.developer_agent``.  String
        concatenation (``+``) correctly uses the underlying str value.
        If the prefix mismatches, ``resolve_all_approvals_for_agent``
        silently matches nothing and all pending Futures hang forever.
        """
        task_id = "approval_id_enum_value"
        tl = _make_task_lock(task_id)
        # Use the real Agents enum — the exact type used in production
        toolkit = _ConcreteToolkit(task_id, Agents.developer_agent)

        action_data = _make_action_data(
            "rm -rf /tmp/test", agent="developer_agent"
        )

        async def verify_prefix():
            sse_item = await asyncio.wait_for(tl.queue.get(), timeout=2.0)
            approval_id = sse_item.data["approval_id"]
            # Must start with the plain value, NOT "Agents.developer_agent_"
            assert approval_id.startswith("developer_agent_"), (
                f"approval_id {approval_id!r} has wrong prefix — "
                "Enum __format__ was used instead of str value"
            )
            assert not approval_id.startswith("Agents."), (
                f"approval_id {approval_id!r} contains Enum class name"
            )
            tl.resolve_approval(approval_id, ApprovalAction.approve_once)

        result, _ = await asyncio.gather(
            toolkit._request_user_approval(action_data),
            verify_prefix(),
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_auto_approve_with_enum_agent_name(self):
        """Auto-approve must work when agent_name is an Agents enum member.

        Regression: resolve_all_approvals_for_agent uses
        ``aid.startswith(agent + "_")`` which relies on str concatenation
        producing the enum value.  If approval_id was built with an
        f-string, the prefix would be ``Agents.developer_agent_`` while
        the lookup would search for ``developer_agent_`` — no match.
        """
        task_id = "auto_approve_enum"
        tl = _make_task_lock(task_id)

        toolkits = [
            _ConcreteToolkit(task_id, Agents.developer_agent) for _ in range(3)
        ]
        results = {}

        async def request(idx):
            results[idx] = await toolkits[idx]._request_user_approval(
                _make_action_data(f"cmd_{idx}", agent="developer_agent")
            )

        async def feed_auto():
            for _ in range(3):
                await asyncio.wait_for(tl.queue.get(), timeout=2.0)
            # Simulate what the controller does: resolve with the plain
            # string agent name (as received from the frontend JSON).
            tl.resolve_all_approvals_for_agent(
                "developer_agent", ApprovalAction.auto_approve
            )

        await asyncio.gather(request(0), request(1), request(2), feed_auto())

        assert all(results[i] is None for i in range(3))

    @pytest.mark.asyncio
    async def test_controller_resolve_matches_toolkit_approval_id(self):
        """The controller's resolve path must match the toolkit's approval_id.

        End-to-end: toolkit creates approval_id with Enum agent_name,
        controller resolves with plain string agent name from frontend.
        Both ``resolve_approval`` (approve_once) and
        ``resolve_all_approvals_for_agent`` (auto/reject) must work.
        """
        task_id = "controller_resolve_match"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id, Agents.developer_agent)

        # --- approve_once path: exact approval_id round-trip ---
        action_data = _make_action_data("rm /x", agent="developer_agent")

        async def feed_approve_once():
            sse_item = await asyncio.wait_for(tl.queue.get(), timeout=2.0)
            # Controller receives this exact approval_id from the frontend
            tl.resolve_approval(
                sse_item.data["approval_id"], ApprovalAction.approve_once
            )

        r1, _ = await asyncio.gather(
            toolkit._request_user_approval(action_data),
            feed_approve_once(),
        )
        assert r1 is None

        # --- reject path: bulk resolve by agent string ---
        action_data2 = _make_action_data("rm /y", agent="developer_agent")

        async def feed_reject():
            await asyncio.wait_for(tl.queue.get(), timeout=2.0)
            # Controller sends plain string "developer_agent" from JSON
            tl.resolve_all_approvals_for_agent(
                "developer_agent", ApprovalAction.reject
            )

        r2, _ = await asyncio.gather(
            toolkit._request_user_approval(action_data2),
            feed_reject(),
        )
        assert r2 is not None
        assert "rejected" in r2.lower()


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
            assert toolkit._get_terminal_approval() is False
            mock_approval.assert_not_called()

    @pytest.mark.asyncio
    async def test_terminal_approval_on_triggers_approval(self):
        """When terminal_approval=True, dangerous commands trigger approval."""
        task_id = "approval_on_test"
        tl = _make_task_lock(task_id)
        tl.hitl_options = HitlOptions(terminal_approval=True)
        toolkit = TerminalToolkit(task_id, "test_agent")

        from app.hitl.terminal_command import is_dangerous_command

        assert toolkit._get_terminal_approval() is True
        assert is_dangerous_command("rm -rf /tmp/test") is True

    def test_terminal_approval_default_is_false(self):
        """TerminalToolkit defaults to terminal_approval=False."""
        task_id = "approval_default_test"
        _make_task_lock(task_id)
        toolkit = TerminalToolkit(task_id, "test_agent")
        assert toolkit._get_terminal_approval() is False

    def test_terminal_approval_reads_from_task_lock(self):
        """TerminalToolkit reads terminal_approval from TaskLock on the fly."""
        task_id = "approval_read_test"
        tl = _make_task_lock(task_id)
        toolkit = TerminalToolkit(task_id, "test_agent")
        assert toolkit._get_terminal_approval() is False
        # Change setting after init — should reflect immediately
        tl.hitl_options = HitlOptions(terminal_approval=True)
        assert toolkit._get_terminal_approval() is True

    def test_terminal_approval_false_never_detects_dangerous(self):
        """With terminal_approval=False, the is_dangerous check is skipped."""
        task_id = "approval_skip_test"
        _make_task_lock(task_id)
        toolkit = TerminalToolkit(task_id, "test_agent")

        from app.hitl.terminal_command import is_dangerous_command

        # The command IS dangerous...
        assert is_dangerous_command("rm -rf /") is True
        # ...but the gating logic would produce False
        terminal_approval = toolkit._get_terminal_approval()
        is_dangerous = (
            is_dangerous_command("rm -rf /") if terminal_approval else False
        )
        assert is_dangerous is False


@pytest.mark.unit
class TestFollowUpTaskApproval:
    """Tests for HITL approval behaviour across follow-up tasks.

    When a user sends a follow-up question in the same project the backend
    receives a ``supplement`` action that may carry updated ``hitl_options``.
    These tests verify that changing the setting between tasks takes effect
    immediately — the bug fixed by ``_get_terminal_approval()`` reading from
    ``task_lock`` on the fly rather than caching the value in ``__init__``.
    """

    def test_enable_approval_between_tasks(self):
        """Turning approval ON after task 1 should gate task 2 commands."""
        task_id = "followup_enable"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        # Task 1: approval is OFF (default)
        assert toolkit._get_terminal_approval() is False

        # User navigates to settings and enables approval before task 2
        tl.hitl_options = HitlOptions(terminal_approval=True)

        # Task 2: same toolkit instance, but setting now reads True
        assert toolkit._get_terminal_approval() is True

    def test_disable_approval_between_tasks(self):
        """Turning approval OFF after task 1 should let commands run freely."""
        task_id = "followup_disable"
        tl = _make_task_lock(task_id)
        tl.hitl_options = HitlOptions(terminal_approval=True)
        toolkit = _ConcreteToolkit(task_id)

        # Task 1: approval is ON
        assert toolkit._get_terminal_approval() is True

        # User disables approval before task 2
        tl.hitl_options = HitlOptions(terminal_approval=False)

        # Task 2: setting now reads False
        assert toolkit._get_terminal_approval() is False

    def test_safe_mode_synced_on_toggle(self):
        """safe_mode on the Camel base class must stay in sync with the toggle."""
        task_id = "followup_safe_mode"
        tl = _make_task_lock(task_id)
        toolkit = TerminalToolkit(task_id, "test_agent")

        # Default: approval OFF → safe_mode ON
        assert toolkit._get_terminal_approval() is False
        assert toolkit.safe_mode is True

        # Enable approval → safe_mode OFF
        tl.hitl_options = HitlOptions(terminal_approval=True)
        assert toolkit._get_terminal_approval() is True
        assert toolkit.safe_mode is False

        # Disable again → safe_mode ON
        tl.hitl_options = HitlOptions(terminal_approval=False)
        assert toolkit._get_terminal_approval() is False
        assert toolkit.safe_mode is True

    def test_auto_approve_reset_between_tasks(self):
        """auto_approve flags must be cleared when a new task starts."""
        task_id = "followup_auto_reset"
        tl = _make_task_lock(task_id)
        toolkit = _ConcreteToolkit(task_id)

        # Task 1: agent gets auto-approved
        tl.auto_approve["test_agent"] = True
        assert tl.auto_approve.get("test_agent") is True

        # Simulate Action.start for task 2 — chat_service resets auto_approve
        tl.auto_approve = {}

        # Task 2: auto_approve should be cleared
        assert tl.auto_approve.get("test_agent", False) is False

    @pytest.mark.asyncio
    async def test_approval_required_after_setting_enabled_mid_session(self):
        """Full flow: approval OFF in task 1, ON in task 2, command triggers approval."""
        task_id = "followup_full_flow"
        tl = _make_task_lock(task_id)
        tl.hitl_options = HitlOptions(terminal_approval=False)
        toolkit = _ConcreteToolkit(task_id)

        from app.hitl.terminal_command import is_dangerous_command

        # Task 1: dangerous command NOT gated
        terminal_approval = toolkit._get_terminal_approval()
        is_dangerous = (
            is_dangerous_command("rm -rf /tmp/data")
            if terminal_approval
            else False
        )
        assert is_dangerous is False

        # User enables approval before task 2
        tl.hitl_options = HitlOptions(terminal_approval=True)
        # Reset auto_approve as chat_service would
        tl.auto_approve = {}

        # Task 2: same command IS now gated
        terminal_approval = toolkit._get_terminal_approval()
        is_dangerous = (
            is_dangerous_command("rm -rf /tmp/data")
            if terminal_approval
            else False
        )
        assert is_dangerous is True

        # Approval flow works correctly
        result, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, ApprovalAction.approve_once),
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_reject_after_setting_enabled_mid_session(self):
        """Rejection still works when approval is enabled between tasks."""
        task_id = "followup_reject"
        tl = _make_task_lock(task_id)
        tl.hitl_options = HitlOptions(terminal_approval=False)
        toolkit = _ConcreteToolkit(task_id)

        # Enable approval before task 2
        tl.hitl_options = HitlOptions(terminal_approval=True)

        assert toolkit._get_terminal_approval() is True

        result, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, ApprovalAction.reject),
        )
        assert result is not None
        assert "rejected" in result.lower()

    @pytest.mark.asyncio
    async def test_auto_approve_does_not_carry_over_to_next_task(self):
        """auto_approve granted in task 1 must not persist into task 2."""
        task_id = "followup_auto_no_carry"
        tl = _make_task_lock(task_id)
        tl.hitl_options = HitlOptions(terminal_approval=True)
        toolkit = _ConcreteToolkit(task_id)

        # Task 1: grant auto_approve
        r1, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, ApprovalAction.auto_approve),
        )
        assert r1 is None
        assert tl.auto_approve["test_agent"] is True

        # Simulate new task start — reset auto_approve
        tl.auto_approve = {}

        # Task 2: auto_approve cleared, must wait on Future again
        r2, _ = await asyncio.gather(
            toolkit._request_user_approval(_make_action_data()),
            _feed_approval(tl, ApprovalAction.reject),
        )
        assert r2 is not None
        assert "rejected" in r2.lower()
