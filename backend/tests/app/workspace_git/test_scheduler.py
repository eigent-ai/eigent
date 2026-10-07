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

from app.run_journal import (
    RunEventDraft,
    SQLiteRunJournal,
    UnsafeResumeError,
    WorkspaceWriterLeaseLostError,
)
from app.run_policy import TimeoutOutcome, TimeoutScope, ToolSafetyClass
from app.workspace_git import WorkspaceWriterScheduler
from app.workspace_runtime.store import WorkspaceStateStore


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def _binding(
    journal: SQLiteRunJournal,
    project_id: str,
    worktree_path: str = "/tmp/space-1",
):
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
        worktree_path=worktree_path,
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


def test_startup_reclaims_orphan_without_promoting_interrupted_attempt(
    journal,
):
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
    assert result.promoted_request_ids == ()
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
        == "queued"
    )
    lease = journal.get_workspace_writer_lease(
        repository_id="repo-1",
        checkout_id="checkout-primary",
    )
    assert lease is None
    assert journal.get_run("run-resumable").status == "interrupted"
    assert journal.get_run("run-orphan").status == "cancelled"
    assert journal.list_events("run-orphan")[-1].event_type == "run.cancelled"
    assert journal.list_events("run-resumable")[-1].event_type == (
        "runtime.interrupted"
    )
    later, _ = _admit_pending(scheduler, "later")
    assert later.status == "acquired"


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


def test_startup_leaves_a_timed_out_zero_attempt_run_terminal(journal):
    scheduler = WorkspaceWriterScheduler(journal)
    journal.ensure_run(
        run_id="run-timed-out", project_id="project-1", status="pending"
    )
    journal.append_event(
        "run-timed-out",
        RunEventDraft(
            event_type="run.deadline_reached",
            payload={"reason": "persisted_run_deadline_reached"},
        ),
    )

    result = scheduler.reconcile_orphaned_admissions()

    assert result.failed_request_ids == ()
    assert journal.get_run("run-timed-out").status == "timed_out"
    assert journal.list_events("run-timed-out")[-1].event_type == (
        "run.deadline_reached"
    )


def _admit_pending(scheduler, run_id, worktree_path="/tmp/space-1"):
    journal = scheduler.journal
    project_id = f"project-{run_id}"
    journal.ensure_run(run_id=run_id, project_id=project_id, status="pending")
    admission = scheduler.admit_task(
        run_id=run_id,
        task_id=run_id,
        project_id=project_id,
        binding=_binding(journal, project_id, worktree_path),
    )
    attempt = journal.create_run_attempt(
        run_id,
        request_id=f"initial:{run_id}",
        reason="initial_execution",
        activate=False,
    )
    return admission.request, attempt


@pytest.mark.asyncio
async def test_restart_skips_unstarted_writer_and_explicit_resume_can_acquire(
    tmp_path,
):
    path = tmp_path / "restart.sqlite3"
    with SQLiteRunJournal(path) as journal:
        scheduler = WorkspaceWriterScheduler(journal)
        owner, owner_attempt = _admit_pending(scheduler, "owner")
        journal.activate_run_attempt(owner_attempt.attempt_id)
        waiting, waiting_attempt = _admit_pending(scheduler, "waiting")
        assert waiting.status == "queued"

    for _ in range(2):
        with SQLiteRunJournal(path) as journal:
            scheduler = WorkspaceWriterScheduler(journal)
            journal.reconcile_startup()
            scheduler.reconcile_orphaned_admissions()
            scheduler.reclaim_lost_writers()
            assert journal.get_run_attempt(
                waiting_attempt.attempt_id
            ).status == ("interrupted")
            # The owner never dispatched a write, so restart reclaimed it.
            assert (
                journal.get_workspace_writer_lease(
                    repository_id="repo-1", checkout_id="checkout-primary"
                )
                is None
            )

    with SQLiteRunJournal(path) as journal:
        scheduler = WorkspaceWriterScheduler(
            journal, poll_interval_seconds=0.01
        )
        later, _ = _admit_pending(scheduler, "later")
        scheduler.finish_task(run_id="owner", task_id="owner")
        assert journal.get_workspace_writer_request(
            waiting.request_id
        ).status == ("queued")
        assert journal.get_workspace_writer_request(
            later.request_id
        ).status == ("acquired")
        assert not any(
            event.event_type == "workspace.writer.acquired"
            for event in journal.list_events("waiting")
        )
        scheduler.finish_task(run_id="later", task_id="later")
        assert (
            journal.get_workspace_writer_lease(
                repository_id="repo-1", checkout_id="checkout-primary"
            )
            is None
        )

        resumed = journal.create_run_attempt(
            "waiting", request_id="explicit-resume", reason="explicit_resume"
        )
        assert resumed.status == "pending"
        acquired = await asyncio.wait_for(
            scheduler.wait_until_acquired(run_id="waiting", task_id="waiting"),
            timeout=1,
        )
        assert acquired.status == "acquired"
        assert journal.get_run_attempt(waiting_attempt.attempt_id).status == (
            "interrupted"
        )
        journal.activate_run_attempt(resumed.attempt_id)
        assert journal.get_run_attempt(resumed.attempt_id).status == "running"


