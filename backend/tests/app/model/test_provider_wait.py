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

"""Real pinned SDK + mock HTTP, including a virtual event-loop clock."""

from __future__ import annotations

import asyncio
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import openai
import pytest

from app.run_journal.model_capture import instrument_model_backend
from app.run_runtime.active_timeout import ActiveExecutionTimeout


class Clock:
    def __init__(self, monkeypatch):
        loop = asyncio.get_running_loop()
        self.now = loop.time()
        monkeypatch.setattr(loop, "time", lambda: self.now)

    async def sleep(self, seconds):
        self.now += seconds
        for _ in range(4):
            await asyncio.sleep(0)


def backend(client):
    # Exercise the existing production installation boundary, without a Run
    # context or journal content capture. Only synthetic data reaches HTTP.
    model = SimpleNamespace(
        _async_client=client,
        run=lambda *a, **k: None,
        arun=client.responses.create,
    )
    instrument_model_backend(
        model,
        agent_id="fixture-agent",
        provider="azure",
        model_name="gpt-6-astra",
        journal=MagicMock(),
    )
    return model


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
        r.provider_wait for r in caplog.records if hasattr(r, "provider_wait")
    ]


def streaming_agent(stall=10):
    from app.agent.listen_chat_agent import ListenChatAgent

    agent = object.__new__(ListenChatAgent)
    agent.step_timeout = None
    agent.stall_timeout = stall
    agent._send_agent_deactivate = MagicMock()
    return agent


@pytest.mark.asyncio
async def test_empty_agent_chunks_do_not_extend_watchdog(monkeypatch):
    clock = Clock(monkeypatch)

    async def heartbeats():
        for _ in range(4):
            await clock.sleep(6)
            yield SimpleNamespace(msg=SimpleNamespace(content=""), info={})

    with pytest.raises(TimeoutError):
        async for _ in streaming_agent()._astream_chunks(heartbeats()):
            pass


@pytest.mark.asyncio
async def test_agent_closes_stream_when_camel_stops_consuming(monkeypatch):
    clock = Clock(monkeypatch)
    body = StalledBody(clock)
    async with client_for(
        lambda _: httpx.Response(200, stream=body)
    ) as client:
        backend(client)

        async def camel_consumer():
            stream = await client.responses.create(
                model="gpt-6-astra", input="fixture", stream=True
            )
            async for _ in stream:
                yield SimpleNamespace(
                    msg=SimpleNamespace(content="done"), info={}
                )
                break  # CAMEL stops at a finish marker before SSE exhaustion.

        async for _ in streaming_agent()._astream_chunks(camel_consumer()):
            pass
        assert body.closed


@pytest.mark.asyncio
async def test_long_retry_after_is_not_retried_early(monkeypatch):
    clock = Clock(monkeypatch)
    monkeypatch.setattr("openai._base_client.anyio.sleep", clock.sleep)
    calls = []

    async def handler(request):
        calls.append(clock.now)
        if len(calls) == 1:
            return httpx.Response(
                429,
                headers={"retry-after": "120"},
                json={
                    "error": {
                        "message": "fixture",
                        "type": "rate_limit_error",
                    },
                },
            )
        return completed()

    async with client_for(handler, max_retries=3) as client:
        backend(client)
        with pytest.raises(openai.RateLimitError):
            await client.responses.create(model="gpt-6-astra", input="fixture")
    assert len(calls) == 1


class StalledBody(httpx.AsyncByteStream):
    def __init__(self, clock):
        self.clock = clock
        self.closed = False

    async def __aiter__(self):
        yield b'data: {"type":"response.created"}\n\n'
        await self.clock.sleep(20)

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_cancel_stream_closes_response(monkeypatch):
    clock = Clock(monkeypatch)
    body = StalledBody(clock)

    async def handler(request):
        return httpx.Response(
            200, stream=body, headers={"content-type": "text/event-stream"}
        )

    async with client_for(handler) as client:
        backend(client)
        with pytest.raises(TimeoutError):
            async with ActiveExecutionTimeout(10, refresh_on_progress=True):
                stream = await client.responses.create(
                    model="gpt-6-astra", input="fixture", stream=True
                )
                async for _ in stream:
                    pass
        assert body.closed


