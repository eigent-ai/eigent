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

from pathlib import Path

import pytest

from app.run_context import RunContext, run_context_scope
from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.run_policy import ToolSafetyClass
from app.run_runtime.step_coordinator import PlanStepInput, RunStepCoordinator
from app.run_runtime.tool_checkpoint import (
    ToolCheckpointPersistenceError,
    UnsafeToolOutcomeError,
    build_tool_display_projection,
    classify_tool_safety,
    declare_tool_safety,
    declared_tool_safety,
    dispatch_tool_checkpoint,
    finish_tool_checkpoint,
    prepare_tool_checkpoint,
)


def _context(tmp_path: Path) -> RunContext:
    return RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="run-1",
        email="user@example.com",
        user_id="1",
        working_directory=tmp_path,
        task_output_root=tmp_path,
        camel_log_dir=tmp_path,
        binding_source="test",
        workdir_mode="direct-write",
        browser_port=9222,
    )


def _running_journal(tmp_path: Path) -> SQLiteRunJournal:
    journal = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    return journal


def test_checkpoint_surrounds_tool_and_redacts_credentials(tmp_path):
    with _running_journal(tmp_path) as journal:
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="call-1",
                tool_name="read_file",
                arguments={
                    "path": "notes.md",
                    "api_key": "secret",
                    "argv": [
                        "push",
                        "https://user:password@example.com/repo.git",
                    ],
                },
                journal=journal,
            )
            assert checkpoint is not None
            assert journal.list_tool_calls("run-1")[0].status == "dispatched"
            assert (
                journal.list_tool_calls("run-1")[0].request["api_key"]
                == "[REDACTED]"
            )
            argv = journal.list_tool_calls("run-1")[0].request["argv"]
            assert argv["argument_count"] == 2
            assert len(argv["sha256"]) == 64
            assert argv["redacted_preview"] == [
                "push",
                "https://user:[REDACTED]@example.com/repo.git",
            ]
            assert "password" not in str(argv)
            finish_tool_checkpoint(
                checkpoint,
                result={"content": "hello"},
                journal=journal,
            )
        events = journal.list_events("run-1")
        completed_event = next(
            event for event in events if event.event_type == "tool.completed"
        )
        assert completed_event.payload["display_title"] == "Read notes.md"
        assert completed_event.payload["display_input"] == "File: notes.md"
        assert completed_event.payload["display_output"] == (
            "Returned 5 characters"
        )
        assert completed_event.payload["display_summary"].startswith(
            "Completed in "
        )
        assert completed_event.payload["display_duration_ms"] >= 0
        semantic = completed_event.payload["semantic"]
        assert semantic["kind"] == "file_operation"
        assert semantic["subject"] == {
            "type": "tool_call",
            "id": completed_event.payload["tool_call_id"],
        }
        assert semantic["lifecycle"] == {
            "phase": "completed",
            "status": "completed",
        }
        assert (
            semantic["correlation"]["attempt_id"]
            == (completed_event.payload["attempt_id"])
        )
        assert semantic["completeness"] == {
            "state": "complete",
            "missing_fields": [],
        }
        assert "secret" not in str(completed_event.payload)
        tool = journal.list_tool_calls("run-1")[0]
        assert tool.status == "completed"
        assert tool.result == {"content": "hello"}