def test_legacy_settlement_skips_dormant_writer(journal, tmp_path):
    root = tmp_path / "space"
    root.mkdir()
    scheduler = WorkspaceWriterScheduler(journal)
    owner, _ = _admit_pending(scheduler, "owner", str(root))
    waiting, _ = _admit_pending(scheduler, "waiting", str(root))
    state = WorkspaceStateStore(journal)
    fence = state.register_target(root)
    assert fence.owner_id == owner.request_id
    journal.reconcile_startup()
    later, _ = _admit_pending(scheduler, "later", str(root))

    settled = state.settle_legacy_writer(
        fence, "owner-complete", process_receipt={"outcome": "stopped"}
    )

    assert settled.owner_id == later.request_id
    assert (
        journal.get_workspace_writer_request(waiting.request_id).status
        == "queued"
    )
    assert (
        journal.get_workspace_writer_lease(
            repository_id="repo-1", checkout_id="checkout-primary"
        ).request_id
        == later.request_id
    )


@pytest.mark.parametrize("cancel_first", [True, False])
def test_cancel_and_promotion_do_not_acquire_interrupted_waiter(
    tmp_path, cancel_first
):
    path = tmp_path / "cancel.sqlite3"
    with SQLiteRunJournal(path) as journal, SQLiteRunJournal(path) as peer:
        scheduler = WorkspaceWriterScheduler(journal)
        _admit_pending(scheduler, "owner")
        waiting, _ = _admit_pending(scheduler, "waiting")
        journal.reconcile_startup()
        later, _ = _admit_pending(scheduler, "later")

        def cancel():
            peer.request_cancel("waiting", request_id="cancel", reason="user")
            peer.complete_cancel("waiting", request_id="cancel")
            WorkspaceWriterScheduler(peer).finish_task(run_id="waiting")

        def release():
            scheduler.finish_task(run_id="owner")

        for action in (cancel, release) if cancel_first else (release, cancel):
            action()
        assert journal.get_workspace_writer_request(
            waiting.request_id
        ).status == ("interrupted")
        assert (
            journal.get_workspace_writer_lease(
                repository_id="repo-1", checkout_id="checkout-primary"
            ).request_id
            == later.request_id
        )
        assert not any(
            event.event_type == "workspace.writer.acquired"
            for event in journal.list_events("waiting")
        )


@pytest.mark.parametrize("queued", [False, True])
def test_restart_preserves_unknown_write_barrier(journal, queued):
    scheduler = WorkspaceWriterScheduler(journal)
    if queued:
        _admit_pending(scheduler, "owner")
    unsafe, attempt = _admit_pending(scheduler, "unsafe")
    # Exercise incomplete legacy evidence too: a tool dispatch is authoritative
    # even if its Attempt never recorded activation/consumer heartbeat.
    values = dict(
        tool_call_id="unsafe-tool",
        run_id="unsafe",
        attempt_id=attempt.attempt_id,
        tool_name="send_email",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
        request={"to": "user@example.com"},
    )
    journal.checkpoint_tool_call(status="prepared", **values)
    journal.checkpoint_tool_call(status="dispatched", **values)
    journal.reconcile_startup()
    scheduler.reconcile_orphaned_admissions()
    later, _ = _admit_pending(scheduler, "later")
    if queued:
        scheduler.finish_task(run_id="owner")
    assert journal.get_workspace_writer_request(unsafe.request_id).status == (
        "queued" if queued else "acquired"
    )
    assert (
        journal.get_workspace_writer_request(later.request_id).status
        == "queued"
    )
    assert journal.list_tool_calls("unsafe")[0].status == "outcome_unknown"
    with pytest.raises(UnsafeResumeError):
        journal.create_run_attempt(
            "unsafe", request_id="resume", reason="explicit_resume"
        )
    # A free lease does not allow a newly enqueued request to bypass uncertainty.
    newest, _ = _admit_pending(scheduler, "newest")
    assert newest.status == "queued"


