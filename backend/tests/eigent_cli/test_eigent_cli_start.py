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
"""``eigent run``, ``send``, ``resume`` and ``brain`` against a fake Brain."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from eigent_cli import brain as background, main as cli_main
from eigent_cli.client import BrainClient, CliError, Connection
from eigent_cli.main import Context, run

TOKEN = "t" * 43
URL = "http://127.0.0.1:5151"


def _sse(name: str, data: dict[str, Any]) -> str:
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


def _event(sequence: int, event_type: str, **payload: Any) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "event_id": f"ev-{sequence}",
        "project_id": "proj-1",
        "run_id": "task-1",
        "sequence": sequence,
        "event_type": event_type,
        "payload": payload,
        "origin": "local",
    }


COMPLETED_STREAM = _sse(
    "run_event", _event(1, "user.message", content="hi")
) + _sse("run_event", _event(2, "run.completed"))


class FakeBrain:
    """Answers the start routes and just enough of the Run API to follow."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.started: list[dict[str, Any]] = []
        self.resumed: list[dict[str, Any]] = []
        self.start_status = "started"
        self.start_error: tuple[int, dict[str, Any]] | None = None
        # Answers to GET /v1/tasks/{id}, consumed in order.
        self.task_states: list[dict[str, Any]] = []
        self.run_status = "completed"
        self.streams: list[str] = [COMPLETED_STREAM]
        self.stream_cursors: list[str] = []
        self.shutdowns = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/v1/tasks" and request.method == "POST":
            if self.start_error is not None:
                status, body = self.start_error
                return httpx.Response(status, json=body)
            body = json.loads(request.content)
            self.started.append(body)
            return httpx.Response(
                202,
                json={
                    "task_id": "task-1",
                    "run_id": "task-1",
                    "project_id": body.get("project_id") or "proj-1",
                    "space_id": "local-abc",
                    "session_mode": body.get("session_mode") or "single-agent",
                    "status": self.start_status,
                    "events": "/runs/task-1/stream",
                },
            )
        if path == "/v1/tasks/task-1":
            return httpx.Response(200, json=self.task_states.pop(0))
        if path == "/v1/tasks/task-1/resume":
            self.resumed.append(json.loads(request.content))
            self.run_status = "completed"
            return httpx.Response(
                202, json={"task_id": "task-1", "status": "started"}
            )
        if path == "/v1/brain/shutdown":
            self.shutdowns += 1
            return httpx.Response(202, json={"status": "stopping"})
        if path == "/runs/task-1":
            return httpx.Response(
                200,
                json={
                    "run_id": "task-1",
                    "project_id": "proj-1",
                    "status": self.run_status,
                    "terminal_reason": "brain_restart"
                    if self.run_status == "interrupted"
                    else None,
                    "attempts": [{}],
                    "created_at": 1_700_000_000.0,
                    "updated_at": 1_700_000_100.0,
                },
            )
        if path == "/runs/task-1/events":
            return httpx.Response(
                200, json={"next_sequence": 41, "has_more": False}
            )
        if path == "/runs/task-1/interactions":
            return httpx.Response(200, json={"interactions": []})
        if path == "/runs/task-1/stream":
            self.stream_cursors.append(
                request.url.params.get("after_sequence", "")
            )
            body = self.streams.pop(0) if self.streams else ""
            return httpx.Response(
                200,
                content=body.encode(),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(404, json={"detail": f"no route {path}"})


@pytest.fixture
def brain() -> FakeBrain:
    return FakeBrain()


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(cli_main.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(background.time, "sleep", lambda _seconds: None)


def _client(brain: FakeBrain) -> BrainClient:
    return BrainClient(
        Connection(base_url=URL, token=TOKEN),
        transport=httpx.MockTransport(brain.handler),
    )


def _run(brain: FakeBrain, *args: str, as_json: bool = False) -> int:
    ctx = Context(url=None, as_json=as_json)
    ctx.client_factory = lambda: _client(brain)
    return run(list(args), obj=ctx)


# ------------------------------------------------------------------ run


def test_run_starts_a_single_agent_task_in_the_folder_and_follows_it(
    brain, tmp_path, capsys
):
    code = _run(brain, "run", "List the files", "--space", str(tmp_path))

    assert code == 0
    (body,) = brain.started
    assert body["prompt"] == "List the files"
    # Stated on every start: the app and the backend default differently.
    assert body["session_mode"] == "single-agent"
    assert Path(body["space_root_path"]) == tmp_path.resolve()
    assert "project_id" not in body and "api_key" not in body
    captured = capsys.readouterr()
    assert "Task task-1 started in Session proj-1." in captured.err
    assert "Task completed" in captured.out
    assert "Project" not in captured.out + captured.err
    assert "Brain" not in captured.out + captured.err


def test_run_exit_code_is_how_the_task_ended(brain, tmp_path):
    brain.run_status = "failed"
    brain.streams = [_sse("run_event", _event(1, "run.failed"))]

    assert _run(brain, "run", "x", "--space", str(tmp_path)) == 1


def test_run_json_prints_the_task_then_its_events_unchanged(
    brain, tmp_path, capsys
):
    code = _run(brain, "run", "hi", "--space", str(tmp_path), as_json=True)

    assert code == 0
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert lines[0]["control"] == "task_started"
    assert lines[0]["task_id"] == "task-1"
    assert lines[0]["project_id"] == "proj-1"
    assert [line.get("event_type") for line in lines[1:]] == [
        "user.message",
        "run.completed",
    ]


def test_run_detach_returns_without_following(brain, tmp_path, capsys):
    code = _run(
        brain, "run", "hi", "--space", str(tmp_path), "--detach", "--mode",
        "workforce",
    )  # fmt: skip

    assert code == 0
    assert brain.started[0]["session_mode"] == "workforce"
    assert brain.stream_cursors == []
    assert "Task task-1 started" in capsys.readouterr().err


def test_run_in_a_session_sends_no_folder_and_no_mode(brain):
    code = _run(brain, "run", "next", "--session", "proj-9")

    assert code == 0
    assert brain.started == [{"prompt": "next", "project_id": "proj-9"}]


def test_run_needs_a_folder_or_a_session(brain, tmp_path, capsys):
    assert _run(brain, "run", "hi") == 2
    assert "--space DIR" in capsys.readouterr().err
    assert (
        _run(brain, "run", "hi", "--session", "p", "--space", str(tmp_path))
        == 2
    )
    assert _run(brain, "run", "hi", "--space", str(tmp_path / "missing")) == 2
    assert _run(brain, "run", "  ", "--space", str(tmp_path)) == 2
    assert brain.started == []


def test_run_passes_model_and_attachments(brain, tmp_path):
    notes = tmp_path / "notes.txt"
    notes.write_text("x", encoding="utf-8")

    code = _run(
        brain, "run", "hi", "--space", str(tmp_path), "--model", "gpt-x",
        "--attach", str(notes), "--detach",
    )  # fmt: skip

    assert code == 0
    assert brain.started[0]["model_type"] == "gpt-x"
    assert brain.started[0]["attachments"] == [str(notes.resolve())]


def test_run_reports_a_missing_model_setting(brain, tmp_path, capsys):
    brain.start_error = (
        409,
        {
            "detail": {
                "code": "model_not_configured",
                "message": "No model is configured. Set EIGENT_MODEL_TYPE.",
            }
        },
    )

    assert _run(brain, "run", "hi", "--space", str(tmp_path)) == 1
    assert "EIGENT_MODEL_TYPE" in capsys.readouterr().err


def test_run_waits_for_a_queued_task_before_following(brain, capsys):
    brain.start_status = "queued"
    brain.task_states = [
        {"task_id": "task-1", "status": "queued", "queued": True},
        {"task_id": "task-1", "status": "running", "queued": False},
    ]

    code = _run(brain, "run", "later", "--session", "proj-1")

    assert code == 0
    assert brain.task_states == []
    captured = capsys.readouterr()
    assert "queued in Session proj-1" in captured.err
    assert "Task completed" in captured.out


def test_a_queued_task_that_cannot_start_fails_with_the_reason(brain, capsys):
    brain.start_status = "queued"
    brain.task_states = [
        {
            "task_id": "task-1",
            "status": "cancelled",
            "queued": True,
            "terminal_reason": "bad model",
        }
    ]

    assert _run(brain, "run", "later", "--session", "proj-1") == 1
    assert "did not start: bad model" in capsys.readouterr().err


# ----------------------------------------------------------------- send


def test_send_queues_or_starts_and_returns(brain, capsys):
    brain.start_status = "queued"

    code = _run(brain, "send", "proj-1", "and then?")

    assert code == 0
    assert brain.started == [{"prompt": "and then?", "project_id": "proj-1"}]
    assert brain.stream_cursors == []
    assert "It starts when the running Task ends." in capsys.readouterr().err


def test_send_follow_follows_the_new_task(brain, capsys):
    assert _run(brain, "send", "proj-1", "and then?", "--follow") == 0
    assert brain.stream_cursors == ["0"]


def test_send_explains_a_session_started_in_the_app(brain, capsys):
    brain.start_error = (
        409,
        {
            "detail": {
                "code": "session_not_started_here",
                "message": "Continue it in the app.",
            }
        },
    )

    assert _run(brain, "send", "desk-proj", "hi") == 1
    assert "Continue it in the app." in capsys.readouterr().err


# --------------------------------------------------------------- resume


def test_resume_follows_only_what_happens_next(brain, capsys):
    brain.run_status = "interrupted"

    code = _run(brain, "resume", "task-1")

    assert code == 0
    assert brain.resumed and brain.resumed[0]["request_id"].startswith(
        "cli-resume-"
    )
    # Not the timeline that was already printed before the interruption.
    assert brain.stream_cursors == ["41"]
    assert "resumed (attempt 2)" in capsys.readouterr().err


def test_follow_says_how_to_resume_and_show_hides_internal_wording(
    brain, capsys
):
    brain.run_status = "interrupted"
    brain.streams = [""]

    assert _run(brain, "follow", "task-1", "--exit-when-waiting") == 6
    assert "eigent resume task-1" in capsys.readouterr().err
    assert _run(brain, "show", "task-1") == 0
    shown = capsys.readouterr().out
    assert "Eigent stopped while the Task was running" in shown
    assert "brain" not in shown.lower()


# ---------------------------------------------------------------- brain


def _real_context(*args: str, as_json: bool = False) -> int:
    return run(list(args), obj=Context(url=None, as_json=as_json))


def test_brain_start_leaves_a_running_eigent_alone(monkeypatch, capsys):
    monkeypatch.setattr(
        background,
        "find_running",
        lambda url=None: Connection(base_url=URL, token=TOKEN),
    )
    monkeypatch.setattr(
        background,
        "start_background",
        lambda port=None: pytest.fail("must not start a second one"),
    )

    assert _real_context("brain", "start") == 0
    assert f"already running at {URL}" in capsys.readouterr().out


def test_brain_start_starts_one_when_nothing_runs(monkeypatch, capsys):
    ports: list[int | None] = []
    monkeypatch.setattr(background, "find_running", lambda url=None: None)

    def start(port: int | None = None) -> Connection:
        ports.append(port)
        return Connection(base_url=URL, token=TOKEN)

    monkeypatch.setattr(background, "start_background", start)
    monkeypatch.delenv("EIGENT_BRAIN_PORT", raising=False)

    assert _real_context("brain", "start", "--port", "5160") == 0
    assert ports == [5160]
    assert f"Eigent is running at {URL}." in capsys.readouterr().out


def test_brain_stop_asks_eigent_to_stop_and_waits(brain, monkeypatch, capsys):
    connection = Connection(base_url=URL, token=TOKEN)
    monkeypatch.setattr(
        background, "find_running", lambda url=None: connection
    )
    monkeypatch.setattr(cli_main, "BrainClient", lambda conn: _client(brain))
    answers = iter([True, False])
    monkeypatch.setattr(
        background, "is_reachable", lambda conn, timeout=3.0: next(answers)
    )
    monkeypatch.setattr(background, "published_pid", lambda: 4242)

    assert _real_context("brain", "stop") == 0
    assert brain.shutdowns == 1
    assert "Eigent stopped." in capsys.readouterr().out


def test_brain_stop_with_nothing_running_is_not_an_error(monkeypatch, capsys):
    monkeypatch.setattr(background, "find_running", lambda url=None: None)

    assert _real_context("brain", "stop") == 0
    assert "Eigent is not running." in capsys.readouterr().out


def test_brain_stop_cannot_stop_the_desktop_app(brain, monkeypatch, capsys):
    connection = Connection(base_url=URL, token=TOKEN)
    monkeypatch.setattr(
        background, "find_running", lambda url=None: connection
    )

    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={
                "detail": {
                    "code": "not_standalone",
                    "message": "Eigent is running inside the desktop app. "
                    "Quit the app to stop it.",
                }
            },
        )

    monkeypatch.setattr(
        cli_main,
        "BrainClient",
        lambda conn: BrainClient(
            connection, transport=httpx.MockTransport(refuse)
        ),
    )

    assert _real_context("brain", "stop") == 1
    assert "Quit the app to stop it." in capsys.readouterr().err


# ------------------------------------------------- starting in background


def test_run_starts_eigent_when_nothing_is_running(
    brain, monkeypatch, tmp_path, capsys
):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    monkeypatch.delenv("EIGENT_BRAIN_URL", raising=False)
    started: list[bool] = []

    def start(port: int | None = None) -> Connection:
        started.append(True)
        return Connection(base_url=URL, token=TOKEN)

    monkeypatch.setattr(background, "start_background", start)
    monkeypatch.setattr(cli_main, "BrainClient", lambda conn: _client(brain))

    assert _real_context("run", "hi", "--space", str(tmp_path)) == 0
    assert started == [True]
    assert "Starting Eigent in the background" in capsys.readouterr().err


def test_run_no_start_fails_with_exit_7(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    monkeypatch.delenv("EIGENT_BRAIN_URL", raising=False)
    monkeypatch.setattr(
        background,
        "start_background",
        lambda port=None: pytest.fail("--no-start must not start one"),
    )

    code = _real_context("run", "hi", "--space", str(tmp_path), "--no-start")

    assert code == 7
    assert "eigent brain start" in capsys.readouterr().err


class _Process:
    def __init__(self, exit_code: int | None = None) -> None:
        self.pid = 111
        self._exit_code = exit_code

    def poll(self) -> int | None:
        return self._exit_code


def _publish(home: Path, **info: Any) -> None:
    folder = home / ".eigent" / "cli"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "brain.json").write_text(json.dumps(info), encoding="utf-8")
    (folder / "token").write_text(TOKEN, encoding="utf-8")


def test_start_waits_for_the_new_eigent_not_a_stale_address(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("EIGENT_BRAIN_URL", raising=False)
    monkeypatch.delenv("EIGENT_CLI_TOKEN", raising=False)
    # Left behind by an Eigent that was killed: same port, older start.
    _publish(tmp_path, pid=1, host="127.0.0.1", port=5151, started_at=1.0)
    monkeypatch.setattr(background, "pick_port", lambda port=None: 5151)
    monkeypatch.setattr(background, "spawn", lambda port: _Process())
    checks: list[str] = []

    def reachable(connection: Connection, timeout: float = 3.0) -> bool:
        checks.append(connection.base_url)
        return True

    monkeypatch.setattr(background, "is_reachable", reachable)
    polls = {"count": 0}

    def tick(_seconds: float) -> None:
        polls["count"] += 1
        if polls["count"] == 3:
            # The child of a Windows launcher has its own process id.
            _publish(
                tmp_path,
                pid=999,
                host="127.0.0.1",
                port=5151,
                started_at=background.time.time() + 5,
            )

    monkeypatch.setattr(background.time, "sleep", tick)

    connection = background.start_background()

    assert connection == Connection(base_url=URL, token=TOKEN)
    assert polls["count"] == 3
    assert checks == [URL]


def test_start_explains_an_eigent_running_without_cli_access(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(background, "pick_port", lambda port=None: 5151)
    monkeypatch.setattr(background, "spawn", lambda port: _Process(3))
    background.log_path().parent.mkdir(parents=True)
    background.log_path().write_text(
        "RuntimeError: Another Eigent process (pid 7) is already using "
        "C:/x/run-journal.sqlite3. Stop it first.\n",
        encoding="utf-8",
    )

    with pytest.raises(CliError) as exc_info:
        background.start_background()

    assert exc_info.value.exit_code == 7
    assert "already running" in exc_info.value.message
    assert "EIGENT_CLI_ACCESS=1" in exc_info.value.message


def test_start_points_at_the_log_when_eigent_exits(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(background, "pick_port", lambda port=None: 5151)
    monkeypatch.setattr(background, "spawn", lambda port: _Process(1))

    with pytest.raises(CliError) as exc_info:
        background.start_background()

    assert "exited with code 1" in exc_info.value.message
    assert "brain.log" in exc_info.value.message


def test_default_port_avoids_the_desktop_apps_range(monkeypatch):
    monkeypatch.setattr(background, "_port_is_free", lambda port: port != 5151)

    assert background.pick_port() == 5152
    assert not set(background.DEFAULT_PORT_RANGE) & set(range(5001, 5051))
    with pytest.raises(CliError):
        background.pick_port(5151)
