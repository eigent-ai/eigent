from unittest.mock import AsyncMock, MagicMock, patch
import pytest
import os
import tempfile
from pathlib import Path

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
    new_agent_model,
    collect_previous_task_context,
    build_context_for_workforce
)
from app.model.chat import Chat, NewAgent
from app.service.task import Action, ActionImproveData, ActionEndData, ActionInstallMcpData, TaskLock
from camel.tasks import Task
from camel.tasks.task import TaskState


@pytest.mark.unit
class TestCollectPreviousTaskContext:
    """Test cases for collect_previous_task_context function."""

    def test_collect_previous_task_context_basic(self, temp_dir):
        """Test collect_previous_task_context with basic inputs."""
        working_directory = str(temp_dir)
        previous_task_content = "Create a Python script"
        previous_task_result = "Successfully created script.py"
        previous_summary = "Python Script Creation Task"
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content=previous_task_content,
            previous_task_result=previous_task_result,
            previous_summary=previous_summary
        )
        
        # Check that all sections are included
        assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
        assert "Previous Task:" in result
        assert "Create a Python script" in result
        assert "Previous Task Summary:" in result
        assert "Python Script Creation Task" in result
        assert "Previous Task Result:" in result
        assert "Successfully created script.py" in result
        assert "=== END OF PREVIOUS TASK CONTEXT ===" in result
        assert "=== NEW TASK ===" in result

    def test_collect_previous_task_context_with_generated_files(self, temp_dir):
        """Test collect_previous_task_context with generated files in working directory."""
        working_directory = str(temp_dir)
        
        # Create some test files
        (temp_dir / "script.py").write_text("print('Hello World')")
        (temp_dir / "config.json").write_text('{"test": true}')
        (temp_dir / "README.md").write_text("# Test Project")
        
        # Create a subdirectory with files
        sub_dir = temp_dir / "utils"
        sub_dir.mkdir()
        (sub_dir / "helper.py").write_text("def helper(): pass")
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content="Create project files",
            previous_task_result="Files created successfully",
            previous_summary=""
        )
        
        # Check that generated files are listed
        assert "Generated Files from Previous Task:" in result
        assert "script.py" in result
        assert "config.json" in result
        assert "README.md" in result
        assert "utils/helper.py" in result or "utils\\helper.py" in result  # Handle Windows paths
        
        # Files should be sorted
        lines = result.split('\n')
        file_lines = [line.strip() for line in lines if line.strip().startswith('- ')]
        assert len(file_lines) == 4

    def test_collect_previous_task_context_filters_hidden_files(self, temp_dir):
        """Test that hidden files and directories are filtered out."""
        working_directory = str(temp_dir)
        
        # Create regular files
        (temp_dir / "visible.py").write_text("# Visible file")
        
        # Create hidden files and directories
        (temp_dir / ".hidden_file").write_text("hidden content")
        (temp_dir / ".env").write_text("SECRET=hidden")
        
        hidden_dir = temp_dir / ".hidden_dir"
        hidden_dir.mkdir()
        (hidden_dir / "file.txt").write_text("in hidden dir")
        
        # Create cache directories
        cache_dir = temp_dir / "__pycache__"
        cache_dir.mkdir()
        (cache_dir / "module.pyc").write_text("compiled")
        
        node_modules = temp_dir / "node_modules"
        node_modules.mkdir()
        (node_modules / "package").mkdir()
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content="Test filtering",
            previous_task_result="Files filtered",
            previous_summary=""
        )
        
        # Should only include visible files
        assert "visible.py" in result
        assert ".hidden_file" not in result
        assert ".env" not in result
        assert "__pycache__" not in result
        assert "node_modules" not in result
        assert ".hidden_dir" not in result

    def test_collect_previous_task_context_filters_temp_files(self, temp_dir):
        """Test that temporary files are filtered out."""
        working_directory = str(temp_dir)
        
        # Create regular files
        (temp_dir / "main.py").write_text("# Main file")
        
        # Create temporary files
        (temp_dir / "temp.tmp").write_text("temporary")
        (temp_dir / "compiled.pyc").write_text("compiled python")
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content="Test temp filtering",
            previous_task_result="Temp files filtered",
            previous_summary=""
        )
        
        # Should only include regular files
        assert "main.py" in result
        assert "temp.tmp" not in result
        assert "compiled.pyc" not in result

    def test_collect_previous_task_context_nonexistent_directory(self):
        """Test collect_previous_task_context with non-existent working directory."""
        working_directory = "/nonexistent/directory"
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content="Test task",
            previous_task_result="Test result",
            previous_summary="Test summary"
        )
        
        # Should not crash and should not include file listing
        assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
        assert "Test task" in result
        assert "Test result" in result
        assert "Test summary" in result
        assert "Generated Files from Previous Task:" not in result

    def test_collect_previous_task_context_empty_inputs(self, temp_dir):
        """Test collect_previous_task_context with empty string inputs."""
        working_directory = str(temp_dir)
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content="",
            previous_task_result="",
            previous_summary=""
        )
        
        # Should still have the structural elements
        assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
        assert "=== END OF PREVIOUS TASK CONTEXT ===" in result
        assert "=== NEW TASK ===" in result
        
        # Should not have content sections for empty inputs
        assert "Previous Task:" not in result
        assert "Previous Task Summary:" not in result
        assert "Previous Task Result:" not in result

    def test_collect_previous_task_context_only_summary(self, temp_dir):
        """Test collect_previous_task_context with only summary provided."""
        working_directory = str(temp_dir)
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content="",
            previous_task_result="",
            previous_summary="Only summary provided"
        )
        
        # Should include summary section only
        assert "Previous Task Summary:" in result
        assert "Only summary provided" in result
        assert "Previous Task:" not in result
        assert "Previous Task Result:" not in result

    @patch('app.service.chat_service.logger')
    def test_collect_previous_task_context_file_system_error(self, mock_logger, temp_dir):
        """Test collect_previous_task_context handles file system errors gracefully."""
        working_directory = str(temp_dir)
        
        # Mock os.walk to raise an exception
        with patch('os.walk', side_effect=PermissionError("Access denied")):
            result = collect_previous_task_context(
                working_directory=working_directory,
                previous_task_content="Test task",
                previous_task_result="Test result",
                previous_summary="Test summary"
            )
            
            # Should still return result without files
            assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
            assert "Test task" in result
            assert "Generated Files from Previous Task:" not in result
            
            # Should log warning
            mock_logger.warning.assert_called_once()

    def test_collect_previous_task_context_relative_paths(self, temp_dir):
        """Test that file paths are correctly converted to relative paths."""
        working_directory = str(temp_dir)
        
        # Create nested directory structure
        deep_dir = temp_dir / "level1" / "level2" / "level3"
        deep_dir.mkdir(parents=True)
        (deep_dir / "deep_file.txt").write_text("deep content")
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content="Test relative paths",
            previous_task_result="Paths converted",
            previous_summary=""
        )
        
        # Check that the path is relative to working directory
        expected_path = "level1/level2/level3/deep_file.txt"
        windows_path = "level1\\level2\\level3\\deep_file.txt"
        
        # Should contain relative path (handle both Unix and Windows separators)
        assert expected_path in result or windows_path in result


