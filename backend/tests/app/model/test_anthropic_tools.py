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

import json
import sys
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from anthropic import (
    Anthropic,
    APIStatusError,
    AsyncAnthropic,
    BadRequestError,
)
from camel.models import ModelFactory

from app.model.anthropic_tools import configure_anthropic_tool_compatibility

REJECTION = "tools.0.custom.strict: Extra inputs are not permitted"
MESSAGES = [{"role": "user", "content": "Look up a value."}]
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "lookup",
            "description": "Look up a value.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"strict": {"type": "boolean"}},
                "required": ["strict"],
                "additionalProperties": False,
            },
        },
    }
]


def rejection(message=REJECTION, status=400):
    # Match LiteLLM's nested upstream error envelope from the user report.
    return httpx.Response(
        status,
        json={
            "error": {
                "type": "invalid_request_error",
                "message": json.dumps(
                    {
                        "type": "error",
                        "error": {
                            "type": "invalid_request_error",
                            "message": message,
                        },
                    }
                )
                + ". Received Model Group=claude-sonnet-5",
            }
        },
    )


def success(body):
    is_continuation = isinstance(
        body["messages"][-1]["content"], list
    ) and any(
        block.get("type") == "tool_result"
        for block in body["messages"][-1]["content"]
    )
    content = (
        [{"type": "text", "text": "done"}]
        if is_continuation
        else [
            {
                "type": "tool_use",
                "id": "tool-1",
                "name": "lookup",
                "input": {"strict": True},
            }
        ]
    )
    message = {
        "id": "msg-fixture",
        "type": "message",
        "role": "assistant",
        "model": body["model"],
        "content": content,
        "stop_reason": "end_turn" if is_continuation else "tool_use",
        "stop_sequence": None,
        "usage": {"input_tokens": 4, "output_tokens": 2},
    }
    if not body.get("stream"):
        return httpx.Response(200, json=message)
    events = [
        {
            "type": "message_start",
            "message": {**message, "content": [], "stop_reason": None},
        },
        {
            "type": "content_block_start",
            "index": 0,
            "content_block": {**content[0], "input": {}},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {
                "type": "input_json_delta",
                "partial_json": json.dumps({"strict": True}),
            },
        },
        {"type": "content_block_stop", "index": 0},
        {
            "type": "message_delta",
            "delta": {"stop_reason": message["stop_reason"]},
            "usage": {"output_tokens": 2},
        },
        {"type": "message_stop"},
    ]
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        content="".join(
            f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
            for event in events
        ),
    )


@asynccontextmanager
async def model_for(
    handler, *, stream=False, model_type="claude-sonnet-5", configure=True
):
    with Anthropic(
        api_key="fixture-key",
        base_url="https://anthropic-route.invalid",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    ) as client:
        async with AsyncAnthropic(
            api_key="fixture-key",
            base_url="https://anthropic-route.invalid",
            max_retries=0,
            http_client=httpx.AsyncClient(
                transport=httpx.MockTransport(handler)
            ),
        ) as async_client:
            backend = ModelFactory.create(
                model_platform="anthropic",
                model_type=model_type,
                api_key="fixture-key",
                client=client,
                async_client=async_client,
                model_config_dict={"max_tokens": 100, "stream": stream},
            )
            if configure:
                configure_anthropic_tool_compatibility(backend)
                configure_anthropic_tool_compatibility(backend)
            yield backend


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("model_type", ["claude-fable-5-1", "claude-sonnet-5"])
async def test_rejected_strict_is_removed_once_and_tool_results_continue(
    asynchronous, stream, model_type, caplog
):
    requests = []
    tools = deepcopy(TOOLS)

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        if "strict" in body["tools"][0]:
            return rejection()
        return success(body)

    async with model_for(
        handler, stream=stream, model_type=model_type
    ) as backend:
        if asynchronous:
            result = await backend._arun(MESSAGES, tools=tools)
            if stream:
                chunks = [chunk async for chunk in result]
            else:
                assert (
                    result.choices[0].message.tool_calls[0].function.name
                    == "lookup"
                )
        else:
            result = backend._run(MESSAGES, tools=tools)
            if stream:
                chunks = list(result)
            else:
                assert (
                    result.choices[0].message.tool_calls[0].function.name
                    == "lookup"
                )
        if stream:
            tool_deltas = [
                call
                for chunk in chunks
                for call in (
                    chunk.model_dump()["choices"][0]["delta"].get("tool_calls")
                    or []
                )
            ]
            assert tool_deltas[0]["function"]["name"] == "lookup"
            arguments = "".join(
                call["function"]["arguments"] for call in tool_deltas
            )
            assert json.loads(arguments) == {"strict": True}
        assert len(requests) == 2

        continuation = [
            *MESSAGES,
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "tool-1",
                        "type": "function",
                        "function": {
                            "name": "lookup",
                            "arguments": '{"strict":true}',
                        },
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "tool-1", "content": "found"},
        ]
        # The other SDK shares only this backend's learned compatibility.
        backend.model_config_dict["stream"] = False
        result = (
            backend._run(continuation, tools=tools)
            if asynchronous
            else await backend._arun(continuation, tools=tools)
        )
        assert result.choices[0].message.content == "done"

    assert len(requests) == 3
    original_tool = requests[0]["tools"][0]
    assert original_tool["strict"] is True
    assert requests[1] == {
        **requests[0],
        "tools": [
            {
                key: value
                for key, value in original_tool.items()
                if key != "strict"
            }
        ],
    }
    assert "strict" not in requests[2]["tools"][0]
    assert requests[2]["messages"][-1]["content"][0]["type"] == "tool_result"
    assert "strict" in requests[1]["tools"][0]["input_schema"]["properties"]
    assert tools == TOOLS
    assert (
        sum(
            "rejected tool-level strict" in item.message
            for item in caplog.records
        )
        == 1
    )


