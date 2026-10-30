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

"""Memory rejections must preserve both provenance and final delivery."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from camel.agents._types import ToolCallRequest
from camel.models import StubModel
from camel.toolkits import FunctionTool
from camel.types import ChatCompletion, ModelType

from app.agent import listen_chat_agent
from app.agent.listen_chat_agent import ListenChatAgent
from app.agent.toolkit import memory_toolkit
from app.agent.toolkit.memory_toolkit import MemoryToolkit
from app.lightweight_memory import (
    LightweightMemoryService,
    service as memory_service,
)
from app.run_context import RunContext, run_context_scope
from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.run_policy import ToolSafetyClass
from app.run_runtime import tool_checkpoint
from app.run_runtime.tool_checkpoint import (
    ToolCheckpointPersistenceError,
    UnsafeToolOutcomeError,
    finish_tool_checkpoint,
    prepare_tool_checkpoint,
)
from app.tool_validation import (
    ToolPreWriteValidationError,
    prewrite_validation_result,
)


@pytest.fixture
def memory_run(tmp_path, monkeypatch):
    """Use an isolated journal, real FunctionTools, and no provider calls."""
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        journal.ensure_run(run_id="other-run", project_id="other-project")
        for event_id, event_type, run_id in (
            ("user-1", "user.message", "run-1"),
            ("assistant-1", "assistant.delta", "run-1"),
            ("tool-1", "tool.completed", "run-1"),
            ("other-user", "user.message", "other-run"),
        ):
            journal.append_event(
                run_id,
                RunEventDraft(
                    event_id=event_id,
                    event_type=event_type,
                    payload={"content": "Wait for storyboard approval."},
                ),
            )
        service = LightweightMemoryService(journal)
        monkeypatch.setattr(memory_service, "_token_encoding", lambda: None)
        monkeypatch.setattr(
            memory_toolkit, "get_lightweight_memory_service", lambda: service
        )
        monkeypatch.setattr(
            tool_checkpoint, "get_default_run_journal", lambda: journal
        )
        monkeypatch.setattr(
            tool_checkpoint, "_notify_cloud_sync", lambda: None
        )
        context = RunContext(
            space_id="space-1",
            project_id="project-1",
            run_id="run-1",
            task_id="run-1",
            email="test@example.com",
            user_id="1",
            working_directory=tmp_path,
            task_output_root=tmp_path,
            camel_log_dir=tmp_path,
            binding_source="test",
            workdir_mode="direct-write",
            browser_port=9222,
        )
        task_lock = SimpleNamespace(run_context=context, put_queue=AsyncMock())
        monkeypatch.setattr(
            memory_toolkit, "get_task_lock", lambda _: task_lock
        )
        monkeypatch.setattr(
            listen_chat_agent, "get_task_lock", lambda _: task_lock
        )
        monkeypatch.setattr(
            listen_chat_agent, "authorize_tool_checkpoint", AsyncMock()
        )
        monkeypatch.setattr(
            listen_chat_agent,
            "_schedule_async_task",
            lambda coro: coro.close(),
        )
        toolkit = MemoryToolkit("run-1")
        tool = next(
            tool
            for tool in toolkit.get_tools()
            if tool.get_function_name() == "remember_project_memory"
        )
        apply = MagicMock(wraps=journal.apply_memory_mutation)
        monkeypatch.setattr(journal, "apply_memory_mutation", apply)
        with run_context_scope(context):
            yield SimpleNamespace(
                journal=journal, service=service, tool=tool, apply=apply
            )


def _arguments(**overrides):
    return {
        "kind": "todo",
        "content": "Wait for storyboard approval.",
        "reason": "Keep the approval requirement for delivery.",
        "source_trust": "user_asserted",
        **overrides,
    }


def _agent(tool):
    agent = object.__new__(ListenChatAgent)
    agent._internal_tools = {"remember_project_memory": tool}
    agent.api_task_id = "run-1"
    agent.agent_name = "agent"
    agent.process_task_id = "process-1"
    agent.mask_tool_output = False
    agent._secure_result_store = {}
    agent._record_tool_calling = MagicMock(
        side_effect=lambda name, args, result, call_id, **kwargs: result
    )
    return agent


def _request(call_id="memory-call", **overrides):
    return ToolCallRequest(
        tool_name="remember_project_memory",
        tool_call_id=call_id,
        args=_arguments(**overrides),
    )


@pytest.mark.parametrize(
    "refs",
    [
        (),
        ("missing",),
        ("assistant-1",),
        ("tool-1",),
        ("other-user",),
        ("user-1", "missing"),
        ("history:project-1:1",),
    ],
)
def test_service_provenance_rejection_proves_no_write(
    memory_run, monkeypatch, refs
):
    scope = MagicMock(wraps=memory_run.service.scope)
    monkeypatch.setattr(memory_run.service, "scope", scope)
    with pytest.raises(PermissionError) as raised:
        memory_run.service.create_entry(
            scope_type="project",
            scope_id="project-1",
            actor_type="agent",
            source_refs=refs,
            **_arguments(),
        )
    memory_run.apply.assert_not_called()
    scope.assert_not_called()  # Even scope initialization can write.
    assert isinstance(raised.value, ToolPreWriteValidationError)
    assert raised.value.error_code == "MEMORY_PROVENANCE_REJECTED"
    assert raised.value.to_tool_result()["write_performed"] is False


@pytest.mark.parametrize("scope_type", ["space", "user"])
def test_agent_scope_rejection_is_typed_before_any_write(
    memory_run, scope_type
):
    with pytest.raises(PermissionError) as raised:
        memory_run.service.create_entry(
            scope_type=scope_type,
            scope_id=f"{scope_type}-1",
            actor_type="agent",
            source_refs=("user-1",),
            **_arguments(),
        )
    memory_run.apply.assert_not_called()
    assert raised.value.error_code == "MEMORY_SCOPE_REJECTED"


def test_function_tool_wrapper_retains_rejection_type(memory_run):
    with pytest.raises(ValueError) as wrapped:
        memory_run.tool(**_arguments())
    memory_run.apply.assert_not_called()
    rejection = wrapped.value.__context__
    assert rejection.error_code == "MEMORY_PROVENANCE_REJECTED"
    assert rejection.to_tool_result()["recovery"]["tool"] == (
        "search_project_history"
    )


def test_checkpoint_preserves_wrapped_rejection_as_known_failure(memory_run):
    checkpoint = prepare_tool_checkpoint(
        raw_tool_call_id="wrapped-call",
        tool_name="remember_project_memory",
        arguments=_arguments(),
    )
    with pytest.raises(ValueError) as wrapped:
        memory_run.tool(**_arguments())
    finish_tool_checkpoint(checkpoint, error=wrapped.value)
    [record] = memory_run.journal.list_tool_calls("run-1")
    assert record.safety_class == ToolSafetyClass.UNSAFE_WRITE.value
    assert record.status == "failed"
    assert record.result["error_code"] == "MEMORY_PROVENANCE_REJECTED"
    assert record.result["write_performed"] is False
    memory_run.apply.assert_not_called()


@pytest.mark.parametrize("mode", ["sync", "async"])
def test_agent_receives_correction_and_can_continue(memory_run, mode):
    agent = _agent(memory_run.tool)

    def execute(request):
        if mode == "sync":
            return agent._execute_tool(request)
        return asyncio.run(agent._aexecute_tool(request))

    rejected = execute(_request(source_event_ids=None))
    assert rejected["error_code"] == "MEMORY_PROVENANCE_REJECTED"
    assert rejected["outcome_known"] is True
    assert rejected["retryable"] is True
    assert rejected["write_performed"] is False
    assert rejected["recovery"]["tool"] == "search_project_history"
    assert "event_id" in rejected["recovery"]["instruction"]
    assert "continue" in rejected["recovery"]["instruction"]
    memory_run.apply.assert_not_called()

    history = memory_run.service.search_history(project_id="project-1")
    user_event = next(
        item for item in history.items if item.event_type == "user.message"
    )
    result = execute(
        _request("corrected-call", source_event_ids=[user_event.event_id])
    )
    assert result["entry"]["source_trust"] == "user_asserted"
    assert result["entry"]["source_refs"] == ("user-1",)
    assert result["entry"]["created_by"] == "agent"
    assert result["entry"]["confirmed_by_user"] is False
    assert [
        call.status for call in memory_run.journal.list_tool_calls("run-1")
    ] == ["failed", "completed"]
    assert not any(
        event.event_type in {"tool.outcome_unknown", "run.failed"}
        for event in memory_run.journal.list_events("run-1")
    )


def test_tool_observed_stays_non_authoritative(memory_run):
    result = _agent(memory_run.tool)._execute_tool(
        _request(source_trust="tool_observed")
    )
    assert result["entry"]["source_trust"] == "tool_observed"
    assert result["entry"]["confirmed_by_user"] is False
    memory_run.apply.assert_called_once()


def test_duplicate_canonical_user_ids_remain_valid(memory_run):
    result = memory_run.tool(
        **_arguments(source_event_ids=["user-1", "user-1"])
    )
    assert result["entry"]["source_refs"] == ("user-1",)
    memory_run.apply.assert_called_once()


@pytest.mark.parametrize("mode", ["sync", "async"])
@pytest.mark.parametrize("exception_type", [PermissionError, TimeoutError])
def test_error_after_real_write_remains_unknown_and_stops_agent(
    memory_run, mode, exception_type
):
    def write_then_fail(**kwargs):
        memory_run.apply._mock_wraps(**kwargs)
        raise exception_type(
            "Agent user_asserted Memory requires cited user History events"
        )

    memory_run.apply.side_effect = write_then_fail
    agent = _agent(memory_run.tool)
    request = _request(source_event_ids=["user-1"])
    with pytest.raises(UnsafeToolOutcomeError):
        if mode == "sync":
            agent._execute_tool(request)
        else:
            asyncio.run(agent._aexecute_tool(request))
    memory_run.apply.assert_called_once()
    assert len(memory_run.service.list_entries("project", "project-1")) == 1
    [record] = memory_run.journal.list_tool_calls("run-1")
    assert record.status == "outcome_unknown"
    agent._record_tool_calling.assert_not_called()


def test_schema_explains_conditional_citations(memory_run):
    properties = memory_run.tool.openai_tool_schema["function"]["parameters"][
        "properties"
    ]
    citation_help = properties["source_event_ids"]["description"]
    assert "Required" in citation_help
    assert "user_asserted" in citation_help
    assert "user.message" in citation_help
    assert "event_id" in citation_help
    assert "search_project_history" in citation_help


@pytest.mark.parametrize("mode", ["sync", "async"])
@pytest.mark.parametrize("write_fails", [False, True])
def test_mock_model_delivery_requires_known_memory_outcome(
    memory_run, mode, write_fails
):
    """Exercise the real CAMEL model/tool loop with an offline StubModel."""
    model = StubModel(ModelType.STUB)
    requests = []

    if write_fails:

        def write_then_fail(**kwargs):
            memory_run.apply._mock_wraps(**kwargs)
            raise TimeoutError("Write committed but response was lost")

        memory_run.apply.side_effect = write_then_fail

    def respond(messages, *args, **kwargs):
        requests.append(messages)
        if len(requests) == 1:
            message = {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "memory-call",
                        "type": "function",
                        "function": {
                            "name": "remember_project_memory",
                            "arguments": json.dumps(
                                _arguments(source_event_ids=["user-1"])
                                if write_fails
                                else _arguments()
                            ),
                        },
                    }
                ],
            }
            finish_reason = "tool_calls"
        else:
            assert len(requests) == 2  # No automatic identical retry.
            tool_result = next(
                msg for msg in messages if msg["role"] == "tool"
            )
            assert "MEMORY_PROVENANCE_REJECTED" in tool_result["content"]
            assert "search_project_history" in tool_result["content"]
            assert "continue delivering" in tool_result["content"]
            message = {
                "role": "assistant",
                "content": "Storyboard ready for review. Memory was not saved.",
            }
            finish_reason = "stop"
        return ChatCompletion.model_validate(
            {
                "id": f"mock-response-{len(requests)}",
                "model": "stub",
                "object": "chat.completion",
                "created": 0,
                "choices": [
                    {
                        "index": 0,
                        "message": message,
                        "finish_reason": finish_reason,
                    }
                ],
                "usage": {
                    "completion_tokens": 10,
                    "prompt_tokens": 10,
                    "total_tokens": 20,
                },
            }
        )

    model._run = respond
    model._arun = AsyncMock(side_effect=respond)
    agent = ListenChatAgent(
        "run-1",
        "agent",
        model=model,
        tools=[memory_run.tool],
        max_iteration=3,
    )

    def deliver():
        if mode == "sync":
            return agent.step("Deliver the finished storyboard.")
        return asyncio.run(agent.astep("Deliver the finished storyboard."))

    if write_fails:
        with pytest.raises(UnsafeToolOutcomeError):
            deliver()
        assert len(requests) == 1
        memory_run.apply.assert_called_once()
        assert (
            len(memory_run.service.list_entries("project", "project-1")) == 1
        )
        [record] = memory_run.journal.list_tool_calls("run-1")
        assert record.status == "outcome_unknown"
        return

    response = deliver()
    assert response.msg.content == (
        "Storyboard ready for review. Memory was not saved."
    )
    assert len(requests) == 2
    memory_run.apply.assert_not_called()
    [record] = memory_run.journal.list_tool_calls("run-1")
    assert record.status == "failed"
    assert record.result["write_performed"] is False


def _rejection():
    return ToolPreWriteValidationError(
        "Validation refused before write",
        error_code="MEMORY_PROVENANCE_REJECTED",
        field="source_event_ids",
        recovery={"tool": "search_project_history", "instruction": "Find IDs"},
    )


@pytest.mark.parametrize("explicit_cause", [False, True])
def test_explicit_and_implicit_function_tool_wrappers_preserve_type(
    explicit_cause,
):
    def reject():
        """Reject before any mutation."""
        raise _rejection()

    inner = FunctionTool(reject)

    def relay():
        """Relay the original tool's validation."""
        return inner()

    with pytest.raises(ValueError) as raised:
        FunctionTool(relay)()
    if explicit_cause:
        raised.value.__cause__ = raised.value.__context__
    assert prewrite_validation_result(raised.value) == (
        _rejection().to_tool_result()
    )


