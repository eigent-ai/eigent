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

import httpx
import pytest

from app.hands.http_hands_cluster import HttpHandsCluster


@pytest.mark.unit
def test_http_hands_cluster_acquire_with_wrapped_data():
    def _handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "http://hands-cluster.local/acquire"
        assert request.headers.get("authorization") == "Bearer token_abc"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["type"] == "browser"
        assert payload["resource_type"] == "browser"
        assert payload["session_id"] == "sess_11"
        assert payload["tenant_id"] == "tenant_1"
        assert payload["port"] == 9444
        return httpx.Response(
            200,
            json={
                "data": {
                    "endpoint": "http://worker-11:9222",
                    "container_id": "abc123",
                }
            },
        )

    cluster = HttpHandsCluster(
        base_url="http://hands-cluster.local",
        auth_token="token_abc",
        transport=httpx.MockTransport(_handler),
    )
    acquired = asyncio.run(
        cluster.acquire(
            resource_type="browser",
            session_id="sess_11",
            tenant_id="tenant_1",
            port=9444,
        )
    )
    assert acquired["endpoint"] == "http://worker-11:9222"
    assert acquired["container_id"] == "abc123"


@pytest.mark.unit
def test_http_hands_cluster_release_404_is_ignored():
    def _handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "http://hands-cluster.local/release"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["session_id"] == "sess_missing"
        return httpx.Response(404, json={"detail": "not found"})

    cluster = HttpHandsCluster(
        base_url="http://hands-cluster.local",
        transport=httpx.MockTransport(_handler),
    )
    asyncio.run(cluster.release("sess_missing"))


@pytest.mark.unit
def test_http_hands_cluster_health_with_custom_path():
    def _handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == "http://hands-cluster.local/api/v1/healthz"
        return httpx.Response(
            200,
            json={
                "browser_workers": {"total": 3, "available": 2, "in_use": 1}
            },
        )

    cluster = HttpHandsCluster(
        base_url="http://hands-cluster.local",
        health_path="/api/v1/healthz",
        transport=httpx.MockTransport(_handler),
    )
    health = asyncio.run(cluster.health())
    assert health["browser_workers"]["available"] == 2


@pytest.mark.unit
def test_http_hands_cluster_requires_base_url():
    with pytest.raises(ValueError):
        HttpHandsCluster(base_url="  ")