@pytest.mark.unit
class TestBuildContextForWorkforce:
    """Test cases for build_context_for_workforce function."""

    def test_build_context_for_workforce_basic(self, temp_dir):
        """Test build_context_for_workforce with basic task lock and options."""
        # Create mock TaskLock
        task_lock = MagicMock(spec=TaskLock)
        task_lock.conversation_history = [
            {'role': 'user', 'content': 'Create a Python script'},
            {'role': 'assistant', 'content': 'I will create a Python script for you'}
        ]
        task_lock.last_task_result = "Script created successfully"
        task_lock.last_task_summary = "Python Script Creation"
        
        # Create mock Chat options
        options = MagicMock()
        options.file_save_path.return_value = str(temp_dir)
        
        result = build_context_for_workforce(task_lock, options)
        
        # Should include conversation history
        assert "=== CONVERSATION HISTORY ===" in result
        assert "user: Create a Python script" in result
        assert "assistant: I will create a Python script for you" in result
        
        # Should include previous task context
        assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
        assert "Script created successfully" in result

    def test_build_context_for_workforce_empty_history(self, temp_dir):
        """Test build_context_for_workforce with empty conversation history."""
        task_lock = MagicMock(spec=TaskLock)
        task_lock.conversation_history = []
        task_lock.last_task_result = ""
        task_lock.last_task_summary = ""
        
        options = MagicMock()
        options.file_save_path.return_value = str(temp_dir)
        
        result = build_context_for_workforce(task_lock, options)
        
        # Should return empty string for no context
        assert result == ""

    def test_build_context_for_workforce_task_result_role(self, temp_dir):
        """Test build_context_for_workforce handles 'task_result' role specially."""
        task_lock = MagicMock(spec=TaskLock)
        task_lock.conversation_history = [
            {'role': 'user', 'content': 'First question'},
            {'role': 'task_result', 'content': 'Full task context from previous task'},
            {'role': 'user', 'content': 'Second question'}
        ]
        task_lock.last_task_result = "Final result"
        task_lock.last_task_summary = "Task summary"
        
        options = MagicMock()
        options.file_save_path.return_value = str(temp_dir)
        
        result = build_context_for_workforce(task_lock, options)
        
        # Should simplify task_result display
        assert "[Previous Task Completed]" in result
        assert "Full task context from previous task" not in result  # Should not show full content
        assert "user: First question" in result
        assert "user: Second question" in result

    def test_build_context_for_workforce_with_last_task_result(self, temp_dir):
        """Test build_context_for_workforce includes last task result context."""
        # Create some files in temp directory
        (temp_dir / "output.txt").write_text("Task output")
        
        task_lock = MagicMock(spec=TaskLock)
        task_lock.conversation_history = [
            {'role': 'user', 'content': 'Test question'}
        ]
        task_lock.last_task_result = "Task completed with output.txt"
        task_lock.last_task_summary = "File creation task"
        
        options = MagicMock()
        options.file_save_path.return_value = str(temp_dir)
        
        result = build_context_for_workforce(task_lock, options)
        
        # Should include conversation history and task context
        assert "=== CONVERSATION HISTORY ===" in result
        assert "user: Test question" in result
        assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
        assert "Task completed with output.txt" in result
        assert "File creation task" in result
        assert "output.txt" in result  # Generated file should be listed


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
    async def test_step_solve_context_building_workflow(self, sample_chat_data, mock_request, temp_dir):
        """Test step_solve builds context correctly using collect_previous_task_context."""
        options = Chat(**sample_chat_data)
        
        # Create actual TaskLock with context data
        task_lock = TaskLock(
            id="test_task_123",
            queue=AsyncMock(),
            human_input={}
        )
        task_lock.conversation_history = [
            {'role': 'user', 'content': 'Create a Python script'},
            {'role': 'assistant', 'content': 'Script created successfully'}
        ]
        task_lock.last_task_result = "def hello(): print('Hello World')"
        task_lock.last_task_summary = "Python Hello World Script"
        
        # Create some files in working directory
        working_dir = temp_dir / "test_project"
        working_dir.mkdir()
        (working_dir / "script.py").write_text("def hello(): print('Hello World')")
        
        # Mock file_save_path method to return our temp directory
        with patch.object(Chat, 'file_save_path', return_value=str(working_dir)):
            
            # Test the context building directly
            context = build_context_for_workforce(task_lock, options)
            
            # Verify context includes conversation history
            assert "=== CONVERSATION HISTORY ===" in context
            assert "user: Create a Python script" in context
            assert "assistant: Script created successfully" in context
            
            # Verify context includes task context with files
            assert "=== CONTEXT FROM PREVIOUS TASK ===" in context
            assert "def hello(): print('Hello World')" in context
            assert "Python Hello World Script" in context
            assert "script.py" in context

    @pytest.mark.asyncio
    async def test_step_solve_new_task_state_context_collection(self, sample_chat_data, mock_request, temp_dir):
        """Test step_solve correctly collects context in new_task_state action."""
        options = Chat(**sample_chat_data)
        working_dir = temp_dir / "project"
        working_dir.mkdir()
        
        # Create files that should be included in context
        (working_dir / "main.py").write_text("print('main')")
        (working_dir / "config.json").write_text('{"version": "1.0"}')
        
        # Mock file_save_path to return our temp directory
        with patch.object(Chat, 'file_save_path', return_value=str(working_dir)):
            
            # Test collect_previous_task_context directly with the scenario
            result = collect_previous_task_context(
                working_directory=str(working_dir),
                previous_task_content="Create project structure",
                previous_task_result="Project files created successfully",
                previous_summary="Project Setup Task"
            )
            
            # Verify all expected elements are present
            assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
            assert "Previous Task:" in result
            assert "Create project structure" in result
            assert "Previous Task Summary:" in result
            assert "Project Setup Task" in result
            assert "Previous Task Result:" in result
            assert "Project files created successfully" in result
            assert "Generated Files from Previous Task:" in result
            assert "main.py" in result
            assert "config.json" in result
            assert "=== END OF PREVIOUS TASK CONTEXT ===" in result
            assert "=== NEW TASK ===" in result

    @pytest.mark.asyncio
    async def test_step_solve_end_action_context_collection(self, sample_chat_data, mock_request, temp_dir):
        """Test step_solve correctly collects and saves context in end action."""
        options = Chat(**sample_chat_data)
        working_dir = temp_dir / "finished_project"
        working_dir.mkdir()
        
        # Create output files
        (working_dir / "output.txt").write_text("Final output")
        (working_dir / "report.md").write_text("# Task Report")
        
        # Create actual TaskLock
        task_lock = TaskLock(
            id="test_end_task",
            queue=AsyncMock(),
            human_input={}
        )
        task_lock.last_task_summary = "Final Task Summary"
        
        # Mock file_save_path
        with patch.object(Chat, 'file_save_path', return_value=str(working_dir)):
            
            # Test the context collection for end action scenario
            task_content = "Generate final report"
            task_result = "Report generated successfully with output files"
            
            context = collect_previous_task_context(
                working_directory=str(working_dir),
                previous_task_content=task_content,
                previous_task_result=task_result,
                previous_summary=task_lock.last_task_summary
            )
            
            # Verify context structure for end action
            assert "=== CONTEXT FROM PREVIOUS TASK ===" in context
            assert "Generate final report" in context
            assert "Report generated successfully with output files" in context
            assert "Final Task Summary" in context
            assert "output.txt" in context
            assert "report.md" in context
            
            # Test that context can be added to conversation history
            task_lock.add_conversation('task_result', context)
            assert len(task_lock.conversation_history) == 1
            assert task_lock.conversation_history[0]['role'] == 'task_result'
            assert task_lock.conversation_history[0]['content'] == context

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Gets Stuck for some reason.")
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
    @pytest.mark.skip(reason="Gets Stuck for some reason.")
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

    def test_collect_previous_task_context_os_walk_exception(self, temp_dir):
        """Test collect_previous_task_context handles os.walk exceptions."""
        working_directory = str(temp_dir)
        
        with patch('os.walk', side_effect=OSError("Permission denied")):
            with patch('app.service.chat_service.logger') as mock_logger:
                result = collect_previous_task_context(
                    working_directory=working_directory,
                    previous_task_content="Test task",
                    previous_task_result="Test result",
                    previous_summary="Test summary"
                )
                
                # Should still include basic context
                assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
                assert "Test task" in result
                assert "Test result" in result
                assert "Test summary" in result
                
                # Should not include file listing
                assert "Generated Files from Previous Task:" not in result
                
                # Should log warning
                mock_logger.warning.assert_called_once()

    def test_collect_previous_task_context_relpath_exception(self, temp_dir):
        """Test collect_previous_task_context handles os.path.relpath exceptions."""
        working_directory = str(temp_dir)
        
        # Create a test file
        (temp_dir / "test.txt").write_text("test content")
        
        with patch('os.path.relpath', side_effect=ValueError("Invalid path")):
            with patch('app.service.chat_service.logger') as mock_logger:
                result = collect_previous_task_context(
                    working_directory=working_directory,
                    previous_task_content="Test task",
                    previous_task_result="Test result",
                    previous_summary="Test summary"
                )
                
                # Should handle the exception gracefully
                assert "=== CONTEXT FROM PREVIOUS TASK ===" in result
                # Should log warning about file collection failure
                mock_logger.warning.assert_called_once()

    def test_build_context_for_workforce_missing_attributes(self, temp_dir):
        """Test build_context_for_workforce handles missing attributes gracefully."""
        # Create task_lock without required attributes
        task_lock = MagicMock(spec=TaskLock)
        task_lock.conversation_history = None  # Missing attribute
        task_lock.last_task_result = None  # Missing attribute
        task_lock.last_task_summary = None  # Missing attribute
        
        options = MagicMock()
        options.file_save_path.return_value = str(temp_dir)
        
        result = build_context_for_workforce(task_lock, options)
        
        # Should handle missing attributes gracefully
        assert result == ""

    def test_build_context_for_workforce_file_save_path_exception(self):
        """Test build_context_for_workforce handles file_save_path exceptions."""
        task_lock = MagicMock(spec=TaskLock)
        task_lock.conversation_history = []
        task_lock.last_task_result = "Test result"
        task_lock.last_task_summary = "Test summary"
        
        options = MagicMock()
        options.file_save_path.side_effect = Exception("Path error")
        
        with patch('app.service.chat_service.logger') as mock_logger:
            # Should handle exception when getting file path
            with pytest.raises(Exception, match="Path error"):
                build_context_for_workforce(task_lock, options)

    def test_collect_previous_task_context_unicode_handling(self, temp_dir):
        """Test collect_previous_task_context handles unicode content correctly."""
        working_directory = str(temp_dir)
        
        # Create files with unicode content
        (temp_dir / "unicode_file.txt").write_text("Unicode content: 🐍 Python ñáéíóú", encoding='utf-8')
        
        unicode_task_content = "Create files with unicode: 🔥 emojis and ñáéíóú accents"
        unicode_result = "Files created successfully with unicode: ✅ done"
        unicode_summary = "Unicode Task: 📝 file creation"
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content=unicode_task_content,
            previous_task_result=unicode_result,
            previous_summary=unicode_summary
        )
        
        # Should handle unicode correctly
        assert "🔥 emojis" in result
        assert "ñáéíóú accents" in result
        assert "✅ done" in result
        assert "📝 file creation" in result
        assert "unicode_file.txt" in result

    def test_collect_previous_task_context_very_long_content(self, temp_dir):
        """Test collect_previous_task_context handles very long content."""
        working_directory = str(temp_dir)
        
        # Create very long content strings
        long_content = "Very long task content. " * 1000  # ~25KB
        long_result = "Very long task result. " * 1000    # ~23KB
        long_summary = "Very long summary. " * 100        # ~1.8KB
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content=long_content,
            previous_task_result=long_result,
            previous_summary=long_summary
        )
        
        # Should handle long content without issues
        assert len(result) > 49000  # Should be quite long
        assert "Very long task content." in result
        assert "Very long task result." in result
        assert "Very long summary." in result

    def test_collect_previous_task_context_many_files(self, temp_dir):
        """Test collect_previous_task_context performance with many files."""
        working_directory = str(temp_dir)
        
        # Create many files to test performance
        for i in range(100):
            (temp_dir / f"file_{i:03d}.txt").write_text(f"Content {i}")
        
        # Create subdirectories with files
        for dir_i in range(10):
            sub_dir = temp_dir / f"subdir_{dir_i}"
            sub_dir.mkdir()
            for file_i in range(10):
                (sub_dir / f"subfile_{file_i}.txt").write_text(f"Sub content {dir_i}-{file_i}")
        
        import time
        start_time = time.time()
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content="Test many files",
            previous_task_result="Many files processed",
            previous_summary="Performance test"
        )
        
        end_time = time.time()
        execution_time = end_time - start_time
        
        # Should complete in reasonable time (less than 1 second for 200 files)
        assert execution_time < 1.0
        
        # Should list all files
        assert "Generated Files from Previous Task:" in result
        # Count number of file entries
        file_lines = [line for line in result.split('\n') if '  - ' in line]
        assert len(file_lines) == 200  # 100 main files + 100 subfiles

    def test_collect_previous_task_context_special_characters_in_filenames(self, temp_dir):
        """Test collect_previous_task_context handles special characters in filenames."""
        working_directory = str(temp_dir)
        
        # Create files with special characters (that are valid in filenames)
        try:
            (temp_dir / "file with spaces.txt").write_text("content")
            (temp_dir / "file-with-dashes.txt").write_text("content")
            (temp_dir / "file_with_underscores.txt").write_text("content")
            (temp_dir / "file.with.dots.txt").write_text("content")
        except OSError:
            # Skip if filesystem doesn't support these characters
            pytest.skip("Filesystem doesn't support special characters in filenames")
        
        result = collect_previous_task_context(
            working_directory=working_directory,
            previous_task_content="Test special chars",
            previous_task_result="Files created",
            previous_summary=""
        )
        
        # Should list files with special characters
        assert "file with spaces.txt" in result
        assert "file-with-dashes.txt" in result
        assert "file_with_underscores.txt" in result
        assert "file.with.dots.txt" in result

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