@pytest.mark.asyncio
async def test_attempt_telemetry_has_config_and_no_content(caplog):
    caplog.set_level("INFO", logger="provider_wait")
    async with client_for(
        lambda _: completed(), timeout=600, max_retries=3
    ) as client:
        backend(client)
        await client.responses.create(
            model="gpt-6-astra", input="private-prompt"
        )
    observed = events(caplog)
    assert observed
    assert all("endpoint" not in event for event in observed)
    assert any(e["phase"] == "completed" for e in observed)
    assert observed[0]["max_retries"] == 3
    assert observed[0]["timeout_seconds"]["read"] == 600
    serialized = json.dumps(observed)
    assert "private-prompt" not in serialized
    assert "private-request-id" not in serialized
    assert "fixture-not-a-credential" not in serialized
    assert "provider.invalid" not in serialized
    assert (
        observed[-1]["request_id_hashes"]["x-request-id"]
        == hashlib.sha256(b"private-request-id").hexdigest()
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure", [429, 500, 502, 503, "connect", "read_timeout"]
)
async def test_sdk_retry_is_serial_and_observed(monkeypatch, caplog, failure):
    clock = Clock(monkeypatch)
    monkeypatch.setattr("openai._base_client.anyio.sleep", clock.sleep)
    monkeypatch.setattr("openai._base_client.random", lambda: 0)
    caplog.set_level("INFO", logger="provider_wait")
    calls, active, peak = [], 0, 0

    async def handler(request):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        calls.append(request)
        try:
            await clock.sleep(2)
            if len(calls) <= 2:
                if failure == "connect":
                    raise httpx.ConnectError("private-error", request=request)
                if failure == "read_timeout":
                    raise httpx.ReadTimeout("private-error", request=request)
                return httpx.Response(
                    failure,
                    headers={
                        "retry-after": "3",
                        "apim-request-id": "private-id",
                    },
                    json={"error": {"message": "private-error"}},
                )
            return completed()
        finally:
            active -= 1

    async with client_for(handler, max_retries=3, timeout=600) as client:
        backend(client)
        await client.responses.create(
            model="gpt-6-astra", input="private-prompt"
        )
    assert len(calls) == 3 and peak == 1 and active == 0
    retry = [e for e in events(caplog) if e["phase"] == "retrying"]
    assert [e["attempt"] for e in retry] == [1, 2]
    assert [e["retry_delay_seconds"] for e in retry] == (
        [0.5, 1] if isinstance(failure, str) else [3, 3]
    )
    assert len({e["call_id"] for e in events(caplog)}) == 1
    assert "private-error" not in json.dumps(events(caplog))


@pytest.mark.asyncio
async def test_600_second_attempts_stop_at_1800_second_watchdog(
    monkeypatch, caplog
):
    clock = Clock(monkeypatch)
    monkeypatch.setattr("openai._base_client.anyio.sleep", clock.sleep)
    monkeypatch.setattr("openai._base_client.random", lambda: 0)
    caplog.set_level("INFO", logger="provider_wait")
    calls, active, peak = [], 0, 0

    async def slow_headers(request):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        calls.append(request.extensions["timeout"].copy())
        try:
            await request.extensions["trace"](
                "http11.receive_response_headers.started", {}
            )
            await clock.sleep(request.extensions["timeout"]["read"])
            raise httpx.ReadTimeout("fixture", request=request)
        finally:
            active -= 1

    async with client_for(slow_headers, timeout=600, max_retries=3) as client:
        backend(client)
        with pytest.raises(TimeoutError):
            async with ActiveExecutionTimeout(1800, refresh_on_progress=True):
                await client.responses.create(
                    model="gpt-6-astra", input="fixture"
                )
        await clock.sleep(1000)
    assert [c["read"] for c in calls] == pytest.approx(
        [600, 600, 598.5], rel=0, abs=1e-9
    )
    assert peak == 1 and active == 0
    terminal = events(caplog)[-1]
    assert terminal["phase"] == "timeout"
    assert terminal["elapsed_seconds"] == 1800
    assert terminal["status"] is None
    assert terminal["request_id_hashes"] == {}
    assert terminal["previous_phase"] == "waiting"


