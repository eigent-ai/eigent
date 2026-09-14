"""Isolated real Git/process regressions; no model, service or user workspace."""

import asyncio
import os
import shlex
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from unittest.mock import Mock

import pytest

from app.agent.toolkit import terminal_toolkit as terminal_module
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.run_context import RunContext, run_context_scope
from app.run_journal import SQLiteRunJournal
from app.run_runtime import tool_checkpoint
from app.run_runtime.coordinator import RunCoordinator
from app.run_runtime.tool_checkpoint import (
    BackgroundToolResult,
    ToolInvocationNotDispatchedError,
    UnsafeToolOutcomeError,
    finish_tool_checkpoint,
    prepare_tool_checkpoint,
    tool_checkpoint_scope,
)
from app.utils.listen import toolkit_listen
from app.workspace_git import (
    ContentRepositoryService,
    GitBackend,
    WorkspaceGitCoordinator,
    WorkspaceGitLifecycle,
    WorkspaceMutationService,
)
from app.workspace_git.content import RepositoryStateChangedError


@pytest.fixture
def owned_workspace(tmp_path, monkeypatch):
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    space = tmp_path / "space"
    space.mkdir()
    backend = GitBackend(hooks_path=tmp_path / "hooks")
    state = tmp_path / "state"
    content = ContentRepositoryService(
        journal, state_root=state, git_backend=backend
    )
    coordinator = WorkspaceGitCoordinator(
        journal, state_root=state, git_backend=backend
    )
    mutation = WorkspaceMutationService(
        journal, state_root=state, coordinator=coordinator
    )
    lifecycle = WorkspaceGitLifecycle(
        journal, state_root=state, coordinator=coordinator
    )
    content.bootstrap(space_id="space-1", space_root=space, allow_init=True)
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    coordinator.admit_run(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="run-1",
        session_mode="single-agent",
    )
    context = RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="run-1",
        email="test@example.com",
        user_id="test",
        working_directory=space,
        task_output_root=space,
        camel_log_dir=tmp_path / "logs",
        binding_source="test",
        workdir_mode="direct-write",
        browser_port=0,
        session_mode="single-agent",
    )
    monkeypatch.setattr(
        TerminalToolkit, "_setup_cloned_environment", lambda self: None
    )
    monkeypatch.setattr(TerminalToolkit, "_get_venv_path", lambda self: None)
    monkeypatch.setattr(
        terminal_module,
        "get_default_workspace_mutation_service",
        lambda: mutation,
    )
    monkeypatch.setattr(
        terminal_module,
        "get_default_workspace_git_lifecycle",
        lambda: lifecycle,
    )
    monkeypatch.setattr(
        "app.workspace_git.get_default_workspace_git_lifecycle",
        lambda: lifecycle,
    )
    monkeypatch.setattr(tool_checkpoint, "_notify_cloud_sync", lambda: None)
    monkeypatch.setattr(toolkit_listen, "get_task_lock", lambda _: object())
    monkeypatch.setattr(toolkit_listen, "_safe_put_queue", lambda *_: None)
    toolkits = []

    def toolkit(actor="agent-1"):
        value = TerminalToolkit(
            "project-1",
            agent_name=actor,
            working_directory=str(space),
            session_logs_dir=str(tmp_path / actor / "logs"),
            safe_mode=False,
        )
        toolkits.append(value)
        return value

    yield journal, mutation, backend, context, toolkit, toolkits
    for value in toolkits:
        value.cleanup(remove_venv=False)
    journal.close()


def python_command(source):
    return f"{shlex.quote(sys.executable)} -c {shlex.quote(source)}"


def wait_for(predicate, timeout=5):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            pytest.fail("Timed out waiting for isolated process")
        time.sleep(0.01)


