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

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from app.run_context.context import RunContext, run_context_scope
from app.run_journal.model_capture import (
    _capture_is_required,
    instrument_model_backend,
)
from app.run_journal.store import SQLiteRunJournal
from app.run_runtime.step_coordinator import step_event_draft, step_scope
from app.workload import (
    CAPTURE_POLICY_REQUIRED,
    DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
    RETENTION_POLICY_EVIDENCE_REQUIRED,
)


class _Response:
    def model_dump(self, mode: str = "python") -> dict[str, Any]:
        del mode
        return {
            "id": "response-1",
            "model": "gpt-test",
            "choices": [{"finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 2},
        }


def test_persisted_best_effort_capture_is_not_overridden_by_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EIGENT_MODEL_CAPTURE_REQUIRED", "true")
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        workload_profile=DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
    )

    assert _capture_is_required(journal, attempt.attempt_id) is False


def test_attempt_capture_policy_is_cached_after_first_resolution(
    tmp_path: Path,
) -> None:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        workload_profile=DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
    )

    with patch.object(
        journal, "get_run_attempt", wraps=journal.get_run_attempt
    ) as get_attempt:
        assert _capture_is_required(journal, attempt.attempt_id) is False
        assert _capture_is_required(journal, attempt.attempt_id) is False

    get_attempt.assert_called_once_with(attempt.attempt_id)


class _Chunk:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def model_dump(self, mode: str = "python") -> dict[str, Any]:
        del mode
        return self.payload


class _AsyncChunks:
    def __init__(self) -> None:
        self._chunks = iter(
            [
                _Chunk(
                    {
                        "id": "stream-1",
                        "model": "gpt-test",
                        "choices": [
                            {
                                "delta": {"content": "hello "},
                                "finish_reason": None,
                            }
                        ],
                    }
                ),
                _Chunk(
                    {
                        "id": "stream-1",
                        "model": "gpt-test",
                        "choices": [
                            {
                                "delta": {"content": "world"},
                                "finish_reason": "stop",
                            }
                        ],
                        "usage": {
                            "prompt_tokens": 5,
                            "completion_tokens": 2,
                        },
                    }
                ),
            ]
        )

    def __aiter__(self) -> _AsyncChunks:
        return self

    async def __anext__(self) -> _Chunk:
        try:
            return next(self._chunks)
        except StopIteration:
            raise StopAsyncIteration

    async def __aenter__(self) -> _AsyncChunks:
        return self

    async def __aexit__(self, *_args: object) -> bool:
        return False


class _AsyncStreamManager:
    def __init__(self) -> None:
        self.stream = _AsyncChunks()

    async def __aenter__(self) -> _AsyncChunks:
        return self.stream

    async def __aexit__(self, *_args: object) -> bool:
        return False


class _SyncChunks:
    def __init__(self) -> None:
        self._chunks = iter(
            [
                _Chunk(
                    {
                        "id": "sync-stream-1",
                        "model": "gpt-test",
                        "choices": [
                            {
                                "delta": {"content": "sync "},
                                "finish_reason": None,
                            }
                        ],
                    }
                ),
                _Chunk(
                    {
                        "id": "sync-stream-1",
                        "model": "gpt-test",
                        "choices": [
                            {
                                "delta": {"content": "stream"},
                                "finish_reason": "stop",
                            }
                        ],
                        "usage": {
                            "prompt_tokens": 4,
                            "completion_tokens": 2,
                        },
                    }
                ),
            ]
        )
        self.closed = False

    def __iter__(self) -> _SyncChunks:
        return self

    def __next__(self) -> _Chunk:
        return next(self._chunks)

    def close(self) -> None:
        self.closed = True


class _StructuredEvent:
    def __init__(self, event_type: str, delta: str | None = None) -> None:
        self.type = event_type
        self.delta = delta

    def model_dump(self, mode: str = "python") -> dict[str, Any]:
        del mode
        return {"type": self.type, "delta": self.delta}


class _SyncStructuredStream:
    def __init__(self) -> None:
        self._events = iter(
            [
                _StructuredEvent("content.delta", "structured"),
                _StructuredEvent("content.done"),
            ]
        )
        self.closed = False

    def __iter__(self) -> _SyncStructuredStream:
        return self

    def __next__(self) -> _StructuredEvent:
        return next(self._events)

    def get_final_completion(self) -> _Response:
        return _Response()

    def close(self) -> None:
        self.closed = True


