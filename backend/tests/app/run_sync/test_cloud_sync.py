from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest

from app.run_journal import RunEventDraft, SQLiteRunJournal
from app.run_sync import (
    CloudSyncConfiguration,
    CloudSyncWorker,
    HttpRunEventSyncTransport,
    RunEventSyncHttpError,
)


class FakeTransport:
    def __init__(self) -> None:
        self.payloads: list[dict[str, Any]] = []
        self.error: Exception | None = None
        self.closed = False
        self.active = 0
        self.max_active = 0
        self.wait_for_parallel = False
        self.projects: list[dict[str, Any]] = []
        self.snapshots: dict[str, dict[str, Any]] = {}
        self.project_events: dict[str, list[dict[str, Any]]] = {}

    async def ingest(self, configuration, payload):
        self.payloads.append(payload)
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if self.wait_for_parallel:
                for _ in range(100):
                    if self.active >= 2:
                        break
                    await asyncio.sleep(0)
            if self.error is not None:
                raise self.error
            return {
                "project_id": payload["project_id"],
                "run_id": payload["run_id"],
                "expected_next_run_sequence": payload["events"][-1][
                    "run_sequence"
                ]
                + 1,
                "items": [
                    {
                        "event_id": event["event_id"],
                        "run_sequence": event["run_sequence"],
                        "run_version": event["run_version"],
                        "cloud_cursor": index + 1,
                        "inserted": True,
                    }
                    for index, event in enumerate(payload["events"])
                ],
            }
        finally:
            self.active -= 1

    async def list_projects(self, configuration):
        return {"items": self.projects}

    async def project_snapshot(self, configuration, project_id):
        return self.snapshots[project_id]

    async def list_project_events(
        self, configuration, project_id, *, after_cursor, limit
    ):
        items = [
            event
            for event in self.project_events.get(project_id, [])
            if event["cloud_cursor"] > after_cursor
        ][:limit]
        all_events = self.project_events.get(project_id, [])
        current_cursor = all_events[-1]["cloud_cursor"] if all_events else 0
        return {
            "project_id": project_id,
            "current_cursor": current_cursor,
            "next_cursor": (
                items[-1]["cloud_cursor"] if items else after_cursor
            ),
            "has_more": bool(items and items[-1]["cloud_cursor"] < current_cursor),
            "items": items,
        }

    async def close(self):
        self.closed = True


@pytest.fixture()
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def _append(journal: SQLiteRunJournal, run_id: str, count: int = 1) -> None:
    journal.ensure_run(run_id=run_id, project_id="project-1", now=1)
    for sequence in range(1, count + 1):
        journal.append_event(
            run_id,
            RunEventDraft(
                event_id=f"{run_id}-event-{sequence}",
                event_type="message.created",
                payload={"sequence": sequence},
                legacy_step="activate_agent",
                created_at=float(sequence),
            ),
        )


def _worker(journal, transport, **kwargs) -> CloudSyncWorker:
    worker = CloudSyncWorker(journal, transport, **kwargs)
    worker.configure(
        CloudSyncConfiguration(
            endpoint_url="https://example.test/api/v1/sync/events:ingest",
            authorization="Bearer secret",
            desktop_instance_id="desk-1",
        )
    )
    return worker


@pytest.mark.asyncio
async def test_worker_sends_fifo_batch_and_marks_it_sent(journal):
    _append(journal, "run-1", count=3)
    transport = FakeTransport()
    worker = _worker(journal, transport, batch_size=3)

    assert await worker.drain_once() == 3

    payload = transport.payloads[0]
    assert [event["run_sequence"] for event in payload["events"]] == [1, 2, 3]
    assert [event["run_version"] for event in payload["events"]] == [1, 2, 3]
    assert payload["events"][0]["created_at"] == "1970-01-01T00:00:01+00:00"
    assert journal.list_pending_outbox(now=100) == []
    await worker.close()
    assert transport.closed is True


@pytest.mark.asyncio
async def test_worker_bootstraps_missing_history_without_upload_echo(journal):
    transport = FakeTransport()
    transport.projects = [
        {
            "project_id": "project-cloud",
            "current_cursor": 1,
            "updated_at": "2026-08-06T00:00:02+00:00",
        }
    ]
    transport.snapshots["project-cloud"] = {
        "project_id": "project-cloud",
        "current_cursor": 1,
        "runs": [
            {
                "run_id": "run-cloud",
                "status": "completed",
                "expected_next_run_sequence": 2,
                "updated_at": "2026-08-06T00:00:02+00:00",
            }
        ],
        "recent_events": [],
        "events_truncated": False,
    }
    transport.project_events["project-cloud"] = [
        {
            "event_id": "cloud-event-1",
            "project_id": "project-cloud",
            "run_id": "run-cloud",
            "run_sequence": 1,
            "run_version": 1,
            "cloud_cursor": 1,
            "event_type": "run.completed",
            "payload": {"message": "done"},
            "legacy_step": "end",
            "created_at": "2026-08-06T00:00:01+00:00",
            "ingested_at": "2026-08-06T00:00:02+00:00",
        }
    ]
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 0
    restored = journal.get_run("run-cloud")
    assert restored is not None
    assert restored.status == "completed"
    assert restored.origin == "cloud_restore"
    assert journal.get_cloud_project_cursor("project-cloud") == 1
    assert journal.list_pending_outbox(now=float("inf")) == []
    await worker.close()


