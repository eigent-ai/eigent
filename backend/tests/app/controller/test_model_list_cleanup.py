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

"""Real HTTPX/httpcore/AnyIO TLS handshake with only the byte stream mocked."""

import asyncio
import socket
from unittest.mock import AsyncMock

import anyio
import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.controller import model_controller as controller


class HangingTLSStream:
    def __init__(self):
        self.sent = []
        self.receiving = asyncio.Event()
        self.close_started = asyncio.Event()
        self.close_allowed = asyncio.Event()
        self.close_allowed.set()
        self.closed = False
        self.aclose = AsyncMock(side_effect=self._close)

    async def send(self, item):
        self.sent.append(item)

    async def receive(self, max_bytes=65536):
        self.receiving.set()
        await asyncio.Event().wait()

    async def _close(self):
        self.close_started.set()
        await self.close_allowed.wait()
        await asyncio.sleep(0)
        self.closed = True


@pytest_asyncio.fixture
async def hanging_tls(monkeypatch):
    stream = HangingTLSStream()
    monkeypatch.setattr(anyio, "connect_tcp", AsyncMock(return_value=stream))
    monkeypatch.setattr(
        asyncio.get_running_loop(),
        "getaddrinfo",
        AsyncMock(
            return_value=[
                (
                    socket.AF_INET,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    "",
                    ("8.8.8.8", 443),
                )
            ]
        ),
    )
    return stream


def request():
    return controller.ListProviderModelsRequest(
        api_host="https://models.fixture.example/v1",
        models_endpoint="/models",
        api_key="fixture-key",
    )


async def wait_for_client_hello(stream):
    await asyncio.wait_for(stream.receiving.wait(), 2)
    assert stream.sent[0][0] == 22  # Real TLS handshake record / ClientHello.
    assert b"models.fixture.example" in b"".join(stream.sent)


@pytest.mark.asyncio
@pytest.mark.parametrize("exact_deadline", [False, True])
async def test_total_deadline_closes_real_tls_handshake(
    hanging_tls, monkeypatch, exact_deadline
):
    deadlines = []
    if not exact_deadline:
        original_timeout = asyncio.timeout

        def controlled_timeout(seconds):
            assert seconds == 15.0
            deadline = original_timeout(None)
            deadlines.append(deadline)
            return deadline

        monkeypatch.setattr(controller.asyncio, "timeout", controlled_timeout)
    operation = asyncio.create_task(controller.list_provider_models(request()))
    try:
        await wait_for_client_hello(hanging_tls)
        if not exact_deadline:
            # Expire the real outer asyncio.Timeout only after handshake I/O
            # begins; keep the dependency's stage timeout/start_tls untouched.
            deadlines[0].reschedule(asyncio.get_running_loop().time())
        with pytest.raises(HTTPException) as error:
            await operation
        assert error.value.status_code == 502
        assert (
            error.value.detail
            == "Could not reach the provider model endpoint."
        )
        hanging_tls.aclose.assert_awaited_once()
        assert hanging_tls.closed
    finally:
        hanging_tls.close_allowed.set()
        operation.cancel()
        await asyncio.gather(operation, return_exceptions=True)


@pytest.mark.asyncio
async def test_external_cancellation_closes_real_tls_handshake(hanging_tls):
    operation = asyncio.create_task(controller.list_provider_models(request()))
    try:
        await wait_for_client_hello(hanging_tls)
        operation.cancel()
        with pytest.raises(asyncio.CancelledError):
            await operation
        hanging_tls.aclose.assert_awaited_once()
        assert hanging_tls.closed
    finally:
        hanging_tls.close_allowed.set()
        operation.cancel()
        await asyncio.gather(operation, return_exceptions=True)


@pytest.mark.asyncio
async def test_repeated_cancel_waits_for_connection_cleanup(hanging_tls):
    hanging_tls.close_allowed.clear()
    operation = asyncio.create_task(controller.list_provider_models(request()))
    try:
        await wait_for_client_hello(hanging_tls)
        operation.cancel()
        await asyncio.wait_for(hanging_tls.close_started.wait(), 2)
        operation.cancel()
        await asyncio.sleep(0)
        assert not operation.done()
        hanging_tls.close_allowed.set()
        with pytest.raises(asyncio.CancelledError):
            await operation
        hanging_tls.aclose.assert_awaited_once()
        assert hanging_tls.closed
    finally:
        hanging_tls.close_allowed.set()
        operation.cancel()
        await asyncio.gather(operation, return_exceptions=True)


@pytest.mark.asyncio
async def test_anyio_scope_cancellation_closes_real_tls_handshake(hanging_tls):
    async with anyio.create_task_group() as group:
        group.start_soon(controller.list_provider_models, request())
        await wait_for_client_hello(hanging_tls)
        group.cancel_scope.cancel()
    hanging_tls.aclose.assert_awaited_once()
    assert hanging_tls.closed