@pytest.mark.skipif(os.name == "nt", reason="POSIX process fixture")
@pytest.mark.parametrize("same_actor", [True, False])
@pytest.mark.parametrize("second_path", ["download.bin", "references.json"])
def test_continuous_background_writer_serializes_next_command(
    owned_workspace, same_actor, second_path
):
    journal, mutation, backend, context, make_toolkit, _ = owned_workspace
    first = make_toolkit()
    second = first if same_actor else make_toolkit("agent-2")
    with run_context_scope(context):
        checkpoint = prepare_tool_checkpoint(
            raw_tool_call_id="bg",
            tool_name="shell_exec",
            arguments={"block": False},
            journal=journal,
        )
        with tool_checkpoint_scope(checkpoint):
            result = first.shell_exec(
                python_command(
                    "import time; from pathlib import Path; p=Path('download.bin'); [(p.write_text(str(i)), time.sleep(.03)) for i in range(20)]"
                ),
                id="bg",
                block=False,
            )
        assert isinstance(result, BackgroundToolResult)
        finish_tool_checkpoint(checkpoint, result=result, journal=journal)
        assert journal.list_tool_calls("run-1")[0].status == "dispatched"
        second.shell_exec(
            python_command(
                f"from pathlib import Path; Path({second_path!r}).write_text('second')"
            ),
            id="fg",
            block=True,
        )
    wait_for(lambda: journal.list_tool_calls("run-1")[0].status == "completed")
    assert (context.working_directory / second_path).read_text() == "second"
    assert backend.is_worktree_clean(context.working_directory)
    assert not journal.list_git_mutation_intents(
        statuses=("prepared", "needs_attention")
    )
    assert all(
        item.item_state == "checkpointed"
        for change in journal.list_git_change_sets()
        for item in journal.list_git_change_set_items(change.change_set_id)
    )


@pytest.mark.skipif(os.name == "nt", reason="POSIX process fixture")
@pytest.mark.parametrize("outcome", ["failed", "cancelled", "warm_cancel"])
def test_terminal_teardown_stops_group_reader_and_settles_once(
    owned_workspace, monkeypatch, outcome
):
    journal, mutation, backend, context, make_toolkit, toolkits = (
        owned_workspace
    )
    toolkit = make_toolkit()
    with run_context_scope(context):
        checkpoint = prepare_tool_checkpoint(
            raw_tool_call_id="bg",
            tool_name="shell_exec",
            arguments={"block": False},
            journal=journal,
        )
        with tool_checkpoint_scope(checkpoint):
            result = toolkit.shell_exec(
                python_command(
                    "import time; from pathlib import Path; p=Path('growing.txt'); [(p.write_text(str(i)), print(i, flush=True), time.sleep(.03)) for i in range(1000)]"
                )
                + " & wait",
                id="bg",
                block=False,
            )
        finish_tool_checkpoint(checkpoint, result=result, journal=journal)
    wait_for(lambda: (context.working_directory / "growing.txt").exists())
    task_lock = type("Lock", (), {"registered_toolkits": toolkits})()
    monkeypatch.setattr(
        "app.service.task.get_task_lock_if_exists", lambda _: task_lock
    )
    runtime = RunCoordinator(journal)

    async def terminate():
        if outcome == "failed":
            await runtime._commit_run_terminal(
                run_id="run-1",
                started_at=1,
                event_type="run.failed",
                payload={},
            )
        elif outcome == "cancelled":
            await runtime.cancel_durable("run-1", request_id="cancel")
        else:
            await runtime.complete_cancelled_turn("run-1", request_id="cancel")

    asyncio.run(terminate())
    session = toolkit.shell_sessions["bg"]
    assert session["process"].poll() is not None
    assert not session["eigent_reader_thread"].is_alive()
    assert session["process"].stdin.closed
    assert session["process"].stdout.closed
    size = (context.working_directory / "growing.txt").read_bytes()
    toolkit.cleanup(remove_venv=False)
    toolkit.cleanup(remove_venv=False)
    assert (context.working_directory / "growing.txt").read_bytes() == size
    assert journal.get_run("run-1").status == (
        "failed" if outcome == "failed" else "cancelled"
    )
    assert journal.list_tool_calls("run-1")[0].status == "failed"
    assert not journal.list_git_mutation_intents(
        statuses=("prepared", "needs_attention")
    )
    assert backend.is_worktree_clean(context.working_directory)

    assert (
        journal.get_workspace_writer_request("workspace-writer:run-1").status
        == "released"
    )
    assert all(
        change.state == "checkpointed"
        for change in journal.list_git_change_sets()
    )


