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
import threading

import pytest

from app.run_journal import SQLiteRunJournal
from app.workspace_runtime.bound_runtime import RuntimeBinding
from app.workspace_runtime.native_runtime import (
    NativeAgentRuntime,
    NativeRunOwner,
)
from app.workspace_runtime.ordinary import (
    finalize_ordinary_workspace,
    prepare_ordinary_workspace,
)


async def noop():
    pass


def admit(journal, source, run, project=None):
    project = project or "session-" + run
    journal.ensure_run(run_id=run, project_id=project, status="pending")
    workspace = prepare_ordinary_workspace(
        journal,
        owner=NativeRunOwner(project, run, "attempt-" + run),
        source_root=source,
    )
    workspace.admit(journal, request_id=run, reason="initial_execution")
    journal.activate_run_attempt(
        workspace.owner.attempt_id, expected_run_id=run
    )
    runtime = NativeAgentRuntime(
        RuntimeBinding(
            run, workspace.owner.attempt_id, 1, workspace.handle, "test", {}
        ),
        stop_resources=noop,
    )
    return workspace, runtime


@pytest.mark.asyncio
async def test_conflicting_output_is_retained_and_unrelated_run_integrates(
    tmp_path, monkeypatch
):
    from app.workspace_runtime.finalizer import WorkspaceFinalizer

    monkeypatch.setattr(
        "app.workspace_runtime.ordinary.ordinary_publication_authorized",
        lambda *_: True,
    )
    source = tmp_path / "space"
    source.mkdir()
    (source / "same.txt").write_text("base\n")
    with SQLiteRunJournal(tmp_path / "journal.sqlite") as journal:
        pairs = [
            admit(journal, source, name)
            for name in ("first", "second", "peer")
        ]
        for index, (workspace, runtime) in enumerate(pairs):
            path = "unrelated.txt" if index == 2 else "same.txt"

            async def write(_runtime):
                (workspace.handle.local_root / path).write_text(
                    workspace.owner.run_id + "\n"
                )

            await runtime.run(write)
            await finalize_ordinary_workspace(
                journal, workspace, runtime, "done", "completed"
            )
        assert (source / "same.txt").read_text() == "first\n"
        assert (source / "unrelated.txt").read_text() == "peer\n"
        rows = journal._connection.execute(
            "SELECT run_id,status FROM workspace_integration_requests ORDER BY run_id"
        ).fetchall()
        assert dict(rows) == {
            "first": "integrated",
            "second": "conflict",
            "peer": "integrated",
        }
        saved = WorkspaceFinalizer(journal).artifact_manifest(
            run_id="second", provider=pairs[1][0].provider
        )
        artifact = saved["artifacts"][0]
        assert (
            WorkspaceFinalizer(journal).read_artifact(
                run_id="second",
                artifact_id=artifact["artifact_id"],
                provider=pairs[1][0].provider,
            )
            == b"second\n"
        )
        from app.workspace_runtime.session_input import SessionInputConflict

        with pytest.raises(SessionInputConflict):
            prepare_ordinary_workspace(
                journal,
                owner=NativeRunOwner(
                    "session-second", "follow-up", "attempt-follow-up"
                ),
                source_root=source,
            )
        assert (
            journal._connection.execute(
                "SELECT COUNT(*) FROM workspace_revision_references WHERE owner='preparation:attempt-follow-up'"
            ).fetchone()[0]
            == 0
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["cancelled", "failed", "interrupted"])
async def test_unsuccessful_output_is_saved_without_publication(
    tmp_path, outcome
):
    from fastapi import HTTPException

    from app.run_journal import InvalidRunTransitionError
    from app.workspace_runtime.entry_guard import guard_legacy_execution_entry

    source = tmp_path / "space"
    source.mkdir()
    with SQLiteRunJournal(tmp_path / "journal.sqlite") as journal:
        workspace, runtime = admit(journal, source, "one", "session")

        async def write(_):
            (workspace.handle.local_root / "saved.txt").write_text("partial")

        await runtime.run(write)
        await finalize_ordinary_workspace(
            journal, workspace, runtime, "partial", outcome
        )
        assert not (source / "saved.txt").exists()
        assert journal.get_run("one").status == outcome
        assert (
            journal._connection.execute(
                "SELECT COUNT(*) FROM workspace_integration_requests"
            ).fetchone()[0]
            == 0
        )
        with pytest.raises(HTTPException) as rejected:
            await guard_legacy_execution_entry(
                journal, run_id="one", resume=True
            )
        assert (
            rejected.value.detail["code"]
            == "workspace_resume_recovery_required"
        )
        with pytest.raises(InvalidRunTransitionError):
            journal.create_run_attempt(
                "one", request_id="resume", reason="explicit_resume"
            )
        # A subsequent message is a distinct Run with a fresh owner.
        following, next_runtime = admit(journal, source, "two", "session")
        await finalize_ordinary_workspace(
            journal, following, next_runtime, "", "cancelled"
        )


