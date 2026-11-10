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

import json
from typing import Any

import httpx
import pytest

from app.run_journal import InvalidRunTransitionError, SQLiteRunJournal
from app.run_sync.cloud_sync import (
    CloudSyncConfiguration,
    RunEventSyncHttpError,
)
from app.run_sync.command_sync import (
    CommandControlWorker,
    HttpCommandSyncTransport,
)


class FakeCommandTransport:
    def __init__(self) -> None:
        self.pending: list[dict[str, Any]] = []
        self.confirmed: list[str] = []
        self.ingested: list[Any] = []
        self.pull_error: Exception | None = None
        self.pull_count = 0

    async def pull_pending(self, _configuration, *, limit):
        self.pull_count += 1
        if self.pull_error is not None:
            raise self.pull_error
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
        "lease_token": "delivery-lease-1",
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
        assert confirmed.delivery_lease_token == "delivery-lease-1"
        assert transport.confirmed == ["command-1"]

        assert await worker.drain_once() == 1
        assert len(transport.ingested) == 1
        assert transport.ingested[0].events[0].event_type == (
            "receipt.durably_received"
        )
        assert transport.ingested[0].delivery_lease_token == (
            "delivery-lease-1"
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


@pytest.mark.asyncio
async def test_terminal_command_receipt_replay_never_executes_again(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        transport = FakeCommandTransport()
        worker = CommandControlWorker(journal, transport)
        worker.configure(_configuration())
        record = await worker.persist_command(_command())
        await worker.confirm_receipt(record.command_id)
        journal.append_command_result(
            record.command_id,
            event_type="admission.accepted",
            event_id="accepted",
        )
        journal.append_command_result(
            record.command_id,
            event_type="execution.completed",
            event_id="completed",
            payload={"result": {"ok": True}},
        )

        replayed, may_execute = await worker.confirm_receipt(record.command_id)

        assert replayed.state == "completed"
        assert may_execute is False
        assert transport.confirmed == [record.command_id]
        await worker.close()


@pytest.mark.asyncio
async def test_inbound_pull_failure_does_not_starve_outbound_results(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        transport = FakeCommandTransport()
        worker = CommandControlWorker(journal, transport)
        worker.configure(_configuration())
        await worker.persist_command(_command())
        transport.pull_error = ValueError("malformed pending command")

        assert await worker.drain_once() == 1
        assert len(transport.ingested) == 1
        assert journal.claim_command_result_batches() == []
        await worker.close()


@pytest.mark.asyncio
async def test_device_owner_mismatch_backs_off_inbound_without_hot_loop(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        transport = FakeCommandTransport()
        transport.pull_error = RunEventSyncHttpError(
            409,
            {
                "detail": {
                    "code": "device_owner_mismatch",
                    "message": "Desktop device belongs to another user",
                }
            },
        )
        worker = CommandControlWorker(
            journal,
            transport,
            poll_interval_seconds=0.01,
            max_retry_seconds=300,
        )
        worker.configure(_configuration())

        assert await worker.drain_once() == 0
        assert await worker.drain_once() == 0
        assert transport.pull_count == 1
        assert worker._next_inbound_attempt_at > 0
        await worker.close()


@pytest.mark.asyncio
async def test_device_registration_error_retries_command_lane(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/devices/register")
        return httpx.Response(409, json={"detail": "device route conflict"})

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        transport = HttpCommandSyncTransport(
            transport=httpx.MockTransport(handler)
        )
        worker = CommandControlWorker(journal, transport)
        worker.configure(_configuration())
        await worker.persist_command(_command())

        assert await worker.drain_once() == 0
        batch = journal.claim_command_result_batches(now=float("inf"))[0]
        assert batch.attempt_count == 1
        await worker.close()


@pytest.mark.asyncio
async def test_transport_reregisters_when_authenticated_credential_changes():
    registrations: list[str] = []
    capabilities: list[dict[str, int]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/devices/register"):
            registrations.append(request.headers["authorization"])
            capabilities.append(json.loads(request.content)["capabilities"])
            return httpx.Response(200, json={})
        assert request.url.path.endswith("/commands/pending")
        return httpx.Response(200, json={"items": []})

    transport = HttpCommandSyncTransport(
        transport=httpx.MockTransport(handler)
    )
    first = _configuration()
    second = CloudSyncConfiguration(
        endpoint_url=first.endpoint_url,
        authorization="Bearer another-account-token",
        desktop_instance_id=first.desktop_instance_id,
    )

    assert await transport.pull_pending(first, limit=1) == []
    assert await transport.pull_pending(first, limit=1) == []
    assert await transport.pull_pending(second, limit=1) == []

    assert registrations == ["Bearer token", "Bearer another-account-token"]
    assert capabilities == [
        {
            "durable_command_control": 1,
            "command_inbox": 1,
            "command_result_sync": 1,
        },
        {
            "durable_command_control": 1,
            "command_inbox": 1,
            "command_result_sync": 1,
        },
    ]
    await transport.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [11, 12, 13, 14])
async def test_transport_rejects_http_200_auth_error_envelope(code):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/devices/register"):
            return httpx.Response(200, json={})
        assert request.url.path.endswith("/commands/pending")
        return httpx.Response(
            200,
            json={"code": code, "text": "Authentication rejected"},
        )

    transport = HttpCommandSyncTransport(
        transport=httpx.MockTransport(handler)
    )

    with pytest.raises(RunEventSyncHttpError) as exc_info:
        await transport.pull_pending(_configuration(), limit=1)

    assert exc_info.value.status_code == 200
    assert exc_info.value.application_code == str(code)
    assert f"application error {code}" in str(exc_info.value)
    await transport.close()


@pytest.mark.asyncio
async def test_worker_pauses_all_command_lanes_until_credentials_change(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        transport = FakeCommandTransport()
        transport.pull_error = RunEventSyncHttpError(
            200,
            {"code": 13, "text": "Could not validate credentials"},
        )
        worker = CommandControlWorker(journal, transport)
        expired = _configuration()
        refreshed = CloudSyncConfiguration(
            endpoint_url=expired.endpoint_url,
            authorization="Bearer refreshed",
            desktop_instance_id=expired.desktop_instance_id,
        )
        worker.configure(expired)

        assert await worker.drain_once() == 0
        await worker.persist_command(_command())
        assert await worker.drain_once() == 0
        assert transport.pull_count == 1
        assert transport.ingested == []

        transport.pull_error = None
        worker.configure(refreshed)
        assert await worker.drain_once() == 1
        assert transport.pull_count == 2
        assert len(transport.ingested) == 1
        await worker.close()


@pytest.mark.asyncio
async def test_worker_slowly_reprobes_same_credentials_after_auth_failure(
    tmp_path,
):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        transport = FakeCommandTransport()
        transport.pull_error = RunEventSyncHttpError(
            200,
            {"code": 11, "text": "Token required"},
        )
        worker = CommandControlWorker(journal, transport)
        worker.configure(_configuration())

        assert await worker.drain_once() == 0
        assert await worker.drain_once() == 0
        assert transport.pull_count == 1

        transport.pull_error = None
        worker._auth_retry_at = 0.0
        assert await worker.drain_once() == 0
        assert transport.pull_count == 2
        assert worker._auth_paused_configuration is None
        await worker.close()


def test_command_inbox_terminal_state_cannot_move_backwards(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        record = journal.persist_remote_command(
            command_id="command-1",
            session_id="session-1",
            user_id=7,
            project_id="project-1",
            run_id=None,
            route_version=1,
            command_type="user_message",
            payload={"content": "hello"},
            expires_at=100,
            receipt_grace_until=110,
            requires_online_receipt_confirmation=False,
            now=1,
        )
        journal.append_command_result(
            record.command_id,
            event_type="admission.accepted",
            event_id="accepted",
            occurred_at=2,
        )
        journal.append_command_result(
            record.command_id,
            event_type="execution.completed",
            event_id="completed",
            occurred_at=3,
        )

        with pytest.raises(InvalidRunTransitionError, match="completed"):
            journal.append_command_result(
                record.command_id,
                event_type="admission.rejected",
                event_id="late-rejected",
                occurred_at=4,
            )

        assert (
            journal.get_remote_command(record.command_id).state == "completed"
        )