def test_command_success_checkpoint_failure_never_replays(
    owned_workspace, monkeypatch
):
    journal, mutation, backend, context, make_toolkit, _ = owned_workspace
    toolkit = make_toolkit()
    attempts = []

    def fail_capture(*args, **kwargs):
        attempts.append(kwargs["operation_request_id"])
        raise RepositoryStateChangedError("unattributed external change")

    monkeypatch.setattr(mutation.content, "checkpoint", fail_capture)
    with run_context_scope(context):
        checkpoint = prepare_tool_checkpoint(
            raw_tool_call_id="fg",
            tool_name="shell_exec",
            arguments={},
            journal=journal,
        )
        with tool_checkpoint_scope(checkpoint):
            with pytest.raises(RepositoryStateChangedError) as failure:
                toolkit.shell_exec(
                    python_command(
                        "from pathlib import Path; p=Path('once.txt'); p.write_text(p.read_text()+'x' if p.exists() else 'x')"
                    ),
                    id="fg",
                )
        with pytest.raises(UnsafeToolOutcomeError):
            finish_tool_checkpoint(
                checkpoint, error=failure.value, journal=journal
            )
    toolkit.cleanup(remove_venv=False)
    toolkit.cleanup(remove_venv=False)
    assert len(attempts) == 1
    assert (context.working_directory / "once.txt").read_text() == "x"
    assert journal.list_tool_calls("run-1")[0].status == "outcome_unknown"
    assert journal.list_git_mutation_intents()[0].status == "needs_attention"
    assert journal.list_git_change_sets()[0].state == "needs_attention"


def test_foreground_process_is_registered_and_stoppable(owned_workspace):
    journal, mutation, backend, context, make_toolkit, _ = owned_workspace
    toolkit = make_toolkit()

    def execute():
        with run_context_scope(context):
            return toolkit.shell_exec(
                python_command(
                    "import time; from pathlib import Path; Path('started').write_text('yes'); time.sleep(30)"
                ),
                id="fg",
                timeout=30,
            )

    with ThreadPoolExecutor() as pool:
        future = pool.submit(execute)
        wait_for(lambda: (context.working_directory / "started").exists())
        toolkit.cleanup(remove_venv=False)
        future.result(timeout=2)
    assert toolkit.shell_sessions["fg"]["process"].poll() is not None
    assert toolkit.shell_sessions["fg"]["process"].stdin.closed
    assert toolkit.shell_sessions["fg"]["process"].stdout.closed
    assert not toolkit.shell_sessions["fg"]["eigent_reader_thread"].is_alive()
    assert not journal.list_git_mutation_intents(statuses=("prepared",))


def test_foreground_stdin_eof_releases_writer(owned_workspace):
    journal, mutation, backend, context, make_toolkit, _ = owned_workspace
    toolkit = make_toolkit()
    with run_context_scope(context):
        checkpoint = prepare_tool_checkpoint(
            raw_tool_call_id="reads-stdin",
            tool_name="shell_exec",
            arguments={},
            journal=journal,
        )
        with tool_checkpoint_scope(checkpoint):
            result = toolkit.shell_exec(
                python_command(
                    "import sys; from pathlib import Path; "
                    "Path('stdin.txt').write_text(repr(sys.stdin.read()))"
                ),
                id="reads-stdin",
                timeout=2,
            )
        finish_tool_checkpoint(checkpoint, result=result, journal=journal)
        assert not isinstance(result, BackgroundToolResult)
        assert (context.working_directory / "stdin.txt").read_text() == "''"
        assert not journal.list_git_mutation_intents(
            statuses=("prepared", "needs_attention")
        )
        make_toolkit("agent-2").shell_exec(
            python_command(
                "from pathlib import Path; Path('next.txt').write_text('done')"
            )
        )
    assert (context.working_directory / "next.txt").read_text() == "done"
    assert journal.list_tool_calls("run-1")[0].status == "completed"
    assert backend.is_worktree_clean(context.working_directory)


@pytest.mark.parametrize("block", [True, False])
def test_completed_sessions_release_pipes_before_repeated_cleanup(
    owned_workspace, block
):
    _, _, _, _, make_toolkit, _ = owned_workspace
    toolkit = make_toolkit()
    before = len(os.listdir("/dev/fd")) if os.path.isdir("/dev/fd") else None
    try:
        for index in range(12):
            toolkit.shell_exec(
                python_command("pass"), id=f"command-{index}", block=block
            )
            session = toolkit.shell_sessions[f"command-{index}"]
            session["eigent_reader_thread"].join(timeout=2)
            assert not session["eigent_reader_thread"].is_alive()
        assert all(
            session["process"].stdin.closed
            and session["process"].stdout.closed
            for session in toolkit.shell_sessions.values()
        )
        if before is not None:
            assert len(os.listdir("/dev/fd")) <= before
        toolkit.cleanup(remove_venv=False)
        toolkit.cleanup(remove_venv=False)
        if before is not None:
            assert len(os.listdir("/dev/fd")) <= before
    finally:
        # Keep a failing regression from leaking its own fixture descriptors.
        for session in toolkit.shell_sessions.values():
            session["process"].stdin.close()


