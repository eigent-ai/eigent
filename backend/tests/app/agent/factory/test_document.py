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

from app.agent.factory import document_agent
from app.model.chat import Chat

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_document_agent_creation(sample_chat_data):
    """Test document_agent creates agent with document tools."""
    options = Chat(**sample_chat_data)

    # Setup task lock in the registry before calling agent function
    from app.service.task import task_locks

    mock_task_lock = MagicMock()
    task_locks[options.task_id] = mock_task_lock

    _mod = "app.agent.factory.document"
    with (
        patch(f"{_mod}.agent_model") as mock_agent_model,
        patch(
            f"{_mod}.get_working_directory", return_value="/tmp/test_workdir"
        ),
        patch("asyncio.create_task"),
        patch(f"{_mod}.HumanToolkit") as mock_human_toolkit,
        patch(f"{_mod}.FileToolkit") as mock_file_toolkit,
        patch(f"{_mod}.PPTXToolkit") as mock_pptx_toolkit,
        patch(f"{_mod}.MarkItDownToolkit") as mock_markdown_toolkit,
        patch(f"{_mod}.ExcelToolkit") as mock_excel_toolkit,
        patch(f"{_mod}.NoteTakingToolkit") as mock_note_toolkit,
        patch(f"{_mod}.ScreenshotToolkit") as mock_screenshot_toolkit,
        patch(f"{_mod}.TerminalToolkit") as mock_terminal_toolkit,
        patch(f"{_mod}.GoogleDriveMCPToolkit") as mock_gdrive_toolkit,
        patch(f"{_mod}.ToolkitMessageIntegration"),
    ):
        # Mock all toolkit instances
        mock_human_toolkit.get_can_use_tools.return_value = []
        mock_file_toolkit.return_value.get_tools.return_value = []
        mock_pptx_toolkit.return_value.get_tools.return_value = []
        mock_markdown_toolkit.return_value.get_tools.return_value = []
        mock_excel_toolkit.return_value.get_tools.return_value = []
        mock_note_toolkit.return_value.get_tools.return_value = []
        mock_screenshot_toolkit.return_value.get_tools.return_value = []
        mock_terminal_toolkit.return_value.get_tools.return_value = []
        mock_gdrive_toolkit.get_can_use_tools = AsyncMock(return_value=[])

        mock_agent = MagicMock()
        mock_agent_model.return_value = mock_agent

        result = await document_agent(options)

        assert result is mock_agent
        mock_agent_model.assert_called_once()

        # Should have called with document-related tools
        call_args = mock_agent_model.call_args
        assert "document_agent" in str(
            call_args[0][0]
        )  # agent_name (enum contains this value)
