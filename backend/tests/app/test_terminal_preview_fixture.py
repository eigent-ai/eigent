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

"""Exercise the smoke HTTP boundary without models, commands or app state."""

import atexit
import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

PRIVATE_DETAIL = (
    "Traceback: /private/fixture/internal.py:634 token=synthetic-secret"
)


@pytest.fixture
def smoke(monkeypatch):
    modules = {}
    for name in (
        "app",
        "app.controller",
        "app.controller.run_controller",
        "app.agent",
        "app.agent.toolkit",
        "app.agent.toolkit.terminal_toolkit",
        "app.run_context",
        "uvicorn",
    ):
        module = ModuleType(name)
        module.__path__ = []
        modules[name] = module
        monkeypatch.setitem(sys.modules, name, module)
        if "." in name:
            parent, attr = name.rsplit(".", 1)
            setattr(modules[parent], attr, module)

    execute = Mock(return_value="Command started")

    class Toolkit:
        def __init__(self, *_args, **_kwargs):
            self._shell_exec_with_workspace_checkpoint = execute

        def cleanup(self, **_kwargs):
            pass

    modules["app.controller.run_controller"].router = APIRouter()
    modules["app.agent.toolkit.terminal_toolkit"].TerminalToolkit = Toolkit
    modules["app.run_context"].RunContext = SimpleNamespace
    modules["uvicorn"].run = Mock()
    for key in (
        "EIGENT_RUN_JOURNAL_PATH",
        "EIGENT_LOCAL_CONTROL_CAPABILITY",
        "EIGENT_RUNTIME",
    ):
        monkeypatch.setenv(key, "fixture-only")
    monkeypatch.setattr(sys, "path", list(sys.path))
    path = (
        Path(__file__).resolve().parents[3]
        / "test/electron/terminal-preview/backend.py"
    )
    spec = importlib.util.spec_from_file_location(
        "terminal_preview_smoke", path
    )
    fixture = importlib.util.module_from_spec(spec)
    with monkeypatch.context() as imports:
        imports.setattr(atexit, "register", lambda callback: callback)
        spec.loader.exec_module(fixture)
    try:
        with TestClient(fixture.app, raise_server_exceptions=False) as client:
            yield SimpleNamespace(
                module=fixture, client=client, execute=execute
            )
    finally:
        fixture.cleanup()


@pytest.mark.parametrize("kind", ["server", "stream", "silent", "failure"])
def test_start_acknowledges_dispatch_without_returning_tool_output(
    smoke, kind
):
    smoke.execute.return_value = PRIVATE_DETAIL
    response = smoke.client.post(f"/smoke/start/{kind}")
    assert PRIVATE_DETAIL not in response.text
    assert response.status_code == 200
    assert response.json() == {"accepted": True}
    assert smoke.execute.call_args.kwargs == {
        "id": kind,
        "block": kind == "stream",
    }


def test_start_exception_is_generic_over_http_and_logged_on_server(
    smoke, caplog
):
    smoke.execute.side_effect = RuntimeError(PRIVATE_DETAIL)
    response = smoke.client.post("/smoke/start/silent")
    assert response.status_code == 500
    assert response.json() == {"error": "Could not start fixture"}
    assert "synthetic-secret" not in response.text
    assert "/private/fixture" not in response.text
    assert any(record.exc_info for record in caplog.records)


@pytest.mark.parametrize("fails", [False, True])
def test_start_restores_both_contexts_after_dispatch(smoke, fails):
    current, checkpoint = smoke.module.current, smoke.module.checkpoint
    original_run, original_checkpoint = object(), object()
    run_token = current.set(original_run)
    cp_token = checkpoint.set(original_checkpoint)

    def execute(*_args, **_kwargs):
        assert current.get().project_id == "terminal-smoke"
        assert checkpoint.get().tool_call_id == "smoke-stream"
        if fails:
            raise RuntimeError(PRIVATE_DETAIL)
        return "Finished normally"

    smoke.execute.side_effect = execute
    try:
        result = smoke.module.start("stream")
        assert current.get() is original_run
        assert checkpoint.get() is original_checkpoint
        if fails:
            assert result.status_code == 500
        else:
            assert result == {"accepted": True}
    finally:
        current.reset(run_token)
        checkpoint.reset(cp_token)


def test_unknown_fixture_does_not_dispatch(smoke):
    response = smoke.client.post("/smoke/start/unknown")
    assert response.json() == {"error": "unknown fixture"}
    smoke.execute.assert_not_called()
