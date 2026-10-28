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

import asyncio
import json
import logging
from typing import Any

import httpx
import pytest

from app.remote_sub_agent.policy import RemoteSubAgentPolicy
from app.remote_sub_agent.providers.modelark_agents import (
    ModelArkAgentsProvider,
)
from app.remote_sub_agent.runtime import RemoteSubAgentRuntime
from app.remote_sub_agent.session_store import RemoteSubAgentSessionStore
from app.remote_sub_agent.types import (
    RemoteSubAgentEventType,
    RemoteSubAgentRequest,
    RemoteSubAgentSession,
)

pytestmark = pytest.mark.unit

BASE_URL = "https://ark.example.test/api/v3"
API_KEY = "test-ark-key"
DROP = object()
HANG = object()


def _idle(reason: str | None, event_id: str = "evt-idle") -> dict[str, Any]:
    event: dict[str, Any] = {"id": event_id, "type": "session.status_idle"}
    if reason is not None:
        event["stop_reason"] = {"type": reason}
    return event


def _message(text: str, event_id: str) -> dict[str, Any]:
    return {
        "id": event_id,
        "type": "agent.message",
        "content": [{"type": "text", "text": text}],
    }


class FakeModelArk:
    """Scripted ModelArk API.

    Each opened event stream plays the next script. Events after ``: ready``
    on the first stream are held until the client sends its message, which
    is how the real stream behaves.
    """

    def __init__(
        self,
        streams: list[list[Any]],
        *,
        session_status: str | None = "idle",
        history_pages: list[dict[str, Any]] | None = None,
        resource_status: dict[str, int] | None = None,
        stream_status: int = 200,
    ) -> None:
        self.streams = list(streams)
        self.session_status = session_status
        self.history_pages = list(history_pages or [])
        self.resource_status = resource_status or {}
        self.stream_status = stream_status
        self.requests: list[httpx.Request] = []
        self.log: list[str] = []
        self.sent_events: list[dict[str, Any]] = []
        self.history_params: list[dict[str, str]] = []
        self.message_sent = asyncio.Event()

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    async def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path.removeprefix("/api/v3")
        method = request.method

        if method == "POST" and path == "/sessions":
            self.log.append("create_session")
            return httpx.Response(
                200, json={"id": "sesn-new", "status": "idle"}
            )
        if method == "GET" and path.endswith("/events/stream"):
            self.log.append("open_stream")
            if self.stream_status != 200:
                return httpx.Response(self.stream_status, text="unauthorized")
            script = self.streams.pop(0) if self.streams else []
            return httpx.Response(200, content=self._stream(script))
        if method == "POST" and path.endswith("/events"):
            events = json.loads(request.content)["events"]
            self.sent_events.extend(events)
            kinds = [event["type"] for event in events]
            self.log.append(f"send:{','.join(kinds)}")
            if "user.message" in kinds:
                self.message_sent.set()
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": f"evt-user-{len(self.sent_events)}", **event}
                        for event in events
                    ]
                },
            )
        if method == "GET" and path.endswith("/events"):
            self.log.append("list_events")
            self.history_params.append(dict(request.url.params))
            page = self.history_pages.pop(0) if self.history_pages else {}
            return httpx.Response(200, json=page)
        if method == "GET" and path.startswith("/sessions/"):
            self.log.append("get_session")
            if self.session_status is None:
                return httpx.Response(404, json={"error": "not found"})
            return httpx.Response(
                200,
                json={
                    "id": path.split("/")[-1],
                    "status": self.session_status,
                },
            )
        if method == "GET" and path.startswith(("/agents/", "/environments/")):
            kind = path.split("/")[1]
            self.log.append(f"get_{kind}")
            status = self.resource_status.get(kind, 200)
            if status != 200:
                return httpx.Response(status, json={"error": "not found"})
            return httpx.Response(
                200, json={"id": path.split("/")[-1], "status": "ready"}
            )
        raise AssertionError(f"Unexpected request: {method} {path}")

    async def _stream(self, script: list[Any]):
        yield b": ready\n\n"
        if not self.message_sent.is_set() and "send:user.interrupt" not in (
            self.log
        ):
            await self.message_sent.wait()
        for item in script:
            if item is DROP:
                raise httpx.ReadError("stream dropped")
            if item is HANG:
                await asyncio.sleep(3600)
            if isinstance(item, str):
                yield item.encode()
                continue
            yield f"data: {json.dumps(item)}\n\n".encode()


def _provider(fake: FakeModelArk, **overrides: Any) -> ModelArkAgentsProvider:
    return ModelArkAgentsProvider(
        api_key=API_KEY,
        base_url=BASE_URL,
        agent_id=overrides.get("agent_id", "agent-1"),
        environment_id=overrides.get("environment_id", "env-1"),
        transport=fake.transport(),
    )


