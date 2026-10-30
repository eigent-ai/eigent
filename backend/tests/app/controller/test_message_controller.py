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
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.router import register_routers
from app.router_layer import ChannelSessionMiddleware


def _build_app(prefix: str) -> FastAPI:
    app = FastAPI()
    register_routers(app, prefix=prefix)
    app.add_middleware(ChannelSessionMiddleware)
    return app


@pytest.mark.unit
def test_message_endpoint_is_prefix_aware():
    app = _build_app("/api/v1")
    paths = {route.path for route in app.routes if hasattr(route, "path")}
    assert "/api/v1/messages" in paths
    assert "/api/v1/v1/messages" not in paths


@pytest.mark.unit
def test_message_endpoint_streams_via_start_chat_stream(monkeypatch):
    async def fake_start_chat_stream(_chat, _request):
        async def _stream():
            yield 'data: {"text":"ok"}\n\n'

        return _stream()

    monkeypatch.setattr(
        "app.controller.chat_controller.start_chat_stream",
        fake_start_chat_stream,
    )

    app = _build_app("/api/v1")
    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/api/v1/messages",
            json={"content": "hello"},
            headers={"X-Channel": "web"},
        ) as response:
            assert response.status_code == 200
            body = "".join(response.iter_text())
            assert '"text":"ok"' in body
            sid = response.headers.get("x-session-id")
            assert sid and sid.startswith("sess_")
