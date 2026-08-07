from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.controller.run_controller import (
    CancelRunBody,
    ForkRunBody,
    ResumeRunBody,
    RunSignalBody,
    cancel_run,
    fork_run,
    list_project_runs,
    resume_run,
    signal_run,
)
from app.run_journal import SQLiteRunJournal
from app.run_runtime import RunCoordinator


@pytest.mark.asyncio
async def test_run_control_api_creates_attempt_fork_and_cancel_intent(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.reconcile_startup(now=1)
        coordinator = RunCoordinator(journal)
        with patch(
            "app.controller.run_controller.get_default_run_coordinator",
            return_value=coordinator,
        ):
            resumed = await resume_run(
                "run-1",
                ResumeRunBody(request_id="resume-1"),
            )
            assert resumed["attempt"]["status"] == "pending"
            assert resumed["execution_state"] == "awaiting_execution_context"

            forked = await fork_run(
                "run-1",
                ForkRunBody(request_id="fork-1", new_run_id="run-fork"),
            )
            assert forked["run"]["parent_run_id"] == "run-1"
            assert forked["requires_resume"] is True

            cancelled = await cancel_run(
                "run-1",
                CancelRunBody(request_id="cancel-1"),
            )
            assert cancelled["status"] == "cancelled"
        await coordinator.close()


@pytest.mark.asyncio
async def test_signal_api_rejects_cross_run_approval_mutation(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.ensure_run(run_id="run-2", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Continue?"},
            now=2,
        )
        with patch(
            "app.controller.run_controller.get_default_run_journal",
            return_value=journal,
        ):
            with pytest.raises(HTTPException) as error:
                await signal_run(
                    "run-2",
                    RunSignalBody(
                        signal_type="approval.decided",
                        signal_id="signal-1",
                        payload={
                            "approval_id": "approval-1",
                            "decision": "approved",
                            "expected_version": 0,
                        },
                    ),
                )
        assert error.value.status_code == 409
        assert journal.list_approvals("run-1")[0].status == "pending"


@pytest.mark.asyncio
async def test_list_project_runs_reads_canonical_interrupted_state(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="older", project_id="project-1", now=1
        )
        journal.create_run_attempt(
            "older",
            request_id="initial-older",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.reconcile_startup(now=2)
        journal.ensure_run(
            run_id="other", project_id="project-2", now=3
        )
        with patch(
            "app.controller.run_controller.get_default_run_journal",
            return_value=journal,
        ):
            result = await list_project_runs(
                project_id="project-1",
                status=["interrupted"],
                limit=1,
            )

    assert [run["run_id"] for run in result["runs"]] == ["older"]
    assert result["runs"][0]["status"] == "interrupted"
    # Startup recovery must not count the unobserved process-down interval as
    # active execution time. This attempt never persisted a later heartbeat.
    assert result["runs"][0]["total_attempt_elapsed_ms"] == 0
