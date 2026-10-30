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
from unittest.mock import patch

import pytest

from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.run_journal.recorder import EventRecorder
from app.run_runtime.step_coordinator import (
    InvalidStepTransitionError,
    PlanStepInput,
    RunStepCoordinator,
)


def _journal(tmp_path) -> SQLiteRunJournal:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    return journal


def _item(
    plan_item_id: str,
    status: str,
    *,
    title: str = "Inspect the workspace",
    ordinal: int = 1,
) -> PlanStepInput:
    return PlanStepInput(
        plan_item_id=plan_item_id,
        title=title,
        active_form=f"{title} in progress",
        status=status,  # type: ignore[arg-type]
        ordinal=ordinal,
    )


@pytest.mark.unit
def test_step_replay_filters_at_sql_boundary(tmp_path):
    with _journal(tmp_path) as journal:
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="unrelated",
                event_type="tool.completed",
                payload={"tool_call_id": "tool-1"},
            ),
        )
        coordinator = RunStepCoordinator(journal)

        with patch.object(
            journal, "list_events", wraps=journal.list_events
        ) as list_events:
            assert coordinator.replay("run-1") == {}

        list_events.assert_called_once_with("run-1", event_type_prefix="step.")


@pytest.mark.unit
def test_plan_reconciliation_emits_authored_step_lifecycle(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        created = coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )
        completed = coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "completed")],
        )

        assert [event.event_type for event in created] == [
            "step.created",
            "step.started",
        ]
        assert [event.event_type for event in completed] == ["step.completed"]
        snapshot = next(iter(coordinator.replay("run-1").values()))
        assert snapshot.plan_item_id == "pli-1"
        assert snapshot.status == "completed"
        assert snapshot.agent_id == "agent-1"
        semantic = completed[0].payload
        assert semantic["semantic_schema_version"] == 2
        assert semantic["semantic"]["kind"] == "step"
        assert semantic["semantic"]["correlation"]["plan_item_id"] == "pli-1"


@pytest.mark.unit
def test_plan_reorder_keeps_step_identity_and_records_progress(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )
        before = coordinator.current_running_step_id("run-1")
        events = coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[
                _item(
                    "pli-1",
                    "in_progress",
                    title="Inspect source and tests",
                    ordinal=2,
                )
            ],
        )

        assert [event.event_type for event in events] == ["step.progress"]
        assert coordinator.current_running_step_id("run-1") == before


@pytest.mark.unit
def test_legacy_notice_projection_inherits_explicit_running_step(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )
        step_id = coordinator.current_running_step_id("run-1")
        assert step_id is not None

        event = asyncio.run(
            EventRecorder(journal).record_legacy_step(
                project_id="project-1",
                run_id="run-1",
                step="notice",
                data={
                    "notice_id": "notice:call-1",
                    "title": "Repository checked",
                    "content": "Validated the repository structure.",
                    "tool_call_id": "call-1",
                },
            )
        )

        assert event.event_type == "notice.progress"
        assert event.payload["title"] == "Repository checked"
        assert event.payload["step_id"] == step_id
        assert event.payload["semantic"]["correlation"]["step_id"] == step_id


@pytest.mark.unit
def test_agent_can_record_bounded_progress_for_running_plan_item(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )

        event = coordinator.record_progress(
            project_id="project-1",
            run_id="run-1",
            plan_item_id="pli-1",
            summary="Located the ownership mismatch in the recovery path.",
            agent_id="agent-1",
        )

        assert event.event_type == "step.progress"
        assert event.payload["step"]["summary"] == (
            "Located the ownership mismatch in the recovery path."
        )
        step_id = event.payload["step"]["step_id"]
        assert coordinator.replay("run-1")[step_id].status == "running"

        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "completed")],
        )
        completed = coordinator.replay("run-1")[step_id]
        assert completed.status == "completed"
        assert completed.summary == (
            "Located the ownership mismatch in the recovery path."
        )


@pytest.mark.unit
def test_terminal_step_cannot_restart(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id=None,
            items=[_item("pli-1", "completed")],
        )

        with pytest.raises(InvalidStepTransitionError):
            coordinator.reconcile_plan(
                project_id="project-1",
                run_id="run-1",
                agent_id=None,
                items=[_item("pli-1", "in_progress")],
            )


