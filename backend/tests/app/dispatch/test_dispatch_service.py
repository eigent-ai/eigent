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
"""Brain-owned Task start: what the Brain resolves, queues and dispatches."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.dispatch import service
from app.dispatch.service import (
    DispatchError,
    FollowUpDispatcher,
    get_task,
    resume_task,
    start_task,
)
from app.dispatch.sessions import (
    DispatchSession,
    is_safe_id,
    load_session,
    save_session,
    sessions_dir,
)
from app.dispatch.settings import (
    LOCAL_OWNER_EMAIL,
    ModelNotConfiguredError,
    resolve_dispatch_model,
    space_id_for_folder,
)
from app.model.chat import Chat
from app.run_journal.runtime import run_journal_scope
from app.run_journal.store import SQLiteRunJournal
from app.utils.workspace_paths import sanitize_identity

MODEL_ENV = {
    "EIGENT_MODEL_PLATFORM": "openai",
    "EIGENT_MODEL_TYPE": "gpt-test",
    "EIGENT_MODEL_API_KEY": "sk-test",
}


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    for name in (*MODEL_ENV, "EIGENT_MODEL_API_URL"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


@pytest.fixture
def model(monkeypatch):
    for name, value in MODEL_ENV.items():
        monkeypatch.setenv(name, value)


@pytest.fixture
def journal(home):
    with SQLiteRunJournal(home / "journal.sqlite3") as opened:
        with run_journal_scope(opened):
            yield opened


@pytest.fixture
def admitted(monkeypatch):
    """Record admissions instead of running the Brain's /chat admission."""

    chats: list[Chat] = []

    async def fake_admit(chat: Chat, request) -> None:
        chats.append(chat)

    monkeypatch.setattr(service, "_admit", fake_admit)
    return chats


@pytest.fixture
def space(home):
    folder = home / "work"
    folder.mkdir()
    return folder


def _request():
    return SimpleNamespace(state=SimpleNamespace(), headers={})


def _run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------- settings


def test_model_comes_from_brain_settings(home, model, monkeypatch):
    resolved = resolve_dispatch_model()

    assert resolved.model_platform == "openai"
    assert resolved.model_type == "gpt-test"
    assert resolved.api_key == "sk-test"
    assert resolved.api_url is None
    # A request may only pick another model name on the same key.
    assert resolve_dispatch_model("gpt-other").model_type == "gpt-other"
    assert resolve_dispatch_model("gpt-other").api_key == "sk-test"


def test_missing_model_settings_are_named(home):
    with pytest.raises(ModelNotConfiguredError) as exc_info:
        resolve_dispatch_model()

    assert exc_info.value.missing == [
        "EIGENT_MODEL_PLATFORM",
        "EIGENT_MODEL_TYPE",
        "EIGENT_MODEL_API_KEY",
    ]
    assert "~/.eigent/.env" in str(exc_info.value)


def test_a_local_endpoint_needs_no_key(home, monkeypatch):
    monkeypatch.setenv("EIGENT_MODEL_PLATFORM", "ollama")
    monkeypatch.setenv("EIGENT_MODEL_TYPE", "llama3")
    monkeypatch.setenv("EIGENT_MODEL_API_URL", "http://127.0.0.1:11434/v1")

    resolved = resolve_dispatch_model()

    assert resolved.api_url == "http://127.0.0.1:11434/v1"
    assert resolved.api_key  # the model client refuses an empty key


def test_a_folder_is_always_the_same_space(tmp_path):
    first = space_id_for_folder(tmp_path)

    assert first == space_id_for_folder(Path(str(tmp_path)))
    assert first != space_id_for_folder(tmp_path / "other")
    assert first.startswith("local-")
    # Space ids are file names in the workspace store.
    assert sanitize_identity(first) == first and is_safe_id(first)


