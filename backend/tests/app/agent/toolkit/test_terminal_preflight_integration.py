"""Real CAMEL export/permission integration, with process and runtime mocks."""

import json
from unittest.mock import Mock

import pytest
from camel.toolkits.message_integration import ToolkitMessageIntegration

from app.agent.toolkit import terminal_toolkit
from app.agent.toolkit.terminal_toolkit import (
    BaseTerminalToolkit,
    TerminalToolkit,
)
from app.permission_policy.engine import PermissionPolicyEngine
from app.permission_policy.models import (
    PRESET_PROFILES,
    PermissionProfileName,
    PolicyEffect,
)
from app.permission_policy.tool_actions import build_tool_action_descriptor
from app.run_policy import ToolSafetyClass
from app.run_runtime.tool_checkpoint import (
    classify_tool_safety,
    declared_tool_safety,
)
from app.utils.listen import toolkit_listen


@pytest.fixture
def toolkit(tmp_path, monkeypatch):
    instance = TerminalToolkit.__new__(TerminalToolkit)
    monkeypatch.setattr(
        instance, "api_task_id", "isolated-project", raising=False
    )
    monkeypatch.setattr(
        instance, "agent_name", "developer_agent", raising=False
    )
    instance.working_dir = str(tmp_path)
    instance.os_type = "Darwin"
    instance.use_docker_backend = False
    monkeypatch.setattr(instance, "_runtime_env_provider", None, raising=False)
    monkeypatch.setattr(instance, "_get_env_vars", lambda: {"PATH": ""})
    monkeypatch.setattr(instance, "_get_venv_path", lambda: None)
    monkeypatch.setattr(toolkit_listen, "get_task_lock", lambda _: object())
    monkeypatch.setattr(toolkit_listen, "_safe_put_queue", lambda *_: None)
    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_mutation_service",
        Mock(side_effect=AssertionError("preflight cannot prepare a writer")),
    )
    monkeypatch.setattr(
        terminal_toolkit.subprocess,
        "Popen",
        Mock(side_effect=AssertionError("preflight cannot spawn")),
    )
    return instance


