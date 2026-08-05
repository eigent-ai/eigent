from __future__ import annotations

from typing import Any

import pytest

from app.run_journal import SQLiteRunJournal
from app.run_sync.cloud_sync import CloudSyncConfiguration
from app.run_sync.command_sync import CommandControlWorker


class FakeCommandTransport:
    def __init__(self) -> None:
        self.pending: list[dict[str, Any]] = []
        self.confirmed: list[str] = []
        self.ingested: list[Any] = []

    async def pull_pending(self, _configuration, *, limit):
        return self.pending[:limit]

    async def confirm_receipt(self, _configuration, command):
        self.confirmed.append(command.command_id)
        return {
            "result": "confirmed",
            "receipt_state": "durably_received",
            "may_execute": True,
        }

    async def ingest_events(self, _configuration, batch):
        self.ingested.append(batch)
        return {"expected_next_desktop_event_sequence": len(batch.events) + 1}

    async def close(self):
        return None


def _configuration() -> CloudSyncConfiguration:
    return CloudSyncConfiguration(
        endpoint_url="https://example.test/api/v1/sync/events:ingest",
        authorization="Bearer token",
        desktop_instance_id="device-1",
    )


def _command() -> dict[str, Any]:
    return {
        "id": "command-1",
        "session_id": "session-1",
        "user_id": 7,
        "project_id": "project-1",
        "route_version": 1,
        "type": "user_message",
        "payload": {"content": "hello"},
        "expires_at": "2030-01-01T00:00:00+00:00",
        "receipt_grace_until": "2030-01-01T00:00:30+00:00",
        "requires_online_receipt_confirmation": False,
    }


@pytest.mark.asyncio
async def test_worker_confirms_receipt_and_drains_independent_lane(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        transport = FakeCommandTransport()
        worker = CommandControlWorker(journal, transport)
        worker.configure(_configuration())
        record = await worker.persist_command(_command())

        confirmed, may_execute = await worker.confirm_receipt(
            record.command_id
        )
        assert may_execute is True
        assert confirmed.receipt_status == "confirmed"
        assert transport.confirmed == ["command-1"]

        assert await worker.drain_once() == 1
        assert len(transport.ingested) == 1
        assert transport.ingested[0].events[0].event_type == (
            "receipt.durably_received"
        )
        assert journal.claim_command_result_batches() == []
        await worker.close()


@pytest.mark.asyncio
async def test_high_risk_command_does_not_execute_without_cloud_config(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        transport = FakeCommandTransport()
        worker = CommandControlWorker(journal, transport)
        command = _command()
        command["requires_online_receipt_confirmation"] = True
        record = await worker.persist_command(command)

        _record, may_execute = await worker.confirm_receipt(record.command_id)
        assert may_execute is False
        await worker.close()
