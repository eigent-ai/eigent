"""Pinned SDK/CAMEL lifecycle boundaries using only synthetic mock HTTP."""

import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import openai
import pytest
from pydantic import BaseModel

from app.agent.listen_chat_agent import ListenChatAgent
from app.model.provider_wait import (
    _INVOCATION,
    instrument_provider_wait,
    provider_invocation_scope,
    provider_stream_scope,
)
from app.run_context import RunContext, run_context_scope
from app.run_journal.model_capture import instrument_model_backend
from app.run_journal.store import SQLiteRunJournal
from app.run_runtime.active_timeout import ActiveExecutionTimeout
from app.workload import (
    CAPTURE_POLICY_REQUIRED,
    DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
    RETENTION_POLICY_EVIDENCE_REQUIRED,
)

MESSAGES = [{"role": "user", "content": "synthetic fixture"}]
INVALID_DATE = "Thu, 01 Jan 10000 00:00:00 GMT"


class Clock:
    def __init__(self, monkeypatch):
        loop = asyncio.get_running_loop()
        self.now = loop.time()
        monkeypatch.setattr(loop, "time", lambda: self.now)

    async def sleep(self, seconds):
        self.now += seconds
        for _ in range(4):
            await asyncio.sleep(0)


def client_for(handler, **kwargs):
    return openai.AsyncOpenAI(
        api_key="fixture-not-a-credential",
        base_url="https://provider.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        **kwargs,
    )


def completed():
    return httpx.Response(
        200,
        json={
            "id": "resp_fixture",
            "object": "response",
            "created_at": 0,
            "status": "completed",
            "model": "gpt-6-astra",
            "output": [],
        },
        headers={"x-request-id": "private-request-id"},
    )


def events(caplog):
    return [
        record.provider_wait
        for record in caplog.records
        if hasattr(record, "provider_wait")
    ]


def sse(value):
    return b"data: " + json.dumps(value).encode() + b"\n\n"


def chat_chunk(*, terminal=False):
    return {
        "id": "chat_fixture",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "gpt-4o",
        "choices": [
            {
                "index": 0,
                "delta": {}
                if terminal
                else {"role": "assistant", "content": "fixture"},
                "finish_reason": "stop" if terminal else None,
            }
        ],
    }


def usage_chunk():
    return {
        **chat_chunk(),
        "choices": [],
        "usage": {
            "prompt_tokens": 2,
            "completion_tokens": 3,
            "total_tokens": 5,
        },
    }


@asynccontextmanager
async def camel_model(handler, *, api_mode="chat_completions"):
    from camel.models import ModelFactory

    counter = MagicMock()
    counter.count_tokens_from_messages.return_value = 1
    model = ModelFactory.create(
        model_platform="openai",
        model_type="gpt-4o",
        api_key="fixture",
        url="https://provider.invalid/v1",
        api_mode=api_mode,
        timeout=600,
        max_retries=0,
        token_counter=counter,
        model_config_dict={"stream": True},
    )
    model._client._client.close()
    await model._async_client._client.aclose()
    model._client._client = httpx.Client(
        transport=httpx.MockTransport(handler)
    )
    model._async_client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    )
    try:
        yield model
    finally:
        model._client.close()
        await model._async_client.close()