def _session(**kwargs: Any) -> RemoteSubAgentSession:
    return RemoteSubAgentSession(
        session_id="local-session",
        provider="modelark_agents",
        api_task_id="task-1",
        **kwargs,
    )


def _request(**kwargs: Any) -> RemoteSubAgentRequest:
    return RemoteSubAgentRequest(
        api_task_id="task-1",
        prompt=kwargs.pop("prompt", "analyse this"),
        provider="modelark_agents",
        **kwargs,
    )


async def _collect(provider, request=None, session=None):
    return [
        event
        async for event in provider.run(
            request or _request(), session or _session()
        )
    ]


def _output(events) -> str:
    return "".join(
        event.content or ""
        for event in events
        if event.event_type is RemoteSubAgentEventType.OUTPUT_DELTA
    )


@pytest.mark.asyncio
async def test_turn_opens_stream_before_sending_and_maps_events():
    fake = FakeModelArk(
        [
            [
                {"id": "e1", "type": "session.status_running"},
                {
                    "id": "e2",
                    "type": "agent.thinking",
                    "content": [{"type": "text", "text": "planning"}],
                },
                {
                    "id": "e3",
                    "type": "agent.tool_use",
                    "name": "bash",
                    "input": {"command": "ls"},
                },
                {
                    "id": "e4",
                    "type": "agent.tool_result",
                    "tool_use_id": "e3",
                    "is_error": False,
                },
                {
                    "id": "e5",
                    "type": "agent.mcp_tool_use",
                    "mcp_server_name": "github",
                    "name": "search",
                },
                _message("Checked the files.", "e6"),
                {
                    "id": "e7",
                    "type": "span.model_request_end",
                    "model_usage": {"input_tokens": 100, "output_tokens": 20},
                },
                {
                    "id": "e8",
                    "type": "span.model_request_end",
                    "model_usage": {"input_tokens": 50, "output_tokens": 5},
                },
                _message("All done.", "e9"),
                _idle("end_turn"),
            ]
        ]
    )

    events = await _collect(_provider(fake))

    assert fake.log == ["create_session", "open_stream", "send:user.message"]
    create = json.loads(fake.requests[0].content)
    assert create == {
        "agent": "agent-1",
        "environment_id": "env-1",
        "title": "Eigent sub-agent task",
    }
    assert all(
        request.headers["Authorization"] == f"Bearer {API_KEY}"
        for request in fake.requests
    )
    assert fake.sent_events == [
        {
            "type": "user.message",
            "content": [{"type": "text", "text": "analyse this"}],
        }
    ]

    assert events[0].event_type is RemoteSubAgentEventType.SESSION_UPDATED
    assert events[0].interaction_id == "sesn-new"
    assert events[0].environment_id == "env-1"
    types = [event.event_type for event in events]
    assert RemoteSubAgentEventType.THOUGHT_DELTA in types
    tools = [
        event
        for event in events
        if event.event_type is RemoteSubAgentEventType.TOOL_EVENT
    ]
    assert [(tool.content, tool.status) for tool in tools] == [
        ("bash", "tool_use"),
        (None, "tool_result"),
        ("github.search", "tool_use"),
    ]
    assert _output(events) == "Checked the files.\n\nAll done."
    assert events[-1].event_type is RemoteSubAgentEventType.COMPLETED
    assert events[-1].usage == {
        "input_tokens": 150,
        "output_tokens": 25,
        "total_tokens": 175,
    }


@pytest.mark.asyncio
async def test_system_instruction_travels_with_the_message():
    fake = FakeModelArk([[_message("ok", "m1"), _idle("end_turn")]])

    await _collect(
        _provider(fake),
        request=_request(system_instruction="Answer in French."),
    )

    text = fake.sent_events[0]["content"][0]["text"]
    assert text.startswith("<system_instruction>\nAnswer in French.\n")
    assert text.endswith("analyse this")
    assert all(event["type"] != "system.message" for event in fake.sent_events)


