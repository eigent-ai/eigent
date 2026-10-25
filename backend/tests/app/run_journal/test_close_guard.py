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


def test_pending_admission_claim_counts_as_work(tmp_path):
    from app.workspace_runtime.admission import AdmissionStore

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
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
        assert not journal.has_active_local_execution()
        assert store.claim("request", owner_id="worker") is not None
        assert journal.has_active_local_execution()
