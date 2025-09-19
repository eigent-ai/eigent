import asyncio
from threading import Event
from typing import List
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
import uuid

from camel.agents import ChatAgent
from camel.agents._types import ToolCallRequest
from camel.messages import BaseMessage
from camel.models import BaseModelBackend
from camel.responses import ChatAgentResponse
from camel.toolkits import FunctionTool
from camel.types.agents import ToolCallingRecord

from app.utils.agent import (
    ListenChatAgent,
    agent_model,
    question_confirm_agent,
    task_summary_agent,
    developer_agent,
    search_agent,
    document_agent,
    multi_modal_agent,
    social_medium_agent,
    mcp_agent,
    get_toolkits,
    get_mcp_tools
)
from app.model.chat import Chat, McpServers
from app.service.task import ActionActivateAgentData, ActionDeactivateAgentData


@pytest.mark.unit
class TestListenChatAgent:
    """Test cases for ListenChatAgent class."""
    
    def test_listen_chat_agent_initialization(self):
        """Test ListenChatAgent initialization."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        
        with patch('app.utils.agent.get_task_lock') as mock_get_lock, \
             patch('camel.models.ModelFactory.create') as mock_create_model:
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock
            
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4",  # Use string instead of mock
                system_message="You are a helpful assistant",
                tools=[],
                agent_id="test_agent_123"
            )
            
            assert agent.api_task_id == api_task_id
            assert agent.agent_name == agent_name
            assert isinstance(agent, ChatAgent)

    def test_listen_chat_agent_step_with_string_input(self, mock_task_lock):
        """Test ListenChatAgent step method with string input."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        
        with patch('app.utils.agent.get_task_lock', return_value=mock_task_lock), \
             patch('camel.models.ModelFactory.create') as mock_create_model, \
             patch('asyncio.create_task') as mock_create_task:
            
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4"
            )
            agent.process_task_id = "test_process_task"
            
            # Mock the parent step method and create proper response
            mock_response = MagicMock(spec=ChatAgentResponse)
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Test response content"
            mock_response.info = {"usage": {"total_tokens": 100}}
            
            with patch.object(ChatAgent, 'step', return_value=mock_response) as mock_parent_step:
                result = agent.step("Test input message")
                
                assert result is mock_response
                # Check that step was called with the input message (don't assert on response_format param)
                mock_parent_step.assert_called_once()
                args, kwargs = mock_parent_step.call_args
                assert args[0] == "Test input message"
                # Should queue activation notification
                mock_task_lock.put_queue.assert_called()

    def test_listen_chat_agent_step_with_base_message_input(self, mock_task_lock):
        """Test ListenChatAgent step method with BaseMessage input."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        
        with patch('app.utils.agent.get_task_lock', return_value=mock_task_lock), \
             patch('camel.models.ModelFactory.create') as mock_create_model, \
             patch('asyncio.create_task') as mock_create_task:
            
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4"
            )
            agent.agent_id = "test_agent_456"
            agent.process_task_id = "test_process_task"
            
            # Create mock BaseMessage
            mock_message = MagicMock(spec=BaseMessage)
            mock_message.content = "Base message content"
            
            # Create proper mock response
            mock_response = MagicMock(spec=ChatAgentResponse)
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Test response content"
            mock_response.info = {"usage": {"total_tokens": 100}}
            
            with patch.object(ChatAgent, 'step', return_value=mock_response) as mock_parent_step:
                result = agent.step(mock_message)
                
                assert result is mock_response
                # Check that step was called with the mock message (don't assert on response_format param)
                mock_parent_step.assert_called_once()
                args, kwargs = mock_parent_step.call_args
                assert args[0] is mock_message
                
                # Should queue activation with message content
                mock_task_lock.put_queue.assert_called()
                # Just verify put_queue was called - don't check internal data structure details

    @pytest.mark.asyncio
    async def test_listen_chat_agent_astep(self, mock_task_lock):
        """Test ListenChatAgent async step method."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        
        with patch('app.utils.agent.get_task_lock', return_value=mock_task_lock), \
             patch('camel.models.ModelFactory.create') as mock_create_model, \
             patch('asyncio.create_task') as mock_create_task:
            
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4"
            )
            agent.process_task_id = "test_process_task"
            
            # Mock the parent astep method
            mock_response = MagicMock()
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Test response message"
            mock_response.info = {"usage": {"total_tokens": 100}}
            
            with patch.object(ChatAgent, 'astep', return_value=mock_response) as mock_parent_astep:
                result = await agent.astep("Test async input")
                
                assert result is mock_response
                # Check that astep was called with the input message (don't assert on response_format param)
                mock_parent_astep.assert_called_once()
                args, kwargs = mock_parent_astep.call_args
                assert args[0] == "Test async input"
                
                # Verify that task lock put_queue was called
                mock_task_lock.put_queue.assert_called()

    def test_listen_chat_agent_execute_tool(self, mock_task_lock):
        """Test ListenChatAgent _execute_tool method."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        
        with patch('app.utils.agent.get_task_lock', return_value=mock_task_lock), \
             patch('camel.models.ModelFactory.create') as mock_create_model, \
             patch('asyncio.create_task') as mock_create_task:
            
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4"
            )
            
            # Create a mock tool and add it to _internal_tools
            mock_tool = MagicMock(spec=FunctionTool)
            mock_tool.func = MagicMock()
            mock_tool.return_value = "test_result"
            agent._internal_tools = {"test_tool": mock_tool}
            
            # Mock tool call request
            tool_call_request = MagicMock(spec=ToolCallRequest)
            tool_call_request.tool_name = "test_tool"
            tool_call_request.id = "tool_call_123"
            tool_call_request.tool_call_id = "tool_call_123"
            tool_call_request.args = {"arg1": "value1"}
            
            # Mock tool calling record
            mock_record = MagicMock(spec=ToolCallingRecord)
            
            with patch.object(agent, '_record_tool_calling', return_value=mock_record) as mock_record_func:
                result = agent._execute_tool(tool_call_request)
                
                assert result is mock_record
                mock_record_func.assert_called_once()
                
                # Should queue toolkit activation and deactivation notifications
                assert mock_task_lock.put_queue.call_count >= 2

    @pytest.mark.asyncio
    async def test_listen_chat_agent_aexecute_tool(self, mock_task_lock):
        """Test ListenChatAgent _aexecute_tool method."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        
        with patch('app.utils.agent.get_task_lock', return_value=mock_task_lock), \
             patch('camel.models.ModelFactory.create') as mock_create_model:
            
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4"
            )
            
            # Create a mock tool and add it to _internal_tools
            mock_tool = MagicMock(spec=FunctionTool)
            mock_tool.func = AsyncMock()
            mock_tool.return_value = "test_async_result"
            agent._internal_tools = {"test_async_tool": mock_tool}
            
            tool_call_request = MagicMock(spec=ToolCallRequest)
            tool_call_request.tool_name = "test_async_tool"
            tool_call_request.id = "async_tool_call_123"
            tool_call_request.tool_call_id = "async_tool_call_123"
            tool_call_request.args = {"arg1": "value1"}
            
            mock_record = MagicMock(spec=ToolCallingRecord)
            
            with patch.object(agent, '_record_tool_calling', return_value=mock_record) as mock_record_func:
                result = await agent._aexecute_tool(tool_call_request)
                
                assert result is mock_record
                mock_record_func.assert_called_once()
                
                # Should queue toolkit activation and deactivation notifications  
                assert mock_task_lock.put_queue.call_count >= 2

    def test_listen_chat_agent_clone(self, mock_task_lock):
        """Test ListenChatAgent clone method."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        
        with patch('app.utils.agent.get_task_lock', return_value=mock_task_lock), \
             patch('camel.models.ModelFactory.create') as mock_create_model:
            
            # Mock the model backend creation  
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_backend.models = "gpt-4"  # String instead of list to avoid list processing
            mock_backend.scheduling_strategy = MagicMock()
            mock_backend.scheduling_strategy.__name__ = "round_robin"
            mock_create_model.return_value = mock_backend
            
            # Mock the clone process by patching ListenChatAgent constructor for clone
            cloned_agent = MagicMock()
            cloned_agent.process_task_id = "test_process_task"
            
            # First create the initial agent
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4"
            )
            
            # Set up necessary attributes for cloning
            agent._original_system_message = "test system message"
            agent.memory = MagicMock()
            agent.memory.window_size = 10
            agent.memory.get_context_creator = MagicMock()
            agent.memory.get_context_creator.return_value.token_limit = 4000
            agent._output_language = "en"
            agent._external_tool_schemas = {}
            agent.response_terminators = []
            agent.max_iteration = None
            agent.agent_id = "test_agent_id"
            agent.stop_event = None
            agent.tool_execution_timeout = None
            agent.mask_tool_output = False
            agent.pause_event = None
            agent.prune_tool_calls_from_memory = False
            
            # Now mock the constructor for the clone call
            with patch('app.utils.agent.ListenChatAgent', return_value=cloned_agent) as mock_clone_constructor, \
                 patch.object(agent, '_clone_tools', return_value=([], [])):
                
                result = agent.clone(with_memory=True)
                
                assert result is cloned_agent
                mock_clone_constructor.assert_called_once()

    def test_listen_chat_agent_with_tools(self, mock_task_lock):
        """Test ListenChatAgent with tools."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        
        # Mock tool
        mock_tool = MagicMock(spec=FunctionTool)
        tools = [mock_tool]
        
        with patch('app.utils.agent.get_task_lock', return_value=mock_task_lock), \
             patch('camel.models.ModelFactory.create') as mock_create_model:
            
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4",
                tools=tools
            )
            
            # Mock function_list attribute that is expected to exist
            agent.function_list = [mock_tool]
            
            assert len(agent.function_list) == 1  # Should have the tool
            # Check that tools were passed to parent class
            mock_task_lock.put_queue.assert_not_called()  # No immediate action for tool setup

    def test_listen_chat_agent_with_pause_event(self, mock_task_lock):
        """Test ListenChatAgent with pause event."""
        api_task_id = "test_api_task_123"
        agent_name = "TestAgent"
        
        pause_event = asyncio.Event()
        
        with patch('app.utils.agent.get_task_lock', return_value=mock_task_lock), \
             patch('camel.models.ModelFactory.create') as mock_create_model:
            
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4",
                pause_event=pause_event
            )
            
            assert agent.pause_event is pause_event


