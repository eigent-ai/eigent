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

import asyncio
import json
from typing import Any

import httpx
import pytest

from app.run_journal import (
    ArtifactUploadSyncItem,
    RunEventDraft,
    SQLiteRunJournal,
)
from app.run_sync import (
    CloudSyncConfiguration,
    CloudSyncWorker,
    HttpRunEventSyncTransport,
    RunEventSyncHttpError,
)
from app.run_sync.cloud_sync import RunSyncInfrastructureError


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
        self.memory_snapshots: list[dict[str, Any]] = []
        self.memory_payloads: list[dict[str, Any]] = []
        self.memory_snapshot_failures: set[tuple[str, str]] = set()
        self.memory_snapshot_error: Exception | None = None
        self.memory_snapshot_revision_conflicts: set[tuple[str, str]] = set()
        self.memory_writer_conflicts: set[tuple[str, str]] = set()
        self.memory_writer_claims: list[dict[str, Any]] = []
        self.memory_writer_epochs: dict[tuple[str, str], int] = {}
        self.memory_heartbeats: list[dict[str, Any]] = []
        self.memory_heartbeat_missing: set[tuple[str, str]] = set()
        self.memory_heartbeat_error: Exception | None = None
        self.memory_snapshot_includes_writer_epoch = True
        self.artifact_uploads = []
        self.artifact_upload_gate: asyncio.Event | None = None
        self.artifact_upload_error: Exception | None = None

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
            "has_more": bool(
                items and items[-1]["cloud_cursor"] < current_cursor
            ),
            "items": items,
        }

    async def put_memory_snapshot(self, configuration, payload):
        self.memory_snapshots.append(payload)
        if self.memory_snapshot_error is not None:
            raise self.memory_snapshot_error
        key = (payload["scope_type"], payload["scope_id"])
        if key in self.memory_writer_conflicts:
            self.memory_writer_conflicts.remove(key)
            raise RunEventSyncHttpError(
                409,
                {
                    "detail": {
                        "code": "memory_scope_writer_conflict",
                        "current_writer_epoch": 4,
                    }
                },
            )
        if key in self.memory_snapshot_revision_conflicts:
            raise RunEventSyncHttpError(
                409,
                {
                    "detail": {
                        "code": "memory_snapshot_same_revision_conflict",
                    }
                },
            )
        if (payload["scope_type"], payload["scope_id"]) in (
            self.memory_snapshot_failures
        ):
            raise RuntimeError("malformed Memory scope")
        response = {
            "scope_type": payload["scope_type"],
            "scope_id": payload["scope_id"],
            "source_revision": payload["source_revision"],
            "entry_count": len(payload["entries"]),
        }
        if self.memory_snapshot_includes_writer_epoch:
            response["writer_epoch"] = self.memory_writer_epochs.setdefault(
                key, 1
            )
        return response

    async def heartbeat_memory_scopes(self, configuration, payload):
        self.memory_heartbeats.append(payload)
        if self.memory_heartbeat_error is not None:
            raise self.memory_heartbeat_error
        return {
            "items": [
                item
                for item in payload["items"]
                if (item["scope_type"], item["scope_id"])
                not in self.memory_heartbeat_missing
            ],
            "verified_at": "2026-08-18T00:00:00+00:00",
        }

    async def account_owner_id(self, configuration):
        return "7"

    async def authorize_memory_scopes(self, configuration, scopes):
        return {
            "account_owner_id": "7",
            "authorized_scopes": [
                {"scope_type": scope_type, "scope_id": scope_id}
                for scope_type, scope_id in scopes
            ],
        }

    async def claim_memory_writer(self, configuration, payload):
        self.memory_writer_claims.append(payload)
        key = (payload["scope_type"], payload["scope_id"])
        self.memory_writer_epochs[key] = payload["expected_writer_epoch"] + 1
        return {
            **payload,
            "writer_epoch": self.memory_writer_epochs[key],
            "owner_device_id": configuration.desktop_instance_id,
            "rebase_required": True,
            "baseline_source_revision": 7,
            "baseline_scope": {
                "capture_enabled": payload["scope_type"] == "project",
                "use_enabled": True,
                "sync_scope": "full_memory",
                "token_limit": (
                    1024 if payload["scope_type"] == "project" else 384
                ),
                "processed_through_watermark": None,
                "watermark_kind": None,
                "updated_at": "2026-08-14T00:00:00+00:00",
            },
            "baseline_entries": [],
        }

    async def ingest_memory_mutations(self, configuration, payload):
        self.memory_payloads.append(payload)
        return {
            "scope_type": payload["scope_type"],
            "scope_id": payload["scope_id"],
            "revision": payload["source_revision"],
            "items": [
                {
                    "mutation_id": mutation["mutation_id"],
                    "inserted": True,
                    "scope_revision": mutation["scope_revision"],
                }
                for mutation in payload["mutations"]
            ],
        }

    async def upload_artifact(self, configuration, item):
        self.artifact_uploads.append(item)
        if self.artifact_upload_error is not None:
            raise self.artifact_upload_error
        if self.artifact_upload_gate is not None:
            await self.artifact_upload_gate.wait()
        return {
            "id": 73,
            "filename": item.filename,
            "file_size": item.file_size,
            "file_type": "text/plain",
            "s3_bucket": "test-assets",
            "s3_key": f"artifacts/{item.artifact_id}",
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


def _add_memory_scope(
    journal: SQLiteRunJournal,
    scope_type: str,
    scope_id: str,
) -> None:
    journal.apply_memory_mutation(
        mutation_id=f"mutation-{scope_type}-{scope_id}",
        idempotency_key=f"request-{scope_type}-{scope_id}",
        operation="add",
        scope_type=scope_type,
        scope_id=scope_id,
        memory_id=f"memory-{scope_type}-{scope_id}",
        actor_type="user",
        reason="Created in Memory Center",
        content=f"Remember {scope_type} {scope_id}.",
        kind="preference",
        token_count=4,
        created_by="user",
        source_trust="user_confirmed",
    )
    journal.bind_memory_scope_owner(
        scope_type,
        scope_id,
        account_owner_id="7",
    )


@pytest.mark.asyncio
async def test_artifact_upload_sends_leaf_filename_and_logical_metadata(
    tmp_path,
):
    captured: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = await request.aread()
        return httpx.Response(
            200,
            json={
                "id": 73,
                "filename": "report.csv",
                "file_size": 4,
                "file_type": "text/csv",
                "s3_bucket": "test-assets",
                "s3_key": "artifacts/report.csv",
                "source": "project_output",
                "logical_path": "reports/report.csv",
            },
        )

    path = tmp_path / "report.csv"
    path.write_text("a,b\n", encoding="utf-8")
    transport = HttpRunEventSyncTransport(
        transport=httpx.MockTransport(handler)
    )
    configuration = CloudSyncConfiguration(
        endpoint_url="https://cloud.example/api/v1/sync/events:ingest",
        authorization="Bearer token",
        desktop_instance_id="desktop-1",
    )
    item = ArtifactUploadSyncItem(
        artifact_id="artifact-1",
        run_id="run-1",
        project_id="project-1",
        local_path=str(path),
        filename="report.csv",
        relative_path="reports/report.csv",
        file_size=path.stat().st_size,
        lease_token="lease-1",
        attempt_count=0,
    )

    await transport.upload_artifact(configuration, item)
    await transport.close()

    body = captured["body"]
    assert isinstance(body, bytes)
    assert b'name="source"\r\n\r\nproject_output' in body
    assert b'name="logical_path"\r\n\r\nreports/report.csv' in body
    assert b'filename="report.csv"' in body
    assert b'filename="reports/report.csv"' not in body


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
async def test_worker_uploads_durable_artifact_then_syncs_asset_event(
    journal, tmp_path
):
    from app.artifacts import record_artifact_manifest

    artifact_path = tmp_path / "report.txt"
    artifact_path.write_text("durable report", encoding="utf-8")
    journal.ensure_run(run_id="run-artifact", project_id="project-1", now=1)
    record_artifact_manifest(
        journal,
        run_id="run-artifact",
        project_id="project-1",
        artifacts=[
            {
                "filename": "report.txt",
                "path": str(artifact_path),
                "relativePath": "reports/report.txt",
                "changeType": "generated",
                "size": artifact_path.stat().st_size,
                "uploadPolicy": "agent_generated",
            }
        ],
    )
    # A manifest can still be corrected while its Run is active. Upload does
    # not claim bytes until the terminal barrier pins the authoritative set.
    assert journal.claim_ready_artifact_uploads(now=float("inf")) == []
    journal.append_event(
        "run-artifact",
        RunEventDraft(
            event_id="run-artifact-completed",
            event_type="run.completed",
            payload={},
            created_at=3,
        ),
    )
    transport = FakeTransport()
    transport.artifact_upload_gate = asyncio.Event()
    worker = _worker(journal, transport)

    # The S3 lane is deliberately stalled. Canonical events, including the
    # terminal result, must still reach Cloud without waiting for file bytes.
    assert await worker.drain_once() == 3
    assert transport.payloads
    assert transport.payloads[0]["events"][-1]["event_type"] == "run.completed"
    assert not any(
        event.event_type == "artifact.uploaded"
        for event in journal.list_events("run-artifact")
    )

    transport.artifact_upload_gate.set()
    for _ in range(100):
        if any(
            event.event_type == "artifact.uploaded"
            for event in journal.list_events("run-artifact")
        ):
            break
        await asyncio.sleep(0)
    assert await worker.drain_once() == 1

    assert len(transport.artifact_uploads) == 1
    upload = transport.artifact_uploads[0]
    uploaded = [
        event
        for event in journal.list_events("run-artifact")
        if event.event_type == "artifact.uploaded"
    ]
    assert len(uploaded) == 1
    assert uploaded[0].sequence > next(
        event.sequence
        for event in journal.list_events("run-artifact")
        if event.event_type == "run.completed"
    )
    assert uploaded[0].payload["artifact_id"] == upload.artifact_id
    assert uploaded[0].payload["asset_ref"]["chat_file_id"] == 73
    assert journal.claim_ready_artifact_uploads(now=float("inf")) == []
    await worker.close()


@pytest.mark.asyncio
async def test_artifact_upload_502_dead_letters_after_bounded_retries(
    journal, tmp_path
):
    from app.artifacts import record_artifact_manifest

    artifact_path = tmp_path / "report.txt"
    artifact_path.write_text("durable report", encoding="utf-8")
    journal.ensure_run(run_id="run-artifact-502", project_id="project-1")
    record_artifact_manifest(
        journal,
        run_id="run-artifact-502",
        project_id="project-1",
        artifacts=[
            {
                "filename": "report.txt",
                "path": str(artifact_path),
                "relativePath": "report.txt",
                "changeType": "generated",
                "size": artifact_path.stat().st_size,
                "uploadPolicy": "agent_generated",
            }
        ],
    )
    journal.append_event(
        "run-artifact-502",
        RunEventDraft(
            event_id="run-artifact-502-completed",
            event_type="run.completed",
            payload={},
        ),
    )
    transport = FakeTransport()
    transport.artifact_upload_error = RunEventSyncHttpError(
        502, {"detail": "temporary upstream failure"}
    )
    worker = _worker(journal, transport)
    configuration = worker._configuration  # noqa: SLF001 - retry path test
    assert configuration is not None

    for _ in range(8):
        item = journal.claim_ready_artifact_uploads(now=float("inf"))[0]
        await worker._sync_artifact_upload(  # noqa: SLF001 - retry path test
            item, configuration
        )

    assert journal.claim_ready_artifact_uploads(now=float("inf")) == []
    with journal._lock:  # noqa: SLF001 - durable outbox assertion
        row = journal._connection.execute(  # noqa: SLF001
            """
            SELECT status, attempt_count FROM artifact_upload_outbox
            WHERE run_id = 'run-artifact-502'
            """
        ).fetchone()
    assert row is not None
    assert (row["status"], row["attempt_count"]) == ("dead_letter", 8)
    await worker.close()


@pytest.mark.asyncio
async def test_worker_syncs_full_memory_snapshot_and_independent_outbox(
    journal,
):
    journal.apply_memory_mutation(
        mutation_id="mutation-1",
        idempotency_key="request-1",
        operation="add",
        scope_type="project",
        scope_id="project-1",
        memory_id="memory-1",
        actor_type="user",
        reason="Created in Memory Center",
        content="Use Chinese.",
        kind="preference",
        token_count=3,
        created_by="user",
        source_trust="user_confirmed",
    )
    journal.bind_memory_scope_owner(
        "project", "project-1", account_owner_id="7"
    )
    transport = FakeTransport()
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 1

    assert (
        transport.memory_snapshots[0]["scope"]["sync_scope"] == "full_memory"
    )
    assert (
        transport.memory_snapshots[0]["entries"][0]["content"]
        == "Use Chinese."
    )
    assert (
        transport.memory_payloads[0]["mutations"][0]["entry"]["content"]
        == "Use Chinese."
    )
    assert transport.memory_payloads[0]["mutations"][0]["scope_revision"] == 1
    assert journal.claim_ready_memory_mutation_batches(now=float("inf")) == []
    await worker.close()


@pytest.mark.asyncio
async def test_unchanged_memory_uses_lightweight_heartbeat_not_full_snapshot(
    journal,
):
    _add_memory_scope(journal, "project", "project-1")
    transport = FakeTransport()
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 1
    assert len(transport.memory_snapshots) == 1

    worker._memory_snapshot_verified_at[  # noqa: SLF001
        ("project", "project-1")
    ] = 0.0
    worker._memory_heartbeat_next_at = 0.001  # noqa: SLF001
    assert await worker.drain_once() == 0

    assert len(transport.memory_snapshots) == 1
    assert transport.memory_heartbeats == [
        {
            "items": [
                {
                    "scope_type": "project",
                    "scope_id": "project-1",
                    "source_revision": 1,
                    "writer_epoch": 1,
                }
            ]
        }
    ]
    await worker.close()


@pytest.mark.asyncio
async def test_memory_heartbeat_batches_all_unchanged_scopes_per_desktop(
    journal,
):
    _add_memory_scope(journal, "project", "project-1")
    _add_memory_scope(journal, "user", "user-7")
    transport = FakeTransport()
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 2
    worker._memory_heartbeat_next_at = 0.001  # noqa: SLF001
    assert await worker.drain_once() == 0

    assert len(transport.memory_heartbeats) == 1
    assert {
        (item["scope_type"], item["scope_id"])
        for item in transport.memory_heartbeats[0]["items"]
    } == {("project", "project-1"), ("user", "user-7")}
    assert len(transport.memory_snapshots) == 2
    await worker.close()


@pytest.mark.asyncio
async def test_missing_memory_heartbeat_ack_repairs_only_that_scope(journal):
    _add_memory_scope(journal, "project", "project-1")
    _add_memory_scope(journal, "user", "user-7")
    transport = FakeTransport()
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 2
    transport.memory_heartbeat_missing.add(("project", "project-1"))
    worker._memory_heartbeat_next_at = 0.001  # noqa: SLF001
    assert await worker.drain_once() == 0
    assert len(transport.memory_snapshots) == 2

    assert await worker.drain_once() == 0
    assert len(transport.memory_snapshots) == 3
    assert transport.memory_snapshots[-1]["scope_id"] == "project-1"
    await worker.close()


@pytest.mark.asyncio
async def test_memory_heartbeat_timeout_backs_off_without_snapshot_storm(
    journal,
    caplog,
):
    _add_memory_scope(journal, "project", "project-1")
    transport = FakeTransport()
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 1
    transport.memory_heartbeat_error = httpx.ConnectTimeout("TLS timed out")
    worker._memory_heartbeat_next_at = 0.001  # noqa: SLF001
    with caplog.at_level("WARNING"):
        assert await worker.drain_once() == 0

    assert len(transport.memory_snapshots) == 1
    assert len(transport.memory_heartbeats) == 1
    assert worker._memory_heartbeat_next_at > 0.001  # noqa: SLF001
    assert "Cloud Memory heartbeat failed (ConnectTimeout)" in caplog.text
    await worker.close()


@pytest.mark.asyncio
async def test_initial_memory_snapshot_connect_timeout_uses_concise_warning(
    journal,
    caplog,
):
    _add_memory_scope(journal, "project", "project-1")
    transport = FakeTransport()
    transport.memory_snapshot_error = httpx.ConnectTimeout("TLS timed out")
    worker = _worker(journal, transport)

    with caplog.at_level("WARNING"):
        assert await worker.drain_once() == 0

    assert len(transport.memory_snapshots) == 1
    assert "snapshot sync timed out for project/project-1" in caplog.text
    assert "Traceback" not in caplog.text
    await worker.close()


@pytest.mark.asyncio
async def test_legacy_snapshot_without_writer_epoch_is_not_reuploaded(journal):
    _add_memory_scope(journal, "project", "project-1")
    transport = FakeTransport()
    transport.memory_snapshot_includes_writer_epoch = False
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 1
    worker._memory_heartbeat_next_at = 0.001  # noqa: SLF001
    assert await worker.drain_once() == 0

    assert len(transport.memory_snapshots) == 1
    assert transport.memory_heartbeats == []
    await worker.close()


@pytest.mark.asyncio
async def test_bad_memory_snapshot_does_not_block_an_unrelated_scope(journal):
    for scope_type, scope_id, suffix in (
        ("project", "project-1", "project"),
        ("user", "user-1", "user"),
    ):
        journal.apply_memory_mutation(
            mutation_id=f"mutation-{suffix}",
            idempotency_key=f"request-{suffix}",
            operation="add",
            scope_type=scope_type,
            scope_id=scope_id,
            memory_id=f"memory-{suffix}",
            actor_type="user",
            reason="Created in Memory Center",
            content=f"{suffix} preference",
            kind="preference",
            token_count=3,
            created_by="user",
            source_trust="user_confirmed",
        )
        journal.bind_memory_scope_owner(
            scope_type, scope_id, account_owner_id="7"
        )
    transport = FakeTransport()
    transport.memory_snapshot_failures.add(("project", "project-1"))
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 1

    assert [item["scope_id"] for item in transport.memory_payloads] == [
        "user-1"
    ]
    remaining = journal.claim_ready_memory_mutation_batches(now=float("inf"))
    assert [batch.scope_id for batch in remaining] == ["project-1"]

    assert await worker.drain_once() == 0
    assert len(transport.memory_snapshots) == 2
    await worker.close()


@pytest.mark.asyncio
async def test_same_revision_snapshot_conflict_advances_only_that_scope(
    journal,
):
    journal.apply_memory_mutation(
        mutation_id="mutation-1",
        idempotency_key="request-1",
        operation="add",
        scope_type="project",
        scope_id="project-1",
        memory_id="memory-1",
        actor_type="user",
        reason="Created in Memory Center",
        content="Use Chinese.",
        kind="preference",
        token_count=3,
        created_by="user",
        source_trust="user_confirmed",
    )
    journal.bind_memory_scope_owner(
        "project", "project-1", account_owner_id="7"
    )
    transport = FakeTransport()
    key = ("project", "project-1")
    transport.memory_snapshot_revision_conflicts.add(key)
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 0
    assert journal.get_memory_scope_state(*key).revision == 2
    assert len(transport.memory_snapshots) == 2

    assert await worker.drain_once() == 0
    assert len(transport.memory_snapshots) == 2

    transport.memory_snapshot_revision_conflicts.clear()
    worker._memory_snapshot_retry_after[key] = 0  # noqa: SLF001
    assert await worker.drain_once() == 1
    assert transport.memory_snapshots[-1]["source_revision"] == 2
    assert journal.claim_ready_memory_mutation_batches(now=float("inf")) == []
    await worker.close()


@pytest.mark.asyncio
async def test_worker_claims_stale_memory_writer_then_retries_full_snapshot(
    journal,
):
    journal.apply_memory_mutation(
        mutation_id="mutation-1",
        idempotency_key="request-1",
        operation="add",
        scope_type="project",
        scope_id="project-1",
        memory_id="memory-1",
        actor_type="user",
        reason="Created in Memory Center",
        content="Use Chinese.",
        kind="preference",
        token_count=3,
        created_by="user",
        source_trust="user_confirmed",
    )
    journal.bind_memory_scope_owner(
        "project", "project-1", account_owner_id="7"
    )
    transport = FakeTransport()
    transport.memory_writer_conflicts.add(("project", "project-1"))
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 1

    assert transport.memory_writer_claims == [
        {
            "scope_type": "project",
            "scope_id": "project-1",
            "expected_writer_epoch": 4,
        }
    ]
    assert len(transport.memory_snapshots) == 2
    assert len(transport.memory_payloads) == 1
    await worker.close()


@pytest.mark.asyncio
async def test_worker_redacts_approval_arguments_and_local_targets(journal):
    journal.ensure_run(run_id="run-approval", project_id="project-1", now=1)
    journal.append_event(
        "run-approval",
        RunEventDraft(
            event_id="approval-requested",
            event_type="approval.requested",
            payload={
                "approval_id": "approval-1",
                "action_digest": "digest-1",
                "prompt": {
                    "question": "Allow write?",
                    "target_resources": [
                        "/Users/test/private/report.md",
                        "https://example.test/private?token=secret",
                    ],
                    "action": {
                        "operation": "filesystem.write",
                        "normalized_arguments": {
                            "path": "/Users/test/private/report.md",
                            "content": "private report contents",
                        },
                        "target_resources": ["/Users/test/private/report.md"],
                    },
                    "rule_matcher": {
                        "action_pattern": "filesystem.write",
                        "resource_pattern": "/Users/test/private/report.md",
                    },
                },
            },
            created_at=1,
        ),
    )
    transport = FakeTransport()
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 1

    cloud_payload = transport.payloads[0]["events"][0]["payload"]
    encoded = json.dumps(cloud_payload)
    assert "normalized_arguments" not in encoded
    assert "private report contents" not in encoded
    assert "/Users/test/private" not in encoded
    assert cloud_payload["prompt"]["target_resources"] == [
        "[local]/report.md",
        "https://example.test",
    ]
    assert (
        cloud_payload["prompt"]["rule_matcher"]["resource_pattern"]
        == "[local]/report.md"
    )
    local_event = journal.list_events("run-approval")[0]
    assert "normalized_arguments" in local_event.payload["prompt"]["action"]
    await worker.close()


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


def test_artifact_cloud_projection_removes_machine_local_paths():
    from app.run_sync.cloud_sync import _cloud_event_payload

    projected = _cloud_event_payload(
        "artifact.manifest.finalized",
        {
            "artifact_count": 1,
            "artifacts": [
                {
                    "artifact_id": "art-1",
                    "path": "/Users/alice/private/report.csv",
                    "relativePath": "reports/report.csv",
                }
            ],
        },
    )

    assert projected["localPathAvailable"] is False
    assert projected["artifacts"] == [
        {
            "artifact_id": "art-1",
            "relativePath": "reports/report.csv",
            "localPathAvailable": False,
        }
    ]


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
                    "account_owner_id": "user-1",
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

    assert (
        len(
            [
                request
                for request in requests
                if request.url.path.endswith("/devices/register")
            ]
        )
        == 1
    )
    assert any(
        "/projects/project%2Fone/snapshot" in str(request.url)
        for request in requests
    )
    assert any(
        "event_limit=1&include_artifacts=false" in str(request.url)
        for request in requests
    )
    await transport.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [11, 12, 13, 14])
