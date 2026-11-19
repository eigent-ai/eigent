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

"""Exercise the model-list outlet through HTTPX with DNS and sockets mocked."""

import asyncio
import ipaddress
import socket
import ssl
from unittest.mock import AsyncMock

import httpcore
import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpcore._backends.auto import AutoBackend

from app.controller.model_controller import (
    ListProviderModelsRequest,
    list_provider_models,
)


def dns_results(*addresses):
    return [
        (
            socket.AF_INET6 if ":" in address else socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            "",
            (address, 8443, 0, 0) if ":" in address else (address, 8443),
        )
        for address in addresses
    ]


def model_request(host="models.byok.example:8443"):
    return ListProviderModelsRequest(
        api_host=f"https://{host}/v1",
        models_endpoint="/models?limit=10",
        api_key="fixture-key",
    )


@pytest_asyncio.fixture
async def outlet(monkeypatch):
    # Use the real HTTPX/httpcore transport, replacing only DNS and the socket.
    resolver = AsyncMock(return_value=dns_results("8.8.8.8"))
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolver)
    body = b'{"data":[{"id":"fixture-model"}]}'
    stream = httpcore.AsyncMockStream(
        [
            b"HTTP/1.1 200 OK\r\nContent-Length: "
            + str(len(body)).encode()
            + b"\r\nContent-Type: application/json\r\n\r\n"
            + body
        ]
    )
    stream.write = AsyncMock()
    stream.start_tls = AsyncMock(return_value=stream)
    connect = AsyncMock(return_value=stream)
    monkeypatch.setattr(AutoBackend, "connect_tcp", connect)
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"):
        monkeypatch.delenv(name, raising=False)
        monkeypatch.delenv(name.lower(), raising=False)
    return resolver, connect, stream


@pytest.mark.asyncio
@pytest.mark.parametrize("address", ["8.8.8.8", "2606:4700:4700::1111"])
async def test_public_byok_uses_validated_ip_with_original_host_and_tls(
    outlet, address, monkeypatch
):
    # An ambient proxy must not move target resolution outside the boundary.
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:8080")
    monkeypatch.setenv("ALL_PROXY", "http://proxy.invalid:8080")
    monkeypatch.setenv("NO_PROXY", "")
    resolver, connect, stream = outlet
    resolver.return_value = dns_results(address)
    assert await list_provider_models(model_request()) == {
        "data": [{"id": "fixture-model"}]
    }
    resolver.assert_awaited_once()
    assert resolver.call_args.args[:2] == ("models.byok.example", 8443)
    assert connect.call_args.kwargs["host"] == address
    assert connect.call_args.kwargs["port"] == 8443
    tls = stream.start_tls.call_args.kwargs
    assert tls["server_hostname"] == "models.byok.example"
    assert tls["ssl_context"].check_hostname
    assert tls["ssl_context"].verify_mode == ssl.CERT_REQUIRED
    wire = b"".join(call.args[0] for call in stream.write.call_args_list)
    assert b"GET /v1/models?limit=10 HTTP/1.1\r\n" in wire
    assert b"Host: models.byok.example:8443\r\n" in wire
    assert b"Authorization: Bearer fixture-key\r\n" in wire


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "addresses",
    [
        ["127.0.0.1"],
        ["::1"],
        ["10.0.0.1"],
        ["172.16.0.1"],
        ["192.168.1.1"],
        ["169.254.169.254"],
        ["fe80::1"],
        ["fd00::1"],
        ["::ffff:127.0.0.1"],
        ["100.64.0.1"],
        ["0.0.0.0"],
        ["224.0.0.1"],
        ["8.8.8.8", "127.0.0.1"],
        ["8.8.8.8", "fd00::1"],
        ["::1", "2606:4700:4700::1111"],
    ],
)
async def test_rejects_entire_dns_result_if_any_address_is_not_public(
    outlet, addresses
):
    resolver, connect, _ = outlet
    resolver.return_value = dns_results(*addresses)
    with pytest.raises(HTTPException) as error:
        await list_provider_models(model_request("localhost"))
    assert error.value.status_code == 400
    assert error.value.detail == "API host must be a public HTTPS URL."
    connect.assert_not_awaited()


