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

"""Real CAMEL adapters and SDK serialization, with no provider connections."""

import base64
import json
import sys
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
import pytest_asyncio
from camel.models import ModelFactory
from openai import AsyncAzureOpenAI, AsyncOpenAI, AzureOpenAI, OpenAI
from PIL import Image

from app.agent.agent_model import _configure_responses_instructions
from app.model.model_platform import resolve_cloud_model_runtime_platform
from app.model.responses_input import configure_responses_input
from app.model.subscription_runtime import codex
from app.run_context import RunContext, run_context_scope
from app.run_journal import SQLiteRunJournal
from app.run_journal.model_capture import instrument_model_backend
from app.workload import (
    CAPTURE_POLICY_REQUIRED,
    DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
    RETENTION_POLICY_EVIDENCE_REQUIRED,
)

ROUTES = ("openai", "openai-compatible-model", "azure", "cloud-azure", "codex")


@pytest.fixture
def image_url(tmp_path):
    path = tmp_path / "fixture.png"
    Image.new("RGB", (2, 2), (40, 80, 120)).save(path)
    return (
        "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()
    )


def completion_payload():
    return {
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
        "usage": {"input_tokens": 10, "output_tokens": 3, "total_tokens": 13},
    }


def mock_response(request):
    body = json.loads(request.content)
    if request.url.path.endswith("chat/completions"):
        result = {
            "id": "chat_fixture",
            "object": "chat.completion",
            "created": 1,
            "model": "gpt-6-astra",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "image reviewed",
                    },
                    "finish_reason": "stop",
                }
            ],
        }
        if body.get("stream"):
            result["object"] = "chat.completion.chunk"
            result["choices"][0]["delta"] = result["choices"][0].pop("message")
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text=f"data: {json.dumps(result)}\n\ndata: [DONE]\n\n",
            )
        return httpx.Response(200, json=result)
    result = completion_payload()
    if body.get("stream"):
        events = [
            {
                "type": "response.created",
                "response": {**result, "status": "in_progress", "output": []},
            },
            {
                "type": "response.output_text.delta",
                "item_id": "msg_fixture",
                "output_index": 0,
                "content_index": 0,
                "delta": "image reviewed",
            },
            {"type": "response.completed", "response": result},
        ]
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text="".join(f"data: {json.dumps(event)}\n\n" for event in events),
        )
    return httpx.Response(200, json=result)


@pytest_asyncio.fixture
async def make_backend(monkeypatch):
    clients = []

    def make(
        route, stream=False, api_mode="responses", handler=None, config=None
    ):
        requests = []

        def receive(request):
            requests.append(request)
            return (handler or mock_response)(request)

        transport = httpx.MockTransport(receive)
        client_kwargs = {"api_key": "fixture-key", "max_retries": 0}
        init = {"api_mode": api_mode}
        model_config = {"stream": stream, **(config or {})}
        platform = route
        url = "https://provider.example.test/v1"
        if route == "cloud-azure":
            url = "https://eigent-proxy.example.test"
            platform = resolve_cloud_model_runtime_platform(
                model_platform="azure",
                api_url=url,
                api_mode=api_mode,
            )
        if route == "codex":
            monkeypatch.setattr(
                codex,
                "_resolve_access_token",
                lambda *a, **kw: {"access_token": "fixture-token"},
            )
            effective, extra = codex.apply_codex_subscription_runtime(
                SimpleNamespace(
                    auth_source="codex_subscription",
                    email="fixture@example.test",
                ),
                {
                    "model_platform": "openai",
                    "api_url": "https://codex.example.test/backend-api/codex",
                },
                {},
            )
            platform, url = effective["model_platform"], effective["api_url"]
            client_kwargs["api_key"] = effective["api_key"]
            client_kwargs["default_headers"] = extra.pop("default_headers")
            init["api_mode"] = extra.pop("api_mode")
            model_config.update(extra)
        if platform == "azure":
            client_kwargs.update(
                azure_endpoint=url, api_version="2025-03-01-preview"
            )
            init["api_version"] = "2025-03-01-preview"
            sync_class, async_class = AzureOpenAI, AsyncAzureOpenAI
        else:
            client_kwargs["base_url"] = url
            sync_class, async_class = OpenAI, AsyncOpenAI
        client = sync_class(
            **client_kwargs, http_client=httpx.Client(transport=transport)
        )
        async_client = async_class(
            **client_kwargs, http_client=httpx.AsyncClient(transport=transport)
        )
        clients.append((client, async_client))
        backend = ModelFactory.create(
            model_platform=platform,
            model_type="gpt-6-astra",
            api_key="fixture-key",
            url=url,
            model_config_dict=model_config,
            client=client,
            async_client=async_client,
            **init,
        )
        return backend, requests

    yield make
    for client, async_client in clients:
        client.close()
        await async_client.close()