def test_checkpoint_correlates_tool_lifecycle_to_running_step(tmp_path):
    with _running_journal(tmp_path) as journal:
        [_, started] = RunStepCoordinator(journal).reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="agent-1",
            items=[
                PlanStepInput(
                    plan_item_id="pli-1",
                    title="Inspect files",
                    active_form="Inspecting files",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        step_id = started.payload["step"]["step_id"]
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="step-call",
                tool_name="read_file",
                arguments={"path": "notes.md"},
                agent_name="agent-1",
                journal=journal,
            )
            finish_tool_checkpoint(
                checkpoint, result={"content": "ok"}, journal=journal
            )

        tool_events = [
            event
            for event in journal.list_events("run-1")
            if event.event_type.startswith("tool.")
        ]
        assert checkpoint is not None
        assert checkpoint.step_id == step_id
        assert {event.payload["step_id"] for event in tool_events} == {step_id}
        assert {
            event.payload["semantic"]["correlation"]["step_id"]
            for event in tool_events
        } == {step_id}


def test_display_projection_hides_absolute_paths_and_file_content(tmp_path):
    with _running_journal(tmp_path) as journal:
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="portable-display",
                tool_name="write_file",
                arguments={
                    "path": "/Users/example/private/report.md",
                    "content": "private body",
                },
                journal=journal,
            )
            finish_tool_checkpoint(
                checkpoint,
                result={"success": True},
                journal=journal,
            )

        completed_event = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "tool.completed"
        )
        display = {
            key: value
            for key, value in completed_event.payload.items()
            if key.startswith("display_")
        }
        assert display["display_title"] == "Wrote …/report.md"
        assert display["display_input"] == "File: …/report.md"
        assert "Users/example" not in str(display)
        assert "private body" not in str(display)


def test_display_projection_strips_paths_and_url_queries_from_errors():
    display = build_tool_display_projection(
        tool_name="read_file",
        request={"path": "notes.md"},
        status="failed",
        result={
            "error": (
                "failed reading /Users/alice/private/secret.txt via "
                "https://example.com/private/secret.txt?token=secret"
            )
        },
        duration_ms=25,
    )

    assert display.output is not None
    assert "/Users/alice" not in display.output
    assert "token=secret" not in display.output
    assert "…/secret.txt" in display.output


def test_search_display_projection_exposes_only_safe_result_urls():
    display = build_tool_display_projection(
        tool_name="search_querit",
        request={"query": "recent updates"},
        status="completed",
        result={
            "results": [
                {
                    "title": "Release notes",
                    "url": (
                        "https://user:secret@example.com/releases/latest"
                        "?token=private#details"
                    ),
                },
                {
                    "title": "Duplicate",
                    "url": "https://example.com/releases/latest",
                },
                {"title": "Unsafe", "url": "javascript:alert(1)"},
            ]
        },
    )

    assert display.output == "Sources: https://example.com/releases/latest"
    assert "secret" not in display.output
    assert "token" not in display.output


def test_google_search_display_projection_supports_list_results():
    display = build_tool_display_projection(
        tool_name="search_google",
        request={"query": "recent updates"},
        status="completed",
        result={
            "value": [
                {"title": "Release notes", "url": "https://example.com/news"}
            ]
        },
    )

    assert display.output == "Sources: https://example.com/news"


def test_subagent_tool_projection_uses_typed_delegation_language():
    started = build_tool_display_projection(
        tool_name="agent_run_subagent",
        request={
            "subagent_type": "research",
            "description": "Review visual references",
            "prompt": "private detailed prompt",
            "wait": True,
        },
        status="completed",
        result={"task_id": "task-1", "status": "completed"},
        duration_ms=1250,
    )
    checked = build_tool_display_projection(
        tool_name="agent_get_task_output",
        request={"task_id": "task-1"},
        status="completed",
        result={"task_id": "task-1", "status": "running"},
    )

    assert started.title == "Started research sub-agent"
    assert started.input == "Task: Review visual references"
    assert "private detailed prompt" not in str(started)
    assert started.output == "Sub-agent status: completed"
    assert checked.title == "Checked sub-agent status"
    assert checked.input == "Sub-agent task: task-1"
    assert checked.output == "Sub-agent status: running"


