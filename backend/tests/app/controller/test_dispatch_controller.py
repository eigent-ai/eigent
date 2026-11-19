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
"""``/v1/tasks``: who may call it and how refusals are reported."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.cli_access import (
    CLI_TOKEN_HEADER,
    cli_token_path,
    initialize_cli_access,
)
from app.auth.local_control import LOCAL_CONTROL_CAPABILITY_HEADER
from app.controller import dispatch_controller
from app.dispatch import lifecycle, service
from app.dispatch.service import DispatchError
from app.router import register_routers

UVICORN_ARGV = ["uvicorn", "main:api", "--port", "5123"]
STARTED = {
    "task_id": "task-1",
    "run_id": "task-1",
    "project_id": "proj-1",
    "space_id": "local-abc",
    "session_mode": "single-agent",
    "status": "started",
    "events": "/runs/task-1/stream",
}


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("EIGENT_BRAIN_PORT", raising=False)
    monkeypatch.delenv("EIGENT_BRAIN_HOST", raising=False)
    monkeypatch.delenv("EIGENT_RUNTIME", raising=False)
    return tmp_path


@pytest.fixture
def token(home, monkeypatch) -> str:
    monkeypatch.setenv("EIGENT_CLI_ACCESS", "1")
    assert initialize_cli_access(UVICORN_ARGV)
    return cli_token_path().read_text(encoding="utf-8").strip()


@pytest.fixture
def start(monkeypatch) -> AsyncMock:
    mock = AsyncMock(return_value=STARTED)
    monkeypatch.setattr(service, "start_task", mock)
    return mock


def _client(host: str = "127.0.0.1") -> TestClient:
    app = FastAPI()
    app.include_router(dispatch_controller.router)
    return TestClient(app, client=(host, 50000))


BODY = {
    "prompt": "List the files",
    "session_mode": "single-agent",
    "space_root_path": "/work",
}


def test_cli_token_starts_a_task(token, start):
    response = _client().post(
        "/v1/tasks", json=BODY, headers={CLI_TOKEN_HEADER: token}
    )

    assert response.status_code == 202
    assert response.json() == STARTED
    kwargs = start.await_args.kwargs
    assert kwargs["prompt"] == "List the files"
    assert kwargs["session_mode"] == "single-agent"
    assert kwargs["space_root_path"] == "/work"
    assert kwargs["project_id"] is None


def test_desktop_capability_starts_a_task(home, monkeypatch, start):
    monkeypatch.setenv("EIGENT_RUNTIME", "electron")
    monkeypatch.setenv("EIGENT_LOCAL_CONTROL_CAPABILITY", "secret-1")

    client = _client()

    assert client.post("/v1/tasks", json=BODY).status_code == 401
    response = client.post(
        "/v1/tasks",
        json=BODY,
        headers={LOCAL_CONTROL_CAPABILITY_HEADER: "secret-1"},
    )
    assert response.status_code == 202


def test_no_credentials_start_nothing(home, start):
    # A standalone Brain with CLI access off has no way to authenticate.
    response = _client().post("/v1/tasks", json=BODY)

    assert response.status_code == 503
    start.assert_not_awaited()


def test_wrong_or_remote_cli_token_starts_nothing(token, start):
    wrong = _client().post(
        "/v1/tasks", json=BODY, headers={CLI_TOKEN_HEADER: "x" * 43}
    )
    remote = _client("10.0.0.8").post(
        "/v1/tasks", json=BODY, headers={CLI_TOKEN_HEADER: token}
    )

    assert wrong.status_code == 401
    assert remote.status_code == 403
    start.assert_not_awaited()


def test_session_mode_has_no_silent_default(token, start):
    """Desktop defaults to single agent and Chat to workforce; the route
    passes on only what the caller stated."""

    body = {"prompt": "hi", "space_root_path": "/work"}

    response = _client().post(
        "/v1/tasks", json=body, headers={CLI_TOKEN_HEADER: token}
    )

    assert response.status_code == 202
    assert start.await_args.kwargs["session_mode"] is None
    bad = _client().post(
        "/v1/tasks",
        json={**BODY, "session_mode": "swarm"},
        headers={CLI_TOKEN_HEADER: token},
    )
    assert bad.status_code == 422


def test_the_request_carries_no_model_key(token, start):
    response = _client().post(
        "/v1/tasks",
        json={**BODY, "api_key": "sk-leak", "model_type": "gpt-x"},
        headers={CLI_TOKEN_HEADER: token},
    )

    assert response.status_code == 202
    kwargs = start.await_args.kwargs
    assert "api_key" not in kwargs
    assert kwargs["model_type"] == "gpt-x"


def test_refusals_keep_their_code(token, monkeypatch):
    monkeypatch.setattr(
        service,
        "start_task",
        AsyncMock(
            side_effect=DispatchError(
                409, "model_not_configured", "Set EIGENT_MODEL_TYPE."
            )
        ),
    )

    response = _client().post(
        "/v1/tasks", json=BODY, headers={CLI_TOKEN_HEADER: token}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "model_not_configured",
        "message": "Set EIGENT_MODEL_TYPE.",
    }


def test_blank_prompt_is_refused(token, start):
    response = _client().post(
        "/v1/tasks",
        json={**BODY, "prompt": "   "},
        headers={CLI_TOKEN_HEADER: token},
    )

    assert response.status_code == 422
    start.assert_not_awaited()


def test_status_and_resume_routes(token, monkeypatch):
    monkeypatch.setattr(
        service,
        "get_task",
        AsyncMock(return_value={"task_id": "task-1", "status": "queued"}),
    )
    resume = AsyncMock(return_value=STARTED)
    monkeypatch.setattr(service, "resume_task", resume)
    client = _client()
    headers = {CLI_TOKEN_HEADER: token}

    assert client.get("/v1/tasks/task-1", headers=headers).json() == {
        "task_id": "task-1",
        "status": "queued",
    }
    assert client.get("/v1/tasks/task-1").status_code == 503
    resumed = client.post(
        "/v1/tasks/task-1/resume",
        json={"request_id": "resume-1"},
        headers=headers,
    )
    assert resumed.status_code == 202
    assert resume.await_args.args[1] == "task-1"
    assert resume.await_args.kwargs == {"request_id": "resume-1"}
    # The body is optional.
    assert (
        client.post("/v1/tasks/task-1/resume", headers=headers).status_code
        == 202
    )


def test_only_a_standalone_brain_can_be_asked_to_stop(token, monkeypatch):
    client = _client()
    headers = {CLI_TOKEN_HEADER: token}
    monkeypatch.setattr(lifecycle, "_request_stop", None)

    refused = client.post("/v1/brain/shutdown", headers=headers)

    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "not_standalone"
    stopped: list[bool] = []
    lifecycle.register_shutdown_handler(lambda: stopped.append(True))
    try:
        assert (
            client.post("/v1/brain/shutdown", headers=headers).status_code
            == 202
        )
        assert stopped == [True]
        assert client.post("/v1/brain/shutdown").status_code == 503
    finally:
        lifecycle.register_shutdown_handler(None)


def test_the_placeholder_routes_are_gone():
    """One implementation of /v1/tasks, behind control authentication."""

    app = FastAPI()
    register_routers(app)
    owners = {
        route.endpoint.__module__
        for route in app.routes
        if getattr(route, "path", "").startswith("/v1/tasks")
    }

    assert owners == {"app.controller.dispatch_controller"}