@pytest.mark.unit
def test_failed_child_step_blocks_its_running_parent(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )
        parent_step_id = coordinator.current_running_step_id("run-1")
        assert parent_step_id is not None
        child_step_id = coordinator.create_child_step(
            project_id="project-1",
            run_id="run-1",
            parent_step_id=parent_step_id,
            task_identity="call-1",
            title="Review the implementation",
            agent_id="reviewer",
        )

        coordinator.finish_child_step(
            project_id="project-1",
            run_id="run-1",
            step_id=child_step_id,
            outcome="failed",
            summary="Review found a blocking issue.",
        )

        snapshots = coordinator.replay("run-1")
        assert snapshots[child_step_id].status == "failed"
        assert snapshots[parent_step_id].status == "blocked"
        assert snapshots[parent_step_id].summary == (
            "Delegated sub-agent needs attention."
        )


@pytest.mark.unit
def test_running_step_lookup_never_guesses_between_parent_and_child(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )
        parent_step_id = coordinator.current_running_step_id(
            "run-1", agent_id="agent-1"
        )
        assert parent_step_id is not None
        child_step_id = coordinator.create_child_step(
            project_id="project-1",
            run_id="run-1",
            parent_step_id=parent_step_id,
            task_identity="call-1",
            title="Review the implementation",
            agent_id="reviewer",
        )

        assert coordinator.current_running_step_id("run-1") is None
        assert (
            coordinator.current_running_step_id("run-1", agent_id="agent-1")
            == parent_step_id
        )
        assert (
            coordinator.current_running_step_id("run-1", agent_id="reviewer")
            == child_step_id
        )


@pytest.mark.unit
def test_plan_reconciliation_does_not_cancel_running_subagent_step(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )
        parent_step_id = coordinator.current_running_step_id(
            "run-1", agent_id="agent-1"
        )
        assert parent_step_id is not None
        child_step_id = coordinator.create_child_step(
            project_id="project-1",
            run_id="run-1",
            parent_step_id=parent_step_id,
            task_identity="call-1",
            title="Review the implementation",
            agent_id="reviewer",
        )

        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )

        snapshots = coordinator.replay("run-1")
        assert snapshots[parent_step_id].status == "running"
        assert snapshots[child_step_id].status == "running"
        assert snapshots[child_step_id].source == "subagent"


@pytest.mark.unit
def test_run_interruption_preserves_step_identity_for_resume(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )
        step_id = coordinator.current_running_step_id("run-1")
        run = journal.get_run("run-1")
        assert run is not None

        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="runtime-interrupted-1",
                event_type="runtime.interrupted",
                payload={"reason": "brain_restart"},
            ),
        )

        interrupted = coordinator.replay("run-1")[step_id]
        assert interrupted.status == "interrupted"
        interruption = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "step.interrupted"
        )
        assert interruption.payload["semantic"]["provenance"]["source"] == (
            "run_terminal_reconciliation"
        )

        journal.create_run_attempt(
            "run-1",
            request_id="resume-1",
            reason="explicit_resume",
            activate=True,
        )
        resumed = coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[_item("pli-1", "in_progress")],
        )

        assert [event.event_type for event in resumed] == ["step.resumed"]
        assert coordinator.current_running_step_id("run-1") == step_id


@pytest.mark.unit
def test_completed_run_cancels_plan_steps_that_never_started(tmp_path):
    with _journal(tmp_path) as journal:
        coordinator = RunStepCoordinator(journal)
        coordinator.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[
                _item("pli-running", "in_progress", ordinal=1),
                _item("pli-pending", "pending", ordinal=2),
            ],
        )

        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="run-completed-1",
                event_type="run.completed",
                payload={"reason": "task_finished"},
            ),
        )

        snapshots = {
            snapshot.plan_item_id: snapshot
            for snapshot in coordinator.replay("run-1").values()
        }
        assert snapshots["pli-running"].status == "completed"
        assert snapshots["pli-pending"].status == "cancelled"
