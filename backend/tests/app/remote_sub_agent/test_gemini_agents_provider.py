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

import httpx
import pytest

from app.remote_sub_agent.providers.gemini_agents import GeminiAgentsProvider
from app.remote_sub_agent.types import (
    RemoteSubAgentEventType,
    RemoteSubAgentRequest,
    RemoteSubAgentSession,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def clean_gemini_env(monkeypatch):
    monkeypatch.delenv("GEMINI_INTERACTIONS_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_INTERACTIONS_AGENT", raising=False)
    monkeypatch.delenv("GEMINI_AGENTS_AGENT", raising=False)
    monkeypatch.delenv(
        "GEMINI_INTERACTIONS_POLL_INTERVAL_SECONDS", raising=False
    )


@pytest.mark.asyncio
async def test_provider_posts_agent_interaction():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "interaction-1",
                "agent": "antigravity-preview-05-2026",
                "environment_id": "env-1",
                "status": "completed",
                "outputs": [{"type": "text", "text": "done"}],
                "usage": {"total_tokens": 12},
            },
        )

    provider = GeminiAgentsProvider(
        api_key="test-key",
        agent_name="antigravity-preview-05-2026",
        base_url="https://example.test/v1beta",
        transport=httpx.MockTransport(handler),
    )
    session = RemoteSubAgentSession(
        session_id="local-session",
        provider=provider.name,
        api_task_id="task-1",
    )
    request = RemoteSubAgentRequest(
        api_task_id="task-1",
        prompt="research this",
        stream=False,
    )

    events = [event async for event in provider.run(request, session)]

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["agent"] == "antigravity-preview-05-2026"
    assert body["input"] == [{"type": "text", "text": "research this"}]
    assert body["stream"] is False
    assert body["environment"] == {"enabled": True}
    assert "background" not in body
    assert "previous_interaction_id" not in body
    assert seen["headers"]["x-goog-api-key"] == "test-key"
    assert events[0].event_type is RemoteSubAgentEventType.SESSION_UPDATED
    assert events[0].environment_id == "env-1"
    assert events[-1].event_type is RemoteSubAgentEventType.COMPLETED
    assert events[-1].content == "done"
    assert events[-1].usage == {"total_tokens": 12}


@pytest.mark.asyncio
async def test_provider_validation_posts_background_probe():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "interaction-validation",
                "agent": "antigravity-preview-05-2026",
                "environment_id": "env-validation",
                "status": "in_progress",
            },
        )

    provider = GeminiAgentsProvider(
        api_key="test-key",
        agent_name="antigravity-preview-05-2026",
        base_url="https://example.test/v1beta",
        transport=httpx.MockTransport(handler),
    )

    data = await provider.validate_connection()

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["agent"] == "antigravity-preview-05-2026"
    assert body["stream"] is False
    assert body["background"] is True
    assert body["environment"] == {"enabled": True}
    assert "Connectivity check" in body["input"][0]["text"]
    assert seen["headers"]["x-goog-api-key"] == "test-key"
    assert data["id"] == "interaction-validation"


@pytest.mark.asyncio
async def test_provider_validation_falls_back_without_background():
    bodies: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if body.get("background") is True:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": "background is not supported",
                    }
                },
            )
        return httpx.Response(
            200,
            json={
                "id": "interaction-validation",
                "agent": "antigravity-preview-05-2026",
                "status": "completed",
            },
        )

    provider = GeminiAgentsProvider(
        api_key="test-key",
        agent_name="antigravity-preview-05-2026",
        base_url="https://example.test/v1beta",
        transport=httpx.MockTransport(handler),
    )

    data = await provider.validate_connection()

    assert len(bodies) == 2
    assert bodies[0]["background"] is True
    assert "background" not in bodies[1]
    assert data["id"] == "interaction-validation"


@pytest.mark.asyncio
async def test_provider_uses_configured_agent_over_display_name():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "interaction-1",
                "agent": "antigravity-preview-05-2026",
                "status": "completed",
                "outputs": [{"type": "text", "text": "done"}],
            },
        )

    provider = GeminiAgentsProvider(
        api_key="test-key",
        agent_name="antigravity-preview-05-2026",
        base_url="https://example.test/v1beta",
        transport=httpx.MockTransport(handler),
    )
    session = RemoteSubAgentSession(
        session_id="local-session",
        provider=provider.name,
        api_task_id="task-1",
    )
    request = RemoteSubAgentRequest(
        api_task_id="task-1",
        prompt="research this",
        remote_agent_name="Senior Research Analyst",
    )

    events = [event async for event in provider.run(request, session)]

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["agent"] == "antigravity-preview-05-2026"
    assert events[-1].content == "done"