@pytest.mark.parametrize(
    "evidence", ["activation", "changeset", "missing_creation"]
)
def test_restart_does_not_bypass_uncertain_queued_execution(journal, evidence):
    scheduler = WorkspaceWriterScheduler(journal)
    _admit_pending(scheduler, "owner")
    waiting, attempt = _admit_pending(scheduler, "waiting")
    if evidence == "activation":
        journal.activate_run_attempt(attempt.attempt_id)
    elif evidence == "changeset":
        journal.admit_git_run_workspace(
            run_id="waiting",
            project_id="project-waiting",
            repository_id="repo-1",
            user_head="a" * 40,
            user_ref="refs/heads/main",
        )
        journal.ensure_git_change_set(
            change_set_id="changes",
            run_id="waiting",
            repository_id="repo-1",
            worktree_ref="refs/heads/main",
            base_commit="a" * 40,
        )
    else:
        # Simulate legacy history without proof of pending-only admission.
        with journal._write_transaction() as connection:
            connection.execute(
                "UPDATE run_events SET payload_json='{}' WHERE event_id=?",
                (f"attempt:{attempt.attempt_id}:created",),
            )
    journal.reconcile_startup()
    scheduler.reconcile_orphaned_admissions()
    later, _ = _admit_pending(scheduler, "later")
    scheduler.finish_task(run_id="owner")
    assert (
        journal.get_workspace_writer_request(waiting.request_id).status
        == "queued"
    )
    assert (
        journal.get_workspace_writer_request(later.request_id).status
        == "queued"
    )
    assert (
        journal.get_workspace_writer_lease(
            repository_id="repo-1", checkout_id="checkout-primary"
        )
        is None
    )


def test_cancel_intent_prevents_promotion_before_attempt_is_closed(journal):
    scheduler = WorkspaceWriterScheduler(journal)
    _admit_pending(scheduler, "owner")
    waiting, attempt = _admit_pending(scheduler, "waiting")
    later, _ = _admit_pending(scheduler, "later")
    journal.request_cancel("waiting", request_id="cancel", reason="user")
    assert journal.get_run_attempt(attempt.attempt_id).status == "pending"
    scheduler.finish_task(run_id="owner")
    assert (
        journal.get_workspace_writer_request(waiting.request_id).status
        == "queued"
    )
    assert (
        journal.get_workspace_writer_lease(
            repository_id="repo-1", checkout_id="checkout-primary"
        ).request_id
        == later.request_id
    )


def _lease(journal):
    return journal.get_workspace_writer_lease(
        repository_id="repo-1", checkout_id="checkout-primary"
    )


