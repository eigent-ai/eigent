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

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from app.auth import cli_access
from app.auth.cli_access import (
    CLI_TOKEN_HEADER,
    brain_info_path,
    cli_token_path,
    initialize_cli_access,
    listen_address,
    shutdown_cli_access,
)
from app.auth.local_control import (
    LOCAL_CONTROL_CAPABILITY_HEADER,
    allow_cli_token,
    require_local_control_principal,
)
from app.controller import run_controller
from app.run_journal.models import HumanInteractionRecord

UVICORN_ARGV = ["uvicorn", "main:api", "--port", "5123", "--loop", "asyncio"]


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("EIGENT_BRAIN_PORT", raising=False)
    monkeypatch.delenv("EIGENT_BRAIN_HOST", raising=False)
    return tmp_path


def _enable(monkeypatch) -> str:
    monkeypatch.setenv("EIGENT_CLI_ACCESS", "1")
    assert initialize_cli_access(UVICORN_ARGV)
    return cli_token_path().read_text(encoding="utf-8").strip()


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/run-control", dependencies=[Depends(allow_cli_token)])
    async def run_control(request: Request):
        return await require_local_control_principal(request)

    @app.get("/other-control")
    async def other_control(request: Request):
        return await require_local_control_principal(request)

    return app


def test_cli_access_is_off_by_default(home, monkeypatch):
    monkeypatch.delenv("EIGENT_CLI_ACCESS", raising=False)

    assert initialize_cli_access(UVICORN_ARGV) is False
    assert cli_access.current_cli_token() is None
    assert not cli_token_path().exists()
    assert not brain_info_path().exists()


def test_enabling_cli_access_publishes_token_and_address(home, monkeypatch):
    token = _enable(monkeypatch)

    assert len(token) >= 32
    assert cli_access.current_cli_token() == token
    info = json.loads(brain_info_path().read_text(encoding="utf-8"))
    assert info["port"] == 5123
    assert info["host"] == "127.0.0.1"
    assert info["pid"] == os.getpid()
    if sys.platform != "win32":
        mode = stat.S_IMODE(cli_token_path().stat().st_mode)
        assert mode == 0o600

    # The token survives a Brain restart so a configured CLI keeps working.
    assert initialize_cli_access(UVICORN_ARGV)
    assert cli_access.current_cli_token() == token

    shutdown_cli_access()
    assert not brain_info_path().exists()
    assert cli_access.current_cli_token() is None
    assert cli_token_path().exists()


def test_shutdown_keeps_another_process_address(home, monkeypatch):
    _enable(monkeypatch)
    info = json.loads(brain_info_path().read_text(encoding="utf-8"))
    info["pid"] = os.getpid() + 1
    brain_info_path().write_text(json.dumps(info), encoding="utf-8")

    shutdown_cli_access()

    assert brain_info_path().exists()


def test_listen_address_prefers_standalone_env(monkeypatch):
    monkeypatch.setenv("EIGENT_BRAIN_PORT", "5009")
    monkeypatch.setenv("EIGENT_BRAIN_HOST", "127.0.0.1")
    assert listen_address(UVICORN_ARGV) == ("127.0.0.1", 5009)

    monkeypatch.delenv("EIGENT_BRAIN_PORT")
    monkeypatch.delenv("EIGENT_BRAIN_HOST")
    assert listen_address(["uvicorn", "--port=5010"]) == ("127.0.0.1", 5010)
    assert listen_address(["uvicorn"]) == ("127.0.0.1", None)


