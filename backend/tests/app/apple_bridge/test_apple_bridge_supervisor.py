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

import platform
import sys
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from app.apple_bridge import supervisor as supervisor_module
from app.apple_bridge.platform_support import (
    BRIDGE_ENV,
    bridge_binary_path,
    is_apple_bridge_model,
    platform_unsupported_reason,
)
from app.apple_bridge.supervisor import (
    AppleBridgeSupervisor,
    AppleBridgeUnavailableError,
    apple_intelligence_status,
    default_bridge_command,
)

pytestmark = pytest.mark.unit

FAKE_BRIDGE = Path(__file__).with_name("fake_bridge.py")


def fake_command(mode: str = "ok"):
    return lambda: [sys.executable, str(FAKE_BRIDGE), mode]


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def make_supervisor():
    created: list[AppleBridgeSupervisor] = []

    def make(mode: str = "ok", **kwargs) -> AppleBridgeSupervisor:
        supervisor = AppleBridgeSupervisor(fake_command(mode), **kwargs)
        created.append(supervisor)
        return supervisor

    yield make
    for supervisor in created:
        supervisor.stop()


# -- platform gating ----------------------------------------------------------


@pytest.mark.parametrize(
    ("system", "machine", "reason"),
    [
        ("win32", "AMD64", "not_macos"),
        ("linux", "x86_64", "not_macos"),
        ("linux", "aarch64", "not_macos"),
        ("darwin", "x86_64", "not_apple_silicon"),
        ("darwin", "arm64", None),
    ],
)
def test_platform_unsupported_reason(system, machine, reason):
    assert platform_unsupported_reason(system, machine) == reason


@pytest.mark.parametrize(
    ("system", "machine", "reason"),
    [
        ("win32", "AMD64", "not_macos"),
        ("linux", "x86_64", "not_macos"),
        ("darwin", "x86_64", "not_apple_silicon"),
        ("darwin", "arm64", "bridge_missing"),
    ],
)
def test_default_command_refuses_unsupported_machines(
    monkeypatch, system, machine, reason
):
    monkeypatch.setattr(sys, "platform", system)
    monkeypatch.setattr(platform, "machine", lambda: machine)
    monkeypatch.delenv(BRIDGE_ENV, raising=False)

    with pytest.raises(AppleBridgeUnavailableError) as error:
        default_bridge_command()
    assert error.value.reason == reason


def test_bridge_binary_path_needs_an_existing_file(tmp_path):
    assert bridge_binary_path({}) is None
    assert bridge_binary_path({BRIDGE_ENV: "  "}) is None
    assert bridge_binary_path({BRIDGE_ENV: str(tmp_path / "missing")}) is None
    assert bridge_binary_path({BRIDGE_ENV: str(tmp_path)}) is None


def test_bridge_binary_path_accepts_an_executable(tmp_path):
    binary = tmp_path / "eigent-apple-bridge"
    binary.write_text("")
    binary.chmod(0o755)
    assert bridge_binary_path({BRIDGE_ENV: str(binary)}) == binary


@pytest.mark.parametrize("system", ["win32", "linux"])
def test_status_off_macos_starts_nothing(monkeypatch, system):
    monkeypatch.setattr(sys, "platform", system)
    with patch.object(supervisor_module.subprocess, "Popen") as popen:
        status = apple_intelligence_status(AppleBridgeSupervisor())
    popen.assert_not_called()
    assert status["available"] is False
    assert status["reason"] == "not_macos"
    assert status["models"] == []


