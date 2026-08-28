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

import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from camel.toolkits.terminal_toolkit import (
    TerminalToolkit as BaseTerminalToolkit,
)

from app.agent.toolkit import terminal_toolkit
from app.agent.toolkit.terminal_toolkit import (
    TerminalToolkit,
    _original_isolated_local_command,
)
from app.run_context import RunContext, run_context_scope
from app.run_journal import OutboxLeaseLostError
from app.run_runtime.tool_checkpoint import ToolInvocationNotDispatchedError
from app.utils.listen import toolkit_listen


def _context(root: Path) -> RunContext:
    return RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="task-1",
        email="user@example.com",
        user_id="user-1",
        working_directory=root,
        task_output_root=root,
        camel_log_dir=root / ".logs",
        binding_source="test",
        workdir_mode="direct-write",
        browser_port=9222,
    )


def test_terminal_materializes_run_workspace_before_process_spawn(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "user"
    run_root = tmp_path / "run"
    user_root.mkdir()
    run_root.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    toolkit.agent_name = "developer_agent"
    toolkit.working_dir = str(user_root)
    prepared = SimpleNamespace(
        workspace=SimpleNamespace(run_worktree=run_root),
        agent_workspace=SimpleNamespace(agent_worktree=run_root),
        context=SimpleNamespace(run_id="run-1"),
    )
    calls: list[str] = []

    class _MutationService:
        def prepare_broad_write(self, **_kwargs):
            calls.append("prepare")
            return prepared

        def complete_broad_write(self, value, **_kwargs):
            assert value is prepared
            calls.append("complete")

    def fake_shell_exec(self, *, id, command, block, timeout):
        calls.append("spawn")
        assert self.working_dir == str(run_root)
        original = _original_isolated_local_command(command) or command
        return f"{id}:{original}:{block}:{timeout}"

    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(BaseTerminalToolkit, "shell_exec", fake_shell_exec)
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )

    with run_context_scope(_context(user_root)):
        result = toolkit.shell_exec(
            command="touch generated.txt",
            id="terminal-1",
        )

    assert calls == ["prepare", "spawn", "complete"]
    assert result == "terminal-1:touch generated.txt:True:20.0"


def test_terminal_serializes_parallel_workspace_mutations(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "user"
    run_root = tmp_path / "run"
    user_root.mkdir()
    run_root.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    toolkit.agent_name = "developer_agent"
    toolkit.working_dir = str(user_root)
    toolkit._terminal_mutation_lock = threading.RLock()
    first_spawned = threading.Event()
    release_first = threading.Event()
    second_prepared = threading.Event()
    calls: list[str] = []
    results: list[str] = []

    class _MutationService:
        def prepare_broad_write(self, **_kwargs):
            name = threading.current_thread().name
            calls.append(f"prepare:{name}")
            if name == "second":
                second_prepared.set()
            return SimpleNamespace(
                mutation_root=run_root,
                context=SimpleNamespace(run_id="run-1"),
            )

        def complete_broad_write(self, _prepared, **_kwargs):
            calls.append(f"complete:{threading.current_thread().name}")

    mutation_service = _MutationService()

    def fake_shell_exec(self, *, id, command, block, timeout):
        name = threading.current_thread().name
        calls.append(f"spawn:{name}")
        if name == "first":
            first_spawned.set()
            assert release_first.wait(1)
        return _original_isolated_local_command(command) or command

    def run(command: str) -> None:
        with run_context_scope(_context(user_root)):
            results.append(toolkit.shell_exec(command=command, id=command))

    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_mutation_service",
        lambda: mutation_service,
    )
    monkeypatch.setattr(BaseTerminalToolkit, "shell_exec", fake_shell_exec)
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )

    first = threading.Thread(target=run, args=("first",), name="first")
    second = threading.Thread(target=run, args=("second",), name="second")
    first.start()
    assert first_spawned.wait(1)
    second.start()
    assert not second_prepared.wait(0.05)
    release_first.set()
    first.join(1)
    second.join(1)

    assert not first.is_alive()
    assert not second.is_alive()
    assert results == ["first", "second"]
    assert calls == [
        "prepare:first",
        "spawn:first",
        "complete:first",
        "prepare:second",
        "spawn:second",
        "complete:second",
    ]


