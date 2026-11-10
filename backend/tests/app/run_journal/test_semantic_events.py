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

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.run_journal.semantic_events import (
    project_legacy_semantic_event,
    semantic_event_fields,
)

pytestmark = pytest.mark.unit


def test_semantic_envelope_rejects_values_outside_v1_vocabulary():
    with pytest.raises(ValueError, match="Unsupported semantic kind"):
        semantic_event_fields(
            kind="invented_operation",  # type: ignore[arg-type]
            subject_type="tool_call",
            subject_id="call-1",
            phase="completed",
            status="completed",
            source="test",
        )


def test_projects_plan_with_stable_subject_and_bounded_tasks():
    projection = project_legacy_semantic_event(
        step="todo_state",
        data={
            "project_id": "project-1",
            "task_id": "task-1",
            "agent_id": "agent-1",
            "todos": [
                {
                    "id": "todo-1",
                    "content": "Inspect the repository",
                    "active_form": "Inspecting the repository",
                    "status": "completed",
                },
                {
                    "id": "todo-2",
                    "content": "Implement the change",
                    "active_form": "Implementing the change",
                    "status": "in_progress",
                },
            ],
        },
    )

    assert projection is not None
    assert projection.event_type == "plan.updated"
    assert projection.payload["display_summary"] == "1 of 2 steps completed"
    assert projection.payload["semantic"]["subject"] == {
        "type": "plan",
        "id": "task-1",
    }
    assert projection.payload["todos"][1]["status"] == "running"


def test_projects_subtask_tree_as_run_scoped_plan_when_task_id_is_absent():
    projection = project_legacy_semantic_event(
        step="to_sub_tasks",
        run_id="run-1",
        data={
            "summary_task": "Build lesson | Create and verify the lesson",
            "sub_tasks": [
                {
                    "id": "task-1",
                    "content": "Create the lesson",
                    "state": "running",
                    "subtasks": [
                        {
                            "id": "task-2",
                            "content": "Verify the lesson",
                            "state": "open",
                        }
                    ],
                }
            ],
        },
    )

    assert projection is not None
    assert projection.event_type == "plan.updated"
    assert projection.payload["semantic"]["subject"] == {
        "type": "plan",
        "id": "run-1:plan",
    }
    assert projection.payload["semantic"]["correlation"] == {"run_id": "run-1"}
    assert projection.payload["display_title"] == "Build lesson"
    assert projection.payload["display_summary"] == (
        "Create and verify the lesson"
    )
    assert [task["status"] for task in projection.payload["tasks"]] == [
        "running",
        "pending",
    ]


def test_projects_batched_narration_as_display_safe_progress():
    projection = project_legacy_semantic_event(
        step="decompose_text",
        run_id="run-1",
        data={"content": "Inspecting token=very-secret before editing."},
    )

    assert projection is not None
    assert projection.event_type == "activity.progress"
    assert projection.payload["semantic"]["kind"] == "narration"
    assert projection.payload["semantic"]["subject"]["id"] == (
        "run-1:narration"
    )
    assert "very-secret" not in projection.payload["display_title"]


def test_batched_narration_preserves_redacted_fragment_boundaries():
    projection = project_legacy_semantic_event(
        step="decompose_text",
        run_id="run-1",
        data={"content": "first line\n  second line "},
    )

    assert projection is not None
    assert projection.payload["display_title"] == (
        "first line\n  second line "
    )
    assert projection.payload["display_fragment_exact"] is True


