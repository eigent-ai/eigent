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
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agent.toolkit.human_toolkit import HumanToolkit
from app.run_context import RunContext
from app.run_journal import SQLiteRunJournal


def _run_context(tmp_path: Path) -> RunContext:
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
async def test_ask_human_creates_question_not_approval(tmp_path):
    task_lock = MagicMock()
    task_lock.run_context = _run_context(tmp_path)
    task_lock.add_human_input_listen = MagicMock()
    task_lock.put_queue = AsyncMock()
    task_lock.get_human_input = AsyncMock(return_value="report.csv")

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        journal.ensure_run(run_id="run-1", project_id="project-1")
        journal.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=1,
        )
        with (
            patch(
                "app.agent.toolkit.human_toolkit.get_task_lock",
                return_value=task_lock,
            ),
            patch(
                "app.utils.listen.toolkit_listen.get_task_lock",
                return_value=task_lock,
            ),
            patch(
                "app.agent.toolkit.human_toolkit.get_default_run_journal",
                return_value=journal,
            ),
            patch("app.run_sync.runtime.notify_default_cloud_sync_worker"),
        ):
            toolkit = HumanToolkit("project-1", "worker")
            reply = await toolkit.ask_human_via_gui("Which file?")

        assert reply == "report.csv"
        assert journal.list_approvals("run-1") == []
        interaction = journal.list_human_interactions("run-1")[0]
        assert interaction.interaction_type == "question"
        queued = next(
            call.args[0]
            for call in task_lock.put_queue.await_args_list
            if "interaction_id" in getattr(call.args[0], "data", {})
        )
        assert queued.data["interaction_id"] == interaction.interaction_id
        assert "approval_id" not in queued.data


@pytest.mark.asyncio
async def test_ask_human_pauses_active_agent_timeout():
    task_lock = MagicMock()
    task_lock.run_context = None
    task_lock.add_human_input_listen = MagicMock()
    task_lock.put_queue = AsyncMock()
    pause_state = {"active": False}

    @asynccontextmanager
    async def observed_pause(observer: object) -> AsyncIterator[None]:
        assert observer is task_lock
        pause_state["active"] = True
        try:
            yield
        finally:
            pause_state["active"] = False

    async def delayed_reply(_agent_name: str) -> str:
        assert pause_state["active"]
        await asyncio.sleep(0)
        assert pause_state["active"]
        return "continue"

    task_lock.get_human_input = AsyncMock(side_effect=delayed_reply)

    with (
        patch(
            "app.agent.toolkit.human_toolkit.get_task_lock",
            return_value=task_lock,
        ),
        patch(
            "app.utils.listen.toolkit_listen.get_task_lock",
            return_value=task_lock,
        ),
        patch(
            "app.agent.toolkit.human_toolkit.pause_active_execution_timeout",
            side_effect=observed_pause,
        ),
    ):
        toolkit = HumanToolkit("project-1", "worker")
        reply = await toolkit.ask_human_via_gui("Continue?")

    assert reply == "continue"
    assert pause_state["active"] is False


def test_send_message_notice_uses_current_tool_call_identity():
    task_lock = MagicMock()
    task_lock.add_human_input_listen = MagicMock()
    put_queue = MagicMock()

    with (
        patch(
            "app.agent.toolkit.human_toolkit.get_task_lock",
            return_value=task_lock,
        ),
        patch(
            "app.utils.listen.toolkit_listen.get_task_lock",
            return_value=task_lock,
        ),
        patch(
            "app.agent.toolkit.human_toolkit.get_current_tool_checkpoint",
            return_value=MagicMock(tool_call_id="tool-call-1"),
        ),
        patch(
            "app.utils.listen.toolkit_listen._safe_put_queue",
            put_queue,
        ),
    ):
        HumanToolkit("project-1", "worker").send_message_to_user(
            "Ready", "The report is ready."
        )

    notice = put_queue.call_args.args[1]
    assert notice.data == "The report is ready."
    assert notice.title == "Ready"
    assert notice.notice_id == "notice:tool-call-1"
    assert notice.purpose == "progress"
    assert notice.severity == "info"
    assert notice.tool_call_id == "tool-call-1"