def test_live_background_stdin_remains_interactive(owned_workspace):
    journal, _, backend, context, make_toolkit, _ = owned_workspace
    toolkit = make_toolkit()
    with run_context_scope(context):
        checkpoint = prepare_tool_checkpoint(
            raw_tool_call_id="interactive",
            tool_name="shell_exec",
            arguments={"block": False},
            journal=journal,
        )
        with tool_checkpoint_scope(checkpoint):
            result = toolkit.shell_exec(
                python_command(
                    "import sys; from pathlib import Path\n"
                    "for _ in range(2):\n"
                    "    value = sys.stdin.readline()\n"
                    "    with Path('input.txt').open('a') as output:\n"
                    "        output.write(value)\n"
                    "    print(value, end='', flush=True)\n"
                ),
                id="interactive",
                block=False,
            )
        finish_tool_checkpoint(checkpoint, result=result, journal=journal)
        session = toolkit.shell_sessions["interactive"]
        assert not session["process"].stdin.closed
        assert "first" in toolkit.shell_write_to_process(
            "interactive", "first"
        )
        assert session["process"].poll() is None
        assert not session["process"].stdin.closed
        assert "second" in toolkit.shell_write_to_process(
            "interactive", "second"
        )
    wait_for(lambda: not toolkit._workspace_checkpoint_watchers)
    assert (
        context.working_directory / "input.txt"
    ).read_text() == "first\nsecond\n"
    assert journal.list_tool_calls("run-1")[0].status == "completed"
    assert session["process"].stdin.closed
    assert session["process"].stdout.closed
    assert backend.is_worktree_clean(context.working_directory)


@pytest.mark.parametrize(
    ("exec_state", "stopped", "expected_status"),
    [
        ({"Running": False, "ExitCode": 0}, False, "completed"),
        ({"Running": False, "ExitCode": 7}, False, "failed"),
        ({"Running": False, "ExitCode": 137}, True, "failed"),
        ({"Running": False, "ExitCode": 0}, True, "failed"),
        ({"Running": False, "ExitCode": None}, False, "outcome_unknown"),
        ({"Running": False, "ExitCode": None}, True, "outcome_unknown"),
        ({"Running": True, "ExitCode": 0}, True, "outcome_unknown"),
        ({"ExitCode": 0}, False, "outcome_unknown"),
        ({"Running": False, "ExitCode": "0"}, False, "outcome_unknown"),
        ({"Running": False, "ExitCode": False}, False, "outcome_unknown"),
        (RuntimeError("exec status unavailable"), False, "outcome_unknown"),
    ],
)
def test_docker_background_outcome_uses_exec_status(
    owned_workspace, exec_state, stopped, expected_status
):
    journal, mutation, backend, context, make_toolkit, _ = owned_workspace
    toolkit = make_toolkit()
    with run_context_scope(context):
        checkpoint = prepare_tool_checkpoint(
            raw_tool_call_id="docker-command",
            tool_name="shell_exec",
            arguments={"block": False},
            journal=journal,
        )
        assert checkpoint is not None
        prepared = mutation.prepare_broad_write(
            context=context,
            operation_request_id=checkpoint.tool_call_id,
            actor_id=toolkit.agent_name,
            trigger="terminal.execute",
        )

    class ExecSocket:
        """CAMEL stores a Docker exec socket here, with no Popen methods."""

        closed = False

        def close(self):
            self.closed = True

    socket = ExecSocket()
    toolkit.shell_sessions["docker-command"] = {
        "backend": "docker",
        "process": socket,
        "exec_id": "test-exec",
        "running": stopped,
    }
    toolkit.docker_api_client = Mock(spec=["exec_inspect"])
    if isinstance(exec_state, Exception):
        toolkit.docker_api_client.exec_inspect.side_effect = exec_state
    else:
        toolkit.docker_api_client.exec_inspect.return_value = exec_state
    if stopped:
        assert not toolkit.shell_kill_process("docker-command").startswith(
            "Error"
        )
        assert socket.closed
    (context.working_directory / "docker-output.txt").write_text("captured")
    toolkit._watch_background_workspace_mutation(
        session_id="docker-command",
        mutation_service=mutation,
        prepared=prepared,
        operation_request_id=checkpoint.tool_call_id,
        checkpoint=checkpoint,
    )
    wait_for(lambda: not toolkit._workspace_checkpoint_watchers)
    call = journal.list_tool_calls("run-1")[0]
    assert call.status == expected_status
    toolkit.docker_api_client.exec_inspect.assert_called_with("test-exec")
    if expected_status == "outcome_unknown":
        assert call.result["external_effect_may_have_occurred"] is True
        assert toolkit.quiesce_run_background_sessions("run-1") == (
            "docker-command",
        )
    else:
        assert call.result == {
            "session_id": "docker-command",
            "exit_code": exec_state["ExitCode"],
            "stopped": stopped,
            "workspace_checkpointed": True,
        }
        assert toolkit.quiesce_run_background_sessions("run-1") == ()
        assert not journal.list_git_mutation_intents(
            statuses=("prepared", "needs_attention")
        )
        assert backend.is_worktree_clean(context.working_directory)


