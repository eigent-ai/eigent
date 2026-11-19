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
"""The ``eigent`` CLI against a fake Brain."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from eigent_cli import main as cli_main
from eigent_cli.client import (
    CLI_TOKEN_HEADER,
    BrainClient,
    CliError,
    Connection,
    parse_sse,
    resolve_connection,
)
from eigent_cli.main import Context, run
from eigent_cli.render import render_event

TOKEN = "t" * 43


def _sse(name: str, data: dict[str, Any], event_id: int | None = None) -> str:
    lines = [f"id: {event_id}"] if event_id is not None else []
    lines += [f"event: {name}", "data: " + json.dumps(data)]
    return "\n".join(lines) + "\n\n"


def _event(sequence: int, event_type: str, **payload: Any) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "event_id": f"ev-{sequence}",
        "project_id": "proj-1",
        "run_id": "run-1",
        "sequence": sequence,
        "run_sequence": sequence,
        "event_type": event_type,
        "legacy_step": None,
        "payload": payload,
        "origin": "local",
    }


class FakeBrain:
    """Routes requests the way the Brain's Run API answers them."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.run_status = "running"
        self.interactions: list[dict[str, Any]] = []
        self.streams: list[str] = []
        self.decisions: list[dict[str, Any]] = []
        self.cancels: list[dict[str, Any]] = []
        self.error: tuple[int, dict[str, Any]] | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.error is not None:
            status, body = self.error
            return httpx.Response(status, json=body)
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/runs/attention":
            return httpx.Response(
                200, json=[{"project_id": "proj-1", "state": "waiting"}]
            )
        if path == "/runs":
            return httpx.Response(
                200,
                json={
                    "project_id": "proj-1",
                    "runs": [
                        {
                            "run_id": "run-1",
                            "project_id": "proj-1",
                            "status": self.run_status,
                            "updated_at": 1_700_000_000.0,
                        }
                    ],
                },
            )
        if path == "/runs/run-1":
            return httpx.Response(
                200,
                json={
                    "run_id": "run-1",
                    "project_id": "proj-1",
                    "status": self.run_status,
                    "attempts": [{}],
                    "created_at": 1_700_000_000.0,
                    "updated_at": 1_700_000_100.0,
                },
            )
        if path == "/runs/run-1/interactions":
            return httpx.Response(
                200,
                json={"run_id": "run-1", "interactions": self.interactions},
            )
        if path == "/runs/run-1/stream":
            body = self.streams.pop(0) if self.streams else ""
            return httpx.Response(
                200,
                content=body.encode(),
                headers={"content-type": "text/event-stream"},
            )
        if path.startswith("/runs/run-1/interactions/"):
            body = json.loads(request.content)
            self.decisions.append({"path": path, **body})
            return httpx.Response(200, json={"status": "resolved"})
        if path == "/runs/run-1/cancel":
            self.cancels.append(json.loads(request.content))
            self.run_status = "cancelled"
            return httpx.Response(200, json={"status": "cancelled"})
        return httpx.Response(404, json={"detail": f"no route {path}"})


@pytest.fixture
def brain() -> FakeBrain:
    return FakeBrain()


def _run(
    brain: FakeBrain, *args: str, as_json: bool = False
) -> tuple[int, Context]:
    ctx = Context(url=None, as_json=as_json)
    ctx.client_factory = lambda: BrainClient(
        Connection(base_url="http://127.0.0.1:5001", token=TOKEN),
        transport=httpx.MockTransport(brain.handler),
    )
    return run(list(args), obj=ctx), ctx


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(cli_main.time, "sleep", lambda _seconds: None)


# ------------------------------------------------------------ connection


