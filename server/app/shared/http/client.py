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

"""
httpx wrapper that auto-injects X-Trace-ID header from context.

All external calls (litellm, OAuth adapters, Stack Auth, Google Search)
should route through this client for trace propagation.
"""

from typing import Any

import httpx

from app.shared.context import get_trace_id

TRACE_HEADER = "X-Trace-ID"


def _trace_headers(extra: dict | None = None) -> dict:
    """Build headers dict with X-Trace-ID from context."""
    headers = dict(extra or {})
    trace_id = get_trace_id()
    if trace_id:
        headers[TRACE_HEADER] = trace_id
    return headers


async def trace_httpx_post(
    url: str,
    *,
    json: dict | None = None,
    data: Any = None,
    headers: dict | None = None,
    timeout: float = 30.0,
    **kwargs,
) -> httpx.Response:
    """
    POST request with X-Trace-ID injected.
    """
    merged_headers = _trace_headers(headers)
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.post(url, json=json, data=data, headers=merged_headers, **kwargs)


async def trace_httpx_get(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = 30.0,
    **kwargs,
) -> httpx.Response:
    """
    GET request with X-Trace-ID injected.
    """
    merged_headers = _trace_headers(headers)
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.get(url, params=params, headers=merged_headers, **kwargs)


def trace_httpx_client(
    base_url: str | None = None,
    headers: dict | None = None,
    timeout: float = 30.0,
    **kwargs,
) -> httpx.AsyncClient:
    """
    Create httpx.AsyncClient with default headers including X-Trace-ID.

    Use as context manager:
        async with trace_httpx_client(base_url="https://...") as client:
            r = await client.post("/path", json={...})
    """
    default_headers = _trace_headers(headers)
    return httpx.AsyncClient(
        base_url=base_url,
        headers=default_headers,
        timeout=timeout,
        **kwargs,
    )