def test_subagent_checkpoint_emits_subtask_semantics(tmp_path):
    with _running_journal(tmp_path) as journal:
        steps = RunStepCoordinator(journal)
        steps.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="single_agent",
            items=[
                PlanStepInput(
                    plan_item_id="pli-root",
                    title="Build the report",
                    active_form="Building the report",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        parent_step_id = steps.current_running_step_id("run-1")
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="delegate-1",
                tool_name="agent_run_subagent",
                arguments={
                    "subagent_type": "research",
                    "description": "Review references",
                    "prompt": "inspect sources",
                },
                journal=journal,
                declared_safety=(ToolSafetyClass.INTERNAL_CONTROL, None),
            )
            finish_tool_checkpoint(
                checkpoint,
                result={"task_id": "child-1", "status": "completed"},
                journal=journal,
            )

        completed = next(
            event
            for event in journal.list_events("run-1")
            if event.event_type == "tool.completed"
        )
        assert completed.payload["semantic"]["kind"] == "subtask"
        assert completed.payload["display_title"] == (
            "Started research sub-agent"
        )
        child_steps = [
            event
            for event in journal.list_events("run-1")
            if event.event_type.startswith("step.")
            and str(event.payload["step"]["plan_item_id"]).startswith(
                "subtask:"
            )
        ]
        assert [event.event_type for event in child_steps] == [
            "step.created",
            "step.started",
            "step.completed",
        ]
        child_step_id = child_steps[0].payload["step"]["step_id"]
        assert completed.payload["step_id"] == child_step_id
        assert child_steps[-1].payload["step"]["status"] == "completed"
        assert child_steps[0].payload["step"]["parent_step_id"] == (
            parent_step_id
        )
        assert {
            event.payload["step"]["owner"]["kind"] for event in child_steps
        } == {"subagent"}
        assert {event.payload["step"]["source"] for event in child_steps} == {
            "subagent"
        }


def test_subagent_step_does_not_start_before_deferred_dispatch(tmp_path):
    with _running_journal(tmp_path) as journal:
        steps = RunStepCoordinator(journal)
        steps.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="single_agent",
            items=[
                PlanStepInput(
                    plan_item_id="pli-root",
                    title="Build the report",
                    active_form="Building the report",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="delegate-after-approval",
                tool_name="agent_run_subagent",
                arguments={
                    "subagent_type": "research",
                    "description": "Review references",
                },
                dispatch_immediately=False,
                journal=journal,
                declared_safety=(ToolSafetyClass.INTERNAL_CONTROL, None),
            )

            assert checkpoint is not None
            assert checkpoint.delegated_step_id is not None
            child_step_id = checkpoint.delegated_step_id
            assert steps.replay("run-1")[child_step_id].status == "pending"
            assert journal.list_tool_calls("run-1")[0].status == "prepared"

            dispatch_tool_checkpoint(checkpoint, journal=journal)

        assert steps.replay("run-1")[child_step_id].status == "running"
        assert journal.list_tool_calls("run-1")[0].status == "dispatched"


def test_async_subagent_step_stays_running_until_status_is_terminal(tmp_path):
    with _running_journal(tmp_path) as journal:
        steps = RunStepCoordinator(journal)
        steps.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="single_agent",
            items=[
                PlanStepInput(
                    plan_item_id="pli-root",
                    title="Build the report",
                    active_form="Building the report",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        with run_context_scope(_context(tmp_path)):
            dispatched = prepare_tool_checkpoint(
                raw_tool_call_id="delegate-async",
                tool_name="agent_run_subagent",
                arguments={
                    "subagent_type": "research",
                    "description": "Review references",
                    "wait": False,
                },
                journal=journal,
                declared_safety=(ToolSafetyClass.INTERNAL_CONTROL, None),
            )
            finish_tool_checkpoint(
                dispatched,
                result={"task_id": "child-async", "status": "running"},
                journal=journal,
            )

            assert dispatched is not None
            assert (
                steps.replay("run-1")[dispatched.step_id].status == "running"
            )

            checked = prepare_tool_checkpoint(
                raw_tool_call_id="check-async",
                tool_name="agent_get_task_output",
                arguments={"task_id": "child-async"},
                journal=journal,
                declared_safety=(ToolSafetyClass.INTERNAL_CONTROL, None),
            )
            assert checked is not None
            assert checked.step_id == dispatched.step_id
            finish_tool_checkpoint(
                checked,
                result={"task_id": "child-async", "status": "completed"},
                journal=journal,
            )

        assert steps.replay("run-1")[dispatched.step_id].status == "completed"
        status_events = [
            event
            for event in journal.list_events("run-1")
            if event.payload.get("tool_call_id") == checked.tool_call_id
        ]
        assert {event.payload.get("step_id") for event in status_events} == {
            dispatched.step_id
        }


def test_unmatched_subagent_status_does_not_finish_parent_step(tmp_path):
    with _running_journal(tmp_path) as journal:
        steps = RunStepCoordinator(journal)
        steps.reconcile_plan(
            project_id="project-1",
            run_id="run-1",
            agent_id="single_agent",
            items=[
                PlanStepInput(
                    plan_item_id="pli-root",
                    title="Build the report",
                    active_form="Building the report",
                    status="in_progress",
                    ordinal=1,
                )
            ],
        )
        parent_step_id = steps.current_running_step_id("run-1")
        with run_context_scope(_context(tmp_path)):
            checked = prepare_tool_checkpoint(
                raw_tool_call_id="check-legacy-child",
                tool_name="agent_get_task_output",
                arguments={"task_id": "unknown-legacy-child"},
                journal=journal,
                declared_safety=(ToolSafetyClass.INTERNAL_CONTROL, None),
            )
            assert checked is not None
            assert checked.delegated_step_id is None
            finish_tool_checkpoint(
                checked,
                result={
                    "task_id": "unknown-legacy-child",
                    "status": "completed",
                },
                journal=journal,
            )

        assert parent_step_id is not None
        assert steps.replay("run-1")[parent_step_id].status == "running"


def test_checkpoint_redacts_common_nested_credential_keys(tmp_path):
    with _running_journal(tmp_path) as journal:
        with run_context_scope(_context(tmp_path)):
            prepare_tool_checkpoint(
                raw_tool_call_id="credential-shapes",
                tool_name="connector_call",
                arguments={
                    "env": {
                        "refresh_token": "refresh-secret",
                        "ACCESS_TOKEN": "access-secret",
                        "clientSecret": "client-secret",
                        "PRIVATE_KEY": "private-secret",
                        "DB_PASSWORD": "database-secret",
                    }
                },
                journal=journal,
            )
        persisted = journal.list_tool_calls("run-1")[0].request
        assert persisted["env"] == {
            "refresh_token": "[REDACTED]",
            "ACCESS_TOKEN": "[REDACTED]",
            "clientSecret": "[REDACTED]",
            "PRIVATE_KEY": "[REDACTED]",
            "DB_PASSWORD": "[REDACTED]",
        }
        assert "refresh-secret" not in str(persisted)


def test_tool_without_admitted_run_context_fails_closed():
    with pytest.raises(ToolCheckpointPersistenceError, match="RunContext"):
        prepare_tool_checkpoint(
            raw_tool_call_id="orphan-tool",
            tool_name="send_email",
            arguments={"to": "user@example.com"},
        )


def test_unsafe_external_error_is_recorded_then_fails_closed(tmp_path):
    with _running_journal(tmp_path) as journal:
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="call-1",
                tool_name="send_email",
                arguments={"to": "user@example.com"},
                journal=journal,
            )
            with pytest.raises(UnsafeToolOutcomeError):
                finish_tool_checkpoint(
                    checkpoint,
                    error=TimeoutError("provider timeout"),
                    journal=journal,
                )
        tool = journal.list_tool_calls("run-1")[0]
        assert tool.status == "outcome_unknown"
        assert tool.result["external_effect_may_have_occurred"] is True


def test_interrupted_subagent_control_is_ambiguous_and_fails_closed(tmp_path):
    with _running_journal(tmp_path) as journal:
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="delegate-ambiguous",
                tool_name="agent_run_subagent",
                arguments={"description": "Research references"},
                journal=journal,
                declared_safety=(ToolSafetyClass.INTERNAL_CONTROL, None),
            )
            with pytest.raises(UnsafeToolOutcomeError):
                finish_tool_checkpoint(
                    checkpoint,
                    error=TimeoutError("parent stopped waiting"),
                    journal=journal,
                )

        tool = journal.list_tool_calls("run-1")[0]
        assert tool.status == "outcome_unknown"
        assert tool.result["external_effect_may_have_occurred"] is False
        assert tool.result["delegated_work_may_still_be_running"] is True
        child = RunStepCoordinator(journal).replay("run-1")[checkpoint.step_id]
        assert child.status == "blocked"


def test_tool_error_remains_useful_without_persisting_embedded_credentials(
    tmp_path,
):
    with _running_journal(tmp_path) as journal:
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="call-error-redaction",
                tool_name="read_file",
                arguments={"path": "notes.md"},
                journal=journal,
            )
            finish_tool_checkpoint(
                checkpoint,
                error=RuntimeError(
                    "provider rejected Bearer abcdefghijklmnopqrstuv"
                ),
                journal=journal,
            )

        tool = journal.list_tool_calls("run-1")[0]
        assert tool.status == "failed"
        assert tool.result == {"error": "provider rejected Bearer [REDACTED]"}


def test_unsafe_tool_soft_error_is_known_failed_and_does_not_block_resume(
    tmp_path,
):
    with _running_journal(tmp_path) as journal:
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="call-soft-error",
                tool_name="search_vendor_catalog",
                arguments={"query": "widgets"},
                journal=journal,
            )
            finish_tool_checkpoint(
                checkpoint,
                result={"error": "rate limited"},
                error=RuntimeError("rate limited"),
                outcome_known=True,
                journal=journal,
            )

        tool = journal.list_tool_calls("run-1")[0]
        assert tool.safety_class == ToolSafetyClass.UNSAFE_WRITE.value
        assert tool.status == "failed"
        assert tool.outcome == "failed"
        assert tool.result == {"error": "rate limited"}

        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="interrupt-after-soft-error",
                event_type="runtime.interrupted",
                payload={"reason": "test"},
            ),
        )
        resumed = journal.create_run_attempt(
            "run-1",
            request_id="resume-after-soft-error",
            reason="explicit_resume",
        )
        assert resumed.status == "pending"


