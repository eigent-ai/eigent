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

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

import pytest

from app.run_journal import (
    SCHEMA_VERSION,
    InvalidRunTransitionError,
    RunEventDraft,
    SQLiteRunJournal,
)
from app.workspace_runtime.content import InvalidWorkspacePath
from app.workspace_runtime.store import (
    WorkspaceBusy,
    WorkspaceFenceLost,
    WorkspaceStateError,
    WorkspaceStateStore,
)


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite") as journal:
        yield journal


def bind(journal, tmp_path, *, run="run", project="project"):
    state = WorkspaceStateStore(journal)
    root = tmp_path / "space"
    root.mkdir(exist_ok=True)
    target = state.register_target(root)
    journal.ensure_run(run_id=run, project_id=project, status="pending")
    with journal._write_transaction() as connection:
        attempt = journal._create_run_attempt_in_transaction(
            connection, run, request_id=run, reason="test", activate=False
        )
        state.bind_run_in_transaction(
            connection,
            run_id=run,
            attempt_id=attempt.attempt_id,
            generation=1,
            workspace_id="workspace-" + run,
            provider="directory",
            snapshot_revision="input-" + run,
            root_path=str(tmp_path / run),
            target=target,
            policy_version="isolated-v1",
        )
    return state, attempt, target


def finish(state, attempt, *, run="run", outcome="completed", connection=None):
    current = connection.execute(
        "SELECT status FROM runs WHERE run_id=?", (run,)
    ).fetchone()
    if current[0] != outcome:
        state.journal._append_event_in_transaction(
            connection,
            run,
            RunEventDraft(
                event_id="terminal-" + run,
                event_type="run." + outcome,
                payload={"attempt_id": attempt.attempt_id},
            ),
            run_status=outcome,
            clear_active_attempt=True,
        )
    return state.finalize_in_transaction(
        connection,
        run_id=run,
        attempt_id=attempt.attempt_id,
        generation=1,
        checkpoint_revision="output-" + run,
        manifest_digest="artifact-" + run,
        outcome=outcome,
        changed_paths={"file.txt": "file.txt"},
    )


def stop(state, attempt, run="run"):
    state.record_writer_settlement(
        run_id=run,
        attempt_id=attempt.attempt_id,
        generation=1,
        process_receipt={"outcome": "stopped", "process_birth_identities": []},
    )


def test_migration_reopen_and_real_transaction_rollback(journal, tmp_path):
    assert journal.schema_version == SCHEMA_VERSION
    state, attempt, _ = bind(journal, tmp_path)
    stop(state, attempt)
    with pytest.raises(RuntimeError):
        with journal._write_transaction() as connection:
            finish(state, attempt, connection=connection)
            raise RuntimeError("crash before commit")
    with SQLiteRunJournal(journal.path) as reader:
        assert reader.schema_version == SCHEMA_VERSION
        assert (
            reader._connection.execute(
                "SELECT state FROM run_workspace_finalizations"
            ).fetchone()[0]
            == "settling"
        )
        assert (
            reader._connection.execute(
                "SELECT COUNT(*) FROM workspace_integration_requests"
            ).fetchone()[0]
            == 0
        )
        assert (
            reader._connection.execute(
                "SELECT COUNT(*) FROM project_run_execution_leases"
            ).fetchone()[0]
            == 1
        )
    with journal._write_transaction() as connection:
        request = finish(state, attempt, connection=connection)
    assert request
    with journal._write_transaction() as connection:
        assert finish(state, attempt, connection=connection) == request
    assert state.references("output-run") == (request, "run:run:output")


