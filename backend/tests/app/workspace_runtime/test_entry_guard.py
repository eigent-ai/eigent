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

"""Legacy entry points never touch runtime state for managed Sessions."""

from __future__ import annotations

import asyncio
import sqlite3
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.run_journal import SQLiteRunJournal
from app.workspace_runtime.admission import AdmissionStore
from app.workspace_runtime.entry_guard import (
    guard_legacy_execution_entry,
    has_isolated_workspace_binding,
    owns_managed_execution,
)
from app.workspace_runtime.store import WorkspaceStateStore


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as result:
        yield result


def _pending(journal):
    return AdmissionStore(journal).submit(
        request_id="execution-1",
        project_id="managed-project",
        kind="start",
        envelope={"prompt": "synthetic request"},
    )


@pytest.mark.parametrize("status", ["pending", "preparing"])
def test_pending_managed_lane_blocks_only_its_project(journal, status):
    _pending(journal)
    journal._connection.execute(
        "UPDATE execution_requests SET status=?", (status,)
    )
    assert owns_managed_execution(journal, project_id="managed-project")
    assert not owns_managed_execution(journal, project_id="legacy-project")
    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            guard_legacy_execution_entry(journal, project_id="managed-project")
        )
    assert caught.value.status_code == 409
    assert caught.value.detail["code"] == "managed_execution_required"


@pytest.mark.parametrize("status", ["cancelled", "rejected"])
def test_unbound_closed_request_does_not_disable_legacy(journal, status):
    _pending(journal)
    journal._connection.execute(
        "UPDATE execution_requests SET status=?", (status,)
    )
    assert not owns_managed_execution(journal, project_id="managed-project")


def test_claim_remains_authoritative_when_message_has_been_cancelled(journal):
    _pending(journal)
    with journal._write_transaction() as connection:
        connection.execute("UPDATE execution_requests SET status='cancelled'")
        connection.execute(
            """INSERT INTO project_admission_claims
            (project_id,request_id,owner_id,generation,state,heartbeat_at)
            VALUES ('managed-project','execution-1','worker-1',1,'claimed',1)"""
        )
    assert owns_managed_execution(journal, project_id="managed-project")


def test_admitted_request_blocks_legacy_even_without_workspace_binding(
    journal,
):
    journal.ensure_run(
        run_id="admitted-run", project_id="managed-project", status="pending"
    )
    attempt = journal.create_run_attempt(
        "admitted-run",
        request_id="initial",
        reason="initial_execution",
        activate=False,
    )
    _pending(journal)
    with journal._write_transaction() as connection:
        connection.execute(
            """UPDATE execution_requests SET status='admitted',
            admitted_run_id='admitted-run',admitted_attempt_id=?""",
            (attempt.attempt_id,),
        )
    assert owns_managed_execution(journal, run_id="admitted-run")


def _bound(journal, tmp_path):
    journal.ensure_run(
        run_id="bound-run", project_id="managed-project", status="pending"
    )
    attempt = journal.create_run_attempt(
        "bound-run",
        request_id="initial",
        reason="initial_execution",
        activate=False,
    )
    state = WorkspaceStateStore(journal)
    target = state.register_target(tmp_path)
    with journal._write_transaction() as connection:
        state.bind_run_in_transaction(
            connection,
            run_id="bound-run",
            attempt_id=attempt.attempt_id,
            generation=1,
            workspace_id="private-1",
            provider="directory",
            snapshot_revision="snapshot-1",
            root_path=str(tmp_path / "private"),
            target=target,
            policy_version="isolated-v1",
        )


@pytest.mark.parametrize(
    "state", ["pending", "settling", "settled", "needs_attention"]
)
def test_every_bound_generation_stays_managed(journal, tmp_path, state):
    _bound(journal, tmp_path)
    journal._connection.execute(
        "UPDATE run_workspace_finalizations SET state=?", (state,)
    )
    assert has_isolated_workspace_binding(journal, "bound-run")
    assert owns_managed_execution(journal, run_id="bound-run")
    assert not has_isolated_workspace_binding(journal, "unknown-run")


def test_binding_without_finalization_never_enters_legacy(journal, tmp_path):
    _bound(journal, tmp_path)
    journal._connection.execute("DELETE FROM run_workspace_finalizations")
    assert has_isolated_workspace_binding(journal, "bound-run")
    assert owns_managed_execution(journal, project_id="managed-project")


def test_finalization_without_binding_still_blocks_legacy(journal, tmp_path):
    _bound(journal, tmp_path)
    # Model an inconsistent persisted generation without weakening the runtime
    # guard. This temporary test database never contains user state.
    journal._connection.execute("PRAGMA foreign_keys=OFF")
    journal._connection.execute("DELETE FROM run_workspace_bindings")
    journal._connection.execute("PRAGMA foreign_keys=ON")
    assert has_isolated_workspace_binding(journal, "bound-run")
    assert owns_managed_execution(journal, run_id="bound-run")


def test_db_failure_is_not_permission_to_use_legacy(journal):
    journal._connection.execute("DROP TABLE run_workspace_finalizations")
    with pytest.raises(sqlite3.DatabaseError):
        has_isolated_workspace_binding(journal, "anything")


