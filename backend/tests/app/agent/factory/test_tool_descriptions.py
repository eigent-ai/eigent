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
from app.workspace_bundle.runtime import (
    EnvironmentSetupRequiredError,
    ResolvedRuntimeEnvironment,
    ResolvedRuntimeSkill,
)

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
async def test_single_agent_ignores_legacy_web_deploy_config(
    sample_chat_data, monkeypatch, tmp_path
):
    import app.agent.factory.toolkit_assembler as assembler

    toolkit_config = {
        name: {"enabled": False}
        for name in assembler.DEFAULT_SINGLE_AGENT_TOOLKIT_CONFIG
    }
    toolkit_config["web_deploy"] = {"enabled": True}
    options = _bedrock_chat(sample_chat_data).model_copy(
        update={"toolkit_config": toolkit_config}
    )
    _patch_toolkit_creation_side_effects(
        monkeypatch, tmp_path, options.project_id
    )

    assembly = await assemble_single_agent_toolkits(
        options,
        task_id=options.task_id,
        working_directory=str(tmp_path),
        hands=None,
        can_delegate=False,
    )

    function_names = {
        tool.get_function_name()
        for tool in assembly.tools
        if hasattr(tool, "get_function_name")
    }
    assert "Web Deploy Toolkit" not in assembly.tool_names
    assert "deploy_html_content" not in function_names
    assert "deploy_folder" not in function_names


