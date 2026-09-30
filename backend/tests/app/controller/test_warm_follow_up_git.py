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

"""Exercise legacy warm admission with the real journal, writer and Git flow."""

import asyncio
import logging
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import pytest_asyncio

from app.controller import chat_controller as controller
from app.model.chat import Status, SupplementChat
from app.run_context import RunContext
from app.run_journal import (
    InvalidRunTransitionError,
    RunEventDraft,
    SQLiteRunJournal,
)
from app.run_runtime import RunCoordinator, admission as activation
from app.service.task import TaskLock
from app.workspace_git import (
    GitBackend,
    WorkspaceGitCoordinator,
    WorkspaceGitLifecycle,
    WorkspaceMutationService,
)
from app.workspace_git.scheduler import WorkspaceWriterInterruptedError
from app.workspace_runtime.store import WorkspaceStateStore


@pytest_asyncio.fixture
async def warm(tmp_path, monkeypatch):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        hooks = tmp_path / "hooks"
        hooks.mkdir()
        git = GitBackend(hooks_path=hooks)
        workspace = WorkspaceGitCoordinator(
            journal, state_root=tmp_path / "state", git_backend=git
        )
        root = tmp_path / "space"
        root.mkdir()
        repository = workspace.content.bootstrap(
            space_id="space", space_root=root, allow_init=True
        )
        lock = TaskLock("session", asyncio.Queue(), {})
        lock.status = Status.done
        lock.email = "local@example.com"
        lock.user_id = "local-user"
        lock.space_id = "space"
        lock.run_context = RunContext(
            space_id="space",
            project_id="session",
            run_id="first",
            task_id="first",
            email=lock.email,
            user_id=lock.user_id,
            working_directory=root,
            task_output_root=root,
            camel_log_dir=tmp_path / "logs",
            binding_source="space",
            workdir_mode="direct-write",
            browser_port=9222,
            session_mode="single-agent",
        )
        runtime = RunCoordinator()
        stopped = asyncio.Event()

        async def source():
            await stopped.wait()
            yield "done"

        subscription = await runtime.start_with_subscription(
            run_id="first", stream_factory=source
        )
        resolver = Mock()
        resolver.freeze_task_directories_for.return_value = SimpleNamespace(
            working_directory=root,
            task_output_root=root,
            binding_source="space",
            snapshot=Mock(),
        )
        for module in (controller, activation):
            monkeypatch.setattr(
                module, "get_default_run_journal", lambda: journal
            )
            monkeypatch.setattr(
                module,
                "get_default_workspace_git_coordinator",
                lambda: workspace,
            )
        monkeypatch.setattr(controller, "get_task_lock", lambda _: lock)
        monkeypatch.setattr(
            controller, "get_default_run_coordinator", lambda: runtime
        )
        monkeypatch.setattr(
            controller, "get_workspace_resolver", lambda: resolver
        )
        monkeypatch.setattr(
            controller,
            "_prepare_browser_for_request_with_timeout",
            AsyncMock(),
        )
        monkeypatch.setattr(
            controller, "_camel_log_dir", lambda *_: tmp_path / "logs"
        )
        monkeypatch.setattr(
            controller, "apply_run_env_for_third_party", Mock()
        )
        request = SimpleNamespace(
            state=SimpleNamespace(browser_port=9222, cdp_url=None)
        )
        value = SimpleNamespace(
            journal=journal,
            workspace=workspace,
            root=root,
            lock=lock,
            runtime=runtime,
            request=request,
            repository=repository,
            mutation=WorkspaceMutationService(
                journal, state_root=tmp_path / "state", coordinator=workspace
            ),
            lifecycle=WorkspaceGitLifecycle(
                journal, state_root=tmp_path / "state", coordinator=workspace
            ),
        )
        journal.ensure_run(
            run_id="first", project_id="session", status="pending"
        )
        attempt = journal.create_run_attempt(
            "first", request_id="first", reason="initial_execution"
        )
        lock.run_context = replace(
            lock.run_context, attempt_id=attempt.attempt_id
        )
        workspace.admit_run(
            space_id="space",
            project_id="session",
            run_id="first",
            task_id="first",
            session_mode="single-agent",
        )
        journal.activate_run_attempt(
            attempt.attempt_id, expected_run_id="first"
        )
        try:
            yield value
        finally:
            stopped.set()
            await subscription.aclose()
            await subscription.handle.wait()


def write_and_finish(warm, name):
    context = warm.lock.run_context
    operation = f"write:{context.run_id}"
    prepared = warm.mutation.prepare_file_write(
        context=context,
        filename=name,
        operation_request_id=operation,
        actor_id="agent",
        trigger="filesystem.write",
    )
    # Match the File toolkit's non-Git fallback on the buggy warm route.
    target = prepared.target_path if prepared else warm.root / name
    target.write_text(context.run_id)
    if prepared:
        warm.mutation.complete_file_write(
            prepared,
            operation_request_id=operation,
            actor_id="agent",
            trigger="filesystem.write",
        )
    warm.journal.append_event(
        context.run_id,
        RunEventDraft(
            event_id=f"done:{context.run_id}",
            event_type="run.completed",
            payload={},
        ),
    )
    warm.lifecycle.finalize_run(context.run_id)
    warm.lock.status = Status.done
    return prepared


