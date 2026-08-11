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
from app.run_runtime.tool_checkpoint import (
    ToolCheckpointPersistenceError,
    UnsafeToolOutcomeError,
    classify_tool_safety,
    declare_tool_safety,
    declared_tool_safety,
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
            assert "password" not in str(argv)
            finish_tool_checkpoint(
                checkpoint,
                result={"content": "hello"},
                journal=journal,
            )
        tool = journal.list_tool_calls("run-1")[0]
        assert tool.status == "completed"
        assert tool.result == {"content": "hello"}


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