@pytest.mark.asyncio
async def test_restart_reclaims_unstarted_holder_idempotently(tmp_path):
    path = tmp_path / "reclaim.sqlite3"
    with SQLiteRunJournal(path) as journal:
        scheduler = WorkspaceWriterScheduler(journal)
        owner, owner_attempt = _admit_pending(scheduler, "owner")
        journal.activate_run_attempt(owner_attempt.attempt_id)
        assert _lease(journal).holder_attempt_id == owner_attempt.attempt_id

    reclaimed = []
    for _ in range(2):
        with SQLiteRunJournal(path) as journal:
            scheduler = WorkspaceWriterScheduler(journal)
            journal.reconcile_startup()
            reconciliation = scheduler.reconcile_orphaned_admissions()
            assert reconciliation.preserved_request_ids == ()
            reclaimed.append(
                scheduler.reclaim_lost_writers().reclaimed_request_ids
            )
    assert reclaimed == [(owner.request_id,), ()]

    with SQLiteRunJournal(path) as journal:
        scheduler = WorkspaceWriterScheduler(
            journal, poll_interval_seconds=0.01
        )
        released = journal.get_workspace_writer_request(owner.request_id)
        assert (released.status, released.reason) == (
            "released",
            "holder_lost",
        )
        assert [
            event.payload["reason"]
            for event in journal.list_events("owner")
            if event.event_type == "workspace.writer.released"
        ] == ["holder_lost"]
        later, _ = _admit_pending(scheduler, "later")
        assert later.status == "acquired"
        scheduler.finish_task(run_id="later", task_id="later")

        # Resume queues the reclaimed Run again behind the FIFO.
        resumed = journal.create_run_attempt(
            "owner", request_id="resume", reason="explicit_resume"
        )
        acquired = await asyncio.wait_for(
            scheduler.wait_until_acquired(run_id="owner", task_id="owner"),
            timeout=1,
        )
        assert (acquired.status, acquired.reason) == (
            "acquired",
            "holder_lost_requeued",
        )
        assert _lease(journal).holder_attempt_id == resumed.attempt_id
        assert [
            event.event_type
            for event in journal.list_events("owner")
            if event.event_type.startswith("workspace.writer.")
        ] == [
            "workspace.writer.acquired",
            "workspace.writer.released",
            "workspace.writer.acquired",
        ]

        # Only a lost holder queues again; a normal release stays final.
        scheduler.finish_task(run_id="owner", task_id="owner")
        journal.record_timeout_outcome(
            TimeoutOutcome(
                scope=TimeoutScope.RUNTIME_LIVENESS,
                policy_version="v1",
                reason="consumer_lost",
                started_at=1,
                ended_at=2,
                run_id="owner",
                attempt_id=resumed.attempt_id,
            )
        )
        journal.create_run_attempt(
            "owner", request_id="resume-again", reason="explicit_resume"
        )
        assert (
            journal.get_workspace_writer_request(owner.request_id).status
            == "released"
        )


def test_restart_does_not_block_fifo_on_requeued_reclaimed_run(journal):
    scheduler = WorkspaceWriterScheduler(journal)
    a, a_attempt = _admit_pending(scheduler, "a")
    journal.activate_run_attempt(a_attempt.attempt_id)
    journal.reconcile_startup()
    scheduler.reconcile_orphaned_admissions()
    assert scheduler.reclaim_lost_writers().reclaimed_request_ids == (
        a.request_id,
    )
    b, b_attempt = _admit_pending(scheduler, "b")
    assert b.status == "acquired"
    journal.activate_run_attempt(b_attempt.attempt_id)
    journal.create_run_attempt(
        "a", request_id="resume", reason="explicit_resume"
    )
    assert journal.get_workspace_writer_request(a.request_id).status == (
        "queued"
    )

    journal.reconcile_startup()
    scheduler.reconcile_orphaned_admissions()
    assert scheduler.reclaim_lost_writers().reclaimed_request_ids == (
        b.request_id,
    )
    c, _ = _admit_pending(scheduler, "c")

    # A was proven clean when reclaimed and never held the lease again.
    assert c.status == "acquired"
    assert journal.get_workspace_writer_request(a.request_id).status == (
        "queued"
    )


@pytest.mark.parametrize(
    "evidence", ["outcome_unknown", "git_mutation", "direct_write"]
)
def test_restart_keeps_lease_with_unsettled_write(journal, evidence):
    scheduler = WorkspaceWriterScheduler(journal)
    owner, attempt = _admit_pending(scheduler, "owner")
    journal.activate_run_attempt(attempt.attempt_id)
    if evidence == "outcome_unknown":
        values = dict(
            tool_call_id="unsafe-tool",
            run_id="owner",
            attempt_id=attempt.attempt_id,
            tool_name="send_email",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"to": "user@example.com"},
        )
        journal.checkpoint_tool_call(status="prepared", **values)
        journal.checkpoint_tool_call(status="dispatched", **values)
    else:
        journal.admit_git_run_workspace(
            run_id="owner",
            project_id="project-owner",
            repository_id="repo-1",
            user_head="a" * 40,
            user_ref="refs/heads/main",
        )
        journal.ensure_git_change_set(
            change_set_id="changes",
            run_id="owner",
            repository_id="repo-1",
            worktree_ref="refs/heads/main",
            base_commit="a" * 40,
        )
    if evidence == "git_mutation":
        journal.ensure_git_mutation_intent(
            intent_id="intent",
            change_set_id="changes",
            operation_request_id="write",
            mutation_scope="broad_process",
            relative_path=None,
            preimage_digest=None,
            actor_id="agent",
            trigger="terminal",
            writer_lease=_lease(journal),
        )
    journal.reconcile_startup()
    scheduler.reconcile_orphaned_admissions()

    result = scheduler.reclaim_lost_writers()

    assert result.reclaimed_request_ids == ()
    assert journal.get_workspace_writer_request(owner.request_id).status == (
        "acquired"
    )
    later, _ = _admit_pending(scheduler, "later")
    assert later.blocker_task_id == "owner"


