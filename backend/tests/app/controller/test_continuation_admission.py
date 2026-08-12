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

import pytest
from fastapi import HTTPException

from app.controller.chat_controller import _resolve_continuation_admission
from app.model.chat import SupplementChat
from app.run_journal import RunEventDraft, SQLiteRunJournal

pytestmark = pytest.mark.unit


def _terminal_frontier(journal: SQLiteRunJournal) -> None:
    journal.ensure_run(
        run_id="base-run", project_id="project-1", status="pending"
    )
    journal.append_event(
        "base-run",
        RunEventDraft(
            event_id="user:base",
            event_type="user.message",
            payload={"content": "Build the report"},
        ),
    )
    journal.append_event(
        "base-run",
        RunEventDraft(
            event_id="todos:base",
            event_type="legacy.todo_state",
            legacy_step="todo_state",
            payload={
                "todos": [
                    {
                        "id": "todo-1",
                        "content": "Write summary",
                        "active_form": "Writing summary",
                        "status": "pending",
                    }
                ]
            },
        ),
    )
    journal.append_event(
        "base-run",
        RunEventDraft(
            event_id="completed:base",
            event_type="run.completed",
            payload={"reason": "turn_completed"},
        ),
    )


@pytest.mark.asyncio
async def test_continue_binds_frontier_and_rejects_duplicate_without_advance(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _terminal_frontier(journal)
        first = await _resolve_continuation_admission(
            journal,
            data=SupplementChat(question="继续", task_id="run-2"),
            project_id="project-1",
            run_id="run-2",
        )
        assert "intent: continue_project" in (first.project_context or "")
        assert "next_action: Write summary" in (first.project_context or "")

        with pytest.raises(HTTPException) as captured:
            await _resolve_continuation_admission(
                journal,
                data=SupplementChat(question="continue", task_id="run-3"),
                project_id="project-1",
                run_id="run-3",
            )
        assert captured.value.status_code == 409
        assert (
            captured.value.detail["code"]
            == "continuation_duplicate_without_progress"
        )


@pytest.mark.asyncio
async def test_continue_never_infers_resume_for_interrupted_run(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-1", project_id="project-1", status="pending"
        )
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="interrupted:run-1",
                event_type="run.interrupted",
                payload={"reason": "brain_restart"},
            ),
        )
        with pytest.raises(HTTPException) as captured:
            await _resolve_continuation_admission(
                journal,
                data=SupplementChat(question="continue", task_id="run-2"),
                project_id="project-1",
                run_id="run-2",
            )
        assert captured.value.detail["code"] == "continuation_resume_required"


@pytest.mark.asyncio
async def test_permanent_clarification_closes_matching_durable_request(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.put_follow_up_request(
            request_id="run-2",
            project_id="project-1",
            content="continue",
        )

        with pytest.raises(HTTPException) as captured:
            await _resolve_continuation_admission(
                journal,
                data=SupplementChat(question="continue", task_id="run-2"),
                project_id="project-1",
                run_id="run-2",
            )

        assert (
            captured.value.detail["code"]
            == "continuation_clarification_required"
        )
        assert journal.list_follow_up_requests(project_id="project-1") == []
        rejected = journal.put_follow_up_request(
            request_id="run-2",
            project_id="project-1",
            content="continue",
        )
        assert rejected.status == "cancelled"
        assert "continuation_clarification_required" in (
            rejected.last_error or ""
        )


@pytest.mark.asyncio
async def test_continue_cannot_bypass_project_execution_lease(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(
            run_id="run-active", project_id="project-1", status="pending"
        )
        journal.create_run_attempt(
            "run-active", request_id="request-active", reason="test"
        )
        journal.put_follow_up_request(
            request_id="run-new",
            project_id="project-1",
            content="continue",
        )
        with pytest.raises(HTTPException) as captured:
            await _resolve_continuation_admission(
                journal,
                data=SupplementChat(question="continue", task_id="run-new"),
                project_id="project-1",
                run_id="run-new",
            )
        assert captured.value.detail["code"] == "follow_up_must_queue"
        assert [
            item.request_id
            for item in journal.list_follow_up_requests(project_id="project-1")
        ] == ["run-new"]