def capture_context(tmp_path, *, required=False):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="run-fixture", project_id="project-fixture", status="pending"
    )
    profile = DEFAULT_PRODUCTION_WORKLOAD_PROFILE
    if required:
        profile = replace(
            profile,
            workload_kind="test",
            profile_version="test-v1",
            capture_policy_ref=CAPTURE_POLICY_REQUIRED,
            retention_policy_ref=RETENTION_POLICY_EVIDENCE_REQUIRED,
        )
    attempt = journal.create_run_attempt(
        "run-fixture",
        request_id="fixture",
        reason="initial_execution",
        workload_profile=profile,
    )
    context = RunContext(
        space_id="space-fixture",
        project_id="project-fixture",
        run_id="run-fixture",
        task_id="task-fixture",
        email="fixture@example.invalid",
        user_id="fixture",
        working_directory=tmp_path,
        task_output_root=tmp_path,
        camel_log_dir=tmp_path / "logs",
        binding_source="fixture",
        workdir_mode="fixture",
        browser_port=0,
        attempt_id=attempt.attempt_id,
    )
    return journal, context


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
@pytest.mark.parametrize("observed", [False, True])
@pytest.mark.parametrize(
    "status,retries,extra",
    [
        (200, 1, {}),
        (400, 1, {}),
        (503, 1, {"x-should-retry": "false"}),
        (503, 0, {}),
    ],
)
async def test_invalid_retry_date_preserves_response_and_hooks(
    monkeypatch, caplog, mode, observed, status, retries, extra
):
    caplog.set_level("INFO", logger="provider_wait")
    calls, hooks, traces, delays = [], [], [], []

    def response(request):
        calls.append(request)
        return httpx.Response(
            status,
            json=completed().json()
            if status == 200
            else {"error": {"message": "fixture"}},
            headers={"retry-after": INVALID_DATE, **extra},
        )

    if mode == "sync":

        def handler(request):
            request.extensions["trace"]("connection.connect_tcp.started", {})
            return response(request)

        def prepare(request):
            request.extensions["trace"] = lambda name, info: traces.append(
                name
            )

        client = openai.OpenAI(
            api_key="fixture",
            max_retries=retries,
            http_client=httpx.Client(
                transport=httpx.MockTransport(handler),
                event_hooks={
                    "response": [
                        lambda response: hooks.append(response.status_code)
                    ]
                },
            ),
        )
    else:

        async def handler(request):
            await request.extensions["trace"](
                "connection.connect_tcp.started", {}
            )
            return response(request)

        async def prepare(request):
            async def trace(name, info):
                traces.append(name)

            request.extensions["trace"] = trace

        async def header(response):
            hooks.append(response.status_code)

        client = openai.AsyncOpenAI(
            api_key="fixture",
            max_retries=retries,
            http_client=httpx.AsyncClient(
                transport=httpx.MockTransport(handler),
                event_hooks={"response": [header]},
            ),
        )

    async def sleep(delay):
        delays.append(delay)

    monkeypatch.setattr("openai._base_client.anyio.sleep", sleep)
    monkeypatch.setattr("openai._base_client.time.sleep", delays.append)
    client._prepare_request = prepare
    if observed:
        instrument_provider_wait(SimpleNamespace(_client=client))
    try:
        try:
            result = client.responses.create(model="gpt-4o", input="fixture")
            if mode == "async":
                result = await result
            outcome = result.status
        except openai.APIStatusError as exc:
            outcome = exc.status_code
        assert outcome == ("completed" if status == 200 else status)
        assert len(calls) == len(hooks) == len(traces) == 1
        assert hooks == [status] and not delays
        if observed:
            assert all(
                event["retry_after_seconds"] is None
                for event in events(caplog)
            )
    finally:
        if mode == "sync":
            client.close()
        else:
            await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
@pytest.mark.parametrize("observed", [False, True])
async def test_retryable_invalid_date_retains_sdk_failure(mode, observed):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            503,
            headers={"retry-after": INVALID_DATE},
            json={"error": {"message": "fixture"}},
        )

    client = (
        openai.OpenAI(
            api_key="fixture",
            max_retries=1,
            http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        if mode == "sync"
        else client_for(handler, max_retries=1)
    )
    if observed:
        instrument_provider_wait(SimpleNamespace(_client=client))
    try:
        # The diagnostic hook is tolerant; SDK-owned retry parsing is not
        # replaced. This unsupported date fails identically without hooks.
        with pytest.raises(ValueError, match="year 10000"):
            response = client.responses.create(model="gpt-4o", input="fixture")
            if mode == "async":
                await response
        assert len(calls) == 1
    finally:
        if mode == "sync":
            client.close()
        else:
            await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,hint,retries", [(400, None, 3), (429, "120", 3), (503, None, 0)]
)
@pytest.mark.parametrize(
    "interruption", ["cancel", "watchdog", "read_timeout", "read_error"]
)
async def test_error_body_interruption_releases_response(
    monkeypatch, caplog, status, hint, retries, interruption
):
    caplog.set_level("INFO", logger="provider_wait")
    clock = Clock(monkeypatch)
    reading = asyncio.Event()
    calls = []
    failure = (
        httpx.ReadTimeout
        if interruption == "read_timeout"
        else httpx.ReadError
    )("fixture")

    class Body(httpx.AsyncByteStream):
        close_count = 0

        async def __aiter__(self):
            reading.set()
            if interruption == "watchdog":
                await clock.sleep(20)
            elif interruption == "cancel":
                await asyncio.Event().wait()
            else:
                raise failure
            yield b""

        async def aclose(self):
            await asyncio.sleep(0)
            self.close_count += 1

    body = Body()

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status, stream=body, headers={"retry-after": hint} if hint else {}
        )

    async with client_for(handler, max_retries=retries) as client:
        instrument_provider_wait(SimpleNamespace(_async_client=client))
        create = client.responses.create

        async def invoke():
            async with ActiveExecutionTimeout(
                10 if interruption == "watchdog" else None
            ):
                return await create(
                    model="gpt-4o", input="fixture", stream=True
                )

        before = asyncio.all_tasks()
        async with provider_stream_scope():
            task = asyncio.create_task(invoke())
            await reading.wait()
            if interruption == "cancel":
                task.cancel()
            expected = {
                "cancel": asyncio.CancelledError,
                "watchdog": TimeoutError,
            }.get(interruption, type(failure))
            with pytest.raises(expected) as caught:
                await task
            if interruption in {"read_timeout", "read_error"}:
                assert caught.value is failure
            assert body.close_count == 1
        assert asyncio.all_tasks() == before
    assert len(calls) == body.close_count == 1
    assert (
        events(caplog)[-1]["phase"]
        == {
            "cancel": "cancelled",
            "watchdog": "timeout",
            "read_timeout": "timeout",
            "read_error": "transport_error",
        }[interruption]
    )


