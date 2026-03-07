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
from camel.tasks import Task
from camel.tasks.task import TaskState

from app.model.chat import Chat, NewAgent, TaskContent
from app.service.chat_service.lifecycle import (
    add_sub_tasks,
    construct_workforce,
    format_agent_description,
    install_mcp,
    new_agent_model,
    to_sub_tasks,
    tree_sub_tasks,
    update_sub_tasks,
)
from app.service.task import ActionInstallMcpData, ActionNewAgent

pytestmark = pytest.mark.unit


# --- tree_sub_tasks ---


def test_tree_sub_tasks_simple():
    task1 = Task(content="Task 1", id="task_1")
    task1.state = TaskState.OPEN
    task2 = Task(content="Task 2", id="task_2")
    task2.state = TaskState.RUNNING

    result = tree_sub_tasks([task1, task2])

    assert len(result) == 2
    assert result[0]["id"] == "task_1"
    assert result[0]["content"] == "Task 1"
    assert result[0]["state"] == TaskState.OPEN
    assert result[1]["id"] == "task_2"
    assert result[1]["content"] == "Task 2"
    assert result[1]["state"] == TaskState.RUNNING


def test_tree_sub_tasks_with_nested_subtasks():
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


def test_tree_sub_tasks_filters_empty_content():
    task1 = Task(content="Valid Task", id="task_1")
    task1.state = TaskState.OPEN
    task2 = Task(content="", id="task_2")
    task2.state = TaskState.OPEN

    result = tree_sub_tasks([task1, task2])

    assert len(result) == 1
    assert result[0]["id"] == "task_1"


def test_tree_sub_tasks_depth_limit():
    current_task = Task(content="Root", id="root")
    for i in range(10):
        child_task = Task(content=f"Level {i + 1}", id=f"level_{i + 1}")
        current_task.add_subtask(child_task)
        current_task = child_task

    result = tree_sub_tasks([Task(content="Root", id="root")])
    assert isinstance(result, list)


def test_tree_sub_tasks_with_none_content():
    task1 = Task(content="Valid Task", id="task_1")
    task1.state = TaskState.OPEN
    task2 = Task(content="", id="task_2")
    task2.state = TaskState.OPEN

    result = tree_sub_tasks([task1, task2])
    assert len(result) <= 1


# --- update_sub_tasks ---


def test_update_sub_tasks_success():
    task1 = Task(content="Original Content 1", id="task_1")
    task2 = Task(content="Original Content 2", id="task_2")
    task3 = Task(content="Original Content 3", id="task_3")

    update_tasks = {
        "task_2": TaskContent(id="task_2", content="Updated Content 2"),
        "task_3": TaskContent(id="task_3", content="Updated Content 3"),
    }

    result = update_sub_tasks([task1, task2, task3], update_tasks)

    assert len(result) == 2
    assert result[0].content == "Updated Content 2"
    assert result[1].content == "Updated Content 3"


def test_update_sub_tasks_with_nested_tasks():
    parent_task = Task(content="Parent", id="parent")
    child_task = Task(content="Original Child", id="child")
    parent_task.add_subtask(child_task)

    update_tasks = {
        "parent": TaskContent(id="parent", content="Parent"),
        "child": TaskContent(id="child", content="Updated Child"),
    }

    result = update_sub_tasks([parent_task], update_tasks, depth=0)
    assert len(result) == 1


# --- add_sub_tasks ---


def test_add_sub_tasks_to_camel_task():
    camel_task = Task(content="Main Task", id="main")
    new_tasks = [
        TaskContent(id="", content="New Task 1"),
        TaskContent(id="", content="New Task 2"),
    ]

    initial_subtask_count = len(camel_task.subtasks)
    add_sub_tasks(camel_task, new_tasks)

    assert len(camel_task.subtasks) == initial_subtask_count + 2
    new_subtasks = camel_task.subtasks[-2:]
    assert new_subtasks[0].content == "New Task 1"
    assert new_subtasks[1].content == "New Task 2"
    assert new_subtasks[0].id.startswith("main.")
    assert new_subtasks[1].id.startswith("main.")


# --- to_sub_tasks ---


def test_to_sub_tasks_creates_proper_response():
    task = Task(content="Main Task", id="main")
    subtask = Task(content="Sub Task", id="sub")
    subtask.state = TaskState.OPEN
    task.add_subtask(subtask)

    result = to_sub_tasks(task, "Task Summary")

    assert "to_sub_tasks" in result
    assert "summary_task" in result
    assert "sub_tasks" in result


# --- format_agent_description ---


def test_format_agent_description_basic():
    agent_data = NewAgent(
        name="TestAgent",
        description="A test agent for testing",
        tools=["search", "code"],
        mcp_tools=None,
        env_path=".env",
    )
    result = format_agent_description(agent_data)
    assert "TestAgent:" in result
    assert "A test agent for testing" in result
    assert "Search" in result
    assert "Code" in result


def test_format_agent_description_with_mcp_tools():
    agent_data = NewAgent(
        name="MCPAgent",
        description="An agent with MCP tools",
        tools=["search"],
        mcp_tools={"mcpServers": {"notion": {}, "slack": {}}},
        env_path=".env",
    )
    result = format_agent_description(agent_data)
    assert "MCPAgent:" in result
    assert "An agent with MCP tools" in result
    assert "Notion" in result
    assert "Slack" in result


