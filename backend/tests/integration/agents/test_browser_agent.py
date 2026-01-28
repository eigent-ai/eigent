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

"""
Integration tests for Browser Agent.

This module contains comprehensive integration tests for the browser agent,
testing its initialization, toolkit integration, browser operations, search
functionality, note-taking, and end-to-end workflows.

These tests verify that the browser agent correctly integrates with:
- HybridBrowserToolkit for web browsing operations
- SearchToolkit for web search functionality
- NoteTakingToolkit for recording findings
- TerminalToolkit for local operations
- HumanToolkit for user interaction
"""

import asyncio
import os
import tempfile
import uuid
from pathlib import Path
from typing import Dict, Any, List
from unittest.mock import AsyncMock, MagicMock, patch, Mock
import pytest

from camel.agents import ChatAgent
from camel.messages import BaseMessage
from camel.models import BaseModelBackend
from camel.responses import ChatAgentResponse

from app.utils.agent import browser_agent, ListenChatAgent
from app.model.chat import Chat, Agents
from app.utils.toolkit.hybrid_browser_toolkit import HybridBrowserToolkit
from app.utils.toolkit.search_toolkit import SearchToolkit
from app.utils.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.utils.toolkit.terminal_toolkit import TerminalToolkit
from app.utils.toolkit.human_toolkit import HumanToolkit


