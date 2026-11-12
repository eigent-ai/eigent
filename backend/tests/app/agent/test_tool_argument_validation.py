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

"""Tool arguments are bound and typed before a tool call is dispatched."""

from __future__ import annotations

import asyncio
import inspect
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from camel.agents._types import ToolCallRequest
from camel.toolkits import (
    FileToolkit as BaseFileToolkit,
    FunctionTool,
    ToolkitMessageIntegration,
)

from app.agent.listen_chat_agent import ListenChatAgent
from app.agent.toolkit import file_write_toolkit
from app.agent.toolkit.file_write_toolkit import FileToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.run_context import RunContext, run_context_scope
from app.run_journal import SQLiteRunJournal
from app.tool_validation import check_tool_arguments
from app.utils.listen import toolkit_listen

_LCA = "app.agent.listen_chat_agent"

pytestmark = pytest.mark.unit


def _send_status(
    message_title: str,
    message_description: str,
    message_attachment: str | None = None,
) -> str:
    """Send a status message.

    Args:
        message_title (str): The title of the message.
        message_description (str): The short description message.
        message_attachment (str | None): An optional attachment.

    Returns:
        str: Confirmation.
    """
    return "sent"


def _file_tools(root: Path) -> dict[str, FunctionTool]:
    toolkit = FileToolkit("project-1", working_directory=str(root))
    # The same status-message integration the agent factories install.
    toolkit = ToolkitMessageIntegration(
        message_handler=_send_status
    ).register_toolkits(toolkit)
    return {tool.get_function_name(): tool for tool in toolkit.get_tools()}


@pytest.fixture
def quiet_file_events(monkeypatch):
    for module in (toolkit_listen, file_write_toolkit):
        monkeypatch.setattr(module, "get_task_lock", lambda _task_id: object())
        monkeypatch.setattr(module, "_safe_put_queue", lambda *_args: None)
    monkeypatch.setattr(
        file_write_toolkit, "run_context_for_task", lambda _task_id: None
    )


# --- write_to_file: the status-message title is not the document title ---


def test_write_without_title_and_only_message_title_still_writes(
    tmp_path, quiet_file_events
):
    tool = _file_tools(tmp_path)["write_to_file"]
    # Production shape: the model filled the injected status fields only.
    arguments = {
        "content": "a,b\n1,2\n",
        "filename": "write-test/probe.csv",
        "encoding": "utf-8",
        "message_title": "Fixing CSV format",
        "message_description": "Rewriting the probe file",
        "use_latex": False,
    }

    checked = check_tool_arguments(tool, "write_to_file", arguments)

    assert checked.rejection is None
    result = tool(**checked.arguments)
    written = tmp_path / "write-test" / "probe.csv"
    assert result == f"Content successfully written to file: {written}"
    assert written.read_text() == "a,b\n1,2\n"


def test_omitted_title_defaults_to_the_file_name(
    tmp_path, quiet_file_events, monkeypatch
):
    received: list[str] = []

    def record_title(self, title, content, filename, encoding, use_latex):
        received.append(title)
        return f"Content successfully written to file: {filename}"

    monkeypatch.setattr(BaseFileToolkit, "write_to_file", record_title)
    tool = _file_tools(tmp_path)["write_to_file"]

    tool(content="# Plan", filename="reports/q3-plan.pdf")
    tool(title="Q3 plan", content="# Plan", filename="reports/q3-plan.pdf")

    assert received == ["q3-plan", "Q3 plan"]


def test_write_to_file_publishes_title_as_optional():
    signature = inspect.signature(FileToolkit.write_to_file)

    assert signature.parameters["title"].default is None
    assert signature.parameters["content"].default is inspect.Parameter.empty
    assert signature.parameters["filename"].default is inspect.Parameter.empty