def test_missing_journal_checkpoint_prevents_tool_dispatch(tmp_path):
    class BrokenJournal:
        def get_run(self, _run_id):
            raise OSError("disk full")

    with run_context_scope(_context(tmp_path)):
        with pytest.raises(ToolCheckpointPersistenceError):
            prepare_tool_checkpoint(
                raw_tool_call_id="call-1",
                tool_name="send_email",
                arguments={},
                journal=BrokenJournal(),
            )


def test_tool_safety_is_conservative_and_requires_real_idempotency_key():
    assert classify_tool_safety("read_file", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert classify_tool_safety("browser_get_page_snapshot", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert classify_tool_safety("browser_click", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )
    assert classify_tool_safety("browser_type", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )
    assert classify_tool_safety("write_record", {"request_id": "req-1"}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )
    assert classify_tool_safety(
        "write_record", {"idempotency_key": "model-invented"}
    ) == (ToolSafetyClass.UNSAFE_WRITE, None)
    assert classify_tool_safety("write_record", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_builtin_read_tools_and_code_owned_declarations_are_trusted():
    assert classify_tool_safety("search_google", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert classify_tool_safety("search_querit", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    assert classify_tool_safety("web_fetch_and_analyze", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )

    class Tool:
        pass

    declared = declare_tool_safety(Tool(), ToolSafetyClass.SAFE_READ)
    assert declared_tool_safety(declared, "vendor_lookup", {}) == (
        ToolSafetyClass.SAFE_READ,
        None,
    )
    # Arbitrary MCP tools remain conservative unless trusted application code
    # attached a declaration to the concrete FunctionTool object.
    assert declared_tool_safety(Tool(), "mcp_create_ticket", {}) == (
        ToolSafetyClass.UNSAFE_WRITE,
        None,
    )


def test_tool_safety_declaration_does_not_swallow_unexpected_proxy_errors():
    class ExplodingProxy:
        def __setattr__(self, name, value):
            raise RuntimeError("proxy declaration failed")

    with pytest.raises(RuntimeError, match="proxy declaration failed"):
        declare_tool_safety(ExplodingProxy(), ToolSafetyClass.SAFE_READ)