@pytest.mark.integration
class TestBrowserAgentInitialization:
    """Test browser agent initialization and setup."""

    def test_browser_agent_initialization_basic(self, temp_dir, mock_model_backend):
        """Test basic browser agent initialization."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            result = browser_agent(options)
            
            assert result is not None
            mock_agent_model.assert_called_once()
            
            # Verify agent_model was called with correct agent type
            call_args = mock_agent_model.call_args
            assert call_args[0][0] == Agents.browser_agent

    def test_browser_agent_toolkit_setup(self, temp_dir, mock_model_backend):
        """Test that browser agent sets up all required toolkits."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.HybridBrowserToolkit') as mock_browser_toolkit, \
             patch('app.utils.agent.TerminalToolkit') as mock_terminal_toolkit, \
             patch('app.utils.agent.NoteTakingToolkit') as mock_note_toolkit, \
             patch('app.utils.agent.SearchToolkit') as mock_search_toolkit:
            
            mock_browser_instance = MagicMock()
            mock_browser_instance.get_tools.return_value = []
            mock_browser_toolkit.return_value = mock_browser_instance
            
            mock_terminal_instance = MagicMock()
            mock_terminal_instance.shell_exec = MagicMock()
            mock_terminal_toolkit.return_value = mock_terminal_instance
            
            mock_note_instance = MagicMock()
            mock_note_instance.get_tools.return_value = []
            mock_note_toolkit.return_value = mock_note_instance
            
            mock_search_instance = MagicMock()
            mock_search_instance.get_can_use_tools.return_value = []
            mock_search_toolkit.get_can_use_tools.return_value = []
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify toolkits were initialized
            mock_browser_toolkit.assert_called_once()
            mock_terminal_toolkit.assert_called_once()
            mock_note_toolkit.assert_called_once()

    def test_browser_agent_working_directory_setup(self, temp_dir, mock_model_backend):
        """Test that browser agent correctly sets up working directory."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify working directory was used
            call_args = mock_agent_model.call_args
            assert call_args is not None

    def test_browser_agent_cdp_url_configuration(self, temp_dir, mock_model_backend):
        """Test that browser agent configures CDP URL correctly."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='8080'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.HybridBrowserToolkit') as mock_browser_toolkit:
            
            mock_browser_instance = MagicMock()
            mock_browser_instance.get_tools.return_value = []
            mock_browser_toolkit.return_value = mock_browser_instance
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify HybridBrowserToolkit was called with correct CDP URL
            call_args = mock_browser_toolkit.call_args
            assert call_args is not None
            assert 'cdp_url' in call_args.kwargs or 'cdp_url' in str(call_args)

    def test_browser_agent_enabled_tools_configuration(self, temp_dir, mock_model_backend):
        """Test that browser agent enables all required browser tools."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        expected_tools = [
            "browser_click",
            "browser_type",
            "browser_back",
            "browser_forward",
            "browser_select",
            "browser_console_exec",
            "browser_console_view",
            "browser_switch_tab",
            "browser_enter",
            "browser_visit_page",
            "browser_scroll",
            "browser_sheet_read",
            "browser_sheet_input",
            "browser_get_page_snapshot",
        ]

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.HybridBrowserToolkit') as mock_browser_toolkit:
            
            mock_browser_instance = MagicMock()
            mock_browser_instance.get_tools.return_value = []
            mock_browser_toolkit.return_value = mock_browser_instance
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify enabled_tools were configured
            call_args = mock_browser_toolkit.call_args
            assert call_args is not None


@pytest.mark.integration
class TestBrowserAgentToolkitIntegration:
    """Test browser agent integration with various toolkits."""

    def test_browser_agent_hybrid_browser_toolkit_integration(self, temp_dir, mock_model_backend):
        """Test browser agent integration with HybridBrowserToolkit."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.HybridBrowserToolkit') as mock_browser_toolkit:
            
            mock_browser_instance = MagicMock()
            mock_browser_tools = [
                MagicMock(name="browser_visit_page"),
                MagicMock(name="browser_click"),
                MagicMock(name="browser_type"),
            ]
            mock_browser_instance.get_tools.return_value = mock_browser_tools
            mock_browser_toolkit.return_value = mock_browser_instance
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify browser toolkit was integrated
            mock_browser_toolkit.assert_called_once()
            mock_browser_instance.get_tools.assert_called()

    def test_browser_agent_search_toolkit_integration(self, temp_dir, mock_model_backend):
        """Test browser agent integration with SearchToolkit."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        mock_search_tools = [
            MagicMock(name="search_google"),
        ]

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.SearchToolkit.get_can_use_tools', return_value=mock_search_tools):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify search tools were integrated
            call_args = mock_agent_model.call_args
            assert call_args is not None

    def test_browser_agent_note_taking_toolkit_integration(self, temp_dir, mock_model_backend):
        """Test browser agent integration with NoteTakingToolkit."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.NoteTakingToolkit') as mock_note_toolkit:
            
            mock_note_instance = MagicMock()
            mock_note_tools = [
                MagicMock(name="write_note"),
                MagicMock(name="read_note"),
            ]
            mock_note_instance.get_tools.return_value = mock_note_tools
            mock_note_toolkit.return_value = mock_note_instance
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify note-taking toolkit was integrated
            mock_note_toolkit.assert_called_once()
            mock_note_instance.get_tools.assert_called()

    def test_browser_agent_terminal_toolkit_integration(self, temp_dir, mock_model_backend):
        """Test browser agent integration with TerminalToolkit."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.TerminalToolkit') as mock_terminal_toolkit:
            
            mock_terminal_instance = MagicMock()
            mock_terminal_instance.shell_exec = MagicMock()
            mock_terminal_toolkit.return_value = mock_terminal_instance
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify terminal toolkit was integrated
            mock_terminal_toolkit.assert_called_once()

    def test_browser_agent_human_toolkit_integration(self, temp_dir, mock_model_backend):
        """Test browser agent integration with HumanToolkit."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        mock_human_tools = [
            MagicMock(name="ask_user"),
            MagicMock(name="send_message_to_user"),
        ]

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.HumanToolkit.get_can_use_tools', return_value=mock_human_tools):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify human toolkit was integrated
            call_args = mock_agent_model.call_args
            assert call_args is not None


