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

import asyncio
import os
import subprocess
import sys
import textwrap
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.agent.toolkit import terminal_toolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.controller import workspace_controller
from app.controller.run_controller import CancelRunBody, cancel_run
from app.run_journal import SQLiteRunJournal
from app.run_runtime import RunCoordinator
from app.utils import runtime_environment_cleanup as cleanup


@pytest.fixture
def owner_home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    return tmp_path


@contextmanager
def allow_all(project_id):
    yield True


def environment(home, run_id):
    path = (
        home
        / f".eigent/user_42/runtime/project_session/task_{run_id}/toolchains/agents/hash/.venv"
    )
    path.mkdir(parents=True)
    (path / "package").write_text("fixture")
    return path


def test_gc_retention_and_active_protection(owner_home, monkeypatch):
    now = time.time()
    statuses = {
        "old": "completed",
        "fresh": "completed",
        "active": "running",
        "interrupted": "interrupted",
    }
    paths = {
        key: environment(owner_home, key) for key in (*statuses, "unknown")
    }
    for key, path in paths.items():
        if key != "fresh":
            os.utime(path, (now - 90000, now - 90000))
            os.utime(path / "package", (now - 90000, now - 90000))
    journal = SimpleNamespace(
        get_run=lambda run_id: SimpleNamespace(
            project_id="session",
            status=statuses[run_id],
            updated_at=now - (1 if run_id == "fresh" else 90000),
        )
        if run_id in statuses
        else None
    )
    removed = cleanup.collect_runtime_environments(
        journal, project_guard=allow_all, now=now
    )
    assert set(removed) == {
        str(paths[key]) for key in ("old", "interrupted", "unknown")
    }
    assert paths["fresh"].exists() and paths["active"].exists()


def test_pressure_only_evicts_non_active(owner_home, monkeypatch):
    paths = {key: environment(owner_home, key) for key in ("active", "fresh")}
    journal = SimpleNamespace(
        get_run=lambda run_id: SimpleNamespace(
            project_id="session",
            status="running" if run_id == "active" else "completed",
            updated_at=time.time(),
        )
    )
    monkeypatch.setattr(cleanup, "SOFT_BUDGET_BYTES", 1)
    assert cleanup.collect_runtime_environments(
        journal, project_guard=allow_all
    ) == [str(paths["fresh"])]
    assert paths["active"].exists()


def test_runtime_delete_rejects_traversal_and_symlink(owner_home):
    path = environment(owner_home, "old")
    with pytest.raises(ValueError):
        cleanup.delete_project_runtime("a@example.com", "42", "../session")
    outside = owner_home / "workspace"
    outside.mkdir()
    path.parents[4].rename(path.parents[4].with_name("saved"))
    path.parents[4].symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        cleanup.delete_project_runtime("a@example.com", "42", "session")
    assert outside.exists()


@pytest.mark.asyncio
async def test_delete_endpoint_active_guard_and_owned_deletion(
    owner_home, monkeypatch
):
    path = environment(owner_home, "old")
    monkeypatch.setattr(
        workspace_controller, "_project_has_active_run", lambda project: True
    )
    with pytest.raises(HTTPException) as exc:
        await workspace_controller.project_runtime_delete(
            "session", "a@example.com", "42"
        )
    assert exc.value.status_code == 409 and path.exists()
    monkeypatch.setattr(
        workspace_controller, "_project_has_active_run", lambda project: False
    )
    monkeypatch.setattr(
        workspace_controller, "get_task_lock_if_exists", lambda project: None
    )
    assert (
        await workspace_controller.project_runtime_delete(
            "session", "a@example.com", "42"
        )
    )["deleted"]
    assert not path.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status", ["completed", "failed", "cancelled", "timed_out", "interrupted"]
)
async def test_coordinator_cleanup_single_flight_and_terminal_only(
    status, owner_home, monkeypatch
):
    journal = SimpleNamespace(
        get_run=lambda run_id: SimpleNamespace(
            status=status, project_id="session"
        )
    )
    coordinator = RunCoordinator(journal)
    release = Mock()
    monkeypatch.setattr(
        "app.service.task.get_task_lock_if_exists",
        lambda project: SimpleNamespace(
            registered_toolkits=[
                SimpleNamespace(release_run_environment=release)
            ]
        ),
    )
    for _ in range(3):
        coordinator._schedule_terminal_environment_release("run", journal)
    await asyncio.gather(*coordinator._environment_releases.values())
    assert coordinator._environment_releases == {}
    assert release.call_count == (0 if status == "interrupted" else 1)
    assert journal.get_run("run").status == status


def test_terminal_release_requires_stopped_sessions(owner_home, monkeypatch):
    context = SimpleNamespace(
        project_id="session",
        run_id="old",
        email="a@example.com",
        user_id="42",
        working_directory=owner_home / "workspace",
        task_output_root=owner_home / "outputs",
    )
    path = environment(owner_home, "old")
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit._environment_context = context
    toolkit._terminal_mutation_lock = threading.RLock()
    toolkit.cloned_env_path = str(path)
    toolkit.quiesce_run_background_sessions = Mock(return_value=("stuck",))
    with pytest.raises(RuntimeError):
        toolkit.release_run_environment("old")
    assert path.exists()
    toolkit.quiesce_run_background_sessions.return_value = ()
    toolkit.release_run_environment("other")
    assert path.exists()
    toolkit.release_run_environment("old")
    assert not path.exists()