@pytest.mark.asyncio
async def test_worker_sends_different_runs_in_parallel(journal):
    _append(journal, "run-1")
    _append(journal, "run-2")
    transport = FakeTransport()
    transport.wait_for_parallel = True
    worker = _worker(journal, transport, max_parallel_runs=2)

    assert await worker.drain_once() == 2
    assert transport.max_active == 2
    await worker.close()


@pytest.mark.asyncio
async def test_network_failure_retries_without_poisoning_event(journal):
    _append(journal, "run-1")
    transport = FakeTransport()
    transport.error = RuntimeError("offline")
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 0
    pending = journal.list_pending_outbox(now=float("inf"))
    assert pending[0].status == "pending"
    assert pending[0].attempt_count == 1
    assert pending[0].last_error == "RuntimeError: offline"
    await worker.close()


@pytest.mark.asyncio
async def test_permanent_error_blocks_poison_event_but_not_prior_prefix(
    journal,
):
    _append(journal, "run-1", count=3)
    transport = FakeTransport()
    transport.error = RunEventSyncHttpError(
        409,
        {"detail": {"first_failed_event_id": "run-1-event-2"}},
    )
    worker = _worker(journal, transport, batch_size=3)

    assert await worker.drain_once() == 0
    transport.error = None
    assert await worker.drain_once() == 1
    assert journal.claim_ready_outbox_batches(now=float("inf")) == []

    with journal._lock:
        rows = journal._connection.execute(
            """
            SELECT event_id, status FROM run_event_sync_outbox
            ORDER BY run_sequence
            """
        ).fetchall()
    assert [(row["event_id"], row["status"]) for row in rows] == [
        ("run-1-event-1", "sent"),
        ("run-1-event-2", "dead_letter"),
        ("run-1-event-3", "pending"),
    ]
    await worker.close()


@pytest.mark.asyncio
async def test_pydantic_422_location_blocks_the_actual_batch_item(journal):
    _append(journal, "run-1", count=3)
    transport = FakeTransport()
    transport.error = RunEventSyncHttpError(
        422,
        {
            "detail": [
                {
                    "type": "string_too_long",
                    "loc": ["body", "events", 1, "event_type"],
                    "msg": "too long",
                }
            ]
        },
    )
    worker = _worker(journal, transport, batch_size=3)

    assert await worker.drain_once() == 0
    with journal._lock:
        rows = journal._connection.execute(
            """
            SELECT event_id, status FROM run_event_sync_outbox
            ORDER BY run_sequence
            """
        ).fetchall()
    assert [(row["event_id"], row["status"]) for row in rows] == [
        ("run-1-event-1", "pending"),
        ("run-1-event-2", "dead_letter"),
        ("run-1-event-3", "pending"),
    ]
    await worker.close()


@pytest.mark.asyncio
async def test_invalid_success_response_is_retried(journal):
    _append(journal, "run-1")

    class InvalidTransport(FakeTransport):
        async def ingest(self, configuration, payload):
            return {
                "project_id": "wrong",
                "run_id": payload["run_id"],
                "items": [],
            }

    worker = _worker(journal, InvalidTransport())
    assert await worker.drain_once() == 0
    pending = journal.list_pending_outbox(now=float("inf"))
    assert pending[0].attempt_count == 1
    assert "scope does not match" in pending[0].last_error
    await worker.close()


@pytest.mark.asyncio
async def test_device_registration_conflict_retries_without_poisoning_event(
    journal,
):
    _append(journal, "run-1")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/devices/register")
        return httpx.Response(409, json={"detail": "route temporarily owned"})

    transport = HttpRunEventSyncTransport(
        transport=httpx.MockTransport(handler)
    )
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 0
    pending = journal.list_pending_outbox(now=float("inf"))
    assert pending[0].status == "pending"
    assert pending[0].attempt_count == 1
    assert "route temporarily owned" in (pending[0].last_error or "")
    await worker.close()


@pytest.mark.asyncio
async def test_http_transport_uses_device_auth_for_history_bootstrap():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["Authorization"] == "Bearer secret"
        assert request.headers["X-Desktop-Instance-ID"] == "desk-1"
        if request.url.path.endswith("/devices/register"):
            return httpx.Response(
                200,
                json={
                    "device_id": "desk-1",
                    "credential_version": 1,
                    "registered_at": "2026-08-06T00:00:00+00:00",
                },
            )
        if request.url.path.endswith("/sync/projects"):
            return httpx.Response(200, json={"items": []})
        if request.url.path.endswith("/snapshot"):
            return httpx.Response(
                200,
                json={
                    "project_id": "project/one",
                    "current_cursor": 0,
                    "runs": [],
                    "recent_events": [],
                    "events_truncated": False,
                },
            )
        return httpx.Response(
            200,
            json={
                "project_id": "project/one",
                "current_cursor": 0,
                "next_cursor": 0,
                "has_more": False,
                "items": [],
            },
        )

    transport = HttpRunEventSyncTransport(
        transport=httpx.MockTransport(handler)
    )
    configuration = CloudSyncConfiguration(
        endpoint_url="https://example.test/api/v1/sync/events:ingest",
        authorization="Bearer secret",
        desktop_instance_id="desk-1",
    )

    assert await transport.list_projects(configuration) == {"items": []}
    await transport.project_snapshot(configuration, "project/one")
    await transport.list_project_events(
        configuration,
        "project/one",
        after_cursor=0,
        limit=100,
    )

    assert len(
        [request for request in requests if request.url.path.endswith("/devices/register")]
    ) == 1
    assert any("/projects/project%2Fone/snapshot" in str(request.url) for request in requests)
    assert any("event_limit=1" in str(request.url) for request in requests)
    await transport.close()