@pytest.mark.asyncio
async def test_retry_delay_cannot_spend_the_remaining_budget(
    monkeypatch, caplog
):
    from app.model.provider_wait import ProviderRetryBudgetExceeded

    caplog.set_level("INFO", logger="provider_wait")
    clock = Clock(monkeypatch)
    calls = []

    async def handler(request):
        calls.append(request)
        await clock.sleep(8)
        return httpx.Response(
            429,
            headers={"retry-after": "5"},
            json={"error": {"message": "fixture"}},
        )

    async with client_for(handler) as client:
        backend(client)
        with pytest.raises(ProviderRetryBudgetExceeded):
            async with ActiveExecutionTimeout(10):
                await client.responses.create(
                    model="gpt-6-astra", input="fixture"
                )
    assert len(calls) == 1
    assert events(caplog)[-1]["phase"] == "timeout"
    assert events(caplog)[-1]["status"] == 429


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "hint,expected",
    [
        ({"retry-after-ms": "1500"}, 1.5),
        ({"retry-after": "7"}, 7),
        ({"retry-after": "invalid"}, 0.5),
        ({"retry-after": "Thu, 01 Jan 1970 00:16:47 GMT"}, 7),
    ],
)
async def test_retry_after_formats_follow_installed_sdk(
    monkeypatch, caplog, hint, expected
):
    clock = Clock(monkeypatch)
    if "GMT" in hint.get("retry-after", ""):
        monkeypatch.setattr("openai._base_client.time.time", lambda: 1000.0)
    monkeypatch.setattr("openai._base_client.anyio.sleep", clock.sleep)
    monkeypatch.setattr("openai._base_client.random", lambda: 0)
    caplog.set_level("INFO", logger="provider_wait")
    calls = []

    def handler(request):
        calls.append(request)
        return (
            httpx.Response(
                503, headers=hint, json={"error": {"message": "fixture"}}
            )
            if len(calls) == 1
            else completed()
        )

    async with client_for(handler, max_retries=1) as client:
        backend(client)
        await client.responses.create(model="gpt-6-astra", input="fixture")
    assert len(calls) == 2
    assert [
        e["retry_delay_seconds"]
        for e in events(caplog)
        if e["phase"] == "retrying"
    ] == [expected]


