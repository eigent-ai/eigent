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
import sqlite3
import time
from dataclasses import replace
from pathlib import Path

import pytest

from app.permission_policy import (
    ToolPermissionRejectedError,
    authorize_tool_checkpoint,
)
from app.permission_policy.service import PermissionPolicyService
from app.run_context import RunContext, run_context_scope
from app.run_journal import SQLiteRunJournal
from app.run_runtime.active_timeout import ActiveExecutionTimeout
from app.run_runtime.tool_checkpoint import (
    dispatch_tool_checkpoint,
    finish_tool_checkpoint,
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


class _ManualLoopClock:
    """Event-loop clock that only moves when the test advances it."""

    def __init__(self, now: float) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


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
            assert ask.data["expires_at"] == approval.expires_at
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
async def test_durable_approval_wait_outlives_agent_execution_timeout(
    tmp_path,
    monkeypatch,
):
    task_lock = TaskLock("project-1", asyncio.Queue(), {})
    agent_budget = 30 * 60
    human_decision_latency = 60 * 60
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
                raw_tool_call_id="call-long-approval",
                tool_name="write_file",
                arguments={"path": "report.md", "content": "hello"},
                dispatch_immediately=False,
                journal=journal,
            )
            assert checkpoint is not None
            # The Agent budget runs on the event-loop clock. Driving that
            # clock by hand keeps the real time spent writing the Approval
            # from deciding whether the budget expires before the wait
            # pauses it.
            loop = asyncio.get_running_loop()
            clock = _ManualLoopClock(loop.time())
            with monkeypatch.context() as patch:
                patch.setattr(loop, "time", clock)
                async with ActiveExecutionTimeout(agent_budget) as timeout:
                    waiter = asyncio.create_task(
                        authorize_tool_checkpoint(
                            checkpoint,
                            arguments={
                                "path": "report.md",
                                "content": "hello",
                            },
                            toolkit_name="File Toolkit",
                            agent_name="worker",
                            task_lock=task_lock,
                            journal=journal,
                        )
                    )
                    ask = await task_lock.get_queue()
                    # The ASK is published only once the wait has paused the
                    # Agent budget.
                    assert task_lock.active_execution_budget_paused
                    # This exceeds the active Agent budget but remains below
                    # the durable Approval expiry. It must not cancel the
                    # tool loop.
                    assert (
                        human_decision_latency
                        < ask.data["expires_at"] - time.time()
                    )
                    clock.now += human_decision_latency
                    assert timeout.remaining() == pytest.approx(agent_budget)
                    approval = journal.list_approvals("run-1")[0]
                    journal.decide_approval(
                        approval.approval_id,
                        decision="approved",
                        expected_version=0,
                        action_digest=ask.data["action_digest"],
                        decision_request_id="decision-after-long-wait",
                        continue_active_attempt=True,
                        now=2,
                    )
                    await task_lock.put_human_input("worker", "approved")
                    decision = await waiter
                    assert decision.action_digest == ask.data["action_digest"]
                    # Resuming restores the budget the wait did not consume.
                    assert timeout.remaining() == pytest.approx(agent_budget)
                assert not timeout.expired


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


@pytest.mark.asyncio
async def test_large_tool_body_cannot_hide_resource_from_deny_rule(tmp_path):
    task_lock = TaskLock("project-1", asyncio.Queue(), {})
    denied_path = "/secrets/private-report.md"
    arguments = {"filename": denied_path, "content": "x" * 20_000}
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        journal.create_approval_rule(
            rule_id="deny-secrets",
            space_id="space-1",
            effect="deny",
            action_pattern="filesystem.write",
            resource_pattern=denied_path,
            scope="space",
            run_id=None,
            source_interaction_id=None,
            expires_at=None,
            created_by="user-1",
            now=1,
        )
        with run_context_scope(_context(tmp_path)):
            checkpoint = prepare_tool_checkpoint(
                raw_tool_call_id="call-large",
                tool_name="write_to_file",
                arguments=arguments,
                dispatch_immediately=False,
                journal=journal,
            )
            assert checkpoint is not None
            assert checkpoint.request.get("truncated") is True
            with pytest.raises(ToolPermissionRejectedError):
                await authorize_tool_checkpoint(
                    checkpoint,
                    arguments=arguments,
                    toolkit_name="File Toolkit",
                    agent_name="worker",
                    task_lock=task_lock,
                    journal=journal,
                )

        assert journal.list_approvals("run-1") == []
        assert task_lock.queue.empty()


@pytest.mark.asyncio
async def test_direct_sqlite_approval_edit_has_no_live_dispatch_authority(
    tmp_path,
):
    task_lock = TaskLock("project-1", asyncio.Queue(), {})
    journal_path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(journal_path) as journal:
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
                raw_tool_call_id="call-tamper",
                tool_name="write_file",
                arguments={"path": "report.md"},
                dispatch_immediately=False,
                journal=journal,
            )
            assert checkpoint is not None
            waiter = asyncio.create_task(
                authorize_tool_checkpoint(
                    checkpoint,
                    arguments={"path": "report.md"},
                    toolkit_name="File Toolkit",
                    agent_name="worker",
                    task_lock=task_lock,
                    journal=journal,
                )
            )
            await task_lock.get_queue()
            approval = journal.list_approvals("run-1")[0]
            with sqlite3.connect(journal_path) as attacker:
                attacker.execute(
                    """
                    UPDATE approvals
                    SET status = 'approved', decision_json = '{"decision":"approved"}',
                        version = 1, resolved_at = 2
                    WHERE approval_id = ?
                    """,
                    (approval.approval_id,),
                )
            await task_lock.put_human_input("worker", "approved")

            with pytest.raises(ToolPermissionRejectedError):
                await waiter