@pytest.mark.asyncio
async def test_error_body_cleanup_failure_keeps_original_cancellation():
    reading = asyncio.Event()

    class Body(httpx.AsyncByteStream):
        close_count = 0

        async def __aiter__(self):
            reading.set()
            await asyncio.Event().wait()
            yield b""

        async def aclose(self):
            self.close_count += 1
            raise RuntimeError("fixture cleanup failure")

    body = Body()
    async with client_for(
        lambda _: httpx.Response(400, stream=body)
    ) as client:
        instrument_provider_wait(SimpleNamespace(_async_client=client))
        task = asyncio.create_task(
            client.responses.create(
                model="gpt-4o", input="fixture", stream=True
            )
        )
        await reading.wait()
        task.cancel("fixture cancellation")
        with pytest.raises(
            asyncio.CancelledError, match="fixture cancellation"
        ):
            await task
    assert body.close_count == 1


@pytest.mark.parametrize("error_type", [httpx.ReadTimeout, httpx.ReadError])
def test_sync_error_body_failure_releases_response(error_type):
    failure = error_type("fixture")
    calls = []

    class Body(httpx.SyncByteStream):
        close_count = 0

        def __iter__(self):
            raise failure
            yield b""

        def close(self):
            self.close_count += 1

    body = Body()

    def handler(request):
        calls.append(request)
        return httpx.Response(400, stream=body)

    with openai.OpenAI(
        api_key="fixture",
        max_retries=3,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    ) as client:
        instrument_provider_wait(SimpleNamespace(_client=client))
        with pytest.raises(error_type) as caught:
            client.responses.create(
                model="gpt-4o", input="fixture", stream=True
            )
        assert caught.value is failure and body.close_count == 1
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_error_body_cancel_does_not_close_concurrent_success():
    reading = asyncio.Event()

    class Body(httpx.AsyncByteStream):
        def __init__(self, error):
            self.error, self.closed = error, False

        async def __aiter__(self):
            if self.error:
                reading.set()
                await asyncio.Event().wait()
            yield sse(
                {"type": "response.completed", "response": completed().json()}
            )

        async def aclose(self):
            self.closed = True

    bodies = []

    def handler(request):
        body = Body(json.loads(request.content)["input"] == "cancel")
        bodies.append(body)
        return httpx.Response(400 if body.error else 200, stream=body)

    async with client_for(handler) as client:
        instrument_provider_wait(SimpleNamespace(_async_client=client))
        async with provider_stream_scope():
            task = asyncio.create_task(
                client.responses.create(
                    model="gpt-4o", input="cancel", stream=True
                )
            )
            await reading.wait()
            stream = await client.responses.create(
                model="gpt-4o", input="success", stream=True
            )
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert bodies[0].closed and not bodies[1].closed
            assert [event.type async for event in stream] == [
                "response.completed"
            ]
    assert len(bodies) == 2 and all(body.closed for body in bodies)


