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

import pytest

from app.run_runtime.owned_tasks import (
    current_owned_tasks,
    owned_tasks_scope,
    run_owned_thread,
)
from app.workspace_runtime.bound_runtime import (
    RuntimeBinding,
    UnsettledWriters,
)
from app.workspace_runtime.native_runtime import NativeAgentRuntime
from app.workspace_runtime.provider import WorkspaceHandle


def binding(tmp_path, name):
    root = tmp_path / name
    root.mkdir()
    return RuntimeBinding(
        name,
        "attempt-" + name,
        1,
        WorkspaceHandle(name, root, "attempt-" + name, 1, "snapshot"),
        "environment",
        {},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("other_loop", [False, True])
async def test_handled_tool_errors_do_not_poison_turn(tmp_path, other_loop):
    async def close():
        pass

    runtime = NativeAgentRuntime(
        binding(tmp_path, "run"), stop_resources=close
    )

    def failed_sync_tool():
        raise ValueError("invalid tool argument")

    async def failed_async_tool():
        raise ValueError("invalid async tool argument")

    async def recover():
        with pytest.raises(ValueError, match="invalid tool argument"):
            await runtime.run_tool(lambda: asyncio.to_thread(failed_sync_tool))
        with pytest.raises(ValueError, match="invalid async tool argument"):
            await runtime.run_tool(failed_async_tool)
        return "recovered"

    async def turn(_runtime):
        if other_loop:
            return await run_owned_thread(lambda: asyncio.run(recover()))
        return await recover()

    assert await runtime.run(turn) == "recovered"
    proof = await runtime.stop()
    assert runtime.verify_settlement(proof)["outcome"] == "stopped"


@pytest.mark.asyncio
async def test_known_tool_failure_can_recover_through_agent_adapter(tmp_path):
    from unittest.mock import AsyncMock, MagicMock, patch

    from camel.agents._types import ToolCallRequest
    from camel.toolkits import FunctionTool

    from app.agent.listen_chat_agent import ListenChatAgent
    from app.run_runtime.tool_checkpoint import (
        ToolInvocationNotDispatchedError,
    )

    def terminal_command():
        raise ToolInvocationNotDispatchedError("no write dispatched")

    agent = object.__new__(ListenChatAgent)
    agent._internal_tools = {
        "terminal_command": FunctionTool(terminal_command)
    }
    agent.api_task_id = "session"
    agent.agent_name = "developer"
    agent.process_task_id = "run"
    agent._record_tool_calling = MagicMock(return_value="model-visible error")
    lock = MagicMock()
    lock.put_queue = AsyncMock()
    request = ToolCallRequest(
        tool_name="terminal_command", args={}, tool_call_id="call-pre-dispatch"
    )

    async def close():
        pass

    runtime = NativeAgentRuntime(
        binding(tmp_path, "run"), stop_resources=close
    )

    async def turn(_runtime):
        assert await agent._aexecute_tool(request) == "model-visible error"
        return "successful answer after recovery"

    module = "app.agent.listen_chat_agent"
    with (
        patch(module + ".get_task_lock", return_value=lock),
        patch(module + ".prepare_tool_checkpoint", return_value=MagicMock()),
        patch(module + ".authorize_tool_checkpoint", new=AsyncMock()),
        patch(module + ".dispatch_tool_checkpoint"),
        patch(module + ".finish_tool_checkpoint") as finish,
    ):
        try:
            assert (
                await runtime.run(turn) == "successful answer after recovery"
            )
            assert finish.call_args.kwargs["outcome_known"] is True
        finally:
            await runtime.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("other_loop", [False, True])
async def test_unobserved_background_failure_still_fails_drain(other_loop):
    async def failed_background_work():
        raise RuntimeError("background cleanup failed")

    with pytest.raises(RuntimeError, match="background cleanup failed"):
        async with owned_tasks_scope():
            owner = current_owned_tasks()
            if other_loop:
                await asyncio.to_thread(
                    owner.schedule, failed_background_work()
                )
            else:
                owner.create_task(failed_background_work())


@pytest.mark.asyncio
async def test_checkpoint_thread_failure_still_fails_turn(tmp_path):
    async def close():
        pass

    def failed_checkpoint():
        raise RuntimeError("checkpoint commit failed")

    runtime = NativeAgentRuntime(
        binding(tmp_path, "run"), stop_resources=close
    )

    async def turn(_runtime):
        with pytest.raises(RuntimeError, match="checkpoint commit failed"):
            await run_owned_thread(failed_checkpoint)
        return "must not succeed"

    with pytest.raises(RuntimeError, match="checkpoint commit failed"):
        await runtime.run(turn)
    await runtime.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("other_loop", [False, True])
async def test_cancelled_tool_waiter_retains_late_failure(other_loop):
    entered, release = threading.Event(), threading.Event()

    def failed_tool():
        entered.set()
        assert release.wait(5)
        raise RuntimeError("unobserved tool failure")

    async def cancel_waiter():
        waiter = asyncio.create_task(
            current_owned_tasks().run(asyncio.to_thread(failed_tool))
        )
        assert await asyncio.to_thread(entered.wait, 5)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter

    try:
        with pytest.raises(RuntimeError, match="unobserved tool failure"):
            async with owned_tasks_scope():
                if other_loop:
                    await asyncio.to_thread(
                        lambda: asyncio.run(cancel_waiter())
                    )
                else:
                    await cancel_waiter()
                release.set()
    finally:
        release.set()


@pytest.mark.asyncio
async def test_cancel_waiter_retains_tool_thread_and_other_run(tmp_path):
    entered = threading.Event()
    release = threading.Event()
    peer_release = asyncio.Event()
    resources_closed = asyncio.Event()

    async def close():
        resources_closed.set()

    runtime = NativeAgentRuntime(
        binding(tmp_path, "first"), stop_resources=close
    )
    peer = NativeAgentRuntime(binding(tmp_path, "peer"), stop_resources=close)

    def tool():
        entered.set()
        release.wait(5)
        (runtime.binding.workspace.local_root / "late.txt").write_text(
            "settled"
        )

    async def first(_runtime):
        await run_owned_thread(tool)

    async def second(_runtime):
        await peer_release.wait()
        return "peer completed"

    caller = asyncio.create_task(runtime.run(first))
    peer_caller = asyncio.create_task(peer.run(second))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        caller.cancel()
        with pytest.raises(asyncio.CancelledError):
            await caller
        stopped = asyncio.create_task(runtime.stop())
        await resources_closed.wait()
        assert not stopped.done()
        with pytest.raises(UnsettledWriters):
            runtime.verify_settlement(None)
        assert not peer_caller.done()
        release.set()
        proof = await asyncio.wait_for(stopped, 5)
        assert runtime.verify_settlement(proof)["outcome"] == "stopped"
        assert (
            runtime.binding.workspace.local_root / "late.txt"
        ).read_text() == "settled"
        with pytest.raises(UnsettledWriters):
            peer.verify_settlement(proof)
        peer_release.set()
        assert await peer_caller == "peer completed"
        await peer.stop()
    finally:
        release.set()
        peer_release.set()
        await asyncio.gather(caller, peer_caller, return_exceptions=True)


@pytest.mark.asyncio
async def test_resource_failure_never_issues_settlement(tmp_path):
    async def failed_cleanup():
        raise RuntimeError("process group still alive")

    runtime = NativeAgentRuntime(
        binding(tmp_path, "run"), stop_resources=failed_cleanup
    )
    with pytest.raises(RuntimeError, match="still alive"):
        await runtime.stop()
    with pytest.raises(UnsettledWriters):
        runtime.path_provenance(["output.txt"])


@pytest.mark.asyncio
async def test_cancelled_stop_waiter_does_not_cancel_cleanup(tmp_path):
    entered, release = asyncio.Event(), asyncio.Event()

    async def close():
        entered.set()
        await release.wait()

    runtime = NativeAgentRuntime(
        binding(tmp_path, "run"), stop_resources=close
    )
    caller = asyncio.create_task(runtime.stop())
    await entered.wait()
    caller.cancel()
    with pytest.raises(asyncio.CancelledError):
        await caller
    release.set()
    proof = await runtime.stop()
    assert runtime.verify_settlement(proof)["outcome"] == "stopped"


@pytest.mark.asyncio
async def test_stop_interrupts_user_wait_without_tool_dispatch(tmp_path):
    entered, cleaned = asyncio.Event(), asyncio.Event()
    dispatched = []

    async def close():
        pass

    runtime = NativeAgentRuntime(
        binding(tmp_path, "waiting"), stop_resources=close
    )

    async def approval():
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.set()

    async def tool():
        await runtime.wait_for_user(approval)
        dispatched.append(True)

    caller = asyncio.create_task(runtime.run(lambda _: runtime.run_tool(tool)))
    await entered.wait()
    proof = await asyncio.wait_for(runtime.stop(), 1)
    await asyncio.gather(caller, return_exceptions=True)
    assert cleaned.is_set()
    assert not dispatched
    assert runtime.verify_settlement(proof)["outcome"] == "stopped"