@pytest.mark.asyncio
async def test_active_bundle_runtime_inputs_override_request_toolkit_config(
    sample_chat_data, monkeypatch, tmp_path
):
    import app.agent.factory.toolkit_assembler as assembler

    toolkit_config = {
        name: {"enabled": name in {"skill", "mcp", "terminal"}}
        for name in assembler.DEFAULT_SINGLE_AGENT_TOOLKIT_CONFIG
    }
    toolkit_config["skill"]["pinned_skill_sources"] = {
        "/attacker/SKILL.md": "request override"
    }
    toolkit_config["mcp"].update(
        {
            "config_dict": {
                "mcpServers": {"request-override": {"command": "malicious"}}
            },
            "skip_failed": True,
        }
    )
    toolkit_config["terminal"].update(
        {
            "working_directory": "/attacker",
            "safe_mode": False,
            "use_docker_backend": True,
            "runtime_env_provider": None,
        }
    )
    options = _bedrock_chat(sample_chat_data).model_copy(
        update={
            "installed_mcp": {
                "mcpServers": {"legacy-global": {"command": "legacy-command"}}
            },
            "toolkit_config": toolkit_config,
        }
    )
    captured: dict[str, Any] = {}
    monkeypatch.setenv("MCP_REMOTE_CONFIG_DIR", "/legacy/mcp-auth")
    _patch_toolkit_creation_side_effects(
        monkeypatch, tmp_path, options.project_id
    )

    class FakeSkillToolkit:
        def __init__(self, *args, **kwargs):
            captured["skills"] = kwargs["pinned_skill_sources"]

        @classmethod
        def toolkit_name(cls):
            return "SkillToolkit"

        def get_tools(self):
            return []

    class FakeMCPToolkit:
        def __init__(self, **kwargs):
            captured["mcp"] = kwargs["config_dict"]
            captured["skip_failed"] = kwargs["skip_failed"]

        async def connect(self):
            captured["connected"] = True

        def get_tools(self):
            return []

    class FakeTerminalToolkit:
        def __init__(self, *args, **kwargs):
            captured["terminal"] = kwargs

        @classmethod
        def toolkit_name(cls):
            return "TerminalToolkit"

        def get_tools(self):
            return []

    monkeypatch.setattr(assembler, "SkillToolkit", FakeSkillToolkit)
    monkeypatch.setattr(assembler, "MCPToolkit", FakeMCPToolkit)
    monkeypatch.setattr(assembler, "TerminalToolkit", FakeTerminalToolkit)
    runtime = ResolvedRuntimeEnvironment(
        environment_spec_id="envspec-1",
        bundle_revision_id="bundle@1",
        proposal_id="proposal-1",
        configuration_root=str(tmp_path),
        instructions=(("coordinator", "Pinned instruction"),),
        context=(),
        skills=(
            ResolvedRuntimeSkill(
                ref="bundle://skills/demo/SKILL.md",
                path=str(tmp_path / "skills/demo/SKILL.md"),
                content=(
                    "---\nname: demo\ndescription: demo\n---\nPinned body"
                ),
                assign_to=("single_agent",),
            ),
        ),
        connectors=(),
        agent_aliases=("coordinator",),
        permission_profile="request_approval",
        permission_rules=(("git.remote_write", "deny"),),
        _mcp_servers={"bundle-local": {"command": "python", "args": ["-V"]}},
        _secret_identities=(),
        _environment_bindings=(),
        _secret_broker_factory=lambda: None,  # never called
    )

    await assemble_single_agent_toolkits(
        options,
        task_id=options.task_id,
        working_directory=str(tmp_path),
        hands=None,
        can_delegate=False,
        runtime_environment=runtime,
    )

    assert list(captured["skills"].values())[0].endswith("Pinned body")
    assert set(captured["mcp"]["mcpServers"]) == {"bundle-local"}
    assert "legacy-global" not in captured["mcp"]["mcpServers"]
    assert (
        "MCP_REMOTE_CONFIG_DIR"
        not in (captured["mcp"]["mcpServers"]["bundle-local"]["env"])
    )
    assert captured["skip_failed"] is False
    assert captured["connected"] is True
    assert captured["terminal"]["working_directory"] == str(tmp_path)
    assert captured["terminal"]["safe_mode"] is True
    assert captured["terminal"]["use_docker_backend"] is False
    assert callable(captured["terminal"]["runtime_env_provider"])

    class CleanupTerminalToolkit(FakeTerminalToolkit):
        def cleanup(self):
            captured["terminal_cleaned"] = True

    class FailingMCPToolkit(FakeMCPToolkit):
        async def connect(self):
            raise RuntimeError("partial MCP startup")

        async def disconnect(self):
            captured["mcp_cleaned"] = True

    monkeypatch.setattr(
        assembler,
        "TerminalToolkit",
        CleanupTerminalToolkit,
    )
    monkeypatch.setattr(assembler, "MCPToolkit", FailingMCPToolkit)

    with pytest.raises(
        EnvironmentSetupRequiredError,
        match="bundle_mcp_start_failed",
    ):
        await assemble_single_agent_toolkits(
            options,
            task_id=options.task_id,
            working_directory=str(tmp_path),
            hands=None,
            can_delegate=False,
            runtime_environment=runtime,
        )

    assert captured["terminal_cleaned"] is True
    assert captured["mcp_cleaned"] is True

    captured.pop("terminal_cleaned")

    class ConstructorFailingMCPToolkit:
        def __init__(self, **_kwargs):
            raise RuntimeError("MCP constructor failed")

    monkeypatch.setattr(
        assembler,
        "MCPToolkit",
        ConstructorFailingMCPToolkit,
    )
    with pytest.raises(
        EnvironmentSetupRequiredError,
        match="bundle_mcp_start_failed",
    ):
        await assemble_single_agent_toolkits(
            options,
            task_id=options.task_id,
            working_directory=str(tmp_path),
            hands=None,
            can_delegate=False,
            runtime_environment=runtime,
        )
    assert captured["terminal_cleaned"] is True

    class UnexpectedToolkitConstruction:
        def __init__(self, *_args, **_kwargs):
            raise AssertionError("resource allocation preceded MCP preflight")

    denied_hands = MagicMock()
    denied_hands.can_use_mcp.return_value = False
    denied_options = options.model_copy(
        update={
            "toolkit_config": {
                **toolkit_config,
                "browser": {"enabled": True},
            }
        }
    )
    monkeypatch.setattr(
        assembler,
        "TerminalToolkit",
        UnexpectedToolkitConstruction,
    )
    monkeypatch.setattr(
        assembler,
        "HybridBrowserToolkit",
        UnexpectedToolkitConstruction,
    )
    with pytest.raises(
        EnvironmentSetupRequiredError,
        match="mcp_not_allowed:bundle-local",
    ):
        await assemble_single_agent_toolkits(
            denied_options,
            task_id=denied_options.task_id,
            working_directory=str(tmp_path),
            hands=denied_hands,
            can_delegate=False,
            runtime_environment=runtime,
        )
    denied_hands.can_use_mcp.assert_called_once_with("bundle-local")
    denied_hands.can_use_browser.assert_not_called()


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
