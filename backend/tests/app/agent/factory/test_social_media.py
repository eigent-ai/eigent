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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agent.factory import social_media_agent
from app.model.chat import Chat

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_social_media_agent_creation(sample_chat_data):
    """Test social_media_agent creates agent with social media tools."""
    options = Chat(**sample_chat_data)

    # Setup task lock in the registry before calling agent function
    from app.service.task import task_locks

    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    mod = "app.agent.factory.social_media"
    with (
        patch(f"{mod}.agent_model") as mock_agent_model,
        patch("asyncio.create_task"),
        patch(f"{mod}.WhatsAppToolkit") as mock_whatsapp_toolkit,
        patch(f"{mod}.TwitterToolkit") as mock_twitter_toolkit,
        patch(f"{mod}.LinkedInToolkit") as mock_linkedin_toolkit,
        patch(f"{mod}.RedditToolkit") as mock_reddit_toolkit,
        patch(f"{mod}.NotionMCPToolkit") as mock_notion_mcp_toolkit,
        patch(f"{mod}.GoogleGmailMCPToolkit") as mock_gmail_toolkit,
        patch(f"{mod}.GoogleCalendarToolkit") as mock_calendar_toolkit,
        patch(f"{mod}.HumanToolkit") as mock_human_toolkit,
        patch(f"{mod}.TerminalToolkit") as mock_terminal_toolkit,
        patch(f"{mod}.NoteTakingToolkit") as mock_note_toolkit,
    ):
        # Mock all toolkit instances
        mock_whatsapp_toolkit.get_can_use_tools.return_value = []
        mock_twitter_toolkit.get_can_use_tools.return_value = []
        mock_linkedin_toolkit.get_can_use_tools.return_value = []
        mock_reddit_toolkit.get_can_use_tools.return_value = []
        mock_notion_mcp_toolkit.get_can_use_tools = AsyncMock(return_value=[])
        mock_gmail_toolkit.get_can_use_tools = AsyncMock(return_value=[])
        mock_calendar_toolkit.get_can_use_tools.return_value = []
        mock_human_toolkit.get_can_use_tools.return_value = []
        mock_terminal_toolkit.return_value.get_tools.return_value = []
        mock_note_toolkit.return_value.get_tools.return_value = []

        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = await social_media_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()