def test_connection_reads_what_the_brain_published(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("EIGENT_BRAIN_URL", raising=False)
    monkeypatch.delenv("EIGENT_CLI_TOKEN", raising=False)
    cli_dir = tmp_path / ".eigent" / "cli"
    cli_dir.mkdir(parents=True)
    (cli_dir / "brain.json").write_text(
        json.dumps({"host": "127.0.0.1", "port": 5007}), encoding="utf-8"
    )
    (cli_dir / "token").write_text(TOKEN + "\n", encoding="utf-8")

    connection = resolve_connection()

    assert connection.base_url == "http://127.0.0.1:5007"
    assert connection.token == TOKEN


def test_connection_explains_how_to_turn_cli_access_on(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("EIGENT_BRAIN_URL", raising=False)

    with pytest.raises(CliError) as exc_info:
        resolve_connection()

    assert exc_info.value.exit_code == 7
    assert "EIGENT_CLI_ACCESS=1" in exc_info.value.message


def test_requests_identify_the_cli(brain):
    code, _ = _run(brain, "status")

    assert code == 0
    request = brain.requests[0]
    assert request.headers[CLI_TOKEN_HEADER] == TOKEN
    assert request.headers["X-Channel"] == "cli"


def test_refused_cli_access_exits_7_with_a_hint(brain, capsys):
    brain.error = (
        403,
        {"detail": {"code": "cli_access_disabled", "message": "off"}},
    )

    code, _ = _run(brain, "status")

    assert code == 7
    assert "EIGENT_CLI_ACCESS=1" in capsys.readouterr().err


def test_unreachable_brain_exits_7(capsys):
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    ctx = Context(url=None, as_json=False)
    ctx.client_factory = lambda: BrainClient(
        Connection(base_url="http://127.0.0.1:5001", token=TOKEN),
        transport=httpx.MockTransport(refuse),
    )

    assert run(["status"], obj=ctx) == 7
    assert "Cannot reach Eigent" in capsys.readouterr().err


# -------------------------------------------------------------- listing


def test_status_lists_sessions_waiting_for_you(brain, capsys):
    code, _ = _run(brain, "status")

    assert code == 0
    out = capsys.readouterr().out
    assert "ok" in out
    assert "Session proj-1: waiting for you" in out


def test_tasks_lists_active_tasks_across_sessions(brain, capsys):
    brain.run_status = "waiting_for_user"

    code, _ = _run(brain, "tasks")

    assert code == 0
    assert "run-1" in capsys.readouterr().out
    runs_request = next(r for r in brain.requests if r.url.path == "/runs")
    assert runs_request.url.params.get_list("status") == [
        "pending",
        "running",
        "waiting_for_user",
    ]


def test_show_prints_pending_requests(brain, capsys):
    brain.run_status = "waiting_for_user"
    brain.interactions = [
        {
            "interaction_id": "hi-1",
            "interaction_type": "question",
            "version": 1,
            "request": {"question": "Which folder?"},
            "options": [],
        }
    ]

    code, _ = _run(brain, "show", "run-1")

    assert code == 0
    out = capsys.readouterr().out
    assert "Waiting for you" in out
    assert "Question [hi-1]: Which folder?" in out


# --------------------------------------------------------------- follow


def test_follow_prints_the_timeline_and_exits_with_the_outcome(brain, capsys):
    brain.streams = [
        _sse("run_event", _event(1, "user.message", content="Hi"), 1)
        + _sse("replay_caught_up", {"run_id": "run-1", "after_sequence": 1})
        + _sse("heartbeat", {"run_id": "run-1"})
        + _sse(
            "run_event",
            _event(
                2,
                "tool.completed",
                display_title="Read files",
                display_summary="2 files",
            ),
            2,
        )
        + _sse("run_event", _event(3, "assistant.final", message="Done."), 3)
    ]

    def finish(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/runs/run-1/stream":
            brain.run_status = "completed"
        return brain.handler(request)

    ctx = Context(url=None, as_json=False)
    ctx.client_factory = lambda: BrainClient(
        Connection(base_url="http://127.0.0.1:5001", token=TOKEN),
        transport=httpx.MockTransport(finish),
    )
    brain.streams[0] += _sse(
        "run_event", _event(4, "run.completed", terminal_reason="completed"), 4
    )

    code = run(["follow", "run-1", "--keep-waiting"], obj=ctx)

    assert code == 0
    out = capsys.readouterr().out
    assert "You: Hi" in out
    assert "Read files — 2 files" in out
    assert "Eigent: Done." in out
    assert "Task completed" in out


def test_follow_reconnects_from_the_last_sequence(brain, capsys):
    brain.streams = [
        _sse("run_event", _event(1, "user.message", content="Hi"), 1)
        + _sse(
            "run_event", _event(2, "plan.updated", display_title="Plan"), 2
        ),
        _sse("run_event", _event(3, "run.failed", message="boom"), 3),
    ]
    original = brain.handler

    def fail_on_second_stream(request: httpx.Request) -> httpx.Response:
        streams = [r for r in brain.requests if r.url.path.endswith("stream")]
        if request.url.path.endswith("stream") and len(streams) == 1:
            brain.run_status = "failed"
        return original(request)

    ctx = Context(url=None, as_json=False)
    ctx.client_factory = lambda: BrainClient(
        Connection(base_url="http://127.0.0.1:5001", token=TOKEN),
        transport=httpx.MockTransport(fail_on_second_stream),
    )

    code = run(["follow", "run-1", "--keep-waiting"], obj=ctx)

    assert code == 1
    stream_requests = [
        r for r in brain.requests if r.url.path == "/runs/run-1/stream"
    ]
    assert len(stream_requests) == 2
    assert stream_requests[1].url.params["after_sequence"] == "2"
    assert stream_requests[1].headers["Last-Event-ID"] == "2"
    assert "Task failed" in capsys.readouterr().out


def test_follow_exits_3_when_a_task_waits_and_no_one_is_attached(
    brain, capsys
):
    brain.run_status = "waiting_for_user"
    brain.interactions = [
        {
            "interaction_id": "ap-1",
            "interaction_type": "approval",
            "version": 2,
            "action_digest": "d" * 64,
            "request": {
                "prompt": "Run rm -rf build",
                "allowed_scopes": ["once"],
            },
            "options": [],
        }
    ]
    brain.streams = [
        _sse(
            "run_event",
            _event(1, "approval.requested", approval_id="ap-1", prompt="x"),
            1,
        )
    ]

    code, _ = _run(brain, "follow", "run-1", "--exit-when-waiting")

    assert code == 3
    err = capsys.readouterr().err
    assert "Approval needed [ap-1]: Run rm -rf build" in err


def test_follow_json_prints_events_unchanged(brain, capsys):
    brain.run_status = "cancelled"
    event = _event(1, "run.cancelled", reason="user_cancelled")
    brain.streams = [
        _sse("run_event", event, 1)
        + _sse("replay_caught_up", {"run_id": "run-1", "after_sequence": 1})
    ]

    code, _ = _run(brain, "follow", "run-1", as_json=True)

    assert code == 4
    lines = [
        json.loads(line)
        for line in capsys.readouterr().out.splitlines()
        if line
    ]
    assert lines[0] == event


def test_follow_reports_an_interrupted_task(brain):
    brain.run_status = "interrupted"
    brain.streams = [
        _sse("run_event", _event(1, "user.message", content="Hi"), 1)
        + _sse("runtime_detached", {"run_id": "run-1"})
    ]

    code, _ = _run(brain, "follow", "run-1", "--keep-waiting")

    assert code == 6


# ------------------------------------------------------- answer / approve


def test_answer_sends_the_reply_for_the_pending_question(brain, capsys):
    brain.interactions = [
        {
            "interaction_id": "hi-1",
            "interaction_type": "question",
            "version": 3,
            "request": {"question": "Which folder?"},
        }
    ]

    code, _ = _run(brain, "answer", "run-1", "docs")

    assert code == 0
    decision = brain.decisions[0]
    assert decision["path"] == "/runs/run-1/interactions/hi-1/decisions"
    assert decision["decision"] == {"reply": "docs"}
    assert decision["expected_version"] == 3
    assert decision["decision_request_id"].startswith("cli-")
    assert "Answer sent." in capsys.readouterr().out


def test_answer_asks_which_question_when_there_are_several(brain, capsys):
    brain.interactions = [
        {"interaction_id": "hi-1", "interaction_type": "question"},
        {"interaction_id": "hi-2", "interaction_type": "question"},
    ]

    code, _ = _run(brain, "answer", "run-1", "docs")

    assert code == 1
    assert "--interaction" in capsys.readouterr().err
    assert brain.decisions == []


def test_approve_sends_the_digest_and_scope(brain):
    brain.interactions = [
        {
            "interaction_id": "ap-1",
            "interaction_type": "approval",
            "version": 2,
            "action_digest": "d" * 64,
            "request": {"allowed_scopes": ["once", "run"]},
        }
    ]

    code, _ = _run(brain, "approve", "run-1", "--scope", "run")

    assert code == 0
    decision = brain.decisions[0]
    assert decision["decision"] == {"decision": "approved", "scope": "run"}
    assert decision["action_digest"] == "d" * 64
    assert decision["expected_version"] == 2


def test_deny_refuses_a_scope_that_was_not_offered(brain, capsys):
    brain.interactions = [
        {
            "interaction_id": "ap-1",
            "interaction_type": "approval",
            "version": 2,
            "action_digest": "d" * 64,
            "request": {"allowed_scopes": ["once"]},
        }
    ]

    code, _ = _run(brain, "deny", "run-1", "--scope", "space")

    assert code == 1
    assert "not offered" in capsys.readouterr().err
    assert brain.decisions == []


def test_approve_without_a_pending_approval_fails(brain, capsys):
    code, _ = _run(brain, "approve", "run-1")

    assert code == 1
    assert "no pending approval" in capsys.readouterr().err


# ----------------------------------------------------------------- stop


def test_stop_cancels_a_running_task(brain, capsys):
    code, _ = _run(brain, "stop", "run-1")

    assert code == 0
    assert brain.cancels[0]["reason"] == "explicit_cancel"
    assert brain.cancels[0]["request_id"].startswith("cli-cancel-")
    assert "Task stopped." in capsys.readouterr().out


def test_stop_leaves_a_finished_task_alone(brain, capsys):
    brain.run_status = "completed"

    code, _ = _run(brain, "stop", "run-1")

    assert code == 0
    assert brain.cancels == []
    assert "already completed" in capsys.readouterr().out


# ----------------------------------------------------------- formatting


def test_parse_sse_handles_split_frames():
    lines = iter(
        [
            "id: 1",
            "event: run_event",
            'data: {"sequence": 1}',
            "",
            ": comment",
            "event: heartbeat",
            'data: {"run_id": "r"}',
            "",
        ]
    )

    assert list(parse_sse(lines)) == [
        ("run_event", {"sequence": 1}),
        ("heartbeat", {"run_id": "r"}),
    ]


def test_render_hides_bookkeeping_unless_verbose():
    event = _event(5, "model.invocation.completed", status="ok")

    assert render_event(event) is None
    assert (
        render_event(event, verbose=True)
        == "    5 [model.invocation.completed]"
    )


def test_usage_errors_exit_2(brain):
    code, _ = _run(brain, "answer", "run-1")

    assert code == 2