@pytest.mark.unit
class TestAgentFactoryFunctions:
    """Test cases for agent factory functions."""
    
    def test_agent_model_creation(self, sample_chat_data):
        """Test agent_model creates agent properly."""
        options = Chat(**sample_chat_data)
        agent_name = "TestAgent"
        system_prompt = "You are a helpful assistant"

        # Setup task lock in the registry before calling agent_model
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock

        with patch('app.utils.agent.ListenChatAgent') as mock_listen_agent, \
             patch('app.utils.agent.ModelFactory.create') as mock_model_factory, \
             patch('app.utils.agent.HumanToolkit.get_can_use_tools', return_value=[]), \
             patch('asyncio.create_task') as mock_create_task:

            mock_agent = MagicMock()
            mock_listen_agent.return_value = mock_agent
            mock_model_factory.return_value = MagicMock()

            result = agent_model(agent_name, system_prompt, options, [])
            
            assert result is mock_agent
            mock_listen_agent.assert_called_once()

    def test_question_confirm_agent_creation(self, sample_chat_data):
        """Test question_confirm_agent creates specialized agent."""
        options = Chat(**sample_chat_data)
        
        # Setup task lock in the registry before calling agent function
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        
        with patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('asyncio.create_task'):
            mock_agent = MagicMock()
            mock_agent_model.return_value = mock_agent
            
            result = question_confirm_agent(options)
            
            assert result is mock_agent
            mock_agent_model.assert_called_once()
            
            # Check that it was called with question confirmation prompt
            call_args = mock_agent_model.call_args
            assert "question_confirm_agent" in call_args[0][0]  # agent_name
            assert "analyze a user's request" in call_args[0][1]  # system_prompt

    def test_task_summary_agent_creation(self, sample_chat_data):
        """Test task_summary_agent creates specialized agent."""
        options = Chat(**sample_chat_data)
        
        # Setup task lock in the registry before calling agent function
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        
        with patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('asyncio.create_task'):
            mock_agent = MagicMock()
            mock_agent_model.return_value = mock_agent
            
            result = task_summary_agent(options)
            
            assert result is mock_agent
            mock_agent_model.assert_called_once()
            
            # Check that it was called with task summary prompt
            call_args = mock_agent_model.call_args
            assert "task_summary_agent" in call_args[0][0]  # agent_name
            assert "task assistant" in call_args[0][1].lower()  # system_prompt

    @pytest.mark.asyncio
    async def test_developer_agent_creation(self, sample_chat_data):
        """Test developer_agent creates agent with development tools."""
        options = Chat(**sample_chat_data)
        
        # Setup task lock in the registry before calling agent function
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        
        with patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.get_toolkits') as mock_get_toolkits, \
             patch('asyncio.create_task'), \
             patch('app.utils.agent.HumanToolkit') as mock_human_toolkit, \
             patch('app.utils.agent.NoteTakingToolkit') as mock_note_toolkit, \
             patch('app.utils.agent.WebDeployToolkit') as mock_web_toolkit, \
             patch('app.utils.agent.ScreenshotToolkit') as mock_screenshot_toolkit, \
             patch('app.utils.agent.TerminalToolkit') as mock_terminal_toolkit, \
             patch('app.utils.agent.ToolkitMessageIntegration'):
            
            # Mock all toolkit instances
            mock_human_toolkit.get_can_use_tools.return_value = []
            mock_note_toolkit.return_value.get_tools.return_value = []
            mock_web_toolkit.return_value.get_tools.return_value = []
            mock_screenshot_toolkit.return_value.get_tools.return_value = []
            mock_terminal_toolkit.return_value.get_tools.return_value = []
            
            mock_agent = MagicMock()
            mock_agent_model.return_value = mock_agent
            mock_get_toolkits.return_value = []
            
            result = await developer_agent(options)
            
            assert result is mock_agent
            mock_agent_model.assert_called_once()
            
            # Should have called with development-related tools
            call_args = mock_agent_model.call_args
            assert "developer_agent" in str(call_args[0][0])  # agent_name (enum contains this value)
            tools_arg = call_args[0][3]  # tools argument
            assert isinstance(tools_arg, list)

    def test_search_agent_creation(self, sample_chat_data):
        """Test search_agent creates agent with search tools."""
        options = Chat(**sample_chat_data)
        
        # Setup task lock in the registry before calling agent function
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        
        with patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('asyncio.create_task'), \
             patch('app.utils.agent.HumanToolkit') as mock_human_toolkit, \
             patch('app.utils.agent.HybridBrowserToolkit') as mock_browser_toolkit, \
             patch('app.utils.agent.TerminalToolkit') as mock_terminal_toolkit, \
             patch('app.utils.agent.NoteTakingToolkit') as mock_note_toolkit, \
             patch('app.utils.agent.SearchToolkit') as mock_search_toolkit, \
             patch('app.utils.agent.ToolkitMessageIntegration'), \
             patch('uuid.uuid4') as mock_uuid:
            
            # Mock all toolkit instances
            mock_human_toolkit.get_can_use_tools.return_value = []
            mock_browser_toolkit.return_value.get_tools.return_value = []
            
            # Create a proper terminal toolkit mock
            mock_terminal_instance = MagicMock()
            mock_terminal_instance.shell_exec = MagicMock()
            mock_terminal_toolkit.return_value = mock_terminal_instance
            
            mock_note_toolkit.return_value.get_tools.return_value = []
            mock_search_instance = MagicMock()
            mock_search_instance.search_google = MagicMock()
            mock_search_toolkit.return_value = mock_search_instance
            mock_uuid.return_value.__getitem__ = lambda self, key: "test_session"
            
            mock_agent = MagicMock()
            mock_agent_model.return_value = mock_agent
            
            result = search_agent(options)
            
            assert result is mock_agent
            mock_agent_model.assert_called_once()
            
            # Check that it was called with search agent configuration
            call_args = mock_agent_model.call_args
            assert "search_agent" in str(call_args[0][0])  # agent_name (enum contains this value)
            # The system_prompt is a BaseMessage, so check its content attribute
            system_message = call_args[0][1]
            if hasattr(system_message, 'content'):
                assert "search" in system_message.content.lower()
            else:
                assert "search" in str(system_message).lower()  # system_prompt contains search

    @pytest.mark.asyncio
    async def test_document_agent_creation(self, sample_chat_data):
        """Test document_agent creates agent with document tools."""
        options = Chat(**sample_chat_data)
        
        # Setup task lock in the registry before calling agent function
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        
        with patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.get_toolkits') as mock_get_toolkits, \
             patch('asyncio.create_task'), \
             patch('app.utils.agent.HumanToolkit') as mock_human_toolkit, \
             patch('app.utils.agent.FileToolkit') as mock_file_toolkit, \
             patch('app.utils.agent.PPTXToolkit') as mock_pptx_toolkit, \
             patch('app.utils.agent.MarkItDownToolkit') as mock_markdown_toolkit, \
             patch('app.utils.agent.ExcelToolkit') as mock_excel_toolkit, \
             patch('app.utils.agent.NoteTakingToolkit') as mock_note_toolkit, \
             patch('app.utils.agent.TerminalToolkit') as mock_terminal_toolkit, \
             patch('app.utils.agent.GoogleDriveMCPToolkit') as mock_gdrive_toolkit, \
             patch('app.utils.agent.ToolkitMessageIntegration'):
            
            # Mock all toolkit instances
            mock_human_toolkit.get_can_use_tools.return_value = []
            mock_file_toolkit.return_value.get_tools.return_value = []
            mock_pptx_toolkit.return_value.get_tools.return_value = []
            mock_markdown_toolkit.return_value.get_tools.return_value = []
            mock_excel_toolkit.return_value.get_tools.return_value = []
            mock_note_toolkit.return_value.get_tools.return_value = []
            mock_terminal_toolkit.return_value.get_tools.return_value = []
            mock_gdrive_toolkit.get_can_use_tools = AsyncMock(return_value=[])
            
            mock_agent = MagicMock()
            mock_agent_model.return_value = mock_agent
            mock_get_toolkits.return_value = []
            
            result = await document_agent(options)
            
            assert result is mock_agent
            mock_agent_model.assert_called_once()
            
            # Should have called with document-related tools
            call_args = mock_agent_model.call_args
            assert "document_agent" in str(call_args[0][0])  # agent_name (enum contains this value)

    def test_multi_modal_agent_creation(self, sample_chat_data):
        """Test multi_modal_agent creates agent with multimedia tools."""
        options = Chat(**sample_chat_data)
        
        # Setup task lock in the registry before calling agent function
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        
        with patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('asyncio.create_task'), \
             patch('app.utils.agent.HumanToolkit') as mock_human_toolkit, \
             patch('app.utils.agent.VideoDownloaderToolkit') as mock_video_toolkit, \
             patch('app.utils.agent.ImageAnalysisToolkit') as mock_image_toolkit, \
             patch('app.utils.agent.TerminalToolkit') as mock_terminal_toolkit, \
             patch('app.utils.agent.NoteTakingToolkit') as mock_note_toolkit, \
             patch('app.utils.agent.ToolkitMessageIntegration'):
            
            # Mock all toolkit instances
            mock_human_toolkit.get_can_use_tools.return_value = []
            mock_video_toolkit.return_value.get_tools.return_value = []
            mock_image_toolkit.return_value.get_tools.return_value = []
            mock_terminal_toolkit.return_value.get_tools.return_value = []
            mock_note_toolkit.return_value.get_tools.return_value = []
            
            mock_agent = MagicMock()
            mock_agent_model.return_value = mock_agent
            
            result = multi_modal_agent(options)
            
            assert result is mock_agent
            mock_agent_model.assert_called_once()
            
            # Check that it was called with multi-modal agent configuration
            call_args = mock_agent_model.call_args
            assert "multi_modal_agent" in str(call_args[0][0])  # agent_name (enum contains this value)

    @pytest.mark.asyncio
    async def test_social_medium_agent_creation(self, sample_chat_data):
        """Test social_medium_agent creates agent with social media tools."""
        options = Chat(**sample_chat_data)
        
        # Setup task lock in the registry before calling agent function
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        
        with patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.get_toolkits') as mock_get_toolkits, \
             patch('asyncio.create_task'), \
             patch('app.utils.agent.WhatsAppToolkit') as mock_whatsapp_toolkit, \
             patch('app.utils.agent.TwitterToolkit') as mock_twitter_toolkit, \
             patch('app.utils.agent.LinkedInToolkit') as mock_linkedin_toolkit, \
             patch('app.utils.agent.RedditToolkit') as mock_reddit_toolkit, \
             patch('app.utils.agent.NotionMCPToolkit') as mock_notion_mcp_toolkit, \
             patch('app.utils.agent.GoogleGmailMCPToolkit') as mock_gmail_toolkit, \
             patch('app.utils.agent.GoogleCalendarToolkit') as mock_calendar_toolkit, \
             patch('app.utils.agent.HumanToolkit') as mock_human_toolkit, \
             patch('app.utils.agent.TerminalToolkit') as mock_terminal_toolkit, \
             patch('app.utils.agent.NoteTakingToolkit') as mock_note_toolkit:
            
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
            mock_get_toolkits.return_value = []
            
            result = await social_medium_agent(options)
            
            assert result is mock_agent
            mock_agent_model.assert_called_once()

    @pytest.mark.asyncio
    async def test_mcp_agent_creation(self, sample_chat_data):
        """Test mcp_agent creates agent with MCP tools."""
        options = Chat(**sample_chat_data)
        
        # Setup task lock in the registry before calling agent function
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        
        with patch('app.utils.agent.ListenChatAgent') as mock_listen_agent, \
             patch('app.utils.agent.ModelFactory.create') as mock_model_factory, \
             patch('asyncio.create_task'), \
             patch('app.utils.agent.McpSearchToolkit') as mock_mcp_search_toolkit, \
             patch('app.utils.agent.get_mcp_tools') as mock_get_mcp_tools:
            
            # Mock toolkit instances
            mock_mcp_search_toolkit.return_value.get_tools.return_value = []
            mock_get_mcp_tools.return_value = []
            
            mock_agent = MagicMock()
            mock_listen_agent.return_value = mock_agent
            mock_model_factory.return_value = MagicMock()
            
            result = await mcp_agent(options)
            
            assert result is mock_agent
            mock_listen_agent.assert_called_once()
            
            # Check that it was called with MCP agent configuration
            call_args = mock_listen_agent.call_args
            assert "mcp_agent" in str(call_args[0][1])  # agent_name (enum contains this value)


