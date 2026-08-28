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

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agent.toolkit import search_toolkit as search_module
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.service.task import task_locks

pytestmark = pytest.mark.unit


def _env_reader(values: dict[str, str]):
    def read(key: str, default=None):
        return values.get(key, default)

    return read


class RecordingMCPClient:
    instances: list["RecordingMCPClient"] = []

    def __init__(self, config, timeout=None):
        self.config = config
        self.timeout = timeout
        self.calls = []
        self.instances.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return SimpleNamespace(
            isError=False,
            structuredContent={"query": arguments["query"], "results": []},
            content=[],
        )


class RecordingHTTPClient:
    instances: list["RecordingHTTPClient"] = []

    def __init__(self, timeout=None):
        self.timeout = timeout
        self.calls = []
        self.instances.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    async def post(self, url, *, json, headers):
        self.calls.append((url, json, headers))
        response = MagicMock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"query": json["query"], "results": []}
        return response


@pytest.fixture(autouse=True)
def reset_recording_client():
    RecordingMCPClient.instances.clear()
    RecordingHTTPClient.instances.clear()


@pytest.mark.asyncio
async def test_querit_anonymous_mode_uses_hosted_mcp_without_auth(
    monkeypatch,
):
    monkeypatch.setattr(
        search_module,
        "env",
        _env_reader({"QUERIT_ENABLED": "true"}),
    )
    monkeypatch.setattr(search_module, "MCPClient", RecordingMCPClient)

    toolkit = SearchToolkit("task-anonymous")
    result = await toolkit._search_querit_via_mcp(
        "current AI news", number_of_result_pages=10
    )

    client = RecordingMCPClient.instances[0]
    assert "headers" not in client.config
    assert client.calls == [
        (
            "querit_search",
            {"query": "current AI news", "count": 5},
        )
    ]
    assert result == {"query": "current AI news", "results": []}


@pytest.mark.asyncio
async def test_querit_byok_mode_sends_run_scoped_bearer_token(monkeypatch):
    monkeypatch.setattr(
        search_module,
        "env",
        _env_reader(
            {
                "QUERIT_ENABLED": "true",
                "QUERIT_API_KEY": "user-querit-key",
            }
        ),
    )
    monkeypatch.setattr(search_module, "MCPClient", RecordingMCPClient)

    toolkit = SearchToolkit("task-byok")
    await toolkit._search_querit_via_mcp(
        "python release",
        number_of_result_pages=10,
        site_include=["python.org"],
    )

    client = RecordingMCPClient.instances[0]
    assert client.config["headers"] == {
        "Authorization": "Bearer user-querit-key"
    }
    assert client.calls[0] == (
        "querit_search",
        {
            "query": "python release",
            "count": 10,
            "include_domains": ["python.org"],
        },
    )


@pytest.mark.asyncio
async def test_managed_querit_proxy_uses_cloud_auth_and_preserves_filters(
    monkeypatch,
):
    monkeypatch.setattr(
        search_module,
        "env",
        _env_reader(
            {
                "SERVER_URL": "https://cloud.example/api/v1/",
                "cloud_api_key": "cloud-key",
            }
        ),
    )
    monkeypatch.setattr(
        search_module.httpx,
        "AsyncClient",
        RecordingHTTPClient,
    )

    toolkit = SearchToolkit("task-managed-proxy")
    result = await toolkit._search_querit_via_managed_proxy(
        "OpenAI updates",
        number_of_result_pages=10,
        site_include=["openai.com"],
        time_range="d7",
        language_include=["english"],
    )

    client = RecordingHTTPClient.instances[0]
    assert client.calls == [
        (
            "https://cloud.example/api/v1/proxy/querit",
            {
                "query": "OpenAI updates",
                "count": 10,
                "include_domains": ["openai.com"],
                "date_range": "d7",
                "languages": ["english"],
            },
            {"api-key": "cloud-key"},
        )
    ]
    assert result == {"query": "OpenAI updates", "results": []}


def test_tool_selection_prefers_querit_when_enabled(monkeypatch):
    monkeypatch.setattr(
        search_module,
        "env",
        _env_reader(
            {
                "QUERIT_ENABLED": "true",
                "GOOGLE_API_KEY": "google-key",
                "SEARCH_ENGINE_ID": "engine-id",
            }
        ),
    )

    tools = SearchToolkit.get_can_use_tools("task-enabled")

    assert [tool.get_function_name() for tool in tools] == ["search_querit"]


def test_tool_selection_keeps_google_when_querit_is_disabled(monkeypatch):
    monkeypatch.setattr(
        search_module,
        "env",
        _env_reader(
            {
                "QUERIT_ENABLED": "false",
                "GOOGLE_API_KEY": "google-key",
                "SEARCH_ENGINE_ID": "engine-id",
            }
        ),
    )

    tools = SearchToolkit.get_can_use_tools("task-disabled")

    assert [tool.get_function_name() for tool in tools] == ["search_google"]