def test_run_routes_accept_the_cli_token_next_to_desktop(home, monkeypatch):
    token = _enable(monkeypatch)
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    client = TestClient(_app(), client=("127.0.0.1", 50000))

    response = client.get("/run-control", headers={CLI_TOKEN_HEADER: token})
    assert response.status_code == 200
    assert response.json()["kind"] == "cli"

    # The renderer still works, and no credential still fails closed.
    response = client.get(
        "/run-control", headers={LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"}
    )
    assert response.json()["kind"] == "desktop_renderer"
    assert client.get("/run-control").status_code == 401


def test_cli_token_works_on_a_standalone_brain(home, monkeypatch):
    token = _enable(monkeypatch)
    monkeypatch.delenv("EIGENT_RUNTIME", raising=False)
    client = TestClient(_app(), client=("127.0.0.1", 50000))

    response = client.get("/run-control", headers={CLI_TOKEN_HEADER: token})

    assert response.status_code == 200
    assert response.json()["kind"] == "cli"


def test_cli_token_does_not_open_other_control_routes(home, monkeypatch):
    token = _enable(monkeypatch)
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    client = TestClient(_app(), client=("127.0.0.1", 50000))

    response = client.get("/other-control", headers={CLI_TOKEN_HEADER: token})

    assert response.status_code == 401


def test_wrong_cli_token_is_refused_without_fallback(home, monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    client = TestClient(_app(), client=("127.0.0.1", 50000))

    response = client.get(
        "/run-control",
        headers={
            CLI_TOKEN_HEADER: "wrong",
            LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "cli_token_invalid"


def test_cli_token_is_refused_when_cli_access_is_off(home, monkeypatch):
    monkeypatch.delenv("EIGENT_CLI_ACCESS", raising=False)
    initialize_cli_access(UVICORN_ARGV)
    client = TestClient(_app(), client=("127.0.0.1", 50000))

    response = client.get(
        "/run-control", headers={CLI_TOKEN_HEADER: "anything"}
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "cli_access_disabled"


def test_cli_token_requires_loopback(home, monkeypatch):
    token = _enable(monkeypatch)
    client = TestClient(_app(), client=("192.168.1.20", 50000))

    response = client.get("/run-control", headers={CLI_TOKEN_HEADER: token})

    assert response.status_code == 403
    assert (
        response.json()["detail"]["code"] == "local_control_loopback_required"
    )


def test_run_router_accepts_the_cli_token(home, monkeypatch):
    token = _enable(monkeypatch)
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")
    app = FastAPI()
    app.include_router(run_controller.router)
    client = TestClient(app, client=("127.0.0.1", 50000))
    journal = MagicMock()
    journal.get_run.return_value = None

    assert client.get("/runs/missing").status_code == 401
    with patch(
        "app.controller.run_controller.get_default_run_journal",
        return_value=journal,
    ):
        response = client.get(
            "/runs/missing", headers={CLI_TOKEN_HEADER: token}
        )
    assert response.status_code == 404


def test_cli_decisions_are_recorded_as_the_cli(home, monkeypatch):
    token = _enable(monkeypatch)
    app = FastAPI()
    app.include_router(run_controller.router)
    client = TestClient(app, client=("127.0.0.1", 50000))
    interaction = HumanInteractionRecord(
        interaction_id="hi-1",
        run_id="run-1",
        attempt_id="att-1",
        interaction_type="question",
        status="requested",
        request={"agent": "agent-1", "question": "Which folder?"},
        response_schema={},
        requested_by="agent",
        version=1,
        expires_at=None,
        presented_at=None,
        resolved_at=None,
        created_at=1.0,
        updated_at=1.0,
    )
    journal = MagicMock()
    journal.get_human_interaction.return_value = interaction
    journal.list_human_interaction_decisions.return_value = []
    commit = AsyncMock(return_value=(interaction, True, None))

    with (
        patch(
            "app.controller.run_controller.get_default_run_journal",
            return_value=journal,
        ),
        patch("app.service.task.commit_and_deliver", commit),
    ):
        response = client.post(
            "/runs/run-1/interactions/hi-1/decisions",
            headers={CLI_TOKEN_HEADER: token},
            json={
                "decision_request_id": "cli-1",
                "decision": {"reply": "docs"},
                "expected_version": 1,
                # A CLI cannot claim to be Remote Control or another actor.
                "source": "remote_control",
                "actor_id": "someone-else",
            },
        )

    assert response.status_code == 200
    kwargs = commit.await_args.kwargs
    assert kwargs["source"] == "desktop"
    assert kwargs["actor_type"] == "user"
    assert kwargs["actor_id"] == "cli"
    assert kwargs["decision"] == {"reply": "docs"}
