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

from app.router_layer.message_router import DefaultMessageRouter
from app.router_layer.session_store import MemorySessionStore


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_session_reuses_valid_session(monkeypatch):
    current = {"now": 1000.0}
    monkeypatch.setattr(
        "app.router_layer.message_router._now_ts", lambda: current["now"]
    )

    router = DefaultMessageRouter(session_ttl=60)
    session_id = await router.resolve_session("web", None, "alice")

    current["now"] = 1020.0
    reused = await router.resolve_session("web", session_id, "alice")

    assert reused == session_id


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_session_channel_mismatch_creates_new(monkeypatch):
    current = {"now": 1000.0}
    monkeypatch.setattr(
        "app.router_layer.message_router._now_ts", lambda: current["now"]
    )

    router = DefaultMessageRouter(session_ttl=60)
    session_id = await router.resolve_session("web", None, "alice")

    current["now"] = 1010.0
    new_session = await router.resolve_session("desktop", session_id, "alice")

    assert new_session != session_id


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_session_expired_creates_new(monkeypatch):
    current = {"now": 1000.0}
    monkeypatch.setattr(
        "app.router_layer.message_router._now_ts", lambda: current["now"]
    )

    router = DefaultMessageRouter(session_ttl=10)
    session_id = await router.resolve_session("web", None, "alice")

    current["now"] = 1015.0
    new_session = await router.resolve_session("web", session_id, "alice")

    assert new_session != session_id


@pytest.mark.unit
@pytest.mark.asyncio
async def test_memory_session_store_respects_ttl(monkeypatch):
    current = {"now": 2000.0}
    monkeypatch.setattr(
        "app.router_layer.session_store.time.time",
        lambda: current["now"],
    )

    store = MemorySessionStore()
    await store.set("sess_1", {"session_id": "sess_1"}, ttl=10)
    assert await store.get("sess_1") == {"session_id": "sess_1"}

    current["now"] = 2011.0
    assert await store.get("sess_1") is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_memory_session_store_lazy_cleanup_on_set(monkeypatch):
    current = {"now": 1000.0}
    monkeypatch.setattr(
        "app.router_layer.session_store.time.time",
        lambda: current["now"],
    )

    store = MemorySessionStore()
    for i in range(127):
        await store.set(
            f"sess_old_{i}", {"session_id": f"sess_old_{i}"}, ttl=1
        )

    current["now"] = 2000.0
    await store.set("sess_live", {"session_id": "sess_live"}, ttl=60)

    # GC should run on the 128th set call and purge expired entries even if never read.
    assert len(store._sessions) == 1
    assert await store.get("sess_live") == {"session_id": "sess_live"}