def test_status_on_an_intel_mac_reports_the_reason(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(platform, "machine", lambda: "x86_64")
    with patch.object(supervisor_module.subprocess, "Popen") as popen:
        status = apple_intelligence_status(AppleBridgeSupervisor())
    popen.assert_not_called()
    assert status["reason"] == "not_apple_silicon"
    assert (
        status["message"]
        == "Apple Intelligence needs a Mac with Apple silicon."
    )


def test_status_never_raises():
    supervisor = AppleBridgeSupervisor()
    with patch.object(supervisor, "health", side_effect=RuntimeError("boom")):
        status = apple_intelligence_status(supervisor)
    assert status["available"] is False
    assert status["reason"] == "bridge_unavailable"


@pytest.mark.parametrize(
    ("model_type", "api_url", "expected"),
    [
        ("apple-on-device", "", True),
        ("apple-on-device", None, True),
        ("apple-on-device", "http://localhost:1234/v1", False),
        ("llama3", "", False),
        (None, "", False),
    ],
)
def test_is_apple_bridge_model(model_type, api_url, expected):
    assert is_apple_bridge_model(model_type, api_url) is expected


# -- lifecycle with a fake bridge process -------------------------------------


def test_starts_on_demand_and_reuses_the_bridge(make_supervisor):
    supervisor = make_supervisor()
    first = supervisor.endpoint()
    second = supervisor.endpoint()

    assert first == second
    assert first.base_url.startswith("http://127.0.0.1:")
    assert first.base_url.endswith("/v1")
    assert len(first.token) >= 32


def test_the_token_is_required(make_supervisor):
    endpoint = make_supervisor().endpoint()
    response = httpx.get(f"{endpoint.base_url}/health", trust_env=False)
    assert response.status_code == 401


def test_status_when_ready(make_supervisor):
    status = apple_intelligence_status(make_supervisor())
    assert status == {
        "provider": "apple-intelligence",
        "available": True,
        "reason": None,
        "message": None,
        "models": [
            {
                "id": "apple-on-device",
                "available": True,
                "reason": None,
                "context_size": 4096,
                "capabilities": ["text"],
            }
        ],
    }


@pytest.mark.parametrize(
    ("reason", "message"),
    [
        (
            "apple_intelligence_off",
            "Turn on Apple Intelligence in System Settings.",
        ),
        (
            "model_not_ready",
            "The Apple Intelligence model is still downloading.",
        ),
        ("not_eligible", "This Mac doesn't support Apple Intelligence."),
        (
            "unsupported_os",
            "Apple Intelligence in Eigent requires macOS 26 or later.",
        ),
    ],
)
def test_status_reports_why_the_model_is_unavailable(
    make_supervisor, reason, message
):
    status = apple_intelligence_status(make_supervisor(reason))
    assert status["available"] is False
    assert status["reason"] == reason
    assert status["message"] == message


def test_test_generation(make_supervisor):
    result = make_supervisor().test_generation()
    assert result["ok"] is True
    assert isinstance(result["elapsed_ms"], int)


def test_test_generation_reports_the_bridge_error(make_supervisor):
    result = make_supervisor("apple_intelligence_off").test_generation()
    assert result["ok"] is False
    assert result["code"] == "apple_intelligence_off"


def test_restarts_after_an_idle_exit_without_counting_a_crash(make_supervisor):
    supervisor = make_supervisor("idle-exit")
    first = supervisor.endpoint()
    supervisor._process.wait(timeout=10)  # noqa: SLF001

    second = supervisor.endpoint()
    assert second.token != first.token
    assert not supervisor._crashes  # noqa: SLF001


def test_gives_up_after_repeated_crashes_until_reset(make_supervisor):
    clock = FakeClock()
    supervisor = make_supervisor("crash", clock=clock)

    for _ in range(3):
        with pytest.raises(AppleBridgeUnavailableError) as error:
            supervisor.endpoint()
        assert error.value.reason == "bridge_unavailable"
        clock.now += 30  # past the restart backoff

    with patch.object(supervisor_module.subprocess, "Popen") as popen:
        with pytest.raises(AppleBridgeUnavailableError):
            supervisor.endpoint()
    popen.assert_not_called()

    supervisor.reset()
    with pytest.raises(AppleBridgeUnavailableError):
        supervisor.endpoint()  # tries again, and crashes again


def test_backs_off_right_after_a_crash(make_supervisor):
    clock = FakeClock()
    supervisor = make_supervisor("crash", clock=clock)
    with pytest.raises(AppleBridgeUnavailableError):
        supervisor.endpoint()

    with patch.object(supervisor_module.subprocess, "Popen") as popen:
        with pytest.raises(AppleBridgeUnavailableError) as error:
            supervisor.endpoint()
    popen.assert_not_called()
    assert "restarting" in str(error.value)


def test_a_bridge_that_never_reports_a_port_is_stopped(make_supervisor):
    supervisor = make_supervisor("silent", start_timeout=1.0)
    with patch.object(
        supervisor_module, "_terminate", wraps=supervisor_module._terminate
    ) as terminate:
        with pytest.raises(AppleBridgeUnavailableError):
            supervisor.endpoint()
    terminate.assert_called_once()


def test_stop_ends_the_bridge(make_supervisor):
    supervisor = make_supervisor()
    supervisor.endpoint()
    process = supervisor._process  # noqa: SLF001
    supervisor.stop()
    assert process.wait(timeout=10) is not None
