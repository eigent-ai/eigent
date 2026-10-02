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
import json
import logging
import threading
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.controller import chat_controller as controller
from app.model.chat import Chat, Status, SupplementChat
from app.run_context import RunContext
from app.run_journal import (
    IdempotencyConflictError,
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
async def warm(tmp_path, monkeypatch, request):
    git_enabled = getattr(request, "param", True)
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        hooks = tmp_path / "hooks"
        hooks.mkdir()
        git = GitBackend(hooks_path=hooks)
        workspace = WorkspaceGitCoordinator(
            journal, state_root=tmp_path / "state", git_backend=git
        )
        root = tmp_path / "space"
        root.mkdir()
        repository = (
            workspace.content.bootstrap(
                space_id="space", space_root=root, allow_init=True
            )
            if git_enabled
            else None
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
            initial_source_finished=stopped,
            initial_subscription=subscription,
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
        (warm.root / "unrelated.txt").write_text(f"user edit before {run_id}")
        response = await controller.improve(
            "session",
            SupplementChat(question=f"write {run_id}", task_id=run_id),
            warm.request,
        )
        assert response.status_code == 201
        item = warm.lock.queue.get_nowait()
        assert item.run_id == run_id
        assert item.attempt_id == warm.lock.run_context.attempt_id
        writer = warm.journal.get_workspace_writer_request(
            f"workspace-writer:{run_id}"
        )
        assert writer.task_id == run_id and writer.project_id == "session"
        assert writer.status == "acquired"
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


async def follow_up(warm, run_id="second"):
    return await controller.improve(
        "session",
        SupplementChat(question=f"write {run_id}", task_id=run_id),
        warm.request,
    )


async def activate(warm, item):
    return await activation.activate_improve_admission(
        warm.lock,
        item,
        project_id="session",
        logger=logging.getLogger(__name__),
    )


@pytest_asyncio.fixture
async def live_warm(warm, monkeypatch):
    """The actual Single Agent consumer and detached pump, without a model."""
    from app.service import run_cancellation, single_agent_service, task
    from app.utils.event_loop_utils import set_main_event_loop

    write_and_finish(warm, "first.txt")
    warm.initial_source_finished.set()
    await warm.initial_subscription.handle.wait()
    monkeypatch.setitem(task.task_locks, "session", warm.lock)
    for name in (
        "get_task_lock",
        "get_task_lock_if_exists",
        "get_or_create_task_lock",
    ):
        monkeypatch.setattr(controller, name, getattr(task, name))
    monkeypatch.setattr(
        run_cancellation, "get_default_run_coordinator", lambda: warm.runtime
    )
    monkeypatch.setattr(
        "app.workspace_git.get_default_workspace_git_lifecycle",
        lambda: warm.lifecycle,
    )
    monkeypatch.setattr(
        single_agent_service, "_finalize_memory_for_turn", Mock()
    )

    async def no_model(*args, **kwargs):
        await asyncio.Event().wait()

    monkeypatch.setattr(single_agent_service, "single_agent", no_model)
    monkeypatch.setattr(
        controller, "step_solve", single_agent_service.single_agent_solve
    )
    resolver = controller.get_workspace_resolver()
    frozen = resolver.freeze_task_directories_for.return_value

    def freeze(**kwargs):
        warm.lock.current_task_id = kwargs["task_id"]
        return frozen

    resolver.freeze_task_directories_for.side_effect = freeze
    resolver.freeze_task_directories.return_value = frozen
    frozen.workdir_mode = "direct-write"
    frozen.base_snapshot_id = None
    warm.lock.current_task_id = "first"
    warm.request.headers = {}
    warm.options = Chat(
        task_id="first",
        project_id="session",
        space_id="space",
        question="write first",
        email=warm.lock.email,
        user_id=warm.lock.user_id,
        model_platform="openai",
        model_type="gpt-4o",
        api_key="test-key",
        session_mode="single-agent",
        workdir_mode="direct-write",
    )
    # Keep the environment adapter outside this admission regression. The
    # journal, Git coordinator, queue, consumer, and RuntimeHandle are real.
    monkeypatch.setattr(
        controller.EnvironmentAdmissionService,
        "persist_for_run",
        Mock(return_value=SimpleNamespace(spec=Mock(), binding=None)),
    )
    monkeypatch.setattr(controller, "_legacy_environment_template", Mock())
    monkeypatch.setattr(controller, "_assemble_runtime_environment", Mock())
    monkeypatch.setattr(controller, "_apply_environment_to_task_lock", Mock())
    warm.runtime.bind_journal(warm.journal)
    warm.second_skip_seen = asyncio.Event()
    warm.release_second_skip = asyncio.Event()
    warm.hold_second_skip = False
    get_queue = warm.lock.get_queue
    skip_count = 0

    async def receive_action():
        nonlocal skip_count
        item = await get_queue()
        if item.action == task.Action.skip_task:
            skip_count += 1
            if skip_count == 2 and warm.hold_second_skip:
                warm.second_skip_seen.set()
                await warm.release_second_skip.wait()
        return item

    monkeypatch.setattr(warm.lock, "get_queue", receive_action)
    set_main_event_loop(asyncio.get_running_loop())
    warm.live_subscription = await warm.runtime.start_with_subscription(
        run_id="first",
        command_queue=warm.lock.queue,
        stream_factory=lambda: single_agent_service.single_agent_solve(
            warm.options, warm.request, warm.lock
        ),
    )
    try:
        yield warm
    finally:
        warm.release_second_skip.set()
        await warm.runtime.close()
        await warm.live_subscription.aclose()
        set_main_event_loop(None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("closing", "cold_fault"),
    [(False, False), (True, False), (True, True)],
    ids=[
        "plain-repeated-skip",
        "close-then-cold-retry",
        "cold-publication-failure",
    ],
)
async def test_stop_retry_through_real_consumer(
    live_warm, monkeypatch, closing, cold_fault
):
    warm = live_warm
    warm.hold_second_skip = not closing
    WorkspaceStateStore(warm.journal).register_target(warm.root)
    entered, release = threading.Event(), threading.Event()
    admit = warm.workspace.admit_run

    def paused(**kwargs):
        entered.set()
        assert release.wait(5)
        return admit(**kwargs)

    monkeypatch.setattr(warm.workspace, "admit_run", paused)
    pending = asyncio.create_task(follow_up(warm))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        attempt = warm.journal.list_run_attempts("second")[0]
        if closing:
            assert (await controller.stop("session")).status_code == 204
        else:
            # Match the ordinary browser/API request: no expected_task_id.
            for _ in range(2):
                assert (
                    await asyncio.to_thread(controller.skip_task, "session")
                ).status_code == 201
        await asyncio.sleep(0.05)
        assert pending.cancelling()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert (
            warm.journal.list_run_attempts("second")[0].outcome
            == "warm_admission_aborted"
        )
        assert (
            warm.journal.get_workspace_writer_request(
                "workspace-writer:second"
            )
            is None
        )
        monkeypatch.setattr(warm.workspace, "admit_run", admit)
        if closing:
            await asyncio.wait_for(warm.live_subscription.handle.wait(), 5)
            assert controller.get_task_lock_if_exists("session") is None
            data = warm.options.model_copy(
                update={"task_id": "second", "question": "write second"}
            )
            with pytest.raises(controller.UserException):
                await controller.start_chat_stream(
                    data.model_copy(update={"question": "different request"}),
                    warm.request,
                )
            assert (
                warm.journal.list_run_attempts("second")[0].outcome
                == "warm_admission_aborted"
            )
            if cold_fault:
                with monkeypatch.context() as patcher:
                    patcher.setattr(
                        warm.journal,
                        "publish_warm_admission",
                        Mock(
                            side_effect=RuntimeError(
                                "injected cold publication failure"
                            )
                        ),
                    )
                    with pytest.raises(
                        RuntimeError, match="injected cold publication failure"
                    ):
                        await controller.start_chat_stream(data, warm.request)
                assert controller.get_task_lock_if_exists("session") is None
                assert await warm.runtime.get_handle("second") is None
                assert (
                    warm.journal.get_workspace_writer_request(
                        "workspace-writer:second"
                    )
                    is None
                )
                assert (
                    warm.journal.list_run_attempts("second")[0].outcome
                    == "warm_admission_aborted"
                )
            retry_stream = await controller.start_chat_stream(
                data, warm.request
            )
            try:
                event = json.loads(
                    (await asyncio.wait_for(anext(retry_stream), 5))[6:]
                )
            finally:
                await retry_stream.aclose()
        else:
            event = json.loads(
                (await asyncio.wait_for(anext(warm.live_subscription), 5))[6:]
            )
            assert event["step"] == "end"
            next_frame = asyncio.create_task(anext(warm.live_subscription))
            done, _ = await asyncio.wait({next_frame}, timeout=0.1)
            assert not done, (
                "Duplicate plain Skip terminated the warm consumer"
            )
            assert warm.live_subscription.handle.consumer_alive
            await follow_up(warm)
            # Deliver the earlier duplicate after the same Run id is retried.
            # Its captured admission must not stop this new preparation.
            await asyncio.wait_for(warm.second_skip_seen.wait(), 5)
            warm.release_second_skip.set()
            event = json.loads((await asyncio.wait_for(next_frame, 5))[6:])
        assert event["step"] == "confirmed"
        retried = warm.journal.list_run_attempts("second")
        assert len(retried) == 1
        assert retried[0].attempt_id == attempt.attempt_id
        assert retried[0].resume_reason == "follow_up_execution"
        assert retried[0].status == "running"
        # A distinct subsequent plain Skip must still stop the retried Run.
        await asyncio.to_thread(controller.skip_task, "session")
        for _ in range(100):
            if warm.journal.get_run("second").status == "cancelled":
                break
            await asyncio.sleep(0.01)
        assert warm.journal.get_run("second").status == "cancelled"
        assert warm.journal.get_run("first").status == "completed"
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)


@pytest.mark.asyncio
async def test_cold_retry_rejects_a_changed_environment(
    live_warm, monkeypatch
):
    warm = live_warm
    with monkeypatch.context() as patcher:
        patcher.setattr(
            warm.workspace,
            "admit_run",
            Mock(side_effect=RuntimeError("injected admission failure")),
        )
        with pytest.raises(RuntimeError, match="injected admission failure"):
            await follow_up(warm)
    assert (await controller.stop("session")).status_code == 204
    await asyncio.wait_for(warm.live_subscription.handle.wait(), 5)
    monkeypatch.setattr(
        controller.EnvironmentAdmissionService,
        "persist_for_run",
        Mock(return_value=SimpleNamespace(spec=Mock(), binding=Mock())),
    )
    monkeypatch.setattr(
        warm.journal,
        "bind_pending_attempt_environment",
        Mock(
            side_effect=IdempotencyConflictError(
                "pending Attempt is already bound to a different environment"
            )
        ),
    )

    with pytest.raises(HTTPException) as rejected:
        await controller.post(
            warm.options.model_copy(
                update={"task_id": "second", "question": "write second"}
            ),
            warm.request,
        )

    assert rejected.value.status_code == 409
    assert rejected.value.detail["code"] == "follow_up_environment_changed"
    attempt = warm.journal.list_run_attempts("second")[0]
    assert attempt.status == "pending"
    assert attempt.outcome == "warm_admission_aborted"
    assert controller.get_task_lock_if_exists("session") is None
    assert await warm.runtime.get_handle("second") is None
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:second")
        is None
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("registered_target", [False, True])
@pytest.mark.parametrize(
    "fault", ["before_git", "after_git", "queue", "staged_queue", "message"]
)
async def test_failed_admission_retries_same_identity(
    warm, monkeypatch, registered_target, fault
):
    write_and_finish(warm, "first.txt")
    if registered_target:
        WorkspaceStateStore(warm.journal).register_target(warm.root)
    warm.journal.put_follow_up_request(
        request_id="second", project_id="session", content="write second"
    )
    original_context = warm.lock.run_context
    original_handle = await warm.runtime.get_handle("first")
    put = warm.lock.put_queue
    admit = warm.workspace.admit_run

    def broken_git(**kwargs):
        if fault == "after_git":
            admit(**kwargs)
        raise RuntimeError("injected admission failure")

    async def broken_queue(item):
        if fault == "staged_queue":
            await put(item)
        raise RuntimeError("injected admission failure")

    with monkeypatch.context() as patcher:
        if fault in {"before_git", "after_git"}:
            patcher.setattr(warm.workspace, "admit_run", broken_git)
        elif fault in {"queue", "staged_queue"}:
            patcher.setattr(warm.lock, "put_queue", broken_queue)
        else:
            patcher.setattr(
                controller,
                "_record_canonical_user_message",
                AsyncMock(
                    side_effect=RuntimeError("injected admission failure")
                ),
            )
        with pytest.raises(RuntimeError, match="injected admission failure"):
            await follow_up(warm)
    attempt = warm.journal.list_run_attempts("second")[0]
    assert attempt.status == "pending"
    assert attempt.outcome == "warm_admission_aborted"
    assert warm.lock.run_context == original_context
    assert await warm.runtime.get_handle("first") is original_handle
    assert await warm.runtime.get_handle("second") is None
    assert warm.journal.get_active_project_run("session") is None
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:second")
        is None
    )
    assert (
        warm.journal.list_follow_up_requests(
            project_id="session", statuses=("pending", "admitted", "cancelled")
        )[0].status
        == "pending"
    )
    if fault == "staged_queue":
        assert not await activate(warm, warm.lock.queue.get_nowait())
        assert not warm.lock.processed_improve_request_ids
    if registered_target:
        assert (
            WorkspaceStateStore(warm.journal)
            .register_target(warm.root)
            .available
        )
    with pytest.raises(InvalidRunTransitionError, match="not been published"):
        warm.journal.activate_run_attempt(
            attempt.attempt_id, expected_run_id="second"
        )
    assert (await follow_up(warm)).status_code == 201
    retry = warm.journal.list_run_attempts("second")
    assert len(retry) == 1 and retry[0].attempt_id == attempt.attempt_id
    assert retry[0].resume_request_id == attempt.resume_request_id
    assert retry[0].outcome is None
    assert (
        warm.journal.list_follow_up_requests(
            project_id="session", statuses=("pending", "admitted", "cancelled")
        )[0].status
        == "admitted"
    )
    assert (
        warm.journal.get_workspace_writer_request(
            "workspace-writer:second"
        ).status
        == "acquired"
    )
    item = warm.lock.queue.get_nowait()
    assert await activate(warm, item)
    assert not await activate(warm, item)


