from __future__ import annotations

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