@pytest.mark.asyncio
async def test_cleanup_failure_does_not_change_run_outcome(
    owner_home, monkeypatch
):
    path = environment(owner_home, "run")
    run = SimpleNamespace(status="completed", project_id="session")
    journal = SimpleNamespace(get_run=lambda run_id: run)
    coordinator = RunCoordinator(journal)
    release = Mock(side_effect=RuntimeError("still running"))
    monkeypatch.setattr(
        "app.service.task.get_task_lock_if_exists",
        lambda project: SimpleNamespace(
            registered_toolkits=[
                SimpleNamespace(release_run_environment=release)
            ]
        ),
    )
    await coordinator._release_terminal_environments("run", journal)
    assert run.status == "completed"
    # A toolkit that could not stop its sessions still owns the copy.
    assert path.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("live_project", [False, True])
async def test_cancel_after_restart_removes_retained_copy(
    owner_home, monkeypatch, live_project
):
    retained = environment(owner_home, "interrupted")
    other = environment(owner_home, "other")
    statuses = {"interrupted": "cancelled", "other": "interrupted"}
    journal = SimpleNamespace(
        get_run=lambda run_id: SimpleNamespace(
            status=statuses[run_id], project_id="session"
        )
    )
    coordinator = RunCoordinator(journal)
    # After a restart the project has no toolkit, or only a follow-up's.
    release = Mock()
    monkeypatch.setattr(
        "app.service.task.get_task_lock_if_exists",
        lambda project: SimpleNamespace(
            registered_toolkits=[
                SimpleNamespace(release_run_environment=release)
            ]
        )
        if live_project
        else None,
    )
    await coordinator._release_terminal_environments("other", journal)
    assert retained.exists() and other.exists()
    await coordinator._release_terminal_environments("interrupted", journal)
    assert not retained.exists()
    assert other.exists()
    assert release.call_count == (1 if live_project else 0)


@pytest.mark.asyncio
async def test_cancel_route_after_restart_removes_retained_copy(
    owner_home, monkeypatch
):
    with SQLiteRunJournal(owner_home / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="interrupted", project_id="session")
        journal.reconcile_startup(now=1)
        retained = environment(owner_home, "interrupted")
        # The process coordinator before any execution binds a journal.
        coordinator = RunCoordinator()
        monkeypatch.setattr(
            "app.run_journal.runtime.get_default_run_journal", lambda: journal
        )
        monkeypatch.setattr(
            "app.controller.run_controller.get_default_run_coordinator",
            lambda: coordinator,
        )
        cancelled = await cancel_run(
            "interrupted", CancelRunBody(request_id="cancel")
        )
        await asyncio.gather(*coordinator._environment_releases.values())
        assert cancelled["status"] == "cancelled"
        assert journal.get_run("interrupted").status == "cancelled"
        assert not retained.exists()
        await coordinator.close()


def test_run_release_rejects_traversal_and_symlink(owner_home):
    path = environment(owner_home, "old")
    with pytest.raises(ValueError):
        cleanup.release_run_environments("session", "../old")
    outside = owner_home / "workspace"
    (outside / "hash/.venv").mkdir(parents=True)
    agents = path.parents[1]
    agents.rename(agents.with_name("saved"))
    agents.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        cleanup.release_run_environments("session", "old")
    assert (outside / "hash/.venv").exists()


def shutdown_toolkit(path, context):
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "task"
    toolkit._environment_context = context
    toolkit.cloned_env_path = str(path)
    toolkit._stop_owned_sessions = Mock(return_value=())
    return toolkit


@pytest.mark.asyncio
async def test_shutdown_keeps_run_environment_for_resume(owner_home):
    from app.service.task import create_task_lock, task_locks

    kept = environment(owner_home, "interrupted")
    run_toolkit = shutdown_toolkit(kept, SimpleNamespace(run_id="interrupted"))
    legacy = owner_home / ".eigent/terminal/agent/.venv"
    legacy.mkdir(parents=True)
    legacy_toolkit = shutdown_toolkit(legacy, None)
    lock = create_task_lock("shutdown-keeps-run-environment")
    try:
        lock.register_toolkit(run_toolkit)
        lock.register_toolkit(legacy_toolkit)
        await lock.cleanup(keep_run_environments=True)
    finally:
        task_locks.pop("shutdown-keeps-run-environment", None)
    run_toolkit._stop_owned_sessions.assert_called_once()
    assert kept.exists()
    # Nothing resumes or retains a copy that no Run owns.
    assert not legacy.exists()
    # CAMEL's destructor fallback calls cleanup() after shutdown.
    run_toolkit.cleanup()
    assert kept.exists()