async def invoke(backend, messages, asynchronous):
    result = (
        await backend.arun(messages) if asynchronous else backend.run(messages)
    )
    if backend.model_config_dict.get("stream"):
        return (
            [chunk async for chunk in result] if asynchronous else list(result)
        )
    return result


@pytest.mark.parametrize("route", ["openai", "openai-compatible-model"])
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_explicit_stream_error_is_local_to_the_request(
    make_backend, route, asynchronous
):
    responses = []

    def respond(request):
        if responses:
            response = mock_response(request)
        else:
            events = [
                {
                    "type": "response.output_text.delta",
                    "delta": "partial inspection",
                    "item_id": "msg_fixture",
                    "output_index": 0,
                    "content_index": 0,
                    "sequence_number": 0,
                },
                {
                    "type": "error",
                    "code": "server_error",
                    "message": "fixture stream rejected",
                    "param": None,
                    "sequence_number": 1,
                },
            ]
            response = httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text="".join(
                    f"data: {json.dumps(event)}\n\n" for event in events
                ),
            )
        responses.append(response)
        return response

    backend, requests = make_backend(route, stream=True, handler=respond)
    shared_client = backend._async_client if asynchronous else backend._client
    resource = shared_client.responses
    create = resource.create
    configure_responses_input(backend)
    guarded_client = backend._async_client if asynchronous else backend._client
    configure_responses_input(backend)
    assert guarded_client is (
        backend._async_client if asynchronous else backend._client
    )
    messages = [{"role": "user", "content": "inspect fixture"}]
    with pytest.raises(RuntimeError, match="fixture stream rejected"):
        await invoke(backend, messages, asynchronous)
    assert responses[0].is_closed
    assert shared_client.responses is resource
    assert resource.create == create

    # The same backend can serve its next request; no sticky error state or
    # completion callback may be left behind by the failed stream.
    chunks = await invoke(backend, messages, asynchronous)
    assert any(
        chunk.choices and chunk.choices[0].delta.content == "image reviewed"
        for chunk in chunks
    )
    assert len(requests) == 2
    assert "previous_response_id" not in json.loads(requests[1].content)


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_text_image_parts_reach_real_sdk(
    make_backend, image_url, route, stream, asynchronous
):
    backend, requests = make_backend(
        route,
        stream,
        config={
            "instructions": "trusted",
            "reasoning": {"effort": "high", "summary": "auto"},
        },
    )
    _configure_responses_instructions(backend)
    parts = [{"type": "text", "text": "inspect the fixture"}]
    expected = [{"type": "input_text", "text": "inspect the fixture"}]
    for url in (image_url, "https://images.example.test/fixture.png"):
        for detail in (None, "auto", "low", "high", "original"):
            detail_fields = {} if detail is None else {"detail": detail}
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {"url": url, **detail_fields},
                }
            )
            expected.append(
                {"type": "input_image", "image_url": url, **detail_fields}
            )
    parts.append(
        {"type": "image_url", "image_url": image_url, "detail": "original"}
    )
    expected.append(
        {"type": "input_image", "image_url": image_url, "detail": "original"}
    )
    messages = [
        {"role": "system", "content": "trusted"},
        {"role": "user", "content": parts},
    ]
    before = deepcopy(messages)
    await invoke(backend, messages, asynchronous)
    body = json.loads(requests[-1].content)
    assert body["input"] == [{"role": "user", "content": expected}]
    assert body["reasoning"] == {"effort": "high", "summary": "auto"}
    assert body["instructions"] == "trusted"
    assert messages == before
    if route == "azure":
        assert requests[-1].url.path == "/v1/openai/responses"
    elif route == "cloud-azure":
        assert requests[-1].url.path == "/responses"
    elif route == "codex":
        assert body["stream"] is True and body["store"] is False
        assert requests[-1].headers["originator"] == "codex_cli_rs"
    else:
        assert requests[-1].url.path == "/v1/responses"


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.asyncio
async def test_native_items_and_tools_are_lossless_and_idempotent(
    make_backend, image_url, route
):
    backend, requests = make_backend(route)
    _configure_responses_instructions(backend)
    items = [
        {
            "type": "message",
            "role": "user",
            "content": [
                {"type": "input_text", "text": "fixture"},
                {
                    "type": "input_image",
                    "file_id": "file_fixture",
                    "detail": "original",
                },
                {
                    "type": "input_image",
                    "image_url": image_url,
                    "detail": "high",
                },
                {"type": "input_file", "file_id": "file_pdf"},
            ],
        },
        {
            "type": "reasoning",
            "id": "rs_fixture",
            "summary": [],
            "encrypted_content": "opaque",
        },
        {
            "type": "message",
            "id": "msg_previous",
            "role": "assistant",
            "status": "completed",
            "content": [
                {"type": "output_text", "text": "done", "annotations": []}
            ],
        },
        {
            "type": "function_call",
            "call_id": "call_native",
            "name": "inspect",
            "arguments": '{"type":"text"}',
            "status": "completed",
        },
        {
            "type": "function_call_output",
            "call_id": "call_native",
            "output": [
                {"type": "input_text", "text": "tool result"},
                {"type": "input_image", "image_url": image_url},
            ],
        },
        {"type": "item_reference", "id": "msg_other"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_chat",
                    "type": "function",
                    "function": {
                        "name": "inspect",
                        "arguments": '{"type":"image_url"}',
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_chat",
            "content": '{"type":"text","text":"result"}',
        },
    ]
    before = deepcopy(items)
    expected = items[:-2] + [
        {
            "type": "function_call",
            "call_id": "call_chat",
            "name": "inspect",
            "arguments": '{"type":"image_url"}',
        },
        {
            "type": "function_call_output",
            "call_id": "call_chat",
            "output": '{"type":"text","text":"result"}',
        },
    ]
    converted = backend._convert_messages_to_responses_input(items)
    assert converted == expected
    assert backend._convert_messages_to_responses_input(converted) == expected
    _configure_responses_instructions(backend)
    await invoke(backend, items, False)
    assert json.loads(requests[-1].content)["input"] == expected
    assert items == before


@pytest.mark.parametrize("route", ROUTES[:-1])
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_chat_completions_payload_is_unchanged(
    make_backend, image_url, route, stream, asynchronous
):
    backend, requests = make_backend(route, stream, "chat_completions")
    configure_responses_input(backend)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "inspect"},
                {
                    "type": "image_url",
                    "image_url": {"url": image_url, "detail": "high"},
                },
            ],
        }
    ]
    before = deepcopy(messages)
    await invoke(backend, messages, asynchronous)
    assert json.loads(requests[-1].content)["messages"] == before
    assert messages == before


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_chain_delta_retains_each_adapter_behavior(
    make_backend, image_url, route, asynchronous
):
    backend, requests = make_backend(route)
    configure_responses_input(backend)
    messages = [{"role": "user", "content": "first question"}]
    await invoke(backend, messages, asynchronous)
    messages += [
        {"role": "assistant", "content": "first answer"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "second question"},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        },
    ]
    before = deepcopy(messages)
    await invoke(backend, messages, asynchronous)
    body = json.loads(requests[-1].content)
    image_message = {
        "role": "user",
        "content": [
            {"type": "input_text", "text": "second question"},
            {"type": "input_image", "image_url": image_url},
        ],
    }
    if route == "codex":
        assert "previous_response_id" not in body
        assert body["input"] == messages[:-1] + [image_message]
    else:
        assert body["previous_response_id"] == "resp_fixture"
        expected = [image_message]
        if route in {"openai", "azure"}:
            expected.insert(0, messages[1])
        assert body["input"] == expected
    assert messages == before
    # A memory reset still clears the original adapter's stored chain state.
    await invoke(backend, [messages[-1]], asynchronous)
    assert "previous_response_id" not in json.loads(requests[-1].content)


