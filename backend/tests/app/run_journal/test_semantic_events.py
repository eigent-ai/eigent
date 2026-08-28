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