@pytest.mark.asyncio
async def test_request_options_override_retry_and_timeout(caplog):
    caplog.set_level("INFO", logger="provider_wait")
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(500, json={"error": {"message": "fixture"}})

    async with client_for(handler, timeout=600, max_retries=3) as client:
        backend(client)
        # Request options (including per-method timeout) are observed at the
        # dispatch boundary. SDK .with_options creates a different instance.
        from openai._models import FinalRequestOptions

        options = FinalRequestOptions.construct(
            method="post",
            url="/responses",
            json_data={"model": "gpt-6-astra", "input": "fixture"},
            timeout=httpx.Timeout(13, connect=2),
            max_retries=0,
        )
        with pytest.raises(openai.InternalServerError):
            await client.request(object, options)
    assert len(calls) == 1
    assert events(caplog)[0]["max_retries"] == 0
    assert events(caplog)[0]["timeout_seconds"]["connect"] == 2
    assert events(caplog)[0]["timeout_seconds"]["read"] == 13


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["headers", "backoff", "stream"])
async def test_explicit_cancel_drains_request_and_does_not_retry(
    monkeypatch, caplog, stage
):
    caplog.set_level("INFO", logger="provider_wait")
    entered = asyncio.Event()
    parked = asyncio.Event()
    calls, active = [], 0

    class Body(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            yield b'data: {"type":"response.created"}\n\n'
            entered.set()
            await parked.wait()

        async def aclose(self):
            self.closed = True

    body = Body()

    async def sleeping(_):
        entered.set()
        await parked.wait()

    async def handler(request):
        nonlocal active
        calls.append(request)
        active += 1
        try:
            if stage == "headers":
                entered.set()
                await parked.wait()
            if stage == "backoff":
                return httpx.Response(
                    503, json={"error": {"message": "fixture"}}
                )
            return httpx.Response(200, stream=body)
        finally:
            active -= 1

    if stage == "backoff":
        monkeypatch.setattr("openai._base_client.anyio.sleep", sleeping)
    async with client_for(handler) as client:
        backend(client)

        async def invoke():
            response = await client.responses.create(
                model="gpt-6-astra", input="fixture", stream=stage == "stream"
            )
            if stage == "stream":
                async for _ in response:
                    pass

        before = asyncio.all_tasks()
        task = asyncio.create_task(invoke())
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        for _ in range(3):
            await asyncio.sleep(0)
        assert asyncio.all_tasks() == before
    assert len(calls) == 1 and active == 0
    if stage == "stream":
        assert body.closed
    assert events(caplog)[-1]["phase"] == "cancelled"


class EventBody(httpx.AsyncByteStream):
    def __init__(self, clock, event_type, count=4):
        self.clock, self.event_type, self.count = clock, event_type, count
        self.closed = False

    async def __aiter__(self):
        for index in range(self.count):
            await self.clock.sleep(6)
            event = {
                "type": self.event_type,
                "delta": "private-reasoning",
                "sequence_number": index,
            }
            yield b"data: " + json.dumps(event).encode() + b"\n\n"
        yield b'data: {"type":"response.completed","response":{"status":"completed"}}\n\n'

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "event_type",
    [
        "response.reasoning_summary_text.delta",
        "response.output_text.delta",
        "response.function_call_arguments.delta",
    ],
)
async def test_observed_output_extends_only_stall_budget(
    monkeypatch, caplog, event_type
):
    from app.model.provider_wait import provider_stream_scope

    clock = Clock(monkeypatch)
    caplog.set_level("INFO", logger="provider_wait")
    body = EventBody(clock, event_type)
    progress = MagicMock()
    async with client_for(
        lambda _: httpx.Response(200, stream=body)
    ) as client:
        backend(client)
        async with provider_stream_scope(progress):
            async with ActiveExecutionTimeout(10, refresh_on_progress=True):
                stream = await client.responses.create(
                    model="gpt-6-astra", input="fixture", stream=True
                )
                async for _ in stream:
                    pass
    assert progress.call_count == 4
    assert body.closed
    assert events(caplog)[-1]["phase"] == "completed"
    assert events(caplog)[-1]["elapsed_seconds"] == 24
    assert "private-reasoning" not in json.dumps(events(caplog))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "event_type", ["response.created", "response.in_progress"]
)
async def test_provider_status_events_are_not_reasoning_progress(
    monkeypatch, event_type
):
    clock = Clock(monkeypatch)
    body = EventBody(clock, event_type)
    async with client_for(
        lambda _: httpx.Response(200, stream=body)
    ) as client:
        backend(client)
        with pytest.raises(TimeoutError):
            async with ActiveExecutionTimeout(10, refresh_on_progress=True):
                stream = await client.responses.create(
                    model="gpt-6-astra", input="fixture", stream=True
                )
                async for _ in stream:
                    pass
    assert body.closed


@pytest.mark.asyncio
async def test_reasoning_cannot_extend_hard_budget(monkeypatch):
    clock = Clock(monkeypatch)
    body = EventBody(clock, "response.reasoning_summary_text.delta")
    async with client_for(
        lambda _: httpx.Response(200, stream=body)
    ) as client:
        backend(client)
        with pytest.raises(TimeoutError):
            async with ActiveExecutionTimeout(17):
                async with ActiveExecutionTimeout(
                    10, refresh_on_progress=True
                ):
                    stream = await client.responses.create(
                        model="gpt-6-astra", input="fixture", stream=True
                    )
                    async for _ in stream:
                        pass
    assert body.closed


@pytest.mark.asyncio
async def test_connection_trace_is_evidence_based_and_preserves_prior_hook(
    monkeypatch, caplog
):
    clock = Clock(monkeypatch)
    caplog.set_level("INFO", logger="provider_wait")
    prior = []

    async def handler(request):
        trace = request.extensions["trace"]
        await trace("connection.connect_tcp.started", {"host": "private-host"})
        await clock.sleep(2)
        await trace("connection.start_tls.started", {})
        await clock.sleep(1)
        await trace("http11.receive_response_headers.started", {})
        await clock.sleep(4)
        return completed()

    async with client_for(handler) as client:

        async def prepare(request):
            async def trace(name, info):
                prior.append(name)

            request.extensions["trace"] = trace

        client._prepare_request = prepare
        backend(client)
        await client.responses.create(model="gpt-6-astra", input="fixture")
    observed = events(caplog)
    assert len(prior) == 3
    assert [(e["phase"], e.get("stage")) for e in observed[:4]] == [
        ("waiting", "dispatch"),
        ("connecting", "tcp"),
        ("connecting", "tls"),
        ("waiting", "response_headers"),
    ]
    assert observed[-1]["headers_elapsed_seconds"] == 7
    assert "private-host" not in json.dumps(observed)


