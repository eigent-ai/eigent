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

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import require_local_control_principal
from app.controller import run_controller
from app.router import register_routers
from app.run_journal import SQLiteRunJournal


def _running(journal: SQLiteRunJournal, run_id: str, project_id: str):
    journal.ensure_run(run_id=run_id, project_id=project_id, now=1)
    return journal.create_run_attempt(
        run_id,
        request_id=f"{run_id}-initial",
        reason="initial_execution",
        activate=True,
        now=2,
    )


def _client(journal: SQLiteRunJournal, monkeypatch) -> TestClient:
    monkeypatch.setattr(
        run_controller, "get_default_run_journal", lambda: journal
    )
    app = FastAPI()
    register_routers(app)
    app.dependency_overrides[require_local_control_principal] = lambda: None
    return TestClient(app)


def test_attention_reports_running_and_waiting_sessions(tmp_path, monkeypatch):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _running(journal, "run-active", "session-running")

        approval_attempt = _running(
            journal, "run-approval", "session-approval"
        )
        journal.create_approval(
            approval_id="approval-1",
            run_id="run-approval",
            attempt_id=approval_attempt.attempt_id,
            prompt={"title": "Allow delete?"},
            action_digest="a" * 64,
            policy_revision="policy-1",
            safety_class="unsafe_write",
            now=3,
        )

        question_attempt = _running(
            journal, "run-question", "session-question"
        )
        journal.create_human_interaction(
            interaction_id="question-1",
            run_id="run-question",
            attempt_id=question_attempt.attempt_id,
            interaction_type="question",
            request={"question": "Which file?", "agent": "worker"},
            response_schema={"type": "string"},
            requested_by="agent:worker",
            now=3,
        )

        journal.ensure_run(
            run_id="run-done", project_id="session-done", status="completed"
        )
        # Admission wrote the row, but nothing is executing it yet.
        journal.ensure_run(
            run_id="run-bare", project_id="session-bare", status="pending"
        )

        with _client(journal, monkeypatch) as client:
            response = client.get("/runs/attention")

        assert response.status_code == 200
        assert response.json() == [
            {"project_id": "session-approval", "state": "waiting"},
            {"project_id": "session-question", "state": "waiting"},
            {"project_id": "session-running", "state": "running"},
        ]


def test_waiting_outranks_running_within_one_session(tmp_path, monkeypatch):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _running(journal, "run-a", "session")
        # A system wait (for example a merge conflict) keeps its Run waiting.
        journal.ensure_run(
            run_id="run-b", project_id="session", status="waiting_for_user"
        )

        with _client(journal, monkeypatch) as client:
            assert client.get("/runs/attention").json() == [
                {"project_id": "session", "state": "waiting"}
            ]


def test_answered_question_returns_the_session_to_running(
    tmp_path, monkeypatch
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        attempt = _running(journal, "run", "session")
        journal.create_human_interaction(
            interaction_id="question-1",
            run_id="run",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"question": "Continue?", "agent": "worker"},
            response_schema={"type": "string"},
            requested_by="agent:worker",
            now=3,
        )

        with _client(journal, monkeypatch) as client:
            assert client.get("/runs/attention").json() == [
                {"project_id": "session", "state": "waiting"}
            ]

            journal.resolve_human_interaction(
                "question-1",
                decision_request_id="decision-1",
                decision={"reply": "yes", "agent": "worker"},
                expected_version=0,
                expected_run_id="run",
                continue_active_attempt=True,
                now=4,
            )
            assert client.get("/runs/attention").json() == [
                {"project_id": "session", "state": "running"}
            ]


def test_attention_is_empty_after_restart_interrupts_runs(
    tmp_path, monkeypatch
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _running(journal, "run", "session")
        journal.reconcile_startup()
        assert journal.get_run("run").status == "interrupted"

        with _client(journal, monkeypatch) as client:
            assert client.get("/runs/attention").json() == []