async def test_http_transport_rejects_http_200_auth_error_envelope(code):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/devices/register")
        return httpx.Response(
            200,
            json={"code": code, "text": "Authentication rejected"},
        )

    transport = HttpRunEventSyncTransport(
        transport=httpx.MockTransport(handler)
    )
    configuration = CloudSyncConfiguration(
        endpoint_url="https://example.test/api/v1/sync/events:ingest",
        authorization="Bearer expired",
        desktop_instance_id="desk-1",
    )

    with pytest.raises(RunSyncInfrastructureError) as exc_info:
        await transport.list_projects(configuration)

    assert exc_info.value.code == str(code)
    assert f"application error {code}" in str(exc_info.value)
    assert "omitted authenticated account owner" not in str(exc_info.value)
    await transport.close()


@pytest.mark.asyncio
async def test_http_transport_reregisters_when_cloud_credential_changes():
    registrations: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/devices/register"):
            authorization = request.headers["authorization"]
            registrations.append(authorization)
            return httpx.Response(
                200,
                json={
                    "device_id": "desk-1",
                    "account_owner_id": authorization,
                    "credential_version": 1,
                    "registered_at": "2026-08-26T00:00:00+00:00",
                },
            )
        assert request.url.path.endswith("/sync/projects")
        return httpx.Response(200, json={"items": []})

    transport = HttpRunEventSyncTransport(
        transport=httpx.MockTransport(handler)
    )
    first = CloudSyncConfiguration(
        endpoint_url="https://example.test/api/v1/sync/events:ingest",
        authorization="Bearer first",
        desktop_instance_id="desk-1",
    )
    second = CloudSyncConfiguration(
        endpoint_url=first.endpoint_url,
        authorization="Bearer refreshed",
        desktop_instance_id=first.desktop_instance_id,
    )

    assert await transport.list_projects(first) == {"items": []}
    assert await transport.list_projects(first) == {"items": []}
    assert await transport.list_projects(second) == {"items": []}

    assert registrations == ["Bearer first", "Bearer refreshed"]
    await transport.close()


