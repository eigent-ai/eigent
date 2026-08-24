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

import asyncio

import pytest

from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.workspace_git import WorkspaceWriterScheduler


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def _binding(journal: SQLiteRunJournal, project_id: str):
    if journal.get_git_repository("repo-1") is None:
        journal.put_git_repository(
            repository_id="repo-1",
            space_id="space-1",
            repository_role="content",
            root_path="/tmp/space-1",
            root_path_digest="a" * 64,
            ownership="eigent_owned",
            state="ready",
            version_coverage="full",
            now=1,
        )
    return journal.ensure_project_workspace_binding(
        project_id=project_id,
        repository_id="repo-1",
        checkout_id="checkout-primary",
        checkout_mode="primary_checkout",
        target_ref="refs/heads/main",
        worktree_path="/tmp/space-1",
    )


@pytest.mark.asyncio
async def test_scheduler_waits_across_projects_and_projects_queue_events(
    journal,
):
    scheduler = WorkspaceWriterScheduler(
        journal,
        poll_interval_seconds=0.01,
    )
    for run_id, project_id in (
        ("run-1", "project-1"),
        ("run-2", "project-2"),
    ):
        journal.ensure_run(run_id=run_id, project_id=project_id)

    first = scheduler.admit_task(
        run_id="run-1",
        task_id="task-1",
        project_id="project-1",
        binding=_binding(journal, "project-1"),
    )
    second = scheduler.admit_task(
        run_id="run-2",
        task_id="task-2",
        project_id="project-2",
        binding=_binding(journal, "project-2"),
    )

    assert first.request.status == "acquired"
    assert second.request.status == "queued"
    assert second.request.blocker_task_id == "task-1"
    waiter = asyncio.create_task(
        scheduler.wait_until_acquired(run_id="run-2", task_id="task-2")
    )
    await asyncio.sleep(0.03)
    assert not waiter.done()

    released = scheduler.finish_task(run_id="run-1", task_id="task-1")
    acquired = await asyncio.wait_for(waiter, timeout=1)

    assert released is not None and released.status == "released"
    assert acquired is not None and acquired.status == "acquired"
    assert [event.event_type for event in journal.list_events("run-1")] == [
        "workspace.writer.acquired",
        "workspace.writer.released",
    ]
    assert [event.event_type for event in journal.list_events("run-2")] == [
        "workspace.writer.queued",
        "workspace.writer.acquired",
    ]
    queued, ready = journal.list_events("run-2")
    assert queued.payload["waited"] is False
    assert queued.payload["semantic"] == {
        "kind": "workspace_writer",
        "subject": {
            "type": "writer_request",
            "id": "workspace-writer:run-2",
        },
        "actor": {"type": "system"},
        "lifecycle": {"phase": "requested", "status": "pending"},
        "correlation": {
            "task_id": "task-2",
            "project_id": "project-2",
            "checkout_id": "checkout-primary",
        },
        "completeness": {"state": "complete", "missing_fields": []},
        "provenance": {"source": "workspace_writer_scheduler"},
    }
    assert ready.payload["waited"] is True
    assert ready.payload["wait_duration_ms"] >= 0


def test_scheduler_interrupts_a_terminal_task_that_never_acquired(journal):
    scheduler = WorkspaceWriterScheduler(journal)
    for run_id, project_id in (
        ("run-1", "project-1"),
        ("run-2", "project-2"),
    ):
        journal.ensure_run(run_id=run_id, project_id=project_id)
    scheduler.admit_task(
        run_id="run-1",
        task_id="task-1",
        project_id="project-1",
        binding=_binding(journal, "project-1"),
    )
    scheduler.admit_task(
        run_id="run-2",
        task_id="task-2",
        project_id="project-2",
        binding=_binding(journal, "project-2"),
    )

    interrupted = scheduler.finish_task(run_id="run-2", task_id="task-2")

    assert interrupted is not None and interrupted.status == "interrupted"
    assert (
        journal.get_workspace_writer_lease(
            repository_id="repo-1",
            checkout_id="checkout-primary",
        ).task_id
        == "task-1"
    )
    assert journal.list_events("run-2")[-1].event_type == (
        "workspace.writer.interrupted"
    )