@pytest.mark.asyncio
async def test_restart_retries_completed_run_publication_without_executing_again(
    tmp_path, monkeypatch
):
    from app.workspace_runtime.finalizer import WorkspaceFinalizer
    from app.workspace_runtime.ordinary_publication import (
        OrdinaryWorkspacePublisher,
    )

    monkeypatch.setattr(
        "app.workspace_runtime.ordinary.ordinary_publication_authorized",
        lambda *_: True,
    )
    source = tmp_path / "space"
    source.mkdir()
    db = tmp_path / "journal.sqlite"
    with SQLiteRunJournal(db) as journal:
        workspace, runtime = admit(journal, source, "one")

        async def write(_):
            (workspace.handle.local_root / "saved.txt").write_text("once")

        await runtime.run(write)
        await WorkspaceFinalizer(journal).finalize(
            workspace.owner, runtime, workspace.provider, "done", "completed"
        )
        assert not (source / "saved.txt").exists()
    with SQLiteRunJournal(db) as reopened:
        publisher = OrdinaryWorkspacePublisher(reopened)
        await asyncio.to_thread(publisher.drain_due)
        await asyncio.to_thread(publisher.drain_due)
        assert (source / "saved.txt").read_text() == "once"
        assert len(reopened.list_run_attempts("one")) == 1
        events = [
            event
            for event in reopened.list_events("one")
            if event.event_type == "workspace.integration.updated"
        ]
        assert len(events) == 1 and events[0].payload["status"] == "integrated"


