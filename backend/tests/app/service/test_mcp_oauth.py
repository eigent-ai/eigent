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
import copy
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest

from app.service.mcp_oauth import (
    McpOAuthRequired,
    McpOAuthUnavailable,
    apply_mcp_oauth,
    connect_mcp_toolkit,
    prepare_mcp_oauth,
)
from app.workspace_bundle.runtime import EnvironmentSetupRequiredError
from app.workspace_bundle.secrets import WorkspaceSecretBroker


@pytest.fixture
def broker(monkeypatch):
    broker = Mock()
    broker.resolve_mcp_oauth.return_value = {
        "access_token": "sentinel-access-token",
        "expires_at": 9999999999999,
    }
    monkeypatch.setattr(
        WorkspaceSecretBroker, "from_environment", lambda: broker
    )
    return broker


def config():
    return {
        "mcpServers": {
            "Astrocade": {
                "url": "https://mcp.astrocade.com/mcp",
                "auth": {"type": "oauth"},
                "headers": {
                    "authorization": "obsolete",
                    "X-Custom": "preserved",
                },
            },
            "public": {"url": "https://example.com/mcp"},
            "local": {"command": "node", "args": ["server.js"]},
        }
    }


def test_injects_only_in_copy_and_strips_auth_before_camel(broker):
    original = config()
    snapshot = copy.deepcopy(original)
    result = apply_mcp_oauth(original, account="alice@example.com")
    assert original == snapshot
    remote = result["mcpServers"]["Astrocade"]
    assert "auth" not in remote
    assert remote["headers"] == {
        "Authorization": "Bearer sentinel-access-token",
        "X-Custom": "preserved",
    }
    assert result["mcpServers"]["public"] == original["mcpServers"]["public"]
    assert result["mcpServers"]["local"] == original["mcpServers"]["local"]
    assert "sentinel-access-token" not in json.dumps(original)
    broker.resolve_mcp_oauth.assert_called_once_with(
        account="alice@example.com",
        name="Astrocade",
        url="https://mcp.astrocade.com/mcp",
    )


@pytest.mark.parametrize(
    "reason,error",
    [
        ("signin_required", McpOAuthRequired),
        ("network", McpOAuthUnavailable),
        ("refresh_failed", McpOAuthUnavailable),
    ],
)
def test_typed_broker_errors_never_include_token_material(
    broker, reason, error
):
    broker.resolve_mcp_oauth.return_value = {
        "error": reason,
        "access_token": "sentinel-secret",
    }
    with pytest.raises(error) as raised:
        apply_mcp_oauth(config(), account="alice")
    assert "sentinel-secret" not in str(raised.value)
    assert raised.value.name == "Astrocade"


def test_unavailable_broker_has_a_clear_reason(monkeypatch):
    from app.workspace_bundle.secrets import WorkspaceSecretBrokerError

    def unavailable():
        raise WorkspaceSecretBrokerError("secret detail must not surface")

    monkeypatch.setattr(WorkspaceSecretBroker, "from_environment", unavailable)
    with pytest.raises(McpOAuthUnavailable) as raised:
        apply_mcp_oauth(config(), account="alice")
    assert raised.value.reason == "broker_unavailable"
    assert "secret detail" not in str(raised.value)


@pytest.mark.asyncio
async def test_legacy_notice_skips_only_failed_server_and_preserves_config(
    broker, monkeypatch
):
    broker.resolve_mcp_oauth.return_value = {"error": "signin_required"}
    notices = []
    task_lock = SimpleNamespace(
        put_queue=AsyncMock(side_effect=notices.append)
    )
    monkeypatch.setattr(
        "app.service.task.get_task_lock_if_exists", lambda _: task_lock
    )
    original = config()
    result = await prepare_mcp_oauth(
        original, account="alice", project_id="project", strict=False
    )
    assert set(result["mcpServers"]) == {"public", "local"}
    assert original == config()
    from app.service.task import notice_event_payload

    payload = notice_event_payload(notices[0])
    assert payload["title"] == "mcp_connector_unavailable"
    assert json.loads(payload["notice"].split(":", 1)[1]) == {
        "name": "Astrocade",
        "reason": "signin_required",
    }


@pytest.mark.asyncio
async def test_pinned_environment_requires_signin_instead_of_generic_mcp_error(
    broker,
):
    broker.resolve_mcp_oauth.return_value = {"error": "signin_required"}
    with pytest.raises(EnvironmentSetupRequiredError) as raised:
        await prepare_mcp_oauth(
            config(), account="alice", project_id="project", strict=True
        )
    assert raised.value.issues == ("mcp_oauth_required:Astrocade",)


