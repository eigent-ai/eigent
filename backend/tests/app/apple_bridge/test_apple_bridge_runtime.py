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

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openai import OpenAI

from app.agent.agent_model import agent_model
from app.apple_bridge import runtime as runtime_module
from app.apple_bridge.runtime import resolve_apple_bridge_config
from app.apple_bridge.supervisor import (
    AppleBridgeSupervisor,
    AppleBridgeUnavailableError,
    BridgeEndpoint,
)
from app.controller import apple_intelligence_controller
from app.model.chat import Chat
from app.model.model_platform import normalize_model_platform

pytestmark = pytest.mark.unit

FAKE_BRIDGE = Path(__file__).with_name("fake_bridge.py")
ENDPOINT = BridgeEndpoint("http://127.0.0.1:4321/v1", "t" * 43)


def stub_supervisor(endpoint=ENDPOINT, error=None):
    supervisor = MagicMock(spec=AppleBridgeSupervisor)
    if error is not None:
        supervisor.endpoint.side_effect = error
    else:
        supervisor.endpoint.return_value = endpoint
    return supervisor


def apple_config(**overrides):
    return {
        "model_platform": "openai-compatible-model",
        "model_type": "apple-on-device",
        "api_key": "not-required",
        "api_url": "",
        **overrides,
    }


def test_provider_aliases_to_the_openai_compatible_client():
    assert normalize_model_platform("apple-intelligence") == (
        "openai-compatible-model"
    )


def test_fills_in_the_live_bridge_url_and_token():
    resolved = resolve_apple_bridge_config(
        apple_config(), supervisor=stub_supervisor()
    )
    assert resolved["api_url"] == ENDPOINT.base_url
    assert resolved["api_key"] == ENDPOINT.token
    assert resolved["model_platform"] == "openai-compatible-model"


@pytest.mark.parametrize(
    "config",
    [
        apple_config(model_type="llama3"),
        apple_config(api_url="http://localhost:11434/v1"),
        {"model_platform": "openai", "model_type": "gpt-4", "api_url": None},
    ],
)
def test_other_models_are_unchanged(config):
    supervisor = stub_supervisor()
    assert resolve_apple_bridge_config(config, supervisor=supervisor) is config
    supervisor.endpoint.assert_not_called()


def test_no_fallback_when_the_bridge_is_unavailable():
    supervisor = stub_supervisor(
        error=AppleBridgeUnavailableError("apple_intelligence_off")
    )
    with pytest.raises(AppleBridgeUnavailableError) as error:
        resolve_apple_bridge_config(apple_config(), supervisor=supervisor)
    assert str(error.value) == "Turn on Apple Intelligence in System Settings."


def test_openai_client_reaches_the_bridge_with_the_resolved_config():
    supervisor = AppleBridgeSupervisor(
        lambda: [sys.executable, str(FAKE_BRIDGE), "ok"]
    )
    try:
        resolved = resolve_apple_bridge_config(
            apple_config(), supervisor=supervisor
        )
        client = OpenAI(
            base_url=resolved["api_url"], api_key=resolved["api_key"]
        )
        completion = client.chat.completions.create(
            model=resolved["model_type"],
            messages=[{"role": "user", "content": "Hi"}],
        )
        assert completion.choices[0].message.content == "ready"
    finally:
        supervisor.stop()


def apple_chat(sample_chat_data):
    return Chat(
        **{
            **sample_chat_data,
            "model_platform": "apple-intelligence",
            "model_type": "apple-on-device",
            "api_key": "not-required",
            "api_url": "",
        }
    )


def run_agent_model(options):
    module = sys.modules["app.agent.agent_model"]
    lock = MagicMock()
    lock.put_queue = MagicMock(return_value=None)
    with (
        patch.object(module, "ListenChatAgent"),
        patch.object(module, "ModelFactory") as factory,
        patch.object(module, "get_task_lock", return_value=lock),
        patch.object(module, "_schedule_async_task"),
    ):
        agent_model("FixtureAgent", "fixture", options, [])
    return factory.create.call_args.kwargs


def test_agent_model_builds_against_the_bridge(sample_chat_data):
    with patch.object(
        runtime_module,
        "get_apple_bridge_supervisor",
        return_value=stub_supervisor(),
    ):
        params = run_agent_model(apple_chat(sample_chat_data))
    assert params["model_platform"] == "openai-compatible-model"
    assert params["model_type"] == "apple-on-device"
    assert params["url"] == ENDPOINT.base_url
    assert params["api_key"] == ENDPOINT.token


def test_agent_model_fails_instead_of_falling_back(sample_chat_data):
    with (
        patch.object(
            runtime_module,
            "get_apple_bridge_supervisor",
            return_value=stub_supervisor(
                error=AppleBridgeUnavailableError("model_not_ready")
            ),
        ),
        pytest.raises(AppleBridgeUnavailableError),
    ):
        run_agent_model(apple_chat(sample_chat_data))


def test_other_providers_never_touch_the_bridge(sample_chat_data):
    supervisor = stub_supervisor()
    with patch.object(
        runtime_module, "get_apple_bridge_supervisor", return_value=supervisor
    ):
        params = run_agent_model(Chat(**sample_chat_data))
    supervisor.endpoint.assert_not_called()
    assert params["url"] == sample_chat_data["api_url"]


# -- routes -------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("EIGENT_RUNTIME", raising=False)
    monkeypatch.delenv("EIGENT_LOCAL_CONTROL_CAPABILITY", raising=False)
    app = FastAPI()
    app.include_router(apple_intelligence_controller.router)
    return TestClient(app)


def test_status_route_off_macos(client, monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    response = client.get("/model/apple-intelligence/status")
    assert response.status_code == 200
    assert response.json()["reason"] == "not_macos"
    assert response.json()["available"] is False


def test_status_route_refresh_resets_the_crash_limit(client):
    supervisor = MagicMock(spec=AppleBridgeSupervisor)
    supervisor.health.side_effect = AppleBridgeUnavailableError(
        "bridge_unavailable"
    )
    with patch.object(
        apple_intelligence_controller,
        "get_apple_bridge_supervisor",
        return_value=supervisor,
    ):
        response = client.get("/model/apple-intelligence/status?refresh=true")
    supervisor.reset.assert_called_once()
    assert response.json()["reason"] == "bridge_unavailable"


def test_test_route_reports_unavailable(client, monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    with patch.object(
        apple_intelligence_controller,
        "get_apple_bridge_supervisor",
        return_value=AppleBridgeSupervisor(),
    ):
        response = client.post("/model/apple-intelligence/test")
    assert response.status_code == 200
    assert response.json() == {
        "ok": False,
        "elapsed_ms": None,
        "code": "not_macos",
        "message": "Apple Intelligence is only available on macOS.",
    }
