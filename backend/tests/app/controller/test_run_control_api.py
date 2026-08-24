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

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.controller.run_controller import (
    CancelRunBody,
    ForkRunBody,
    InteractionDecisionBody,
    ResumeRunBody,
    RunSignalBody,
    cancel_run,
    decide_run_interaction,
    fork_run,
    list_project_runs,
    list_run_interactions,
    resume_run,
    signal_run,
)
from app.run_journal import SQLiteRunJournal
from app.run_runtime import RunCoordinator
from app.workspace_config.admission import (
    EnvironmentAdmissionService,
    LegacyEnvironmentImporter,
)


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
async def test_resume_control_inherits_latest_environment_binding(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-env", project_id="project-1")
        template = LegacyEnvironmentImporter().build_template(
            model_platform="openai",
            model_type="gpt-5",
            auth_source="api_key",
            requested_effort="high",
            allow_local_system=True,
        )
        environment = EnvironmentAdmissionService(journal).persist_for_run(
            run_id="run-env",
            space_id="space-1",
            working_directory=workspace,
            created_by="test-user",
            template=template,
        )
        journal.create_run_attempt(
            "run-env",
            request_id="initial:run-env",
            reason="initial_execution",
            activate=True,
            environment=environment.binding,
            now=1,
        )
        journal.reconcile_startup(now=2)

        coordinator = RunCoordinator(journal)
        with patch(
            "app.controller.run_controller.get_default_run_coordinator",
            return_value=coordinator,
        ):
            resumed = await resume_run(
                "run-env",
                ResumeRunBody(request_id="resume-env"),
            )

        attempt = resumed["attempt"]
        assert attempt["environment_spec_id"] == environment.spec.spec_id
        assert attempt["environment_spec_digest"] == environment.spec.digest
        assert attempt["thinking_effort_effective"] == "high"
        assert (
            attempt["provider_capability_revision"]
            == environment.spec.provider_capability_revision
        )
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
async def test_typed_interaction_api_lists_and_resolves_question(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        task_lock = AsyncMock()
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.create_human_interaction(
            interaction_id="question-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="choice",
            request={"question": "Pick one", "agent": "worker"},
            options=[
                {"id": "a", "label": "A"},
                {"id": "b", "label": "B"},
            ],
            now=2,
        )
        with (
            patch(
                "app.controller.run_controller.get_default_run_journal",
                return_value=journal,
            ),
            patch(
                "app.service.task.get_task_lock_if_exists",
                return_value=task_lock,
            ),
        ):
            listed = await list_run_interactions("run-1", status="pending")
            resolved = await decide_run_interaction(
                "run-1",
                "question-1",
                InteractionDecisionBody(
                    decision_request_id="decision-1",
                    decision={"option_id": "b"},
                    expected_version=0,
                ),
            )

        assert [item["interaction_id"] for item in listed["interactions"]] == [
            "question-1"
        ]
        assert [
            option["option_id"]
            for option in listed["interactions"][0]["options"]
        ] == [
            "a",
            "b",
        ]
        assert resolved["status"] == "resolved"
        task_lock.put_human_input.assert_awaited_once_with(
            "worker", '{"option_id":"b"}'
        )


@pytest.mark.asyncio
async def test_interaction_decision_converges_on_terminal_state(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        task_lock = AsyncMock()
        journal.ensure_run(run_id="run-1", project_id="project-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        approval = journal.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            prompt={"question": "Allow write?", "agent": "worker"},
            action_digest="digest-1",
            now=2,
        )
        journal.decide_approval(
            "approval-1",
            decision="rejected",
            expected_version=0,
            action_digest=approval.action_digest,
            decision_request_id="system-rejected",
            continue_active_attempt=True,
            now=3,
        )

        with (
            patch(
                "app.controller.run_controller.get_default_run_journal",
                return_value=journal,
            ),
            patch(
                "app.service.task.get_task_lock_if_exists",
                return_value=task_lock,
            ),
        ):
            result = await decide_run_interaction(
                "run-1",
                "approval-1",
                InteractionDecisionBody(
                    decision_request_id="stale-user-decision",
                    decision={"decision": "approved", "scope": "once"},
                    expected_version=0,
                    action_digest=approval.action_digest,
                ),
            )

        assert result["status"] == "resolved"
        assert journal.list_approvals("run-1")[0].status == "rejected"
        task_lock.put_human_input.assert_not_awaited()


@pytest.mark.asyncio
async def test_list_project_runs_reads_canonical_interrupted_state(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="older", project_id="project-1", now=1)
        journal.create_run_attempt(
            "older",
            request_id="initial-older",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.reconcile_startup(now=2)
        journal.ensure_run(run_id="other", project_id="project-2", now=3)
        with (
            patch(
                "app.controller.run_controller.get_default_run_journal",
                return_value=journal,
            ),
            patch(
                "app.run_sync.runtime.notify_default_cloud_sync_worker"
            ) as notify_sync,
            patch(
                "app.run_sync.runtime."
                "is_default_cloud_history_bootstrap_pending",
                return_value=True,
            ),
            patch(
                "app.run_sync.runtime.bootstrap_default_cloud_history",
                new_callable=AsyncMock,
            ) as bootstrap_history,
        ):
            result = await list_project_runs(
                project_id="project-1",
                status=["interrupted"],
                limit=1,
            )

    assert [run["run_id"] for run in result["runs"]] == ["older"]
    assert result["runs"][0]["status"] == "interrupted"
    assert result["cloud_restore_pending"] is True
    # Startup recovery must not count the unobserved process-down interval as
    # active execution time. This attempt never persisted a later heartbeat.
    assert result["runs"][0]["total_attempt_elapsed_ms"] == 0
    notify_sync.assert_called_once_with()
    bootstrap_history.assert_not_awaited()
