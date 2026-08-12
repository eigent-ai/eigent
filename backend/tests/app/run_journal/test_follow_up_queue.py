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
        now=1,
    )
    replay = journal.put_follow_up_request(
        request_id="follow-1",
        project_id="project-1",
        content="Continue with the report",
        attachment_paths=["/workspace/brief.pdf"],
        now=2,
    )
    journal.put_follow_up_request(
        request_id="follow-2",
        project_id="project-1",
        content="Use the new numbers instead",
        now=3,
    )

    assert replay == first
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


def test_follow_up_is_removed_from_pending_only_after_run_admission(journal):
    journal.put_follow_up_request(
        request_id="follow-1",
        project_id="project-1",
        content="Continue",
    )
    journal.ensure_run(run_id="follow-1", project_id="project-1")

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

        journal.ensure_run(run_id="follow-1", project_id="project-1")
        admitted = client.post(
            "/projects/project-1/follow-ups/follow-1/admitted",
            json={"run_id": "follow-1"},
        )
        assert admitted.status_code == 200
        assert admitted.json()["status"] == "admitted"
        assert client.get("/projects/project-1/follow-ups").json() == {
            "items": []
        }