def test_camel_transport_logs_cannot_expose_config_headers(caplog):
    logger = logging.getLogger("camel.utils.mcp_client")
    with caplog.at_level(logging.DEBUG):
        logger.error(
            "Failed: %s",
            {"headers": {"Authorization": "Bearer sentinel-secret"}},
        )
        logger.debug("headers: Authorization Bearer sentinel-secret")
    assert "sentinel-secret" not in caplog.text
    assert "MCP transport" in caplog.text


@pytest.mark.asyncio
async def test_401_survives_camels_aggregate_error_without_headers():
    async def connect_client(index, client):
        response = httpx.Response(
            401, request=httpx.Request("POST", "https://example.com/mcp")
        )
        raise httpx.HTTPStatusError(
            "includes sensitive headers",
            request=response.request,
            response=response,
        )

    class AggregateToolkit:
        _connect_single_client = staticmethod(connect_client)

        async def connect(self):
            results = await asyncio.gather(
                self._connect_single_client(0, None), return_exceptions=True
            )
            assert isinstance(results[0], Exception)
            raise RuntimeError("Failed to connect to 1 server")

    toolkit = AggregateToolkit()
    with pytest.raises(RuntimeError) as raised:
        await connect_mcp_toolkit(toolkit)
    assert raised.value.status_code == 401
    assert "sensitive" not in str(raised.value)


@pytest.mark.asyncio
async def test_workers_inject_tokens_skip_missing_auth_and_do_not_mutate_options(
    broker, monkeypatch
):
    from app.agent.tools import get_mcp_tools

    seen = []

    class Toolkit:
        def __init__(self, *, config_dict, **kwargs):
            seen.append(config_dict)

        async def connect(self):
            pass

        async def disconnect(self):
            pass

        def get_tools(self):
            return ["tool"]

    monkeypatch.setattr("app.agent.tools.MCPToolkit", Toolkit)
    original = config()
    tools = await get_mcp_tools(original, account="alice", project_id=None)
    assert tools == ["tool", "tool", "tool"]
    assert original == config()
    assert (
        seen[0]["mcpServers"]["Astrocade"]["headers"]["Authorization"]
        == "Bearer sentinel-access-token"
    )


def test_global_alias_resolves_the_original_connector_identity(
    broker, monkeypatch
):
    from app.workspace_config.global_resources import resolve_global_mcp

    monkeypatch.setattr(
        "app.workspace_config.global_resources._mcp_entries",
        lambda: iter(
            [
                (
                    {
                        "id": "Astrocade",
                        "definition": "registry://global/mcp/Astrocade",
                        "enabled": True,
                    },
                    config()["mcpServers"]["Astrocade"],
                ),
            ]
        ),
    )
    global_server = resolve_global_mcp("registry://global/mcp/Astrocade")
    result = apply_mcp_oauth(
        {"mcpServers": {"bundle-alias": global_server}}, account="alice"
    )
    broker.resolve_mcp_oauth.assert_called_once_with(
        account="alice", name="Astrocade", url="https://mcp.astrocade.com/mcp"
    )
    assert "_oauth_connector_name" not in result["mcpServers"]["bundle-alias"]
    assert "auth" not in result["mcpServers"]["bundle-alias"]