def test_projects_single_agent_notice_with_typed_display_semantics():
    projection = project_legacy_semantic_event(
        step="notice",
        run_id="run-1",
        data={
            "notice_id": "notice:call-1",
            "process_task_id": "task-1",
            "tool_call_id": "call-1",
            "title": "Research complete",
            "content": "Validated three primary sources.",
            "purpose": "result",
            "severity": "success",
        },
    )

    assert projection is not None
    assert projection.event_type == "notice.progress"
    assert projection.payload["display_title"] == "Research complete"
    assert projection.payload["display_summary"] == (
        "Validated three primary sources."
    )
    assert projection.payload["purpose"] == "result"
    assert projection.payload["severity"] == "success"
    assert projection.payload["semantic"]["subject"] == {
        "type": "activity_stream",
        "id": "notice:call-1",
    }
    assert projection.payload["semantic"]["correlation"] == {
        "run_id": "run-1",
        "task_id": "task-1",
        "tool_call_id": "call-1",
        "notice_id": "notice:call-1",
    }


def test_agent_turn_lifecycle_uses_explicit_correlation_and_safe_output():
    common = {
        "agent_name": "Developer Agent",
        "agent_id": "agent-1",
        "agent_turn_id": "agent-turn:1",
        "process_task_id": "task-1",
    }
    started = project_legacy_semantic_event(
        step="activate_agent",
        data={**common, "message": "Inspect token=very-secret"},
    )
    completed = project_legacy_semantic_event(
        step="deactivate_agent",
        data={
            **common,
            "message": "private model response must not be projected",
            "tokens": 42,
        },
    )

    assert started is not None and completed is not None
    assert started.event_type == "agent.started"
    assert completed.event_type == "agent.completed"
    assert started.payload["semantic"]["subject"]["id"] == "agent-turn:1"
    assert started.payload["semantic"]["completeness"]["state"] == "complete"
    assert "very-secret" not in started.payload["display_input"]
    assert "message" not in completed.payload
    assert completed.payload["display_summary"] == (
        "Completed agent turn · 42 tokens"
    )


@pytest.mark.parametrize(
    ("status", "event_type", "phase", "summary"),
    [
        ("failed", "agent.failed", "failed", "Agent turn failed"),
        (
            "cancelled",
            "agent.cancelled",
            "cancelled",
            "Agent turn cancelled",
        ),
    ],
)
def test_agent_turn_terminal_outcomes_are_explicit(
    status: str,
    event_type: str,
    phase: str,
    summary: str,
):
    projection = project_legacy_semantic_event(
        step="deactivate_agent",
        data={
            "agent_name": "Developer Agent",
            "agent_id": "agent-1",
            "agent_turn_id": "agent-turn:1",
            "process_task_id": "task-1",
            "status": status,
        },
    )

    assert projection is not None
    assert projection.event_type == event_type
    assert projection.payload["semantic"]["lifecycle"] == {
        "phase": phase,
        "status": status,
    }
    assert projection.payload["display_summary"] == summary


def test_file_projection_never_persists_an_absolute_display_path():
    projection = project_legacy_semantic_event(
        step="write_file",
        data={
            "file_path": "/Users/example/private/report.html",
            "process_task_id": "task-1",
        },
    )

    assert projection is not None
    assert projection.event_type == "file.written"
    assert projection.payload["relative_path"] == "report.html"
    assert "/Users/example" not in str(projection.payload)
    assert projection.payload["semantic"]["completeness"] == {
        "state": "partial",
        "missing_fields": ["relative_path"],
    }


@pytest.mark.parametrize("state", ["DONE", "FAILED"])
def test_subtask_terminal_output_is_redacted_multiline_presentation(state):
    projection = project_legacy_semantic_event(
        step="task_state",
        data={
            "task_id": "sub-1",
            "content": "Create the report",
            "state": state,
            "failure_count": 2,
            "result": (
                "Report ready\n  token=very-secret\n"
                "Saved /Users/example/private/report.md"
            ),
        },
    )

    assert projection is not None
    expected = "completed" if state == "DONE" else "failed"
    assert projection.event_type == f"subtask.{expected}"
    assert projection.payload["status"] == expected
    assert projection.payload["failure_count"] == 2
    assert projection.payload["display_input"] == "Create the report"
    output = projection.payload["display_output"]
    assert output.startswith("Report ready\n  ")
    assert "\nSaved <device-home>/private/report.md" in output
    assert "very-secret" not in output
    assert "/Users/example" not in output
    assert projection.payload["display_output_truncated"] is False
    assert "result" not in projection.payload
    assert projection.payload["semantic"]["correlation"] == {
        "task_id": "sub-1"
    }


