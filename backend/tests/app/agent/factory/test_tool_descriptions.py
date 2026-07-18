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

import asyncio
import importlib
import inspect
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agent.factory.toolkit_assembler import assemble_single_agent_toolkits
from app.model.chat import Chat
from app.service.task import TaskLock, task_locks

pytestmark = pytest.mark.unit


class DummyTaskLock:
    def add_human_input_listen(self, agent_name: str) -> None:
        pass

    async def put_queue(self, data: Any) -> None:
        pass

    async def get_human_input(self, agent_name: str) -> str:
        return ""


def _patch_toolkit_creation_side_effects(monkeypatch, tmp_path, project_id):
    import app.agent.toolkit.human_toolkit as human_toolkit
    import app.agent.toolkit.terminal_toolkit as terminal_toolkit

    monkeypatch.setattr(
        human_toolkit, "get_task_lock", lambda api_task_id: DummyTaskLock()
    )
    monkeypatch.setattr(
        terminal_toolkit.TerminalToolkit,
        "_setup_cloned_environment",
        lambda self: None,
    )
    monkeypatch.setitem(
        task_locks, project_id, TaskLock(project_id, asyncio.Queue(), {})
    )
    monkeypatch.setenv("file_save_path", str(tmp_path))
    monkeypatch.setenv("browser_port", "9222")


def _assert_tool_descriptions_are_non_empty(tools, owner: str) -> None:
    missing: list[str] = []
    for index, tool in enumerate(tools):
        schema = getattr(tool, "openai_tool_schema", None)
        if not isinstance(schema, dict):
            missing.append(f"{index}: <non-schema tool>")
            continue

        function_info = schema.get("function")
        if not isinstance(function_info, dict):
            missing.append(f"{index}: <missing function schema>")
            continue

        description = function_info.get("description")
        if not isinstance(description, str) or not description.strip():
            tool_name = function_info.get("name") or "<unnamed>"
            toolkit_name = getattr(tool, "_toolkit_name", None)
            missing.append(f"{index}: {tool_name} ({toolkit_name})")

    assert not missing, f"{owner} has tools without descriptions: {missing}"


def _bedrock_chat(sample_chat_data: dict) -> Chat:
    return Chat(
        **{
            **sample_chat_data,
            "model_platform": "aws-bedrock-converse",
            "model_type": "claude-opus-4-7",
            "api_key": "test_key",
            "api_url": "https://bedrock.local/v1",
            "installed_mcp": {"mcpServers": {}},
            "toolkit_config": None,
        }
    )


@pytest.mark.asyncio
async def test_default_single_agent_tools_have_descriptions(
    sample_chat_data, monkeypatch, tmp_path
):
    options = _bedrock_chat(sample_chat_data)
    _patch_toolkit_creation_side_effects(
        monkeypatch, tmp_path, options.project_id
    )

    assembly = await assemble_single_agent_toolkits(
        options,
        task_id=options.task_id,
        working_directory=str(tmp_path),
        hands=None,
        can_delegate=True,
    )

    assert len(assembly.tools) > 40
    _assert_tool_descriptions_are_non_empty(
        assembly.tools, "single-agent default toolkit assembly"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("module_name", "factory_name"),
    [
        ("app.agent.factory.browser", "browser_agent"),
        ("app.agent.factory.developer", "developer_agent"),
        ("app.agent.factory.document", "document_agent"),
        ("app.agent.factory.multi_modal", "multi_modal_agent"),
    ],
)
async def test_default_workforce_worker_tools_have_descriptions(
    module_name,
    factory_name,
    sample_chat_data,
    monkeypatch,
    tmp_path,
):
    options = _bedrock_chat(sample_chat_data)
    _patch_toolkit_creation_side_effects(
        monkeypatch, tmp_path, options.project_id
    )
    module = importlib.import_module(module_name)
    captured_tools = []

    def fake_agent_model(
        agent_name, system_message, options, tools, *args, **kwargs
    ):
        captured_tools.extend(tools)
        agent = MagicMock()
        agent.agent_id = f"{agent_name}_id"
        agent.agent_name = agent_name
        return agent

    monkeypatch.setattr(module, "agent_model", fake_agent_model)
    monkeypatch.setattr(
        module, "get_working_directory", lambda options: str(tmp_path)
    )
    if module_name == "app.agent.factory.document":
        monkeypatch.setattr(
            module.GoogleDriveMCPToolkit,
            "get_can_use_tools",
            AsyncMock(return_value=[]),
        )

    result = getattr(module, factory_name)(options, hands=None)
    if inspect.isawaitable(result):
        await result

    assert captured_tools
    _assert_tool_descriptions_are_non_empty(
        captured_tools, f"{factory_name} default toolkit assembly"
    )