def test_terminal_remaps_visible_space_absolute_paths_to_agent_checkout(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "visible-space"
    run_root = tmp_path / "agent-checkout"
    user_root.mkdir()
    run_root.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    toolkit.agent_name = "developer_agent"
    toolkit.working_dir = str(user_root)
    prepared = SimpleNamespace(
        mutation_root=run_root,
        workspace=SimpleNamespace(run_worktree=run_root),
        agent_workspace=SimpleNamespace(agent_worktree=run_root),
        context=SimpleNamespace(run_id="run-1"),
    )
    spawned_commands: list[str] = []

    class _MutationService:
        def prepare_broad_write(self, **_kwargs):
            return prepared

        def complete_broad_write(self, value, **_kwargs):
            assert value is prepared

    def fake_shell_exec(self, *, id, command, block, timeout):
        original = _original_isolated_local_command(command) or command
        spawned_commands.append(original)
        return "done"

    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(BaseTerminalToolkit, "shell_exec", fake_shell_exec)
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )

    visible_target = user_root / "output" / "result.txt"
    checkout_target = run_root / "output" / "result.txt"
    with run_context_scope(_context(user_root)):
        result = toolkit.shell_exec(
            command=f"mkdir -p '{visible_target.parent}' && touch '{visible_target}'",
            id="terminal-absolute-path",
        )

    assert result == "done"
    assert spawned_commands == [
        f"mkdir -p '{checkout_target.parent}' && touch '{checkout_target}'"
    ]
    assert str(user_root) not in spawned_commands[0]


def test_terminal_does_not_remap_a_similarly_prefixed_directory(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "space"
    other_root = tmp_path / "space-copy"
    run_root = tmp_path / "agent-checkout"
    user_root.mkdir()
    other_root.mkdir()
    run_root.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    toolkit.agent_name = "developer_agent"
    toolkit.working_dir = str(user_root)
    prepared = SimpleNamespace(
        mutation_root=run_root,
        workspace=SimpleNamespace(run_worktree=run_root),
        agent_workspace=SimpleNamespace(agent_worktree=run_root),
        context=SimpleNamespace(run_id="run-1"),
    )
    spawned_commands: list[str] = []

    class _MutationService:
        def prepare_broad_write(self, **_kwargs):
            return prepared

        def complete_broad_write(self, value, **_kwargs):
            assert value is prepared

    def fake_shell_exec(self, *, id, command, block, timeout):
        spawned_commands.append(
            _original_isolated_local_command(command) or command
        )
        return "done"

    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(BaseTerminalToolkit, "shell_exec", fake_shell_exec)
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )

    with run_context_scope(_context(user_root)):
        toolkit.shell_exec(
            command=f"ls '{other_root}'",
            id="terminal-similar-prefix",
        )

    assert spawned_commands == [f"ls '{other_root}'"]


def test_background_terminal_checkpoints_after_session_stops(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "user"
    run_root = tmp_path / "run"
    user_root.mkdir()
    run_root.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    toolkit.agent_name = "developer_agent"
    toolkit.working_dir = str(user_root)
    toolkit.shell_sessions = {"terminal-bg": {"running": False}}
    prepared = SimpleNamespace(
        workspace=SimpleNamespace(run_worktree=run_root),
        agent_workspace=SimpleNamespace(agent_worktree=run_root),
        context=SimpleNamespace(run_id="run-1"),
    )
    checkpointed = threading.Event()
    calls: list[str] = []

    class _Lifecycle:
        def finalize_run(self, run_id):
            assert run_id == "run-1"
            calls.append("finalize")
            checkpointed.set()

    class _MutationService:
        def prepare_broad_write(self, **_kwargs):
            calls.append("prepare")
            return prepared

        def complete_broad_write(self, value, **_kwargs):
            assert value is prepared
            calls.append("complete")

    def fake_shell_exec(self, *, id, command, block, timeout):
        calls.append("spawn")
        return f"Session '{id}' started."

    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_git_lifecycle",
        lambda: _Lifecycle(),
    )
    monkeypatch.setattr(BaseTerminalToolkit, "shell_exec", fake_shell_exec)
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )

    with run_context_scope(_context(user_root)):
        toolkit.shell_exec(
            command="long-running-command",
            id="terminal-bg",
            block=False,
        )

    assert checkpointed.wait(2)
    assert calls == ["prepare", "spawn", "complete", "finalize"]


def test_terminal_workspace_admission_failure_is_marked_before_dispatch(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "user"
    user_root.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    toolkit.agent_name = "developer_agent"
    toolkit.working_dir = str(user_root)
    spawn_called = False

    class _MutationService:
        def prepare_broad_write(self, **_kwargs):
            raise OutboxLeaseLostError("Agent workspace is leased")

    def fake_shell_exec(self, *, id, command, block, timeout):
        nonlocal spawn_called
        spawn_called = True
        return "unexpected"

    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(BaseTerminalToolkit, "shell_exec", fake_shell_exec)
    monkeypatch.setattr(
        terminal_toolkit,
        "_WORKSPACE_LEASE_WAIT_MAX_SECONDS",
        0.0,
    )
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )

    with run_context_scope(_context(user_root)):
        with pytest.raises(
            ToolInvocationNotDispatchedError,
            match="was not started.*workspace is leased",
        ):
            toolkit.shell_exec(
                command="which python3",
                id="terminal-after-background",
            )

    assert spawn_called is False