def test_background_capture_cannot_upgrade_previous_unknown_result(
    owned_workspace,
):
    journal, mutation, backend, context, make_toolkit, _ = owned_workspace
    toolkit = make_toolkit()
    with run_context_scope(context):
        checkpoint = prepare_tool_checkpoint(
            raw_tool_call_id="bg",
            tool_name="shell_exec",
            arguments={},
            journal=journal,
        )
        with tool_checkpoint_scope(checkpoint):
            toolkit.shell_exec(
                python_command("import time; time.sleep(.3)"),
                id="bg",
                block=False,
            )
        with pytest.raises(UnsafeToolOutcomeError):
            finish_tool_checkpoint(
                checkpoint,
                error=RuntimeError("caller lost outcome"),
                journal=journal,
            )
    wait_for(lambda: not toolkit._workspace_checkpoint_watchers)
    assert journal.list_tool_calls("run-1")[0].status == "outcome_unknown"
    assert not journal.list_git_mutation_intents(statuses=("prepared",))


def test_inherited_terminal_file_writer_uses_admission(owned_workspace):
    journal, mutation, backend, context, make_toolkit, _ = owned_workspace
    toolkit = make_toolkit()
    with run_context_scope(context):
        toolkit.shell_exec(
            python_command("import time; time.sleep(.3)"), id="bg", block=False
        )
        with pytest.raises(ToolInvocationNotDispatchedError):
            toolkit.shell_write_content_to_file("text", "file.txt")
        assert not (context.working_directory / "file.txt").exists()
        wait_for(lambda: not toolkit._workspace_checkpoint_watchers)
        toolkit.shell_write_content_to_file("text", "file.txt")
    assert (context.working_directory / "file.txt").read_text() == "text"
    assert backend.is_worktree_clean(context.working_directory)


def test_protected_foreground_process_is_stoppable(owned_workspace):
    journal, mutation, backend, context, make_toolkit, _ = owned_workspace
    toolkit = make_toolkit()

    @contextmanager
    def protected_environment():
        yield {"TEST_SECRET": "isolated-fixture-secret"}

    toolkit._runtime_env_provider = protected_environment

    def execute():
        with run_context_scope(context):
            return toolkit.shell_exec(
                python_command(
                    "import time; from pathlib import Path; Path('started').write_text('yes'); time.sleep(30)"
                ),
                id="fg",
                timeout=30,
            )

    with ThreadPoolExecutor() as pool:
        future = pool.submit(execute)
        wait_for(lambda: (context.working_directory / "started").exists())
        toolkit.cleanup(remove_venv=False)
        future.result(timeout=2)
    assert toolkit.shell_sessions["fg"]["process"].poll() is not None
    assert not journal.list_git_mutation_intents(statuses=("prepared",))


def test_default_terminal_logs_do_not_mutate_or_clear_the_checkout(
    owned_workspace,
):
    journal, mutation, backend, context, make_toolkit, toolkits = (
        owned_workspace
    )
    old_log = context.working_directory / "terminal_logs" / "session_live.log"
    old_log.parent.mkdir()
    old_log.write_text("existing evidence")
    toolkit = TerminalToolkit(
        "project-1", working_directory=str(context.working_directory)
    )
    toolkits.append(toolkit)
    assert old_log.read_text() == "existing evidence"
    from pathlib import Path

    assert not Path(toolkit.log_dir).is_relative_to(context.working_directory)