@pytest.mark.asyncio
async def test_provider_concatenates_chunked_outputs_without_extra_newlines():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "interaction-1",
                "agent": "antigravity-preview-05-2026",
                "status": "completed",
                "outputs": [
                    {"type": "text", "text": "sha256sum orders"},
                    {"type": "text", "text": ".csv\n"},
                    {"type": "text", "text": "order_id,region"},
                    {"type": "text", "text": ",category\n"},
                ],
            },
        )

    provider = GeminiAgentsProvider(
        api_key="test-key",
        agent_name="antigravity-preview-05-2026",
        base_url="https://example.test/v1beta",
        transport=httpx.MockTransport(handler),
    )
    session = RemoteSubAgentSession(
        session_id="local-session",
        provider=provider.name,
        api_task_id="task-1",
    )
    request = RemoteSubAgentRequest(api_task_id="task-1", prompt="run")

    events = [event async for event in provider.run(request, session)]

    assert events[-1].content == (
        "sha256sum orders.csv\norder_id,region,category\n"
    )


@pytest.mark.asyncio
async def test_provider_merges_system_instruction_for_agent():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "interaction-1",
                "agent": "antigravity-preview-05-2026",
                "status": "completed",
                "outputs": [{"type": "text", "text": "done"}],
            },
        )

    provider = GeminiAgentsProvider(
        api_key="test-key",
        agent_name="antigravity-preview-05-2026",
        base_url="https://example.test/v1beta",
        transport=httpx.MockTransport(handler),
    )
    session = RemoteSubAgentSession(
        session_id="local-session",
        provider=provider.name,
        api_task_id="task-1",
    )
    request = RemoteSubAgentRequest(
        api_task_id="task-1",
        prompt="research this",
        system_instruction="Use official docs.",
    )

    events = [event async for event in provider.run(request, session)]

    body = seen["body"]
    assert isinstance(body, dict)
    assert "system_instruction" not in body
    assert body["input"][0]["text"].startswith("<system_instruction>")
    assert "Use official docs." in body["input"][0]["text"]
    assert "research this" in body["input"][0]["text"]
    assert events[-1].content == "done"


@pytest.mark.asyncio
async def test_provider_polls_background_agent_until_completed():
    requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        if request.method == "POST":
            return httpx.Response(
                200,
                json={
                    "id": "interaction-1",
                    "agent": "antigravity-preview-05-2026",
                    "status": "in_progress",
                },
            )
        return httpx.Response(
            200,
            json={
                "id": "interaction-1",
                "agent": "antigravity-preview-05-2026",
                "status": "completed",
                "outputs": [{"type": "text", "text": "done"}],
                "usage": {"total_tokens": 42},
            },
        )

    provider = GeminiAgentsProvider(
        api_key="test-key",
        agent_name="antigravity-preview-05-2026",
        base_url="https://example.test/v1beta",
        poll_interval_seconds=0,
        transport=httpx.MockTransport(handler),
    )
    session = RemoteSubAgentSession(
        session_id="local-session",
        provider=provider.name,
        api_task_id="task-1",
    )
    request = RemoteSubAgentRequest(api_task_id="task-1", prompt="research")
    request.extra_body["background"] = True

    events = [event async for event in provider.run(request, session)]

    assert requests == [
        ("POST", "/v1beta/interactions"),
        ("GET", "/v1beta/interactions/interaction-1"),
    ]
    assert events[0].event_type is RemoteSubAgentEventType.SESSION_UPDATED
    assert events[-1].event_type is RemoteSubAgentEventType.COMPLETED
    assert events[-1].content == "done"
    assert events[-1].usage == {"total_tokens": 42}


@pytest.mark.asyncio
async def test_provider_reuses_previous_interaction():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "interaction-2",
                "status": "completed",
                "outputs": [{"type": "text", "text": "follow-up"}],
            },
        )

    provider = GeminiAgentsProvider(
        api_key="test-key",
        base_url="https://example.test/v1beta",
        transport=httpx.MockTransport(handler),
    )
    session = RemoteSubAgentSession(
        session_id="local-session",
        provider=provider.name,
        api_task_id="task-1",
        remote_interaction_id="interaction-1",
        remote_environment_id="env-1",
    )
    request = RemoteSubAgentRequest(
        api_task_id="task-1",
        prompt="continue",
        reuse_session=True,
    )

    events = [event async for event in provider.run(request, session)]

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["previous_interaction_id"] == "interaction-1"
    assert body["environment"] == {"env_id": "env-1"}
    assert events[-1].content == "follow-up"


@pytest.mark.asyncio
async def test_provider_raises_helpful_error_on_http_failure():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="bad key")

    provider = GeminiAgentsProvider(
        api_key="test-key",
        base_url="https://example.test/v1beta",
        transport=httpx.MockTransport(handler),
    )
    session = RemoteSubAgentSession(
        session_id="local-session",
        provider=provider.name,
        api_task_id="task-1",
    )
    request = RemoteSubAgentRequest(api_task_id="task-1", prompt="hello")

    with pytest.raises(RuntimeError, match="401 bad key"):
        [event async for event in provider.run(request, session)]


def test_provider_explicit_empty_api_key_does_not_fall_back_to_env(
    monkeypatch,
):
    monkeypatch.setenv("GEMINI_API_KEY", "env-key")

    provider = GeminiAgentsProvider(api_key="")

    with pytest.raises(RuntimeError, match="requires an API key"):
        provider._headers()