@pytest.mark.asyncio
async def test_failed_duplicate_does_not_release_published_writer(
    warm, monkeypatch
):
    write_and_finish(warm, "first.txt")
    await follow_up(warm)
    item = warm.lock.queue.get_nowait()
    writer = warm.journal.get_workspace_writer_request(
        "workspace-writer:second"
    )
    attempt_id = item.attempt_id
    with monkeypatch.context() as patcher:
        patcher.setattr(
            warm.lock,
            "put_queue",
            AsyncMock(side_effect=RuntimeError("duplicate queue failure")),
        )
        with pytest.raises(RuntimeError, match="duplicate queue failure"):
            await follow_up(warm)
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:second")
        == writer
    )
    assert warm.journal.get_active_project_run("session").run_id == "second"
    assert warm.lock.run_context.attempt_id == attempt_id
    assert await activate(warm, item)


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["attempt", "git", "publication"])
async def test_cancellation_drains_worker_before_cleanup(
    warm, monkeypatch, phase
):
    write_and_finish(warm, "first.txt")
    entered = threading.Event()
    release = threading.Event()
    owner, name = {
        "attempt": (warm.journal, "begin_warm_admission"),
        "git": (warm.workspace, "admit_run"),
        "publication": (warm.journal, "publish_warm_admission"),
    }[phase]
    original = getattr(owner, name)

    def paused(*args, **kwargs):
        result = original(*args, **kwargs)
        entered.set()
        assert release.wait(5), "test did not release the admission worker"
        return result

    with monkeypatch.context() as patcher:
        patcher.setattr(owner, name, paused)
        pending = asyncio.create_task(follow_up(warm))
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            pending.cancel()
            await asyncio.sleep(0)
            pending.cancel()
            await asyncio.sleep(0)
            assert not pending.done(), (
                "cancellation abandoned the admission worker"
            )
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError):
            await pending
    attempts = warm.journal.list_run_attempts("second")
    assert len(attempts) == 1
    if phase == "publication":
        assert attempts[0].outcome is None
        assert warm.lock.run_context.run_id == "second"
        assert (
            warm.journal.get_workspace_writer_request(
                "workspace-writer:second"
            ).status
            == "acquired"
        )
        assert await activate(warm, warm.lock.queue.get_nowait())
    else:
        assert attempts[0].outcome == "warm_admission_aborted"
        assert warm.lock.run_context.run_id == "first"
        assert (
            warm.journal.get_workspace_writer_request(
                "workspace-writer:second"
            )
            is None
        )
        assert warm.journal.get_active_project_run("session") is None
        await follow_up(warm)
        assert warm.lock.run_context.attempt_id == attempts[0].attempt_id


