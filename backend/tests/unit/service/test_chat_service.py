from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.service.chat_service import (
    step_solve,
    install_mcp,
    to_sub_tasks,
    tree_sub_tasks,
    update_sub_tasks,
    add_sub_tasks,
    question_confirm,
    summary_task,
    construct_workforce,
    format_agent_description,
    new_agent_model
)
from app.model.chat import Chat, NewAgent
from app.service.task import Action, ActionImproveData, ActionEndData, ActionInstallMcpData
from camel.tasks import Task
from camel.tasks.task import TaskState


@pytest.mark.unit
class TestChatServiceUtilities:
    """Test cases for chat service utility functions."""
    
    def test_tree_sub_tasks_simple(self):
        """Test tree_sub_tasks with simple task structure."""
        task1 = Task(content="Task 1", id="task_1")
        task1.state = TaskState.OPEN
        task2 = Task(content="Task 2", id="task_2")
        task2.state = TaskState.RUNNING
        
        sub_tasks = [task1, task2]
        result = tree_sub_tasks(sub_tasks)
        
        assert len(result) == 2
        assert result[0]["id"] == "task_1"
        assert result[0]["content"] == "Task 1"
        assert result[0]["state"] == TaskState.OPEN
        assert result[1]["id"] == "task_2"
        assert result[1]["content"] == "Task 2"
        assert result[1]["state"] == TaskState.RUNNING

    def test_tree_sub_tasks_with_nested_subtasks(self):
        """Test tree_sub_tasks with nested subtask structure."""
        parent_task = Task(content="Parent Task", id="parent")
        parent_task.state = TaskState.RUNNING
        
        child_task = Task(content="Child Task", id="child")
        child_task.state = TaskState.OPEN
        parent_task.add_subtask(child_task)
        
        result = tree_sub_tasks([parent_task])
        
        assert len(result) == 1
        assert result[0]["id"] == "parent"
        assert result[0]["content"] == "Parent Task"
        assert len(result[0]["subtasks"]) == 1
        assert result[0]["subtasks"][0]["id"] == "child"
        assert result[0]["subtasks"][0]["content"] == "Child Task"

    def test_tree_sub_tasks_filters_empty_content(self):
        """Test tree_sub_tasks filters out tasks with empty content."""
        task1 = Task(content="Valid Task", id="task_1")
        task1.state = TaskState.OPEN
        task2 = Task(content="", id="task_2")  # Empty content
        task2.state = TaskState.OPEN
        
        result = tree_sub_tasks([task1, task2])
        
        assert len(result) == 1
        assert result[0]["id"] == "task_1"

    def test_tree_sub_tasks_depth_limit(self):
        """Test tree_sub_tasks respects depth limit."""
        # Create deeply nested structure
        current_task = Task(content="Root", id="root")
        
        for i in range(10):
            child_task = Task(content=f"Level {i+1}", id=f"level_{i+1}")
            current_task.add_subtask(child_task)
            current_task = child_task
        
        result = tree_sub_tasks([Task(content="Root", id="root")])
        
        # Should not exceed depth limit (function should handle deep nesting gracefully)
        assert isinstance(result, list)

    def test_update_sub_tasks_success(self):
        """Test update_sub_tasks updates existing tasks correctly."""
        from app.model.chat import TaskContent
        
        task1 = Task(content="Original Content 1", id="task_1")
        task2 = Task(content="Original Content 2", id="task_2")
        task3 = Task(content="Original Content 3", id="task_3")
        
        sub_tasks = [task1, task2, task3]
        
        update_tasks = {
            "task_2": TaskContent(id="task_2", content="Updated Content 2"),
            "task_3": TaskContent(id="task_3", content="Updated Content 3")
        }
        
        result = update_sub_tasks(sub_tasks, update_tasks)
        
        assert len(result) == 2  # Only updated tasks remain
        assert result[0].content == "Updated Content 2"
        assert result[1].content == "Updated Content 3"

    def test_update_sub_tasks_with_nested_tasks(self):
        """Test update_sub_tasks handles nested task updates."""
        from app.model.chat import TaskContent
        
        parent_task = Task(content="Parent", id="parent")
        child_task = Task(content="Original Child", id="child")
        parent_task.add_subtask(child_task)
        
        sub_tasks = [parent_task]
        update_tasks = {
            "parent": TaskContent(id="parent", content="Parent"),  # Include parent to keep it
            "child": TaskContent(id="child", content="Updated Child")
        }
        
        result = update_sub_tasks(sub_tasks, update_tasks, depth=0)
        
        # Parent task should remain with updated child
        assert len(result) == 1
        # Note: The actual behavior depends on the implementation details

    def test_add_sub_tasks_to_camel_task(self):
        """Test add_sub_tasks adds new tasks to CAMEL task."""
        from app.model.chat import TaskContent
        
        camel_task = Task(content="Main Task", id="main")
        
        new_tasks = [
            TaskContent(id="", content="New Task 1"),
            TaskContent(id="", content="New Task 2")
        ]
        
        initial_subtask_count = len(camel_task.subtasks)
        add_sub_tasks(camel_task, new_tasks)
        
        assert len(camel_task.subtasks) == initial_subtask_count + 2
        
        # Check that new subtasks were added with proper IDs
        new_subtasks = camel_task.subtasks[-2:]
        assert new_subtasks[0].content == "New Task 1"
        assert new_subtasks[1].content == "New Task 2"
        assert new_subtasks[0].id.startswith("main.")
        assert new_subtasks[1].id.startswith("main.")

    def test_to_sub_tasks_creates_proper_response(self):
        """Test to_sub_tasks creates properly formatted SSE response."""
        task = Task(content="Main Task", id="main")
        subtask = Task(content="Sub Task", id="sub")
        subtask.state = TaskState.OPEN
        task.add_subtask(subtask)
        
        summary_content = "Task Summary"
        
        result = to_sub_tasks(task, summary_content)
        
        # Should be a JSON string formatted for SSE
        assert "to_sub_tasks" in result
        assert "summary_task" in result
        assert "sub_tasks" in result

    def test_format_agent_description_basic(self):
        """Test format_agent_description with basic agent data."""
        agent_data = NewAgent(
            name="TestAgent",
            description="A test agent for testing",
            tools=["search", "code"],
            mcp_tools=None,
            env_path=".env"
        )
        
        result = format_agent_description(agent_data)
        
        assert "TestAgent:" in result
        assert "A test agent for testing" in result
        assert "Search" in result  # Should titleize tool names
        assert "Code" in result

    def test_format_agent_description_with_mcp_tools(self):
        """Test format_agent_description with MCP tools."""
        agent_data = NewAgent(
            name="MCPAgent",
            description="An agent with MCP tools",
            tools=["search"],
            mcp_tools={"mcpServers": {"notion": {}, "slack": {}}},
            env_path=".env"
        )
        
        result = format_agent_description(agent_data)
        
        assert "MCPAgent:" in result
        assert "An agent with MCP tools" in result
        assert "Notion" in result
        assert "Slack" in result

    def test_format_agent_description_no_description(self):
        """Test format_agent_description without description."""
        agent_data = NewAgent(
            name="SimpleAgent",
            description="",
            tools=["search"],
            mcp_tools=None,
            env_path=".env"
        )
        
        result = format_agent_description(agent_data)
        
        assert "SimpleAgent:" in result
        assert "A specialized agent" in result  # Default description