def test_terminal_and_old_manifest_cannot_bypass_barrier(journal, tmp_path):
    state, attempt, _ = bind(journal, tmp_path)
    journal.append_event(
        "run",
        RunEventDraft(
            event_id="old-manifest",
            event_type="artifact.manifest.finalized",
            payload={"revision": "early"},
        ),
    )
    journal.append_event(
        "run",
        RunEventDraft(
            event_id="cancel",
            event_type="run.cancelled",
            payload={},
        ),
    )
    assert (
        journal._connection.execute(
            "SELECT COUNT(*) FROM project_run_execution_leases"
        ).fetchone()[0]
        == 1
    )
    journal.ensure_run(run_id="next", project_id="project", status="pending")
    with pytest.raises(InvalidRunTransitionError, match="settlement"):
        journal.create_run_attempt("next", request_id="next", reason="test")
    with pytest.raises(WorkspaceBusy):
        with journal._write_transaction() as connection:
            finish(state, attempt, outcome="cancelled", connection=connection)
    stop(state, attempt)
    with journal._write_transaction() as connection:
        assert (
            finish(state, attempt, outcome="cancelled", connection=connection)
            is None
        )
    journal.create_run_attempt("next", request_id="next", reason="test")
    assert journal.get_run("run").status == "cancelled"
    with pytest.raises(WorkspaceFenceLost):
        state.record_writer_settlement(
            run_id="run",
            attempt_id=attempt.attempt_id,
            generation=0,
            process_receipt={"outcome": "stopped"},
        )


def test_terminal_corrupt_missing_barrier_is_fail_closed(journal, tmp_path):
    _, _, _ = bind(journal, tmp_path)
    with journal._write_transaction() as connection:
        connection.execute("DELETE FROM run_workspace_finalizations")
    journal.append_event(
        "run",
        RunEventDraft(
            event_id="cancel",
            event_type="run.cancelled",
            payload={},
        ),
    )
    assert (
        journal._connection.execute(
            "SELECT COUNT(*) FROM project_run_execution_leases"
        ).fetchone()[0]
        == 1
    )


def test_target_aliases_two_connections_single_owner(journal, tmp_path):
    root = tmp_path / "space"
    root.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(root, target_is_directory=True)
    state = WorkspaceStateStore(journal)
    initial = state.register_target(root)
    assert state.register_target(alias) == initial
    barrier = Barrier(2)

    def acquire(owner):
        with SQLiteRunJournal(journal.path) as sibling:
            other = WorkspaceStateStore(sibling)
            expected = other.capture_fence(initial.target_id)
            barrier.wait(timeout=5)
            try:
                return other.acquire_target(
                    expected, owner_kind="integration", owner_id=owner
                )
            except WorkspaceFenceLost:
                return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(acquire, ["A", "B"]))
    owners = [result for result in results if result]
    assert len(owners) == 1
    with pytest.raises(WorkspaceBusy):
        state.capture_fence(initial.target_id)
    recovered = state.require_recovery(owners[0])
    with pytest.raises(WorkspaceFenceLost):
        state.settle_target(owners[0], "wrong-generation")
    settled = state.settle_target(recovered, "complete-postimage")
    assert settled.available
    assert (
        state.revision_at(settled.target_id, settled.receipt_cursor)
        == "complete-postimage"
    )


def test_capture_rejects_aba_and_keeps_historical_boundary(journal, tmp_path):
    root = tmp_path / "space"
    root.mkdir()
    state = WorkspaceStateStore(journal)
    old = state.record_observed_revision(
        state.register_target(root), "same-bytes"
    )
    writing = state.acquire_target(
        old, owner_kind="integration", owner_id="publish"
    )
    now = state.settle_target(writing, "same-bytes")
    assert now.settled_revision == old.settled_revision
    assert now.write_epoch != old.write_epoch
    with pytest.raises(WorkspaceFenceLost):
        state.accept_capture(old, "mixed-candidate", "run:x")
    assert not state.references("mixed-candidate")
    assert state.revision_at(now.target_id, old.receipt_cursor) == "same-bytes"
    assert state.references("same-bytes")