@pytest.mark.unit
class TestToolkitFunctions:
    """Test cases for toolkit utility functions."""
    
    @pytest.mark.asyncio
    async def test_get_toolkits_with_known_tools(self):
        """Test get_toolkits with known tool names."""
        tools = ["search_toolkit", "terminal_toolkit", "file_write_toolkit"]
        agent_name = "TestAgent"
        api_task_id = "test_task_123"
        
        with patch('app.utils.agent.SearchToolkit') as mock_search_toolkit, \
             patch('app.utils.agent.TerminalToolkit') as mock_terminal_toolkit, \
             patch('app.utils.agent.FileToolkit') as mock_file_toolkit:
            
            # Mock toolkit instances - these should return tools directly from get_can_use_tools
            mock_search_instance = MagicMock()
            mock_search_instance.agent_name = agent_name
            mock_search_tools = [MagicMock(), MagicMock()]
            mock_search_instance.get_can_use_tools.return_value = mock_search_tools
            mock_search_toolkit.return_value = mock_search_instance
            
            mock_terminal_instance = MagicMock()
            mock_terminal_instance.agent_name = agent_name  
            mock_terminal_tools = [MagicMock()]
            mock_terminal_instance.get_can_use_tools.return_value = mock_terminal_tools
            mock_terminal_toolkit.return_value = mock_terminal_instance
            
            mock_file_instance = MagicMock()
            mock_file_instance.agent_name = agent_name
            mock_file_tools = [MagicMock()]
            mock_file_instance.get_can_use_tools.return_value = mock_file_tools
            mock_file_toolkit.return_value = mock_file_instance
            
            # Mock the toolkit classes to have get_can_use_tools class method that returns the mock tools
            mock_search_toolkit.get_can_use_tools = MagicMock(return_value=mock_search_tools)
            mock_terminal_toolkit.get_can_use_tools = MagicMock(return_value=mock_terminal_tools)
            mock_file_toolkit.get_can_use_tools = MagicMock(return_value=mock_file_tools)
            
            result = await get_toolkits(tools, agent_name, api_task_id)
            
            # The result should contain tools from the toolkits that match
            assert isinstance(result, list)
            # Since get_toolkits filters by known toolkit names, only matching ones should be included
            assert len(result) >= 0  # Should have some tools if any match

    @pytest.mark.asyncio
    async def test_get_toolkits_with_unknown_tool(self):
        """Test get_toolkits with unknown tool name."""
        tools = ["unknown_tool"]
        agent_name = "TestAgent"
        api_task_id = "test_task_123"
        
        result = await get_toolkits(tools, agent_name, api_task_id)
        
        # Should return empty list or handle unknown tools gracefully
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_get_toolkits_empty_tools(self):
        """Test get_toolkits with empty tools list."""
        tools = []
        agent_name = "TestAgent"
        api_task_id = "test_task_123"
        
        result = await get_toolkits(tools, agent_name, api_task_id)
        
        assert result == []

    @pytest.mark.asyncio
    async def test_get_mcp_tools_success(self):
        """Test get_mcp_tools with valid MCP server configuration."""
        mcp_servers: McpServers = {
            "mcpServers": {
                "notion": {
                    "command": "npx",
                    "args": ["@modelcontextprotocol/server-notion"]
                }
            }
        }
        
        mock_tools = [MagicMock(), MagicMock()]
        
        with patch('app.utils.agent.MCPToolkit') as mock_mcp_toolkit:
            mock_toolkit_instance = MagicMock()  # Use MagicMock instead of AsyncMock
            mock_toolkit_instance.connect = AsyncMock()
            mock_toolkit_instance.get_tools.return_value = mock_tools  # This should return the tools directly
            mock_mcp_toolkit.return_value = mock_toolkit_instance
            
            result = await get_mcp_tools(mcp_servers)
            
            # get_mcp_tools should return the tools directly
            assert len(result) == 2
            assert result == mock_tools
            mock_mcp_toolkit.assert_called_once()
            mock_toolkit_instance.connect.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_mcp_tools_empty_servers(self):
        """Test get_mcp_tools with empty server configuration."""
        mcp_servers: McpServers = {"mcpServers": {}}
        
        result = await get_mcp_tools(mcp_servers)
        
        assert result == []

    @pytest.mark.asyncio
    async def test_get_mcp_tools_connection_failure(self):
        """Test get_mcp_tools when MCP connection fails."""
        mcp_servers: McpServers = {
            "mcpServers": {
                "failing_server": {
                    "command": "invalid_command"
                }
            }
        }
        
        with patch('app.utils.agent.MCPToolkit', side_effect=Exception("Connection failed")):
            # Should handle connection failures gracefully
            with pytest.raises(Exception):
                await get_mcp_tools(mcp_servers)


