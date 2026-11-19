"""Real CAMEL export/permission integration, with process and runtime mocks."""

import json
from dataclasses import replace
from pathlib import Path
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
from app.run_context import RunContext, run_context_scope
from app.run_journal import SQLiteRunJournal
from app.run_policy import ToolSafetyClass
from app.run_runtime.tool_checkpoint import (
    BackgroundToolResult,
    classify_tool_safety,
    declared_tool_safety,
    finish_tool_checkpoint,
    prepare_tool_checkpoint,
)
from app.utils.listen import toolkit_listen
from app.utils.runtime_storage import runtime_storage


@pytest.fixture
def run_context(tmp_path):
    context = RunContext(
        space_id="space-1",
        project_id="isolated-project",
        run_id="run-1",
        task_id="task-1",
        email="fixture@example.invalid",
        user_id="fixture-user",
        working_directory=tmp_path,
        task_output_root=tmp_path / "output",
        camel_log_dir=tmp_path / "logs",
        binding_source="fixture",
        workdir_mode=None,
        browser_port=0,
    )
    with run_context_scope(context):
        yield context


@pytest.fixture
def toolkit(tmp_path, monkeypatch, run_context):
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
    instance._runtime_env_vars = {"PATH": ""}
    instance.cloned_env_path = None
    for name in (
        "_get_env_vars",
        "_get_venv_path",
        "_setup_cloned_environment",
        "_clone_venv_with_symlinks",
    ):
        monkeypatch.setattr(
            instance,
            name,
            Mock(side_effect=AssertionError(f"preflight cannot call {name}")),
        )
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


@pytest.fixture
def selected_venv(toolkit, tmp_path, monkeypatch):
    selected = tmp_path / "selected environment" / ".venv"
    for root in (selected, tmp_path / "base environment"):
        (root / "bin").mkdir(parents=True)
        (root / "bin" / "python").write_text("fixture, never executed")
    monkeypatch.setattr(
        terminal_toolkit,
        "get_terminal_base_venv_path",
        lambda: str(tmp_path / "base environment"),
    )
    toolkit._agent_venv_dir = str(selected.parent)
    # Use the real existing-environment selection branch. The instance-level
    # setup/getter guards remain in place for every subsequent preflight call.
    TerminalToolkit._setup_cloned_environment(toolkit)
    return selected


@pytest.fixture
def current_runtime(toolkit, tmp_path, monkeypatch, run_context):
    home = tmp_path / "home"
    workspace = tmp_path / "workspace"
    home.mkdir()
    workspace.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    # Restore the actual integrated getters, not source fragments or substitutes.
    monkeypatch.delattr(toolkit, "_get_env_vars")
    monkeypatch.delattr(toolkit, "_get_venv_path")
    toolkit.working_dir = str(workspace)
    context = replace(
        run_context,
        working_directory=workspace,
        task_output_root=workspace / "output",
    )
    with run_context_scope(context):
        yield context


def test_registered_preflight_keeps_runtime_unmaterialized_across_messages(
    toolkit, current_runtime, monkeypatch
):
    storage = runtime_storage(current_runtime)
    assert not storage.root.exists()
    messages = []
    events = []
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _, event: events.append(event),
    )
    enhanced = ToolkitMessageIntegration(
        message_handler=lambda message_title="", message_description="": (
            messages.append((message_title, message_description))
        ),
        extract_params_callback=lambda kwargs: (
            kwargs.pop("message_title", ""),
            kwargs.pop("message_description", ""),
        ),
    ).register_toolkits(toolkit)
    tools = enhanced.get_tools()
    assert (
        sum(t.get_function_name() == "terminal_preflight" for t in tools) == 1
    )
    preflight = next(
        t for t in tools if t.get_function_name() == "terminal_preflight"
    )
    with monkeypatch.context() as guard:
        guard.setattr(
            terminal_toolkit.os,
            "mkdir",
            Mock(side_effect=AssertionError("read cannot materialize")),
        )
        guard.setattr(
            terminal_toolkit.shutil,
            "rmtree",
            Mock(side_effect=AssertionError("read cannot clean up")),
        )
        for title in ("First check", "Second check"):
            result = json.loads(
                preflight(
                    commands=[],
                    message_title=title,
                    message_description="Metadata only",
                )
            )
            assert result["execution_authorized"] is False
            assert result["venv_selection"]["status"] == "unconfirmed"
            assert all(
                entry["status"] == "not_supplied"
                for entry in result["storage"].values()
            )
    assert not storage.root.exists()
    assert messages == [
        ("First check", "Metadata only"),
        ("Second check", "Metadata only"),
    ]
    assert [type(event).__name__ for event in events] == [
        "ActionActivateToolkitData",
        "ActionDeactivateToolkitData",
    ] * 2
    # The real execution getter retains its authorized materialization path.
    environment = toolkit._get_env_vars()
    assert environment["EIGENT_RUNTIME_DIR"] == str(storage.runtime)
    assert storage.runtime.is_dir()
    assert storage.cache.is_dir()