def test_session_records_round_trip_and_refuse_unsafe_ids(home):
    saved = save_session(
        DispatchSession(
            project_id="proj-1",
            space_id="local-abc",
            space_root_path="/work",
            session_mode="single-agent",
            email=LOCAL_OWNER_EMAIL,
        )
    )

    assert saved.created_at > 0
    assert load_session("proj-1") == saved
    assert load_session("missing") is None
    assert load_session("../proj-1") is None
    assert not is_safe_id("a/b") and not is_safe_id("..") and is_safe_id("a.b")
    with pytest.raises(ValueError):
        save_session(
            DispatchSession(
                project_id="../escape",
                space_id="s",
                space_root_path="/work",
                session_mode="single-agent",
                email=LOCAL_OWNER_EMAIL,
            )
        )
    assert not (sessions_dir().parent / "escape.json").exists()


# ----------------------------------------------------------- start_task


def test_new_session_resolves_everything_the_renderer_would_send(
    journal, model, admitted, space
):
    result = _run(
        start_task(
            _request(),
            prompt="List the files",
            space_root_path=str(space),
            session_mode="single-agent",
        )
    )

    assert result["status"] == "started"
    assert result["task_id"] == result["run_id"]
    assert result["events"] == f"/runs/{result['run_id']}/stream"
    (chat,) = admitted
    assert chat.question == "List the files"
    assert chat.run_id == chat.task_id == result["task_id"]
    assert chat.project_id == result["project_id"]
    assert chat.space_id == space_id_for_folder(space.resolve())
    assert Path(chat.space_root_path) == space.resolve()
    assert chat.session_mode == "single-agent"
    assert chat.email == LOCAL_OWNER_EMAIL and chat.user_id is None
    assert (chat.model_platform, chat.model_type) == ("openai", "gpt-test")
    assert chat.api_key == "sk-test"
    assert chat.allow_local_system is True
    session = load_session(result["project_id"])
    assert session is not None and session.session_mode == "single-agent"
    # The record keeps no credentials.
    assert "sk-test" not in (
        sessions_dir() / f"{session.project_id}.json"
    ).read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("kwargs", "code"),
    [
        ({"session_mode": "single-agent"}, "space_folder_required"),
        ({"space_root_path": "<space>"}, "session_mode_required"),
        (
            {"space_root_path": "<missing>", "session_mode": "workforce"},
            "space_folder_not_found",
        ),
        (
            {"space_root_path": "<home>", "session_mode": "workforce"},
            "space_folder_is_home",
        ),
    ],
)
def test_new_session_refusals(journal, model, admitted, space, kwargs, code):
    folders = {
        "<space>": str(space),
        "<missing>": str(space / "nope"),
        "<home>": str(Path.home()),
    }
    Path.home().mkdir(parents=True, exist_ok=True)
    if "space_root_path" in kwargs:
        kwargs = {
            **kwargs,
            "space_root_path": folders[kwargs["space_root_path"]],
        }

    with pytest.raises(DispatchError) as exc_info:
        _run(start_task(_request(), prompt="hi", **kwargs))

    assert exc_info.value.code == code
    assert exc_info.value.status_code == 422
    assert admitted == []


def test_no_model_is_a_refusal_that_says_what_to_set(journal, admitted, space):
    with pytest.raises(DispatchError) as exc_info:
        _run(
            start_task(
                _request(),
                prompt="hi",
                space_root_path=str(space),
                session_mode="single-agent",
            )
        )

    assert exc_info.value.code == "model_not_configured"
    assert exc_info.value.status_code == 409
    assert "EIGENT_MODEL_API_KEY" in exc_info.value.message
    assert admitted == []
    assert not sessions_dir().exists() or not list(sessions_dir().iterdir())


def test_a_session_started_elsewhere_cannot_be_continued(
    journal, model, admitted
):
    with pytest.raises(DispatchError) as exc_info:
        _run(start_task(_request(), prompt="hi", project_id="desktop-proj"))

    assert exc_info.value.code == "session_not_started_here"
    assert admitted == []


def _started_session(space, **overrides) -> DispatchSession:
    fields = {
        "project_id": "proj-1",
        "space_id": space_id_for_folder(space.resolve()),
        "space_root_path": str(space.resolve()),
        "session_mode": "single-agent",
        "email": LOCAL_OWNER_EMAIL,
        **overrides,
    }
    return save_session(DispatchSession(**fields))


