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

import subprocess
import sys
import threading
import time
from queue import Queue
from types import SimpleNamespace

import pytest

import app.agent.toolkit.terminal_toolkit as module
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.service.task import process_task
from app.service.terminal_processes import (
    OUTPUT_LIMIT,
    TerminalProcessRegistry,
)


def register(registry, state, project="one", **kwargs):
    return registry.register(
        project_id=project,
        run_id="run",
        session_id="same",
        agent_name="agent",
        label="terminal",
        observe=lambda: (state[0], state[1], state[2]),
        terminate=lambda: state.__setitem__(0, False)
        or state.__setitem__(2, True)
        or "",
        **kwargs,
    )


def test_owner_scoped_stop_retains_output_and_is_idempotent():
    registry = TerminalProcessRegistry()
    one, two = [True, None, False], [True, None, False]
    a, b = register(registry, one), register(registry, two, project="two")
    registry.append(a, "http://127.0.0.1:8080/\nready")
    with pytest.raises(KeyError):
        registry.stop("two", a)
    assert one[0] and two[0]
    result = registry.stop("one", a)
    assert result["status"] == "stopped"
    assert result["output"].endswith("ready")
    assert result["url"] == "http://127.0.0.1:8080/"
    assert registry.stop("one", a)["status"] == "stopped"
    assert registry.list("two")[0]["id"] == b and two[0]


def test_silent_sources_bounded_output_versions_and_split_url():
    registry = TerminalProcessRegistry()
    a = register(registry, [True, None, False])
    first = registry.list("one")[0]
    assert first["status"] == "running" and first["output"] == ""
    registry.append(a, "x" * (OUTPUT_LIMIT + 12))
    registry.append(a, "\nhttp://local")
    registry.append(a, "host:4567/path\n")
    result = registry.list("one")[0]
    assert len(result["output"]) == OUTPUT_LIMIT and result["offset"] > 0
    assert result["url"] == "http://localhost:4567/path"
    assert "output" not in registry.list("one", {a: result["version"]})[0]


def test_failed_stop_keeps_running_and_does_not_expose_exception():
    registry = TerminalProcessRegistry()
    a = registry.register(
        project_id="one",
        run_id="r",
        session_id="s",
        agent_name="a",
        label="x",
        observe=lambda: (True, None, False),
        terminate=lambda: (_ for _ in ()).throw(ValueError("private token")),
    )
    result = registry.stop("one", a)
    assert result["status"] == "running" and result["can_stop"]
    assert "private" not in result["stop_error"]


def test_reader_streams_partial_unicode_and_keeps_task_context(
    tmp_path, monkeypatch
):
    registry = TerminalProcessRegistry()
    monkeypatch.setattr(module, "terminal_processes", registry)
    monkeypatch.setattr(
        module,
        "run_context_for_task",
        lambda _: SimpleNamespace(project_id="one", run_id="run"),
    )
    toolkit = object.__new__(TerminalToolkit)
    toolkit.api_task_id, toolkit.agent_name = "one", "agent"
    toolkit._session_lock = threading.RLock()
    toolkit._output_condition = threading.Condition(toolkit._session_lock)
    child = subprocess.Popen(
        [
            sys.executable,
            "-u",
            "-c",
            "import sys,time;sys.stdout.write('hello 世界');sys.stdout.flush();time.sleep(1.5);print(' done')",
        ],
        stdout=subprocess.PIPE,
        stdin=subprocess.PIPE,
        text=True,
    )
    session = dict(
        process=child,
        backend="local",
        running=True,
        log_file=str(tmp_path / "log"),
        output_stream=Queue(),
    )
    toolkit.shell_sessions = {"s": session}
    seen = []

    def emit(log, text):
        seen.append((process_task.get(""), text))
        registry.append(toolkit._preview_log_processes[log], text)

    monkeypatch.setattr(toolkit, "_write_to_log", emit)
    token = process_task.set("subtask-1")
    try:
        toolkit._start_output_reader_thread("s")
        deadline = time.monotonic() + 1
        while not seen and time.monotonic() < deadline:
            time.sleep(0.01)
        assert seen and seen[0] == ("subtask-1", "hello 世界")
        assert child.poll() is None
        process_id = registry.list("one")[0]["id"]
        child.wait(timeout=3)
        session["eigent_reader_thread"].join(timeout=2)
        assert registry.list("one")[0]["output"] == "hello 世界 done\n"
        # Reusing CAMEL's session id cannot give an old row control of its successor.
        toolkit.shell_sessions["s"] = dict(session, running=True)
        assert registry.stop("one", process_id)["can_stop"] is False
    finally:
        process_task.reset(token)
        if child.poll() is None:
            child.kill()
        child.wait()


def test_version_and_output_snapshot_are_atomic():
    registry = TerminalProcessRegistry()
    state = [True, None, False]
    process_id = register(registry, state)
    record = registry._records[process_id]

    def observe():
        registry.append(process_id, "late output")
        return True, None, False

    record.observe = observe
    snapshot = registry.list("one", {process_id: 0})[0]
    assert snapshot["version"] == 1
    assert snapshot["output"] == "late output"


def test_http_process_controls_require_authentication_and_matching_owner(
    monkeypatch,
):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import app.service.terminal_processes as service
    from app.auth import local_control
    from app.controller.run_controller import router

    registry = TerminalProcessRegistry()
    state = [True, None, False]
    process_id = register(registry, state)
    monkeypatch.setattr(service, "terminal_processes", registry)
    monkeypatch.setattr(
        local_control, "_process_local_control_capability", "test-capability"
    )
    app = FastAPI()
    app.include_router(router)
    headers = {"X-Eigent-Local-Capability": "test-capability"}
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        assert (
            client.get("/projects/one/terminal-processes").status_code == 401
        )
        assert (
            client.get(
                "/projects/one/terminal-processes", headers=headers
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"/projects/two/terminal-processes/{process_id}/stop",
                headers=headers,
            ).status_code
            == 404
        )
        assert state[0]
        result = client.post(
            f"/projects/one/terminal-processes/{process_id}/stop",
            headers=headers,
        )
        assert (
            result.status_code == 200 and result.json()["status"] == "stopped"
        )