def test_configuring_one_backend_never_patches_camel_classes(make_backend):
    from camel.models.azure_openai_model import AzureOpenAIModel
    from camel.models.openai_compatible_model import OpenAICompatibleModel
    from camel.models.openai_model import OpenAIModel

    classes = (OpenAIModel, OpenAICompatibleModel, AzureOpenAIModel)
    converters = [cls._convert_messages_to_responses_input for cls in classes]
    first, _ = make_backend("openai")
    second, _ = make_backend("openai")
    configure_responses_input(first)
    configured = first._convert_messages_to_responses_input
    configure_responses_input(first)
    assert first._convert_messages_to_responses_input is configured
    make_backend("codex")
    assert [
        cls._convert_messages_to_responses_input for cls in classes
    ] == converters
    assert second._convert_messages_to_responses_input is converters[0]


@pytest.fixture
def factory_runtime(monkeypatch, tmp_path):
    module = sys.modules["app.agent.agent_model"]
    monkeypatch.setattr(
        module,
        "get_task_lock",
        lambda _: SimpleNamespace(put_queue=AsyncMock()),
    )
    monkeypatch.setattr(
        module, "_schedule_async_task", lambda coroutine: coroutine.close()
    )
    monkeypatch.setattr(
        module,
        "ListenChatAgent",
        lambda *args, **kwargs: SimpleNamespace(**kwargs),
    )
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(
        run_id="factory-run", project_id="factory-project", status="pending"
    )
    attempt = journal.create_run_attempt(
        "factory-run",
        request_id="fixture",
        reason="initial_execution",
        workload_profile=replace(
            DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
            workload_kind="test",
            profile_version="test-v1",
            capture_policy_ref=CAPTURE_POLICY_REQUIRED,
            retention_policy_ref=RETENTION_POLICY_EVIDENCE_REQUIRED,
        ),
    )
    context = RunContext(
        space_id="factory-space",
        project_id="factory-project",
        run_id="factory-run",
        task_id="factory-task",
        email="fixture@example.test",
        user_id="fixture",
        working_directory=tmp_path,
        task_output_root=tmp_path,
        camel_log_dir=tmp_path / "logs",
        binding_source="fixture",
        workdir_mode="fixture",
        browser_port=0,
        attempt_id=attempt.attempt_id,
    )

    def instrument(backend, **kwargs):
        # SDK observers must receive real clients before input facades wrap
        # them. Keep this regression independent of optional observer code.
        assert isinstance(backend._client, OpenAI)
        assert isinstance(backend._async_client, AsyncOpenAI)
        return instrument_model_backend(backend, journal=journal, **kwargs)

    spy = MagicMock(side_effect=instrument)
    monkeypatch.setattr(module, "instrument_model_backend", spy)
    yield SimpleNamespace(
        module=module, journal=journal, context=context, instrument=spy
    )
    journal.close()


