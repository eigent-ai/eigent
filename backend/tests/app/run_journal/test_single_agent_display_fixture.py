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

"""Shared fixture from real SingleAgent SSE and durable journal writers."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.controller.run_controller import _event_payload
from app.run_context import RunContext, run_context_scope
from app.run_journal import EventRecorder, RunEventDraft, SQLiteRunJournal
from app.run_policy import ToolSafetyClass
from app.run_runtime.step_coordinator import PlanStepInput, RunStepCoordinator
from app.run_runtime.tool_checkpoint import (
    BackgroundToolResult,
    build_tool_display_projection,
    finish_tool_checkpoint,
    prepare_tool_checkpoint,
)
from app.service.single_agent_service import _action_to_sse
from app.service.task import (
    ActionCreateAgentData,
    ActionNoticeData,
    ActionRequestUsageData,
    ActionTerminalData,
    ActionTodoStateData,
    ActionWriteFileData,
)

pytestmark = pytest.mark.unit

_PROJECT = "project-1"
_RUN = "live-run"
_AGENT = "agent-1"
_TIMESTAMP = 1700000000.0


async def _record_completed_single_agent_display_fixture(path: Path):
    """No model, process, real filesystem artifact, or default DB is used."""
    with SQLiteRunJournal(path) as journal:
        journal.ensure_run(
            run_id=_RUN, project_id=_PROJECT, status="pending", now=_TIMESTAMP
        )
        journal.create_run_attempt(
            _RUN,
            request_id="initial",
            reason="initial_execution",
            activate=True,
            attempt_id="attempt-1",
            now=_TIMESTAMP,
        )
        recorder = EventRecorder(journal)
        coordinator = RunStepCoordinator(journal)
        action_index = 0

        async def record(action):
            nonlocal action_index
            # Exercise the same action serializer used by single_agent_solve.
            frame = _action_to_sse(action)
            assert frame is not None
            value = json.loads(frame.removeprefix("data: ").strip())
            action_index += 1
            return await recorder.record_legacy_step(
                project_id=_PROJECT,
                run_id=_RUN,
                step=value["step"],
                data=value["data"],
                event_id=f"single:action:{action_index}",
                created_at=_TIMESTAMP,
            )

        async def plan(first: str, second: str):
            todos = [
                {
                    "id": "todo-1",
                    "content": "Inspect the inputs",
                    "active_form": "Inspecting the inputs",
                    "status": first,
                },
                {
                    "id": "todo-2",
                    "content": "Verify the report",
                    "active_form": "Verifying the report",
                    "status": second,
                },
            ]
            # ObservableTodoToolkit authors Steps before emitting todo_state.
            coordinator.reconcile_plan(
                project_id=_PROJECT,
                run_id=_RUN,
                agent_id=_AGENT,
                items=[
                    PlanStepInput(
                        plan_item_id=item["id"],
                        title=item["content"],
                        active_form=item["active_form"],
                        status=item["status"],
                        ordinal=index,
                    )
                    for index, item in enumerate(todos, start=1)
                ],
            )
            await record(
                ActionTodoStateData(
                    data={
                        "project_id": _PROJECT,
                        "task_id": _RUN,
                        "agent_id": _AGENT,
                        "todos": todos,
                    }
                )
            )

        def checkpoint(tool_id: str, step_id: str, status: str):
            result = {"success": True} if status == "completed" else None
            request = {"command": f"inspect {tool_id}"}
            display = build_tool_display_projection(
                tool_name="shell_exec",
                request=request,
                status=status,
                result=result,
                duration_ms=10 if result else None,
            )
            journal.checkpoint_tool_call(
                tool_call_id=tool_id,
                run_id=_RUN,
                attempt_id="attempt-1",
                tool_name="shell_exec",
                safety_class=ToolSafetyClass.SAFE_READ,
                status=status,
                request=request,
                result=result,
                outcome="completed" if result else None,
                toolkit_name="terminal",
                agent_name="single_agent",
                task_id=_RUN,
                step_id=step_id,
                display_title=display.title,
                display_input=display.input,
                display_output=display.output,
                display_summary=display.summary,
                display_duration_ms=10 if result else None,
                now=_TIMESTAMP,
            )

        async def usage(count: int, index: int):
            await record(
                ActionRequestUsageData(
                    data={
                        "agent_name": "single_agent",
                        "agent_id": _AGENT,
                        "process_task_id": _RUN,
                        "tokens": count,
                        "request_index": index,
                        "response_id": f"response-{index}",
                        "step_total_tokens": 40 if index == 1 else 123,
                    }
                )
            )

        # Freeze only authored Step draft timestamps, not projection logic.
        with patch(
            "app.run_runtime.step_coordinator.RunEventDraft",
            side_effect=lambda **values: RunEventDraft(
                created_at=_TIMESTAMP, **values
            ),
        ):
            await record(
                ActionCreateAgentData(
                    data={
                        "agent_id": _AGENT,
                        "agent_name": "single_agent",
                        "tools": ["shell_exec"],
                    }
                )
            )
            await plan("in_progress", "pending")
            first_step = coordinator.current_running_step_id(_RUN)
            assert first_step is not None
            context = RunContext(
                space_id="space-1",
                project_id=_PROJECT,
                run_id=_RUN,
                task_id=_RUN,
                email="test@example.invalid",
                user_id="1",
                working_directory=path.parent,
                task_output_root=path.parent,
                camel_log_dir=path.parent,
                binding_source="test",
                workdir_mode="direct-write",
                browser_port=9222,
                session_mode="single_agent",
            )
            with (
                run_context_scope(context),
                patch("app.run_runtime.tool_checkpoint._notify_cloud_sync"),
                patch(
                    "app.run_journal.store.time.time", return_value=_TIMESTAMP
                ),
                patch(
                    "app.run_runtime.tool_checkpoint.time.monotonic",
                    return_value=100,
                ),
            ):
                background = prepare_tool_checkpoint(
                    raw_tool_call_id="tool-1",
                    tool_name="shell_exec",
                    arguments={"command": "inspect tool-1"},
                    declared_safety=(ToolSafetyClass.SAFE_READ, None),
                    toolkit_name="terminal",
                    agent_name="single_agent",
                    task_id=_RUN,
                    journal=journal,
                )
            # Real prepare uses the agent name, whereas the plan owns a UUID.
            # Exercise that existing producer contract, not a manually supplied
            # Step. The display reader must correlate the initiation instead.
            assert background is not None and background.step_id is None
            finish_tool_checkpoint(
                background,
                result=BackgroundToolResult("Process started"),
                journal=journal,
            )
            assert not any(
                e.event_type == "tool.completed"
                for e in journal.list_events(_RUN)
            )
            await record(
                ActionTerminalData(
                    process_task_id=_RUN, data="Inputs inspected.\n"
                )
            )
            await record(
                ActionWriteFileData(
                    process_task_id=_RUN,
                    data="/Users/example/workspace/reports/inputs.txt",
                    relative_path="reports/inputs.txt",
                )
            )
            await usage(40, 1)
            await plan("completed", "in_progress")
            second_step = coordinator.current_running_step_id(_RUN)
            assert second_step is not None and second_step != first_step
            with (
                patch("app.run_runtime.tool_checkpoint._notify_cloud_sync"),
                patch(
                    "app.run_journal.store.time.time", return_value=_TIMESTAMP
                ),
                patch(
                    "app.run_runtime.tool_checkpoint.time.monotonic",
                    return_value=100.01,
                ),
            ):
                finish_tool_checkpoint(
                    background, result={"success": True}, journal=journal
                )
            checkpoint("tool-2", second_step, "prepared")
            checkpoint("tool-2", second_step, "dispatched")
            checkpoint("tool-2", second_step, "completed")
            await record(
                ActionTerminalData(
                    process_task_id=_RUN, data="Report verified.\n"
                )
            )
            await record(
                ActionWriteFileData(
                    process_task_id=_RUN,
                    data="/Users/example/workspace/reports/verified.txt",
                    relative_path="reports/verified.txt",
                )
            )
            await record(
                ActionNoticeData(
                    process_task_id=_RUN,
                    data="Report validation passed.",
                    title="Validation complete",
                    notice_id="notice-1",
                    purpose="result",
                    severity="success",
                    tool_call_id="tool-2",
                )
            )
            await usage(83, 2)
            await plan("completed", "completed")

        manifest = journal.append_artifact_manifest_events(
            _RUN,
            [
                RunEventDraft(
                    event_id="single:manifest",
                    event_type="artifact.manifest.finalized",
                    payload={
                        "artifact_count": 0,
                        "artifacts": [],
                        "scan_status": "complete",
                    },
                    created_at=_TIMESTAMP,
                )
            ],
            expected_project_id=_PROJECT,
        )
        journal.complete_successful_run(
            _RUN,
            assistant_final=RunEventDraft(
                event_id="single:final",
                event_type="assistant.final",
                payload={
                    "message": "The inputs and report are verified.",
                    "tokens": 123,
                },
                legacy_step="end",
                created_at=_TIMESTAMP,
            ),
            terminal=RunEventDraft(
                event_id="single:completed",
                event_type="run.completed",
                payload={},
                created_at=_TIMESTAMP,
            ),
            artifact_manifest=manifest,
            expected_project_id=_PROJECT,
        )
        events = journal.list_events(_RUN)
        assert journal.get_run(_RUN).status == "completed"
        return {
            "run_id": _RUN,
            "after_sequence": 0,
            "next_sequence": events[-1].sequence,
            "has_more": False,
            "events": [
                _event_payload(event, project_id=_PROJECT, origin="local")
                for event in events
            ],
        }


@pytest.mark.asyncio
async def test_single_agent_display_fixture_matches_actual_writers(tmp_path):
    actual = await _record_completed_single_agent_display_fixture(
        tmp_path / "single-display.sqlite3"
    )
    fixture = (
        Path(__file__).resolve().parents[4]
        / "test/fixtures/completed-single-agent-display.json"
    )
    assert actual == json.loads(fixture.read_text())
    events = actual["events"]
    plans = [e for e in events if e["legacy_step"] == "todo_state"]
    assert [[t["status"] for t in p["payload"]["todos"]] for p in plans] == [
        ["running", "pending"],
        ["completed", "running"],
        ["completed", "completed"],
    ]
    assert all(p["payload"]["task_id"] == _RUN for p in plans)
    assert all(
        [t["id"] for t in p["payload"]["todos"]] == ["todo-1", "todo-2"]
        for p in plans
    )
    steps = {
        e["payload"]["step"]["step_id"]: e["payload"]["step"]["plan_item_id"]
        for e in events
        if e["event_type"].startswith("step.")
    }
    tools = [e for e in events if e["event_type"] == "tool.completed"]
    assert len(tools) == 2
    assert tools[0]["sequence"] > plans[1]["sequence"]
    origins = [e for e in events if e["event_type"] == "tool.prepared"]
    assert origins[0]["sequence"] < plans[1]["sequence"] < tools[0]["sequence"]
    assert (
        tools[0]["payload"]["tool_call_id"]
        == origins[0]["payload"]["tool_call_id"]
        == "live-run:tool-1"
    )
    for tool, todo in zip(tools, [None, "todo-2"]):
        payload = tool["payload"]
        assert tool["legacy_step"] is None
        assert payload["process_task_id"] == _RUN
        if todo is None:
            assert payload["step_id"] is None
        else:
            assert steps[payload["step_id"]] == todo
        assert payload["display_output"] == "Completed successfully"
        assert payload["semantic"]["correlation"]["task_id"] == _RUN
        assert (
            payload["semantic"]["correlation"].get("step_id")
            == payload["step_id"]
        )
        assert payload["semantic"]["kind"] == "command_execution"
    for step in ["terminal", "write_file", "notice"]:
        actions = [e for e in events if e["legacy_step"] == step]
        assert actions
        for action in actions:
            assert action["payload"]["process_task_id"] == _RUN
            assert steps[action["payload"]["step_id"]] in {"todo-1", "todo-2"}
    files = [e for e in events if e["legacy_step"] == "write_file"]
    assert [e["payload"]["relative_path"] for e in files] == [
        "reports/inputs.txt",
        "reports/verified.txt",
    ]
    assert all("/Users/example" not in json.dumps(e["payload"]) for e in files)
    assert (
        sum(
            e["payload"]["tokens"]
            for e in events
            if e["legacy_step"] == "request_usage"
        )
        == 123
    )
    assert [e["event_type"] for e in events[-2:]] == [
        "assistant.final",
        "run.completed",
    ]
    assert events[-2]["payload"] == {
        "message": "The inputs and report are verified.",
        "tokens": 123,
    }
    assert events[-1]["payload"]["result_event_id"] == events[-2]["event_id"]