@pytest.mark.asyncio
async def test_missing_approval_expiry_fails_closed_and_cleans_listener(
    tmp_path, monkeypatch
):
    task_lock = TaskLock("project-1", asyncio.Queue(), {})
    original = PermissionPolicyService.evaluate_and_request_approval

    def without_expiry(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        assert result.approval is not None
        return replace(
            result,
            approval=replace(result.approval, expires_at=None),
        )

    monkeypatch.setattr(
        PermissionPolicyService,
        "evaluate_and_request_approval",
        without_expiry,
    )
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
                raw_tool_call_id="call-no-expiry",
                tool_name="write_file",
                arguments={"path": "report.md"},
                dispatch_immediately=False,
                journal=journal,
            )
            with pytest.raises(
                ToolPermissionRejectedError, match="no persisted expiry"
            ):
                await authorize_tool_checkpoint(
                    checkpoint,
                    arguments={"path": "report.md"},
                    toolkit_name="File Toolkit",
                    agent_name="worker",
                    task_lock=task_lock,
                    journal=journal,
                )

    assert task_lock.human_input_waiters["worker"] == []


@pytest.mark.asyncio
async def test_expired_tool_is_reevaluated_with_new_approval_identity_on_resume(
    tmp_path, monkeypatch
):
    original = PermissionPolicyService.evaluate_and_request_approval
    first = True

    def expire_first(self, *args, **kwargs):
        nonlocal first
        if first:
            kwargs["expires_at"] = time.time() + 0.05
            first = False
        return original(self, *args, **kwargs)

    monkeypatch.setattr(
        PermissionPolicyService, "evaluate_and_request_approval", expire_first
    )
    task_lock = TaskLock("project-1", asyncio.Queue(), {})
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
        )
        with run_context_scope(_context(tmp_path)):
            arguments = {"path": "report.md", "content": "hello"}
            old = prepare_tool_checkpoint(
                raw_tool_call_id="old-call",
                tool_name="write_file",
                arguments=arguments,
                dispatch_immediately=False,
                journal=journal,
            )
            with pytest.raises(ToolPermissionRejectedError) as rejected:
                await authorize_tool_checkpoint(
                    old,
                    arguments=arguments,
                    toolkit_name="File Toolkit",
                    agent_name="worker",
                    task_lock=task_lock,
                    journal=journal,
                )
            old_ask = await task_lock.get_queue()
            finish_tool_checkpoint(
                old, error=rejected.value, outcome_known=True, journal=journal
            )
            assert journal.get_run("run-1").status == "interrupted"
            assert journal.list_tool_calls("run-1")[0].dispatched_at is None
            assert (
                journal.get_human_interaction(
                    old_ask.data["interaction_id"]
                ).status
                == "expired"
            )
            journal.create_run_attempt(
                "run-1",
                request_id="resume",
                reason="explicit_resume",
                activate=True,
            )
            new = prepare_tool_checkpoint(
                raw_tool_call_id="new-call",
                tool_name="write_file",
                arguments=arguments,
                dispatch_immediately=False,
                journal=journal,
            )
            waiter = asyncio.create_task(
                authorize_tool_checkpoint(
                    new,
                    arguments=arguments,
                    toolkit_name="File Toolkit",
                    agent_name="worker",
                    task_lock=task_lock,
                    journal=journal,
                )
            )
            try:
                new_ask = await task_lock.get_queue()
                assert (
                    new_ask.data["approval_id"] != old_ask.data["approval_id"]
                )
                assert (
                    new_ask.data["interaction_id"]
                    != old_ask.data["interaction_id"]
                )
                assert (
                    new_ask.data["action_digest"]
                    != old_ask.data["action_digest"]
                )
                assert new_ask.data["version"] == 0
                assert not journal.approval_decision_is_trusted(
                    old_ask.data["approval_id"],
                    version=old_ask.data["version"],
                    action_digest=old_ask.data["action_digest"],
                )
                journal.decide_approval(
                    new_ask.data["approval_id"],
                    decision="approved",
                    expected_version=new_ask.data["version"],
                    action_digest=new_ask.data["action_digest"],
                    decision_request_id="resumed-decision",
                    continue_active_attempt=True,
                )
                await task_lock.put_human_input("worker", "approved")
                await waiter
                dispatch_tool_checkpoint(new, journal=journal)
            finally:
                waiter.cancel()
                await asyncio.gather(waiter, return_exceptions=True)
            tools = {
                tool.tool_call_id: tool
                for tool in journal.list_tool_calls("run-1")
            }
            assert tools[old.tool_call_id].dispatched_at is None
            assert tools[new.tool_call_id].status == "dispatched"