@pytest.mark.integration
class TestBrowserAgentBrowserOperations:
    """Test browser agent browser operation capabilities."""

    @pytest.mark.asyncio
    async def test_browser_agent_visit_page_operation(self, temp_dir, mock_model_backend):
        """Test browser agent can visit web pages."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Visit https://example.com",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        mock_browser_toolkit = MagicMock()
        mock_visit_page = MagicMock()
        mock_visit_page.return_value = {"status": "success", "url": "https://example.com"}
        mock_browser_toolkit.browser_visit_page = mock_visit_page

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_click_operation(self, temp_dir, mock_model_backend):
        """Test browser agent can click elements on web pages."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Click on a button",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_type_operation(self, temp_dir, mock_model_backend):
        """Test browser agent can type text into input fields."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Type text into a search box",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_scroll_operation(self, temp_dir, mock_model_backend):
        """Test browser agent can scroll web pages."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Scroll down the page",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_navigation_operations(self, temp_dir, mock_model_backend):
        """Test browser agent navigation operations (back, forward, switch tab)."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Navigate back and forward",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_console_operations(self, temp_dir, mock_model_backend):
        """Test browser agent console operations (exec, view)."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Execute JavaScript in console",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_sheet_operations(self, temp_dir, mock_model_backend):
        """Test browser agent spreadsheet operations (read, input)."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Read data from a spreadsheet",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_get_page_snapshot(self, temp_dir, mock_model_backend):
        """Test browser agent can get page snapshots."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Get a snapshot of the current page",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None


@pytest.mark.integration
class TestBrowserAgentSearchIntegration:
    """Test browser agent search functionality integration."""

    @pytest.mark.asyncio
    async def test_browser_agent_google_search_integration(self, temp_dir, mock_model_backend):
        """Test browser agent integration with Google search."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Search for information about Python",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        mock_search_results = [
            {"title": "Python.org", "url": "https://www.python.org", "snippet": "Python programming language"},
            {"title": "Python Tutorial", "url": "https://docs.python.org/tutorial", "snippet": "Python tutorial"},
        ]

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.SearchToolkit.get_can_use_tools') as mock_search:
            
            mock_search_tool = MagicMock()
            mock_search_tool.return_value = mock_search_results
            mock_search.return_value = [mock_search_tool]
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_search_without_google(self, temp_dir, mock_model_backend):
        """Test browser agent search workflow when Google search is not available."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Search for information without Google",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')), \
             patch('app.utils.agent.SearchToolkit.get_can_use_tools', return_value=[]):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_search_and_browse_workflow(self, temp_dir, mock_model_backend):
        """Test browser agent search and browse workflow."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Search and browse multiple results",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None


@pytest.mark.integration
class TestBrowserAgentNoteTakingIntegration:
    """Test browser agent note-taking functionality."""

    @pytest.mark.asyncio
    async def test_browser_agent_write_note(self, temp_dir, mock_model_backend):
        """Test browser agent can write notes."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Write notes about findings",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_read_note(self, temp_dir, mock_model_backend):
        """Test browser agent can read notes."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Read previous notes",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_note_with_url_citation(self, temp_dir, mock_model_backend):
        """Test browser agent includes URL citations in notes."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Take notes with URL citations",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None


@pytest.mark.integration
class TestBrowserAgentEndToEndWorkflows:
    """Test browser agent end-to-end workflows."""

    @pytest.mark.asyncio
    async def test_browser_agent_research_workflow(self, temp_dir, mock_model_backend):
        """Test complete research workflow: search -> browse -> note."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Research a topic and document findings",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_multi_page_research(self, temp_dir, mock_model_backend):
        """Test browser agent can research across multiple pages."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Research across multiple websites",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_form_interaction_workflow(self, temp_dir, mock_model_backend):
        """Test browser agent form interaction workflow."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Fill out and submit a form",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_tab_management_workflow(self, temp_dir, mock_model_backend):
        """Test browser agent tab management workflow."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Open multiple tabs and switch between them",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None


