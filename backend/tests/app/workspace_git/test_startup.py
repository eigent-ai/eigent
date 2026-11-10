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

import logging

import pytest

from app.run_journal import SQLiteRunJournal
from app.workspace_git import backend, startup as startup_module
from app.workspace_git.startup import reconcile_workspace_git_startup


def test_startup_reconciliation_skips_missing_git(
    tmp_path,
    monkeypatch,
    caplog,
) -> None:
    monkeypatch.delenv("EIGENT_BUNDLED_GIT", raising=False)
    monkeypatch.setattr(backend.shutil, "which", lambda _name: None)

    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as journal:
        with caplog.at_level(logging.WARNING):
            result = reconcile_workspace_git_startup(journal)

    assert result.skipped is True
    assert result.skipped_reason == "Git runtime is not available"
    assert result.workforce.recovered_workspace_ids == ()
    assert result.mutations.recovered_change_set_ids == ()
    assert result.terminal.finalizations == ()
    assert result.observation.changes == ()
    assert "Workspace Git startup reconciliation skipped" in caplog.text


def test_startup_reconciliation_keeps_non_git_failures_visible(
    tmp_path,
    monkeypatch,
) -> None:
    fake_git = tmp_path / "git.exe"
    fake_git.touch()
    monkeypatch.setenv("EIGENT_BUNDLED_GIT", str(fake_git))

    def fail_reconciliation(*_args, **_kwargs):
        raise RuntimeError("journal reconciliation failed")

    monkeypatch.setattr(
        startup_module,
        "WorkspaceGitCoordinator",
        fail_reconciliation,
    )

    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as journal:
        with pytest.raises(
            RuntimeError,
            match="journal reconciliation failed",
        ):
            reconcile_workspace_git_startup(journal)


def test_startup_reconciliation_runs_when_git_is_configured(
    tmp_path,
    monkeypatch,
) -> None:
    fake_git = tmp_path / "git.exe"
    fake_git.touch()
    monkeypatch.setenv("EIGENT_BUNDLED_GIT", str(fake_git))

    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as journal:
        result = reconcile_workspace_git_startup(journal)

    assert result.skipped is False
    assert result.skipped_reason is None
    assert result.workforce.recovered_workspace_ids == ()
    assert result.mutations.recovered_change_set_ids == ()
    assert result.terminal.finalizations == ()
    assert result.observation.changes == ()