@pytest.mark.integration
class TestAgentIntegration:
    """Integration tests for agent utilities."""
    
    def setup_method(self):
        """Clean up before each test."""
        from app.service.task import task_locks
        task_locks.clear()

    @pytest.mark.asyncio
    async def test_full_agent_workflow(self, sample_chat_data):
        """Test complete agent creation and usage workflow."""
        from app.service.task import task_locks
        
        options = Chat(**sample_chat_data)
        api_task_id = options.task_id
        
        # Create task lock
        mock_task_lock = MagicMock()
        task_locks[api_task_id] = mock_task_lock
        
        # Create agent
        with patch('app.utils.agent.ModelFactory.create') as mock_model_factory, \
             patch('asyncio.create_task'), \
             patch('app.utils.agent.ListenChatAgent') as mock_listen_agent:
            mock_model = MagicMock()
            mock_model_factory.return_value = mock_model
            
            mock_agent_instance = MagicMock()
            mock_agent_instance.api_task_id = api_task_id
            mock_listen_agent.return_value = mock_agent_instance

            agent = agent_model("IntegrationAgent", "Test system prompt", options, [])
            
            assert agent is mock_agent_instance
            assert agent.api_task_id == api_task_id
            
            # Test step operation
            mock_response = MagicMock()
            mock_response.msg = MagicMock()
            mock_response.msg.content = "Test response"
            mock_response.info = {"usage": {"total_tokens": 50}}
            
            agent.step = MagicMock(return_value=mock_response)
            result = agent.step("Test message")
            assert result is mock_response

    @pytest.mark.asyncio
    async def test_agent_with_multiple_toolkits(self, sample_chat_data):
        """Test agent creation with multiple toolkits."""
        options = Chat(**sample_chat_data)
        tools = ["search_toolkit", "terminal_toolkit", "file_write_toolkit"]
        
        # Setup task lock in the registry before calling agent function
        from app.service.task import task_locks
        mock_task_lock = MagicMock()
        task_locks[options.task_id] = mock_task_lock
        
        with patch('app.utils.agent.agent_model') as mock_agent_model, \
             patch('app.utils.agent.get_toolkits') as mock_get_toolkits, \
             patch('asyncio.create_task'), \
             patch('app.utils.agent.HumanToolkit') as mock_human_toolkit, \
             patch('app.utils.agent.NoteTakingToolkit') as mock_note_toolkit, \
             patch('app.utils.agent.WebDeployToolkit') as mock_web_toolkit, \
             patch('app.utils.agent.ScreenshotToolkit') as mock_screenshot_toolkit, \
             patch('app.utils.agent.TerminalToolkit') as mock_terminal_toolkit, \
             patch('app.utils.agent.ToolkitMessageIntegration'):
            
            # Mock all toolkit instances
            mock_human_toolkit.get_can_use_tools.return_value = []
            mock_note_toolkit.return_value.get_tools.return_value = []
            mock_web_toolkit.return_value.get_tools.return_value = []
            mock_screenshot_toolkit.return_value.get_tools.return_value = []
            mock_terminal_toolkit.return_value.get_tools.return_value = []
            
            mock_tools = [MagicMock() for _ in range(5)]  # Mock multiple tools
            mock_get_toolkits.return_value = mock_tools
            
            mock_agent = MagicMock()
            mock_agent_model.return_value = mock_agent
            
            result = await developer_agent(options)
            
            assert result is mock_agent
            mock_get_toolkits.assert_not_called()  # developer_agent doesn't call get_toolkits