@pytest.mark.asyncio
async def test_tool_and_hitl_boundaries_preserve_pause_accounting(
    monkeypatch, caplog
):
    from app.run_runtime.active_timeout import (
        pause_active_execution_timeout,
        remaining_active_execution_seconds,
    )
    from app.run_runtime.tool_checkpoint import tool_checkpoint_scope

    clock = Clock(monkeypatch)
    caplog.set_level("INFO", logger="provider_wait")
    checkpoint = SimpleNamespace(tool_call_id="tool-fixture")
    async with ActiveExecutionTimeout(10, refresh_on_progress=True):
        await clock.sleep(2)
        with tool_checkpoint_scope(checkpoint):
            async with pause_active_execution_timeout():
                await clock.sleep(3600)
                assert remaining_active_execution_seconds() == pytest.approx(
                    8, rel=0, abs=1e-9
                )
        assert remaining_active_execution_seconds() == pytest.approx(
            8, rel=0, abs=1e-9
        )
    observed = events(caplog)
    assert [(e["phase"], e["boundary"]) for e in observed] == [
        ("tool", "enter"),
        ("hitl", "enter"),
        ("hitl", "exit"),
        ("tool", "exit"),
    ]
    assert observed[1]["parent_activity_id"] == observed[0]["activity_id"]
    assert "completed" not in json.dumps(observed)


