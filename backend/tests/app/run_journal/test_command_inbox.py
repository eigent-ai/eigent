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

import pytest

from app.run_journal import (
    CommandResultSyncBatch,
    IdempotencyConflictError,
    OutboxLeaseLostError,
    SQLiteRunJournal,
)


def _persist(journal: SQLiteRunJournal, command_id: str = "command-1"):
    return journal.persist_remote_command(
        command_id=command_id,
        session_id="session-1",
        user_id=7,
        project_id="project-1",
        run_id=None,
        route_version=1,
        command_type="user_message",
        payload={"id": command_id, "type": "user_message", "payload": {}},
        expires_at=200.0,
        receipt_grace_until=230.0,
        requires_online_receipt_confirmation=False,
        delivery_lease_token="delivery-lease-1",
        receipt_event_id=f"{command_id}:receipt",
        now=100.0,
    )


def test_inbox_commit_also_persists_receipt_outbox(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        command = _persist(journal)
        assert command.state == "received"
        assert command.receipt_status == "pending"
        batches = journal.claim_command_result_batches(now=100.0)
        assert len(batches) == 1
        assert batches[0].command_id == "command-1"
        assert batches[0].delivery_lease_token == "delivery-lease-1"
        assert [event.event_type for event in batches[0].events] == [
            "receipt.durably_received"
        ]
        assert batches[0].events[0].command_event_sequence == 1


def test_startup_reconciliation_includes_accepted_commands(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        _persist(journal)
        journal.append_command_result(
            "command-1",
            event_type="admission.accepted",
            event_id="command-1:admission",
            occurred_at=101.0,
        )

    with SQLiteRunJournal(path) as reopened:
        reconciliation = reopened.reconcile_startup(now=102.0)
        assert reconciliation.reconcilable_command_ids == ("command-1",)
        assert [
            command.command_id
            for command in reopened.list_reconcilable_commands()
        ] == ["command-1"]


def test_empty_command_result_batch_is_rejected_before_sql(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        batch = CommandResultSyncBatch(
            command_id="command-1",
            delivery_lease_token="delivery-lease-1",
            lease_token="lease-1",
            attempt_count=0,
            events=(),
        )

        with pytest.raises(ValueError, match="must contain events"):
            journal.mark_command_result_batch_sent(batch)


def test_duplicate_command_requires_identical_canonical_envelope(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        first = _persist(journal)
        duplicate = _persist(journal)
        assert duplicate.receipt_event_id == first.receipt_event_id
        with pytest.raises(IdempotencyConflictError):
            journal.persist_remote_command(
                command_id="command-1",
                session_id="session-1",
                user_id=7,
                project_id="project-1",
                run_id=None,
                route_version=1,
                command_type="user_message",
                payload={"changed": True},
                expires_at=200.0,
                receipt_grace_until=230.0,
                requires_online_receipt_confirmation=False,
                now=100.0,
            )


def test_startup_reconciliation_rescans_received_and_dispatched(tmp_path):
    path = tmp_path / "journal.sqlite3"
    with SQLiteRunJournal(path) as journal:
        _persist(journal)
        journal.mark_command_dispatched("command-1", now=101.0)

    with SQLiteRunJournal(path) as reopened:
        pending = reopened.list_reconcilable_commands()
        assert [record.command_id for record in pending] == ["command-1"]
        assert pending[0].state == "dispatched"
        assert pending[0].dispatch_attempt_count == 1


def test_admission_and_execution_share_command_fifo_not_run_fifo(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _persist(journal)
        accepted = journal.append_command_result(
            "command-1",
            event_type="admission.accepted",
            event_id="command-1:admission",
            occurred_at=101.0,
        )
        assert [
            command.command_id
            for command in journal.list_reconcilable_commands()
        ] == ["command-1"]
        completed = journal.append_command_result(
            "command-1",
            event_type="execution.completed",
            event_id="command-1:result",
            payload={"result": {"ok": True}},
            occurred_at=102.0,
        )
        assert accepted.command_event_sequence == 2
        assert completed.command_event_sequence == 3
        assert journal.get_remote_command("command-1").state == "completed"

        batch = journal.claim_command_result_batches(now=102.0)[0]
        assert [event.command_event_sequence for event in batch.events] == [
            1,
            2,
            3,
        ]
        journal.mark_command_result_batch_sent(batch, now=103.0)
        assert journal.claim_command_result_batches(now=104.0) == []


def test_poison_event_blocks_only_its_command_lane(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _persist(journal, "command-1")
        _persist(journal, "command-2")
        batches = journal.claim_command_result_batches(
            now=100.0, max_commands=2
        )
        first = next(
            batch for batch in batches if batch.command_id == "command-1"
        )
        second = next(
            batch for batch in batches if batch.command_id == "command-2"
        )
        journal.block_command_result_batch(
            first,
            failed_event_id=first.events[0].event_id,
            error="poison",
            now=101.0,
        )
        journal.retry_command_result_batch(
            second,
            error="temporary",
            next_attempt_at=102.0,
            now=101.0,
        )
        ready = journal.claim_command_result_batches(now=102.0)
        assert [batch.command_id for batch in ready] == ["command-2"]


def test_tail_poison_does_not_block_prior_command_prefix(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _persist(journal)
        journal.append_command_result(
            "command-1",
            event_type="admission.accepted",
            event_id="command-1:admission",
            occurred_at=101.0,
        )
        journal.append_command_result(
            "command-1",
            event_type="execution.completed",
            event_id="command-1:result",
            payload={"result": {"ok": True}},
            occurred_at=102.0,
        )
        batch = journal.claim_command_result_batches(now=102.0)[0]
        journal.block_command_result_batch(
            batch,
            failed_event_id="command-1:result",
            error="poison tail",
            now=103.0,
        )

        prefix = journal.claim_command_result_batches(now=104.0)[0]

        assert [event.event_id for event in prefix.events] == [
            "command-1:receipt",
            "command-1:admission",
        ]


def test_latest_execution_result_is_available_for_durable_ack_replay(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _persist(journal)
        journal.append_command_result(
            "command-1",
            event_type="admission.accepted",
            event_id="command-1:admission",
            occurred_at=101.0,
        )
        journal.append_command_result(
            "command-1",
            event_type="execution.failed",
            event_id="command-1:result",
            payload={"error_code": "FAILED", "error": "boom"},
            occurred_at=102.0,
        )

        result = journal.get_latest_command_execution_result("command-1")

        assert result is not None
        assert result.event_type == "execution.failed"
        assert result.payload["error"] == "boom"


def test_stale_command_outbox_worker_cannot_overwrite_new_lease(tmp_path):
    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        _persist(journal)
        old = journal.claim_command_result_batches(
            now=100.0, lease_seconds=1.0
        )[0]
        new = journal.claim_command_result_batches(
            now=102.0, lease_seconds=30.0
        )[0]
        assert old.lease_token != new.lease_token
        with pytest.raises(OutboxLeaseLostError):
            journal.mark_command_result_batch_sent(old, now=103.0)
        journal.mark_command_result_batch_sent(new, now=103.0)
