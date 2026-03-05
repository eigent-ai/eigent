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

from unittest.mock import MagicMock, patch

import pytest

from app.agent.factory.workforce_agents import (
    _env_prompt,
    create_coordinator_and_task_agents,
    create_new_worker_agent,
)
from app.model.chat import Chat
from app.service.task import Agents

pytestmark = pytest.mark.unit

_mod = "app.agent.factory.workforce_agents"


def test_env_prompt_contains_platform_info():
    result = _env_prompt("/tmp/workdir")
    assert "working directory" in result.lower() or "/tmp/workdir" in result
    assert "/tmp/workdir" in result


def test_env_prompt_contains_current_date():
    import datetime

    result = _env_prompt("/project")
    today = str(datetime.date.today())
    assert today in result


def test_create_coordinator_and_task_agents_returns_two(sample_chat_data):
    options = Chat(**sample_chat_data)

    mock_agent = MagicMock()

    with (
        patch(f"{_mod}.agent_model", return_value=mock_agent) as mock_am,
        patch(f"{_mod}.HumanToolkit"),
        patch(f"{_mod}.NoteTakingToolkit"),
        patch(f"{_mod}.SkillToolkit"),
        patch(f"{_mod}.ToolkitMessageIntegration"),
    ):
        agents = create_coordinator_and_task_agents(options, "/tmp/workdir")

    assert len(agents) == 2
    assert mock_am.call_count == 2
    call_keys = [call.args[0] for call in mock_am.call_args_list]
    assert Agents.coordinator_agent in call_keys
    assert Agents.task_agent in call_keys


def test_create_new_worker_agent_returns_agent(sample_chat_data):
    options = Chat(**sample_chat_data)

    mock_agent = MagicMock()

    with (
        patch(f"{_mod}.agent_model", return_value=mock_agent) as mock_am,
        patch(f"{_mod}.HumanToolkit"),
        patch(f"{_mod}.NoteTakingToolkit"),
        patch(f"{_mod}.SkillToolkit"),
        patch(f"{_mod}.ToolkitMessageIntegration"),
    ):
        result = create_new_worker_agent(options, "/tmp/workdir")

    assert result is mock_agent
    mock_am.assert_called_once()
    assert mock_am.call_args.args[0] == Agents.new_worker_agent