@pytest.mark.asyncio
async def test_worker_pauses_cloud_lanes_until_credentials_change(journal):
    class AuthenticationTransport(FakeTransport):
        def __init__(self) -> None:
            super().__init__()
            self.bootstrap_calls: list[str] = []

        async def list_projects(self, configuration):
            self.bootstrap_calls.append(configuration.authorization)
            if configuration.authorization == "Bearer expired":
                raise RunSyncInfrastructureError(
                    "Authentication rejected", code="13"
                )
            return {"items": []}

    transport = AuthenticationTransport()
    worker = CloudSyncWorker(journal, transport)
    expired = CloudSyncConfiguration(
        endpoint_url="https://example.test/api/v1/sync/events:ingest",
        authorization="Bearer expired",
        desktop_instance_id="desk-1",
    )
    refreshed = CloudSyncConfiguration(
        endpoint_url=expired.endpoint_url,
        authorization="Bearer refreshed",
        desktop_instance_id=expired.desktop_instance_id,
    )
    worker.configure(expired)
    _append(journal, "run-local")

    assert await worker.drain_once() == 0
    assert await worker.drain_once() == 0
    assert transport.bootstrap_calls == ["Bearer expired"]
    assert worker.bootstrap_pending is True
    pending = journal.list_pending_outbox(now=float("inf"))
    assert len(pending) == 1
    assert pending[0].attempt_count == 0

    worker.configure(refreshed)
    assert await worker.drain_once() == 1
    assert transport.bootstrap_calls == ["Bearer expired", "Bearer refreshed"]
    assert worker.bootstrap_pending is False
    assert journal.list_pending_outbox(now=float("inf")) == []
    await worker.close()