def legacy_binding(journal, root, suffix):
    journal.put_git_repository(
        repository_id="repo-" + suffix,
        space_id="space-" + suffix,
        repository_role="content",
        root_path=str(root),
        root_path_digest="a" * 64,
        ownership="eigent_owned",
        state="ready",
        version_coverage="full",
    )
    return journal.ensure_project_workspace_binding(
        project_id="project-" + suffix,
        repository_id="repo-" + suffix,
        checkout_id="checkout-" + suffix,
        checkout_mode="primary_checkout",
        target_ref="refs/heads/main",
        worktree_path=str(root),
    )


def legacy_enqueue(journal, suffix):
    return journal.enqueue_workspace_writer(
        request_id="legacy-" + suffix,
        repository_id="repo-" + suffix,
        checkout_id="checkout-" + suffix,
        task_id="task-" + suffix,
        project_id="project-" + suffix,
        target_ref="refs/heads/main",
        reason="test",
    )


def test_legacy_import_and_both_directions_use_same_owner(journal, tmp_path):
    root = tmp_path / "space"
    root.mkdir()
    legacy_binding(journal, root, "A")
    assert legacy_enqueue(journal, "A").status == "acquired"
    state = WorkspaceStateStore(journal)
    old = state.register_target(root)
    assert old.owner_kind == "legacy"
    with pytest.raises(WorkspaceBusy):
        state.acquire_target(old, owner_kind="integration", owner_id="B")
    # Old finish_task/terminal cannot release the newly coordinated owner.
    journal.release_workspace_writer(request_id="legacy-A", task_id="task-A")
    assert (
        journal.get_workspace_writer_request("legacy-A").status == "acquired"
    )
    settled = state.settle_legacy_writer(
        old, "legacy-complete", process_receipt={"outcome": "stopped"}
    )
    publishing = state.acquire_target(
        settled, owner_kind="integration", owner_id="B"
    )
    alias = tmp_path / "alias"
    alias.symlink_to(root, target_is_directory=True)
    legacy_binding(journal, alias, "C")
    assert legacy_enqueue(journal, "C").status == "queued"
    assert state.target(old.target_id) == publishing
    after = state.settle_target(publishing, "published-B")
    assert after.owner_kind == "legacy"
    assert after.owner_id == "legacy-C"
    assert after.settled_revision == "published-B"
    assert (
        journal.get_workspace_writer_request("legacy-C").status == "acquired"
    )


def test_ambiguous_legacy_owners_require_recovery(journal, tmp_path):
    root = tmp_path / "space"
    root.mkdir()
    for suffix in ("A", "B"):
        legacy_binding(journal, root, suffix)
        assert legacy_enqueue(journal, suffix).status == "acquired"
    state = WorkspaceStateStore(journal)
    target = state.register_target(root)
    assert target.state == "recovery_required"
    assert target.owner_kind == "recovery"
    with pytest.raises(WorkspaceBusy):
        state.capture_fence(target.target_id)


def test_cancel_intent_rejects_activation(journal, tmp_path):
    _, attempt, _ = bind(journal, tmp_path)
    journal.request_cancel("run", request_id="stop", reason="test")
    with pytest.raises(InvalidRunTransitionError, match="cancelled"):
        journal.activate_run_attempt(attempt.attempt_id)


