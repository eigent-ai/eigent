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
