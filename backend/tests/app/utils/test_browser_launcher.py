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

import json

import pytest

from app.utils.browser_launcher import _is_supported_cdp_version


class _FakeWebSocket:
    def __init__(self, response: dict):
        self.response = response
        self.sent: dict | None = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def send(self, message: str):
        self.sent = json.loads(message)

    def recv(self, timeout: int):
        assert timeout == 2
        return json.dumps(self.response)


@pytest.mark.unit
def test_supported_cdp_version_requires_context_management(monkeypatch):
    fake_ws = _FakeWebSocket({"id": 1, "result": {}})
    monkeypatch.setattr(
        "websockets.sync.client.connect",
        lambda *args, **kwargs: fake_ws,
    )

    assert _is_supported_cdp_version(
        {
            "Browser": "Chrome/147.0.7727.102",
            "User-Agent": "Chrome/147.0.7727.102",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9223/devtools/browser/id",
        },
        "http://127.0.0.1:9223",
    )
    assert fake_ws.sent == {
        "id": 1,
        "method": "Browser.setDownloadBehavior",
        "params": {"behavior": "default"},
    }


@pytest.mark.unit
def test_supported_cdp_version_rejects_context_management_error(monkeypatch):
    fake_ws = _FakeWebSocket(
        {
            "id": 1,
            "error": {
                "code": -32000,
                "message": "Browser context management is not supported.",
            },
        }
    )
    monkeypatch.setattr(
        "websockets.sync.client.connect",
        lambda *args, **kwargs: fake_ws,
    )

    assert not _is_supported_cdp_version(
        {
            "Browser": "Chrome/147.0.7727.102",
            "User-Agent": "Chrome/147.0.7727.102",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/id",
        },
        "http://127.0.0.1:9222",
    )