@pytest.mark.asyncio
@pytest.mark.parametrize("repeat_cancel", [False, True])
@pytest.mark.parametrize("phase", ["before_git", "after_git"])
async def test_skip_drains_unpublished_git_worker_before_stopping(
    warm, monkeypatch, repeat_cancel, phase
):
    from app.service import run_cancellation, single_agent_service
    from app.utils.event_loop_utils import set_main_event_loop

    write_and_finish(warm, "first.txt")
    targets = WorkspaceStateStore(warm.journal)
    targets.register_target(warm.root)
    entered = threading.Event()
    release = threading.Event()
    admit = warm.workspace.admit_run

    def paused(**kwargs):
        result = admit(**kwargs) if phase == "after_git" else None
        # Pause on both sides of acquisition, after the Attempt is owned.
        entered.set()
        assert release.wait(5), "test did not release Git admission"
        return admit(**kwargs) if phase == "before_git" else result

    monkeypatch.setattr(warm.workspace, "admit_run", paused)
    monkeypatch.setattr(
        controller, "get_task_lock_if_exists", lambda _: warm.lock
    )
    resolver = controller.get_workspace_resolver()
    frozen = resolver.freeze_task_directories_for.return_value

    def freeze(**kwargs):
        warm.lock.current_task_id = kwargs["task_id"]
        return frozen

    resolver.freeze_task_directories_for.side_effect = freeze
    monkeypatch.setattr(
        run_cancellation, "get_default_run_coordinator", lambda: warm.runtime
    )
    monkeypatch.setattr(warm.runtime, "_run_journal", lambda: warm.journal)
    monkeypatch.setattr(
        "app.workspace_git.get_default_workspace_git_lifecycle",
        lambda: warm.lifecycle,
    )
    finalize_memory = Mock()
    monkeypatch.setattr(
        single_agent_service, "_finalize_memory_for_turn", finalize_memory
    )
    monkeypatch.setattr(
        single_agent_service,
        "set_current_task_id",
        lambda _, task_id: setattr(warm.lock, "current_task_id", task_id),
    )
    waiting_after_duplicate_stop = asyncio.Event()
    get_queue = warm.lock.get_queue
    queue_reads = 0

    async def read_queue():
        nonlocal queue_reads
        queue_reads += 1
        if queue_reads == 3:
            waiting_after_duplicate_stop.set()
        return await get_queue()

    monkeypatch.setattr(warm.lock, "get_queue", read_queue)
    set_main_event_loop(asyncio.get_running_loop())
    stream = single_agent_service.single_agent_solve(
        SimpleNamespace(project_id="session", task_id="first"),
        warm.request,
        warm.lock,
    )
    pending = asyncio.create_task(follow_up(warm))
    stopped = asyncio.create_task(anext(stream))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        attempt = warm.journal.list_run_attempts("second")[0]
        response = await asyncio.to_thread(
            controller.skip_task, "session", expected_task_id="second"
        )
        assert response.status_code == 201
        done, _ = await asyncio.wait({stopped, pending}, timeout=0.1)
        assert not done, (
            "Stop terminalized while Git could still acquire a writer"
        )
        assert pending.cancelling(), (
            "Stop must interrupt unpublished admission"
        )
        if repeat_cancel:
            await asyncio.to_thread(
                controller.skip_task, "session", expected_task_id="second"
            )
            pending.cancel()
            pending.cancel()
            await asyncio.sleep(0)
        assert warm.journal.get_run("second").status == "pending"
        assert warm.journal.get_run("second").cancel_request_id is None
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await pending
        event = json.loads((await asyncio.wait_for(stopped, 5))[6:])
        assert event["step"] == "end"
        assert not finalize_memory.called, (
            "Stop must not rewrite the restored Run"
        )
        assert warm.lock.run_context.run_id == "first"
        assert (
            warm.journal.list_run_attempts("second")[0].outcome
            == "warm_admission_aborted"
        )
        assert warm.journal.get_active_project_run("session") is None
        assert (
            warm.journal.get_workspace_writer_request(
                "workspace-writer:second"
            )
            is None
        )
        assert targets.register_target(warm.root).available
        if repeat_cancel:
            # Resume the real consumer: the repeated Stop is stale after the
            # previous context is restored, and must not cancel that Run.
            stopped = asyncio.create_task(anext(stream))
            await asyncio.wait_for(waiting_after_duplicate_stop.wait(), 5)
            assert not stopped.done()
            assert warm.journal.get_run("first").status == "completed"
        monkeypatch.setattr(warm.workspace, "admit_run", admit)
        # A peer can immediately acquire the registered physical checkout.
        warm.journal.ensure_run(
            run_id="other", project_id="peer", status="pending"
        )
        peer = activation.WarmRunAdmission(
            warm.journal, warm.lock, logger=logging.getLogger(__name__)
        )
        await peer.prepare(
            replace(
                warm.lock.run_context,
                run_id="other",
                task_id="other",
                project_id="peer",
                attempt_id=None,
            ),
            request_id="other",
            environment=None,
        )
        assert peer.receipt.writer.status == "acquired"
        # Stop preserves the aborted Attempt identity for the same-key retry.
        await follow_up(warm)
        assert warm.lock.run_context.attempt_id == attempt.attempt_id
        assert (
            warm.journal.get_workspace_writer_request(
                "workspace-writer:second"
            ).status
            == "queued"
        )
        # Abort the unpublished peer through the same owned cleanup. FIFO
        # promotion lets the retry execute and checkpoint its own Run.
        await peer.abort()
        if not repeat_cancel:
            stopped = asyncio.create_task(anext(stream))
        confirmed = json.loads((await asyncio.wait_for(stopped, 5))[6:])
        assert confirmed["step"] == "confirmed"
        assert warm.journal.list_run_attempts("second")[0].status == "running"
        assert write_and_finish(warm, "second.txt") is not None
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)
        stopped.cancel()
        await asyncio.gather(stopped, return_exceptions=True)
        await stream.aclose()
        set_main_event_loop(None)