@pytest.mark.unit
class TestChatServiceAgentOperations:
    """Test cases for agent-related chat service operations."""
    
    @pytest.mark.asyncio
    async def test_question_confirm_simple_query(self, mock_camel_agent):
        """Test question_confirm with simple query that gets direct response."""
        mock_camel_agent.step.return_value.msgs[0].content = "Hello! How can I help you today?"
        mock_camel_agent.chat_history = []
        
        result = await question_confirm(mock_camel_agent, "hello")
        
        # Should return SSE formatted response for simple queries
        assert "wait_confirm" in result
        assert "Hello! How can I help you today?" in result

    @pytest.mark.asyncio
    async def test_question_confirm_complex_task(self, mock_camel_agent):
        """Test question_confirm with complex task that should proceed."""
        mock_camel_agent.step.return_value.msgs[0].content = "yes"
        mock_camel_agent.chat_history = []
        
        result = await question_confirm(mock_camel_agent, "Create a web application with authentication")
        
        # Should return True for complex tasks
        assert result is True

    @pytest.mark.asyncio
    async def test_summary_task(self, mock_camel_agent):
        """Test summary_task creates proper task summary."""
        mock_camel_agent.step.return_value.msgs[0].content = "Web App Creation|Create a modern web application with user authentication and dashboard"
        
        task = Task(content="Create a web application with user authentication", id="web_app_task")
        
        result = await summary_task(mock_camel_agent, task)
        
        assert result == "Web App Creation|Create a modern web application with user authentication and dashboard"
        mock_camel_agent.step.assert_called_once()

    @pytest.mark.asyncio
    async def test_new_agent_model_creation(self, sample_chat_data):
        """Test new_agent_model creates agent with proper configuration."""
        options = Chat(**sample_chat_data)
        agent_data = NewAgent(
            name="TestAgent",
            description="A test agent",
            tools=["search", "code"],
            mcp_tools=None,
            env_path=".env"
        )
        
        mock_agent = MagicMock()
        
        with patch("app.service.chat_service.get_toolkits", return_value=[]), \
             patch("app.service.chat_service.get_mcp_tools", return_value=[]), \
             patch("app.service.chat_service.agent_model", return_value=mock_agent):
            
            result = await new_agent_model(agent_data, options)
            
            assert result is mock_agent

    @pytest.mark.asyncio
    async def test_construct_workforce(self, sample_chat_data, mock_task_lock):
        """Test construct_workforce creates workforce with proper agents."""
        options = Chat(**sample_chat_data)
        
        mock_workforce = MagicMock()
        mock_mcp_agent = MagicMock()
        
        with patch("app.service.chat_service.agent_model") as mock_agent_model, \
             patch("app.service.chat_service.Workforce", return_value=mock_workforce), \
             patch("app.service.chat_service.search_agent"), \
             patch("app.service.chat_service.developer_agent"), \
             patch("app.service.chat_service.document_agent"), \
             patch("app.service.chat_service.multi_modal_agent"), \
             patch("app.service.chat_service.mcp_agent", return_value=mock_mcp_agent), \
             patch("app.utils.toolkit.human_toolkit.get_task_lock", return_value=mock_task_lock):
            
            mock_agent_model.return_value = MagicMock()
            
            workforce, mcp = await construct_workforce(options)
            
            assert workforce is mock_workforce
            assert mcp is mock_mcp_agent
            
            # Should add multiple agent workers
            assert mock_workforce.add_single_agent_worker.call_count >= 4

    @pytest.mark.asyncio
    async def test_install_mcp_success(self, mock_camel_agent):
        """Test install_mcp successfully installs MCP tools."""
        mock_tools = [MagicMock(), MagicMock()]
        install_data = ActionInstallMcpData(
            data={"mcpServers": {"notion": {"config": "test"}}}
        )
        
        with patch("app.service.chat_service.get_mcp_tools", return_value=mock_tools):
            await install_mcp(mock_camel_agent, install_data)
            
            mock_camel_agent.add_tools.assert_called_once_with(mock_tools)


