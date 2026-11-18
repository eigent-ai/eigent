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

"""Task admission refuses a home-folder Space with a coded reason.

Before this check, such a Task was admitted and then failed while its agents
were built, which clients could only show as a generic failure.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.controller.chat_controller import improve, start_chat_stream
from app.exception.exception import UserException
from app.model.chat import Chat, Status, SupplementChat
from app.run_context import RunContext
from app.run_runtime import RunCoordinator
from app.utils.workspace_resolver import (
    SpaceFolderNotUsableError,
    WorkspaceBinding,
    WorkspaceResolver,
    WorkspaceStore,
)


@pytest.fixture
def home(tmp_path: Path, monkeypatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    return home


@pytest.fixture
def journal():
    journal = MagicMock()
    journal.get_run.return_value = None
    journal.list_run_attempts.return_value = []
    with (
        patch(
            "app.controller.chat_controller.get_default_run_journal",
            return_value=journal,
        ),
        # A unit double, not a durable Journal: skip the ownership guard,
        # which has its own tests.
        patch(
            "app.controller.chat_controller.guard_legacy_execution_entry",
            new=AsyncMock(),
        ),
    ):
        yield journal


def _home_bound_resolver(home: Path) -> WorkspaceResolver:
    binding = WorkspaceBinding(
        space_id="space-1",
        workspace_root=str(home),
        source="local",
        created_at="2026-11-11T00:00:00Z",
        updated_at="2026-11-11T00:00:00Z",
    )
    store = WorkspaceStore()
    store.get_binding = lambda *args, **kwargs: binding
    return WorkspaceResolver(store=store)


@pytest.mark.asyncio
async def test_new_task_in_home_folder_space_is_refused_before_agents(
    home, journal, sample_chat_data, mock_request, mock_task_lock
):
    chat_data = Chat(**{**sample_chat_data, "space_id": "space-1"})

    with (
        patch(
            "app.controller.chat_controller.get_or_create_task_lock",
            return_value=mock_task_lock,
        ),
        patch(
            "app.controller.chat_controller.get_workspace_resolver",
            return_value=_home_bound_resolver(home),
        ),
        patch(
            "app.controller.chat_controller.get_default_run_coordinator",
            return_value=RunCoordinator(),
        ),
        patch(
            "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
            new=AsyncMock(return_value=True),
        ),
        patch("app.controller.chat_controller.step_solve") as solve,
        patch(
            "app.agent.toolkit.terminal_toolkit.TerminalToolkit.__init__",
            side_effect=AssertionError("agents must not be built"),
        ),
    ):
        with pytest.raises(UserException) as error:
            await start_chat_stream(chat_data, mock_request)

    assert error.value.error_code == "space_folder_is_home"
    assert "home folder" in error.value.description
    journal.ensure_run.assert_not_called()
    journal.create_run_attempt.assert_not_called()
    solve.assert_not_called()


@pytest.mark.asyncio
async def test_follow_up_in_home_folder_space_is_refused_not_ignored(
    tmp_path, journal, mock_request, mock_task_lock
):
    old_context = RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-old",
        task_id="run-old",
        email="u@example.com",
        user_id="42",
        working_directory=tmp_path,
        task_output_root=tmp_path / "old-output",
        camel_log_dir=tmp_path / "old-log",
        binding_source="test",
        workdir_mode=None,
        browser_port=9222,
    )
    mock_task_lock.run_context = old_context
    mock_task_lock.status = Status.done
    mock_task_lock.email = "u@example.com"
    mock_task_lock.user_id = "42"
    mock_request.state = SimpleNamespace(browser_port=9222, cdp_url=None)
    resolver = MagicMock()
    resolver.freeze_task_directories_for.side_effect = (
        SpaceFolderNotUsableError("space_folder_is_home")
    )

    with (
        patch(
            "app.controller.chat_controller.get_default_run_coordinator",
            return_value=RunCoordinator(),
        ),
        patch(
            "app.controller.chat_controller.get_task_lock",
            return_value=mock_task_lock,
        ),
        patch(
            "app.controller.chat_controller.get_workspace_resolver",
            return_value=resolver,
        ),
        patch(
            "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
            new=AsyncMock(return_value=True),
        ),
    ):
        with pytest.raises(UserException) as error:
            await improve(
                "project-1",
                SupplementChat(question="next", task_id="run-new"),
                mock_request,
            )

    assert error.value.error_code == "space_folder_is_home"
    assert mock_task_lock.run_context is old_context
    journal.ensure_run.assert_not_called()
    journal.create_run_attempt.assert_not_called()
    mock_task_lock.put_queue.assert_not_awaited()