def test_unknown_argument_is_rejected_by_name(tmp_path):
    tool = _file_tools(tmp_path)["write_to_file"]

    checked = check_tool_arguments(
        tool,
        "write_to_file",
        {"content": "x", "filename": "a.md", "overwrite": True},
    )

    assert checked.rejection is not None
    result = checked.rejection.to_tool_result()
    assert result["error_code"] == "unknown_tool_argument"
    assert result["field"] == "overwrite"
    assert "'overwrite'" in result["error"]
    assert "'filename'" in result["error"]  # lists what is accepted
    assert result["write_performed"] is False
    assert result["retryable"] is True


def test_missing_required_argument_is_rejected_by_name(tmp_path):
    tool = _file_tools(tmp_path)["write_to_file"]

    checked = check_tool_arguments(
        tool,
        "write_to_file",
        {"content": "x", "message_title": "Saving"},
    )

    assert checked.rejection is not None
    assert checked.rejection.error_code == "missing_tool_argument"
    assert checked.rejection.field == "filename"
    assert "'filename'" in str(checked.rejection)


def test_parameter_only_the_published_base_requires_is_not_missing(tmp_path):
    # shell_exec publishes CAMEL's signature, where ``id`` is required, but
    # Eigent's override gives ``id`` a default, so the call binds without it.
    toolkit = TerminalToolkit(
        "project-1",
        working_directory=str(tmp_path),
        clone_current_env=False,
    )
    toolkit = ToolkitMessageIntegration(
        message_handler=_send_status
    ).register_toolkits(toolkit)
    tool = {t.get_function_name(): t for t in toolkit.get_tools()}[
        "shell_exec"
    ]
    assert (
        "id" in tool.openai_tool_schema["function"]["parameters"]["required"]
    )

    without_id = check_tool_arguments(tool, "shell_exec", {"command": "ls"})
    without_command = check_tool_arguments(tool, "shell_exec", {"id": "s1"})

    assert without_id.rejection is None
    assert without_id.arguments == {"command": "ls"}
    assert without_command.rejection is not None
    assert without_command.rejection.field == "command"


# --- grep_files: quoted scalars follow the published schema ---


def test_quoted_integers_and_booleans_are_coerced_for_grep(
    tmp_path, quiet_file_events
):
    (tmp_path / "module.py").write_text("import os\nimport sys\nx = 1\n")
    tool = _file_tools(tmp_path)["grep_files"]
    arguments = {
        "pattern": "^import ",
        "path": str(tmp_path),
        "glob_pattern": "*.py",
        "output_mode": "content",
        "context_lines": "0",
        "head_limit": " 2 ",
        "ignore_case": "FALSE",
        "multiline": "false",
    }

    checked = check_tool_arguments(tool, "grep_files", arguments)

    assert checked.rejection is None
    assert checked.arguments["context_lines"] == 0
    assert checked.arguments["head_limit"] == 2
    assert checked.arguments["ignore_case"] is False
    assert checked.arguments["multiline"] is False
    assert checked.arguments["pattern"] == "^import "
    result = tool(**checked.arguments)
    assert "import os" in result
    assert "not supported" not in result


def test_quoted_true_becomes_true_not_a_truthy_string(tmp_path):
    tool = _file_tools(tmp_path)["grep_files"]

    for text, expected in (("true", True), ("True", True), ("false", False)):
        checked = check_tool_arguments(
            tool,
            "grep_files",
            {"pattern": "x", "path": ".", "ignore_case": text},
        )
        assert checked.arguments["ignore_case"] is expected


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("head_limit", "ten"),
        ("head_limit", "2.5"),
        ("head_limit", ""),
        ("context_lines", "3 lines"),
        ("ignore_case", "yes"),
    ],
)
def test_unparseable_scalar_is_rejected_by_name(tmp_path, name, value):
    tool = _file_tools(tmp_path)["grep_files"]

    checked = check_tool_arguments(
        tool, "grep_files", {"pattern": "x", "path": ".", name: value}
    )

    assert checked.rejection is not None
    assert checked.rejection.error_code == "invalid_tool_argument_type"
    assert checked.rejection.field == name
    assert f"'{name}'" in str(checked.rejection)
    # The journal keeps what the model sent, not a half-coerced request.
    assert checked.arguments[name] == value