@pytest.mark.asyncio
async def test_cancellation_of_staged_envelope_cannot_execute(
    warm, monkeypatch
):
    write_and_finish(warm, "first.txt")
    entered = asyncio.Event()
    original = warm.lock.put_queue

    async def paused(item):
        await original(item)
        entered.set()
        await asyncio.Event().wait()

    with monkeypatch.context() as patcher:
        patcher.setattr(warm.lock, "put_queue", paused)
        pending = asyncio.create_task(follow_up(warm))
        await asyncio.wait_for(entered.wait(), 5)
        item = warm.lock.queue.get_nowait()
        consumer = asyncio.create_task(activate(warm, item))
        await asyncio.sleep(0)
        assert not consumer.done()
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert not await consumer
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:second")
        is None
    )
    assert warm.journal.get_active_project_run("session") is None
    await follow_up(warm)
    assert await activate(warm, warm.lock.queue.get_nowait())


@pytest.mark.asyncio
async def test_aborted_receipt_cannot_release_retry_writer(warm):
    write_and_finish(warm, "first.txt")
    context = replace(
        warm.lock.run_context,
        run_id="second",
        task_id="second",
        attempt_id=None,
    )
    warm.journal.ensure_run(
        run_id="second", project_id="session", status="pending"
    )
    first = activation.WarmRunAdmission(
        warm.journal, warm.lock, logger=logging.getLogger(__name__)
    )
    attempt = await first.prepare(
        context, request_id="stable-key", environment=None
    )
    stale = replace(first.receipt)
    await first.abort()
    second = activation.WarmRunAdmission(
        warm.journal, warm.lock, logger=logging.getLogger(__name__)
    )
    retried = await second.prepare(
        context, request_id="stable-key", environment=None
    )
    assert retried.attempt_id == attempt.attempt_id
    writer = warm.journal.get_workspace_writer_request(
        "workspace-writer:second"
    )
    with pytest.raises(InvalidRunTransitionError, match="ownership changed"):
        warm.journal.abort_warm_admission(stale)
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:second")
        == writer
    )
    assert warm.journal.get_active_project_run("session").run_id == "second"
    await second.abort()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "aborted", [False, True], ids=["preparing", "aborted"]
)
async def test_restart_does_not_terminalize_admission_markers(warm, aborted):
    write_and_finish(warm, "first.txt")
    context = replace(
        warm.lock.run_context,
        run_id="second",
        task_id="second",
        attempt_id=None,
    )
    warm.journal.ensure_run(
        run_id="second", project_id="session", status="pending"
    )
    admission = activation.WarmRunAdmission(
        warm.journal, warm.lock, logger=logging.getLogger(__name__)
    )
    await admission.prepare(context, request_id="second", environment=None)
    if aborted:
        await admission.abort()

    warm.journal.reconcile_startup()

    attempt = warm.journal.list_run_attempts("second")[0]
    assert attempt.status == "interrupted"
    assert attempt.outcome == "runtime.interrupted"