def test_migrates_real_v35_database_without_changing_legacy_rows(tmp_path):
    path = tmp_path / "old.sqlite"
    root = tmp_path / "space"
    root.mkdir()
    with (
        patch("app.run_journal.store.MIGRATION_V36", ""),
        patch("app.run_journal.store.MIGRATION_V37", ""),
        patch("app.run_journal.store.MIGRATION_V38", ""),
        patch("app.run_journal.store.MIGRATION_V39", ""),
        patch("app.run_journal.store.MIGRATION_V40", ""),
    ):
        with SQLiteRunJournal(path) as old:
            assert old.schema_version == 35
            old.ensure_run(run_id="old-run", project_id="project-A")
            old.put_follow_up_request(
                request_id="queued", project_id="project-A", content="kept"
            )
            legacy_binding(old, root, "A")
            with old._write_transaction() as connection:
                connection.execute(
                    """INSERT INTO workspace_writer_requests
                    (request_id,repository_id,checkout_id,task_id,project_id,target_ref,
                    reason,status,created_at,acquired_at,updated_at)
                    VALUES ('legacy-A','repo-A','checkout-A','task-A','project-A',
                    'refs/heads/main','test','acquired',1,1,1)"""
                )
                connection.execute(
                    """INSERT INTO workspace_writer_leases
                    (repository_id,checkout_id,request_id,task_id,project_id,target_ref,acquired_at,version)
                    VALUES ('repo-A','checkout-A','legacy-A','task-A','project-A','refs/heads/main',1,1)"""
                )
            tables = (
                "runs",
                "follow_up_requests",
                "project_workspace_bindings",
                "workspace_writer_requests",
                "workspace_writer_leases",
            )
            before = {
                table: [
                    tuple(row)
                    for row in old._connection.execute(
                        "SELECT * FROM " + table
                    )
                ]
                for table in tables
            }
    for _ in range(2):
        with SQLiteRunJournal(path) as upgraded:
            assert upgraded.schema_version == SCHEMA_VERSION
            after = {
                table: [
                    tuple(row)
                    for row in upgraded._connection.execute(
                        "SELECT * FROM " + table
                    )
                ]
                for table in tables
            }
            assert before == after
            assert (
                upgraded._connection.execute(
                    "PRAGMA foreign_key_check"
                ).fetchall()
                == []
            )
            assert (
                upgraded._connection.execute(
                    "SELECT COUNT(*) FROM execution_requests"
                ).fetchone()[0]
                == 0
            )
    with SQLiteRunJournal(path) as upgraded:
        target = WorkspaceStateStore(upgraded).register_target(root)
        assert target.owner_kind == "legacy" and target.owner_id == "legacy-A"


def test_v36_upgrade_keeps_pending_publication_and_temp_receipt(tmp_path):
    path = tmp_path / "v36.sqlite"
    tables = (
        "run_workspace_bindings",
        "run_workspace_finalizations",
        "workspace_physical_targets",
        "workspace_integration_requests",
        "workspace_publication_operations",
    )
    with (
        patch("app.run_journal.store.MIGRATION_V37", ""),
        patch("app.run_journal.store.MIGRATION_V38", ""),
        patch("app.run_journal.store.MIGRATION_V39", ""),
        patch("app.run_journal.store.MIGRATION_V40", ""),
    ):
        with SQLiteRunJournal(path) as old:
            assert old.schema_version == 36
            state, attempt, target = bind(old, tmp_path)
            stop(state, attempt)
            with old._write_transaction() as connection:
                request = finish(state, attempt, connection=connection)
            owner = state.acquire_target(
                target, owner_kind="integration", owner_id="publication"
            )
            with old._write_transaction() as connection:
                connection.execute(
                    """INSERT INTO workspace_publication_operations
                    (operation_id,request_id,target_id,owner_generation,
                    worker_generation,candidate_digest,candidate_json,status,created_at)
                    VALUES ('publication',?,?,?,1,'candidate','{}','dispatched',1)""",
                    (request, owner.target_id, owner.owner_generation),
                )
            before = {
                table: [
                    tuple(row)
                    for row in old._connection.execute(
                        "SELECT * FROM " + table
                    )
                ]
                for table in tables
            }
    for iteration in range(2):
        with SQLiteRunJournal(path) as current:
            assert current.schema_version == SCHEMA_VERSION
            assert before == {
                table: [
                    tuple(row)
                    for row in current._connection.execute(
                        "SELECT * FROM " + table
                    )
                ]
                for table in tables
            }
            assert (
                current._connection.execute(
                    "PRAGMA foreign_key_check"
                ).fetchall()
                == []
            )
            if iteration == 0:
                with current._write_transaction() as connection:
                    connection.execute(
                        """INSERT INTO workspace_publication_temporaries
                        (operation_id,temporary_path,relative_path,expected_json,state)
                        VALUES ('publication','.specific-temporary','file.txt','{}','reserved')"""
                    )
            assert (
                current._connection.execute(
                    "SELECT state FROM workspace_publication_temporaries"
                ).fetchone()[0]
                == "reserved"
            )


