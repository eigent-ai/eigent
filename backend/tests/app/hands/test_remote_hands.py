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

import pytest

from app.hands.remote_hands import RemoteHands


class _FakeCluster:
    def __init__(self) -> None:
        self.released: list[str] = []
        self.acquired: list[tuple[str, str]] = []

    async def acquire(
        self,
        resource_type: str,
        session_id: str,
        tenant_id: str = "default",
        **kwargs,
    ) -> dict:
        _ = (tenant_id, kwargs)
        self.acquired.append((resource_type, session_id))
        return {"endpoint": "http://worker-17:9222", "container_id": "abc123"}

    async def release(self, session_id: str) -> None:
        self.released.append(session_id)

    async def health(self) -> dict:
        return {"browser_workers": {"total": 1, "available": 1, "in_use": 0}}


@pytest.mark.unit
def test_remote_hands_browser_fallback_endpoint():
    hands = RemoteHands(cluster=None)
    endpoint = hands.acquire_resource("browser", "sess_1", port=9444)
    assert endpoint == "http://localhost:9444"


@pytest.mark.unit
def test_remote_hands_cluster_acquire_and_release():
    cluster = _FakeCluster()
    hands = RemoteHands(cluster=cluster)

    endpoint = hands.acquire_resource("browser", "sess_2")
    assert endpoint == "http://worker-17:9222"
    assert ("browser", "sess_2") in cluster.acquired

    hands.release_resource("browser", "sess_2")
    assert "sess_2" in cluster.released


@pytest.mark.unit
def test_remote_hands_cluster_allows_non_browser_resource():
    cluster = _FakeCluster()
    hands = RemoteHands(cluster=cluster)

    endpoint = hands.acquire_resource("terminal", "sess_terminal")
    assert endpoint == "http://worker-17:9222"
    assert ("terminal", "sess_terminal") in cluster.acquired


@pytest.mark.unit
def test_remote_hands_unknown_resource_raises():
    hands = RemoteHands(cluster=None)
    with pytest.raises(ValueError):
        hands.acquire_resource("terminal", "sess_3")


@pytest.mark.unit
def test_remote_hands_workspace_prefix_bypass_blocked(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    sibling = tmp_path / "workspace_evil"
    sibling.mkdir()
    inside = workspace / "ok.txt"
    inside.write_text("ok", encoding="utf-8")
    outside = sibling / "evil.txt"
    outside.write_text("evil", encoding="utf-8")

    hands = RemoteHands(cluster=None, workspace_root=str(workspace))
    assert hands.can_access_filesystem(str(inside)) is True
    assert hands.can_access_filesystem(str(outside)) is False
