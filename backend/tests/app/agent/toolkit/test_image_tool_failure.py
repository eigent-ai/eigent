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

"""Image fixture -> real vision agent/SDK -> tool wrapper -> durable events."""

import asyncio
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from camel.agents._types import ToolCallRequest
from camel.models import ModelFactory
from camel.toolkits import FunctionTool
from openai import OpenAI
from PIL import Image

from app.agent.agent_model import _configure_responses_instructions
from app.agent.listen_chat_agent import ListenChatAgent
from app.agent.toolkit.screenshot_toolkit import ScreenshotToolkit
from app.run_context import RunContext, run_context_scope
from app.run_journal import SQLiteRunJournal
from app.run_policy import ToolSafetyClass
from app.run_runtime import tool_checkpoint
from app.run_runtime.tool_checkpoint import UnsafeToolOutcomeError
from app.service.task import (
    ActionActivateToolkitData,
    ActionDeactivateToolkitData,
)
from app.utils.listen import toolkit_listen
from app.utils.listen.toolkit_listen import _log_deactivate


@pytest.fixture
def tool_environment(tmp_path, monkeypatch):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(run_id="run-image", project_id="project-image")
    journal.create_run_attempt(
        "run-image",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    monkeypatch.setattr(
        tool_checkpoint, "get_default_run_journal", lambda: journal
    )
    monkeypatch.setattr(tool_checkpoint, "_notify_cloud_sync", lambda: None)
    events = []

    def collect(event):
        data = getattr(event, "data", {})
        if (
            data.get("agent_name") == "image_agent"
            and data.get("process_task_id") == "process-image"
            and data.get("toolkit_name") == "Screenshot Toolkit"
            and data.get("method_name")
            in {"read image", "take screenshot and read image"}
        ):
            # Never filter on tool_call_id, action, or result: the assertions
            # below must still detect wrong IDs, event order, and error text.
            events.append(event)

    lock = SimpleNamespace(put_queue=AsyncMock(side_effect=collect))
    locks = {"project-image": lock}

    def get_lock(project_id):
        if project_id not in locks:
            locks[project_id] = SimpleNamespace(put_queue=AsyncMock())
        return locks[project_id]

    monkeypatch.setattr("app.agent.listen_chat_agent.get_task_lock", get_lock)
    monkeypatch.setattr(
        "app.utils.listen.toolkit_listen.get_task_lock", get_lock
    )
    monkeypatch.setattr(
        "app.utils.listen.toolkit_listen._safe_put_queue",
        lambda task_lock, event: collect(event) if task_lock is lock else None,
    )
    monkeypatch.setattr(
        "app.agent.listen_chat_agent.authorize_tool_checkpoint", AsyncMock()
    )

    def agent_for(tool):
        agent = object.__new__(ListenChatAgent)
        agent._internal_tools = {tool.get_function_name(): tool}
        agent.api_task_id = "project-image"
        agent.agent_name = "image_agent"
        agent.process_task_id = "process-image"
        agent.mask_tool_output = True
        agent._secure_result_store = {}
        agent._record_tool_calling = MagicMock(
            side_effect=lambda name, args, result, *a, **kw: result
        )
        return agent

    context = RunContext(
        space_id="space-fixture",
        project_id="project-image",
        run_id="run-image",
        task_id="run-image",
        email="fixture@example.test",
        user_id="fixture",
        working_directory=tmp_path,
        task_output_root=tmp_path,
        camel_log_dir=tmp_path,
        binding_source="test",
        workdir_mode="direct-write",
        browser_port=0,
    )
    with journal, run_context_scope(context):
        yield journal, events, agent_for


def execute(agent, request, asynchronous):
    if asynchronous:
        return asyncio.run(agent._aexecute_tool(request))
    return agent._execute_tool(request)


def image_tool_logs(caplog, method="read image"):
    prefix = (
        "[TOOLKIT DEACTIVATE] Toolkit: Screenshot Toolkit | "
        f"Method: {method} | "
    )
    messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "toolkit_listen"
        and record.getMessage().startswith(prefix)
        and "| Agent: image_agent |" in record.getMessage()
    ]
    assert messages, "The target image tool must emit a deactivation log"
    return "\n".join(messages)


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("route", ["openai", "openai-compatible-model"])
@pytest.mark.parametrize(
    "outcome",
    [
        "http400",
        "http400-stream",
        "stream-failed",
        "stream-error",
        "stream-error-done",
        "stream-error-no-text",
        "stream-disconnected",
        "success",
        "success-stream",
    ],
)
def test_image_model_outcome_reaches_durable_tool_events(
    tool_environment, tmp_path, caplog, asynchronous, outcome, route
):
    journal, events, agent_for = tool_environment
    path = tmp_path / "fixture.png"
    Image.new("RGB", (2, 2), (40, 80, 120)).save(path)
    requests = []
    stream = outcome not in {"http400", "success"}
    success = outcome.startswith("success")

    def reject(request):
        requests.append(json.loads(request.content))
        # Simulate unrelated object cleanup without running a real tool.
        _log_deactivate(
            "Terminal Toolkit",
            "cleanup",
            "unrelated-task",
            "other_agent",
            None,
        )
        if outcome.startswith("stream-error"):
            response = {
                "id": "resp_fixture",
                "object": "response",
                "created_at": 1,
                "status": "in_progress",
                "model": "gpt-6-astra",
                "output": [],
            }
            item = {
                "id": "msg_fixture",
                "type": "message",
                "role": "assistant",
                "status": "in_progress",
                "content": [],
            }
            wire_events = [
                {"type": "response.created", "response": response},
                {"type": "response.in_progress", "response": response},
                {
                    "type": "response.output_item.added",
                    "output_index": 0,
                    "item": item,
                },
                {
                    "type": "response.content_part.added",
                    "item_id": item["id"],
                    "output_index": 0,
                    "content_index": 0,
                    "part": {
                        "type": "output_text",
                        "text": "",
                        "annotations": [],
                    },
                },
            ]
            if outcome != "stream-error-no-text":
                wire_events.append(
                    {
                        "type": "response.output_text.delta",
                        "delta": "partial inspection",
                        "item_id": item["id"],
                        "output_index": 0,
                        "content_index": 0,
                        "logprobs": [],
                    }
                )
            # Standard flat ResponseErrorEvent, distinct from response.failed.
            wire_events.append(
                {
                    "type": "error",
                    "code": "server_error",
                    "message": "fixture image request rejected",
                    "param": None,
                }
            )
            for sequence, event in enumerate(wire_events):
                event["sequence_number"] = sequence
            body = "".join(
                f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
                for event in wire_events
            )
            if outcome == "stream-error-done":
                body += "data: [DONE]\n\n"
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text=body,
            )
        if success:
            response = {
                "id": "resp_fixture",
                "object": "response",
                "created_at": 1,
                "status": "completed",
                "model": "gpt-6-astra",
                "output": [
                    {
                        "id": "msg_fixture",
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "image reviewed",
                                "annotations": [],
                            }
                        ],
                    }
                ],
            }
            if stream:
                events = [
                    {
                        "type": "response.output_text.delta",
                        "delta": "image reviewed",
                        "output_index": 0,
                        "content_index": 0,
                        "item_id": "msg_fixture",
                    },
                    {"type": "response.completed", "response": response},
                ]
                return httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    text="".join(
                        f"data: {json.dumps(event)}\n\n" for event in events
                    ),
                )
            return httpx.Response(200, json=response)
        if outcome.startswith("stream-"):
            partial = 'data: {"type":"response.output_text.delta","delta":"partial inspection","output_index":0,"content_index":0,"item_id":"msg_fixture"}\n\n'
            if outcome == "stream-failed":
                failed = {
                    "type": "response.failed",
                    "response": {
                        "id": "resp_fixture",
                        "status": "failed",
                        "error": {
                            "code": "server_error",
                            "message": "fixture image request rejected",
                        },
                    },
                }
                return httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    text=partial + f"data: {json.dumps(failed)}\n\n",
                )

            class InterruptedStream(httpx.SyncByteStream):
                def __iter__(self):
                    yield partial.encode()
                    raise httpx.ReadError("fixture image request rejected")

            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                stream=InterruptedStream(),
            )
        # Synthetic provider rejection, not a recovered historical HTTP body.
        return httpx.Response(
            400,
            json={
                "error": {
                    "message": "fixture image request rejected",
                    "type": "invalid_request_error",
                    "param": "input[0].content",
                    "code": "invalid_value",
                }
            },
        )

    with OpenAI(
        api_key="fixture-key",
        base_url="https://fixture.example.test/v1",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(reject)),
    ) as client:
        backend = ModelFactory.create(
            model_platform=route,
            model_type="gpt-6-astra",
            api_key="fixture-key",
            client=client,
            api_mode="responses",
            model_config_dict={"stream": stream, "store": False},
            token_counter=MagicMock(
                count_tokens_from_messages=MagicMock(return_value=10)
            ),
        )
        _configure_responses_instructions(backend)
        toolkit = ScreenshotToolkit(
            "project-image", "image_agent", working_directory=str(tmp_path)
        )
        toolkit._agent = SimpleNamespace(
            model_backend=backend, step_timeout=None
        )
        [tool] = toolkit.get_tools()
        agent = agent_for(tool)
        if success:
            agent.mask_tool_output = False
        request = ToolCallRequest(
            tool_name="read_image",
            args={"image_path": str(path), "instruction": "inspect fixture"},
            tool_call_id="image-call",
        )
        with caplog.at_level(logging.INFO, logger="toolkit_listen"):
            result = execute(agent, request, asynchronous)

    assert requests, "The fixture must reach the actual SDK HTTP transport"
    assert "Toolkit: Terminal Toolkit | Method: cleanup |" in caplog.text
    assert "Agent: other_agent | Status: SUCCESS" in caplog.text
    target_logs = image_tool_logs(caplog)
    [call] = journal.list_tool_calls("run-image")
    if success:
        assert result == "image reviewed"
        assert call.status == "completed"
        assert "Status: SUCCESS" in target_logs
        assert "Status: ERROR" not in target_logs
        return
    assert call.status == "failed"
    assert call.outcome == "failed"
    assert call.safety_class == ToolSafetyClass.SAFE_READ
    assert "fixture image request rejected" in str(result)
    assert "successfully" not in str(result)
    assert not agent._secure_result_store
    tool_events = [
        event
        for event in journal.list_events("run-image")
        if event.event_type.startswith("tool.")
    ]
    assert tool_events[-1].event_type == "tool.failed"
    assert not any(
        event.event_type in {"tool.completed", "tool.outcome_unknown"}
        for event in tool_events
    )
    assert "Status: ERROR" in target_logs
    assert "Status: SUCCESS" not in target_logs
    assert len(events) == 2
    assert [event.action.value for event in events] == [
        "activate_toolkit",
        "deactivate_toolkit",
    ]
    assert events[0].data["tool_call_id"] == call.tool_call_id
    assert events[-1].data["tool_call_id"] == call.tool_call_id
    assert "fixture image request rejected" in events[-1].data["message"]


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("queue_entry", ["safe_put_queue", "put_queue"])
def test_image_events_ignore_unrelated_cleanup(
    tool_environment, tmp_path, caplog, asynchronous, queue_entry
):
    from app.agent import listen_chat_agent

    async def emit_noise():
        # Each pair differs at an actual routing/ownership boundary. No real
        # Terminal object or cleanup runs, and call IDs cannot define scope.
        for project_id, overrides in [
            ("other-project", {}),
            ("project-image", {"agent_name": "other_agent"}),
            ("project-image", {"process_task_id": "other-process"}),
            (
                "project-image",
                {"toolkit_name": "Terminal Toolkit", "method_name": "cleanup"},
            ),
            ("project-image", {"method_name": "cleanup"}),
        ]:
            lock = toolkit_listen.get_task_lock(project_id)
            assert listen_chat_agent.get_task_lock(project_id) is lock
            data = {
                "agent_name": "image_agent",
                "process_task_id": "process-image",
                "toolkit_name": "Screenshot Toolkit",
                "method_name": "read image",
                "tool_call_id": "unrelated-call",
                "message": "unrelated cleanup",
                **overrides,
            }
            for event_type in (
                ActionActivateToolkitData,
                ActionDeactivateToolkitData,
            ):
                event = event_type(data=data.copy())
                if queue_entry == "safe_put_queue":
                    toolkit_listen._safe_put_queue(lock, event)
                else:
                    await lock.put_queue(event)

    asyncio.run(emit_noise())
    test_image_model_outcome_reaches_durable_tool_events(
        tool_environment, tmp_path, caplog, asynchronous, "http400", "openai"
    )


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize(
    "fault", ["activate-id", "deactivate-id", "error-message", "event-order"]
)
def test_target_event_errors_still_fail_assertions(
    tool_environment, tmp_path, caplog, monkeypatch, asynchronous, fault
):
    journal, events, _ = tool_environment
    put_queue = toolkit_listen._safe_put_queue
    target_lock = toolkit_listen.get_task_lock("project-image")
    pending = []

    def corrupt_target_event(lock, event):
        if (
            lock is not target_lock
            or event.data.get("agent_name") != "image_agent"
            or event.data.get("toolkit_name") != "Screenshot Toolkit"
            or event.data.get("method_name") != "read image"
        ):
            put_queue(lock, event)
            return
        activate = event.action.value == "activate_toolkit"
        if fault == "activate-id" and activate:
            event.data["tool_call_id"] = "wrong-call"
        elif fault == "deactivate-id" and not activate:
            event.data["tool_call_id"] = "wrong-call"
        elif fault == "error-message" and not activate:
            event.data["message"] = "incorrect result"
        elif fault == "event-order":
            if activate:
                pending.append(event)
                return
            put_queue(lock, event)
            put_queue(lock, pending.pop())
            return
        put_queue(lock, event)

    monkeypatch.setattr(
        toolkit_listen, "_safe_put_queue", corrupt_target_event
    )
    with pytest.raises(AssertionError):
        test_image_model_outcome_reaches_durable_tool_events(
            tool_environment,
            tmp_path,
            caplog,
            asynchronous,
            "http400",
            "openai",
        )
    # The invalid target events must remain visible, not disappear into a
    # collector filter and merely trigger an unrelated event-count failure.
    assert len(events) == 2
    assert journal.list_tool_calls("run-image")[0].status == "failed"
    if fault.endswith("-id"):
        index = 0 if fault == "activate-id" else 1
        assert events[index].data["tool_call_id"] == "wrong-call"
    elif fault == "error-message":
        assert events[-1].data["message"] == "incorrect result"
    else:
        assert [event.action.value for event in events] == [
            "deactivate_toolkit",
            "activate_toolkit",
        ]


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(msgs=[], msg=None, info={}),
        SimpleNamespace(msgs=[SimpleNamespace(content="")], info={}),
    ],
)
def test_empty_image_reply_fails(
    tool_environment, tmp_path, monkeypatch, response
):
    journal, _, agent_for = tool_environment
    path = tmp_path / "fixture.png"
    Image.new("RGB", (2, 2)).save(path)
    monkeypatch.setattr(
        "app.agent.toolkit.screenshot_toolkit.ChatAgent",
        lambda **kw: SimpleNamespace(step=lambda _: response),
    )
    toolkit = ScreenshotToolkit(
        "project-image", "image_agent", working_directory=str(tmp_path)
    )
    toolkit._agent = SimpleNamespace(
        model_backend=MagicMock(), step_timeout=None
    )
    [tool] = toolkit.get_tools()
    result = execute(
        agent_for(tool),
        ToolCallRequest(
            tool_name="read_image",
            args={"image_path": str(path)},
            tool_call_id="empty-call",
        ),
        False,
    )
    assert journal.list_tool_calls("run-image")[0].status == "failed"
    assert "empty image response" in result


