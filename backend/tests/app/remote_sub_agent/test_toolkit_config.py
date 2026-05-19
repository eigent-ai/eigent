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

from types import SimpleNamespace

import pytest

from app.agent.factory.remote_sub_agent import (
    attach_remote_sub_agent_if_enabled,
)
from app.agent.toolkit.remote_sub_agent_toolkit import RemoteSubAgentToolkit

pytestmark = pytest.mark.unit


def _valid_config() -> dict:
    return {
        "enabled": True,
        "provider": "gemini_agents",
        "gemini_agents": {
            "api_key": "test-key",
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
            "agent_name": "antigravity-preview-05-2026",
            "max_wall_time_seconds": 900,
            "poll_interval_seconds": 5,
        },
    }


def test_toolkit_disabled_without_user_config_even_if_env_enabled(monkeypatch):
    monkeypatch.setenv("EIGENT_REMOTE_SUB_AGENT_ENABLED", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "env-key")

    assert RemoteSubAgentToolkit.is_enabled(None) is False


def test_toolkit_enabled_with_complete_user_config():
    assert RemoteSubAgentToolkit.is_enabled(_valid_config()) is True


@pytest.mark.asyncio
async def test_toolkit_returns_message_when_config_is_incomplete():
    toolkit = RemoteSubAgentToolkit(
        api_task_id="task-1",
        remote_sub_agent_config={
            **_valid_config(),
            "gemini_agents": {
                "api_key": "",
                "base_url": "https://generativelanguage.googleapis.com/v1beta",
                "agent_name": "antigravity-preview-05-2026",
            },
        },
    )

    result = await toolkit.run_remote_sub_agent("research this")

    assert "disabled or incomplete" in result


def test_factory_helper_attaches_remote_tool_and_notice_when_enabled():
    options = SimpleNamespace(
        project_id="task-1", remote_sub_agent_config=_valid_config()
    )
    tools = []
    tool_names = []

    system_message = attach_remote_sub_agent_if_enabled(
        options=options,
        agent_name="test_agent",
        working_directory="/tmp/work",
        tools=tools,
        tool_names=tool_names,
        system_message="base prompt",
        local_tool_description="local tools",
    )

    assert RemoteSubAgentToolkit.toolkit_name() in tool_names
    assert [tool.func.__name__ for tool in tools] == ["run_remote_sub_agent"]
    assert "remote-suitable work" in system_message
    assert "/tmp/work" in system_message
