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

"""Cancellation cleanup for the public model-list outlet only."""

import asyncio
import logging
from typing import Any

import anyio
import httpx
from httpcore import AsyncNetworkStream

logger = logging.getLogger(__name__)


async def _close_cancelled_connection(stream: AsyncNetworkStream) -> None:
    # Only teardown is shielded. Join it even if the request is cancelled a
    # second time, then let the transport re-raise the original cancellation.
    closing = asyncio.create_task(stream.aclose())
    with anyio.CancelScope(shield=True):
        while not closing.done():
            try:
                await asyncio.shield(closing)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        try:
            closing.result()
        except Exception:
            logger.warning("Could not close cancelled model-list connection")


class ProviderModelTransport(httpx.AsyncHTTPTransport):
    async def handle_async_request(
        self, request: httpx.Request
    ) -> httpx.Response:
        connection: AsyncNetworkStream | None = None

        async def remember_connection(name: str, info: dict[str, Any]):
            nonlocal connection
            if name == "connection.connect_tcp.complete":
                connection = info["return_value"]

        # HTTPX's trace extension exposes the raw TCP stream before TLS starts.
        # httpcore 1.0.9 does not close this stream on CancelledError during
        # start_tls, and its pool does not yet own an established connection.
        # Keep the handle local to this request; do not change shared backends.
        request.extensions["trace"] = remember_connection
        try:
            return await super().handle_async_request(request)
        except asyncio.CancelledError:
            if connection is not None:
                await _close_cancelled_connection(connection)
            raise
