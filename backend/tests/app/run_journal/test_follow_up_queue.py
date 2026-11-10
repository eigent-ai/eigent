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

from unittest.mock import patch

import pytest

from app.run_journal import IdempotencyConflictError, SQLiteRunJournal

pytestmark = pytest.mark.unit


@pytest.fixture
def journal(tmp_path):
    value = SQLiteRunJournal(tmp_path / "journal.sqlite3")
    try:
        yield value
    finally:
        value.close()


def test_follow_up_queue_is_durable_ordered_and_idempotent(journal):
    first = journal.put_follow_up_request(
        request_id="follow-1",
        project_id="project-1",
        content="Continue with the report",
        attachment_paths=["/workspace/brief.pdf"],
        review_handoff_ids=["review-handoff-1"],
        now=1,
    )
    replay = journal.put_follow_up_request(
        request_id="follow-1",
        project_id="project-1",
        content="Continue with the report",
        attachment_paths=["/workspace/brief.pdf"],
        review_handoff_ids=["review-handoff-1"],
        now=2,
    )
    journal.put_follow_up_request(
        request_id="follow-2",
        project_id="project-1",
        content="Use the new numbers instead",
        now=3,
    )

    assert replay == first
    assert first.review_handoff_ids == ("review-handoff-1",)
    prioritized = journal.set_follow_up_delivery_mode(
        request_id="follow-2",
        project_id="project-1",
        delivery_mode="send_now",
        now=4,
    )
    assert prioritized.delivery_mode == "send_now"
    assert [
        item.request_id
        for item in journal.list_follow_up_requests(project_id="project-1")
    ] == ["follow-2", "follow-1"]

    journal.set_follow_up_delivery_mode(
        request_id="follow-1",
        project_id="project-1",
        delivery_mode="send_now",
        now=5,
    )
    reordered = journal.list_follow_up_requests(project_id="project-1")
    assert [item.request_id for item in reordered] == ["follow-1", "follow-2"]
    assert [item.delivery_mode for item in reordered] == ["send_now", "wait"]

    with pytest.raises(IdempotencyConflictError):
        journal.put_follow_up_request(
            request_id="follow-1",
            project_id="project-1",
            content="A different instruction",
        )
    with pytest.raises(IdempotencyConflictError):
        journal.put_follow_up_request(
            request_id="follow-1",
            project_id="project-1",
            content="Continue with the report",
            attachment_paths=["/workspace/brief.pdf"],
            review_handoff_ids=["another-handoff"],
        )


def test_follow_up_is_removed_from_pending_only_after_run_admission(journal):
    journal.put_follow_up_request(
        request_id="follow-1",
        project_id="project-1",
        content="Continue",
    )
    journal.ensure_run(
        run_id="follow-1", project_id="project-1", status="pending"
    )
    journal.create_run_attempt(
        "follow-1", request_id="admit-follow-1", reason="follow_up_execution"
    )

    admitted = journal.mark_follow_up_admitted(
        request_id="follow-1",
        project_id="project-1",
        run_id="follow-1",
    )

    assert admitted.status == "admitted"
    assert admitted.admitted_run_id == "follow-1"
    assert journal.list_follow_up_requests(project_id="project-1") == []
    assert (
        journal.mark_follow_up_admitted(
            request_id="follow-1",
            project_id="project-1",
            run_id="follow-1",
        )
        == admitted
    )


def test_semantic_rejection_closes_follow_up_and_preserves_reason(journal):
    journal.put_follow_up_request(
        request_id="follow-1",
        project_id="project-1",
        content="Continue",
    )

    rejected = journal.reject_follow_up_request(
        request_id="follow-1",
        project_id="project-1",
        error="continuation_clarification_required: say what to continue",
        now=2,
    )

    assert rejected.status == "cancelled"
    assert rejected.last_error == (
        "continuation_clarification_required: say what to continue"
    )
    assert journal.list_follow_up_requests(project_id="project-1") == []
    replay = journal.put_follow_up_request(
        request_id="follow-1",
        project_id="project-1",
        content="Continue",
    )
    assert replay == rejected


def test_follow_up_controller_round_trip_uses_local_routes(client, journal):
    with patch(
        "app.controller.chat_controller.get_default_run_journal",
        return_value=journal,
    ):
        created = client.post(
            "/projects/project-1/follow-ups",
            json={
                "request_id": "follow-1",
                "content": "Continue",
                "attachment_paths": [],
            },
        )
        assert created.status_code == 200
        assert created.json()["delivery_mode"] == "wait"

        listed = client.get("/projects/project-1/follow-ups")
        assert listed.status_code == 200
        assert [item["request_id"] for item in listed.json()["items"]] == [
            "follow-1"
        ]

        prioritized = client.post(
            "/projects/project-1/follow-ups/follow-1/send-now"
        )
        assert prioritized.status_code == 200
        assert prioritized.json()["delivery_mode"] == "send_now"

        journal.ensure_run(
            run_id="follow-1", project_id="project-1", status="pending"
        )
        journal.create_run_attempt(
            "follow-1",
            request_id="admit-follow-1",
            reason="follow_up_execution",
        )
        admitted = client.post(
            "/projects/project-1/follow-ups/follow-1/admitted",
            json={"run_id": "follow-1"},
        )
        assert admitted.status_code == 200
        assert admitted.json()["status"] == "admitted"
        assert client.get("/projects/project-1/follow-ups").json() == {
            "items": []
        }


def test_remote_follow_up_is_durable_and_globally_reconciled(client, journal):
    with patch(
        "app.controller.chat_controller.get_default_run_journal",
        return_value=journal,
    ):
        created = client.post(
            "/projects/project-remote/follow-ups",
            json={
                "request_id": "run-remote",
                "content": "Continue from my phone",
                "attachment_paths": [],
                "source": "remote_control",
                "source_command_id": "command-1",
            },
        )
        assert created.status_code == 200
        assert created.json()["source"] == "remote_control"
        recovered = client.get(
            "/follow-ups/pending", params={"source": "remote_control"}
        )
        assert recovered.status_code == 200
        assert recovered.json()["items"] == [created.json()]

        replay = client.post(
            "/projects/project-remote/follow-ups",
            json={
                "request_id": "run-remote",
                "content": "Continue from my phone",
                "attachment_paths": [],
                "source": "remote_control",
                "source_command_id": "command-1",
            },
        )
        assert replay.json() == created.json()
        by_command = client.get("/follow-ups/source-command/command-1")
        assert by_command.status_code == 200
        assert by_command.json() == created.json()

        journal.ensure_run(
            run_id="run-remote", project_id="project-remote", status="pending"
        )
        journal.create_run_attempt(
            "run-remote",
            request_id="admit-run-remote",
            reason="follow_up_execution",
        )
        admitted = client.post(
            "/projects/project-remote/follow-ups/run-remote/admitted",
            json={"run_id": "run-remote"},
        )
        assert admitted.status_code == 200
        assert admitted.json()["status"] == "admitted"
        assert (
            client.get("/follow-ups/source-command/command-1").json()["status"]
            == "admitted"
        )

        missing = client.get("/follow-ups/source-command/unknown")
        assert missing.status_code == 404


def test_remote_follow_up_requires_command_identity(journal):
    with pytest.raises(ValueError, match="source_command_id"):
        journal.put_follow_up_request(
            request_id="run-remote",
            project_id="project-1",
            content="Continue",
            source="remote_control",
        )