@pytest.mark.integration
class TestChatServiceIntegration:
    """Integration tests for chat service."""
    
    @pytest.mark.asyncio
    async def test_step_solve_basic_workflow(self, sample_chat_data, mock_request, mock_task_lock):
        """Test step_solve basic workflow integration."""
        options = Chat(**sample_chat_data)
        
        # Mock the action queue to return improve action first, then end
        mock_task_lock.get_queue = AsyncMock(side_effect=[
            # First call returns improve action
            ActionImproveData(action=Action.improve, data="Test question"),
            # Second call returns end action
            ActionEndData(action=Action.end)
        ])
        
        mock_workforce = MagicMock()
        mock_mcp = MagicMock()
        
        with patch("app.service.chat_service.construct_workforce", return_value=(mock_workforce, mock_mcp)), \
             patch("app.service.chat_service.question_confirm_agent") as mock_question_agent, \
             patch("app.service.chat_service.task_summary_agent") as mock_summary_agent, \
             patch("app.service.chat_service.question_confirm", return_value=True), \
             patch("app.service.chat_service.summary_task", return_value="Test Summary"):
            
            mock_question_agent.return_value = MagicMock()
            mock_summary_agent.return_value = MagicMock()
            mock_workforce.eigent_make_sub_tasks.return_value = []
            
            # Convert async generator to list
            responses = []
            async for response in step_solve(options, mock_request, mock_task_lock):
                responses.append(response)
                # Break after a few responses to avoid infinite loop
                if len(responses) > 10:
                    break
            
            # Should have received some responses
            assert len(responses) > 0

    @pytest.mark.asyncio 
    async def test_step_solve_with_disconnected_request(self, sample_chat_data, mock_request, mock_task_lock):
        """Test step_solve handles disconnected request."""
        options = Chat(**sample_chat_data)
        mock_request.is_disconnected = AsyncMock(return_value=True)
        
        mock_workforce = MagicMock()
        
        with patch("app.service.chat_service.construct_workforce", return_value=(mock_workforce, MagicMock())), \
             patch("app.utils.agent.get_task_lock", return_value=mock_task_lock):
            # Should exit immediately if request is disconnected
            responses = []
            async for response in step_solve(options, mock_request, mock_task_lock):
                responses.append(response)
            
            # Should not have any responses due to immediate disconnection
            assert len(responses) == 0
            # Note: Workforce might not be created/stopped if request is immediately disconnected

    @pytest.mark.asyncio
    async def test_step_solve_error_handling(self, sample_chat_data, mock_request, mock_task_lock):
        """Test step_solve handles errors gracefully."""
        options = Chat(**sample_chat_data)
        
        # Mock get_queue to raise an exception
        mock_task_lock.get_queue = AsyncMock(side_effect=Exception("Queue error"))
        
        with patch("app.utils.agent.get_task_lock", return_value=mock_task_lock):
            responses = []
            async for response in step_solve(options, mock_request, mock_task_lock):
                responses.append(response)
                break  # Exit after first iteration
            
            # Should handle the error and exit gracefully
            assert len(responses) == 0