@pytest.mark.asyncio
async def test_waiter_learns_holder_requires_attention(journal):
    scheduler = WorkspaceWriterScheduler(journal, poll_interval_seconds=0.01)
    _admit_pending(scheduler, "owner")
    journal.admit_git_run_workspace(
        run_id="owner",
        project_id="project-owner",
        repository_id="repo-1",
        user_head="a" * 40,
        user_ref="refs/heads/main",
    )
    journal.ensure_git_change_set(
        change_set_id="changes",
        run_id="owner",
        repository_id="repo-1",
        worktree_ref="refs/heads/main",
        base_commit="a" * 40,
    )
    journal.reconcile_startup()
    scheduler.reconcile_orphaned_admissions()
    scheduler.reclaim_lost_writers()
    _admit_pending(scheduler, "later")

    waiter = asyncio.create_task(
        scheduler.wait_until_acquired(run_id="later", task_id="later")
    )
    await asyncio.sleep(0.05)

    assert not waiter.done()
    queued = [
        event.payload
        for event in journal.list_events("later")
        if event.event_type == "workspace.writer.queued"
    ]
    assert [payload["reason"] for payload in queued] == [
        "task.mutating_default",
        "holder_requires_attention",
    ]
    assert queued[-1]["blocker_task_id"] == "owner"
    assert queued[-1]["semantic"]["correlation"]["blocker_run_id"] == "owner"
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter


@pytest.mark.asyncio
async def test_waiter_reclaims_holder_interrupted_without_dispatched_write(
    journal,
):
    scheduler = WorkspaceWriterScheduler(journal, poll_interval_seconds=0.01)
    _, owner_attempt = _admit_pending(scheduler, "owner")
    journal.activate_run_attempt(owner_attempt.attempt_id)
    values = dict(
        tool_call_id="running-write",
        run_id="owner",
        attempt_id=owner_attempt.attempt_id,
        tool_name="write_file",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
    )
    journal.checkpoint_tool_call(status="prepared", **values)
    journal.checkpoint_tool_call(status="dispatched", **values)
    later, _ = _admit_pending(scheduler, "later")
    waiter = asyncio.create_task(
        scheduler.wait_until_acquired(run_id="later", task_id="later")
    )
    journal.record_timeout_outcome(
        TimeoutOutcome(
            scope=TimeoutScope.RUNTIME_LIVENESS,
            policy_version="v1",
            reason="consumer_lost",
            started_at=1,
            ended_at=2,
            run_id="owner",
            attempt_id=owner_attempt.attempt_id,
        )
    )
    await asyncio.sleep(0.05)
    # A dispatched write has an unknown outcome: never unlock it.
    assert not waiter.done()
    assert _lease(journal).request_id == "workspace-writer:owner"

    journal.checkpoint_tool_call(status="completed", result={}, **values)
    acquired = await asyncio.wait_for(waiter, timeout=1)

    assert acquired.request_id == later.request_id
    assert _lease(journal).holder_attempt_id is not None


