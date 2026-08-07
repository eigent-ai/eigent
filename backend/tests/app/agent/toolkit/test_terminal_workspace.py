from __future__ import annotations

import threading
from pathlib import Path
from types import SimpleNamespace

from camel.toolkits.terminal_toolkit import (
    TerminalToolkit as BaseTerminalToolkit,
)

from app.agent.toolkit import terminal_toolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.run_context import RunContext, run_context_scope
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
        return f"{id}:{command}:{block}:{timeout}"

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
        return "Process continues in background"

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