@pytest.mark.asyncio
async def test_terminal_stream_is_closed_before_next_serial_model_request(
    monkeypatch,
):
    from app.model.provider_wait import _STREAMS, provider_stream_scope

    clock = Clock(monkeypatch)
    body = EventBody(clock, "response.output_text.delta", count=0)
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) > 1:
            assert body.closed
        return (
            httpx.Response(200, stream=body)
            if len(calls) == 1
            else completed()
        )

    async with client_for(handler) as client:
        backend(client)
        async with provider_stream_scope():
            stream = await client.responses.create(
                model="gpt-6-astra", input="fixture", stream=True
            )
            await anext(
                stream
            )  # Provider terminal, consumer has not read EOF.
            assert not body.closed
            await client.responses.create(model="gpt-6-astra", input="fixture")
            assert body.closed and not _STREAMS.get()
    assert len(calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal", ["failed", "incomplete", "eof"])
async def test_failed_or_truncated_stream_is_not_reported_completed(
    caplog, terminal
):
    caplog.set_level("INFO", logger="provider_wait")
    body = b'data: {"type":"response.created"}\n\n'
    if terminal != "eof":
        body += (
            b"data: "
            + json.dumps(
                {
                    "type": f"response.{terminal}",
                    "response": {"status": terminal},
                }
            ).encode()
            + b"\n\n"
        )
    async with client_for(
        lambda _: httpx.Response(200, content=body)
    ) as client:
        backend(client)
        stream = await client.responses.create(
            model="gpt-6-astra", input="fixture", stream=True
        )
        async for _ in stream:
            pass
    assert events(caplog)[-1]["phase"] == (
        "stream_ended" if terminal == "eof" else terminal
    )


@pytest.mark.parametrize(
    "failure,attempts",
    [(429, 3), (500, 3), (400, 1), (401, 1), ("long_hint", 1), ("timeout", 3)],
)
def test_sync_sdk_retry_budget_and_idempotent_install(
    monkeypatch, caplog, failure, attempts
):
    from app.model.provider_wait import instrument_provider_wait

    monkeypatch.setattr("app.model.provider_wait.time.sleep", lambda _: None)
    caplog.set_level("INFO", logger="provider_wait")
    calls = []

    def handler(request):
        calls.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("fixture", request=request)
        status = 429 if failure == "long_hint" else failure
        return httpx.Response(
            status,
            headers={"retry-after": "120" if failure == "long_hint" else "1"},
            json={"error": {"message": "private-error"}},
        )

    with openai.OpenAI(
        api_key="fixture",
        max_retries=2,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    ) as client:
        model = SimpleNamespace(_client=client)
        original_http_client = client._client
        instrument_provider_wait(model)
        instrument_provider_wait(model)
        with pytest.raises(openai.APIError):
            client.responses.create(model="gpt-6-astra", input="fixture")
        assert client._client is original_http_client
    assert len(calls) == attempts
    assert (
        len([e for e in events(caplog) if e.get("stage") == "dispatch"])
        == attempts
    )
    assert events(caplog)[-1]["phase"] == (
        "timeout" if failure == "timeout" else "failed"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider", ["openai", "openai-compatible-model", "azure"]
)
@pytest.mark.parametrize("api_mode", ["responses", "chat_completions"])
@pytest.mark.parametrize("stream", [False, True])
async def test_real_camel_defaults_sync_async_and_payload_unchanged(
    caplog, provider, api_mode, stream
):
    from camel.models import ModelFactory

    from app.model.provider_wait import instrument_provider_wait

    caplog.set_level("INFO", logger="provider_wait")
    requests = []
    response_doc = completed().json()
    response_doc["usage"] = {
        "input_tokens": 1,
        "output_tokens": 1,
        "total_tokens": 2,
    }
    chat = {
        "id": "chat_fixture",
        "object": "chat.completion",
        "created": 0,
        "model": "gpt-6-astra",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "fixture"},
                "finish_reason": "stop",
            }
        ],
    }

    def handler(request):
        requests.append(request)
        if stream:
            event = (
                {"type": "response.completed", "response": response_doc}
                if api_mode == "responses"
                else {
                    **chat,
                    "object": "chat.completion.chunk",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": "fixture"},
                            "finish_reason": "stop",
                        }
                    ],
                }
            )
            return httpx.Response(
                200,
                content=b"data: "
                + json.dumps(event).encode()
                + b"\n\ndata: [DONE]\n\n",
            )
        return httpx.Response(
            200, json=response_doc if api_mode == "responses" else chat
        )

    model = ModelFactory.create(
        model_platform=provider,
        model_type="gpt-6-astra",
        api_key="fixture",
        url="https://provider.invalid",
        timeout=600,
        api_mode=api_mode,
        token_counter=MagicMock(),
        model_config_dict={"stream": stream},
        **(
            {"api_version": "2025-04-01-preview"}
            if provider == "azure"
            else {}
        ),
    )
    assert model._client.max_retries == model._async_client.max_retries == 3
    model._client._client.close()
    await model._async_client._client.aclose()
    model._client._client = httpx.Client(
        transport=httpx.MockTransport(handler)
    )
    model._async_client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    )
    instrument_provider_wait(model)
    messages = [{"role": "user", "content": "fixture"}]
    config = model.model_config_dict.copy()
    try:
        result = model.run(messages)
        if stream:
            list(result)
        result = await model.arun(messages)
        if stream:
            async for _ in result:
                pass
    finally:
        model._client.close()
        await model._async_client.close()
    assert len(requests) == 2
    assert model.model_config_dict == config
    for request in requests:
        assert request.extensions["timeout"]["read"] == 600
        payload = json.loads(request.content)
        assert payload["model"] == "gpt-6-astra"
        assert payload["stream"] == stream
        assert "provider_wait" not in request.content.decode()
    assert all(e["max_retries"] == 3 for e in events(caplog))


