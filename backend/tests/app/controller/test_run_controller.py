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
import json
import sqlite3
from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest

from app.controller.run_controller import (
    _is_terminal,
    get_run,
    get_run_events,
    stream_run_events,
)
from app.run_journal import (
    CommittedRunEvent,
    RunAttemptRecord,
    RunEventDraft,
    RunRecord,
    SQLiteRunJournal,
)
from app.run_policy import ToolSafetyClass
from app.run_runtime import RunCoordinator


def _run_record() -> RunRecord:
    return RunRecord(
        run_id="run-1",
        project_id="project-1",
        status="running",
        version=2,
        active_attempt_id=None,
        deadline_at=None,
        timeout_policy_version="v1",
        created_at=1.0,
        updated_at=2.0,
    )


def _event(sequence: int, step: str) -> CommittedRunEvent:
    return CommittedRunEvent(
        event_id=f"event-{sequence}",
        run_id="run-1",
        sequence=sequence,
        event_type=f"legacy.{step}",
        payload={"value": sequence},
        legacy_step=step,
        created_at=float(sequence),
        run_version=sequence,
    )


def test_deadline_reached_is_a_terminal_stream_event():
    event = CommittedRunEvent(
        event_id="deadline",
        run_id="run-1",
        sequence=1,
        event_type="run.deadline_reached",
        payload={},
        legacy_step=None,
        created_at=1.0,
        run_version=1,
    )

    assert _is_terminal(event) is True


def test_assistant_final_renders_as_legacy_end_without_closing_run_stream():
    event = CommittedRunEvent(
        event_id="assistant-final:run-1",
        run_id="run-1",
        sequence=1,
        event_type="assistant.final",
        payload={"message": "Done"},
        legacy_step="end",
        created_at=1.0,
        run_version=1,
    )

    assert _is_terminal(event) is False


def _decode_sse(value: str) -> tuple[int | None, str, dict]:
    event_id = None
    event_name = ""
    payload = None
    for line in value.strip().splitlines():
        if line.startswith("id: "):
            event_id = int(line[4:])
        elif line.startswith("event: "):
            event_name = line[7:]
        elif line.startswith("data: "):
            payload = json.loads(line[6:])
    assert payload is not None
    return event_id, event_name, payload


@pytest.mark.asyncio
async def test_run_snapshot_includes_process_liveness():
    journal = MagicMock()
    journal.get_run.return_value = _run_record()
    journal.list_run_attempts.return_value = []
    coordinator = RunCoordinator()
    release = asyncio.Event()

    async def source():
        await release.wait()
        yield "notification"

    subscription = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    with (
        patch(
            "app.controller.run_controller.get_default_run_journal",
            return_value=journal,
        ),
        patch(
            "app.controller.run_controller.get_default_run_coordinator",
            return_value=coordinator,
        ),
    ):
        result = await get_run("run-1")

    assert result["run_id"] == "run-1"
    assert result["runtime"]["consumer_alive"] is True
    assert result["runtime"]["subscriber_count"] == 1

    await subscription.aclose()
    release.set()
    await subscription.handle.wait()


@pytest.mark.asyncio
async def test_run_snapshot_keeps_failed_attempt_and_canonical_elapsed():
    journal = MagicMock()
    journal.get_run.return_value = replace(_run_record(), status="failed")
    attempt = RunAttemptRecord(
        attempt_id="failed-attempt",
        run_id="run-1",
        attempt_number=1,
        status="failed",
        started_at=10,
        ended_at=12.5,
        outcome="failed",
        timeout_reason=None,
        resume_request_id="start-1",
        resume_reason="initial_execution",
        policy_version="v1",
        elapsed_active_ms=2500,
        last_consumer_heartbeat_at=12.5,
    )
    journal.list_run_attempts.return_value = [attempt]
    journal.list_approvals.return_value = []
    journal.list_human_interactions.return_value = []
    journal.list_tool_calls.return_value = []
    with (
        patch(
            "app.controller.run_controller.get_default_run_journal",
            return_value=journal,
        ),
        patch(
            "app.controller.run_controller.get_default_run_coordinator",
            return_value=RunCoordinator(),
        ),
    ):
        result = await get_run("run-1")
    assert result["status"] == "failed"
    assert result["latest_attempt"]["status"] == "failed"
    assert result["attempts"][0]["attempt_id"] == "failed-attempt"
    assert result["total_attempt_elapsed_ms"] == 2500
    assert {call[0] for call in journal.mock_calls} == {
        "get_run",
        "list_run_attempts",
        "list_approvals",
        "list_human_interactions",
        "list_tool_calls",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["failed", "cancelled"])