@pytest.mark.asyncio
async def test_querit_failure_falls_back_to_available_google(monkeypatch):
    monkeypatch.setattr(
        search_module,
        "env",
        _env_reader(
            {
                "QUERIT_ENABLED": "true",
                "GOOGLE_API_KEY": "google-key",
                "SEARCH_ENGINE_ID": "engine-id",
            }
        ),
    )
    task_lock = SimpleNamespace(put_queue=AsyncMock())
    monkeypatch.setitem(task_locks, "task-fallback", task_lock)

    toolkit = SearchToolkit("task-fallback")
    toolkit._search_querit_via_mcp = AsyncMock(
        return_value={"error": "anonymous quota exhausted"}
    )
    toolkit.search_google = MagicMock(
        return_value=[{"title": "Google fallback"}]
    )

    result = await toolkit.search_querit("fallback query")

    assert result == [{"title": "Google fallback"}]
    toolkit.search_google.assert_called_once_with(
        query="fallback query",
        search_type="web",
        number_of_result_pages=10,
        start_page=1,
    )


@pytest.mark.asyncio
async def test_anonymous_limit_uses_managed_pool_before_google(monkeypatch):
    monkeypatch.setattr(
        search_module,
        "env",
        _env_reader(
            {
                "QUERIT_ENABLED": "true",
                "GOOGLE_API_KEY": "google-key",
                "SEARCH_ENGINE_ID": "engine-id",
            }
        ),
    )
    task_lock = SimpleNamespace(put_queue=AsyncMock())
    monkeypatch.setitem(task_locks, "task-managed", task_lock)

    toolkit = SearchToolkit("task-managed")
    toolkit._search_querit_via_mcp = AsyncMock(
        return_value={
            "error": "Querit anonymous free limit reached. Add your own API Key."
        }
    )
    toolkit._search_querit_via_managed_proxy = AsyncMock(
        return_value={"query": "fallback query", "results": []}
    )
    toolkit.search_google = MagicMock()

    result = await toolkit.search_querit("fallback query")

    assert result == {"query": "fallback query", "results": []}
    toolkit._search_querit_via_managed_proxy.assert_awaited_once()
    toolkit.search_google.assert_not_called()


@pytest.mark.asyncio
async def test_managed_pool_failure_falls_back_to_google(monkeypatch):
    monkeypatch.setattr(
        search_module,
        "env",
        _env_reader(
            {
                "QUERIT_ENABLED": "true",
                "GOOGLE_API_KEY": "google-key",
                "SEARCH_ENGINE_ID": "engine-id",
            }
        ),
    )
    task_lock = SimpleNamespace(put_queue=AsyncMock())
    monkeypatch.setitem(task_locks, "task-managed-google", task_lock)

    toolkit = SearchToolkit("task-managed-google")
    toolkit._search_querit_via_mcp = AsyncMock(
        return_value={"error": "Querit anonymous quota exhausted"}
    )
    toolkit._search_querit_via_managed_proxy = AsyncMock(
        return_value={"error": "All managed keys are rate limited"}
    )
    toolkit.search_google = MagicMock(
        return_value=[{"title": "Google fallback"}]
    )

    result = await toolkit.search_querit("fallback query")

    assert result == [{"title": "Google fallback"}]
    toolkit._search_querit_via_managed_proxy.assert_awaited_once()
    toolkit.search_google.assert_called_once()


@pytest.mark.asyncio
async def test_byok_failure_skips_managed_pool_and_falls_back_to_google(
    monkeypatch,
):
    monkeypatch.setattr(
        search_module,
        "env",
        _env_reader(
            {
                "QUERIT_ENABLED": "true",
                "QUERIT_API_KEY": "user-key",
                "GOOGLE_API_KEY": "google-key",
                "SEARCH_ENGINE_ID": "engine-id",
            }
        ),
    )
    task_lock = SimpleNamespace(put_queue=AsyncMock())
    monkeypatch.setitem(task_locks, "task-byok-google", task_lock)

    toolkit = SearchToolkit("task-byok-google")
    toolkit._search_querit_via_mcp = AsyncMock(
        return_value={"error": "The provided Querit API Key is invalid"}
    )
    toolkit._search_querit_via_managed_proxy = AsyncMock()
    toolkit.search_google = MagicMock(
        return_value=[{"title": "Google fallback"}]
    )

    result = await toolkit.search_querit("fallback query")

    assert result == [{"title": "Google fallback"}]
    toolkit._search_querit_via_managed_proxy.assert_not_awaited()
    toolkit.search_google.assert_called_once()