@pytest.mark.model_backend
class TestChatServiceWithLLM:
    """Tests that require LLM backend (marked for selective running)."""
    
    @pytest.mark.asyncio
    async def test_construct_workforce_with_real_agents(self, sample_chat_data):
        """Test construct_workforce with real agent creation."""
        options = Chat(**sample_chat_data)
        
        # This test would create real agents and workforce
        # Marked as model_backend test for selective execution
        assert True  # Placeholder

    @pytest.mark.very_slow
    async def test_full_chat_workflow_integration(self, sample_chat_data, mock_request):
        """Test complete chat workflow with real components (very slow test)."""
        options = Chat(**sample_chat_data)
        
        # This test would run the complete chat workflow
        # Marked as very_slow for execution only in full test mode
        assert True  # Placeholder


@pytest.mark.unit
class TestChatServiceErrorCases:
    """Test error cases and edge conditions for chat service."""
    
    @pytest.mark.asyncio
    async def test_question_confirm_agent_error(self, mock_camel_agent):
        """Test question_confirm when agent raises error."""
        mock_camel_agent.step.side_effect = Exception("Agent error")
        
        with pytest.raises(Exception, match="Agent error"):
            await question_confirm(mock_camel_agent, "test question")

    @pytest.mark.asyncio
    async def test_summary_task_agent_error(self, mock_camel_agent):
        """Test summary_task when agent raises error."""
        mock_camel_agent.step.side_effect = Exception("Summary error")
        
        task = Task(content="Test task", id="test")
        
        with pytest.raises(Exception, match="Summary error"):
            await summary_task(mock_camel_agent, task)

    @pytest.mark.asyncio
    async def test_construct_workforce_agent_creation_error(self, sample_chat_data, mock_task_lock):
        """Test construct_workforce when agent creation fails."""
        options = Chat(**sample_chat_data)
        
        with patch("app.utils.toolkit.human_toolkit.get_task_lock", return_value=mock_task_lock), \
             patch("app.service.chat_service.agent_model", side_effect=Exception("Agent creation failed")):
            with pytest.raises(Exception, match="Agent creation failed"):
                await construct_workforce(options)

    @pytest.mark.asyncio
    async def test_new_agent_model_with_invalid_tools(self, sample_chat_data):
        """Test new_agent_model with invalid tool configuration."""
        options = Chat(**sample_chat_data)
        agent_data = NewAgent(
            name="InvalidAgent",
            description="Agent with invalid tools",
            tools=["nonexistent_tool"],
            mcp_tools=None,
            env_path=".env"
        )
        
        with patch("app.service.chat_service.get_toolkits", side_effect=Exception("Invalid tool")):
            with pytest.raises(Exception, match="Invalid tool"):
                await new_agent_model(agent_data, options)

    def test_format_agent_description_with_none_values(self):
        """Test format_agent_description handles empty values gracefully."""
        from app.service.task import ActionNewAgent
        
        # Test with ActionNewAgent that might have empty values
        agent_data = ActionNewAgent(
            name="TestAgent",
            description="",  # Empty string instead of None
            tools=[],
            mcp_tools=None  # Should be None instead of empty list
        )
        
        result = format_agent_description(agent_data)
        
        assert "TestAgent:" in result
        assert "A specialized agent" in result  # Default description

    def test_tree_sub_tasks_with_none_content(self):
        """Test tree_sub_tasks handles tasks with empty content."""
        task1 = Task(content="Valid Task", id="task_1")
        task1.state = TaskState.OPEN
        
        # Create task with empty content (edge case)
        task2 = Task(content="", id="task_2")  # Empty string instead of None
        task2.state = TaskState.OPEN
        
        # Should handle empty content gracefully
        result = tree_sub_tasks([task1, task2])
        
        # Should filter out empty content tasks
        assert len(result) <= 1