def admit_other(warm):
    warm.journal.ensure_run(
        run_id="other", project_id="peer", status="pending"
    )
    warm.journal.create_run_attempt(
        "other", request_id="other", reason="initial_execution"
    )
    return warm.workspace.admit_run(
        space_id="space",
        project_id="peer",
        run_id="other",
        task_id="other",
        session_mode="single-agent",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("promote_during_queue", [False, True])
async def test_queued_abort_never_releases_the_other_run(
    warm, monkeypatch, promote_during_queue
):
    write_and_finish(warm, "first.txt")
    other = admit_other(warm).writer.request

    async def reject(item):
        writer = warm.journal.get_workspace_writer_request(
            "workspace-writer:second"
        )
        assert writer.status == "queued"
        if promote_during_queue:
            warm.workspace.writer_scheduler.finish_task(run_id="other")
            assert (
                warm.journal.get_workspace_writer_request(
                    "workspace-writer:second"
                ).status
                == "acquired"
            )
        raise RuntimeError("queue failure")

    with monkeypatch.context() as patcher:
        patcher.setattr(warm.lock, "put_queue", reject)
        with pytest.raises(RuntimeError, match="queue failure"):
            await follow_up(warm)
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:second")
        is None
    )
    assert warm.journal.get_active_project_run("peer").run_id == "other"
    persisted = warm.journal.get_workspace_writer_request(other.request_id)
    assert persisted.status == (
        "released" if promote_during_queue else "acquired"
    )
    if not promote_during_queue:
        assert persisted == other
        warm.workspace.writer_scheduler.finish_task(run_id="other")
    await follow_up(warm)
    assert await activate(warm, warm.lock.queue.get_nowait())