@pytest.mark.parametrize("instructions", ["trusted prompt", ""])
@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("asynchronous,stream", [(False, False), (True, True)])
@pytest.mark.asyncio
async def test_agent_factory_installs_adapter_including_reload(
    make_backend,
    factory_runtime,
    sample_chat_data,
    image_url,
    route,
    instructions,
    asynchronous,
    stream,
):
    from app.model.chat import Chat

    fixture, requests = make_backend(route)
    module = factory_runtime.module
    shared_create = (
        fixture._client.responses.create,
        fixture._async_client.responses.create,
    )
    platform = (
        "azure"
        if route == "cloud-azure"
        else "openai"
        if route == "codex"
        else route
    )
    kwargs = {
        "api_mode": "responses",
        "client": fixture._client,
        "async_client": fixture._async_client,
        "stream": stream,
    }
    if platform == "azure":
        kwargs["api_version"] = "2025-03-01-preview"
    chat = Chat(
        **{
            **sample_chat_data,
            "model_platform": platform,
            "model_type": "gpt-6-astra",
            "api_key": "fixture-key",
            "api_url": str(fixture._url),
            "extra_params": kwargs,
            "auth_source": "codex_subscription" if route == "codex" else None,
        }
    )
    agent = module.agent_model("image_agent", instructions, chat, tools=[])
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "inspect"},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        }
    ]
    expected = [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "inspect"},
                {"type": "input_image", "image_url": image_url},
            ],
        }
    ]
    assert (
        agent.model._convert_messages_to_responses_input(messages) == expected
    )
    user_messages = deepcopy(messages)
    if instructions:
        messages.insert(0, {"role": "system", "content": instructions})
        messages.insert(1, {"role": "developer", "content": instructions})
    original = deepcopy(messages)
    configure_responses_input(agent.model)
    if instructions:
        _configure_responses_instructions(agent.model)
    with run_context_scope(factory_runtime.context):
        await invoke(agent.model, messages, asynchronous)
    body = json.loads(requests[-1].content)
    assert body["input"] == expected
    assert body.get("instructions", "") == instructions
    assert messages == original
    assert factory_runtime.instrument.call_count == 1
    if route == "codex":
        refreshed = agent.model_reload_callback()
        assert refreshed is not agent.model
        assert (
            refreshed._convert_messages_to_responses_input(user_messages)
            == expected
        )
        with run_context_scope(factory_runtime.context):
            await invoke(refreshed, messages, not asynchronous)
        assert json.loads(requests[-1].content)["input"] == expected
        assert (
            json.loads(requests[-1].content).get("instructions", "")
            == instructions
        )
        assert factory_runtime.instrument.call_count == 2
    assert shared_create == (
        fixture._client.responses.create,
        fixture._async_client.responses.create,
    )
    records = factory_runtime.journal.list_model_invocations("factory-run")
    assert (
        len(records) == len(requests) == factory_runtime.instrument.call_count
    )
    assert all(record.status == "completed" for record in records)
    assert {record.agent_id for record in records} == {agent.agent_id}


