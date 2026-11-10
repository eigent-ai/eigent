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

from app.run_journal import SQLiteRunJournal


def test_refused_run_replays_reason_and_releases_the_lane(tmp_path):
    journal = SQLiteRunJournal(tmp_path / "journal.db")
    journal.ensure_run(
        run_id="refused", project_id="session", status="pending"
    )
    assert journal.reject_unstarted_run(
        "refused",
        project_id="session",
        message="Unsupported thinking effort",
        question="reply with ok",
        request_id="initial-request",
        attachment_names=["notes.txt"],
        error_code="unsupported_thinking_effort",
    )
    restored = SQLiteRunJournal(tmp_path / "journal.db")
    assert restored.get_run("refused").status == "failed"
    prompt, notice, event = restored.list_events("refused")
    assert prompt.event_type == "user.message"
    assert prompt.event_id == "user-message:initial-request"
    assert prompt.payload["content"] == "reply with ok"
    assert prompt.payload["attachment_names"] == ["notes.txt"]
    assert notice.event_type == "legacy.error"
    assert notice.payload == {
        "message": "Unsupported thinking effort",
        "code": "unsupported_thinking_effort",
    }
    assert restored.list_run_attempts("refused") == []
    assert event.event_type == "run.failed" and event.legacy_step == "error"
    assert event.payload["message"] == "Unsupported thinking effort"
    restored.close()
    assert not journal.reject_unstarted_run(
        "refused", project_id="session", message="duplicate"
    )
    assert len(journal.list_events("refused")) == 3
    journal.ensure_run(run_id="next", project_id="session", status="pending")
    journal.create_run_attempt(
        "next", request_id="next", reason="initial_execution"
    )
    assert journal.get_active_project_run("session").run_id == "next"


def test_rejection_cannot_close_an_admitted_or_foreign_run(tmp_path):
    journal = SQLiteRunJournal(tmp_path / "journal.db")
    journal.ensure_run(run_id="run", project_id="session", status="pending")
    assert not journal.reject_unstarted_run(
        "run", project_id="other", message="bad"
    )
    assert journal.list_events("run") == []
    journal.create_run_attempt(
        "run", request_id="run", reason="initial_execution"
    )
    admitted_events = journal.list_events("run")
    assert not journal.reject_unstarted_run(
        "run", project_id="session", message="bad"
    )
    assert journal.get_run("run").status == "pending"
    assert journal.list_events("run") == admitted_events


def test_refusing_a_queued_follow_up_closes_its_queue_row(tmp_path):
    journal = SQLiteRunJournal(tmp_path / "journal.db")
    journal.put_follow_up_request(
        request_id="queued", project_id="session", content="follow-up"
    )
    journal.ensure_run(run_id="queued", project_id="session", status="pending")
    assert journal.reject_unstarted_run(
        "queued", project_id="session", message="Unsupported thinking effort"
    )
    assert journal.get_run("queued").status == "failed"
    assert journal.list_follow_up_requests(project_id="session") == []
    (request,) = journal.list_follow_up_requests(
        project_id="session", statuses=("cancelled",)
    )
    assert request.status == "cancelled"
    assert request.last_error == "Unsupported thinking effort"
