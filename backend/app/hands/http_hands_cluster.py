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

import logging
from typing import Any

import httpx

from app.hands.cluster_interface import IHandsCluster

logger = logging.getLogger("hands.cluster.http")


class HttpHandsCluster(IHandsCluster):
    """HTTP-backed Hands cluster client."""

    def __init__(
        self,
        base_url: str,
        timeout_seconds: float = 10.0,
        auth_token: str | None = None,
        acquire_path: str = "/acquire",
        release_path: str = "/release",
        health_path: str = "/health",
        verify_tls: bool = True,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        normalized = base_url.strip().rstrip("/")
        if not normalized:
            raise ValueError("base_url must not be empty")
        self._base_url = normalized
        self._timeout_seconds = timeout_seconds
        self._auth_token = auth_token
        self._acquire_path = acquire_path
        self._release_path = release_path
        self._health_path = health_path
        self._verify_tls = verify_tls
        self._transport = transport

    async def acquire(
        self,
        resource_type: str,
        session_id: str,
        tenant_id: str = "default",
        **kwargs,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "type": resource_type,
            "resource_type": resource_type,
            "session_id": session_id,
            "tenant_id": tenant_id,
        }
        payload.update(kwargs)
        body = await self._request_json(
            method="POST",
            url=self._build_url(self._acquire_path),
            payload=payload,
        )
        data = self._unwrap_response(body)
        endpoint = (
            data.get("endpoint") or data.get("cdp_url") or data.get("url")
        )
        if not endpoint:
            raise RuntimeError(
                "Hands cluster acquire response missing endpoint"
            )
        data["endpoint"] = str(endpoint)
        return data

    async def release(self, session_id: str) -> None:
        payload = {"session_id": session_id}
        try:
            await self._request_json(
                method="POST",
                url=self._build_url(self._release_path),
                payload=payload,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                logger.warning(
                    "Hands cluster release returned 404 for session_id=%s",
                    session_id,
                )
                return
            raise

    async def health(self) -> dict[str, Any]:
        body = await self._request_json(
            method="GET",
            url=self._build_url(self._health_path),
            payload=None,
        )
        return self._unwrap_response(body)

    def _build_url(self, path: str) -> str:
        p = path.strip()
        if p.startswith("http://") or p.startswith("https://"):
            return p
        if not p.startswith("/"):
            p = f"/{p}"
        return f"{self._base_url}{p}"

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self._auth_token:
            headers["Authorization"] = f"Bearer {self._auth_token}"
        return headers

    async def _request_json(
        self,
        method: str,
        url: str,
        payload: dict[str, Any] | None,
    ) -> dict[str, Any]:
        request_kwargs: dict[str, Any] = {"headers": self._headers()}
        if payload is not None:
            request_kwargs["json"] = payload

        async with httpx.AsyncClient(
            timeout=self._timeout_seconds,
            verify=self._verify_tls,
            transport=self._transport,
        ) as client:
            response = await client.request(method, url, **request_kwargs)
        response.raise_for_status()

        if not response.content:
            return {}

        try:
            body = response.json()
        except ValueError:
            return {}
        if isinstance(body, dict):
            return body
        return {"result": body}

    def _unwrap_response(self, body: dict[str, Any]) -> dict[str, Any]:
        if isinstance(body.get("data"), dict):
            return dict(body["data"])
        if isinstance(body.get("result"), dict):
            return dict(body["result"])
        return dict(body)