@pytest.mark.asyncio
async def test_abort_promotes_only_the_existing_fifo_waiter(warm, monkeypatch):
    write_and_finish(warm, "first.txt")

    async def reject(item):
        assert admit_other(warm).writer.request.status == "queued"
        raise RuntimeError("queue failure")

    monkeypatch.setattr(warm.lock, "put_queue", reject)
    with pytest.raises(RuntimeError, match="queue failure"):
        await follow_up(warm)
    writer = warm.journal.get_workspace_writer_request(
        "workspace-writer:other"
    )
    assert writer.status == "acquired"
    lease = warm.journal.get_workspace_writer_lease(
        repository_id=writer.repository_id, checkout_id=writer.checkout_id
    )
    assert lease.task_id == "other" and lease.project_id == "peer"
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:second")
        is None
    )


@pytest.mark.asyncio
async def test_abort_refuses_unknown_tool_side_effects(warm):
    from app.run_policy import ToolSafetyClass

    write_and_finish(warm, "first.txt")
    context = replace(
        warm.lock.run_context,
        run_id="second",
        task_id="second",
        attempt_id=None,
    )
    warm.journal.ensure_run(
        run_id="second", project_id="session", status="pending"
    )
    admission = activation.WarmRunAdmission(
        warm.journal, warm.lock, logger=logging.getLogger(__name__)
    )
    attempt = await admission.prepare(
        context, request_id="stable-key", environment=None
    )
    for status in ("prepared", "dispatched", "outcome_unknown"):
        warm.journal.checkpoint_tool_call(
            tool_call_id="unsafe",
            run_id="second",
            attempt_id=attempt.attempt_id,
            tool_name="external_write",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            status=status,
        )
    writer = warm.journal.get_workspace_writer_request(
        "workspace-writer:second"
    )
    with pytest.raises(InvalidRunTransitionError, match="execution evidence"):
        await admission.abort()
    assert (
        warm.journal.get_workspace_writer_request(writer.request_id) == writer
    )
    assert warm.journal.get_active_project_run("session").run_id == "second"
    assert (
        warm.journal.list_tool_calls("second")[0].status == "outcome_unknown"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("warm", [False], indirect=True)
async def test_gitless_follow_up_still_publishes_and_activates(warm):
    assert write_and_finish(warm, "first.txt") is None
    await follow_up(warm)
    assert (
        warm.journal.get_workspace_writer_request("workspace-writer:second")
        is None
    )
    assert await activate(warm, warm.lock.queue.get_nowait())
    assert write_and_finish(warm, "second.txt") is None


@pytest.mark.asyncio
async def test_workforce_follow_up_keeps_internal_writer_identity(warm):
    write_and_finish(warm, "first.txt")
    warm.lock.run_context = replace(
        warm.lock.run_context, session_mode="workforce"
    )
    await follow_up(warm)
    writer = warm.journal.get_workspace_writer_request(
        "workspace-writer:second"
    )
    binding = warm.journal.get_project_workspace_binding("session")
    assert writer.task_id == "second"
    assert writer.checkout_id != binding.checkout_id
    assert writer.checkout_id.startswith("checkout_internal_")
    assert await activate(warm, warm.lock.queue.get_nowait())


@pytest.mark.asyncio
async def test_publication_gate_works_across_consumer_event_loops(warm):
    from concurrent.futures import Future

    from app.service.task import ActionImproveData, ImprovePayload

    item = ActionImproveData(data=ImprovePayload(question="test gate"))
    item._publication = Future()
    started = threading.Event()

    def consume():
        async def wait():
            started.set()
            return await activate(warm, item)

        return asyncio.run(wait())

    pending = asyncio.create_task(asyncio.to_thread(consume))
    try:
        assert await asyncio.to_thread(started.wait, 5)
    finally:
        item._publication.set_result(False)
    assert not await pending
    assert "_publication" not in item.model_dump()


@pytest.mark.asyncio
async def test_duplicate_publications_execute_once_and_conflicting_key_is_rejected(
    warm,
):
    write_and_finish(warm, "first.txt")
    await follow_up(warm)
    first = warm.lock.queue.get_nowait()
    writer = warm.journal.get_workspace_writer_request(
        "workspace-writer:second"
    )
    await follow_up(warm)
    second = warm.lock.queue.get_nowait()
    assert second.attempt_id == first.attempt_id
    assert (
        warm.journal.get_workspace_writer_request(writer.request_id) == writer
    )
    assert len(warm.journal.list_run_attempts("second")) == 1
    conflict = await controller.improve(
        "session",
        SupplementChat(question="different input", task_id="second"),
        warm.request,
    )
    assert conflict.status_code == 409
    assert warm.lock.queue.empty()
    assert await activate(warm, first)
    assert not await activate(warm, second)
    assert (await follow_up(warm)).status_code == 201
    assert warm.lock.queue.empty()


@pytest.mark.asyncio
@pytest.mark.parametrize("committed", [False, True])
async def test_publication_failure_respects_the_commit_boundary(
    warm, monkeypatch, committed
):
    write_and_finish(warm, "first.txt")
    original = warm.journal.publish_warm_admission

    def fail(receipt):
        if committed:
            original(receipt)
        raise RuntimeError("publication failed")

    with monkeypatch.context() as patcher:
        patcher.setattr(warm.journal, "publish_warm_admission", fail)
        with pytest.raises(RuntimeError, match="publication failed"):
            await follow_up(warm)
    item = warm.lock.queue.get_nowait()
    assert (await activate(warm, item)) is committed
    if committed:
        assert (
            warm.journal.get_workspace_writer_request(
                "workspace-writer:second"
            ).status
            == "acquired"
        )
        assert warm.lock.run_context.run_id == "second"
    else:
        assert (
            warm.journal.get_workspace_writer_request(
                "workspace-writer:second"
            )
            is None
        )
        assert warm.lock.run_context.run_id == "first"
        await follow_up(warm)
        assert warm.lock.run_context.attempt_id == item.attempt_id