def test_existing_session_keeps_its_mode_folder_and_model(
    journal, model, admitted, space
):
    _started_session(space, model_type="gpt-pinned")

    result = _run(start_task(_request(), prompt="next", project_id="proj-1"))

    assert result["status"] == "started"
    assert result["session_mode"] == "single-agent"
    (chat,) = admitted
    assert chat.project_id == "proj-1"
    assert chat.model_type == "gpt-pinned"
    assert Path(chat.space_root_path) == space.resolve()
    with pytest.raises(DispatchError) as mode:
        _run(
            start_task(
                _request(),
                prompt="next",
                project_id="proj-1",
                session_mode="workforce",
            )
        )
    assert mode.value.code == "session_mode_mismatch"
    with pytest.raises(DispatchError) as other_model:
        _run(
            start_task(
                _request(),
                prompt="next",
                project_id="proj-1",
                model_type="gpt-other",
            )
        )
    assert other_model.value.code == "session_model_mismatch"


def test_a_busy_session_queues_the_task_durably(
    journal, model, monkeypatch, space
):
    _started_session(space)

    async def busy(chat: Chat, request) -> None:
        raise service._SessionBusy()

    monkeypatch.setattr(service, "_admit", busy)

    result = _run(
        start_task(
            _request(),
            prompt="after this one",
            project_id="proj-1",
            request_id="task-2",
        )
    )

    assert result["status"] == "queued"
    assert result["task_id"] == "task-2"
    (row,) = journal.list_follow_up_requests(project_id="proj-1")
    assert (row.request_id, row.content, row.status) == (
        "task-2",
        "after this one",
        "pending",
    )
    assert row.source == "local"
    status = _run(get_task("task-2"))
    assert status["queued"] is True and status["status"] == "queued"


def test_a_running_task_queues_without_trying_admission(
    journal, model, admitted, monkeypatch, space
):
    _started_session(space)
    monkeypatch.setattr(
        journal,
        "get_active_project_run",
        lambda project_id: SimpleNamespace(run_id="task-1"),
    )

    result = _run(start_task(_request(), prompt="later", project_id="proj-1"))

    assert result["status"] == "queued"
    assert admitted == []


def test_a_new_session_that_was_refused_leaves_no_record(
    journal, model, monkeypatch, space
):
    async def refuse(chat: Chat, request) -> None:
        raise DispatchError(422, "unsupported_thinking_effort", "no")

    monkeypatch.setattr(service, "_admit", refuse)

    with pytest.raises(DispatchError):
        _run(
            start_task(
                _request(),
                prompt="hi",
                space_root_path=str(space),
                session_mode="single-agent",
            )
        )

    assert list(sessions_dir().iterdir()) == []


def test_request_id_must_be_usable_as_a_task_id(journal, model, admitted):
    with pytest.raises(DispatchError) as exc_info:
        _run(
            start_task(
                _request(),
                prompt="hi",
                project_id="proj-1",
                request_id="../../etc",
            )
        )

    assert exc_info.value.code == "invalid_request_id"


def test_unknown_task_is_404(journal):
    with pytest.raises(DispatchError) as exc_info:
        _run(get_task("nope"))

    assert exc_info.value.status_code == 404


# --------------------------------------------------------------- resume


def test_resume_reuses_the_task_and_its_first_prompt(
    journal, model, admitted, space
):
    _started_session(space)
    journal.ensure_run(
        run_id="task-1", project_id="proj-1", status="interrupted"
    )

    result = _run(resume_task(_request(), "task-1"))

    assert result["status"] == "started" and result["task_id"] == "task-1"
    (chat,) = admitted
    assert chat.run_id == "task-1"
    assert chat.resume_request_id and chat.resume_request_id.startswith(
        "resume-"
    )


def test_only_an_interrupted_task_can_be_resumed(
    journal, model, admitted, space
):
    _started_session(space)
    journal.ensure_run(run_id="task-1", project_id="proj-1", status="running")

    with pytest.raises(DispatchError) as exc_info:
        _run(resume_task(_request(), "task-1"))

    assert exc_info.value.code == "task_not_interrupted"
    assert admitted == []


# ----------------------------------------------------------- dispatcher