def test_preflight_does_not_reselect_integrated_runtime_after_run_change(
    toolkit, current_runtime, tmp_path, monkeypatch
):
    directory = Path(toolkit._run_agent_environment_dir(current_runtime))
    selected = directory / ".venv"
    base = tmp_path / "base"
    for root in (selected, base):
        (root / "bin").mkdir(parents=True)
        (root / "bin" / "python").write_text("fixture, never executed")
    binary = selected / "bin" / "blender"
    binary.write_text("fixture, never executed")
    binary.chmod(0o755)
    monkeypatch.setattr(
        terminal_toolkit, "get_terminal_base_venv_path", lambda: str(base)
    )
    toolkit._agent_venv_dir = str(directory)
    TerminalToolkit._setup_cloned_environment(toolkit)
    assert toolkit._get_venv_path() == str(selected)
    preflight = next(
        t
        for t in toolkit.get_tools()
        if t.get_function_name() == "terminal_preflight"
    )
    assert json.loads(preflight(commands=["blender"]))["commands"][0][
        "path"
    ] == str(binary)
    current = replace(current_runtime, run_id="run-2")
    toolkit._workspace_run_id = current.run_id
    storage = runtime_storage(current)
    assert not storage.root.exists()
    with run_context_scope(current):
        with monkeypatch.context() as guard:
            guard.setattr(
                terminal_toolkit.os,
                "mkdir",
                Mock(side_effect=AssertionError("read cannot materialize")),
            )
            result = json.loads(preflight(commands=["blender"]))
        assert result["venv_selection"]["status"] == "unconfirmed"
        assert result["commands"][0]["status"] == "not_found"
        assert str(selected) not in json.dumps(result)
        assert not storage.root.exists()
        setup = Mock()
        monkeypatch.setattr(toolkit, "_setup_cloned_environment", setup)
        toolkit._get_venv_path()
        setup.assert_called_once_with()
        assert storage.runtime.is_dir()
    toolkit._clone_venv_with_symlinks.assert_not_called()


def test_preflight_completion_does_not_settle_a_background_tool(
    toolkit, current_runtime, tmp_path, monkeypatch
):
    tools = {t.get_function_name(): t for t in toolkit.get_tools()}
    monkeypatch.setattr(
        toolkit,
        "_shell_exec_with_workspace_checkpoint",
        lambda **kwargs: BackgroundToolResult("Dispatch accepted"),
    )
    with SQLiteRunJournal(tmp_path / "checkpoint.sqlite3") as journal:
        journal.ensure_run(
            run_id=current_runtime.run_id,
            project_id=current_runtime.project_id,
        )
        journal.create_run_attempt(
            current_runtime.run_id,
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        background = prepare_tool_checkpoint(
            raw_tool_call_id="background",
            tool_name="shell_exec",
            arguments={},
            journal=journal,
        )
        acknowledgement = tools["shell_exec"](command="fixture", block=False)
        assert isinstance(acknowledgement, BackgroundToolResult)
        finish_tool_checkpoint(
            background, result=acknowledgement, journal=journal
        )
        preflight = tools["terminal_preflight"]
        for index in range(2):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id=f"preflight-{index}",
                tool_name="terminal_preflight",
                arguments={"commands": []},
                declared_safety=declared_tool_safety(
                    preflight, "terminal_preflight", {}
                ),
                journal=journal,
            )
            result = preflight(commands=[])
            assert json.loads(result)["execution_authorized"] is False
            finish_tool_checkpoint(checkpoint, result=result, journal=journal)
        calls = {
            call.tool_name: call
            for call in journal.list_tool_calls(current_runtime.run_id)
        }
        assert calls["shell_exec"].status == "dispatched"
        assert calls["terminal_preflight"].status == "completed"
        assert not any(
            e.event_type == "run.completed"
            for e in journal.list_events(current_runtime.run_id)
        )
        finish_tool_checkpoint(
            background,
            result={"exit_code": 0, "workspace_checkpointed": True},
            journal=journal,
        )
        finish_tool_checkpoint(
            background, result=acknowledgement, journal=journal
        )
        events = journal.list_events(current_runtime.run_id)
        assert sum(e.event_type == "tool.completed" for e in events) == 3


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
    toolkit, tmp_path, monkeypatch, selected_venv
):
    selected = selected_venv
    binary_dir = selected / "bin"
    binary = binary_dir / "blender"
    binary.write_text("fixture, never executed")
    binary.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path / "unrelated login path"))
    result = json.loads(toolkit.terminal_preflight(commands=["blender"]))
    assert result["commands"][0]["path"] == str(binary)
    assert result["environment_source"] == (
        "worker_environment_with_selected_venv_bin"
    )
    assert result["activation_scripts_evaluated"] is False
    assert result["venv_selection"]["status"] == "confirmed"