def test_transaction_helpers_reject_autocommit_and_foreign_connection(
    journal, tmp_path
):
    state, attempt, target = bind(journal, tmp_path)
    with pytest.raises(WorkspaceStateError, match="write transaction"):
        state.retain_in_transaction(journal._connection, "revision", "owner")
    with SQLiteRunJournal(journal.path) as second:
        with second._write_transaction() as connection:
            with pytest.raises(WorkspaceStateError, match="write transaction"):
                state.acquire_target_in_transaction(
                    connection,
                    target,
                    owner_kind="integration",
                    owner_id="bad",
                )
            with pytest.raises(WorkspaceStateError, match="write transaction"):
                state.finalize_in_transaction(
                    connection,
                    run_id="run",
                    attempt_id=attempt.attempt_id,
                    generation=1,
                    checkpoint_revision="output",
                    manifest_digest="artifact",
                    outcome="completed",
                    changed_paths={},
                )
    assert not state.references("revision")
    assert state.target(target.target_id).available


def test_finalization_requires_exact_terminal_outcome(journal, tmp_path):
    state, attempt, _ = bind(journal, tmp_path)
    stop(state, attempt)
    for status in ("pending", "cancelled"):
        if status == "cancelled":
            journal.append_event(
                "run",
                RunEventDraft(
                    event_id="cancel", event_type="run.cancelled", payload={}
                ),
            )
        with pytest.raises(WorkspaceStateError, match="committed Run outcome"):
            with journal._write_transaction() as connection:
                state.finalize_in_transaction(
                    connection,
                    run_id="run",
                    attempt_id=attempt.attempt_id,
                    generation=1,
                    checkpoint_revision="output",
                    manifest_digest="artifact",
                    outcome="completed",
                    changed_paths={"file.txt": "file.txt"},
                )
        assert (
            journal._connection.execute(
                "SELECT COUNT(*) FROM workspace_integration_requests"
            ).fetchone()[0]
            == 0
        )
        assert (
            journal._connection.execute(
                "SELECT COUNT(*) FROM project_run_execution_leases"
            ).fetchone()[0]
            == 1
        )


@pytest.mark.parametrize(
    "path", [".", "C:/escape", "a//b", "../outside", ".git/config"]
)
def test_invalid_publication_paths_rollback_terminal_and_release(
    journal, tmp_path, path
):
    state, attempt, _ = bind(journal, tmp_path)
    stop(state, attempt)
    with pytest.raises(InvalidWorkspacePath):
        with journal._write_transaction() as connection:
            journal._append_event_in_transaction(
                connection,
                "run",
                RunEventDraft(
                    event_id="completed",
                    event_type="run.completed",
                    payload={},
                ),
                run_status="completed",
                clear_active_attempt=True,
            )
            state.finalize_in_transaction(
                connection,
                run_id="run",
                attempt_id=attempt.attempt_id,
                generation=1,
                checkpoint_revision="output",
                manifest_digest="artifact",
                outcome="completed",
                changed_paths={path: "group"},
            )
    assert journal.get_run("run").status == "pending"
    assert (
        journal._connection.execute(
            "SELECT state FROM run_workspace_finalizations"
        ).fetchone()[0]
        == "settling"
    )
    assert (
        journal._connection.execute(
            "SELECT COUNT(*) FROM project_run_execution_leases"
        ).fetchone()[0]
        == 1
    )
