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

from types import SimpleNamespace

import pytest

from app.controller import run_controller
from app.run_journal import SQLiteRunJournal


@pytest.mark.asyncio
async def test_global_close_guard_excludes_bare_pending_and_includes_other_project(
    tmp_path, monkeypatch
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        monkeypatch.setattr(
            run_controller, "get_default_run_journal", lambda: journal
        )
        journal.ensure_run(
            run_id="bare", project_id="current-space-session", status="pending"
        )
        assert await run_controller.active_local_execution() == {
            "active": False
        }
        journal.ensure_run(
            run_id="other",
            project_id="unloaded-other-space-session",
            status="pending",
        )
        journal.create_run_attempt(
            "other",
            request_id="initial",
            reason="initial_execution",
            activate=False,
        )
        assert await run_controller.active_local_execution() == {
            "active": True
        }


def _submit_start_request(journal):
    from app.workspace_runtime.admission import AdmissionStore

    store = AdmissionStore(journal)
    store.submit(
        request_id="request",
        project_id="session",
        kind="start",
        envelope={
            "space_id": "space",
            "project_id": "session",
            "prompt": "hello",
            "model_platform": "openai",
            "model_type": "test",
            "session_mode": "single-agent",
            "workspace_policy_version": "isolated-v1",
            "configuration_revision": "config:1",
            "credential_ref": "credential:1",
            "permission_profile_revision": "permissions:1",
            "principal_ref": "principal:1",
            "attachment_ids": [],
            "model_parameters": {},
        },
    )
    return store


def test_pending_admission_claim_counts_as_work(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        store = _submit_start_request(journal)
        assert not journal.has_active_local_execution(
            admission_owner_id="worker"
        )
        assert store.claim("request", owner_id="worker") is not None
        assert journal.has_active_local_execution(admission_owner_id="worker")
        assert not journal.has_active_local_execution(
            admission_owner_id="other"
        )
        assert not journal.has_active_local_execution()


@pytest.mark.asyncio
async def test_claim_left_by_a_killed_process_does_not_block_quit(
    tmp_path, monkeypatch
):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        store = _submit_start_request(journal)
        store.claim("request", owner_id="execution-old-process")

    # The next process cannot prove the old one stopped, so the claim stays.
    with SQLiteRunJournal(path) as journal:
        journal.reconcile_startup()
        monkeypatch.setattr(
            run_controller, "get_default_run_journal", lambda: journal
        )
        monkeypatch.setattr(
            run_controller,
            "get_default_execution_service",
            lambda: SimpleNamespace(owner_id="execution-new-process"),
        )
        assert await run_controller.active_local_execution() == {
            "active": False
        }
        monkeypatch.setattr(
            run_controller, "get_default_execution_service", lambda: None
        )
        assert await run_controller.active_local_execution() == {
            "active": False
        }
        monkeypatch.setattr(
            run_controller,
            "get_default_execution_service",
            lambda: SimpleNamespace(owner_id="execution-old-process"),
        )
        assert await run_controller.active_local_execution() == {
            "active": True
        }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status",
    [
        # Running, with or without a tool call: the first model call has none.
        "running",
        # Waiting at an approval card or for an answer to an Agent question.
        "waiting_for_user",
    ],
)
async def test_unfinished_run_asks_before_quit(tmp_path, monkeypatch, status):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        monkeypatch.setattr(
            run_controller, "get_default_run_journal", lambda: journal
        )
        journal.ensure_run(run_id="run", project_id="session", status=status)
        assert await run_controller.active_local_execution() == {
            "active": True
        }


@pytest.mark.asyncio
async def test_run_being_admitted_asks_before_quit(tmp_path, monkeypatch):
    from app.run_runtime.coordinator import RunCoordinator

    coordinator = RunCoordinator()
    monkeypatch.setattr(
        run_controller, "get_default_run_coordinator", lambda: coordinator
    )
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        monkeypatch.setattr(
            run_controller, "get_default_run_journal", lambda: journal
        )
        async with coordinator.admission_scope("run", project_id="session"):
            # Admission writes the Run before its first Attempt exists.
            journal.ensure_run(
                run_id="run", project_id="session", status="pending"
            )
            assert await run_controller.active_local_execution() == {
                "active": True
            }
        # A refused admission can leave that row; nothing is starting it.
        assert await run_controller.active_local_execution() == {
            "active": False
        }


@pytest.mark.asyncio
async def test_finished_runs_quit_without_asking(tmp_path, monkeypatch):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        monkeypatch.setattr(
            run_controller, "get_default_run_journal", lambda: journal
        )
        journal.ensure_run(run_id="run", project_id="session")
        journal.reconcile_startup()
        assert journal.get_run("run").status == "interrupted"
        assert await run_controller.active_local_execution() == {
            "active": False
        }
