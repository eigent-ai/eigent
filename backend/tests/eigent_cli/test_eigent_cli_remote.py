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
"""``eigent login`` and ``eigent remote`` against a fake Eigent server."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from eigent_cli import cloud, remote
from eigent_cli.client import CliError
from eigent_cli.cloud import (
    Account,
    CloudClient,
    RemoteLink,
    load_account,
    load_links,
    normalize_server_url,
    parse_link_url,
    save_link,
)
from eigent_cli.main import Context, run
from eigent_cli.remote import pending_requests

SERVER = "https://eigent.test"
LINK_URL = f"{SERVER}/remote-control/rcs_1#t=link-token-1"
LINK = RemoteLink("rcs_1", "link-token-1", "Eigent CLI", "Work")
APPROVAL = {
    "approval_id": "approval:run-1:call-1",
    "version": 2,
    "action_digest": "digest-1",
    "prompt": {"summary": "Run `ls` in the terminal"},
    "decision_scope": ["once", "run"],
}
QUESTION = {
    "interaction_id": "q-1",
    "version": 0,
    "interaction_type": "question",
    "request": {"question": "Which folder?"},
    "options": [{"option_id": "docs", "label": "Docs"}],
}


def _event(cursor: int, event_type: str, run_id: str = "run-1", **payload):
    return {
        "event_id": f"ev-{cursor}",
        "project_id": "proj-1",
        "run_id": run_id,
        "run_sequence": cursor,
        "run_version": cursor,
        "cloud_cursor": cursor,
        "event_type": event_type,
        "payload": payload,
        "legacy_step": None,
        "created_at": "2026-11-19T10:00:00Z",
        "ingested_at": "2026-11-19T10:00:01Z",
    }


def _sse(name: str, data: dict[str, Any], event_id: int | None = None) -> str:
    lines = [f"id: {event_id}"] if event_id is not None else []
    lines += [f"event: {name}", "data: " + json.dumps(data)]
    return "\n".join(lines) + "\n\n"


class FakeServer:
    """Answers the routes the CLI uses the way the Eigent server does."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.access_token = "access-1"
        self.refresh_token = "refresh-1"
        self.refreshes = 0
        self.polls: list[Any] = []
        self.approved_codes: list[str] = []
        self.desktops = [
            {"desktop_instance_id": "desk-1", "bridge_status": "online"}
        ]
        self.spaces = [{"id": "space-a", "name": "Work"}]
        self.links = [
            {
                "session_id": "rcs_1",
                "space_name": "Work",
                "bridge_status": "online",
                "expires_at": "2026-11-20T10:00:00Z",
            }
        ]
        self.info = {
            "session_id": "rcs_1",
            "title": "Eigent CLI",
            "space_name": "Work",
            "current_project_id": "proj-1",
            "current_task_id": "run-1",
            "current_brain_session_id": "rc_brain_1",
        }
        self.created: list[dict[str, Any]] = []
        self.targets: list[dict[str, Any]] = []
        self.commands: list[dict[str, Any]] = []
        self.revoked: list[str] = []
        self.events: list[dict[str, Any]] = []
        self.runs = [
            {
                "run_id": "run-1",
                "status": "running",
                "updated_at": "2026-11-19",
            }
        ]
        self.streams: list[str] = []
        self.stream_cursors: list[str] = []
        self.command_error: tuple[int, dict[str, Any]] | None = None

    # ------------------------------------------------------------ helpers

    def _authorized(self, request: httpx.Request) -> bool:
        return (
            request.headers.get("Authorization")
            == f"Bearer {self.access_token}"
        )

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path.removeprefix("/api/v1")
        body = json.loads(request.content) if request.content else {}
        if path == "/cli/auth/device":
            return httpx.Response(
                200,
                json={
                    "device_code": "egd_device",
                    "user_code": "BCDF-GHJK",
                    "verification_uri": f"{SERVER}/device",
                    "verification_uri_complete": f"{SERVER}/device?user_code=BCDF-GHJK",
                    "expires_in": 600,
                    "interval": 5,
                },
            )
        if path == "/cli/auth/device/token":
            answer = self.polls.pop(0) if self.polls else "tokens"
            if answer == "tokens":
                return httpx.Response(
                    200,
                    json={
                        "access_token": self.access_token,
                        "refresh_token": self.refresh_token,
                        "token_type": "bearer",
                        "expires_in": 604800,
                        "email": "me@example.com",
                    },
                )
            return httpx.Response(
                400, json={"detail": {"code": answer, "message": answer}}
            )
        if path == "/user/refresh":
            self.refreshes += 1
            if body.get("refresh_token") != self.refresh_token:
                return httpx.Response(
                    200, json={"code": 13, "text": "invalid"}
                )
            self.access_token = f"access-{self.refreshes + 1}"
            self.refresh_token = f"refresh-{self.refreshes + 1}"
            return httpx.Response(
                200,
                json={
                    "access_token": self.access_token,
                    "refresh_token": self.refresh_token,
                    "email": "me@example.com",
                },
            )
        if not self._authorized(request):
            if path.startswith("/remote-control/sessions/"):
                return httpx.Response(
                    401,
                    json={
                        "detail": {
                            "code": "REMOTE_LOGIN_REQUIRED",
                            "message": "Sign in",
                        }
                    },
                )
            # Account routes answer an expired token with HTTP 200.
            return httpx.Response(200, json={"code": 12, "text": "expired"})
        if path == "/cli/auth/device/approve":
            self.approved_codes.append(body["user_code"])
            return httpx.Response(
                200,
                json={
                    "status": "approved",
                    "client_name": "eigent CLI on laptop",
                },
            )
        if path == "/remote-control/sessions" and request.method == "GET":
            return httpx.Response(200, json={"items": self.links})
        if path == "/remote-control/sessions" and request.method == "POST":
            self.created.append(body)
            return httpx.Response(
                200, json={"session_id": "rcs_1", "url": LINK_URL}
            )
        if path == "/remote-control/desktops":
            return httpx.Response(200, json={"items": self.desktops})
        if path == "/spaces":
            return httpx.Response(200, json=self.spaces)
        if not path.startswith("/remote-control/sessions/rcs_1"):
            return httpx.Response(404, json={"detail": f"no route {path}"})
        if request.headers.get("X-Remote-Control-Token") != "link-token-1":
            return httpx.Response(
                403,
                json={"detail": "Remote control link is invalid or expired"},
            )
        tail = path.removeprefix("/remote-control/sessions/rcs_1")
        if tail == "" and request.method == "GET":
            return httpx.Response(200, json=self.info)
        if tail == "" and request.method == "DELETE":
            self.revoked.append("rcs_1")
            return httpx.Response(204)
        if tail == "/projects":
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "proj-1",
                            "name": "Refactor",
                            "status": "running",
                        },
                        {
                            "id": "proj-2",
                            "name": "Docs",
                            "status": "completed",
                        },
                    ]
                },
            )
        if tail == "/target":
            self.targets.append(body)
            return httpx.Response(
                200,
                json={
                    "current_project_id": body["project_id"],
                    "current_task_id": None,
                    "current_brain_session_id": "rc_brain_2",
                },
            )
        if tail == "/snapshot":
            return httpx.Response(
                200,
                json={
                    "project_id": request.url.params.get("project_id"),
                    "current_cursor": max(
                        [e["cloud_cursor"] for e in self.events] or [0]
                    ),
                    "runs": self.runs,
                    "recent_events": self.events,
                    "events_truncated": False,
                },
            )
        if tail == "/commands":
            if self.command_error is not None:
                status, error = self.command_error
                return httpx.Response(status, json=error)
            self.commands.append(body)
            return httpx.Response(
                200,
                json={
                    "command_id": f"rc_cmd_{len(self.commands)}",
                    "status": "pending",
                    "next_task_id": "run-2"
                    if body["type"] == "user_message"
                    else None,
                },
            )
        if tail == "/events/stream":
            self.stream_cursors.append(
                request.url.params.get("after_cursor", "")
            )
            text = self.streams.pop(0) if self.streams else ""
            return httpx.Response(
                200,
                content=text.encode(),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(404, json={"detail": f"no route {path}"})


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("EIGENT_SERVER_URL", raising=False)
    monkeypatch.setattr(remote.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(remote, "_attached_to_terminal", lambda: False)
    return tmp_path


@pytest.fixture
def server() -> FakeServer:
    return FakeServer()


@pytest.fixture
def signed_in(home, server):
    Account(SERVER, "access-1", "refresh-1", "me@example.com").save()
    return server


def _run(server: FakeServer, *args: str, as_json: bool = False) -> int:
    ctx = Context(url=None, as_json=as_json)
    ctx.cloud_factory = lambda: CloudClient(
        SERVER, load_account(), transport=httpx.MockTransport(server.handler)
    )
    return run(list(args), obj=ctx)


def _json_lines(capsys) -> list[dict[str, Any]]:
    return [json.loads(line) for line in capsys.readouterr().out.splitlines()]


# --------------------------------------------------------------- sign-in


def test_login_shows_the_code_waits_and_saves_the_tokens(home, server, capsys):
    server.polls = ["authorization_pending", "slow_down", "tokens"]

    assert _run(server, "login", "--no-browser") == 0

    captured = capsys.readouterr()
    assert f"open {SERVER}/device" in captured.err
    assert "BCDF-GHJK" in captured.err
    assert "Signed in as me@example.com." in captured.out
    account = load_account()
    assert account is not None
    assert (
        account.server_url,
        account.access_token,
        account.refresh_token,
    ) == (
        SERVER,
        "access-1",
        "refresh-1",
    )
    assert "access-1" not in captured.out + captured.err


def test_login_json_never_prints_tokens(home, server, capsys):
    assert _run(server, "login", "--no-browser", as_json=True) == 0

    out = capsys.readouterr().out
    lines = [json.loads(line) for line in out.splitlines()]
    assert lines[0]["control"] == "sign_in_started"
    assert lines[0]["user_code"] == "BCDF-GHJK"
    assert lines[-1] == {"control": "signed_in", "email": "me@example.com"}
    assert (
        "access-1" not in out
        and "refresh-1" not in out
        and "egd_device" not in out
    )


@pytest.mark.parametrize(
    ("answer", "message"),
    [("access_denied", "refused"), ("expired_token", "expired")],
)
def test_login_explains_a_refused_or_expired_code(
    home, server, capsys, answer, message
):
    server.polls = [answer]

    assert _run(server, "login", "--no-browser") == 7
    assert message in capsys.readouterr().err
    assert load_account() is None


def test_a_signed_in_machine_can_approve_another_one(signed_in, capsys):
    assert _run(signed_in, "login", "--approve", "bcdf ghjk") == 0

    assert signed_in.approved_codes == ["bcdf ghjk"]
    assert "eigent CLI on laptop" in capsys.readouterr().out


def test_logout_forgets_the_account_and_links_without_calling_the_server(
    signed_in, capsys
):
    save_link(LINK)

    assert _run(signed_in, "logout") == 0

    assert load_account() is None and load_links() == {}
    # Server sign-out would turn off every remote link of the account.
    assert signed_in.requests == []
    assert _run(signed_in, "remote", "list") == 7
    assert "eigent login" in capsys.readouterr().err


def test_saved_credentials_are_private_files(home):
    Account(SERVER, "a", "r").save()
    save_link(LINK)

    assert json.loads(cloud.account_path().read_text())["access_token"] == "a"
    assert cloud.account_path().parent == home / ".eigent" / "cli"
    assert not list(cloud.account_path().parent.glob("*.tmp"))


# ----------------------------------------------------------- token refresh


def test_an_expired_token_is_refreshed_once_and_the_new_pair_is_saved(
    signed_in, capsys
):
    signed_in.access_token = "access-rotated-elsewhere"

    assert _run(signed_in, "remote", "list") == 0

    assert signed_in.refreshes == 1
    account = load_account()
    assert (account.access_token, account.refresh_token) == (
        "access-2",
        "refresh-2",
    )
    assert "Desktop desk-1: online" in capsys.readouterr().out


def test_an_expired_token_on_a_link_route_is_refreshed_too(signed_in):
    save_link(LINK)
    signed_in.access_token = "access-rotated-elsewhere"

    assert _run(signed_in, "remote", "sessions") == 0
    assert signed_in.refreshes == 1


def test_a_spent_refresh_token_asks_to_sign_in_again(signed_in, capsys):
    signed_in.access_token = "x"
    signed_in.refresh_token = "y"

    assert _run(signed_in, "remote", "list") == 7
    assert "eigent login" in capsys.readouterr().err


# ---------------------------------------------------------------- links


def test_parse_link_url_and_server_address():
    assert parse_link_url(LINK_URL) == ("rcs_1", "link-token-1")
    assert parse_link_url(f"{SERVER}/remote-control/rcs_1#t=a%2Fb") == (
        "rcs_1",
        "a/b",
    )
    with pytest.raises(CliError):
        parse_link_url(f"{SERVER}/remote-control/rcs_1")
    assert normalize_server_url("https://x.test/api/v1/") == "https://x.test"
    assert normalize_server_url("https://x.test/api") == "https://x.test"
    with pytest.raises(CliError):
        normalize_server_url("x.test")


def test_connect_creates_a_link_to_the_online_desktop_and_saves_it(
    signed_in, capsys
):
    assert _run(signed_in, "remote", "connect", "--hours", "2") == 0

    assert signed_in.created == [
        {
            "desktop_instance_id": "desk-1",
            "title": "Eigent CLI",
            "expires_in_seconds": 7200,
            "space_id": "space-a",
        }
    ]
    assert load_links()["rcs_1"].link_token == "link-token-1"
    out = capsys.readouterr().out
    assert "Link rcs_1 to Space Work" in out
    assert "link-token-1" not in out


def test_connect_saves_a_link_copied_from_the_app(signed_in):
    assert _run(signed_in, "remote", "connect", LINK_URL) == 0

    assert signed_in.created == []
    assert load_links()["rcs_1"] == LINK


def test_connect_asks_which_space_or_desktop_when_there_are_several(
    signed_in, capsys
):
    signed_in.spaces.append({"id": "space-b", "name": "Home"})
    assert _run(signed_in, "remote", "connect") == 1
    assert "--space ID" in capsys.readouterr().err

    signed_in.desktops.append(
        {"desktop_instance_id": "desk-2", "bridge_status": "online"}
    )
    assert _run(signed_in, "remote", "connect", "--space", "space-a") == 1
    assert "--desktop ID" in capsys.readouterr().err

    signed_in.desktops = [
        {"desktop_instance_id": "desk-1", "bridge_status": "offline"}
    ]
    assert _run(signed_in, "remote", "connect") == 7
    assert "online" in capsys.readouterr().err
    assert signed_in.created == []


def test_list_marks_links_this_machine_can_use(signed_in, capsys):
    assert _run(signed_in, "remote", "list", as_json=True) == 0
    assert _json_lines(capsys)[0]["links"][0]["usable_here"] is False

    save_link(LINK)
    assert _run(signed_in, "remote", "list") == 0
    out = capsys.readouterr().out
    assert "rcs_1" in out and "yes" in out
    assert "Project" not in out and "Brain" not in out


def test_disconnect_turns_the_link_off_and_forgets_it(signed_in, capsys):
    save_link(LINK)

    assert _run(signed_in, "remote", "disconnect") == 0

    assert signed_in.revoked == ["rcs_1"]
    assert load_links() == {}


def test_commands_need_a_saved_link(signed_in, capsys):
    assert _run(signed_in, "remote", "follow") == 1
    assert "eigent remote connect" in capsys.readouterr().err


def test_sessions_lists_the_spaces_sessions(signed_in, capsys):
    save_link(LINK)

    assert _run(signed_in, "remote", "sessions") == 0

    out = capsys.readouterr().out
    assert "* proj-1" in out and "Refactor" in out and "proj-2" in out


# ---------------------------------------------------------------- follow


def test_pending_requests_tracks_what_is_still_open():
    events = [
        _event(1, "interaction.requested", **QUESTION),
        _event(2, "approval.requested", **APPROVAL),
        _event(3, "interaction.resolved", interaction_id="q-1"),
        _event(4, "approval.requested", **{**APPROVAL, "approval_id": "a-2"}),
        _event(5, "approval.expired", approval_id="a-2"),
    ]

    (pending,) = pending_requests(events)

    assert pending["interaction_id"] == "approval:run-1:call-1"
    assert pending["interaction_type"] == "approval"
    assert (pending["version"], pending["action_digest"]) == (2, "digest-1")
    assert pending["request"]["allowed_scopes"] == ["once", "run"]
    assert pending["run_id"] == "run-1"


def test_follow_prints_the_latest_task_and_exits_with_how_it_ended(
    signed_in, capsys
):
    save_link(LINK)
    signed_in.events = [
        _event(1, "user.message", run_id="run-0", content="older task"),
        _event(2, "run.completed", run_id="run-0"),
        _event(3, "user.message", content="List the files"),
    ]
    signed_in.streams = [
        _sse("connected", {"cursor": 3})
        + _sse(
            "canonical_event", _event(4, "assistant.final", message="Done."), 4
        )
        + _sse("canonical_event", _event(5, "run.failed", message="boom"), 5)
    ]

    assert _run(signed_in, "remote", "follow") == 1

    out = capsys.readouterr().out
    assert "You: List the files" in out and "Eigent: Done." in out
    assert "Task failed" in out
    assert "older task" not in out
    assert signed_in.stream_cursors == ["3"]


def test_follow_reconnects_from_the_last_cursor_when_the_stream_ends(
    signed_in,
):
    save_link(LINK)
    signed_in.events = [_event(1, "user.message", content="hi")]
    signed_in.streams = [
        _sse("canonical_event", _event(2, "agent.started"), 2)
        + _sse("end", {"reason": "max_duration", "cursor": 2}),
        _sse("canonical_event", _event(3, "run.completed"), 3),
    ]

    assert _run(signed_in, "remote", "follow") == 0
    assert signed_in.stream_cursors == ["1", "2"]


def test_follow_exits_3_with_the_request_when_no_one_is_attached(
    signed_in, capsys
):
    save_link(LINK)
    signed_in.events = [_event(1, "user.message", content="hi")]
    signed_in.streams = [
        _sse("canonical_event", _event(2, "approval.requested", **APPROVAL), 2)
    ]

    assert _run(signed_in, "remote", "follow", as_json=True) == 3

    lines = _json_lines(capsys)
    assert lines[-1]["control"] == "waiting_for_user"
    assert lines[-1]["interactions"][0]["action_digest"] == "digest-1"
    assert lines[-2]["event_type"] == "approval.requested"


def test_follow_exits_3_at_once_for_a_request_that_is_already_open(
    signed_in, capsys
):
    save_link(LINK)
    signed_in.events = [_event(1, "interaction.requested", **QUESTION)]

    assert _run(signed_in, "remote", "follow") == 3

    assert "Which folder?" in capsys.readouterr().err
    assert signed_in.stream_cursors == []


def test_follow_reports_a_link_that_was_turned_off(signed_in, capsys):
    save_link(LINK)
    signed_in.events = [_event(1, "user.message", content="hi")]
    signed_in.streams = [
        _sse("end", {"reason": "link_closed", "status": 410, "cursor": 1})
    ]

    assert _run(signed_in, "remote", "follow") == 7
    assert "turned off or expired" in capsys.readouterr().err


# ----------------------------------------------------------------- steer


def test_send_goes_through_the_command_route_as_the_cli(signed_in, capsys):
    save_link(LINK)

    assert _run(signed_in, "remote", "send", "Add tests") == 0

    (command,) = signed_in.commands
    assert command["source_channel"] == "cli"
    assert command["type"] == "user_message"
    assert command["payload"] == {"content": "Add tests"}
    assert command["target_project_id"] == "proj-1"
    assert command["target_brain_session_id"] == "rc_brain_1"
    assert command["client_request_id"].startswith("cli-")
    assert "Task run-2 in Session proj-1" in capsys.readouterr().err


def test_send_to_another_session_moves_the_link_there_first(signed_in):
    save_link(LINK)

    assert _run(signed_in, "remote", "send", "hi", "--session", "proj-2") == 0

    assert signed_in.targets == [{"project_id": "proj-2"}]
    assert signed_in.commands[0]["target_project_id"] == "proj-2"
    assert signed_in.commands[0]["target_brain_session_id"] == "rc_brain_2"


def test_send_follow_follows_the_new_task_from_where_the_session_was(
    signed_in, capsys
):
    save_link(LINK)
    signed_in.events = [_event(7, "run.completed")]
    signed_in.streams = [
        _sse(
            "canonical_event",
            _event(8, "user.message", run_id="run-2", content="Add tests"),
            8,
        )
        + _sse(
            "canonical_event", _event(9, "run.completed", run_id="run-2"), 9
        )
    ]

    assert _run(signed_in, "remote", "send", "Add tests", "--follow") == 0

    assert signed_in.stream_cursors == ["7"]
    assert "You: Add tests" in capsys.readouterr().out


def test_approve_sends_the_exact_request_it_decides(signed_in, capsys):
    save_link(LINK)
    signed_in.events = [_event(4, "approval.requested", **APPROVAL)]

    assert _run(signed_in, "remote", "approve", "--scope", "run") == 0

    (command,) = signed_in.commands
    assert command["type"] == "interaction_decision"
    assert command["payload"] == {
        "run_id": "run-1",
        "interaction_id": "approval:run-1:call-1",
        "expected_version": 2,
        "action_digest": "digest-1",
        "decision": {"decision": "approved", "scope": "run"},
    }
    assert "Approved" in capsys.readouterr().out


def test_deny_refuses_a_scope_that_was_not_offered(signed_in, capsys):
    save_link(LINK)
    signed_in.events = [_event(4, "approval.requested", **APPROVAL)]

    assert _run(signed_in, "remote", "deny", "--scope", "space") == 1

    assert "not offered" in capsys.readouterr().err
    assert signed_in.commands == []


def test_answer_replies_to_the_open_question(signed_in):
    save_link(LINK)
    signed_in.events = [_event(4, "interaction.requested", **QUESTION)]

    assert _run(signed_in, "remote", "answer", "the docs folder") == 0
    assert _run(signed_in, "remote", "answer", "--option", "docs") == 0

    first, second = signed_in.commands
    assert first["payload"]["decision"] == {"reply": "the docs folder"}
    assert first["payload"]["interaction_id"] == "q-1"
    assert second["payload"]["decision"] == {"option_id": "docs"}
    assert _run(signed_in, "remote", "answer") == 2


def test_approve_without_a_pending_approval_sends_nothing(signed_in, capsys):
    save_link(LINK)
    signed_in.events = [_event(4, "interaction.requested", **QUESTION)]

    assert _run(signed_in, "remote", "approve") == 1

    assert "no pending approval" in capsys.readouterr().err
    assert signed_in.commands == []


def test_stop_sends_a_stop_command(signed_in, capsys):
    save_link(LINK)

    assert _run(signed_in, "remote", "stop") == 0

    assert signed_in.commands[0]["type"] == "stop"
    assert signed_in.commands[0]["source_channel"] == "cli"


def test_an_offline_desktop_is_explained(signed_in, capsys):
    save_link(LINK)
    signed_in.command_error = (409, {"detail": {"code": "BRIDGE_OFFLINE"}})

    assert _run(signed_in, "remote", "send", "hi") == 7
    assert "desktop is offline" in capsys.readouterr().err


def test_status_shows_tasks_and_open_requests(signed_in, capsys):
    save_link(LINK)
    signed_in.events = [_event(4, "approval.requested", **APPROVAL)]

    assert _run(signed_in, "remote", "status") == 0

    out = capsys.readouterr().out
    assert "Session   proj-1" in out
    assert "run-1" in out and "Running" in out
    assert "Approval needed" in out