@pytest.mark.asyncio
@pytest.mark.parametrize("rounds", [1, 2], ids=["second", "third"])
async def test_warm_follow_up_checkpoints_its_own_run(warm, rounds):
    assert write_and_finish(warm, "first.txt") is not None
    for run_id in ("second", "third")[:rounds]:
        response = await controller.improve(
            "session",
            SupplementChat(question=f"write {run_id}", task_id=run_id),
            warm.request,
        )
        assert response.status_code == 201
        item = warm.lock.queue.get_nowait()
        assert item.run_id == run_id
        assert item.attempt_id == warm.lock.run_context.attempt_id
        assert await activation.activate_improve_admission(
            warm.lock,
            item,
            project_id="session",
            logger=logging.getLogger(__name__),
        )
        prepared = write_and_finish(warm, f"{run_id}.txt")
        checkpoints = [
            checkpoint
            for checkpoint in warm.journal.list_git_checkpoints(
                warm.journal.get_space_git_repository(
                    space_id="space"
                ).repository_id
            )
            if checkpoint.target_role == "run"
            and checkpoint.target_id == run_id
        ]
    assert checkpoints, (
        f"{run_id}: queued and executed but no Run checkpoint; Git prepared={prepared is not None}"
    )
    assert {
        path for checkpoint in checkpoints for path in checkpoint.paths
    } == {f"{run_id}.txt"}


@pytest.mark.asyncio
async def test_queue_failure_restores_follow_up_ownership(warm, monkeypatch):
    write_and_finish(warm, "first.txt")
    old_context = warm.lock.run_context
    old_handle = await warm.runtime.get_handle("first")
    monkeypatch.setattr(
        warm.lock,
        "put_queue",
        AsyncMock(side_effect=RuntimeError("queue unavailable")),
    )
    with pytest.raises(RuntimeError, match="queue unavailable"):
        await controller.improve(
            "session",
            SupplementChat(question="write second", task_id="second"),
            warm.request,
        )
    assert warm.lock.queue.empty()
    assert warm.lock.run_context == old_context
    assert await warm.runtime.get_handle("first") is old_handle
    assert await warm.runtime.get_handle("second") is None
    assert warm.journal.get_active_project_run("session") is None
    first_writer = warm.journal.get_workspace_writer_request(
        "workspace-writer:first"
    )
    assert first_writer.status == "released"


@pytest.mark.asyncio
async def test_active_previous_run_keeps_its_writer_on_rejected_follow_up(
    warm,
):
    old_context = warm.lock.run_context
    writer = warm.journal.get_workspace_writer_request(
        "workspace-writer:first"
    )
    handle = await warm.runtime.get_handle("first")
    with pytest.raises(
        InvalidRunTransitionError, match="already executes Run"
    ):
        await controller.improve(
            "session",
            SupplementChat(question="write second", task_id="second"),
            warm.request,
        )
    assert warm.lock.run_context == old_context
    assert await warm.runtime.get_handle("first") is handle
    assert await warm.runtime.get_handle("second") is None
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:first")
        == writer
    )
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:second")
        is None
    )
    assert warm.journal.list_run_attempts("second") == []
    assert warm.lock.queue.empty()


@pytest.mark.asyncio
@pytest.mark.parametrize("registered_target", [False, True])
async def test_existing_writer_finish_is_not_admission_rollback(
    warm, registered_target
):
    """Characterize the gate: terminal release cannot stand in for rollback.

    These assertions preserve the existing writer/settlement rules. A fix needs
    a separate, owner-fenced rollback for never-published admission, rather than
    weakening finish_task or replaying a terminal writer request.
    """
    write_and_finish(warm, "first.txt")
    if registered_target:
        WorkspaceStateStore(warm.journal).register_target(warm.root)
    warm.journal.ensure_run(
        run_id="second", project_id="session", status="pending"
    )
    attempt = warm.journal.create_run_attempt(
        "second", request_id="second", reason="follow_up_execution"
    )
    admission = warm.workspace.admit_run(
        space_id="space",
        project_id="session",
        run_id="second",
        task_id="second",
        session_mode="single-agent",
    )
    assert admission.writer.request.status == "acquired"
    assert warm.journal.get_run_attempt(attempt.attempt_id).status == "pending"
    finished = warm.workspace.writer_scheduler.finish_task(
        run_id="second", task_id="second"
    )
    assert finished.status == ("acquired" if registered_target else "released")
    retry = warm.workspace.admit_run(
        space_id="space",
        project_id="session",
        run_id="second",
        task_id="second",
        session_mode="single-agent",
    )
    assert retry.writer.request == finished
    assert warm.journal.get_active_project_run("session").run_id == "second"
    if not registered_target:
        with pytest.raises(WorkspaceWriterInterruptedError, match="released"):
            await warm.workspace.writer_scheduler.wait_until_acquired(
                run_id="second", task_id="second"
            )