@pytest.mark.asyncio
async def test_real_mcp_transport_lists_and_calls_tools_with_runtime_token(
    broker,
):
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from camel.toolkits import MCPToolkit

    observed_headers = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            observed_headers.append(self.headers.get("Authorization"))
            request = json.loads(
                self.rfile.read(int(self.headers["Content-Length"]))
            )
            if request["method"].startswith("notifications/"):
                self.send_response(202)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if request["method"] == "initialize":
                result = {
                    "protocolVersion": request["params"]["protocolVersion"],
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "oauth-fixture", "version": "1"},
                }
            elif request["method"] == "tools/list":
                result = {
                    "tools": [
                        {
                            "name": "oauth_fixture_echo",
                            "description": "Echo input",
                            "inputSchema": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}},
                                "required": ["text"],
                            },
                        }
                    ]
                }
            else:
                result = {
                    "content": [
                        {
                            "type": "text",
                            "text": request["params"]["arguments"]["text"],
                        }
                    ]
                }
            response = json.dumps(
                {"jsonrpc": "2.0", "id": request["id"], "result": result}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def do_GET(self):
            self.send_response(405)
            self.send_header("Content-Length", "0")
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    original = {
        "mcpServers": {
            "fixture": {
                "url": f"http://127.0.0.1:{server.server_port}/mcp",
                "auth": {"type": "oauth"},
            }
        }
    }
    resolved = apply_mcp_oauth(original, account="alice")
    toolkit = MCPToolkit(config_dict=resolved, timeout=5, skip_failed=False)
    try:
        await connect_mcp_toolkit(toolkit)
        assert [tool.get_function_name() for tool in toolkit.get_tools()] == [
            "oauth_fixture_echo"
        ]
        result = await toolkit.call_tool(
            "oauth_fixture_echo", {"text": "hello"}
        )
        assert "hello" in str(result)
        assert observed_headers and set(observed_headers) == {
            "Bearer sentinel-access-token"
        }
        assert "sentinel-access-token" not in json.dumps(original)
    finally:
        await toolkit.disconnect()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.parametrize(
    "message,expected",
    [
        ("Client error '401 Unauthorized' for url 'https://x/mcp'", True),
        ("HTTP request failed with status code: 401", True),
        ("status=401", True),
        ("Connection refused: http://127.0.0.1:4010/mcp", False),
        ("HTTP 404 for https://example.com/items/401/tools", False),
    ],
)
def test_auth_failure_text_fallback_matches_only_a_401_status(
    message, expected
):
    from app.service.mcp_oauth import is_mcp_auth_failure

    assert is_mcp_auth_failure(RuntimeError(message)) is expected


@pytest.mark.asyncio
async def test_malformed_oauth_entry_is_skipped_with_a_notice(
    broker, monkeypatch
):
    notices = []
    task_lock = SimpleNamespace(
        put_queue=AsyncMock(side_effect=notices.append)
    )
    monkeypatch.setattr(
        "app.service.task.get_task_lock_if_exists", lambda _: task_lock
    )
    malformed = config()
    malformed["mcpServers"]["Astrocade"]["headers"] = None
    malformed["mcpServers"]["Listed"] = {
        **malformed["mcpServers"]["Astrocade"],
        "headers": ["not", "a", "mapping"],
    }
    malformed["mcpServers"]["broken"] = "not a server"
    result = await prepare_mcp_oauth(
        malformed, account="alice", project_id="project", strict=False
    )
    assert set(result["mcpServers"]) == {"Astrocade", "public", "local"}
    assert result["mcpServers"]["Astrocade"]["headers"] == {
        "Authorization": "Bearer sentinel-access-token"
    }
    from app.service.task import notice_event_payload

    reasons = [
        json.loads(notice_event_payload(n)["notice"].split(":", 1)[1])
        for n in notices
    ]
    assert reasons == [
        {"name": "Listed", "reason": "invalid_request"},
        {"name": "broken", "reason": "invalid_request"},
    ]


def test_camel_failures_without_credentials_keep_their_diagnostics(caplog):
    logger = logging.getLogger("camel.toolkits.mcp_toolkit")
    with caplog.at_level(logging.DEBUG):
        try:
            raise FileNotFoundError("npx: command not found")
        except FileNotFoundError:
            logger.error("Failed to connect to server local", exc_info=True)
    assert "Failed to connect to server local" in caplog.text
    assert "npx: command not found" in caplog.text


@pytest.mark.asyncio
async def test_workers_connect_independent_servers_concurrently(
    broker, monkeypatch
):
    from app.agent.tools import get_mcp_tools

    both_started = asyncio.Event()
    started = []

    class Toolkit:
        def __init__(self, *, config_dict, **kwargs):
            self.name = next(iter(config_dict["mcpServers"]))

        async def connect(self):
            started.append(self.name)
            if len(started) == 2:
                both_started.set()
            # A sequential loop would never start the second server.
            await asyncio.wait_for(both_started.wait(), timeout=1)
            if self.name == "local":
                raise RuntimeError("local failed")

        async def disconnect(self):
            pass

        def get_tools(self):
            return [self.name]

    monkeypatch.setattr("app.agent.tools.MCPToolkit", Toolkit)
    servers = config()
    del servers["mcpServers"]["Astrocade"]
    tools = await get_mcp_tools(servers, account="alice", project_id=None)
    assert tools == ["public"]
