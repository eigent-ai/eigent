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

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.controller import chat_controller, run_controller
from app.model.chat import HumanReply
from app.run_context import RunContext
from app.run_journal import EventRecorder, SQLiteRunJournal
from app.run_journal.context_projection import (
    build_project_execution_context_projection,
)
from app.run_runtime import RunCoordinator


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["typed", "legacy"])
async def test_resumed_gui_reply_commits_before_delivery_and_survives_restart(
    tmp_path, monkeypatch, transport
):
    database = tmp_path / "journal.sqlite3"
    reply = "Use report.csv\nKeep the original columns."
    with SQLiteRunJournal(database) as journal:
        journal.ensure_run(run_id="run-1", project_id="session-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )

    with SQLiteRunJournal(database) as journal:
        journal.reconcile_startup()
        assert journal.get_run("run-1").status == "interrupted"
        coordinator = RunCoordinator(journal)
        monkeypatch.setattr(
            run_controller, "get_default_run_coordinator", lambda: coordinator
        )
        monkeypatch.setattr(
            run_controller, "get_default_run_journal", lambda: journal
        )
        monkeypatch.setattr(
            chat_controller, "get_default_run_journal", lambda: journal
        )
        resumed = await run_controller.resume_run(
            "run-1", run_controller.ResumeRunBody(request_id="explicit-resume")
        )
        attempt = journal.activate_run_attempt(
            resumed["attempt"]["attempt_id"]
        )
        assert attempt.attempt_number == 2
        journal.create_human_interaction(
            interaction_id="gui-question",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"agent": "worker", "question": "Which file?"},
            response_schema={"type": "string"},
        )
        # A local draft has not crossed the submission boundary.
        assert journal.list_human_interaction_decisions("gui-question") == []
        assert not any(
            e.event_type == "interaction.resolved"
            for e in journal.list_events("run-1")
        )

        async def deliver(agent, text):
            # Check through a second connection: the waiter must never see an
            # answer whose decision/event exists only in an uncommitted TX.
            with SQLiteRunJournal(database) as reader:
                decisions = reader.list_human_interaction_decisions(
                    "gui-question"
                )
                assert len(decisions) == 1
                assert decisions[0].decision["reply"] == text == reply
                assert reader.get_run("run-1").status == "running"
                assert agent == "worker"

        task_lock = SimpleNamespace(
            put_human_input=AsyncMock(side_effect=deliver),
            add_conversation=Mock(),
            run_context=RunContext(
                space_id="space-1",
                project_id="session-1",
                run_id="run-1",
                task_id="session-1",
                email="test@example.com",
                user_id="user-1",
                working_directory=tmp_path,
                task_output_root=tmp_path,
                camel_log_dir=tmp_path / "logs",
                binding_source="test",
                workdir_mode="workspace",
                browser_port=9222,
            ),
        )
        monkeypatch.setattr(
            "app.service.task.get_task_lock_if_exists", lambda _: task_lock
        )
        monkeypatch.setattr(
            chat_controller, "get_task_lock_if_exists", lambda _: task_lock
        )
        monkeypatch.setattr(
            "app.run_sync.runtime.notify_default_cloud_sync_worker",
            lambda: None,
        )

        monkeypatch.setattr(
            "app.utils.server.sync_step.get_default_event_recorder",
            lambda: EventRecorder(journal),
        )
        body = run_controller.InteractionDecisionBody(
            decision_request_id="gui-submit",
            expected_version=0,
            decision={"reply": reply},
            continue_active_attempt=True,
        )
        if transport == "typed":
            for _ in range(2):
                response = await run_controller.decide_run_interaction(
                    "run-1", "gui-question", body
                )
                assert response["status"] == "resolved"
        else:
            response = await chat_controller.human_reply(
                "session-1",
                HumanReply(
                    agent="worker",
                    reply=reply,
                    interaction_id="gui-question",
                    decision_request_id="gui-submit",
                ),
                SimpleNamespace(headers={}),
            )
            assert response.status_code == 201
            task_lock.add_conversation.assert_called_once_with(
                "human_reply",
                {
                    "agent": "worker",
                    "reply": reply,
                    "interaction_id": "gui-question",
                },
            )
        task_lock.put_human_input.assert_awaited_once_with("worker", reply)
        assert journal.get_run("run-1").status == "running"
        await coordinator.close()

    with SQLiteRunJournal(database) as journal:
        journal.reconcile_startup()
        monkeypatch.setattr(
            run_controller, "get_default_run_journal", lambda: journal
        )
        page = await run_controller.get_run_events(
            "run-1", after_sequence=0, limit=500
        )
        events = page["events"]
        resolutions = [
            e for e in events if e["event_type"] == "interaction.resolved"
        ]
        assert len(resolutions) == 1
        assert resolutions[0]["payload"]["decision"]["reply"] == reply
        assert (
            len(journal.list_human_interaction_decisions("gui-question")) == 1
        )
        assert (
            journal.list_human_interactions("run-1", pending_only=True) == []
        )
        assert [e["sequence"] for e in events] == sorted(
            {e["sequence"] for e in events}
        )
        if transport == "legacy":
            mirror = next(
                e for e in events if e["event_type"] == "legacy.human_reply"
            )
            assert mirror["payload"]["interaction_id"] == "gui-question"
            assert mirror["sequence"] > resolutions[0]["sequence"]
        projection = build_project_execution_context_projection(
            journal, project_id="session-1", current_run_id="next-run"
        )
        assert projection.text.count("Keep the original columns.") == 1
        assert resolutions[0]["event_id"] in projection.source_event_ids
        if transport == "typed":
            monkeypatch.setattr(
                "app.service.task.get_task_lock_if_exists", lambda _: None
            )
            # A retry after another restart is a canonical read, never a new
            # decision or a signal to some later live waiter.
            await run_controller.decide_run_interaction(
                "run-1", "gui-question", body
            )
            assert (
                len(journal.list_human_interaction_decisions("gui-question"))
                == 1
            )
