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
import os
import sys

import pytest
from camel.utils.mcp_client import TransportType

from app.agent.toolkit.owned_mcp_toolkit import OwnedMCPClient, OwnedMCPToolkit

SERVER = """
import json, os, sys
from pathlib import Path
for line in sys.stdin:
    request = json.loads(line)
    if "id" not in request:
        continue
    method = request["method"]
    if method == "initialize":
        result = {"protocolVersion": request["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "fixture", "version": "1"}}
    elif method == "tools/list":
        result = {"tools": [{"name": "write_output", "description": "Write an isolated fixture", "inputSchema": {"type": "object", "properties": {}, "required": []}}]}
    elif method == "tools/call":
        facts = {"pid": os.getpid(), "cwd": os.getcwd()}
        Path("mcp-output.json").write_text(json.dumps(facts))
        result = {"content": [{"type": "text", "text": json.dumps(facts)}]}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
"""


@pytest.mark.asyncio
async def test_stdio_mcp_has_private_cwd_and_exact_process_cleanup(tmp_path):
    server = tmp_path / "fixture.py"
    server.write_text(SERVER)
    toolkits = []
    facts = []
    try:
        for index in (1, 2):
            root = tmp_path / f"run-{index}"
            root.mkdir()
            toolkits.append(
                OwnedMCPToolkit(
                    config_dict={
                        "mcpServers": {
                            "fixture": {
                                "command": sys.executable,
                                "args": [str(server)],
                                "cwd": str(root),
                            }
                        }
                    },
                    max_retries=0,
                )
            )
        await asyncio.gather(*(toolkit.connect() for toolkit in toolkits))
        await asyncio.gather(
            *(toolkit.call_tool("write_output", {}) for toolkit in toolkits)
        )
        facts = [
            json.loads(
                (tmp_path / f"run-{index}" / "mcp-output.json").read_text()
            )
            for index in (1, 2)
        ]
        assert facts[0]["pid"] != facts[1]["pid"]
        assert {item["cwd"] for item in facts} == {
            str(tmp_path / "run-1"),
            str(tmp_path / "run-2"),
        }
        await toolkits[0].disconnect()
        with pytest.raises(ProcessLookupError):
            os.kill(facts[0]["pid"], 0)
        os.kill(facts[1]["pid"], 0)
        await toolkits[1].call_tool("write_output", {})
        await toolkits[1].disconnect()
        with pytest.raises(ProcessLookupError):
            os.kill(facts[1]["pid"], 0)
    finally:
        await asyncio.gather(
            *(toolkit.disconnect() for toolkit in toolkits),
            return_exceptions=True,
        )


@pytest.mark.asyncio
async def test_mcp_transport_close_error_remains_unsettled():
    entered = asyncio.Event()
    client = OwnedMCPClient({"command": sys.executable})

    class FailedClose:
        async def __aexit__(self, *_):
            raise RuntimeError("writer still present")

    async def connect(_transport):
        client._connection_context = FailedClose()
        entered.set()

    client._try_connect = connect
    await client.__aenter__()
    assert entered.is_set()
    for _ in range(2):
        with pytest.raises(RuntimeError, match="cleanup failed"):
            await client.__aexit__(None, None, None)
    assert client._connection_context is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("explicit", [False, True])
async def test_mcp_http_fallback_preserves_transport_owner(explicit):
    configuration = {"url": "http://localhost/fixture"}
    if explicit:
        configuration["type"] = "streamable_http"
    client = OwnedMCPClient(configuration)
    attempts = []
    owners = []

    class Transport:
        async def __aexit__(self, *_):
            owners.append(asyncio.current_task())

    async def connect(transport):
        attempts.append(transport)
        owners.append(asyncio.current_task())
        client._connection_context = Transport()
        if transport == TransportType.STREAMABLE_HTTP:
            await client._cleanup_connection()
            raise ConnectionError("fixture requires SSE")

    client._try_connect = connect
    if explicit:
        with pytest.raises(ConnectionError, match="requires SSE"):
            await client.__aenter__()
        assert attempts == [TransportType.STREAMABLE_HTTP]
    else:
        await client.__aenter__()
        assert attempts == [TransportType.STREAMABLE_HTTP, TransportType.SSE]
    await client.__aexit__(None, None, None)
    assert len(set(owners)) == 1
    assert client._connection_context is None