def test_image_text_is_not_classified_by_error_prefix(
    tool_environment, tmp_path, monkeypatch
):
    journal, _, agent_for = tool_environment
    path = tmp_path / "fixture.png"
    Image.new("RGB", (2, 2)).save(path)
    response = SimpleNamespace(
        msgs=[
            SimpleNamespace(
                content="Error: this is text printed in the fixture"
            )
        ],
        info={},
    )
    monkeypatch.setattr(
        "app.agent.toolkit.screenshot_toolkit.ChatAgent",
        lambda **kw: SimpleNamespace(step=lambda _: response),
    )
    toolkit = ScreenshotToolkit(
        "project-image", "image_agent", working_directory=str(tmp_path)
    )
    toolkit._agent = SimpleNamespace(
        model_backend=MagicMock(), step_timeout=None
    )
    [tool] = toolkit.get_tools()
    agent = agent_for(tool)
    agent.mask_tool_output = False
    result = execute(
        agent,
        ToolCallRequest(
            tool_name="read_image",
            args={"image_path": str(path)},
            tool_call_id="success-call",
        ),
        False,
    )
    assert result == response.msgs[0].content
    assert journal.list_tool_calls("run-image")[0].status == "completed"


def test_safety_declaration_applies_only_to_existing_image_reader(tmp_path):
    toolkit = ScreenshotToolkit(
        "project-image",
        "image_agent",
        working_directory=str(tmp_path),
        enable_desktop_capture=True,
    )
    tools = {tool.get_function_name(): tool for tool in toolkit.get_tools()}
    assert tool_checkpoint.declared_tool_safety(
        tools["read_image"], "read_image", {}
    ) == (ToolSafetyClass.SAFE_READ, None)
    capture = tools["take_screenshot_and_read_image"]
    assert tool_checkpoint.declared_tool_safety(
        capture, capture.get_function_name(), {}
    ) == (ToolSafetyClass.UNSAFE_WRITE, None)
    assert tool_checkpoint.classify_tool_safety("read_image", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


@pytest.mark.parametrize("capture_enabled", [False, True])
def test_capture_model_failure_does_not_report_success(
    tool_environment, tmp_path, monkeypatch, caplog, capture_enabled
):
    journal, _, agent_for = tool_environment
    toolkit = ScreenshotToolkit(
        "project-image",
        "image_agent",
        working_directory=str(tmp_path),
        enable_desktop_capture=capture_enabled,
    )
    # In-memory pixels only. Never call the native screen-capture API.
    toolkit.ImageGrab = SimpleNamespace(grab=lambda: Image.new("RGB", (2, 2)))
    toolkit._agent = SimpleNamespace(
        model_backend=MagicMock(), step_timeout=None
    )
    monkeypatch.setattr(
        "app.agent.toolkit.screenshot_toolkit.ChatAgent",
        lambda **kw: SimpleNamespace(
            step=MagicMock(side_effect=RuntimeError("fixture model failed"))
        ),
    )
    agent = agent_for(FunctionTool(toolkit.take_screenshot_and_read_image))
    request = ToolCallRequest(
        tool_name="take_screenshot_and_read_image",
        args={"filename": "capture-fixture.png"},
        tool_call_id="capture-call",
    )
    with caplog.at_level(logging.INFO, logger="toolkit_listen"):
        _log_deactivate(
            "Terminal Toolkit",
            "cleanup",
            "unrelated-task",
            "other_agent",
            None,
        )
        if capture_enabled:
            with pytest.raises(UnsafeToolOutcomeError):
                execute(agent, request, False)
            assert (tmp_path / "capture-fixture.png").exists()
        else:
            result = execute(agent, request, False)
            assert "disabled" in str(result)
            assert not (tmp_path / "capture-fixture.png").exists()
    [call] = journal.list_tool_calls("run-image")
    assert call.status == ("outcome_unknown" if capture_enabled else "failed")
    target_logs = image_tool_logs(caplog, "take screenshot and read image")
    assert "Status: ERROR" in target_logs
    assert "Status: SUCCESS" not in target_logs
    if capture_enabled:
        reader_logs = image_tool_logs(caplog)
        assert "Status: ERROR" in reader_logs
        assert "Status: SUCCESS" not in reader_logs


@pytest.mark.parametrize("asynchronous", [False, True])
def test_unknown_write_exception_remains_fail_closed(
    tool_environment, asynchronous
):
    journal, _, agent_for = tool_environment

    def unregistered_write():
        """A write that may already have happened."""
        raise RuntimeError("outcome cannot be established")

    agent = agent_for(FunctionTool(unregistered_write))
    request = ToolCallRequest(
        tool_name="unregistered_write", args={}, tool_call_id="write-call"
    )
    with pytest.raises(UnsafeToolOutcomeError):
        execute(agent, request, asynchronous)
    [call] = journal.list_tool_calls("run-image")
    assert call.status == "outcome_unknown"
    assert call.safety_class == ToolSafetyClass.UNSAFE_WRITE