def test_preflight_prefers_worker_runtime_path_without_spawn_getters(
    toolkit, tmp_path, monkeypatch
):
    worker_bin = tmp_path / "worker bin"
    login_bin = tmp_path / "login bin"
    for directory, name in ((worker_bin, "blender"), (login_bin, "ffmpeg")):
        directory.mkdir()
        binary = directory / name
        binary.write_text("fixture, never executed")
        binary.chmod(0o755)
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


def test_preflight_uses_process_path_when_runtime_has_no_override(
    toolkit, tmp_path, monkeypatch
):
    binary = tmp_path / "blender"
    binary.write_text("fixture, never executed")
    binary.chmod(0o755)
    toolkit._runtime_env_vars = {}
    monkeypatch.setenv("PATH", str(tmp_path))
    result = json.loads(toolkit.terminal_preflight(commands=["blender"]))
    assert result["commands"][0]["path"] == str(binary)


def test_empty_worker_path_keeps_cwd_without_process_path_fallback(
    toolkit, tmp_path, monkeypatch
):
    process_bin = tmp_path / "process bin"
    process_bin.mkdir()
    for binary in (tmp_path / "blender", process_bin / "ffmpeg"):
        binary.write_text("fixture, never executed")
        binary.chmod(0o755)
    monkeypatch.setenv("PATH", str(process_bin))
    result = json.loads(
        toolkit.terminal_preflight(commands=["blender", "ffmpeg"])
    )
    assert result["commands"][0]["path"] == str(tmp_path / "blender")
    assert result["commands"][1]["status"] == "not_found"


def test_missing_worker_path_is_unavailable(toolkit, monkeypatch):
    toolkit._runtime_env_vars = {}
    monkeypatch.delenv("PATH", raising=False)
    result = json.loads(toolkit.terminal_preflight(commands=["blender"]))
    assert result["commands"][0]["status"] == "path_unavailable"


@pytest.mark.parametrize("configured", [False, True])
def test_runtime_configuration_does_not_materialize_directories(
    toolkit, tmp_path, monkeypatch, configured
):
    keys = (
        "EIGENT_RUNTIME_DIR",
        "EIGENT_CACHE_DIR",
        "EIGENT_INTERMEDIATE_DIR",
    )
    for key in keys:
        monkeypatch.delenv(key, raising=False)
        if configured:
            monkeypatch.setenv(key, str(tmp_path / "process runtime" / key))
            toolkit._runtime_env_vars[key] = str(tmp_path / "runtime" / key)
    toolkit._runtime_env_vars["PRIVATE_TEST_SECRET"] = "do not disclose"
    with monkeypatch.context() as guard:
        guard.setattr(
            terminal_toolkit.os,
            "mkdir",
            Mock(side_effect=AssertionError("preflight cannot mkdir")),
        )
        guard.setattr(
            terminal_toolkit.shutil,
            "rmtree",
            Mock(side_effect=AssertionError("preflight cannot clean up")),
        )
        result = json.loads(toolkit.terminal_preflight(commands=[]))
    for key in keys:
        assert result["storage"][key]["status"] == (
            "configured_uninspected" if configured else "not_supplied"
        )
        assert result["storage"][key]["path"] == (
            str(tmp_path / "runtime" / key) if configured else None
        )
    assert not (tmp_path / "runtime").exists()
    assert not (tmp_path / "process runtime").exists()
    assert "do not disclose" not in json.dumps(result)
    assert result["execution_authorized"] is False