def test_terminal_workspace_waits_for_adjacent_lease_then_spawns(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "user"
    run_root = tmp_path / "run"
    user_root.mkdir()
    run_root.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    toolkit.agent_name = "developer_agent"
    toolkit.working_dir = str(user_root)
    toolkit.shell_sessions = {}
    prepared = SimpleNamespace(
        workspace=SimpleNamespace(run_worktree=run_root),
        agent_workspace=SimpleNamespace(agent_worktree=run_root),
        context=SimpleNamespace(run_id="run-1"),
    )
    calls: list[str] = []

    class _MutationService:
        attempts = 0

        def prepare_broad_write(self, **_kwargs):
            self.attempts += 1
            calls.append(f"prepare:{self.attempts}")
            if self.attempts == 1:
                raise OutboxLeaseLostError("workspace is leased")
            return prepared

        def complete_broad_write(self, value, **_kwargs):
            assert value is prepared
            calls.append("complete")

    def fake_shell_exec(self, *, id, command, block, timeout):
        calls.append("spawn")
        return "done"

    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(BaseTerminalToolkit, "shell_exec", fake_shell_exec)
    monkeypatch.setattr(
        terminal_toolkit,
        "_WORKSPACE_LEASE_RETRY_INTERVAL_SECONDS",
        0.0,
    )
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )

    with run_context_scope(_context(user_root)):
        result = toolkit.shell_exec(
            command="which python3",
            id="terminal-after-background",
        )

    assert result == "done"
    assert calls == ["prepare:1", "prepare:2", "spawn", "complete"]


def test_background_terminal_renews_lease_until_session_stops(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "user"
    run_root = tmp_path / "run"
    user_root.mkdir()
    run_root.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    toolkit.agent_name = "developer_agent"
    toolkit.working_dir = str(user_root)
    toolkit.shell_sessions = {}
    prepared = SimpleNamespace(
        workspace=SimpleNamespace(run_worktree=run_root),
        agent_workspace=SimpleNamespace(agent_worktree=run_root),
        context=SimpleNamespace(run_id="run-1"),
    )
    checkpointed = threading.Event()
    running = iter((True, True, False))
    calls: list[str] = []

    class _Lifecycle:
        def finalize_run(self, run_id):
            assert run_id == "run-1"
            calls.append("finalize")
            checkpointed.set()

    class _MutationService:
        workforce = SimpleNamespace(lease_seconds=0.001)

        def prepare_broad_write(self, **_kwargs):
            calls.append("prepare")
            return prepared

        def renew_broad_write(self, value):
            assert value is prepared
            calls.append("renew")

        def complete_broad_write(self, value, **_kwargs):
            assert value is prepared
            calls.append("complete")

    def fake_shell_exec(self, *, id, command, block, timeout):
        calls.append("spawn")
        return f"Session '{id}' started."

    monkeypatch.setattr(
        toolkit,
        "_workspace_session_running",
        lambda _session_id: next(running),
    )
    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_git_lifecycle",
        lambda: _Lifecycle(),
    )
    monkeypatch.setattr(BaseTerminalToolkit, "shell_exec", fake_shell_exec)
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )

    with run_context_scope(_context(user_root)):
        toolkit.shell_exec(
            command="long-running-command",
            id="terminal-bg",
            block=False,
        )

    assert checkpointed.wait(2)
    assert calls == [
        "prepare",
        "spawn",
        "renew",
        "complete",
        "finalize",
    ]


def test_run_completion_stops_background_session_before_checkpoint(
    tmp_path,
    monkeypatch,
):
    run_root = tmp_path / "run"
    run_root.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.agent_name = "developer_agent"
    toolkit._session_lock = threading.RLock()
    toolkit.shell_sessions = {"preview-server": {"running": True}}
    prepared = SimpleNamespace(
        agent_workspace=SimpleNamespace(agent_worktree=run_root),
        context=SimpleNamespace(run_id="run-1"),
    )
    checkpointed = threading.Event()
    calls: list[str] = []

    class _Lifecycle:
        def finalize_run(self, run_id):
            assert run_id == "run-1"
            calls.append("finalize")

    class _MutationService:
        workforce = SimpleNamespace(lease_seconds=300.0)

        def complete_broad_write(self, value, **_kwargs):
            assert value is prepared
            calls.append("complete")
            checkpointed.set()

        def renew_broad_write(self, _value):
            calls.append("renew")

    def kill_process(session_id):
        assert session_id == "preview-server"
        with toolkit._session_lock:
            toolkit.shell_sessions[session_id]["running"] = False
        calls.append("kill")
        return "stopped"

    monkeypatch.setattr(toolkit, "_kill_registered_process", kill_process)
    monkeypatch.setattr(
        terminal_toolkit,
        "get_default_workspace_git_lifecycle",
        lambda: _Lifecycle(),
    )

    toolkit._watch_background_workspace_mutation(
        session_id="preview-server",
        mutation_service=_MutationService(),
        prepared=prepared,
        operation_request_id="terminal-preview",
    )

    assert toolkit.quiesce_run_background_sessions("run-1") == ()
    assert checkpointed.is_set()
    assert calls == ["kill", "complete", "finalize"]