def test_unavailable_journal_fails_closed_before_legacy_entry():
    with pytest.raises(TypeError):
        owns_managed_execution(None, project_id="project-1")
    with pytest.raises(HTTPException) as caught:
        asyncio.run(guard_legacy_execution_entry(None, project_id="project-1"))
    assert caught.value.status_code == 503


@pytest.mark.parametrize(
    "entry",
    [
        "start",
        "improve",
        "warm_improve",
        "enqueue",
        "send_now",
        "cancel",
        "admitted",
        "stop",
        "retire_idle",
    ],
)
def test_chat_entries_reject_before_runtime_or_queue_side_effects(
    journal, monkeypatch, entry
):
    from app.controller import chat_controller as controller

    _pending(journal)
    monkeypatch.setattr(controller, "get_default_run_journal", lambda: journal)
    unsafe = Mock(side_effect=AssertionError("legacy runtime was touched"))
    for name in (
        "get_default_run_coordinator",
        "get_task_lock",
        "get_or_create_task_lock",
    ):
        monkeypatch.setattr(controller, name, unsafe)
    data = SimpleNamespace(
        project_id="managed-project", run_id="new-run", task_id="new-run"
    )
    entries = {
        "start": lambda: controller.start_chat_stream(data, None),
        "improve": lambda: controller.improve("managed-project", data, None),
        "warm_improve": lambda: controller._improve_chat(
            "managed-project", data, None
        ),
        "enqueue": lambda: controller.enqueue_follow_up(
            "managed-project", data
        ),
        "send_now": lambda: controller.send_follow_up_now(
            "managed-project", "execution-1"
        ),
        "cancel": lambda: controller.cancel_follow_up(
            "managed-project", "execution-1"
        ),
        "admitted": lambda: controller.mark_follow_up_admitted(
            "managed-project", "execution-1", data
        ),
        "stop": lambda: controller.stop("managed-project"),
        "retire_idle": lambda: controller.retire_idle_runtime(
            "managed-project", data
        ),
    }
    with pytest.raises(HTTPException) as caught:
        asyncio.run(entries[entry]())
    assert caught.value.status_code == 409
    unsafe.assert_not_called()
    assert (
        journal._connection.execute(
            "SELECT COUNT(*) FROM run_attempts"
        ).fetchone()[0]
        == 0
    )
    assert (
        journal._connection.execute(
            "SELECT COUNT(*) FROM follow_up_requests"
        ).fetchone()[0]
        == 0
    )


@pytest.mark.parametrize("state", ["settled", "needs_attention"])
def test_idle_retirement_cannot_dispose_a_managed_generation(
    journal, tmp_path, monkeypatch, state
):
    from app.controller import chat_controller as controller

    _bound(journal, tmp_path)
    journal._connection.execute(
        "UPDATE run_workspace_finalizations SET state=?", (state,)
    )
    monkeypatch.setattr(controller, "get_default_run_journal", lambda: journal)
    unsafe = Mock(side_effect=AssertionError("managed owner was touched"))
    monkeypatch.setattr(controller, "get_default_run_coordinator", unsafe)
    monkeypatch.setattr(controller, "get_task_lock_if_exists", unsafe)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            controller.retire_idle_runtime(
                "managed-project", SimpleNamespace(run_id="bound-run")
            )
        )
    assert caught.value.status_code == 409
    assert caught.value.detail["code"] == "managed_execution_required"
    unsafe.assert_not_called()
    assert (
        journal._connection.execute(
            "SELECT state FROM run_workspace_finalizations WHERE run_id='bound-run'"
        ).fetchone()[0]
        == state
    )


def test_resume_and_activation_signal_cannot_bypass_managed_service(
    journal, monkeypatch
):
    from app.controller import run_controller as controller

    journal.ensure_run(run_id="run-1", project_id="managed-project")
    _pending(journal)
    unsafe = Mock(side_effect=AssertionError("legacy resume was touched"))
    coordinator = SimpleNamespace(
        _run_journal=lambda: journal, resume=unsafe, cancel_durable=unsafe
    )
    monkeypatch.setattr(
        controller, "get_default_run_coordinator", lambda: coordinator
    )
    monkeypatch.setattr(controller, "get_default_run_journal", lambda: journal)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            controller.resume_run(
                "run-1", controller.ResumeRunBody(request_id="resume-1")
            )
        )
    assert caught.value.status_code == 409
    unsafe.assert_not_called()
    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            controller.cancel_run(
                "run-1", controller.CancelRunBody(request_id="cancel-1")
            )
        )
    assert caught.value.status_code == 409
    unsafe.assert_not_called()
    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            controller.signal_run(
                "run-1",
                controller.RunSignalBody(
                    signal_type="attempt.activated",
                    payload={"attempt_id": "unknown"},
                ),
            )
        )
    assert caught.value.status_code == 409
    assert (
        journal._connection.execute(
            "SELECT COUNT(*) FROM run_attempts"
        ).fetchone()[0]
        == 0
    )