def test_number_parameters_accept_decimal_spellings_only():
    def scale(ratio: float) -> float:
        """Scale.

        Args:
            ratio (float): The ratio.

        Returns:
            float: The ratio.
        """
        return ratio

    tool = FunctionTool(scale)

    assert check_tool_arguments(tool, "scale", {"ratio": "1.5"}).arguments == {
        "ratio": 1.5
    }
    assert check_tool_arguments(tool, "scale", {"ratio": "2"}).arguments == {
        "ratio": 2.0
    }
    for text in ("inf", "nan", "1e400", "1,5"):
        assert check_tool_arguments(tool, "scale", {"ratio": text}).rejection


# --- values and tools the check does not understand are left alone ---


def test_schema_without_a_type_is_left_untouched():
    def lookup(key, **options):
        return key

    tool = FunctionTool(
        lookup,
        openai_tool_schema={
            "type": "function",
            "function": {
                "name": "lookup",
                "description": "Look up a key.",
                "parameters": {
                    "type": "object",
                    "properties": {"key": {"description": "Any value."}},
                    "required": ["key"],
                },
            },
        },
    )

    checked = check_tool_arguments(tool, "lookup", {"key": "5", "extra": "1"})

    assert checked.rejection is None
    assert checked.arguments == {"key": "5", "extra": "1"}


def test_strings_and_ambiguous_unions_are_left_untouched():
    def tag(label: str, value: int | str, flag: bool | int = 0) -> str:
        """Tag.

        Args:
            label (str): A label.
            value (int | str): A value.
            flag (bool | int): A flag.

        Returns:
            str: The label.
        """
        return label

    arguments = {"label": "5", "value": "6", "flag": "true"}

    checked = check_tool_arguments(FunctionTool(tag), "tag", arguments)

    assert checked.rejection is None
    assert checked.arguments == arguments


def test_schema_that_allows_extra_properties_is_not_tightened():
    # JSON Schema allows extra properties unless the schema forbids them.
    # CAMEL's own tool schemas, including MCP tools, always forbid them.
    def remote_call(*, query: str) -> str:
        return query

    tool = FunctionTool(
        remote_call,
        openai_tool_schema={
            "type": "function",
            "function": {
                "name": "remote_call",
                "description": "Remote call.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Query."}
                    },
                    "required": ["query"],
                },
            },
        },
    )

    checked = check_tool_arguments(
        tool, "remote_call", {"query": "q", "trace": "on"}
    )

    assert checked.rejection is None


def test_tools_without_introspectable_metadata_are_left_untouched():
    tool = MagicMock(spec=FunctionTool)
    tool.func = MagicMock()

    checked = check_tool_arguments(tool, "anything", {"a": "1"})

    assert checked.rejection is None
    assert checked.arguments == {"a": "1"}


# --- the agent rejects before approval/dispatch and the Run continues ---


def _context(root: Path) -> RunContext:
    return RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="run-1",
        email="user@example.com",
        user_id="1",
        working_directory=root,
        task_output_root=root,
        camel_log_dir=root,
        binding_source="test",
        workdir_mode="direct-write",
        browser_port=9222,
    )


def _running_journal(root: Path) -> SQLiteRunJournal:
    journal = SQLiteRunJournal(root / "journal.sqlite3")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    return journal


def _agent(tool: FunctionTool) -> ListenChatAgent:
    agent = object.__new__(ListenChatAgent)
    agent._internal_tools = {tool.get_function_name(): tool}
    agent.api_task_id = "project-1"
    agent.agent_name = "writer"
    agent.process_task_id = "process-1"
    agent.mask_tool_output = False
    agent._secure_result_store = {}
    agent._record_tool_calling = MagicMock(return_value="recorded")
    return agent


