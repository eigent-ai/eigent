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

import pytest

from app.hands.routed_hands_cluster import RoutedHandsCluster


class _FakeCluster:
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint
        self.acquired: list[tuple[str, str]] = []
        self.released: list[str] = []

    async def acquire(
        self,
        resource_type: str,
        session_id: str,
        tenant_id: str = "default",
        **kwargs,
    ) -> dict:
        _ = (tenant_id, kwargs)
        self.acquired.append((resource_type, session_id))
        return {"endpoint": self.endpoint}

    async def release(self, session_id: str) -> None:
        self.released.append(session_id)

    async def health(self) -> dict:
        return {"endpoint": self.endpoint}


@pytest.mark.unit
def test_routed_cluster_routes_by_resource_type():
    browser = _FakeCluster("http://browser-cluster:9222")
    terminal = _FakeCluster("http://terminal-cluster:7001")
    routed = RoutedHandsCluster({"browser": browser, "terminal": terminal})

    acquired = asyncio.run(
        routed.acquire("terminal", "sess_terminal", tenant_id="default")
    )
    assert acquired["endpoint"] == "http://terminal-cluster:7001"
    assert acquired["cluster_key"] == "terminal"
    assert ("terminal", "sess_terminal") in terminal.acquired
    assert browser.acquired == []


@pytest.mark.unit
def test_routed_cluster_release_uses_same_cluster_as_acquire():
    browser = _FakeCluster("http://browser-cluster:9222")
    terminal = _FakeCluster("http://terminal-cluster:7001")
    routed = RoutedHandsCluster({"browser": browser, "terminal": terminal})

    asyncio.run(routed.acquire("browser", "sess_browser"))
    asyncio.run(routed.release("sess_browser"))
    assert "sess_browser" in browser.released
    assert terminal.released == []


@pytest.mark.unit
def test_routed_cluster_uses_default_when_resource_missing():
    default_cluster = _FakeCluster("http://default-cluster:8100")
    routed = RoutedHandsCluster(
        {"default": default_cluster, "browser": _FakeCluster("http://b:1")}
    )

    acquired = asyncio.run(routed.acquire("model", "sess_model"))
    assert acquired["endpoint"] == "http://default-cluster:8100"
    assert acquired["cluster_key"] == "default"


@pytest.mark.unit
def test_routed_cluster_requires_non_empty_mapping():
    with pytest.raises(ValueError):
        RoutedHandsCluster({})
