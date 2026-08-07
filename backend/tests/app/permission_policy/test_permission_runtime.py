from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.permission_policy import (
    ToolPermissionRejectedError,
    authorize_tool_checkpoint,
)
from app.run_context import RunContext, run_context_scope
from app.run_journal import SQLiteRunJournal
from app.run_runtime.tool_checkpoint import (
    dispatch_tool_checkpoint,
    prepare_tool_checkpoint,
)
from app.service.task import TaskLock


def _context(tmp_path: Path) -> RunContext:
    return RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="project-1",
        email="user@example.com",
        user_id="user-1",
        working_directory=tmp_path,
        task_output_root=tmp_path,
        camel_log_dir=tmp_path / "camel_logs",
        binding_source="test",
        workdir_mode="workspace",
        browser_port=9222,
    )


@pytest.mark.asyncio
async def test_unsafe_tool_is_not_dispatched_until_digest_bound_approval(
    tmp_path,
):
    task_lock = TaskLock("project-1", asyncio.Queue(), {})
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="call-1",
                tool_name="write_file",
                arguments={"path": "report.md", "content": "hello"},
                dispatch_immediately=False,
                journal=journal,
            )
            assert checkpoint is not None
            waiter = asyncio.create_task(
                authorize_tool_checkpoint(
                    checkpoint,
                    arguments={"path": "report.md", "content": "hello"},
                    toolkit_name="File Toolkit",
                    agent_name="worker",
                    task_lock=task_lock,
                    journal=journal,
                )
            )
            ask = await task_lock.get_queue()
            assert journal.list_tool_calls("run-1")[0].status == "prepared"
            approval = journal.list_approvals("run-1")[0]
            assert ask.data["action_digest"] == approval.action_digest

            journal.decide_approval(
                approval.approval_id,
                decision="approved",
                expected_version=0,
                action_digest=ask.data["action_digest"],
                decision_request_id="decision-1",
                continue_active_attempt=True,
                now=2,
            )
            await asyncio.sleep(0)
            await task_lock.put_human_input("worker", "approved")
            await waiter
            dispatch_tool_checkpoint(checkpoint, journal=journal)

        assert journal.list_tool_calls("run-1")[0].status == "dispatched"


@pytest.mark.asyncio
async def test_read_only_profile_denies_write_before_dispatch(tmp_path):
    task_lock = TaskLock("project-1", asyncio.Queue(), {})
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.put_space_permission_profile(
            space_id="space-1",
            profile_name="read_only",
            sandbox_mode="read-only",
            approval_mode="on-request",
            reviewer_mode="user",
            updated_by="user-1",
            now=1,
        )
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="call-1",
                tool_name="write_file",
                arguments={"path": "report.md"},
                dispatch_immediately=False,
                journal=journal,
            )
            with pytest.raises(ToolPermissionRejectedError):
                await authorize_tool_checkpoint(
                    checkpoint,
                    arguments={"path": "report.md"},
                    toolkit_name="File Toolkit",
                    agent_name="worker",
                    task_lock=task_lock,
                    journal=journal,
                )

        assert journal.list_tool_calls("run-1")[0].status == "prepared"
        assert journal.list_approvals("run-1") == []