def test_exported_camel_probe_has_a_narrow_read_declaration(toolkit):
    tools = {tool.get_function_name(): tool for tool in toolkit.get_tools()}
    preflight = tools["terminal_preflight"]
    function = preflight.get_openai_tool_schema()["function"]
    schema = function["parameters"]["properties"]
    assert {
        "commands",
        "directory",
        "filename_pattern",
        "start_number",
        "end_number",
    } <= schema.keys()
    description = " ".join(function["description"].split())
    assert "explicit user confirmation" in description
    assert declared_tool_safety(preflight, "terminal_preflight", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert declared_tool_safety(tools["shell_exec"], "shell_exec", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )
    assert classify_tool_safety("terminal_preflight", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )
    result = json.loads(preflight.func(commands=["blender"]))
    assert result["commands"][0]["status"] == "not_found"
    assert result["execution_authorized"] is False


def test_export_retains_existing_terminal_tools(toolkit):
    before = {
        tool.get_function_name()
        for tool in BaseTerminalToolkit.get_tools(toolkit)
    }
    after = {tool.get_function_name() for tool in toolkit.get_tools()}
    assert after == before | {"terminal_preflight"}


def test_read_declaration_survives_real_message_integration(toolkit):
    messages = []

    def record_message(
        message_title: str = "", message_description: str = ""
    ) -> None:
        messages.append((message_title, message_description))

    enhanced = ToolkitMessageIntegration(
        message_handler=record_message,
        extract_params_callback=lambda kwargs: (
            kwargs.pop("message_title", ""),
            kwargs.pop("message_description", ""),
        ),
    ).register_toolkits(toolkit)
    exported = {
        tool.get_function_name(): tool for tool in enhanced.get_tools()
    }
    preflight = exported["terminal_preflight"]
    assert declared_tool_safety(preflight, "terminal_preflight", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert declared_tool_safety(exported["shell_exec"], "shell_exec", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )
    result = json.loads(
        preflight.func(
            commands=["blender"],
            message_title="Check",
            message_description="Dependencies",
        )
    )
    assert result["commands"][0]["status"] == "not_found"
    assert messages == [("Check", "Dependencies")]


def test_preflight_uses_spawn_environment_and_selected_venv(
    toolkit, tmp_path, monkeypatch
):
    selected = tmp_path / "selected environment"
    binary_dir = selected / "bin"
    binary_dir.mkdir(parents=True)
    binary = binary_dir / "blender"
    binary.write_text("fixture, never executed")
    binary.chmod(0o755)
    monkeypatch.setattr(toolkit, "_get_venv_path", lambda: str(selected))
    monkeypatch.setenv("PATH", str(tmp_path / "unrelated login path"))
    result = json.loads(toolkit.terminal_preflight(commands=["blender"]))
    assert result["commands"][0]["path"] == str(binary)
    assert result["environment_source"] == (
        "worker_environment_with_selected_venv_bin"
    )
    assert result["activation_scripts_evaluated"] is False


def test_real_environment_getter_prefers_worker_runtime_path(
    toolkit, tmp_path, monkeypatch
):
    worker_bin = tmp_path / "worker bin"
    login_bin = tmp_path / "login bin"
    for directory, name in ((worker_bin, "blender"), (login_bin, "ffmpeg")):
        directory.mkdir()
        binary = directory / name
        binary.write_text("fixture, never executed")
        binary.chmod(0o755)
    monkeypatch.delattr(toolkit, "_get_env_vars")
    toolkit._runtime_env_vars = {"PATH": str(worker_bin)}
    monkeypatch.setenv("PATH", str(login_bin))
    monkeypatch.setenv("PRIVATE_TEST_SECRET", "never include in diagnostics")

    result = json.loads(
        toolkit.terminal_preflight(commands=["blender", "ffmpeg"])
    )

    assert result["commands"][0]["path"] == str(worker_bin / "blender")
    assert result["commands"][1]["status"] == "not_found"
    assert "never include in diagnostics" not in json.dumps(result)
    assert result["login_shell_checked"] is False


def test_protected_environment_is_not_opened_for_preflight(
    toolkit, monkeypatch
):
    toolkit._runtime_env_provider = Mock(
        side_effect=AssertionError("secret broker")
    )
    monkeypatch.setattr(
        toolkit,
        "_get_env_vars",
        Mock(side_effect=AssertionError("environment")),
    )
    result = json.loads(toolkit.terminal_preflight(commands=["blender"]))
    assert result["environment_source"] == (
        "protected_spawn_environment_unavailable"
    )
    assert result["commands"][0]["status"] == "path_unavailable"
    toolkit._runtime_env_provider.assert_not_called()


def test_docker_preflight_never_inspects_host_metadata(toolkit, monkeypatch):
    toolkit.use_docker_backend = True
    monkeypatch.setattr(
        terminal_toolkit,
        "inspect_toolchain",
        Mock(side_effect=AssertionError("host lookup")),
    )
    result = json.loads(toolkit.terminal_preflight(commands=["blender"]))
    assert result["status"] == "unavailable"


def test_preflight_permission_does_not_authorize_followup_execution(
    toolkit, tmp_path
):
    preflight = next(
        tool
        for tool in toolkit.get_tools()
        if tool.get_function_name() == "terminal_preflight"
    )
    safety, _ = declared_tool_safety(preflight, "terminal_preflight", {})
    descriptor = build_tool_action_descriptor(
        action_id="probe-1",
        tool_name="terminal_preflight",
        toolkit_name="Terminal Toolkit",
        safety_class=safety,
        arguments={"commands": ["blender"], "directory": str(tmp_path)},
        run_id="run-1",
        attempt_id="attempt-1",
        environment_spec_digest="fixture",
        idempotency_key=None,
        workspace_root=tmp_path,
    )
    assert descriptor.operation == "filesystem.read"
    assert descriptor.external_side_effect is False
    shell = build_tool_action_descriptor(
        action_id="shell-1",
        tool_name="shell_exec",
        toolkit_name="Terminal Toolkit",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
        arguments={"command": "blender --version"},
        run_id="run-1",
        attempt_id="attempt-1",
        environment_spec_digest="fixture",
        idempotency_key=None,
        workspace_root=tmp_path,
    )
    engine = PermissionPolicyEngine()
    profile = PRESET_PROFILES[PermissionProfileName.READ_ONLY]
    assert (
        engine.evaluate(descriptor, profile=profile).effect
        is PolicyEffect.ALLOW
    )
    assert engine.evaluate(shell, profile=profile).effect is PolicyEffect.DENY