def test_brain_shutdown_keeps_interrupted_run_environment(tmp_path):
    """Run the real shutdown and interpreter exit, where finalizers run too."""
    script = textwrap.dedent(
        """
        import asyncio
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import Mock

        import main
        from app.agent.toolkit.terminal_toolkit import TerminalToolkit
        from app.service.task import create_task_lock

        path = Path.home() / (
            ".eigent/user_42/runtime/project_p/task_r/toolchains/agents/h/.venv"
        )
        path.mkdir(parents=True)
        toolkit = TerminalToolkit.__new__(TerminalToolkit)
        toolkit.api_task_id = "p"
        toolkit._environment_context = SimpleNamespace(run_id="r")
        toolkit.cloned_env_path = str(path)
        toolkit._stop_owned_sessions = Mock(return_value=())
        create_task_lock("p").register_toolkit(toolkit)
        del toolkit
        asyncio.run(main.cleanup_resources())
        """
    )
    env = os.environ.copy()
    env["HOME"] = str(tmp_path)
    env["USERPROFILE"] = str(tmp_path)
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[3],
        env=env,
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        tmp_path
        / ".eigent/user_42/runtime/project_p/task_r/toolchains/agents/h/.venv"
    ).exists()


@pytest.mark.asyncio
async def test_task_lock_cleanup_still_removes_run_environment(owner_home):
    from app.service.task import create_task_lock, task_locks

    path = environment(owner_home, "deleted")
    lock = create_task_lock("cleanup-removes-run-environment")
    try:
        lock.register_toolkit(
            shutdown_toolkit(path, SimpleNamespace(run_id="deleted"))
        )
        await lock.cleanup()
    finally:
        task_locks.pop("cleanup-removes-run-environment", None)
    assert not path.exists()


def expired_journal(statuses):
    return SimpleNamespace(
        get_run=lambda run_id: SimpleNamespace(
            project_id="session",
            status=statuses(run_id),
            updated_at=time.time() - 90000,
        )
    )


def expire(path):
    old = time.time() - 90000
    os.utime(path, (old, old))
    os.utime(path / "package", (old, old))


@pytest.mark.asyncio
async def test_loop_guard_spares_busy_projects_and_held_toolkits(
    owner_home, monkeypatch
):
    path = environment(owner_home, "old")
    expire(path)
    journal = expired_journal(lambda run_id: "completed")
    toolkit = SimpleNamespace(_terminal_mutation_lock=threading.RLock())
    background = asyncio.get_running_loop().create_future()
    lock = SimpleNamespace(
        background_tasks={background}, registered_toolkits=[toolkit]
    )
    monkeypatch.setattr(
        "app.service.task.get_task_lock_if_exists", lambda project: lock
    )
    guard = cleanup.loop_project_guard(asyncio.get_running_loop())

    async def collect():
        return await asyncio.to_thread(
            cleanup.collect_runtime_environments,
            journal,
            project_guard=guard,
        )

    assert await collect() == [] and path.exists()

    background.set_result(None)
    held = threading.Event()
    done = threading.Event()

    def run_command():
        with toolkit._terminal_mutation_lock:
            held.set()
            done.wait()

    command = threading.Thread(target=run_command)
    command.start()
    held.wait()
    try:
        assert await collect() == [] and path.exists()
    finally:
        done.set()
        command.join()

    assert await collect() == [str(path)]
    assert not path.exists()
    # The guard released every toolkit lock it took.
    assert toolkit._terminal_mutation_lock.acquire(blocking=False)
    toolkit._terminal_mutation_lock.release()


def test_retention_rechecks_run_status_inside_guard(owner_home):
    path = environment(owner_home, "old")
    expire(path)
    reads = []

    def status(run_id):
        reads.append(run_id)
        # Scanned as interrupted; a Resume makes it active before removal.
        return "interrupted" if len(reads) <= 1 else "running"

    assert (
        cleanup.collect_runtime_environments(
            expired_journal(status), project_guard=allow_all
        )
        == []
    )
    assert path.exists()


@pytest.mark.parametrize("ready", [False, True])
def test_venv_rebuilds_only_a_previously_selected_environment(
    owner_home, monkeypatch, ready
):
    directory = owner_home / "agent"
    directory.mkdir()
    toolkit = TerminalToolkit.__new__(TerminalToolkit)
    toolkit.api_task_id = "task"
    toolkit._agent_venv_dir = str(directory)
    toolkit._cloned_env_ready = ready
    toolkit.cloned_env_path = str(directory / ".venv")
    toolkit._setup_cloned_environment = Mock()
    toolkit._run_agent_environment_dir = lambda context: str(directory)
    monkeypatch.setattr(
        terminal_toolkit,
        "run_context_for_task",
        lambda task_id: SimpleNamespace(run_id="run"),
    )
    assert toolkit._get_venv_path() is None
    # A missing base or failed clone must not retry setup on every command.
    assert toolkit._setup_cloned_environment.call_count == (1 if ready else 0)