def _note_tool(calls: list[dict], *, is_async: bool) -> FunctionTool:
    # An unregistered name is classified as an unsafe external write, which
    # is exactly the class that used to fail the Run as outcome_unknown.
    if is_async:

        async def save_note(path: str, body: str, copies: int = 1) -> str:
            """Save a note.

            Args:
                path (str): Where to save it.
                body (str): The note text.
                copies (int): How many copies to save.

            Returns:
                str: Confirmation.
            """
            calls.append({"path": path, "body": body, "copies": copies})
            return "saved"

    else:

        def save_note(path: str, body: str, copies: int = 1) -> str:
            """Save a note.

            Args:
                path (str): Where to save it.
                body (str): The note text.
                copies (int): How many copies to save.

            Returns:
                str: Confirmation.
            """
            calls.append({"path": path, "body": body, "copies": copies})
            return "saved"

    return FunctionTool(save_note)


@pytest.mark.parametrize("is_async", [False, True])
@pytest.mark.asyncio
async def test_unbindable_call_is_a_known_failure_before_dispatch(
    tmp_path, is_async
):
    calls: list[dict] = []
    agent = _agent(_note_tool(calls, is_async=is_async))
    request = ToolCallRequest(
        tool_name="save_note",
        # The model filled a near-synonym and omitted the real field.
        args={"path": "notes.md", "text": "hello"},
        tool_call_id="call-unbindable",
    )
    task_lock = MagicMock()
    task_lock.put_queue = AsyncMock()
    authorize = AsyncMock()

    with (
        _running_journal(tmp_path) as journal,
        run_context_scope(_context(tmp_path)),
        patch(
            "app.run_runtime.tool_checkpoint.get_default_run_journal",
            return_value=journal,
        ),
        patch(f"{_LCA}.get_task_lock", return_value=task_lock),
        patch(f"{_LCA}.authorize_tool_checkpoint", new=authorize),
        patch(
            f"{_LCA}._schedule_async_task",
            side_effect=lambda coroutine: coroutine.close(),
        ),
    ):
        if is_async:
            assert await agent._aexecute_tool(request) == "recorded"
        else:
            # The sync path drives its own event loop, as in production.
            assert (
                await asyncio.to_thread(agent._execute_tool, request)
                == "recorded"
            )

        tool_call = journal.list_tool_calls("run-1")[0]

    assert calls == []
    authorize.assert_not_awaited()
    assert tool_call.status == "failed"
    assert tool_call.outcome == "failed"
    assert tool_call.result["error_code"] == "unknown_tool_argument"
    assert tool_call.result["field"] == "text"
    assert "'body'" in tool_call.result["error"]
    assert tool_call.result["write_performed"] is False
    model_result = agent._record_tool_calling.call_args.args[2]
    assert model_result["retryable"] is True
    assert "'text'" in model_result["error"]


@pytest.mark.parametrize("is_async", [False, True])
@pytest.mark.asyncio
async def test_quoted_integer_is_coerced_before_the_checkpoint_records_it(
    tmp_path, is_async
):
    calls: list[dict] = []
    agent = _agent(_note_tool(calls, is_async=is_async))
    request = ToolCallRequest(
        tool_name="save_note",
        args={"path": "notes.md", "body": "hello", "copies": "3"},
        tool_call_id="call-coerced",
    )
    task_lock = MagicMock()
    task_lock.put_queue = AsyncMock()

    with (
        _running_journal(tmp_path) as journal,
        run_context_scope(_context(tmp_path)),
        patch(
            "app.run_runtime.tool_checkpoint.get_default_run_journal",
            return_value=journal,
        ),
        patch(f"{_LCA}.get_task_lock", return_value=task_lock),
        patch(f"{_LCA}.authorize_tool_checkpoint", new=AsyncMock()),
        patch(
            f"{_LCA}._schedule_async_task",
            side_effect=lambda coroutine: coroutine.close(),
        ),
    ):
        if is_async:
            await agent._aexecute_tool(request)
        else:
            await asyncio.to_thread(agent._execute_tool, request)

        tool_call = journal.list_tool_calls("run-1")[0]

    assert calls == [{"path": "notes.md", "body": "hello", "copies": 3}]
    assert tool_call.status == "completed"
    assert tool_call.request["copies"] == 3
    recorded_args = agent._record_tool_calling.call_args.args[1]
    assert recorded_args["copies"] == 3