@pytest.mark.parametrize(
    "size,truncated", [(599, False), (600, False), (601, True), (1200, True)]
)
def test_subtask_terminal_output_bounds_have_explicit_truncation(
    size, truncated
):
    result = "first\n" + "x" * (size - 6)
    projection = project_legacy_semantic_event(
        step="task_state",
        data={"task_id": "sub-1", "state": "DONE", "result": result},
    )

    assert projection is not None
    output = projection.payload["display_output"]
    assert len(output) == min(size, 600)
    assert output.startswith("first\n")
    assert projection.payload["display_output_truncated"] is truncated
    assert output == (result[:599] + "…" if truncated else result)


@pytest.mark.parametrize(
    "result", [None, "", " \n\t", 123, {"text": "report"}]
)
def test_subtask_without_string_report_does_not_invent_output(result):
    projection = project_legacy_semantic_event(
        step="task_state",
        data={"task_id": "sub-1", "state": "DONE", "result": result},
    )

    assert projection is not None
    assert "display_output" not in projection.payload
    assert "display_output_truncated" not in projection.payload


def test_nonterminal_subtask_does_not_persist_partial_raw_report():
    projection = project_legacy_semantic_event(
        step="task_state",
        data={"state": "RUNNING", "result": "unfinished raw report"},
    )

    assert projection is not None
    assert "display_output" not in projection.payload
    assert "display_output_truncated" not in projection.payload


@pytest.mark.parametrize("step", ["assign_task", "task_state"])
@pytest.mark.parametrize(
    "value,expected",
    [
        (None, 0),
        (True, 0),
        (False, 0),
        ("2", 0),
        (-1, 0),
        (1.5, 0),
        (float("nan"), 0),
        (float("inf"), 0),
        (float("-inf"), 0),
        (2**53, 0),
        (0, 0),
        (2, 2),
        (3.0, 3),
    ],
)
def test_subtask_failure_count_is_a_nonnegative_safe_integer(
    step, value, expected
):
    projection = project_legacy_semantic_event(
        step=step,
        data={
            "task_id": "sub-1",
            "state": "RUNNING",
            "assignee_id": "agent-1",
            "failure_count": value,
        },
    )

    assert projection is not None
    assert projection.payload["failure_count"] == expected
    if step == "assign_task":
        assert projection.payload["assignee_id"] == "agent-1"
        assert projection.payload["semantic"]["actor"] == {
            "type": "agent",
            "id": "agent-1",
        }