@pytest.mark.parametrize(
    "selection",
    [
        "unknown",
        "other_run",
        "other_project",
        "changed_path",
        "missing_directory",
    ],
)
def test_unconfirmed_venv_is_not_reported_as_current(
    toolkit, tmp_path, monkeypatch, run_context, selected_venv, selection
):
    binary = selected_venv / "bin" / "blender"
    binary.write_text("fixture, never executed")
    binary.chmod(0o755)
    current = run_context
    if selection == "unknown":
        del toolkit._preflight_venv_selection
    elif selection == "other_run":
        current = replace(run_context, run_id="run-2")
    elif selection == "other_project":
        current = replace(run_context, project_id="project-2")
    elif selection == "missing_directory":
        selected_venv.rename(tmp_path / "moved environment")
    else:
        toolkit.cloned_env_path = str(tmp_path / "unselected environment")
    # cwd ownership can advance before the venv getter/clone runs. It is not
    # evidence that an earlier environment belongs to the current Task.
    toolkit._workspace_run_id = current.run_id
    with run_context_scope(current), monkeypatch.context() as guard:
        guard.setattr(
            terminal_toolkit.os,
            "mkdir",
            Mock(side_effect=AssertionError("preflight cannot mkdir")),
        )
        guard.setattr(
            terminal_toolkit.shutil,
            "rmtree",
            Mock(side_effect=AssertionError("preflight cannot clean up")),
        )
        result = json.loads(toolkit.terminal_preflight(commands=["blender"]))
    assert result["commands"][0]["status"] == "not_found"
    assert result["venv_selection"]["status"] == "unconfirmed"
    assert "has not been confirmed" in result["venv_selection"]["reason"]
    assert str(selected_venv) not in json.dumps(result)
    assert result["environment_source"] == "worker_environment"
    assert result["execution_authorized"] is False


def test_selection_is_invalidated_when_setup_cannot_select_an_environment(
    toolkit, tmp_path, monkeypatch, selected_venv
):
    monkeypatch.setattr(
        terminal_toolkit,
        "get_terminal_base_venv_path",
        lambda: str(tmp_path / "missing base"),
    )
    TerminalToolkit._setup_cloned_environment(toolkit)
    result = json.loads(toolkit.terminal_preflight(commands=[]))
    assert result["venv_selection"]["status"] == "unconfirmed"


def test_confirmed_selection_keeps_explicit_empty_path_entry(
    toolkit, tmp_path, selected_venv
):
    binary = tmp_path / "blender"
    binary.write_text("fixture, never executed")
    binary.chmod(0o755)
    result = json.loads(toolkit.terminal_preflight(commands=["blender"]))
    assert result["venv_selection"]["status"] == "confirmed"
    assert result["commands"][0]["path"] == str(binary)


@pytest.mark.parametrize("succeeds", [True, False])
def test_setup_publishes_selection_only_after_successful_clone(
    toolkit, monkeypatch, selected_venv, succeeds
):
    (selected_venv / "bin" / "python").unlink()

    def synthetic_clone(source, target):
        assert target == str(selected_venv)
        if not succeeds:
            raise RuntimeError("synthetic clone failure")
        (selected_venv / "bin" / "python").write_text(
            "fixture, never executed"
        )

    clone = Mock(side_effect=synthetic_clone)
    monkeypatch.setattr(toolkit, "_clone_venv_with_symlinks", clone)
    TerminalToolkit._setup_cloned_environment(toolkit)
    result = json.loads(toolkit.terminal_preflight(commands=[]))
    assert result["venv_selection"]["status"] == (
        "confirmed" if succeeds else "unconfirmed"
    )
    assert clone.call_count == 1


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