def _queue(journal, request_id: str, project_id: str, content: str) -> None:
    journal.put_follow_up_request(
        request_id=request_id,
        project_id=project_id,
        content=content,
        source="local",
    )


def test_dispatcher_admits_the_next_queued_task_of_its_own_sessions(
    journal, model, admitted, monkeypatch, space
):
    _started_session(space)
    _queue(journal, "task-2", "proj-1", "second")
    _queue(journal, "task-3", "proj-1", "third")
    # A Session the renderer owns: never dispatched from here.
    _queue(journal, "desk-2", "desktop-proj", "theirs")
    monkeypatch.setattr(service, "internal_request", _request)

    work_left = _run(FollowUpDispatcher().run_once())

    assert work_left is True
    assert [(chat.run_id, chat.question) for chat in admitted] == [
        ("task-2", "second")
    ]
    assert admitted[0].session_mode == "single-agent"


def test_dispatcher_waits_while_the_session_has_a_running_task(
    journal, model, admitted, monkeypatch, space
):
    _started_session(space)
    _queue(journal, "task-2", "proj-1", "second")
    monkeypatch.setattr(
        journal,
        "get_active_project_run",
        lambda project_id: SimpleNamespace(run_id="task-1"),
    )

    assert _run(FollowUpDispatcher().run_once()) is True
    assert admitted == []
    assert journal.get_follow_up_request("task-2").status == "pending"


def test_dispatcher_closes_a_queued_task_that_cannot_start(
    journal, model, monkeypatch, space
):
    _started_session(space)
    _queue(journal, "task-2", "proj-1", "second")
    monkeypatch.setattr(service, "internal_request", _request)

    async def refuse(chat: Chat, request) -> None:
        raise DispatchError(422, "invalid_model_capability", "bad model")

    monkeypatch.setattr(service, "_admit", refuse)

    _run(FollowUpDispatcher().run_once())

    row = journal.get_follow_up_request("task-2")
    assert row.status == "cancelled" and row.last_error == "bad model"
    status = _run(get_task("task-2"))
    assert status["status"] == "cancelled"
    assert status["terminal_reason"] == "bad model"


def test_dispatcher_keeps_a_task_queued_when_the_session_turns_busy(
    journal, model, monkeypatch, space
):
    _started_session(space)
    _queue(journal, "task-2", "proj-1", "second")
    monkeypatch.setattr(service, "internal_request", _request)

    async def busy(chat: Chat, request) -> None:
        raise service._SessionBusy()

    monkeypatch.setattr(service, "_admit", busy)

    _run(FollowUpDispatcher().run_once())

    assert journal.get_follow_up_request("task-2").status == "pending"


def test_dispatcher_has_nothing_to_wait_for_when_idle(journal, model):
    assert _run(FollowUpDispatcher().run_once()) is False


def test_dispatcher_loop_starts_awake_and_stops_cleanly(
    journal, model, admitted, monkeypatch, space
):
    _started_session(space)
    _queue(journal, "task-2", "proj-1", "queued before restart")
    monkeypatch.setattr(service, "internal_request", _request)

    async def scenario() -> None:
        dispatcher = FollowUpDispatcher(interval_seconds=0.01)
        dispatcher.start()
        for _ in range(200):
            if admitted:
                break
            await asyncio.sleep(0.01)
        await dispatcher.stop()

    _run(scenario())

    assert [chat.run_id for chat in admitted][:1] == ["task-2"]


# ------------------------------------------------------------- detaching


def test_detach_unsubscribes_a_stream_that_never_started():
    closed: list[str] = []

    async def stream():
        try:
            yield "first"
            yield "second"
        finally:
            closed.append("closed")

    _run(service._detach(stream()))

    assert closed == ["closed"]


def test_detach_does_not_wait_for_a_silent_stream(monkeypatch):
    closed: list[str] = []
    monkeypatch.setattr(service, "_FIRST_EVENT_WAIT_SECONDS", 0.01)

    async def stream():
        try:
            await asyncio.sleep(60)
            yield "never"
        finally:
            closed.append("closed")

    _run(service._detach(stream()))

    assert closed == ["closed"]