@pytest.mark.asyncio
async def test_cancel_keeps_one_terminal_journal_invocation(tmp_path, caplog):
    from app.run_context.context import RunContext, run_context_scope
    from app.run_journal.store import SQLiteRunJournal

    caplog.set_level("INFO", logger="provider_wait")
    journal = SQLiteRunJournal(tmp_path / "isolated.sqlite3")
    journal.ensure_run(
        run_id="run-fixture", project_id="project-fixture", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-fixture", request_id="fixture", reason="initial_execution"
    )
    context = RunContext(
        space_id="space-fixture",
        project_id="project-fixture",
        run_id="run-fixture",
        task_id="task-fixture",
        email="private-email",
        user_id="private-user",
        working_directory=tmp_path,
        task_output_root=tmp_path,
        camel_log_dir=tmp_path / "logs",
        binding_source="fixture",
        workdir_mode="fixture",
        browser_port=0,
        attempt_id=attempt.attempt_id,
    )
    entered = asyncio.Event()

    async def handler(request):
        entered.set()
        await asyncio.Event().wait()

    async with client_for(handler) as client:

        async def arun(messages):
            return await client.responses.create(
                model="gpt-6-astra", input=messages
            )

        model = SimpleNamespace(
            _async_client=client,
            _api_mode="responses",
            model_config_dict={},
            run=lambda _: None,
            arun=arun,
        )
        instrument_model_backend(
            model,
            agent_id="agent-fixture",
            provider="azure",
            model_name="gpt-6-astra",
            journal=journal,
        )
        with run_context_scope(context):
            task = asyncio.create_task(
                model.arun([{"role": "user", "content": "fixture"}])
            )
            await entered.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
    records = journal.list_model_invocations("run-fixture")
    assert len(records) == 1
    assert records[0].status == "outcome_unknown"
    observed = events(caplog)
    assert {e["invocation_id"] for e in observed} == {records[0].invocation_id}
    assert {e["run_attempt_id"] for e in observed} == {attempt.attempt_id}
    assert "private-email" not in json.dumps(observed)
    assert "private-user" not in json.dumps(observed)


@pytest.mark.asyncio
async def test_reasoning_delta_updates_workforce_progress_without_queue_events(
    monkeypatch,
):
    from app.model.provider_wait import provider_stream_scope

    clock = Clock(monkeypatch)
    body = EventBody(clock, "response.reasoning_summary_text.delta")
    task_lock = SimpleNamespace(execution_progress_revision=0)
    monkeypatch.setattr(
        "app.agent.listen_chat_agent.get_task_lock_if_exists",
        lambda _: task_lock,
    )
    agent = streaming_agent()
    agent.api_task_id = "fixture"
    async with client_for(
        lambda _: httpx.Response(200, stream=body)
    ) as client:
        backend(client)
        async with provider_stream_scope(agent._mark_provider_progress):
            async with ActiveExecutionTimeout(10, refresh_on_progress=True):
                stream = await client.responses.create(
                    model="gpt-6-astra", input="fixture", stream=True
                )
                async for _ in stream:
                    pass
    assert task_lock.execution_progress_revision == 4


