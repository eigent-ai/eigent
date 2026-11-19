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
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.controller import chat_controller, run_controller
from app.exception.exception import UserException
from app.model.chat import HumanReply
from app.run_context import RunContext
from app.run_journal import EventRecorder, SQLiteRunJournal
from app.run_journal.context_projection import (
    build_project_execution_context_projection,
)
from app.run_runtime import RunCoordinator
from app.service.task import TaskLock


def _run_context(tmp_path):
    return RunContext(
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
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("pending", "identity"),
    [
        (False, {}),
        (True, {}),
        (True, {"interaction_id": "missing"}),
        (False, {"decision_request_id": "unmatched"}),
    ],
)
async def test_unowned_durable_reply_never_delivers_or_mirrors(
    tmp_path, monkeypatch, pending, identity
):
    with SQLiteRunJournal(tmp_path / "unowned.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="session-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        if pending:
            journal.create_human_interaction(
                interaction_id="question",
                run_id="run-1",
                attempt_id=attempt.attempt_id,
                interaction_type="question",
                request={"agent": "worker", "question": "Which file?"},
            )
        lock = TaskLock("session-1", asyncio.Queue(), {})
        lock.run_context = _run_context(tmp_path)
        lock.add_human_input_listen("worker")
        waiters = [
            asyncio.create_task(lock.get_human_input("worker"))
            for _ in range(2)
        ]
        await asyncio.sleep(0)
        monkeypatch.setattr(
            chat_controller, "get_default_run_journal", lambda: journal
        )
        monkeypatch.setattr(
            chat_controller, "get_task_lock_if_exists", lambda _: lock
        )
        monkeypatch.setattr(
            "app.utils.server.sync_step.get_default_event_recorder",
            lambda: EventRecorder(journal),
        )
        try:
            with pytest.raises(UserException):
                await chat_controller.human_reply(
                    "session-1",
                    HumanReply(agent="worker", reply="report.csv", **identity),
                    SimpleNamespace(headers={}),
                )
            assert all(not waiter.done() for waiter in waiters)
            assert journal.list_human_interaction_decisions("question") == []
            assert all(
                e.event_type != "legacy.human_reply"
                for e in journal.list_events("run-1")
            )
        finally:
            for waiter in waiters:
                waiter.cancel()
            await asyncio.gather(*waiters, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("waiting", "disconnect"), [(True, True), (False, True), (False, False)]
)
async def test_committed_gui_reply_survives_request_cancellation(
    tmp_path, monkeypatch, waiting, disconnect
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="session-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        journal.create_human_interaction(
            interaction_id="gui-question",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"agent": "worker", "question": "Which file?"},
        )
        lock = TaskLock("session-1", asyncio.Queue(), {})
        lock.run_context = _run_context(tmp_path)
        lock.add_human_input_listen("worker")
        waiters = [
            asyncio.create_task(lock.get_human_input("worker"))
            for _ in range(2 if waiting else 0)
        ]
        await asyncio.sleep(0)
        monkeypatch.setattr(
            chat_controller, "get_default_run_journal", lambda: journal
        )
        monkeypatch.setattr(
            chat_controller, "get_task_lock_if_exists", lambda _: lock
        )
        monkeypatch.setattr(
            "app.run_sync.runtime.notify_default_cloud_sync_worker",
            lambda: None,
        )
        monkeypatch.setattr(
            "app.utils.server.sync_step.get_default_event_recorder",
            lambda: EventRecorder(journal),
        )
        loop = asyncio.get_running_loop()
        resolve = journal.resolve_human_interaction
        request = None

        def resolve_then_disconnect(*args, **kwargs):
            resolved = resolve(*args, **kwargs)
            if disconnect:
                # The client leaves after the commit, before the worker
                # thread returns the transition to the request coroutine.
                loop.call_soon_threadsafe(request.cancel)
            return resolved

        monkeypatch.setattr(
            journal, "resolve_human_interaction", resolve_then_disconnect
        )
        reply = HumanReply(
            agent="worker",
            reply="report.csv",
            interaction_id="gui-question",
            decision_request_id="gui-submit",
        )
        try:
            request = asyncio.create_task(
                chat_controller.human_reply(
                    "session-1", reply, SimpleNamespace(headers={})
                )
            )
            # A missing waiter is reported only to a request still waiting.
            with pytest.raises(
                asyncio.CancelledError if disconnect else UserException
            ):
                await request
            if waiting:
                assert await asyncio.wait_for(waiters[0], 1) == "report.csv"
                retried = await chat_controller.human_reply(
                    "session-1", reply, SimpleNamespace(headers={})
                )
                assert retried.status_code == 201
                assert not waiters[1].done(), (
                    "A retry answered the next live GUI waiter"
                )
            assert (
                len(journal.list_human_interaction_decisions("gui-question"))
                == 1
            )
        finally:
            for waiter in waiters:
                waiter.cancel()
            await asyncio.gather(*waiters, return_exceptions=True)


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
            run_context=_run_context(tmp_path),
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


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["typed", "legacy", "legacy-without-id"])
@pytest.mark.parametrize("identical", [True, False])
@pytest.mark.parametrize(
    "read_timing", ["before-commit", "after-commit", "next-question"]
)
async def test_overlapping_gui_replies_deliver_only_transition_owner(
    tmp_path, monkeypatch, transport, identical, read_timing
):
    database = tmp_path / "journal.sqlite3"
    with (
        SQLiteRunJournal(database) as journal,
        SQLiteRunJournal(database) as retry_journal,
    ):
        journal.ensure_run(run_id="run-1", project_id="session-1")
        attempt = journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        journal.create_human_interaction(
            interaction_id="gui-question",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"agent": "worker", "question": "Which file?"},
        )
        lock = TaskLock("session-1", asyncio.Queue(), {})
        lock.run_context = _run_context(tmp_path)
        lock.add_human_input_listen("worker")
        waiters = [
            asyncio.create_task(lock.get_human_input("worker"))
            for _ in range(2)
        ]
        await asyncio.sleep(0)
        assert len(lock.human_input_waiters["worker"]) == 2
        # Separate connections exercise SQLite's transaction boundary rather
        # than relying solely on one journal object's Python lock.
        journals = iter([journal, retry_journal])

        def get_journal():
            return next(journals, journal)

        monkeypatch.setattr(
            chat_controller, "get_default_run_journal", get_journal
        )
        monkeypatch.setattr(
            run_controller, "get_default_run_journal", get_journal
        )
        monkeypatch.setattr(
            chat_controller, "get_task_lock_if_exists", lambda _: lock
        )
        monkeypatch.setattr(
            "app.service.task.get_task_lock_if_exists", lambda _: lock
        )
        monkeypatch.setattr(
            "app.run_sync.runtime.notify_default_cloud_sync_worker",
            lambda: None,
        )
        monkeypatch.setattr(
            "app.utils.server.sync_step.get_default_event_recorder",
            lambda: EventRecorder(journal),
        )

        # Force both pending reads, a post-commit retry, or a retry after the
        # next question appears. No sleeps or probabilistic races.
        original_to_thread = asyncio.to_thread
        both_ready = asyncio.Event()
        committed = asyncio.Event()
        retry_finished = asyncio.Event()
        ready = 0

        async def synchronized_resolution(fn, *args, **kwargs):
            nonlocal ready
            if (
                getattr(fn, "__name__", "") == "resolve_human_interaction"
                and ready < 2
            ):
                ready += 1
                invocation = ready
                if read_timing == "before-commit":
                    if ready == 2:
                        both_ready.set()
                    await both_ready.wait()
                result = await original_to_thread(fn, *args, **kwargs)
                if read_timing != "before-commit" and invocation == 1:
                    # Keep the owner in flight after committing but before
                    # delivery. A retry now observes no pending question.
                    committed.set()
                    await retry_finished.wait()
                return result
            return await original_to_thread(fn, *args, **kwargs)

        monkeypatch.setattr(asyncio, "to_thread", synchronized_resolution)

        async def submit(index, interaction_id="gui-question"):
            reply = "report.csv" if identical or index == 0 else "other.csv"
            request_id = "gui-submit" if identical else f"gui-submit-{index}"
            if interaction_id != "gui-question":
                request_id = f"submit-{interaction_id}"
            if transport == "typed":
                return await run_controller.decide_run_interaction(
                    "run-1",
                    interaction_id,
                    run_controller.InteractionDecisionBody(
                        decision_request_id=request_id,
                        expected_version=0,
                        decision={"reply": reply},
                        continue_active_attempt=True,
                    ),
                )
            return await chat_controller.human_reply(
                "session-1",
                HumanReply(
                    agent="worker",
                    reply=reply,
                    decision_request_id=request_id,
                    interaction_id=None
                    if transport == "legacy-without-id"
                    else interaction_id,
                ),
                SimpleNamespace(headers={}),
            )

        async def retry():
            if read_timing != "before-commit":
                await committed.wait()
                if identical and read_timing == "next-question":
                    # An explicitly identified retry must not be rebound to
                    # the next question for the same agent.
                    journal.create_human_interaction(
                        interaction_id="next-question",
                        run_id="run-1",
                        attempt_id=attempt.attempt_id,
                        interaction_type="question",
                        request={"agent": "worker", "question": "Next?"},
                    )
            try:
                return await submit(1)
            finally:
                retry_finished.set()

        try:
            results = await asyncio.wait_for(
                asyncio.gather(submit(0), retry(), return_exceptions=True), 5
            )
            assert ready >= 1
            errors = [r for r in results if isinstance(r, Exception)]
            terminal_typed_retry = (
                transport == "typed" and read_timing != "before-commit"
            )
            assert len(errors) == (
                0 if identical or terminal_typed_retry else 1
            )
            if errors:
                if transport == "typed":
                    assert isinstance(errors[0], HTTPException)
                    assert errors[0].status_code == 409
                else:
                    assert isinstance(errors[0], UserException)
                    assert (
                        errors[0].description
                        == "The requested human interaction is no longer pending."
                    )
            decisions = journal.list_human_interaction_decisions(
                "gui-question"
            )
            assert len(decisions) == 1
            assert (
                await asyncio.wait_for(waiters[0], 1)
                == decisions[0].decision["reply"]
            )
            assert not waiters[1].done(), (
                "A retry answered the next live GUI waiter"
            )
            events = journal.list_events("run-1")
            assert (
                sum(e.event_type == "interaction.resolved" for e in events)
                == 1
            )
            mirrors = [
                e for e in events if e.event_type == "legacy.human_reply"
            ]
            assert len(mirrors) == (0 if transport == "typed" else 1)
            if mirrors:
                assert mirrors[0].payload["interaction_id"] == "gui-question"
                assert (
                    mirrors[0].payload["reply"]
                    == decisions[0].decision["reply"]
                )
            # An equal answer for a different interaction is a distinct input
            # and must still reach the next waiter after the retry is ignored.
            if journal.get_human_interaction("next-question") is None:
                journal.create_human_interaction(
                    interaction_id="next-question",
                    run_id="run-1",
                    attempt_id=attempt.attempt_id,
                    interaction_type="question",
                    request={
                        "agent": "worker",
                        "question": "Which other file?",
                    },
                )
            await submit(0, "next-question")
            assert await asyncio.wait_for(waiters[1], 1) == "report.csv"
            assert (
                len(journal.list_human_interaction_decisions("next-question"))
                == 1
            )
        finally:
            for waiter in waiters:
                waiter.cancel()
            await asyncio.gather(*waiters, return_exceptions=True)