class _SyncStreamManager:
    def __init__(self) -> None:
        self.stream = _SyncStructuredStream()

    def __enter__(self) -> _SyncStructuredStream:
        return self.stream

    def __exit__(self, *_args: object) -> bool:
        self.stream.close()
        return False


class _AsyncStructuredStream:
    def __init__(self) -> None:
        self._events = iter(
            [
                _StructuredEvent("content.delta", "async structured"),
                _StructuredEvent("content.done"),
            ]
        )

    def __aiter__(self) -> _AsyncStructuredStream:
        return self

    async def __anext__(self) -> _StructuredEvent:
        try:
            return next(self._events)
        except StopIteration:
            raise StopAsyncIteration

    async def get_final_completion(self) -> _Response:
        return _Response()


class _AsyncStructuredStreamManager:
    def __init__(self) -> None:
        self.stream = _AsyncStructuredStream()

    async def __aenter__(self) -> _AsyncStructuredStream:
        return self.stream

    async def __aexit__(self, *_args: object) -> bool:
        return False


class _FakeModel:
    def __init__(
        self,
        response: Any,
        *,
        api_mode: str = "chat_completions",
    ) -> None:
        self._api_mode = api_mode
        self.model_config_dict = {
            "stream": hasattr(response, "__aiter__"),
            "reasoning_effort": "medium",
            "api_key": "sk-" + "b" * 40,
        }
        self._log_enabled = True
        self.response = response

    def run(self, *_args: object, **_kwargs: object) -> Any:
        return self.response

    async def arun(self, *_args: object, **_kwargs: object) -> Any:
        return self.response


class _ArgumentModel(_FakeModel):
    def __init__(self, response: Any) -> None:
        super().__init__(response)
        self.last_call: tuple[tuple[object, ...], dict[str, object]] | None = (
            None
        )

    def run(self, _messages: object, *args: object, **kwargs: object) -> Any:
        self.last_call = (args, kwargs)
        return self.response


class _UnserializableResponse:
    def model_dump(self, mode: str = "python") -> dict[str, Any]:
        del mode
        raise RuntimeError("cannot serialize provider response")


class _FakeCamelLoggingModel(_FakeModel):
    """Stand in for CAMEL's independently maintained native file logger."""

    def __init__(self, response: Any, log_path: Path) -> None:
        super().__init__(response)
        self.log_path = log_path

    def run(self, *_args: object, **_kwargs: object) -> Any:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.log_path.write_bytes(b"camel-native-log-v1\n")
        return self.response


def _context(
    tmp_path: Path,
    *,
    attempt_id: str | None = None,
) -> RunContext:
    return RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="task-1",
        email="user@example.com",
        user_id="user-1",
        working_directory=tmp_path,
        task_output_root=tmp_path,
        camel_log_dir=tmp_path / "camel_logs",
        binding_source="test",
        workdir_mode="test",
        browser_port=9222,
        attempt_id=attempt_id,
    )


def _journal(tmp_path: Path) -> SQLiteRunJournal:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    return journal


def test_non_streaming_call_is_committed_without_changing_camel_logger(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    model = instrument_model_backend(
        _FakeModel(_Response()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        response = model.run(
            [{"role": "user", "content": "password=hunter2"}],
            None,
            [{"type": "function", "function": {"name": "read"}}],
        )

    assert isinstance(response, _Response)
    records = journal.list_model_invocations("run-1")
    assert len(records) == 1
    assert records[0].status == "completed"
    assert records[0].prompt_tokens == 3
    assert "hunter2" not in str(records[0].request)
    assert "sk-" + "b" * 40 not in str(records[0].request)
    assert model._log_enabled is True
    # This adapter never manufactures or rewrites CAMEL's native files. The
    # fake backend does not implement CAMEL logging, so the directory remains
    # empty while SQLite still contains the invocation above.
    assert not _context(tmp_path).camel_log_dir.exists()


def test_model_capture_binds_current_authored_step(tmp_path: Path) -> None:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
    )
    journal.append_event(
        "run-1",
        step_event_draft(
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            step_id="step-1",
            plan_item_id="plan-item-1",
            title="Call model",
            summary=None,
            ordinal=0,
            agent_id="agent-1",
            event="created",
            status="pending",
        ),
    )
    model = instrument_model_backend(
        _FakeModel(_Response()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with (
        run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)),
        step_scope("step-1"),
    ):
        model.run([{"role": "user", "content": "hello"}])

    record = journal.list_model_invocations("run-1")[0]
    assert record.attempt_id == attempt.attempt_id
    assert record.step_id == "step-1"


def test_model_capture_resolves_unique_running_step_without_tool_scope(
    tmp_path: Path,
) -> None:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
    )
    for event, status in (("created", "pending"), ("started", "running")):
        journal.append_event(
            "run-1",
            step_event_draft(
                run_id="run-1",
                attempt_id=attempt.attempt_id,
                step_id="step-1",
                plan_item_id="plan-item-1",
                title="Call model",
                summary=None,
                ordinal=0,
                agent_id="agent-1",
                event=event,
                status=status,
            ),
        )
    model = instrument_model_backend(
        _FakeModel(_Response()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)):
        model.run([{"role": "user", "content": "hello"}])

    record = journal.list_model_invocations("run-1")[0]
    assert record.step_id == "step-1"


def test_stale_step_falls_back_to_attempt_level_capture_gap(
    tmp_path: Path,
) -> None:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
    )
    response = _Response()
    model = instrument_model_backend(
        _FakeModel(response),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with (
        run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)),
        step_scope("stale-step"),
    ):
        returned = model.run([{"role": "user", "content": "hello"}])

    assert returned is response
    assert journal.list_model_invocations("run-1") == ()
    gaps = journal.list_attempt_evidence_gaps(attempt.attempt_id)
    assert len(gaps) == 1
    assert gaps[0].step_id is None
    assert gaps[0].detail_code == "IdempotencyConflictError"