@pytest.mark.asyncio
async def test_follow_up_reuses_the_session_through_the_runtime():
    fake = FakeModelArk(
        [
            [_message("first", "m1"), _idle("end_turn", "i1")],
            [_message("second", "m2"), _idle("end_turn", "i2")],
        ]
    )
    store = RemoteSubAgentSessionStore()
    policy = RemoteSubAgentPolicy(
        enabled=True, allowed_providers=("modelark_agents",)
    )
    runtime = RemoteSubAgentRuntime(
        provider=_provider(fake), policy=policy, session_store=store
    )

    first = await runtime.run(_request(prompt="one"))
    fake.message_sent.clear()
    second = await runtime.run(_request(prompt="two"))

    assert first.final_text == "first"
    assert second.final_text == "second"
    assert first.session.remote_interaction_id == "sesn-new"
    assert second.session.remote_interaction_id == "sesn-new"
    assert fake.log.count("create_session") == 1
    assert fake.log[3:] == [
        "get_session",
        "open_stream",
        "send:user.message",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "agent_id", "environment_id"),
    [
        ("terminated", "agent-1", "env-1"),
        ("failed", "agent-1", "env-1"),
        (None, "agent-1", "env-1"),
        ("idle", "agent-2", "env-1"),
        ("idle", "agent-1", "env-2"),
    ],
)
async def test_unusable_saved_session_starts_a_new_one(
    status, agent_id, environment_id
):
    fake = FakeModelArk(
        [[_message("ok", "m1"), _idle("end_turn")]], session_status=status
    )
    session = _session(
        remote_interaction_id="sesn-old",
        remote_environment_id="env-1",
        metadata={"modelark_agent_id": "agent-1"},
    )

    events = await _collect(
        _provider(fake, agent_id=agent_id, environment_id=environment_id),
        session=session,
    )

    assert "create_session" in fake.log
    assert events[0].interaction_id == "sesn-new"
    assert session.metadata["modelark_agent_id"] == agent_id


@pytest.mark.asyncio
async def test_busy_saved_session_is_interrupted_before_the_message():
    fake = FakeModelArk(
        [
            [
                _message("old turn", "old-1"),
                _idle("end_turn", "old-idle"),
                _message("new turn", "m1"),
                _idle("end_turn"),
            ]
        ],
        session_status="running",
    )
    session = _session(
        remote_interaction_id="sesn-old",
        remote_environment_id="env-1",
        metadata={"modelark_agent_id": "agent-1"},
    )

    events = await _collect(_provider(fake), session=session)

    assert fake.log == [
        "get_session",
        "open_stream",
        "send:user.interrupt",
        "get_session",
        "send:user.message",
    ]
    assert _output(events) == "new turn"
    assert events[-1].event_type is RemoteSubAgentEventType.COMPLETED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("script", "expected"),
    [
        ([_idle("requires_action")], "tool permission policy"),
        (
            [
                {
                    "id": "err",
                    "type": "session.error",
                    "error": {
                        "message": "model overloaded",
                        "retry_status": {"type": "exhausted"},
                    },
                },
                _idle("retries_exhausted"),
            ],
            "retries ran out: model overloaded",
        ),
        (
            [{"id": "t1", "type": "session.status_terminated"}],
            "session was ended",
        ),
        ([{"id": "d1", "type": "session.deleted"}], "session was deleted"),
        (
            [
                {
                    "id": "err",
                    "type": "session.error",
                    "error": {
                        "message": "sandbox lost",
                        "retry_status": {"type": "terminal"},
                    },
                }
            ],
            "stopped with an error: sandbox lost",
        ),
        ([_idle(None)], "stop reason: missing"),
    ],
)
async def test_turn_end_states_fail_the_hand_off(script, expected):
    fake = FakeModelArk([script])

    events = await _collect(_provider(fake))

    assert events[-1].event_type is RemoteSubAgentEventType.FAILED
    assert expected in events[-1].content


@pytest.mark.asyncio
async def test_failed_turn_raises_through_the_runtime():
    fake = FakeModelArk([[_idle("requires_action")]])
    runtime = RemoteSubAgentRuntime(
        provider=_provider(fake),
        policy=RemoteSubAgentPolicy(
            enabled=True, allowed_providers=("modelark_agents",)
        ),
        session_store=RemoteSubAgentSessionStore(),
    )

    with pytest.raises(RuntimeError, match="tool permission policy"):
        await runtime.run(_request())


@pytest.mark.asyncio
async def test_retrying_error_keeps_reading_until_the_turn_ends():
    fake = FakeModelArk(
        [
            [
                {
                    "id": "err",
                    "type": "session.error",
                    "error": {
                        "message": "rate limited",
                        "retry_status": {"type": "retrying"},
                    },
                },
                {"id": "r1", "type": "session.status_rescheduled"},
                _message("recovered", "m1"),
                _idle("end_turn"),
            ]
        ]
    )

    events = await _collect(_provider(fake))

    assert _output(events) == "recovered"
    assert events[-1].event_type is RemoteSubAgentEventType.COMPLETED