@pytest.mark.asyncio
@pytest.mark.parametrize("api_mode", ["chat_completions", "responses"])
@pytest.mark.parametrize("exit_kind", ["complete", "close", "error"])
async def test_sync_camel_consumer_owns_body_and_preserves_usage(
    api_mode, exit_kind
):
    failure = httpx.ReadError("fixture body failure")

    class Body(httpx.SyncByteStream):
        closed = False
        done_read = False
        close_count = 0

        def __iter__(self):
            yield sse(
                chat_chunk()
                if api_mode == "chat_completions"
                else {
                    "type": "response.output_text.delta",
                    "delta": "fixture",
                }
            )
            if exit_kind == "error":
                raise failure
            if api_mode == "chat_completions":
                yield sse(chat_chunk(terminal=True))
                assert (
                    not self.closed
                )  # A finish marker must retain the usage tail.
                yield sse(usage_chunk())
            else:
                response = completed().json()
                response["usage"] = {
                    "input_tokens": 2,
                    "output_tokens": 3,
                    "total_tokens": 5,
                }
                yield sse({"type": "response.completed", "response": response})
            self.done_read = True
            yield b"data: [DONE]\n\n"

        def close(self):
            self.closed = True
            self.close_count += 1

    body = Body()
    async with camel_model(
        lambda _: httpx.Response(200, stream=body), api_mode=api_mode
    ) as model:
        instrument_provider_wait(model)
        agent = ListenChatAgent(
            "fixture", "fixture", model=model, step_timeout=0, stall_timeout=0
        )
        agent._send_agent_deactivate = MagicMock()
        agent._emit_request_usage = MagicMock()
        source = agent._stream_response(MESSAGES, 1)
        consumer = agent._stream_chunks(source)
        try:
            if exit_kind == "close":
                assert next(consumer).msg.content == "fixture"
                assert not body.closed
                consumer.close()
            elif exit_kind == "error":
                with pytest.raises(httpx.ReadError) as caught:
                    list(consumer)
                assert caught.value is failure
            else:
                chunks = list(consumer)
                assert chunks[-1].info["usage"]["total_tokens"] == 5
                assert (
                    agent._emit_request_usage.call_args.kwargs["usage_dict"][
                        "total_tokens"
                    ]
                    == 5
                )
            assert body.closed and body.close_count == 1
            assert not body.done_read
        finally:
            consumer.close()
            source.close()