@pytest.mark.asyncio
async def test_cancelled_preparation_joins_copy_before_exact_cleanup(
    tmp_path, monkeypatch
):
    from app.workspace_runtime import ordinary

    entered, release = threading.Event(), threading.Event()
    original = ordinary.prepare_ordinary_workspace
    captured = []

    def prepare(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        result = original(*args, **kwargs)
        captured.append(result)
        return result

    monkeypatch.setattr(ordinary, "prepare_ordinary_workspace", prepare)
    source = tmp_path / "space"
    source.mkdir()
    (source / "unchanged").write_text("base")
    with SQLiteRunJournal(tmp_path / "journal.sqlite") as journal:
        caller = asyncio.create_task(
            ordinary.prepare_ordinary_workspace_async(
                journal,
                owner=NativeRunOwner("session", "run", "attempt"),
                source_root=source,
            )
        )
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            caller.cancel()
            await asyncio.sleep(0)
            assert not caller.done()
            caller.cancel()
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await caller
            assert not captured[0].handle.local_root.exists()
            assert (source / "unchanged").read_text() == "base"
            assert (
                journal._connection.execute(
                    "SELECT COUNT(*) FROM workspace_revision_references WHERE owner='preparation:attempt'"
                ).fetchone()[0]
                == 0
            )
        finally:
            release.set()
            await asyncio.gather(caller, return_exceptions=True)


@pytest.mark.asyncio
async def test_source_owner_wait_is_durable_and_can_be_cancelled_before_admission(
    tmp_path,
):
    from app.workspace_runtime.ordinary import prepare_ordinary_workspace_async
    from app.workspace_runtime.store import WorkspaceStateStore

    source = tmp_path / "space"
    source.mkdir()
    with SQLiteRunJournal(tmp_path / "journal.sqlite") as journal:
        journal.ensure_run(
            run_id="waiting", project_id="session", status="pending"
        )
        state = WorkspaceStateStore(journal)
        target = state.register_target(source)
        state.acquire_target(
            target, owner_kind="integration", owner_id="existing-writer"
        )
        waiting = asyncio.create_task(
            prepare_ordinary_workspace_async(
                journal,
                owner=NativeRunOwner("session", "waiting", "attempt"),
                source_root=source,
            )
        )
        try:
            async with asyncio.timeout(2):
                while not any(
                    event.event_type == "workspace.preparation.waiting"
                    for event in journal.list_events("waiting")
                ):
                    await asyncio.sleep(0.01)
            assert not waiting.done()
            assert journal.list_run_attempts("waiting") == []
            journal.request_cancel(
                "waiting", request_id="stop", reason="user_stop"
            )
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(waiting, 2)
            assert state.target(target.target_id).owner_id == "existing-writer"
            assert not list(
                (tmp_path / "ordinary-executions" / "workspaces").glob("*")
            )
        finally:
            waiting.cancel()
            await asyncio.gather(waiting, return_exceptions=True)


@pytest.mark.asyncio
async def test_ordinary_runs_reuse_isolation_finalization_and_integration(
    tmp_path, monkeypatch
):
    # This protocol-only fixture has no EnvironmentSpec. The ordinary-entry
    # matrix separately exercises real permission resolution and grants.
    monkeypatch.setattr(
        "app.workspace_runtime.ordinary.ordinary_publication_authorized",
        lambda *_: True,
    )
    source = tmp_path / "space"
    source.mkdir()
    (source / "seed.txt").write_text("base\n")
    with SQLiteRunJournal(tmp_path / "journal.sqlite") as journal:
        workspaces, runtimes = [], []
        for index in (1, 2):
            run, project, attempt = (
                f"run-{index}",
                f"session-{index}",
                f"attempt-{index}",
            )
            journal.ensure_run(
                run_id=run, project_id=project, status="pending"
            )
            workspace = prepare_ordinary_workspace(
                journal,
                owner=NativeRunOwner(project, run, attempt),
                source_root=source,
            )
            journal.create_run_attempt(
                run,
                request_id=run,
                attempt_id=attempt,
                reason="initial_execution",
                activate=False,
            )
            workspace.bind(journal)
            journal.activate_run_attempt(attempt, expected_run_id=run)
            runtime = NativeAgentRuntime(
                RuntimeBinding(
                    run, attempt, 1, workspace.handle, "test-environment", {}
                ),
                stop_resources=noop,
            )
            workspaces.append(workspace)
            runtimes.append(runtime)
        assert (
            workspaces[0].handle.local_root != workspaces[1].handle.local_root
        )
        assert all(
            workspace.handle.local_root != source for workspace in workspaces
        )
        entered, release = asyncio.Event(), asyncio.Event()

        async def first(runtime):
            entered.set()
            await release.wait()
            (runtime.binding.workspace.local_root / "one.txt").write_text(
                "one\n"
            )
            return "one"

        async def second(runtime):
            assert entered.is_set() and not release.is_set()
            (runtime.binding.workspace.local_root / "two.txt").write_text(
                "two\n"
            )
            return "two"

        one = asyncio.create_task(runtimes[0].run(first))
        await entered.wait()
        assert await runtimes[1].run(second) == "two"
        await finalize_ordinary_workspace(
            journal, workspaces[1], runtimes[1], "two", "completed"
        )
        assert (source / "two.txt").read_text() == "two\n"
        release.set()
        assert await one == "one"
        await finalize_ordinary_workspace(
            journal, workspaces[0], runtimes[0], "one", "completed"
        )
        assert (source / "one.txt").read_text() == "one\n"
        assert (source / "two.txt").read_text() == "two\n"
        assert all(
            journal.get_run(f"run-{index}").status == "completed"
            for index in (1, 2)
        )