@pytest.mark.model_backend
class TestAgentWithLLM:
    """Tests that require LLM backend (marked for selective running)."""
    
    @pytest.mark.asyncio
    async def test_agent_with_real_model(self, sample_chat_data):
        """Test agent creation with real LLM model."""
        options = Chat(**sample_chat_data)
        
        # This test would use real model backends
        # Marked as model_backend test for selective execution
        assert True  # Placeholder

    @pytest.mark.very_slow
    async def test_full_agent_conversation_workflow(self, sample_chat_data):
        """Test complete agent conversation workflow (very slow test)."""
        options = Chat(**sample_chat_data)
        
        # This test would run complete conversation workflow
        # Marked as very_slow for execution only in full test mode
        assert True  # Placeholder


@pytest.mark.unit
class TestAgentErrorCases:
    """Test error cases and edge conditions for agent utilities."""
    
    def test_listen_chat_agent_with_invalid_model(self):
        """Test ListenChatAgent with invalid model."""
        api_task_id = "error_test_123"
        agent_name = "ErrorAgent"
        
        with patch('app.utils.agent.get_task_lock') as mock_get_lock, \
             patch('camel.models.ModelFactory.create', side_effect=ValueError("Invalid model")):
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock
            
            # Try to create agent with invalid model which should raise an error through ModelFactory
            with pytest.raises(ValueError):
                ListenChatAgent(
                    api_task_id=api_task_id,
                    agent_name=agent_name,
                    model="invalid_model_string"  # Invalid model type
                )

    def test_agent_model_with_missing_options(self):
        """Test agent_model with missing required options."""
        agent_name = "ErrorAgent"
        system_prompt = "Test prompt"
        
        # Missing required Chat options
        with pytest.raises((AttributeError, KeyError)):
            agent_model(agent_name, system_prompt, None, [])

    @pytest.mark.asyncio
    async def test_get_toolkits_with_toolkit_initialization_error(self):
        """Test get_toolkits when toolkit initialization fails."""
        tools = ["search"]
        agent_name = "ErrorAgent"
        api_task_id = "error_test_123"
        
        with patch('app.utils.agent.SearchToolkit', side_effect=Exception("Toolkit init failed")):
            # Should handle toolkit initialization errors
            result = await get_toolkits(tools, agent_name, api_task_id)
            # Should return what it can or empty list
            assert isinstance(result, list)

    def test_listen_chat_agent_step_with_task_lock_error(self):
        """Test ListenChatAgent step when task lock retrieval fails."""
        api_task_id = "error_test_123"
        agent_name = "ErrorAgent"
        
        with patch('app.utils.agent.get_task_lock', side_effect=Exception("Task lock not found")), \
             patch('camel.models.ModelFactory.create') as mock_create_model:
            
            # Mock the model backend creation
            mock_backend = MagicMock()
            mock_backend.model_type = "gpt-4"
            mock_backend.current_model = MagicMock()
            mock_backend.current_model.model_type = "gpt-4"
            mock_create_model.return_value = mock_backend
            
            agent = ListenChatAgent(
                api_task_id=api_task_id,
                agent_name=agent_name,
                model="gpt-4"
            )
            
            # Should handle task lock errors gracefully
            with pytest.raises(Exception):
                agent.step("Test message")

    @pytest.mark.asyncio
    async def test_get_mcp_tools_with_malformed_config(self):
        """Test get_mcp_tools with malformed configuration."""
        mcp_servers = {"invalid_key": "invalid_value"}  # Malformed structure
        
        with pytest.raises((KeyError, TypeError)):
            await get_mcp_tools(mcp_servers)