def test_error_text_attributes_and_old_context_are_not_no_write_proof():
    lookalike = PermissionError("Validation refused before write")
    lookalike.error_code = "MEMORY_PROVENANCE_REJECTED"
    lookalike.outcome_known = True
    assert prewrite_validation_result(lookalike) is None
    later_failure = RuntimeError("Write failed after an earlier rejection")
    later_failure.__context__ = _rejection()
    wrapped = ValueError("FunctionTool wrapper")
    wrapped.__context__ = later_failure
    assert prewrite_validation_result(wrapped) is None


def test_suppressed_shadowed_and_cyclic_contexts_fail_closed():
    def reject():
        """Reject before any mutation."""
        raise _rejection()

    with pytest.raises(ValueError) as raised:
        FunctionTool(reject)()
    wrapped = raised.value
    assert prewrite_validation_result(wrapped) is not None
    wrapped.__suppress_context__ = True
    assert prewrite_validation_result(wrapped) is None
    wrapped.__cause__ = TimeoutError("Actual failure")
    assert prewrite_validation_result(wrapped) is None
    wrapped.__cause__ = wrapped
    assert prewrite_validation_result(wrapped) is None


def test_rejection_checkpoint_persistence_failure_remains_fatal(
    memory_run, monkeypatch
):
    checkpoint = prepare_tool_checkpoint(
        raw_tool_call_id="persistence-failure",
        tool_name="remember_project_memory",
        arguments=_arguments(),
    )
    monkeypatch.setattr(
        memory_run.journal,
        "checkpoint_tool_call",
        MagicMock(side_effect=OSError("Disk full")),
    )
    with pytest.raises(ToolCheckpointPersistenceError):
        finish_tool_checkpoint(checkpoint, error=_rejection())


def test_later_write_value_error_cannot_reuse_previous_no_write_proof(
    memory_run,
):
    def write_then_fail(**kwargs):
        memory_run.apply._mock_wraps(**kwargs)
        raise ValueError("Write committed but response could not be decoded")

    memory_run.apply.side_effect = write_then_fail
    agent = _agent(memory_run.tool)
    try:
        memory_run.tool(**_arguments())
    except ValueError:
        # A later exception may inherit a handled validation as __context__.
        # Its earlier no-write proof cannot classify this new mutation.
        with pytest.raises(UnsafeToolOutcomeError):
            agent._execute_tool(_request(source_event_ids=["user-1"]))
    memory_run.apply.assert_called_once()
    assert len(memory_run.service.list_entries("project", "project-1")) == 1
    [record] = memory_run.journal.list_tool_calls("run-1")
    assert record.status == "outcome_unknown"