def test_invocation_uses_attempt_pinned_in_immutable_context(
    tmp_path: Path,
) -> None:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="request-1",
        reason="initial_execution",
        activate=False,
    )
    model = instrument_model_backend(
        _FakeModel(_Response()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with (
        patch.object(
            journal,
            "get_run",
            return_value=SimpleNamespace(active_attempt_id="mutable-attempt"),
        ),
        run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)),
    ):
        model.run([{"role": "user", "content": "hello"}])

    record = journal.list_model_invocations("run-1")[0]
    assert record.attempt_id == attempt.attempt_id


def test_native_camel_log_bytes_are_not_rewritten(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    native_log = tmp_path / "camel_logs" / "agent-1" / "native.json"
    model = instrument_model_backend(
        _FakeCamelLoggingModel(_Response(), native_log),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        model.run([{"role": "user", "content": "hello"}])

    assert native_log.read_bytes() == b"camel-native-log-v1\n"
    assert journal.list_model_invocations("run-1")[0].status == "completed"


def test_runtime_api_mode_and_responses_effort_are_recorded(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    backend = _FakeModel(_Response(), api_mode="responses")
    backend.model_config_dict.pop("reasoning_effort")
    backend.model_config_dict["reasoning"] = {"effort": "high"}
    model = instrument_model_backend(
        backend,
        agent_id="agent-1",
        provider="azure",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        model.run([{"role": "user", "content": "hello"}])

    record = journal.list_model_invocations("run-1")[0]
    assert record.transport == "responses"
    assert record.thinking_effort == "high"


def test_sync_streaming_model_call_aggregates_to_completion(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    model = instrument_model_backend(
        _FakeModel(_SyncChunks()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        chunks = list(model.run([{"role": "user", "content": "hi"}]))

    assert len(chunks) == 2
    record = journal.list_model_invocations("run-1")[0]
    assert record.status == "completed"
    assert record.response is not None
    assert record.response["content"] == "sync stream"
    assert record.prompt_tokens == 4
    assert record.completion_tokens == 2


def test_sync_structured_stream_manager_is_not_completed_before_entry(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    model = instrument_model_backend(
        _FakeModel(_SyncStreamManager()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        manager = model.run([{"role": "user", "content": "hi"}])
        assert journal.list_model_invocations("run-1")[0].status == (
            "dispatched"
        )
        with manager as stream:
            assert len(list(stream)) == 2
            assert isinstance(stream.get_final_completion(), _Response)

    record = journal.list_model_invocations("run-1")[0]
    assert record.status == "completed"
    assert record.response is not None
    assert record.response["id"] == "response-1"
    assert record.prompt_tokens == 3
    assert record.completion_tokens == 2


@pytest.mark.asyncio
async def test_streaming_model_call_aggregates_without_token_delta_rows(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    model = instrument_model_backend(
        _FakeModel(_AsyncChunks()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        stream = await model.arun([{"role": "user", "content": "hi"}])
        chunks = [chunk async for chunk in stream]

    assert len(chunks) == 2
    record = journal.list_model_invocations("run-1")[0]
    assert record.status == "completed"
    assert record.response is not None
    assert record.response["content"] == "hello world"
    assert record.first_token_at is not None
    assert [
        event.event_type
        for event in journal.list_model_invocation_events(record.invocation_id)
    ] == ["dispatched", "first_token", "completed"]


@pytest.mark.asyncio
async def test_terminal_usage_chunk_completes_before_stream_exhaustion(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    model = instrument_model_backend(
        _FakeModel(_AsyncChunks()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        stream = await model.arun([{"role": "user", "content": "hi"}])
        first = await stream.__anext__()
        terminal = await stream.__anext__()

    assert first.payload["choices"][0]["finish_reason"] is None
    assert terminal.payload["choices"][0]["finish_reason"] == "stop"
    record = journal.list_model_invocations("run-1")[0]
    assert record.status == "completed"
    assert record.response is not None
    assert record.response["content"] == "hello world"
    assert record.prompt_tokens == 5
    assert record.completion_tokens == 2


@pytest.mark.asyncio
async def test_async_structured_stream_preserves_final_completion_api(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    model = instrument_model_backend(
        _FakeModel(_AsyncStructuredStreamManager()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        manager = await model.arun([{"role": "user", "content": "hi"}])
        async with manager as stream:
            events = [event async for event in stream]
            final = await stream.get_final_completion()

    assert len(events) == 2
    assert isinstance(final, _Response)
    record = journal.list_model_invocations("run-1")[0]
    assert record.status == "completed"
    assert record.response is not None
    assert record.response["id"] == "response-1"


def test_early_sync_stream_close_is_outcome_unknown(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    source = _SyncChunks()
    model = instrument_model_backend(
        _FakeModel(source),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        stream = model.run([{"role": "user", "content": "hi"}])
        next(stream)
        stream.close()

    record = journal.list_model_invocations("run-1")[0]
    assert source.closed is True
    assert record.status == "outcome_unknown"
    assert record.error_code == "RuntimeError"


def test_capture_serialization_failure_does_not_replace_provider_response(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    response = _UnserializableResponse()
    model = instrument_model_backend(
        _FakeModel(response),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        returned = model.run([{"role": "user", "content": "hi"}])

    assert returned is response
    record = journal.list_model_invocations("run-1")[0]
    assert record.status == "outcome_unknown"
    assert record.error_code == "RuntimeError"


def test_capture_wrapper_forwards_public_call_arguments(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    backend = _ArgumentModel(_Response())
    model = instrument_model_backend(
        backend,
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )
    tools = [{"type": "function", "function": {"name": "read"}}]

    with run_context_scope(_context(tmp_path)):
        model.run(
            [{"role": "user", "content": "hi"}],
            response_format=None,
            tools=tools,
            provider_option="preserved",
        )

    assert backend.last_call == (
        (),
        {
            "response_format": None,
            "tools": tools,
            "provider_option": "preserved",
        },
    )
    record = journal.list_model_invocations("run-1")[0]
    assert record.request["model_config_dict"]["tools"] == tools


@pytest.mark.asyncio
async def test_call_without_run_context_does_not_create_trajectory_rows(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    model = instrument_model_backend(
        _FakeModel(_Response()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    await model.arun([{"role": "user", "content": "health check"}])

    assert journal.list_model_invocations("run-1") == ()


@pytest.mark.asyncio
async def test_async_stream_context_manager_is_recorded_on_exhaustion(
    tmp_path: Path,
) -> None:
    journal = _journal(tmp_path)
    model = instrument_model_backend(
        _FakeModel(_AsyncStreamManager()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with run_context_scope(_context(tmp_path)):
        manager = await model.arun([{"role": "user", "content": "hi"}])
        async with manager as stream:
            chunks = [chunk async for chunk in stream]

    assert len(chunks) == 2
    record = journal.list_model_invocations("run-1")[0]
    assert record.status == "completed"
    assert model._log_enabled is True


def test_best_effort_capture_start_failure_records_gap_and_dispatches(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EIGENT_MODEL_CAPTURE_REQUIRED", raising=False)
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
    )
    response = _Response()
    model = instrument_model_backend(
        _FakeModel(response),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with (
        patch.object(
            journal,
            "start_model_invocation",
            side_effect=RuntimeError("capture unavailable"),
        ),
        run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)),
    ):
        returned = model.run([{"role": "user", "content": "hello"}])

    assert returned is response
    gaps = journal.list_attempt_evidence_gaps(attempt.attempt_id)
    assert len(gaps) == 1
    assert gaps[0].dimension == "model_decisions"
    assert gaps[0].reason_code == "capture_failed"
    assert gaps[0].detail_code == "RuntimeError"


def test_required_capture_profile_blocks_dispatch_after_recording_gap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EIGENT_MODEL_CAPTURE_REQUIRED", raising=False)
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    strict = replace(
        DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
        workload_kind="test",
        profile_version="test-v1",
        capture_policy_ref=CAPTURE_POLICY_REQUIRED,
        retention_policy_ref=RETENTION_POLICY_EVIDENCE_REQUIRED,
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        workload_profile=strict,
    )
    model = instrument_model_backend(
        _FakeModel(_Response()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with (
        patch.object(
            journal,
            "start_model_invocation",
            side_effect=RuntimeError("capture unavailable"),
        ),
        run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)),
        pytest.raises(RuntimeError, match="capture unavailable"),
    ):
        model.run([{"role": "user", "content": "hello"}])

    gaps = journal.list_attempt_evidence_gaps(attempt.attempt_id)
    assert len(gaps) == 1
    assert gaps[0].reason_code == "capture_failed"


def test_required_capture_profile_stops_stream_on_first_token_gap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EIGENT_MODEL_CAPTURE_REQUIRED", raising=False)
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    strict = replace(
        DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
        workload_kind="test",
        profile_version="test-v1",
        capture_policy_ref=CAPTURE_POLICY_REQUIRED,
        retention_policy_ref=RETENTION_POLICY_EVIDENCE_REQUIRED,
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        workload_profile=strict,
    )
    model = instrument_model_backend(
        _FakeModel(_SyncChunks()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with (
        patch.object(
            journal,
            "mark_model_invocation_first_token",
            side_effect=RuntimeError("first token capture unavailable"),
        ),
        run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)),
    ):
        stream = model.run([{"role": "user", "content": "hello"}])
        with pytest.raises(
            RuntimeError, match="first token capture unavailable"
        ):
            next(stream)

    gaps = journal.list_attempt_evidence_gaps(attempt.attempt_id)
    assert len(gaps) == 1
    assert gaps[0].detail_code == "RuntimeError"


def test_best_effort_first_token_gap_does_not_interrupt_provider_stream(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EIGENT_MODEL_CAPTURE_REQUIRED", raising=False)
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
    )
    model = instrument_model_backend(
        _FakeModel(_SyncChunks()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with (
        patch.object(
            journal,
            "mark_model_invocation_first_token",
            side_effect=RuntimeError("first token capture unavailable"),
        ),
        run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)),
    ):
        chunks = list(model.run([{"role": "user", "content": "hello"}]))

    assert len(chunks) == 2
    gaps = journal.list_attempt_evidence_gaps(attempt.attempt_id)
    assert len(gaps) == 1


def test_required_capture_profile_surfaces_terminal_persistence_gap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EIGENT_MODEL_CAPTURE_REQUIRED", raising=False)
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    strict = replace(
        DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
        workload_kind="test",
        profile_version="test-v1",
        capture_policy_ref=CAPTURE_POLICY_REQUIRED,
        retention_policy_ref=RETENTION_POLICY_EVIDENCE_REQUIRED,
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        workload_profile=strict,
    )
    model = instrument_model_backend(
        _FakeModel(_Response()),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with (
        patch.object(
            journal,
            "finish_model_invocation",
            side_effect=RuntimeError("terminal capture unavailable"),
        ),
        run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)),
        pytest.raises(RuntimeError, match="terminal capture unavailable"),
    ):
        model.run([{"role": "user", "content": "hello"}])

    gaps = journal.list_attempt_evidence_gaps(attempt.attempt_id)
    assert len(gaps) == 1
    assert gaps[0].detail_code == "RuntimeError"


def test_best_effort_terminal_persistence_gap_returns_provider_response(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EIGENT_MODEL_CAPTURE_REQUIRED", raising=False)
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
    )
    response = _Response()
    model = instrument_model_backend(
        _FakeModel(response),
        agent_id="agent-1",
        provider="openai",
        model_name="gpt-test",
        journal=journal,
    )

    with (
        patch.object(
            journal,
            "finish_model_invocation",
            side_effect=RuntimeError("terminal capture unavailable"),
        ),
        run_context_scope(_context(tmp_path, attempt_id=attempt.attempt_id)),
    ):
        returned = model.run([{"role": "user", "content": "hello"}])

    assert returned is response
    gaps = journal.list_attempt_evidence_gaps(attempt.attempt_id)
    assert len(gaps) == 1