def test_format_agent_description_no_description():
    agent_data = NewAgent(
        name="SimpleAgent",
        description="",
        tools=["search"],
        mcp_tools=None,
        env_path=".env",
    )
    result = format_agent_description(agent_data)
    assert "SimpleAgent:" in result
    assert "A specialized agent" in result


def test_format_agent_description_with_none_values():
    agent_data = ActionNewAgent(
        name="TestAgent",
        description="",
        tools=[],
        mcp_tools=None,
    )
    result = format_agent_description(agent_data)
    assert "TestAgent:" in result
    assert "A specialized agent" in result


# --- new_agent_model ---


@pytest.mark.asyncio
async def test_new_agent_model_creation(sample_chat_data):
    options = Chat(**sample_chat_data)
    agent_data = NewAgent(
        name="TestAgent",
        description="A test agent",
        tools=["search", "code"],
        mcp_tools=None,
        env_path=".env",
    )
    mock_agent = MagicMock()

    with (
        patch(
            "app.service.chat_service.lifecycle.get_toolkits",
            return_value=[],
        ),
        patch(
            "app.service.chat_service.lifecycle.get_mcp_tools",
            return_value=[],
        ),
        patch(
            "app.service.chat_service.lifecycle.agent_model",
            return_value=mock_agent,
        ),
    ):
        result = await new_agent_model(agent_data, options)
        assert result is mock_agent


@pytest.mark.asyncio
async def test_new_agent_model_with_invalid_tools(sample_chat_data):
    options = Chat(**sample_chat_data)
    agent_data = NewAgent(
        name="InvalidAgent",
        description="Agent with invalid tools",
        tools=["nonexistent_tool"],
        mcp_tools=None,
        env_path=".env",
    )

    with patch(
        "app.service.chat_service.lifecycle.get_toolkits",
        side_effect=Exception("Invalid tool"),
    ):
        with pytest.raises(Exception, match="Invalid tool"):
            await new_agent_model(agent_data, options)


# --- construct_workforce ---


@pytest.mark.asyncio
async def test_construct_workforce(sample_chat_data, mock_task_lock):
    options = Chat(**sample_chat_data)
    mock_workforce = MagicMock()
    mock_mcp_agent = MagicMock()

    with (
        patch(
            "app.service.chat_service.lifecycle.agent_model"
        ) as mock_agent_model,
        patch(
            "app.agent.factory.workforce_agents.agent_model"
        ) as mock_wf_agent_model,
        patch(
            "app.service.chat_service.lifecycle.get_working_directory",
            return_value="/tmp/test_workdir",
        ),
        patch(
            "app.service.chat_service.lifecycle.Workforce",
            return_value=mock_workforce,
        ),
        patch("app.service.chat_service.lifecycle.browser_agent"),
        patch("app.service.chat_service.lifecycle.developer_agent"),
        patch("app.service.chat_service.lifecycle.document_agent"),
        patch("app.service.chat_service.lifecycle.multi_modal_agent"),
        patch(
            "app.service.chat_service.lifecycle.mcp_agent",
            return_value=mock_mcp_agent,
        ),
        patch(
            "app.agent.toolkit.human_toolkit.get_task_lock",
            return_value=mock_task_lock,
        ),
        patch(
            "app.service.chat_service.lifecycle.WorkforceMetricsCallback",
            return_value=MagicMock(),
        ),
    ):
        mock_agent_model.return_value = MagicMock()
        mock_wf_agent_model.return_value = MagicMock()

        workforce, mcp = await construct_workforce(options)

        assert workforce is mock_workforce
        assert mcp is mock_mcp_agent
        assert mock_workforce.add_single_agent_worker.call_count >= 4


@pytest.mark.asyncio
async def test_construct_workforce_agent_creation_error(
    sample_chat_data, mock_task_lock
):
    options = Chat(**sample_chat_data)

    with (
        patch(
            "app.agent.toolkit.human_toolkit.get_task_lock",
            return_value=mock_task_lock,
        ),
        patch(
            "app.service.chat_service.lifecycle.agent_model",
            side_effect=Exception("Agent creation failed"),
        ),
        patch(
            "app.agent.factory.workforce_agents.agent_model",
            side_effect=Exception("Agent creation failed"),
        ),
        patch(
            "app.agent.factory.developer.agent_model",
            side_effect=Exception("Agent creation failed"),
        ),
        patch(
            "app.agent.factory.browser.agent_model",
            side_effect=Exception("Agent creation failed"),
        ),
        patch(
            "app.agent.factory.document.agent_model",
            side_effect=Exception("Agent creation failed"),
        ),
        patch(
            "app.agent.factory.multi_modal.agent_model",
            side_effect=Exception("Agent creation failed"),
        ),
    ):
        with pytest.raises(Exception, match="Agent creation failed"):
            await construct_workforce(options)


# --- install_mcp ---


@pytest.mark.asyncio
async def test_install_mcp_success(mock_camel_agent):
    mock_tools = [MagicMock(), MagicMock()]
    install_data = ActionInstallMcpData(
        data={"mcpServers": {"notion": {"config": "test"}}}
    )

    with patch(
        "app.service.chat_service.lifecycle.get_mcp_tools",
        return_value=mock_tools,
    ):
        await install_mcp(mock_camel_agent, install_data)
        mock_camel_agent.add_tools.assert_called_once_with(mock_tools)
