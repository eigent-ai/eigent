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

from app.agent.factory import multi_modal_agent
from app.agent.toolkit.audio_analysis_toolkit import AudioAnalysisToolkit
from app.agent.toolkit.openai_image_toolkit import OpenAIImageToolkit
from app.model.chat import Chat
from app.service.task import Agents

pytestmark = pytest.mark.unit


def test_multi_modal_agent_creation(sample_chat_data):
    """Test multi_modal_agent creates agent with multimedia tools."""
    options = Chat(**sample_chat_data)

    # Setup task lock in the registry before calling agent function
    from app.service.task import task_locks

    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    _mod = "app.agent.factory.multi_modal"
    with (
        patch(f"{_mod}.agent_model") as mock_agent_model,
        patch(
            f"{_mod}.get_working_directory", return_value="/tmp/test_workdir"
        ),
        patch("asyncio.create_task"),
        patch(f"{_mod}.HumanToolkit") as mock_human_toolkit,
        patch(f"{_mod}.VideoDownloaderToolkit") as mock_video_toolkit,
        patch(f"{_mod}.ScreenshotToolkit") as mock_screenshot_toolkit,
        patch(f"{_mod}.OpenAIImageToolkit") as mock_openai_image_toolkit,
        patch(f"{_mod}.AudioAnalysisToolkit") as mock_audio_toolkit,
        patch(f"{_mod}.TerminalToolkit") as mock_terminal_toolkit,
        patch(f"{_mod}.NoteTakingToolkit") as mock_note_toolkit,
        patch(f"{_mod}.SearchToolkit") as mock_search_toolkit,
        patch(f"{_mod}.ToolkitMessageIntegration"),
    ):
        # Mock all toolkit instances
        mock_human_toolkit.get_can_use_tools.return_value = []
        mock_video_toolkit.return_value.get_tools.return_value = []
        mock_screenshot_toolkit.return_value.get_tools.return_value = []
        mock_openai_image_toolkit.return_value.get_tools.return_value = []
        mock_audio_toolkit.return_value.get_tools.return_value = []
        mock_terminal_toolkit.return_value.get_tools.return_value = []
        mock_note_toolkit.return_value.get_tools.return_value = []
        mock_search_toolkit.return_value.get_tools.return_value = []

        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = multi_modal_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()
        mock_screenshot_toolkit.assert_called_once_with(
            options.project_id,
            working_directory="/tmp/test_workdir",
            agent_name=Agents.multi_modal_agent,
        )

        # Check that it was called with multi-modal agent configuration
        call_args = mock_agent_model.call_args
        assert "multi_modal_agent" in str(
            call_args[0][0]
        )  # agent_name (enum contains this value)


def test_multi_modal_agent_skips_openai_aux_tools_for_subscription_auth(
    sample_chat_data,
):
    """Subscription auth must not initialize OpenAI API-key-only toolkits."""
    options = Chat(
        **{
            **sample_chat_data,
            "api_key": "",
            "auth_source": "codex_subscription",
            "model_platform": "openai",
            "model_type": "gpt-5.5",
        }
    )

    _mod = "app.agent.factory.multi_modal"
    with (
        patch(f"{_mod}.agent_model") as mock_agent_model,
        patch(
            f"{_mod}.get_working_directory", return_value="/tmp/test_workdir"
        ),
        patch(f"{_mod}.HumanToolkit") as mock_human_toolkit,
        patch(f"{_mod}.VideoDownloaderToolkit") as mock_video_toolkit,
        patch(f"{_mod}.ScreenshotToolkit") as mock_screenshot_toolkit,
        patch(f"{_mod}.OpenAIImageToolkit") as mock_openai_image_toolkit,
        patch(f"{_mod}.OpenAIAudioModels") as mock_audio_models,
        patch(f"{_mod}.AudioAnalysisToolkit") as mock_audio_toolkit,
        patch(f"{_mod}.TerminalToolkit") as mock_terminal_toolkit,
        patch(f"{_mod}.NoteTakingToolkit") as mock_note_toolkit,
        patch(f"{_mod}.SearchToolkit") as mock_search_toolkit,
        patch(f"{_mod}.ToolkitMessageIntegration"),
    ):
        mock_human_toolkit.get_can_use_tools.return_value = []
        mock_video_toolkit.return_value.get_tools.return_value = []
        mock_screenshot_toolkit.return_value.get_tools.return_value = []
        mock_terminal_toolkit.return_value.get_tools.return_value = []
        mock_note_toolkit.return_value.get_tools.return_value = []
        mock_search_toolkit.get_can_use_tools.return_value = []
        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = multi_modal_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()
        mock_openai_image_toolkit.assert_not_called()
        mock_audio_models.assert_not_called()
        mock_audio_toolkit.assert_not_called()
        tool_names = mock_agent_model.call_args.kwargs["tool_names"]
        assert AudioAnalysisToolkit.toolkit_name() not in tool_names
        assert OpenAIImageToolkit.toolkit_name() not in tool_names