@pytest.mark.asyncio
async def test_dns_rebinding_cannot_change_the_connection_target(outlet):
    resolver, connect, stream = outlet
    resolver.side_effect = [
        dns_results("8.8.8.8"),
        dns_results("127.0.0.1"),
    ]

    async def dial(*, host, **kwargs):
        # Model a transport that would resolve a hostname a second time.
        try:
            ipaddress.ip_address(host)
        except ValueError:
            await asyncio.get_running_loop().getaddrinfo(host, 8443)
            pytest.fail("Transport re-resolved the untrusted hostname")
        assert host == "8.8.8.8"
        return stream

    connect.side_effect = dial
    await list_provider_models(model_request())
    resolver.assert_awaited_once()
    connect.assert_awaited_once()


@pytest.mark.asyncio
async def test_falls_back_only_to_other_validated_candidates(outlet):
    resolver, connect, stream = outlet
    resolver.return_value = dns_results("2606:4700:4700::1111", "8.8.8.8")
    connect.side_effect = [httpcore.ConnectError("unreachable"), stream]
    await list_provider_models(model_request())
    assert [call.kwargs["host"] for call in connect.call_args_list] == [
        "2606:4700:4700::1111",
        "8.8.8.8",
    ]
    resolver.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure", [socket.gaierror("secret"), TimeoutError()]
)
async def test_resolution_failures_are_sanitized(outlet, failure):
    resolver, connect, _ = outlet
    resolver.side_effect = failure
    with pytest.raises(HTTPException) as error:
        await list_provider_models(model_request())
    assert error.value.status_code == 502
    assert error.value.detail == "Could not reach the provider model endpoint."
    connect.assert_not_awaited()


@pytest.mark.asyncio
async def test_empty_dns_result_is_rejected(outlet):
    resolver, connect, _ = outlet
    resolver.return_value = []
    with pytest.raises(HTTPException) as error:
        await list_provider_models(model_request())
    assert error.value.status_code == 502
    connect.assert_not_awaited()


@pytest.mark.asyncio
async def test_redirects_do_not_trigger_another_connection(outlet):
    _, connect, stream = outlet
    stream._buffer = [
        b"HTTP/1.1 302 Found\r\nLocation: https://127.0.0.1/models\r\n"
        b"Content-Length: 0\r\n\r\n"
    ]
    with pytest.raises(HTTPException):
        await list_provider_models(model_request())
    connect.assert_awaited_once()


@pytest.mark.asyncio
async def test_tls_failure_is_sanitized(outlet):
    _, _, stream = outlet
    stream.start_tls.side_effect = httpcore.ConnectError("upstream secret")
    with pytest.raises(HTTPException) as error:
        await list_provider_models(model_request())
    assert error.value.status_code == 502
    assert error.value.detail == "Could not reach the provider model endpoint."
    stream.write.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("host", ["8.8.8.8", "[2606:4700:4700::1111]"])
async def test_public_ip_literal_does_not_need_dns(outlet, host):
    resolver, connect, stream = outlet
    await list_provider_models(model_request(host))
    resolver.assert_not_awaited()
    assert connect.call_args.kwargs["host"] == host.strip("[]")
    wire = b"".join(call.args[0] for call in stream.write.call_args_list)
    assert f"Host: {host}\r\n".encode() in wire


@pytest.mark.asyncio
@pytest.mark.parametrize("host", ["127.0.0.1", "[::1]", "224.0.0.1"])
async def test_nonpublic_ip_literal_never_connects(outlet, host):
    resolver, connect, _ = outlet
    with pytest.raises(HTTPException) as error:
        await list_provider_models(model_request(host))
    assert error.value.status_code == 400
    resolver.assert_not_awaited()
    connect.assert_not_awaited()
