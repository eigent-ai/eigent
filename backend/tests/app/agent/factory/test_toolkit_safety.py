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

from types import SimpleNamespace

from app.agent.factory.toolkit_assembler import _mcp_config, _tag_tools
from app.agent.toolkit.depth_limited_agent_toolkit import (
    DepthLimitedAgentToolkit,
)
from app.agent.toolkit.file_write_toolkit import FileToolkit
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.hybrid_browser_toolkit import HybridBrowserToolkit
from app.agent.toolkit.observable_todo_toolkit import ObservableTodoToolkit
from app.agent.toolkit.screenshot_toolkit import ScreenshotToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.skill_toolkit import SkillToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.run_policy import ToolSafetyClass
from app.run_runtime.tool_checkpoint import declared_tool_safety


class NamedTool:
    def __init__(self, name: str):
        self.name = name

    def get_function_name(self) -> str:
        return self.name


def test_titleized_toolkit_names_apply_trusted_read_declarations():
    screenshot = NamedTool("read_image")
    search = NamedTool("vendor_search")
    browser_read = NamedTool("browser_get_page_snapshot")
    browser_write = NamedTool("browser_click")

    _tag_tools([screenshot], ScreenshotToolkit.toolkit_name())
    _tag_tools([search], SearchToolkit.toolkit_name())
    _tag_tools(
        [browser_read, browser_write], HybridBrowserToolkit.toolkit_name()
    )

    assert declared_tool_safety(screenshot, "read_image", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert declared_tool_safety(search, "vendor_search", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert declared_tool_safety(
        browser_read, "browser_get_page_snapshot", {}
    ) == (ToolSafetyClass.SAFE_READ, None)
    assert declared_tool_safety(browser_write, "browser_click", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_code_owned_todo_write_is_safe_internal_progress_state():
    todo_write = NamedTool("todo_write")
    step_update = NamedTool("step_update")
    other_todo_tool = NamedTool("todo_delete")

    _tag_tools(
        [todo_write, step_update, other_todo_tool],
        ObservableTodoToolkit.toolkit_name(),
    )

    assert declared_tool_safety(todo_write, "todo_write", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert declared_tool_safety(step_update, "step_update", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert declared_tool_safety(other_todo_tool, "todo_delete", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_code_owned_human_notice_is_safe_internal_progress_message():
    send_message = NamedTool("send_message_to_user")

    _tag_tools([send_message], HumanToolkit.toolkit_name())

    assert declared_tool_safety(send_message, "send_message_to_user", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )


def test_untrusted_send_message_name_does_not_bypass_approval():
    send_message = NamedTool("send_message_to_user")

    _tag_tools([send_message], "Third Party MCP")

    assert declared_tool_safety(send_message, "send_message_to_user", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_untrusted_mcp_todo_write_name_does_not_bypass_approval():
    todo_write = NamedTool("todo_write")

    _tag_tools([todo_write], "Third Party MCP")

    assert declared_tool_safety(todo_write, "todo_write", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_code_owned_discovery_and_file_reads_are_exactly_safe():
    list_skills = NamedTool("list_skills")
    load_skill = NamedTool("load_skill")
    read_file = NamedTool("read_file")
    glob_files = NamedTool("glob_files")
    write_file = NamedTool("write_to_file")

    _tag_tools([list_skills, load_skill], SkillToolkit.toolkit_name())
    _tag_tools(
        [read_file, glob_files, write_file],
        FileToolkit.toolkit_name(),
    )

    for tool in (list_skills, load_skill, read_file, glob_files):
        assert declared_tool_safety(tool, tool.name, {}) == (
            ToolSafetyClass.SAFE_READ,
            None,
        )
    assert declared_tool_safety(write_file, "write_to_file", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_code_owned_agent_delegation_is_internal_control_only():
    run_subagent = NamedTool("agent_run_subagent")
    get_output = NamedTool("agent_get_task_output")
    stop_task = NamedTool("agent_stop_task")
    untrusted = NamedTool("agent_run_subagent")

    _tag_tools(
        [run_subagent, get_output, stop_task],
        DepthLimitedAgentToolkit.toolkit_name(),
    )
    _tag_tools([untrusted], "Third Party MCP")

    for tool in (run_subagent, get_output, stop_task):
        assert declared_tool_safety(tool, tool.name, {}) == (
            ToolSafetyClass.INTERNAL_CONTROL,
            None,
        )
    assert declared_tool_safety(untrusted, untrusted.name, {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_code_owned_terminal_session_cleanup_is_replay_safe():
    kill_session = NamedTool("shell_kill_process")
    shell_exec = NamedTool("shell_exec")

    _tag_tools(
        [kill_session, shell_exec],
        TerminalToolkit.toolkit_name(),
    )

    assert declared_tool_safety(kill_session, "shell_kill_process", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert declared_tool_safety(shell_exec, "shell_exec", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_untrusted_terminal_cleanup_name_remains_conservative():
    kill_session = NamedTool("shell_kill_process")

    _tag_tools([kill_session], "Third Party MCP")

    assert declared_tool_safety(kill_session, "shell_kill_process", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_immutable_wrapper_declaration_falls_back_to_wrapped_function():
    def read_image():
        return None

    class ImmutableWrapper:
        __slots__ = ("func",)

        def __init__(self):
            self.func = read_image

        def get_function_name(self) -> str:
            return "read_image"

    tool = ImmutableWrapper()
    _tag_tools([tool], ScreenshotToolkit.toolkit_name())

    assert declared_tool_safety(tool, "read_image", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )


def test_mcp_process_environment_excludes_secret_broker_authority():
    options = SimpleNamespace(
        installed_mcp={
            "mcpServers": {
                "example": {
                    "command": "example-mcp",
                    "env": {
                        "EIGENT_WORKSPACE_SECRET_BROKER_ENDPOINT": (
                            "http://127.0.0.1:1234"
                        ),
                        "EIGENT_WORKSPACE_SECRET_BROKER_CAPABILITY": (
                            "broker-secret"
                        ),
                        "EIGENT_OBSOLETE_SECRET_BROKER_CAPABILITY": (
                            "obsolete-secret"
                        ),
                        "AUTHORIZATION": "consumer-authorization",
                        "MCP_API_TOKEN": "consumer-secret",
                    },
                }
            }
        }
    )

    config = _mcp_config(options, None)

    assert config is not None
    environment = config["mcpServers"]["example"]["env"]
    assert environment["MCP_API_TOKEN"] == "consumer-secret"
    assert environment["AUTHORIZATION"] == "consumer-authorization"
    assert "EIGENT_WORKSPACE_SECRET_BROKER_ENDPOINT" not in environment
    assert "EIGENT_WORKSPACE_SECRET_BROKER_CAPABILITY" not in environment
    assert "EIGENT_OBSOLETE_SECRET_BROKER_CAPABILITY" not in environment