@pytest.mark.parametrize("api_mode", ["responses", "chat_completions"])
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.asyncio
async def test_factory_capture_is_single_and_required_before_dispatch(
    make_backend,
    factory_runtime,
    monkeypatch,
    sample_chat_data,
    image_url,
    api_mode,
    asynchronous,
    stream,
):
    from app.model.chat import Chat

    fixture, requests = make_backend("openai", api_mode=api_mode)
    chat = Chat(
        **{
            **sample_chat_data,
            "model_type": "gpt-6-astra",
            "extra_params": {
                "api_mode": api_mode,
                "client": fixture._client,
                "async_client": fixture._async_client,
                "stream": stream,
            },
        }
    )
    agent = factory_runtime.module.agent_model(
        "image_agent", "", chat, tools=[]
    )
    model = agent.model
    # Repeated installation must not add a second durable capture wrapper.
    assert (
        instrument_model_backend(
            model,
            agent_id=agent.agent_id,
            provider="openai",
            model_name="gpt-6-astra",
            journal=factory_runtime.journal,
        )
        is model
    )
    configure_responses_input(model)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "inspect"},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        }
    ]
    original = deepcopy(messages)
    with run_context_scope(factory_runtime.context):
        await invoke(model, messages, asynchronous)
    records = factory_runtime.journal.list_model_invocations("factory-run")
    assert len(records) == len(requests) == 1
    assert records[0].status == "completed"
    assert messages == original
    if api_mode == "chat_completions":
        assert json.loads(requests[0].content)["messages"] == original
        assert model._client is fixture._client
        assert model._async_client is fixture._async_client
    else:
        assert json.loads(requests[0].content)["input"][0]["content"] == [
            {"type": "input_text", "text": "inspect"},
            {"type": "input_image", "image_url": image_url},
        ]
    monkeypatch.setattr(
        factory_runtime.journal,
        "start_model_invocation",
        MagicMock(side_effect=RuntimeError("capture unavailable")),
    )
    with (
        run_context_scope(factory_runtime.context),
        pytest.raises(RuntimeError, match="capture unavailable"),
    ):
        await invoke(model, messages, asynchronous)
    assert len(requests) == 1
    assert (
        factory_runtime.journal.list_model_invocations("factory-run")
        == records
    )
    gaps = factory_runtime.journal.list_attempt_evidence_gaps(
        factory_runtime.context.attempt_id
    )
    assert len(gaps) == 1
    assert gaps[0].reason_code == "capture_failed"