async def _record_completed_run_display_fixture(path):
    """Real journal/controller envelopes shared with renderer regressions."""
    from app.controller.run_controller import _event_payload
    from app.run_journal import EventRecorder, RunEventDraft, SQLiteRunJournal

    timestamp = 1700000000.0
    with SQLiteRunJournal(path) as journal:
        journal.ensure_run(
            run_id="live-run",
            project_id="project-1",
            status="pending",
            now=timestamp,
        )
        journal.create_run_attempt(
            "live-run",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            attempt_id="attempt-1",
            now=timestamp,
        )
        recorder = EventRecorder(journal)
        # Freeze only Step draft timestamps; keep actual projection, commit,
        # sequencing, and successful-terminal validation paths intact.
        with patch(
            "app.run_runtime.step_coordinator.RunEventDraft",
            side_effect=lambda **values: RunEventDraft(
                created_at=timestamp, **values
            ),
        ):
            for step, data in [
                (
                    "create_agent",
                    {
                        "agent_id": "agent-1",
                        "agent_name": "Developer Agent",
                        "tools": [],
                    },
                ),
                (
                    "assign_task",
                    {
                        "task_id": "sub-1",
                        "assignee_id": "agent-1",
                        "content": "Create the report",
                        "state": "RUNNING",
                        "failure_count": 1,
                    },
                ),
                (
                    "request_usage",
                    {
                        "agent_id": "agent-1",
                        "process_task_id": "sub-1",
                        "tokens": 123,
                    },
                ),
                (
                    "deactivate_toolkit",
                    {
                        "agent_name": "Developer Agent",
                        "process_task_id": "sub-1",
                        "toolkit_name": "terminal",
                        "method_name": "shell_exec",
                        "tool_call_id": "tool-1",
                        "message": "Validation passed.",
                    },
                ),
                (
                    "task_state",
                    {
                        "task_id": "sub-1",
                        "content": "Create the report",
                        "state": "DONE",
                        "failure_count": 1,
                        "result": (
                            "Report ready\n  Validation passed.\n"
                            "Saved /Users/example/private/report.md\n"
                            "token=very-secret"
                        ),
                    },
                ),
            ]:
                await recorder.record_legacy_step(
                    project_id="project-1",
                    run_id="live-run",
                    step=step,
                    data=data,
                    event_id=f"fixture:{step}",
                    created_at=timestamp,
                )
        manifest = journal.append_artifact_manifest_events(
            "live-run",
            [
                RunEventDraft(
                    event_id="fixture:manifest",
                    event_type="artifact.manifest.finalized",
                    payload={
                        "artifact_count": 0,
                        "artifacts": [],
                        "scan_status": "complete",
                    },
                    created_at=timestamp,
                )
            ],
            expected_project_id="project-1",
        )
        journal.complete_successful_run(
            "live-run",
            assistant_final=RunEventDraft(
                event_id="fixture:final",
                event_type="assistant.final",
                payload={"content": "The report is ready.", "tokens": 123},
                legacy_step="end",
                created_at=timestamp,
            ),
            terminal=RunEventDraft(
                event_id="fixture:completed",
                event_type="run.completed",
                payload={},
                created_at=timestamp,
            ),
            artifact_manifest=manifest,
            expected_project_id="project-1",
        )
        events = journal.list_events("live-run")
        assert journal.get_run("live-run").status == "completed"
        return {
            "run_id": "live-run",
            "after_sequence": 0,
            "next_sequence": events[-1].sequence,
            "has_more": False,
            "events": [
                _event_payload(event, project_id="project-1", origin="local")
                for event in events
            ],
        }


@pytest.mark.asyncio
async def test_completed_run_display_fixture_matches_real_recorder(tmp_path):
    actual = await _record_completed_run_display_fixture(
        tmp_path / "display.sqlite3"
    )
    fixture = (
        Path(__file__).resolve().parents[4]
        / "test/fixtures/completed-run-display.json"
    )
    assert actual == json.loads(fixture.read_text())
    events = actual["events"]
    assigned = next(e for e in events if e["legacy_step"] == "assign_task")
    completed = next(e for e in events if e["legacy_step"] == "task_state")
    assert assigned["payload"]["assignee_id"] == "agent-1"
    assert assigned["payload"]["task_id"] == completed["payload"]["task_id"]
    assert assigned["payload"]["step_id"] == completed["payload"]["step_id"]
    assert completed["payload"]["display_output_truncated"] is False
    usage = next(e for e in events if e["legacy_step"] == "request_usage")
    assert usage["payload"]["tokens"] == 123
    tool = next(e for e in events if e["legacy_step"] == "deactivate_toolkit")
    assert tool["payload"]["process_task_id"] == "sub-1"
    assert tool["payload"]["message"] == "Validation passed."
    assert [e["event_type"] for e in events[-2:]] == [
        "assistant.final",
        "run.completed",
    ]
    assert events[-1]["payload"]["result_event_id"] == events[-2]["event_id"]