def test_sync_terminal_response_closes_before_next_call():
    from app.model.provider_wait import (
        _SYNC_STREAMS,
        provider_sync_stream_scope,
    )

    class Body(httpx.SyncByteStream):
        closed = False

        def __iter__(self):
            yield sse(
                {"type": "response.completed", "response": completed().json()}
            )
            yield b"data: [DONE]\n\n"

        def close(self):
            self.closed = True

    body = Body()
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(200, stream=body)
        assert body.closed
        return completed()

    with openai.OpenAI(
        api_key="fixture",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    ) as client:
        instrument_provider_wait(SimpleNamespace(_client=client))
        with provider_sync_stream_scope():
            stream = client.responses.create(
                model="gpt-4o", input="fixture", stream=True
            )
            next(stream)
            assert not body.closed
            client.responses.create(model="gpt-4o", input="fixture")
            assert body.closed and not _SYNC_STREAMS.get()
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_sync_next_call_does_not_close_another_task_response():
    from app.model.provider_wait import provider_sync_stream_scope

    terminal = asyncio.Event()
    other_done = asyncio.Event()
    calls = []

    class Body(httpx.SyncByteStream):
        closed = False

        def __iter__(self):
            yield sse(
                {"type": "response.completed", "response": completed().json()}
            )
            yield b"data: [DONE]\n\n"

        def close(self):
            self.closed = True

    body = Body()

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(200, stream=body)
        assert body.closed == (len(calls) == 3)
        return completed()

    with openai.OpenAI(
        api_key="fixture",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    ) as client:
        instrument_provider_wait(SimpleNamespace(_client=client))

        async def owner():
            stream = client.responses.create(
                model="gpt-4o", input="fixture", stream=True
            )
            next(stream)
            terminal.set()
            await other_done.wait()
            client.responses.create(model="gpt-4o", input="fixture")

        async def other():
            await terminal.wait()
            try:
                client.responses.create(model="gpt-4o", input="fixture")
            finally:
                other_done.set()

        with provider_sync_stream_scope():
            await asyncio.gather(owner(), other())
    assert len(calls) == 3 and body.closed


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
@pytest.mark.parametrize(
    "outcome", ["complete", "enter_error", "required_capture_error"]
)
async def test_deferred_camel_manager_keeps_capture_identity(
    tmp_path, monkeypatch, caplog, mode, outcome
):
    class Answer(BaseModel):
        value: str

    first = chat_chunk()
    first["choices"][0]["delta"]["content"] = '{"value":"fixture"}'
    payload = (
        sse(first)
        + sse(chat_chunk(terminal=True))
        + sse(usage_chunk())
        + b"data: [DONE]\n\n"
    )
    calls = []

    def handler(request):
        calls.append(request)
        return (
            httpx.Response(400, json={"error": {"message": "fixture"}})
            if outcome == "enter_error"
            else httpx.Response(200, content=payload)
        )

    caplog.set_level("INFO", logger="provider_wait")
    journal, context = capture_context(
        tmp_path, required=outcome == "required_capture_error"
    )
    failure = RuntimeError("fixture capture failure")
    if outcome == "required_capture_error":

        def fail_capture(_):
            raise failure

        monkeypatch.setattr(
            journal, "mark_model_invocation_first_token", fail_capture
        )
    try:
        async with camel_model(handler) as model:
            instrument_model_backend(
                model,
                agent_id="agent-fixture",
                provider="openai",
                model_name="gpt-4o",
                journal=journal,
            )
            with (
                run_context_scope(context),
                provider_invocation_scope("outer-fixture"),
            ):
                manager = (
                    model.run(MESSAGES, response_format=Answer)
                    if mode == "sync"
                    else await model.arun(MESSAGES, response_format=Answer)
                )
                assert not calls and _INVOCATION.get() == "outer-fixture"
                error = None
                try:
                    if mode == "sync":
                        with manager as stream:
                            assert _INVOCATION.get() == "outer-fixture"
                            list(stream)
                            assert (
                                stream.get_final_completion()
                                .choices[0]
                                .message.parsed.value
                                == "fixture"
                            )
                    else:
                        async with manager as stream:
                            assert _INVOCATION.get() == "outer-fixture"
                            async for _ in stream:
                                assert _INVOCATION.get() == "outer-fixture"
                            final = await stream.get_final_completion()
                            assert (
                                final.choices[0].message.parsed.value
                                == "fixture"
                            )
                except (openai.BadRequestError, RuntimeError) as exc:
                    error = exc
                assert _INVOCATION.get() == "outer-fixture"
            assert _INVOCATION.get() is None
        if outcome == "complete":
            assert error is None
        elif outcome == "enter_error":
            assert isinstance(error, openai.BadRequestError)
        else:
            assert error is failure
        records = journal.list_model_invocations(context.run_id)
        assert len(records) == len(calls) == 1
        assert (
            records[0].status
            == {
                "complete": "completed",
                "enter_error": "failed",
                "required_capture_error": "outcome_unknown",
            }[outcome]
        )
        assert {event["invocation_id"] for event in events(caplog)} == {
            records[0].invocation_id
        }
    finally:
        journal.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
async def test_lazy_generator_dispatch_keeps_capture_identity(
    tmp_path, caplog, mode
):
    payload = (
        sse(chat_chunk())
        + sse(chat_chunk(terminal=True))
        + sse(usage_chunk())
        + b"data: [DONE]\n\n"
    )
    caplog.set_level("INFO", logger="provider_wait")
    journal, context = capture_context(tmp_path)
    try:
        async with camel_model(
            lambda _: httpx.Response(200, content=payload)
        ) as model:
            original_run, original_arun = model.run, model.arun

            def lazy_run(messages):
                yield from original_run(messages)

            async def lazy_arun(messages):
                async def generate():
                    async for chunk in await original_arun(messages):
                        yield chunk

                return generate()

            model.run, model.arun = lazy_run, lazy_arun
            instrument_model_backend(
                model,
                agent_id="agent-fixture",
                provider="openai",
                model_name="gpt-4o",
                journal=journal,
            )
            with (
                run_context_scope(context),
                provider_invocation_scope("outer-fixture"),
            ):
                if mode == "sync":
                    for _ in model.run(MESSAGES):
                        assert _INVOCATION.get() == "outer-fixture"
                else:
                    async for _ in await model.arun(MESSAGES):
                        assert _INVOCATION.get() == "outer-fixture"
            records = journal.list_model_invocations(context.run_id)
            assert len(records) == 1 and records[0].status == "completed"
            assert {event["invocation_id"] for event in events(caplog)} == {
                records[0].invocation_id
            }
            assert _INVOCATION.get() is None
    finally:
        journal.close()