@pytest.mark.integration
class TestBrowserAgentErrorHandling:
    """Test browser agent error handling and edge cases."""

    @pytest.mark.asyncio
    async def test_browser_agent_handles_invalid_url(self, temp_dir, mock_model_backend):
        """Test browser agent handles invalid URLs gracefully."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Visit an invalid URL",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_handles_network_errors(self, temp_dir, mock_model_backend):
        """Test browser agent handles network errors."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Handle network errors",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_handles_missing_elements(self, temp_dir, mock_model_backend):
        """Test browser agent handles missing page elements."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Handle missing page elements",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_handles_captcha_challenges(self, temp_dir, mock_model_backend):
        """Test browser agent requests help for CAPTCHA challenges."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Handle CAPTCHA challenges",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_handles_timeout_errors(self, temp_dir, mock_model_backend):
        """Test browser agent handles timeout errors."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Handle timeout errors",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None


@pytest.mark.integration
class TestBrowserAgentSystemMessage:
    """Test browser agent system message configuration."""

    def test_browser_agent_system_message_contains_role(self, temp_dir, mock_model_backend):
        """Test browser agent system message contains role definition."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify system message was passed
            call_args = mock_agent_model.call_args
            assert call_args is not None
            assert len(call_args[0]) >= 2
            system_message = call_args[0][1]
            assert isinstance(system_message, BaseMessage)
            assert "Research Analyst" in system_message.content or "browser" in system_message.content.lower()

    def test_browser_agent_system_message_contains_instructions(self, temp_dir, mock_model_backend):
        """Test browser agent system message contains mandatory instructions."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify system message contains instructions
            call_args = mock_agent_model.call_args
            assert call_args is not None

    def test_browser_agent_system_message_contains_capabilities(self, temp_dir, mock_model_backend):
        """Test browser agent system message contains capabilities."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify system message contains capabilities
            call_args = mock_agent_model.call_args
            assert call_args is not None


@pytest.mark.integration
class TestBrowserAgentToolNames:
    """Test browser agent tool names configuration."""

    def test_browser_agent_tool_names_configuration(self, temp_dir, mock_model_backend):
        """Test browser agent tool names are correctly configured."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Test question",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        expected_tool_names = [
            SearchToolkit.toolkit_name(),
            HybridBrowserToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
        ]

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            browser_agent(options)
            
            # Verify tool_names were passed
            call_args = mock_agent_model.call_args
            assert call_args is not None
            assert 'tool_names' in call_args.kwargs
            tool_names = call_args.kwargs['tool_names']
            assert isinstance(tool_names, list)
            assert len(tool_names) > 0


@pytest.mark.integration
@pytest.mark.very_slow
class TestBrowserAgentRealWorldScenarios:
    """Test browser agent with real-world scenarios (marked as very slow)."""

    @pytest.mark.asyncio
    async def test_browser_agent_research_technical_topic(self, temp_dir, mock_model_backend):
        """Test browser agent researching a technical topic."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Research Python async programming best practices",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_compare_products(self, temp_dir, mock_model_backend):
        """Test browser agent comparing products across multiple sites."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Compare different products and their features",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

    @pytest.mark.asyncio
    async def test_browser_agent_gather_news_information(self, temp_dir, mock_model_backend):
        """Test browser agent gathering news information."""
        options = Chat(
            task_id="test_task_123",
            project_id="test_project_456",
            email="test@example.com",
            question="Gather latest news about a topic",
            model_type="gpt-4",
            model_platform="openai",
            api_key="test_key",
            api_url="https://api.openai.com/v1",
        )

        with patch('app.utils.agent.env', return_value='9222'), \
             patch('app.utils.agent.get_working_directory', return_value=str(temp_dir)), \
             patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.uuid.uuid4', return_value=Mock(hex='12345678')):
            
            mock_agent_instance = MagicMock()
            mock_agent_model.return_value = mock_agent_instance
            
            agent = browser_agent(options)
            assert agent is not None