def test_tool_objects_that_are_not_function_tools_are_left_untouched():
    class CustomTool:
        def func(self):
            return None

        def get_openai_tool_schema(self):
            return {
                "function": {
                    "parameters": {
                        "properties": {"count": {"type": "integer"}},
                        "additionalProperties": False,
                    }
                }
            }

        def __call__(self, **kwargs):
            return kwargs

    checked = check_tool_arguments(CustomTool(), "custom", {"count": "x"})

    assert checked.rejection is None
    assert checked.arguments == {"count": "x"}


# --- MCP tools: the server validates keys its schema does not list ---


def _mcp_tool(name: str, input_schema: dict) -> FunctionTool:
    # Built exactly as CAMEL's MCPClient.get_tools() builds a server's tool.
    from camel.utils.mcp_client import MCPClient
    from mcp import types

    client = MCPClient({"command": "true"})
    remote = types.Tool(
        name=name, description="Remote tool.", inputSchema=input_schema
    )
    return FunctionTool(
        client.generate_function_from_mcp_tool(remote),
        openai_tool_schema=client._build_tool_schema(remote),
    )


_TYPED_MCP_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "Search text."},
        "limit": {"type": "integer", "description": "Maximum results."},
    },
    "required": ["query"],
}


def test_mcp_tool_forwards_unknown_arguments_to_the_server():
    tool = _mcp_tool("search_docs", _TYPED_MCP_SCHEMA)
    # CAMEL forbids extra keys in what it publishes, whatever the server says.
    parameters = tool.openai_tool_schema["function"]["parameters"]
    assert parameters["additionalProperties"] is False

    checked = check_tool_arguments(
        tool, "search_docs", {"query": "q", "limit": "3", "trace": "on"}
    )

    assert checked.rejection is None
    assert checked.arguments == {"query": "q", "limit": 3, "trace": "on"}


def test_mcp_tool_still_rejects_missing_and_unparseable_arguments():
    tool = _mcp_tool("search_docs", _TYPED_MCP_SCHEMA)

    missing = check_tool_arguments(tool, "search_docs", {"limit": 3})
    unparseable = check_tool_arguments(
        tool, "search_docs", {"query": "q", "limit": "three"}
    )

    assert missing.rejection is not None
    assert missing.rejection.error_code == "missing_tool_argument"
    assert missing.rejection.field == "query"
    assert unparseable.rejection is not None
    assert unparseable.rejection.error_code == "invalid_tool_argument_type"
    assert unparseable.rejection.field == "limit"


def test_open_schema_mcp_tool_receives_its_arguments():
    # A server schema with no declared properties still takes arguments.
    tool = _mcp_tool("run_action", {"type": "object"})
    arguments = {"action": "sync", "count": "2"}

    checked = check_tool_arguments(tool, "run_action", arguments)

    assert checked.rejection is None
    assert checked.arguments == arguments


@pytest.mark.asyncio
async def test_mcp_dispatch_sends_unknown_arguments_to_the_server(tmp_path):
    tool = _mcp_tool("search_docs", _TYPED_MCP_SCHEMA)
    server_call = AsyncMock(return_value="found")
    tool.func.async_call = server_call
    agent = _agent(tool)
    request = ToolCallRequest(
        tool_name="search_docs",
        args={"query": "q", "limit": "3", "trace": "on"},
        tool_call_id="call-mcp",
    )
    task_lock = MagicMock()
    task_lock.put_queue = AsyncMock()

    with (
        _running_journal(tmp_path) as journal,
        run_context_scope(_context(tmp_path)),
        patch(
            "app.run_runtime.tool_checkpoint.get_default_run_journal",
            return_value=journal,
        ),
        patch(f"{_LCA}.get_task_lock", return_value=task_lock),
        patch(f"{_LCA}.authorize_tool_checkpoint", new=AsyncMock()),
    ):
        await agent._aexecute_tool(request)

        tool_call = journal.list_tool_calls("run-1")[0]

    server_call.assert_awaited_once_with(query="q", limit=3, trace="on")
    assert tool_call.status == "completed"