@pytest.mark.parametrize(
    "entrypoint", ["create_agent", "validate_model_with_details"]
)
def test_provider_validation_installs_adapter(
    make_backend, monkeypatch, image_url, entrypoint
):
    from app.component import model_validation

    fixture, _ = make_backend("openai")
    created = []
    real_create = ModelFactory.create

    def create(**kwargs):
        backend = real_create(**kwargs)
        created.append(backend)
        return backend

    monkeypatch.setattr(model_validation.ModelFactory, "create", create)
    monkeypatch.setattr(model_validation, "ChatAgent", MagicMock())
    getattr(model_validation, entrypoint)(
        model_platform="openai",
        model_type="gpt-6-astra",
        api_key="fixture-key",
        url="https://fixture.example.test/v1",
        api_mode="responses",
        client=fixture._client,
        async_client=fixture._async_client,
    )
    [backend] = created
    assert backend._convert_messages_to_responses_input(
        [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url}}
                ],
            }
        ]
    ) == [
        {
            "role": "user",
            "content": [{"type": "input_image", "image_url": image_url}],
        }
    ]


@pytest.mark.parametrize("transport", ["responses", "chat_completions"])
@pytest.mark.asyncio
async def test_effort_and_image_request_matrix(
    make_backend, image_url, transport
):
    effort_module = pytest.importorskip(
        "app.model.effort",
        reason="Effort configuration helper is unavailable on this baseline",
    )
    sent_requests = 0
    levels = ("low", "medium", "high", "xhigh", "max")
    parts = [{"type": "text", "text": "inspect fixture"}]
    for url in (image_url, "https://images.example.test/fixture.png"):
        for detail in ("auto", "low", "high", "original"):
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {"url": url, "detail": detail},
                }
            )
    messages = [{"role": "user", "content": parts}]
    for route in ROUTES if transport == "responses" else ROUTES[:-1]:
        platform = (
            "azure"
            if route == "cloud-azure"
            else "openai"
            if route == "codex"
            else route
        )
        override = None
        if route == "openai-compatible-model":
            override = {
                "schema_version": 1,
                "revision": "fixture-effort-transport",
                "model_platform": platform,
                "model_type": "gpt-6-astra",
                "supported_efforts": levels,
                "default_effort": "medium",
                "provider_mapping": {level: level for level in levels},
                "transport_parameters": {
                    "responses": "reasoning.effort",
                    "chat_completions": "reasoning_effort",
                },
                "default_transport": "chat_completions",
                "tools_transport": "responses",
            }
        for level in levels:
            config, selected = effort_module.resolve_model_effort_config(
                model_platform=platform,
                model_type="gpt-6-astra",
                model_config={"reasoning": {"summary": "auto"}}
                if transport == "responses"
                else {},
                api_mode=transport,
                provider_override=override,
                auth_source="codex_subscription" if route == "codex" else None,
                requested_effort=effort_module.ThinkingEffort(level),
                has_function_tools=transport == "responses",
                is_cloud=route == "cloud-azure",
            )
            assert selected == transport
            expected_effort = (
                "xhigh" if route == "codex" and level == "max" else level
            )
            for stream in (False, True):
                for asynchronous in (False, True):
                    backend, requests = make_backend(
                        route, stream, selected, config=config
                    )
                    configure_responses_input(backend)
                    await invoke(backend, messages, asynchronous)
                    sent_requests += len(requests)
                    body = json.loads(requests[-1].content)
                    if transport == "responses":
                        assert body["reasoning"] == {
                            "effort": expected_effort,
                            "summary": "auto",
                        }
                        assert (
                            "reasoning_effort" not in body
                            and "stream_options" not in body
                        )
                        expected = [
                            {"type": "input_text", "text": "inspect fixture"}
                        ] + [
                            {
                                "type": "input_image",
                                "image_url": part["image_url"]["url"],
                                "detail": part["image_url"]["detail"],
                            }
                            for part in parts[1:]
                        ]
                        assert body["input"] == [
                            {"role": "user", "content": expected}
                        ]
                    else:
                        assert body["reasoning_effort"] == expected_effort
                        assert "reasoning" not in body
                        assert body["messages"] == messages
    assert sent_requests == (100 if transport == "responses" else 80)