async def test_snapshot_and_replay_preserve_fixture_backup_audit_and_frontier(
    tmp_path, status
):
    source_path = tmp_path / "fixture.sqlite3"
    backup_path = tmp_path / "fixture-backup.sqlite3"
    with SQLiteRunJournal(source_path) as source:
        source.ensure_run(run_id="run-1", project_id="project-1", now=1)
        attempt = source.create_run_attempt(
            "run-1",
            request_id="start-1",
            reason="initial_execution",
            activate=True,
            now=2,
        )
        tool = dict(
            tool_call_id="unknown-write",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            tool_name="fixture_write",
            safety_class=ToolSafetyClass.UNSAFE_WRITE,
            request={"fixture": True},
        )
        source.checkpoint_tool_call(status="prepared", now=3, **tool)
        source.checkpoint_tool_call(status="dispatched", now=4, **tool)
        source.checkpoint_tool_call(
            status="outcome_unknown", outcome="outcome_unknown", now=5, **tool
        )
        source.append_event(
            "run-1",
            RunEventDraft(
                event_id="original-terminal",
                event_type=f"run.{status}",
                payload={
                    "reason": "fixture failure; no verified write outcome"
                },
                created_at=12,
            ),
        )
        source_frontier = source.get_project_execution_state("project-1")
        with sqlite3.connect(backup_path) as backup:
            source._connection.backup(backup)
        original_dump = tuple(source._connection.iterdump())

        with SQLiteRunJournal(backup_path) as journal:
            before_dump = tuple(journal._connection.iterdump())
            before_events = journal.list_events("run-1")
            before_history = journal.list_project_history_events("project-1")
            before_changes = journal._connection.total_changes
            with (
                patch(
                    "app.controller.run_controller.get_default_run_journal",
                    return_value=journal,
                ),
                patch(
                    "app.controller.run_controller.get_default_run_coordinator",
                    return_value=RunCoordinator(),
                ),
            ):
                for _ in range(3):
                    snapshot = await get_run("run-1")
                    page = await get_run_events(
                        "run-1", after_sequence=0, limit=500
                    )
                    response = await stream_run_events(
                        "run-1", after_sequence=0, last_event_id=None
                    )
                    frames = [
                        _decode_sse(frame)
                        async for frame in response.body_iterator
                    ]
                    assert snapshot["status"] == status
                    assert snapshot["latest_attempt"]["status"] == status
                    assert snapshot["total_attempt_elapsed_ms"] == 10_000
                    assert (
                        snapshot["tool_calls"][0]["status"]
                        == "outcome_unknown"
                    )
                    assert page["next_sequence"] == before_events[-1].sequence
                    assert any(
                        kind == "run_event"
                        and payload["event_id"] == "original-terminal"
                        for _, kind, payload in frames
                    )

            assert (
                journal.get_project_execution_state("project-1")
                == source_frontier
            )
            assert journal.list_events("run-1") == before_events
            assert (
                journal.list_project_history_events("project-1")
                == before_history
            )
            assert journal._connection.total_changes == before_changes
            assert tuple(journal._connection.iterdump()) == before_dump
            for pragma in ("quick_check", "integrity_check"):
                assert (
                    journal._connection.execute(f"PRAGMA {pragma}").fetchall()[
                        0
                    ][0]
                    == "ok"
                )
            assert (
                journal._connection.execute(
                    "PRAGMA foreign_key_check"
                ).fetchall()
                == []
            )
        assert tuple(source._connection.iterdump()) == original_dump