@pytest.mark.asyncio
async def test_supporting_route_keeps_strict_and_has_no_retry():
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        return success(body)

    async with model_for(handler) as backend:
        backend._run(MESSAGES, tools=TOOLS)
        await backend._arun(MESSAGES, tools=TOOLS)
    assert len(requests) == 2
    assert all(body["tools"][0]["strict"] is True for body in requests)


@pytest.mark.asyncio
async def test_downgrade_does_not_modify_another_backend_or_shared_sdk():
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        return rejection() if len(requests) == 1 else success(body)

    async with model_for(handler) as backend:
        original_create = backend._async_client.messages.create
        await backend._arun(MESSAGES, tools=TOOLS)
        another = ModelFactory.create(
            model_platform="anthropic",
            model_type="claude-sonnet-5",
            api_key="fixture-key",
            client=backend._client,
            async_client=backend._async_client,
            model_config_dict={"max_tokens": 100},
        )
        configure_anthropic_tool_compatibility(another)
        await another._arun(MESSAGES, tools=TOOLS)
        assert backend._async_client.messages.create == original_create
    assert len(requests) == 3
    assert ["strict" in body["tools"][0] for body in requests] == [
        True,
        False,
        True,
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize(
    "status,message",
    [
        (
            400,
            "tools.0.custom.input_schema.properties.strict: Extra inputs are not permitted",
        ),
        (400, "output_config.format: Extra inputs are not permitted"),
        (400, "Invalid tool arguments"),
        (400, "tools.9.custom.strict: Extra inputs are not permitted"),
        (401, REJECTION),
        (429, REJECTION),
        (500, REJECTION),
    ],
)
async def test_other_errors_are_not_retried(asynchronous, status, message):
    requests = []

    def handler(request):
        requests.append(request)
        return rejection(message, status)

    async with model_for(handler) as backend:
        with pytest.raises(APIStatusError):
            if asynchronous:
                await backend._arun(MESSAGES, tools=TOOLS)
            else:
                backend._run(MESSAGES, tools=TOOLS)
    assert len(requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
async def test_rejected_retry_is_not_repeated_or_cached(asynchronous):
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return rejection()

    async with model_for(handler) as backend:
        for _ in range(2):
            with pytest.raises(BadRequestError):
                if asynchronous:
                    await backend._arun(MESSAGES, tools=TOOLS)
                else:
                    backend._run(MESSAGES, tools=TOOLS)
    assert len(requests) == 4
    assert ["strict" in body["tools"][0] for body in requests] == [
        True,
        False,
        True,
        False,
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("strict", [False, None])
async def test_extra_body_tools_and_absent_strict(strict):
    requests = []
    tool = {
        "name": "lookup",
        "input_schema": TOOLS[0]["function"]["parameters"],
    }
    if strict is not None:
        tool["strict"] = strict
    extra_body = {"tools": [tool], "metadata": {"user_id": "fixture"}}
    before = deepcopy(extra_body)

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            return rejection()
        return success(body)

    async with model_for(handler) as backend:
        backend.model_config_dict["extra_body"] = extra_body
        if strict is None:
            with pytest.raises(BadRequestError):
                await backend._arun(MESSAGES, tools=TOOLS)
            assert len(requests) == 1
        else:
            await backend._arun(MESSAGES, tools=TOOLS)
            assert len(requests) == 2
            assert "strict" not in requests[-1]["tools"][0]
            assert requests[-1]["metadata"] == extra_body["metadata"]
    assert extra_body == before


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
async def test_errors_after_stream_started_do_not_retry(asynchronous):
    request = httpx.Request(
        "POST", "https://anthropic-route.invalid/v1/messages"
    )
    error = BadRequestError(
        REJECTION,
        response=httpx.Response(400, request=request),
        body={"message": REJECTION},
    )
    calls = []

    def stream_call(**kwargs):
        calls.append(kwargs)

        def chunks():
            yield "first chunk"
            raise error

        return chunks()

    async def async_stream_call(**kwargs):
        calls.append(kwargs)

        async def chunks():
            yield "first chunk"
            raise error

        return chunks()

    async with model_for(
        lambda _: success({"model": "fixture", "messages": MESSAGES})
    ) as backend:
        tools = [{"name": "lookup", "input_schema": {}, "strict": True}]
        if asynchronous:
            response = await backend._acall_client(
                async_stream_call, tools=tools
            )
            assert await anext(response) == "first chunk"
            with pytest.raises(BadRequestError):
                await anext(response)
        else:
            response = backend._call_client(stream_call, tools=tools)
            assert next(response) == "first chunk"
            with pytest.raises(BadRequestError):
                next(response)
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "entrypoint",
    ["agent_model", "create_agent", "validate_model_with_details"],
)
async def test_factories_install_the_adapter(
    entrypoint, monkeypatch, sample_chat_data
):
    from app.agent.agent_model import agent_model
    from app.component import model_validation
    from app.model.chat import Chat

    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        return rejection() if len(requests) == 1 else success(body)

    def step(**kwargs):
        response = backend._run(MESSAGES, tools=TOOLS)
        assert (
            response.choices[0].message.tool_calls[0].function.name == "lookup"
        )
        return SimpleNamespace(
            msg=SimpleNamespace(content="done"),
            info={
                "tool_calls": [
                    SimpleNamespace(
                        result=model_validation.EXPECTED_TOOL_RESULT
                    )
                ]
            },
        )

    async with model_for(handler, configure=False) as backend:
        factory_module = sys.modules[
            "app.agent.agent_model"
            if entrypoint == "agent_model"
            else "app.component.model_validation"
        ]
        monkeypatch.setattr(
            factory_module,
            "ModelFactory",
            SimpleNamespace(create=lambda **kw: backend),
        )
        fixture_agent = SimpleNamespace(model=backend, step=step)
        if entrypoint == "agent_model":
            monkeypatch.setattr(
                factory_module,
                "ListenChatAgent",
                lambda *a, **kw: fixture_agent,
            )
            monkeypatch.setattr(
                factory_module,
                "instrument_model_backend",
                lambda model, **kw: model,
            )
            monkeypatch.setattr(
                factory_module,
                "get_task_lock",
                lambda _: SimpleNamespace(
                    put_queue=MagicMock(return_value=None)
                ),
            )
            monkeypatch.setattr(
                factory_module, "_schedule_async_task", lambda _: None
            )
            options = Chat(
                **{
                    **sample_chat_data,
                    "model_platform": "anthropic",
                    "model_type": "claude-sonnet-5",
                }
            )
            agent_model("fixture", "fixture", options, tools=TOOLS).step()
        else:
            monkeypatch.setattr(
                factory_module, "ChatAgent", lambda **kw: fixture_agent
            )
            created = getattr(model_validation, entrypoint)(
                model_platform="anthropic",
                model_type="claude-sonnet-5",
                api_key="fixture-key",
            )
            if entrypoint == "create_agent":
                created.step()
            else:
                assert created.is_valid
    assert len(requests) == 2
    assert requests[0]["tools"][0]["strict"] is True
    assert "strict" not in requests[1]["tools"][0]