@pytest.mark.asyncio
async def test_sse_comments_and_empty_deltas_do_not_fake_progress(monkeypatch):
    clock = Clock(monkeypatch)

    class HeartbeatBody(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            for _ in range(4):
                await clock.sleep(6)
                yield b': keepalive\n\ndata: {"type":"response.output_text.delta","delta":""}\n\n'

        async def aclose(self):
            self.closed = True

    body = HeartbeatBody()
    async with client_for(
        lambda _: httpx.Response(200, stream=body)
    ) as client:
        backend(client)
        with pytest.raises(TimeoutError):
            async with ActiveExecutionTimeout(10, refresh_on_progress=True):
                stream = await client.responses.create(
                    model="gpt-6-astra", input="fixture", stream=True
                )
                async for _ in stream:
                    pass
    assert body.closed


@pytest.mark.asyncio
async def test_disconnect_after_partial_output_is_closed_and_never_retried(
    caplog,
):
    caplog.set_level("INFO", logger="provider_wait")
    calls = []

    class BrokenBody(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            yield b'data: {"type":"response.output_text.delta","delta":"fixture"}\n\n'
            raise httpx.ReadError("private-disconnect")

        async def aclose(self):
            self.closed = True

    body = BrokenBody()

    def handler(request):
        calls.append(request)
        return httpx.Response(200, stream=body)

    async with client_for(handler, max_retries=3) as client:
        backend(client)
        stream = await client.responses.create(
            model="gpt-6-astra", input="fixture", stream=True
        )
        with pytest.raises(httpx.ReadError):
            async for _ in stream:
                pass
    assert body.closed and len(calls) == 1
    assert events(caplog)[-1]["phase"] == "transport_error"
    assert "private-disconnect" not in json.dumps(events(caplog))


@pytest.mark.asyncio
async def test_stream_idle_timeout_is_not_frozen_to_old_sliding_remainder(
    monkeypatch,
):
    clock = Clock(monkeypatch)
    requests = []

    class Body(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            for delay in (1, 6):
                await clock.sleep(delay)
                yield b'data: {"type":"response.output_text.delta","delta":"fixture"}\n\n'

        async def aclose(self):
            self.closed = True

    body = Body()

    def handler(request):
        requests.append(request)
        return httpx.Response(200, stream=body)

    async with client_for(handler, timeout=600) as client:
        backend(client)
        async with ActiveExecutionTimeout(10, refresh_on_progress=True):
            await clock.sleep(8)
            stream = await client.responses.create(
                model="gpt-6-astra", input="fixture", stream=True
            )
            async for _ in stream:
                pass
    assert body.closed
    assert requests[0].extensions["timeout"]["connect"] == 2
    assert requests[0].extensions["timeout"]["read"] == 600


@pytest.mark.asyncio
async def test_failed_response_is_closed_before_retry_dispatch(monkeypatch):
    clock = Clock(monkeypatch)
    monkeypatch.setattr("openai._base_client.anyio.sleep", clock.sleep)

    class ErrorBody(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            yield b'{"error":{"message":"fixture"}}'

        async def aclose(self):
            self.closed = True

    body = ErrorBody()
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(503, stream=body)
        assert body.closed
        return httpx.Response(
            200,
            content=b'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
        )

    async with client_for(handler, max_retries=1) as client:
        backend(client)
        stream = await client.responses.create(
            model="gpt-6-astra", input="fixture", stream=True
        )
        async for _ in stream:
            pass
    assert body.closed and len(calls) == 2


@pytest.mark.asyncio
async def test_same_client_concurrent_calls_keep_observations_separate(caplog):
    caplog.set_level("INFO", logger="provider_wait")
    arrived = asyncio.Event()
    count = 0

    async def handler(request):
        nonlocal count
        count += 1
        if count == 2:
            arrived.set()
        await arrived.wait()
        return completed()

    async with client_for(handler) as client:
        backend(client)
        await asyncio.gather(
            *[
                client.responses.create(model="gpt-6-astra", input="fixture")
                for _ in range(2)
            ]
        )
    terminal = [e for e in events(caplog) if e["phase"] == "completed"]
    assert len(terminal) == 2
    assert len({e["call_id"] for e in terminal}) == 2
    assert [e["attempt"] for e in terminal] == [1, 1]


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
@pytest.mark.parametrize("hint,expected", [("1", 4), ("120", 1)])
async def test_camel_does_not_multiply_sdk_retries(
    monkeypatch, mode, hint, expected
):
    from camel.models import ModelFactory, ModelProcessingError

    from app.agent.listen_chat_agent import ListenChatAgent
    from app.model.provider_wait import instrument_provider_wait

    async def no_sleep(_):
        await asyncio.sleep(0)

    monkeypatch.setattr("openai._base_client.anyio.sleep", no_sleep)
    monkeypatch.setattr("app.model.provider_wait.time.sleep", lambda _: None)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            429,
            headers={"retry-after": hint},
            json={"error": {"message": "fixture"}},
        )

    model = ModelFactory.create(
        model_platform="openai",
        model_type="gpt-6-astra",
        api_key="fixture",
        url="https://provider.invalid",
        timeout=600,
        api_mode="responses",
        token_counter=MagicMock(),
        model_config_dict={"stream": False},
    )
    model._client._client.close()
    await model._async_client._client.aclose()
    model._client._client = httpx.Client(
        transport=httpx.MockTransport(handler)
    )
    model._async_client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler)
    )
    instrument_provider_wait(model)
    agent = ListenChatAgent("fixture", "fixture", model=model)
    agent.retry_delay = 0
    try:
        with pytest.raises((openai.RateLimitError, ModelProcessingError)):
            if mode == "sync":
                agent._get_model_response(
                    [{"role": "user", "content": "fixture"}]
                )
            else:
                await agent._aget_model_response(
                    [{"role": "user", "content": "fixture"}]
                )
    finally:
        model._client.close()
        await model._async_client.close()
    assert len(calls) == expected