@pytest.mark.asyncio
async def test_worker_slowly_reprobes_same_credentials_after_auth_failure(
    journal,
):
    class RecoveringTransport(FakeTransport):
        def __init__(self) -> None:
            super().__init__()
            self.auth_available = False
            self.bootstrap_count = 0

        async def list_projects(self, configuration):
            self.bootstrap_count += 1
            if not self.auth_available:
                raise RunSyncInfrastructureError(
                    "Authentication temporarily unavailable", code="11"
                )
            return {"items": []}

    transport = RecoveringTransport()
    worker = _worker(journal, transport)

    assert await worker.drain_once() == 0
    assert await worker.drain_once() == 0
    assert transport.bootstrap_count == 1

    transport.auth_available = True
    worker._auth_retry_at = 0.0
    worker._bootstrap_next_attempt_at = 0.0
    assert await worker.drain_once() == 0
    assert transport.bootstrap_count == 2
    assert worker._auth_paused_configuration is None
    await worker.close()


@pytest.mark.asyncio
async def test_http_transport_batches_memory_heartbeats_with_device_auth():
    heartbeat_batches: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer secret"
        assert request.headers["X-Desktop-Instance-ID"] == "desk-1"
        if request.url.path.endswith("/devices/register"):
            return httpx.Response(
                200,
                json={
                    "device_id": "desk-1",
                    "account_owner_id": "user-1",
                    "credential_version": 1,
                    "registered_at": "2026-08-18T00:00:00+00:00",
                },
            )
        assert request.url.path.endswith("/sync/memory/heartbeats")
        body = json.loads(request.content)
        heartbeat_batches.append(body)
        return httpx.Response(
            200,
            json={
                "items": body["items"],
                "verified_at": "2026-08-18T00:00:00+00:00",
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
    items = [
        {
            "scope_type": "project",
            "scope_id": f"project-{index}",
            "source_revision": 1,
            "writer_epoch": 1,
        }
        for index in range(101)
    ]

    response = await transport.heartbeat_memory_scopes(
        configuration, {"items": items}
    )

    assert [len(batch["items"]) for batch in heartbeat_batches] == [100, 1]
    assert response["items"] == items
    await transport.close()
