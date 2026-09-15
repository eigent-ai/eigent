"""Terminal metadata survives CAMEL tool export and reconstruction."""

import copy
import inspect
import runpy

import pytest
from camel.toolkits import FunctionTool
from camel.toolkits.message_integration import ToolkitMessageIntegration

from app.agent.toolkit import terminal_toolkit
from app.agent.toolkit.terminal_toolkit import (
    BaseTerminalToolkit,
    TerminalToolkit,
)
from app.run_policy import ToolSafetyClass
from app.run_runtime.tool_checkpoint import declared_tool_safety
from app.utils.listen import toolkit_listen

SHELL_TOOL_NAMES = {
    "shell_exec",
    "shell_view",
    "shell_write_content_to_file",
    "shell_write_to_process",
    "shell_kill_process",
    "shell_ask_user_for_help",
}
RUNTIME_GUIDANCE = (
    "EIGENT_RUNTIME_DIR",
    "EIGENT_CACHE_DIR",
    "EIGENT_INTERMEDIATE_DIR",
    "500-path",
    "python -m pip",
    "MP4/.blend",
    "move existing user files",
    "escape symlinks",
    "do not bypass command permissions",
)


def test_terminal_preserves_complete_camel_parameter_contract():
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    base = BaseTerminalToolkit.__new__(BaseTerminalToolkit)
    tools = toolkit.get_tools()
    names = [tool.get_function_name() for tool in tools]
    assert len(names) == len(SHELL_TOOL_NAMES)
    assert set(names) == SHELL_TOOL_NAMES
    shell = next(
        tool for tool in tools if tool.get_function_name() == "shell_exec"
    )
    actual = shell.get_openai_tool_schema()["function"]["parameters"]
    expected = FunctionTool(base.shell_exec).get_openai_tool_schema()[
        "function"
    ]["parameters"]
    assert actual == expected
    assert inspect.signature(toolkit.shell_exec) == inspect.signature(
        base.shell_exec
    )
    assert (
        vars(TerminalToolkit.shell_exec)["__wrapped__"]
        is BaseTerminalToolkit.shell_exec
    )
    assert (
        TerminalToolkit.shell_exec.__annotations__
        is BaseTerminalToolkit.shell_exec.__annotations__
    )


@pytest.mark.parametrize("rebuild", [False, True])
def test_runtime_guidance_survives_camel_export_and_reconstruction(rebuild):
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    if rebuild:
        integration = ToolkitMessageIntegration(
            message_handler=lambda message_title="", message_description="": (
                None
            ),
            extract_params_callback=lambda kwargs: (
                kwargs.pop("message_title", ""),
                kwargs.pop("message_description", ""),
            ),
        )
        toolkit = integration.register_toolkits(toolkit)
    tools = toolkit.get_tools()
    names = [tool.get_function_name() for tool in tools]
    assert len(names) == len(SHELL_TOOL_NAMES)
    assert set(names) == SHELL_TOOL_NAMES
    shell = next(
        tool for tool in tools if tool.get_function_name() == "shell_exec"
    )
    description = " ".join(
        shell.get_openai_tool_schema()["function"]["description"].split()
    )
    for guidance in RUNTIME_GUIDANCE:
        assert guidance in description
    assert declared_tool_safety(shell, "shell_exec", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_terminal_module_does_not_modify_base_shell_metadata():
    base_shell = BaseTerminalToolkit.shell_exec
    metadata = {
        key: copy.copy(getattr(base_shell, key))
        for key in (
            "__doc__",
            "__name__",
            "__qualname__",
            "__module__",
            "__annotations__",
            "__dict__",
            "__defaults__",
            "__kwdefaults__",
        )
    }
    signature = inspect.signature(base_shell)
    base_doc = base_shell.__doc__
    assert base_doc is not None
    assert "EIGENT_RUNTIME_DIR" not in base_doc
    loaded = runpy.run_path(terminal_toolkit.__file__)
    assert BaseTerminalToolkit.shell_exec is base_shell
    for key, value in metadata.items():
        assert getattr(base_shell, key) == value, key
    assert inspect.signature(base_shell) == signature
    shell = loaded["TerminalToolkit"].shell_exec
    assert shell.__wrapped__ is base_shell
    assert shell.__doc__.endswith(inspect.getdoc(base_shell))


@pytest.mark.parametrize("fail", [False, True])
def test_shell_listener_emits_one_pair_and_preserves_outcome(
    monkeypatch, fail
):
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    monkeypatch.setattr(
        toolkit, "api_task_id", "fixture-project", raising=False
    )
    monkeypatch.setattr(
        toolkit, "agent_name", "developer_agent", raising=False
    )
    events = []
    calls = []
    error = ValueError("fixture failure")

    def execute(**kwargs):
        calls.append(kwargs)
        if fail:
            raise error
        return "fixture result"

    monkeypatch.setattr(
        toolkit, "_shell_exec_with_workspace_checkpoint", execute
    )
    monkeypatch.setattr(toolkit_listen, "get_task_lock", lambda _: object())
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _, event: events.append(event),
    )
    if fail:
        with pytest.raises(ValueError) as caught:
            toolkit.shell_exec(
                command="fixture command", id="fixture-terminal"
            )
        assert caught.value is error
    else:
        assert (
            toolkit.shell_exec(
                command="fixture command", id="fixture-terminal"
            )
            == "fixture result"
        )
    assert calls == [
        {
            "command": "fixture command",
            "id": "fixture-terminal",
            "block": True,
            "timeout": 20.0,
        }
    ]
    assert [type(event).__name__ for event in events] == [
        "ActionActivateToolkitData",
        "ActionDeactivateToolkitData",
    ]
