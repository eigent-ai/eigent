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

"""Isolated ownership blocks legacy scanning, auto-apply and lease release.

Use temporary SQLite fixtures and the dotenv-disabled validation runner. No
application server, real user workspace, account journal or model is started.
"""

from __future__ import annotations

import sqlite3
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import artifacts
from app.run_journal import SQLiteRunJournal
from app.workspace_git.lifecycle import WorkspaceGitLifecycle
from app.workspace_runtime.entry_guard import has_isolated_workspace_binding
from app.workspace_runtime.store import WorkspaceStateStore


@pytest.fixture
def isolated(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite") as journal:
        state = WorkspaceStateStore(journal)
        root = tmp_path / "space"
        root.mkdir()
        target = state.register_target(root)
        journal.ensure_run(
            run_id="isolated", project_id="project", status="pending"
        )
        with journal._write_transaction() as connection:
            attempt = journal._create_run_attempt_in_transaction(
                connection,
                "isolated",
                request_id="request",
                reason="test",
                activate=False,
            )
            state.bind_run_in_transaction(
                connection,
                run_id="isolated",
                attempt_id=attempt.attempt_id,
                generation=1,
                workspace_id="private-workspace",
                provider="directory",
                snapshot_revision="immutable-input",
                root_path=str(tmp_path / "private"),
                target=target,
                policy_version="isolated-v1",
            )
        yield journal


def durable_facts(journal):
    return {
        table: tuple(
            tuple(row)
            for row in journal._connection.execute(f"SELECT * FROM {table}")
        )
        for table in (
            "runs",
            "run_attempts",
            "run_workspace_bindings",
            "run_workspace_finalizations",
            "project_run_execution_leases",
            "run_events",
        )
    }


@pytest.mark.parametrize(
    "barrier_state", ["pending", "settling", "needs_attention", "settled"]
)
def test_legacy_artifact_entrypoints_never_consult_live_or_old_manifest(
    isolated, monkeypatch, barrier_state
):
    journal = isolated
    journal._connection.execute(
        "UPDATE run_workspace_finalizations SET state=?", (barrier_state,)
    )
    journal._connection.execute("UPDATE runs SET status='completed'")
    run = journal.get_run("isolated")
    before = durable_facts(journal)
    no_scan = MagicMock(
        side_effect=AssertionError("must not access live files")
    )
    monkeypatch.setattr(artifacts, "get_workspace_resolver", no_scan)
    monkeypatch.setattr(artifacts, "discover_task_changed_files", no_scan)
    monkeypatch.setattr(journal, "get_run_artifact_manifest_event", no_scan)
    monkeypatch.setattr(journal, "get_run_git_materialization", no_scan)
    with pytest.raises(artifacts.IsolatedArtifactFinalizationRequired):
        artifacts.finalize_run_artifacts(journal, run)
    with pytest.raises(artifacts.IsolatedArtifactFinalizationRequired):
        artifacts.record_artifact_manifest(
            journal,
            run_id=run.run_id,
            project_id=run.project_id,
            artifacts=[],
        )
    with pytest.raises(artifacts.IsolatedArtifactFinalizationRequired):
        artifacts._git_run_changed_artifacts(journal, run)
    no_scan.assert_not_called()
    assert durable_facts(journal) == before


@pytest.mark.parametrize("retained_marker", ["binding", "barrier"])
def test_either_retained_marker_blocks_legacy_even_if_other_is_missing(
    isolated, retained_marker
):
    journal = isolated
    # Model a damaged recovery fixture, never a production mutation path.
    # A finalization receipt alone still denies legacy filesystem authority.
    journal._connection.execute("PRAGMA foreign_keys=OFF")
    table = (
        "run_workspace_finalizations"
        if retained_marker == "binding"
        else "run_workspace_bindings"
    )
    journal._connection.execute(f"DELETE FROM {table}")
    journal._connection.execute("PRAGMA foreign_keys=ON")
    assert has_isolated_workspace_binding(journal, "isolated")
    with pytest.raises(artifacts.IsolatedArtifactFinalizationRequired):
        artifacts.finalize_run_artifacts(journal, journal.get_run("isolated"))


def test_startup_artifact_batch_skips_isolated_and_keeps_legacy_behavior(
    isolated, monkeypatch
):
    journal = isolated
    journal.ensure_run(run_id="legacy", project_id="legacy-project")
    before = durable_facts(journal)
    visited = []
    monkeypatch.setattr(
        artifacts,
        "finalize_run_artifacts",
        lambda _journal, run: visited.append(run.run_id),
    )
    assert artifacts.finalize_recoverable_run_artifacts(journal) == ("legacy",)
    assert visited == ["legacy"]
    assert durable_facts(journal) == before


def test_every_legacy_git_finalization_entry_leaves_isolated_owners_alone(
    isolated,
):
    journal = isolated
    # A historical terminal event is deliberately insufficient to release the
    # still-pending isolated barrier or its Project execution lease.
    journal._connection.execute("UPDATE runs SET status='completed'")
    before = durable_facts(journal)
    lifecycle = object.__new__(WorkspaceGitLifecycle)
    lifecycle.journal = journal
    lifecycle.coordinator = MagicMock()
    lifecycle.git = MagicMock()
    lifecycle.content = MagicMock()
    lifecycle.workforce = MagicMock()
    assert lifecycle.finalize_run("isolated").outcome == "isolated_runtime"
    assert (
        lifecycle.prepare_successful_run("isolated").outcome
        == "isolated_runtime"
    )
    assert (
        lifecycle._finalize_terminal_run(
            "isolated", terminal_status="completed"
        ).outcome
        == "isolated_runtime"
    )
    assert lifecycle._auto_apply_project_to_space("isolated") is False
    recovered = lifecycle.finalize_terminal_runs()
    assert recovered.failed_run_ids == ()
    assert [item.outcome for item in recovered.finalizations] == [
        "isolated_runtime"
    ]
    assert lifecycle.coordinator.mock_calls == []
    assert lifecycle.git.mock_calls == []
    assert lifecycle.content.mock_calls == []
    assert lifecycle.workforce.mock_calls == []
    assert durable_facts(journal) == before


def test_guard_database_failure_cannot_authorize_scan_or_writer_release(
    isolated, monkeypatch
):
    journal = isolated
    run = journal.get_run("isolated")
    no_scan = MagicMock(side_effect=AssertionError("must not scan"))
    monkeypatch.setattr(artifacts, "get_workspace_resolver", no_scan)
    lifecycle = object.__new__(WorkspaceGitLifecycle)
    lifecycle.journal = journal
    lifecycle.coordinator = MagicMock()
    journal.close()
    with pytest.raises(sqlite3.ProgrammingError):
        artifacts.finalize_run_artifacts(journal, run)
    with pytest.raises(sqlite3.ProgrammingError):
        lifecycle.finalize_run(run.run_id)
    no_scan.assert_not_called()
    lifecycle.coordinator.writer_scheduler.finish_task.assert_not_called()


def test_legacy_terminal_without_binding_retains_finish_task(
    isolated, monkeypatch
):
    journal = isolated
    journal.ensure_run(run_id="legacy", project_id="legacy-project")
    journal._connection.execute(
        "UPDATE runs SET status='completed' WHERE run_id='legacy'"
    )
    lifecycle = object.__new__(WorkspaceGitLifecycle)
    lifecycle.journal = journal
    lifecycle.coordinator = MagicMock()
    expected = SimpleNamespace(outcome="legacy-completed")
    finalized = MagicMock(return_value=expected)
    monkeypatch.setattr(lifecycle, "_finalize_terminal_run", finalized)
    assert lifecycle.finalize_run("legacy") is expected
    finalized.assert_called_once_with("legacy", terminal_status="completed")
    lifecycle.coordinator.writer_scheduler.finish_task.assert_called_once_with(
        run_id="legacy"
    )