def test_scheduler_does_not_reemit_a_legacy_terminal_writer_event(journal):
    scheduler = WorkspaceWriterScheduler(journal)
    journal.ensure_run(run_id="run-1", project_id="project-1")
    admission = scheduler.admit_task(
        run_id="run-1",
        task_id="task-1",
        project_id="project-1",
        binding=_binding(journal, "project-1"),
    )
    released = journal.release_workspace_writer(
        request_id=admission.request.request_id,
        task_id="task-1",
    ).finished
    event_id = "workspace.writer.released:workspace-writer:run-1:0:none"
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id=event_id,
            event_type="workspace.writer.released",
            payload={"legacy": True},
        ),
    )

    replay = scheduler.finish_task(run_id="run-1", task_id="task-1")

    assert replay == released
    stored = next(
        event
        for event in journal.list_events("run-1")
        if event.event_id == event_id
    )
    assert stored.payload == {"legacy": True}


def test_startup_reclaims_only_writer_admissions_without_an_attempt(journal):
    scheduler = WorkspaceWriterScheduler(journal)
    for run_id, project_id in (
        ("run-orphan", "project-orphan"),
        ("run-resumable", "project-resumable"),
    ):
        journal.ensure_run(
            run_id=run_id,
            project_id=project_id,
            status="pending",
        )
    journal.create_run_attempt(
        "run-resumable",
        request_id="initial:run-resumable",
        reason="initial_execution",
        activate=False,
        now=2,
    )

    orphan = scheduler.admit_task(
        run_id="run-orphan",
        task_id="task-orphan",
        project_id="project-orphan",
        binding=_binding(journal, "project-orphan"),
    )
    resumable = scheduler.admit_task(
        run_id="run-resumable",
        task_id="task-resumable",
        project_id="project-resumable",
        binding=_binding(journal, "project-resumable"),
    )
    journal.reconcile_startup(now=3)

    result = scheduler.reconcile_orphaned_admissions()

    assert result.interrupted_request_ids == (orphan.request.request_id,)
    assert result.promoted_request_ids == (resumable.request.request_id,)
    assert result.preserved_request_ids == (resumable.request.request_id,)
    assert result.failed_request_ids == ()
    assert (
        journal.get_workspace_writer_request(orphan.request.request_id).status
        == "interrupted"
    )
    assert (
        journal.get_workspace_writer_request(
            resumable.request.request_id
        ).status
        == "acquired"
    )
    lease = journal.get_workspace_writer_lease(
        repository_id="repo-1",
        checkout_id="checkout-primary",
    )
    assert lease is not None and lease.task_id == "task-resumable"
    assert journal.get_run("run-orphan").status == "cancelled"
    assert journal.list_events("run-orphan")[-1].event_type == "run.cancelled"
    assert journal.list_events("run-resumable")[-1].event_type == (
        "workspace.writer.acquired"
    )


def test_startup_terminalizes_zero_attempt_run_after_writer_was_reclaimed(
    journal,
):
    scheduler = WorkspaceWriterScheduler(journal)
    journal.ensure_run(
        run_id="run-already-reclaimed",
        project_id="project-already-reclaimed",
        status="pending",
    )
    admission = scheduler.admit_task(
        run_id="run-already-reclaimed",
        task_id="task-already-reclaimed",
        project_id="project-already-reclaimed",
        binding=_binding(journal, "project-already-reclaimed"),
    )
    journal.interrupt_workspace_writer(
        request_id=admission.request.request_id,
        task_id="task-already-reclaimed",
    )

    result = scheduler.reconcile_orphaned_admissions()

    assert result.interrupted_request_ids == ()
    assert result.failed_request_ids == ()
    assert journal.get_run("run-already-reclaimed").status == "cancelled"
    assert journal.list_events("run-already-reclaimed")[-1].event_type == (
        "run.cancelled"
    )