def test_stale_holder_write_is_rejected_by_fence(journal):
    scheduler = WorkspaceWriterScheduler(journal)
    _admit_pending(scheduler, "owner")
    stale = _lease(journal)
    journal.reconcile_startup()
    scheduler.reconcile_orphaned_admissions()
    scheduler.reclaim_lost_writers()
    _admit_pending(scheduler, "later")
    assert _lease(journal).request_id == "workspace-writer:later"
    journal.admit_git_run_workspace(
        run_id="owner",
        project_id="project-owner",
        repository_id="repo-1",
        user_head="a" * 40,
        user_ref="refs/heads/main",
    )
    journal.ensure_git_change_set(
        change_set_id="changes",
        run_id="owner",
        repository_id="repo-1",
        worktree_ref="refs/heads/main",
        base_commit="a" * 40,
    )

    with pytest.raises(
        WorkspaceWriterLeaseLostError,
        match="Task does not own the bound checkout writer lease",
    ):
        journal.ensure_git_mutation_intent(
            intent_id="stale-intent",
            change_set_id="changes",
            operation_request_id="stale-write",
            mutation_scope="broad_process",
            relative_path=None,
            preimage_digest=None,
            actor_id="agent",
            trigger="terminal",
            exclusive_worktree=True,
            writer_lease=stale,
        )
    with pytest.raises(WorkspaceWriterLeaseLostError):
        journal.begin_git_operation(
            operation_id="stale-op",
            repository_id="repo-1",
            request_id="stale-checkpoint",
            operation_type="checkpoint.create",
            payload_digest="b" * 64,
            expected_repo_state_digest=None,
            writer_lease=stale,
        )
    assert journal.list_git_mutation_intents() == []
    assert journal.list_git_operations() == []


def test_resume_hands_lease_to_new_attempt_and_fences_old_one(journal):
    scheduler = WorkspaceWriterScheduler(journal)
    _, first = _admit_pending(scheduler, "owner")
    journal.activate_run_attempt(first.attempt_id)
    journal.record_timeout_outcome(
        TimeoutOutcome(
            scope=TimeoutScope.RUNTIME_LIVENESS,
            policy_version="v1",
            reason="consumer_lost",
            started_at=1,
            ended_at=2,
            run_id="owner",
            attempt_id=first.attempt_id,
        )
    )
    stale = _lease(journal)

    resumed = journal.create_run_attempt(
        "owner", request_id="resume", reason="explicit_resume"
    )

    lease = _lease(journal)
    assert (lease.holder_attempt_id, lease.version) == (
        resumed.attempt_id,
        stale.version + 1,
    )
    with pytest.raises(WorkspaceWriterLeaseLostError):
        journal.begin_git_operation(
            operation_id="stale-op",
            repository_id="repo-1",
            request_id="stale-checkpoint",
            operation_type="checkpoint.create",
            payload_digest="b" * 64,
            expected_repo_state_digest=None,
            writer_lease=stale,
        )
    assert journal.begin_git_operation(
        operation_id="current-op",
        repository_id="repo-1",
        request_id="current-checkpoint",
        operation_type="checkpoint.create",
        payload_digest="b" * 64,
        expected_repo_state_digest=None,
        writer_lease=lease,
    ).status == ("prepared")


@pytest.mark.parametrize("attached", [False, True])
def test_resume_attach_grace(journal, attached):
    scheduler = WorkspaceWriterScheduler(journal)
    owner, _ = _admit_pending(scheduler, "owner")
    journal.reconcile_startup(now=10)
    scheduler.reconcile_orphaned_admissions()
    scheduler.reclaim_lost_writers()
    resumed = journal.create_run_attempt(
        "owner", request_id="resume", reason="explicit_resume", now=20
    )
    later, _ = _admit_pending(scheduler, "later")
    # Promotion hands the requeued Run the lease before any consumer exists.
    assert later.blocker_task_id == "owner"
    acquired_at = _lease(journal).acquired_at
    if attached:
        journal.activate_run_attempt(resumed.attempt_id)

    within = journal.reclaim_lost_workspace_writer(
        repository_id="repo-1",
        checkout_id="checkout-primary",
        now=acquired_at + 60,
    )
    expired = journal.reclaim_lost_workspace_writer(
        repository_id="repo-1",
        checkout_id="checkout-primary",
        now=acquired_at + 61,
    )

    assert within is None
    if attached:
        assert expired is None
        assert _lease(journal).holder_attempt_id == resumed.attempt_id
        return
    assert expired.finished.reason == "holder_lost"
    assert expired.next_acquired.request_id == later.request_id
    # The unattached Resume has no side effects: it waits again at the tail.
    assert journal.get_run_attempt(resumed.attempt_id).status == "pending"
    assert journal.get_run("owner").status == "pending"
    requeued = journal.get_workspace_writer_request(owner.request_id)
    assert (requeued.status, requeued.reason, requeued.blocker_task_id) == (
        "queued",
        "holder_lost_requeued",
        "later",
    )
    scheduler.finish_task(run_id="later", task_id="later")
    assert _lease(journal).holder_attempt_id == resumed.attempt_id