@pytest.mark.asyncio
async def test_dropped_stream_reconnects_and_backfills_without_duplicates():
    fake = FakeModelArk(
        [
            [_message("part one", "m1"), DROP],
            [_message("part two", "m2"), _idle("end_turn")],
        ],
        history_pages=[
            {"data": [_message("part one", "m1")], "next_page": "p2"},
            {"data": [_message("part two", "m2")]},
        ],
    )

    events = await _collect(_provider(fake))

    assert fake.log == [
        "create_session",
        "open_stream",
        "send:user.message",
        "open_stream",
        "list_events",
        "list_events",
    ]
    assert fake.history_params[0] == {"order": "asc", "after": "evt-user-1"}
    assert fake.history_params[1]["page"] == "p2"
    assert _output(events) == "part one\n\npart two"
    assert events[-1].event_type is RemoteSubAgentEventType.COMPLETED


@pytest.mark.asyncio
async def test_backfill_can_finish_the_turn():
    fake = FakeModelArk(
        [[_message("answer", "m1")], [HANG]],
        history_pages=[{"data": [_idle("end_turn")]}],
    )

    events = await _collect(_provider(fake))

    assert _output(events) == "answer"
    assert events[-1].event_type is RemoteSubAgentEventType.COMPLETED


@pytest.mark.asyncio
async def test_stream_that_keeps_dropping_fails_the_hand_off():
    fake = FakeModelArk([[DROP], [DROP], [DROP], [DROP]])

    events = await _collect(_provider(fake))

    assert fake.log.count("open_stream") == 4
    assert events[-1].event_type is RemoteSubAgentEventType.FAILED
    assert "Lost the connection" in events[-1].content


@pytest.mark.asyncio
async def test_stream_error_before_sending_reports_the_api_error():
    fake = FakeModelArk([], stream_status=401)

    with pytest.raises(RuntimeError, match="401 unauthorized"):
        await _collect(_provider(fake))

    assert "send:user.message" not in fake.log


@pytest.mark.asyncio
async def test_cancelled_hand_off_interrupts_the_remote_turn():
    fake = FakeModelArk([[HANG]])

    async def consume():
        return await _collect(_provider(fake))

    with pytest.raises(TimeoutError):
        await asyncio.wait_for(consume(), timeout=0.2)

    assert fake.log[-1] == "send:user.interrupt"


@pytest.mark.asyncio
async def test_api_key_is_not_logged(caplog):
    caplog.set_level(logging.DEBUG)
    fake = FakeModelArk([[_message("ok", "m1"), _idle("end_turn")]])

    await _collect(_provider(fake))

    assert API_KEY not in caplog.text


@pytest.mark.asyncio
async def test_validate_connection_reads_agent_and_environment_only():
    fake = FakeModelArk([])

    data = await _provider(fake).validate_connection()

    assert fake.log == ["get_agents", "get_environments"]
    assert all(request.method == "GET" for request in fake.requests)
    assert data["id"] == "agent-1"
    assert data["environment_id"] == "env-1"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("missing", "message"),
    [
        ("agents", "ModelArk agent 'agent-1' was not found"),
        ("environments", "ModelArk environment 'env-1' was not found"),
    ],
)
async def test_validate_connection_names_the_missing_resource(
    missing, message
):
    fake = FakeModelArk([], resource_status={missing: 404})

    with pytest.raises(RuntimeError, match=message):
        await _provider(fake).validate_connection()


@pytest.mark.asyncio
async def test_validate_connection_reports_bad_key():
    fake = FakeModelArk([], resource_status={"agents": 401})

    with pytest.raises(RuntimeError, match="request failed: 401"):
        await _provider(fake).validate_connection()


@pytest.mark.asyncio
async def test_missing_settings_fail_before_any_request():
    fake = FakeModelArk([])
    provider = ModelArkAgentsProvider(
        api_key=API_KEY,
        base_url=BASE_URL,
        agent_id="agent-1",
        environment_id="",
        transport=fake.transport(),
    )

    with pytest.raises(RuntimeError, match="environment ID"):
        await _collect(provider)

    assert fake.requests == []


@pytest.mark.asyncio
async def test_network_error_while_sending_fails_instead_of_waiting():
    fake = FakeModelArk([[HANG]])
    original = fake.handle

    async def handle(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith("/events"):
            raise httpx.ConnectError("connection refused")
        return await original(request)

    provider = ModelArkAgentsProvider(
        api_key=API_KEY,
        base_url=BASE_URL,
        agent_id="agent-1",
        environment_id="env-1",
        transport=httpx.MockTransport(handle),
    )

    with pytest.raises(RuntimeError, match="Could not send the task"):
        await asyncio.wait_for(_collect(provider), timeout=5)

    assert fake.log.count("open_stream") == 1
