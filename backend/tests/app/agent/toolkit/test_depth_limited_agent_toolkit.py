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

from contextvars import ContextVar
from types import SimpleNamespace

from camel.toolkits import FunctionTool

from app.agent.toolkit.depth_limited_agent_toolkit import (
    DepthLimitedAgentToolkit,
)


def _normal_tool() -> str:
    return "ok"


class DummyParent:
    def __init__(self):
        self.agent_toolkit = DepthLimitedAgentToolkit()

    def _clone_tools(self):
        return (
            [
                FunctionTool(self.agent_toolkit.agent_run_subagent),
                FunctionTool(_normal_tool),
            ],
            [self.agent_toolkit],
        )


def test_depth_limited_agent_toolkit_filters_child_delegation_tools():
    toolkit = DepthLimitedAgentToolkit(current_depth=0, max_depth=1)

    tools, toolkits_to_register = toolkit._resolve_child_tools(DummyParent())

    tool_names = [tool.get_function_name() for tool in tools]
    assert "agent_run_subagent" not in tool_names
    assert "_normal_tool" in tool_names
    assert toolkits_to_register == []


def test_depth_limited_agent_toolkit_propagates_run_context_to_child_thread():
    marker: ContextVar[str] = ContextVar("child-run-marker", default="missing")
    observed: list[str] = []

    class DummyAgent:
        agent_id = "child-1"
        stop_event = None

        def step(self, _prompt):
            observed.append(marker.get())
            return SimpleNamespace(msgs=[])

    toolkit = DepthLimitedAgentToolkit(current_depth=0, max_depth=1)
    agent = DummyAgent()
    toolkit._sessions[agent.agent_id] = SimpleNamespace(
        agent=agent,
        subagent_type="research",
        description="Research references",
        turns=0,
        active_task_id=None,
    )
    token = marker.set("run-1")
    try:
        task = toolkit._submit_agent_task(
            agent_id=agent.agent_id,
            agent=agent,
            prompt="inspect",
        )
        task.future.result(timeout=2)
    finally:
        marker.reset(token)
        toolkit._executor.shutdown(wait=True)

    assert observed == ["run-1"]