@pytest.mark.asyncio
async def test_run_events_uses_cursor_and_bounded_page():
    journal = MagicMock()
    journal.get_run.return_value = _run_record()
    journal.list_events.return_value = [_event(3, "notice"), _event(4, "end")]

    with patch(
        "app.controller.run_controller.get_default_run_journal",
        return_value=journal,
    ):
        result = await get_run_events(
            "run-1",
            after_sequence=2,
            limit=1,
        )

    assert result["next_sequence"] == 3
    assert result["has_more"] is True
    assert [event["sequence"] for event in result["events"]] == [3]
    assert result["events"][0] == {
        "schema_version": 1,
        "event_id": "event-3",
        "project_id": "project-1",
        "run_id": "run-1",
        "sequence": 3,
        "run_sequence": 3,
        "run_version": 3,
        "event_type": "legacy.notice",
        "legacy_step": "notice",
        "payload": {"value": 3},
        "created_at": 3.0,
        "occurred_at": 3.0,
        "origin": "local",
    }
    journal.list_events.assert_called_once_with(
        "run-1",
        after_sequence=2,
        limit=2,
    )


@pytest.mark.asyncio
async def test_stream_subscribes_before_replay_and_deduplicates_by_sequence():
    events = [_event(1, "confirmed")]
    journal = MagicMock()
    journal.get_run.return_value = _run_record()

    def list_events(run_id, *, after_sequence, limit):
        assert run_id == "run-1"
        return [event for event in events if event.sequence > after_sequence][
            :limit
        ]

    journal.list_events.side_effect = list_events
    coordinator = RunCoordinator()
    release = asyncio.Event()

    async def source():
        await release.wait()
        events.append(_event(2, "end"))
        yield "wake-up-only"

    initial = await coordinator.start_with_subscription(
        run_id="run-1",
        stream_factory=source,
    )
    await initial.aclose()

    with (
        patch(
            "app.controller.run_controller.get_default_run_journal",
            return_value=journal,
        ),
        patch(
            "app.controller.run_controller.get_default_run_coordinator",
            return_value=coordinator,
        ),
    ):
        response = await stream_run_events("run-1", after_sequence=0)
        stream = response.body_iterator

        first_id, first_type, first_payload = _decode_sse(
            await stream.__anext__()
        )
        assert (first_id, first_type) == (1, "run_event")
        assert first_payload["sequence"] == 1
        assert first_payload["run_sequence"] == 1
        assert first_payload["project_id"] == "project-1"
        assert first_payload["schema_version"] == 1

        marker_id, marker_type, marker_payload = _decode_sse(
            await stream.__anext__()
        )
        assert marker_id is None
        assert marker_type == "replay_caught_up"
        assert marker_payload == {"run_id": "run-1", "after_sequence": 1}

        release.set()
        second_id, second_type, second_payload = _decode_sse(
            await stream.__anext__()
        )
        assert (second_id, second_type) == (2, "run_event")
        assert second_payload["sequence"] == 2

        with pytest.raises(StopAsyncIteration):
            await stream.__anext__()

    await coordinator.close()


@pytest.mark.asyncio
async def test_stream_resumes_from_last_event_id_on_transport_reconnect():
    events = [_event(1, "confirmed"), _event(2, "end")]
    journal = MagicMock()
    journal.get_run.return_value = _run_record()
    journal.list_events.side_effect = lambda run_id, *, after_sequence, limit: (
        [event for event in events if event.sequence > after_sequence][:limit]
    )
    coordinator = RunCoordinator()

    with (
        patch(
            "app.controller.run_controller.get_default_run_journal",
            return_value=journal,
        ),
        patch(
            "app.controller.run_controller.get_default_run_coordinator",
            return_value=coordinator,
        ),
    ):
        response = await stream_run_events(
            "run-1", after_sequence=0, last_event_id="1"
        )
        stream = response.body_iterator
        event_id, event_type, payload = _decode_sse(await stream.__anext__())

    assert (event_id, event_type, payload["sequence"]) == (2, "run_event", 2)
    journal.list_events.assert_called_with(
        "run-1", after_sequence=1, limit=500
    )
    await coordinator.close()
