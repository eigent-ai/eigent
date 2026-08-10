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

import sqlite3
import threading

import pytest

from app.run_journal import (
    SCHEMA_VERSION,
    AttemptEnvironmentBinding,
    CloudRunEventReplica,
    CloudRunReplica,
    EventRecorder,
    IdempotencyConflictError,
    InvalidRunTransitionError,
    OptimisticConcurrencyError,
    OutboxLeaseLostError,
    RunEventDraft,
    RunNotFoundError,
    SQLiteRunJournal,
)
from app.workspace_config import (
    EnvironmentConfigResolver,
    LocalMaterialization,
    ProviderModelCapability,
    ThinkingEffort,
    parse_workforce_manifest,
)


@pytest.fixture
def journal(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as value:
        yield value


def test_initializes_schema_and_durability_pragmas(journal):
    assert journal.schema_version == SCHEMA_VERSION
    assert journal.database_settings() == {
        "journal_mode": "wal",
        "foreign_keys": 1,
        "busy_timeout": 5000,
        "synchronous": 2,
    }

    with sqlite3.connect(journal.path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert {
        "runs",
        "run_attempts",
        "run_events",
        "run_event_sync_outbox",
        "tool_calls",
        "approvals",
        "workspace_config_revisions",
        "workspace_config_materializations",
        "effective_environment_specs",
        "human_interactions",
        "human_interaction_options",
        "human_interaction_decisions",
        "space_permission_profiles",
        "space_permission_profile_revisions",
        "approval_rules",
        "security_audit_events",
    } <= tables


def _persist_environment_spec(journal, *, owner_id: str = "run-1"):
    manifest = parse_workforce_manifest(
        """
apiVersion: eigent.ai/v1alpha1
kind: WorkforceBundle
metadata:
  id: bundle_test
  name: Test Bundle
  revision: 1
spec:
  agents:
    - id: coordinator
      role: coordinator
      modelProfile: default
  models:
    default:
      modelRef: provider://default
      thinkingEffort: medium
"""
    )
    revision = journal.put_workspace_config_revision(
        revision_id=manifest.revision_id,
        bundle_id=manifest.metadata.id,
        revision_number=manifest.metadata.revision,
        manifest=manifest.canonical_payload(),
        created_by="user-1",
        now=1,
    )
    capability = ProviderModelCapability(
        supported_efforts=tuple(ThinkingEffort),
        default_effort=ThinkingEffort.MEDIUM,
        provider_mapping={effort: effort.value for effort in ThinkingEffort},
        capability_revision="capability-v1",
    )
    spec = EnvironmentConfigResolver().resolve(
        manifest=manifest,
        owner_type="run",
        owner_id=owner_id,
        local_materialization=LocalMaterialization(),
        provider_capability=capability,
    )
    persisted = journal.put_effective_environment_spec(spec, now=2)
    return revision, spec, persisted


def test_workspace_config_and_environment_spec_are_immutable(journal):
    revision, spec, persisted = _persist_environment_spec(journal)

    assert revision.manifest_digest == spec.manifest_digest
    assert persisted.environment_spec_id == spec.spec_id
    assert persisted.environment_spec_digest == spec.digest
    assert (
        persisted.redacted_spec["projection_digest"]
        == persisted.projection_digest
    )
    assert journal.put_effective_environment_spec(spec, now=3) == persisted

    with pytest.raises(IdempotencyConflictError, match="config revision"):
        journal.put_workspace_config_revision(
            revision_id=revision.revision_id,
            bundle_id=revision.bundle_id,
            revision_number=revision.revision_number,
            manifest={**revision.manifest, "unexpected": True},
            created_by=revision.created_by,
        )


def test_workspace_config_revision_lifecycle_uses_version_cas(journal):
    manifest = parse_workforce_manifest(
        """
apiVersion: eigent.ai/v1alpha1
kind: WorkforceBundle
metadata:
  id: bundle_lifecycle
  name: Lifecycle Bundle
  revision: 1
spec:
  models:
    default:
      modelRef: provider://default
      thinkingEffort: medium
"""
    )
    draft = journal.put_workspace_config_revision(
        revision_id=manifest.revision_id,
        bundle_id=manifest.metadata.id,
        revision_number=manifest.metadata.revision,
        manifest=manifest.canonical_payload(),
        status="draft",
        created_by="user-1",
    )

    validated = journal.transition_workspace_config_revision(
        draft.revision_id,
        expected_version=0,
        status="validated",
    )
    published = journal.transition_workspace_config_revision(
        draft.revision_id,
        expected_version=1,
        status="published",
    )

    assert (draft.status, draft.version) == ("draft", 0)
    assert (validated.status, validated.version) == ("validated", 1)
    assert (published.status, published.version) == ("published", 2)
    assert published.manifest == draft.manifest
    with pytest.raises(OptimisticConcurrencyError):
        journal.transition_workspace_config_revision(
            draft.revision_id,
            expected_version=1,
            status="deprecated",
        )
    with pytest.raises(InvalidRunTransitionError):
        journal.transition_workspace_config_revision(
            draft.revision_id,
            expected_version=2,
            status="validated",
        )


def test_attempt_binds_environment_once_and_emits_resolved_values(journal):
    _, spec, _ = _persist_environment_spec(journal)
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="pending",
    )
    environment = AttemptEnvironmentBinding(
        environment_spec_id=spec.spec_id,
        environment_spec_digest=spec.digest,
        bundle_revision_id=spec.bundle_revision_id,
        permission_profile_revision=spec.permission_profile_revision,
        thinking_effort_requested=spec.thinking_effort_requested.value,
        thinking_effort_effective=spec.thinking_effort_effective.value,
        provider_capability_revision=spec.provider_capability_revision,
    )

    attempt = journal.create_run_attempt(
        "run-1",
        request_id="request-1",
        reason="initial_execution",
        environment=environment,
        attempt_id="attempt-1",
    )
    replay = journal.create_run_attempt(
        "run-1",
        request_id="request-1",
        reason="initial_execution",
        environment=environment,
        attempt_id="attempt-1",
    )

    assert replay == attempt
    assert attempt.environment_spec_id == spec.spec_id
    assert attempt.environment_spec_digest == spec.digest
    assert attempt.thinking_effort_requested == "medium"
    assert attempt.thinking_effort_effective == "medium"
    event = journal.list_events("run-1")[0]
    assert event.event_type == "run.attempt_created"
    assert event.payload["environment_spec_id"] == spec.spec_id
    assert event.payload["thinking_effort_effective"] == "medium"

    with pytest.raises(IdempotencyConflictError, match="environment"):
        journal.create_run_attempt(
            "run-1",
            request_id="request-1",
            reason="initial_execution",
            environment=None,
        )


def test_ensure_run_rejects_policy_and_deadline_drift(journal):
    first = journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        timeout_policy_version="timeouts-v2",
        deadline_at=100.0,
    )

    assert (
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            timeout_policy_version="timeouts-v2",
            deadline_at=100.0,
        )
        == first
    )
    with pytest.raises(IdempotencyConflictError, match="timeout policy"):
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            timeout_policy_version="timeouts-v3",
            deadline_at=100.0,
        )
    with pytest.raises(IdempotencyConflictError, match="deadline"):
        journal.ensure_run(
            run_id="run-1",
            project_id="project-1",
            timeout_policy_version="timeouts-v2",
            deadline_at=101.0,
        )


def test_event_and_outbox_commit_atomically(journal):
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        timeout_policy_version="timeouts-v3",
    )

    committed = journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="event-1",
            event_type="message.created",
            payload={"content": "hello"},
            created_at=10.0,
        ),
        expected_version=0,
    )

    assert committed.sequence == 1
    assert committed.run_version == 1
    assert journal.get_run("run-1").version == 1
    assert journal.list_events("run-1") == [committed]
    outbox = journal.list_pending_outbox(now=10.0)
    assert [(row.event_id, row.run_sequence) for row in outbox] == [
        ("event-1", 1)
    ]


def test_cloud_history_restore_is_read_only_and_does_not_echo_to_outbox(
    journal,
):
    event = CloudRunEventReplica(
        event_id="cloud-event-1",
        project_id="project-cloud",
        run_id="run-cloud",
        run_sequence=1,
        run_version=1,
        cloud_cursor=1,
        event_type="message.created",
        payload={"content": "restored"},
        legacy_step="decompose_text",
        created_at=10.0,
    )

    assert (
        journal.import_cloud_project_page(
            project_id="project-cloud",
            after_cursor=0,
            next_cursor=1,
            events=[event],
            now=11.0,
        )
        == 1
    )
    journal.reconcile_cloud_project_runs(
        project_id="project-cloud",
        current_cursor=1,
        runs=[
            CloudRunReplica(
                run_id="run-cloud",
                status="running",
                expected_next_run_sequence=2,
                updated_at=12.0,
            )
        ],
        now=12.0,
    )

    restored = journal.get_run("run-cloud")
    assert restored is not None
    assert restored.status == "interrupted"
    assert restored.origin == "cloud_restore"
    assert restored.resume_blocked_reason == "cloud_restore_workspace_missing"
    assert journal.list_events("run-cloud")[0].payload == {
        "content": "restored"
    }
    assert journal.list_pending_outbox(now=float("inf")) == []
    with pytest.raises(InvalidRunTransitionError, match="restored from Cloud"):
        journal.create_run_attempt(
            "run-cloud",
            request_id="resume-cloud",
            reason="explicit_resume",
        )
    with pytest.raises(InvalidRunTransitionError, match="read-only"):
        journal.append_event(
            "run-cloud",
            RunEventDraft(
                event_id="local-mutation",
                event_type="message.created",
                payload={"content": "must not mutate restored history"},
            ),
        )


def test_cloud_history_restore_rejects_cursor_gaps(journal):
    with pytest.raises(IdempotencyConflictError, match="not contiguous"):
        journal.import_cloud_project_page(
            project_id="project-cloud",
            after_cursor=0,
            next_cursor=2,
            events=[
                CloudRunEventReplica(
                    event_id="event-2",
                    project_id="project-cloud",
                    run_id="run-cloud",
                    run_sequence=1,
                    run_version=1,
                    cloud_cursor=2,
                    event_type="message.created",
                    payload={},
                    legacy_step=None,
                    created_at=10.0,
                )
            ],
        )


def test_duplicate_event_id_returns_original_without_allocating_sequence(
    journal,
):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    draft = RunEventDraft(
        event_id="event-1",
        event_type="message.created",
        payload={"content": "hello"},
        created_at=10.0,
    )

    first = journal.append_event("run-1", draft)
    duplicate = journal.append_event("run-1", draft)

    assert duplicate == first
    assert [event.sequence for event in journal.list_events("run-1")] == [1]
    assert journal.get_run("run-1").version == 1


def test_replay_preserves_the_run_version_committed_with_each_event(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="event-1",
            event_type="message.created",
            payload={"index": 1},
        ),
    )
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="event-2",
            event_type="message.created",
            payload={"index": 2},
        ),
    )

    assert [event.run_version for event in journal.list_events("run-1")] == [
        1,
        2,
    ]


def test_duplicate_event_id_with_different_data_is_rejected(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="event-1",
            event_type="message.created",
            payload={"content": "hello"},
            created_at=10.0,
        ),
    )

    with pytest.raises(IdempotencyConflictError):
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="event-1",
                event_type="message.created",
                payload={"content": "different"},
                created_at=10.0,
            ),
        )


def test_version_conflict_rolls_back_event_and_outbox(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")

    with pytest.raises(OptimisticConcurrencyError):
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id="event-1",
                event_type="message.created",
                payload={},
            ),
            expected_version=9,
        )

    assert journal.list_events("run-1") == []
    assert journal.list_pending_outbox() == []
    assert journal.get_run("run-1").version == 0


def test_concurrent_writers_allocate_contiguous_run_sequence(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    barrier = threading.Barrier(8)
    failures: list[BaseException] = []

    def append(index: int) -> None:
        try:
            barrier.wait()
            journal.append_event(
                "run-1",
                RunEventDraft(
                    event_id=f"event-{index}",
                    event_type="message.created",
                    payload={"index": index},
                ),
            )
        except BaseException as exc:
            failures.append(exc)

    threads = [
        threading.Thread(target=append, args=(index,)) for index in range(8)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert failures == []
    assert [event.sequence for event in journal.list_events("run-1")] == list(
        range(1, 9)
    )
    assert [row.run_sequence for row in journal.list_pending_outbox()] == list(
        range(1, 9)
    )


def test_list_events_applies_sequence_cursor_and_limit(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    for index in range(5):
        journal.append_event(
            "run-1",
            RunEventDraft(
                event_id=f"event-{index}",
                event_type="message.created",
                payload={"index": index},
            ),
        )

    events = journal.list_events("run-1", after_sequence=1, limit=2)

    assert [event.sequence for event in events] == [2, 3]
    with pytest.raises(ValueError, match="limit must be positive"):
        journal.list_events("run-1", limit=0)


def test_database_reopens_without_reapplying_or_losing_migration(tmp_path):
    path = tmp_path / "run-journal.sqlite3"
    with SQLiteRunJournal(path) as first:
        first.ensure_run(run_id="run-1", project_id="project-1")
        assert first.schema_version == SCHEMA_VERSION

    with SQLiteRunJournal(path) as reopened:
        assert reopened.schema_version == SCHEMA_VERSION
        assert reopened.get_run("run-1") is not None


def test_v14_database_backfills_finite_expiry_for_pending_approval(tmp_path):
    path = tmp_path / "run-journal.sqlite3"
    with SQLiteRunJournal(path) as current:
        current.ensure_run(run_id="run-1", project_id="project-1", now=10)
        current.create_approval(
            approval_id="approval-1",
            run_id="run-1",
            attempt_id=None,
            prompt={"question": "Allow this action?"},
            now=20,
        )

    with sqlite3.connect(path, isolation_level=None) as connection:
        connection.execute(
            "UPDATE approvals SET expires_at = NULL, "
            "expiry_action = 'keep_pending' WHERE approval_id = 'approval-1'"
        )
        connection.execute(
            "UPDATE human_interactions SET expires_at = NULL "
            "WHERE interaction_id = 'approval-1'"
        )
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 15"
        )
        connection.execute("PRAGMA user_version = 14")

    with SQLiteRunJournal(path) as upgraded:
        approval = upgraded.list_approvals("run-1")[0]
        interaction = upgraded.get_human_interaction("approval-1")

        assert upgraded.schema_version == SCHEMA_VERSION
        assert approval.expires_at == 86420
        assert approval.expiry_action == "reject"
        assert interaction is not None
        assert interaction.expires_at == approval.expires_at


def test_v1_database_upgrades_outbox_leases_without_losing_rows(tmp_path):
    from app.run_journal.store import _MIGRATION_V1

    path = tmp_path / "run-journal.sqlite3"
    with sqlite3.connect(path, isolation_level=None) as connection:
        connection.executescript(_MIGRATION_V1)
        connection.execute(
            """
            INSERT INTO runs(
                run_id, project_id, status, version, deadline_at,
                timeout_policy_version, created_at, updated_at
            ) VALUES ('run-1', 'project-1', 'running', 1, NULL, 'v1', 1, 1)
            """
        )
        connection.execute(
            """
            INSERT INTO run_events(
                event_id, run_id, sequence, run_version, event_type,
                payload_json, created_at
            ) VALUES ('event-1', 'run-1', 1, 1, 'message.created', '{}', 1)
            """
        )
        connection.execute(
            """
            INSERT INTO run_event_sync_outbox(
                event_id, run_id, run_sequence, next_attempt_at,
                created_at, updated_at
            ) VALUES ('event-1', 'run-1', 1, 1, 1, 1)
            """
        )

    with SQLiteRunJournal(path) as upgraded:
        assert upgraded.schema_version == SCHEMA_VERSION
        row = upgraded.list_pending_outbox(now=2)[0]
        assert row.event_id == "event-1"
        assert row.lease_token is None
        assert row.lease_until is None


def test_outbox_claims_fifo_batches_across_runs(journal):
    for run_id in ("run-1", "run-2"):
        journal.ensure_run(run_id=run_id, project_id="project-1", now=1)
        for sequence in range(1, 4):
            journal.append_event(
                run_id,
                RunEventDraft(
                    event_id=f"{run_id}-event-{sequence}",
                    event_type="message.created",
                    payload={"sequence": sequence},
                    created_at=float(sequence),
                ),
            )

    batches = journal.claim_ready_outbox_batches(
        now=10,
        max_runs=2,
        batch_size=2,
    )

    assert {batch.run_id for batch in batches} == {"run-1", "run-2"}
    assert all(
        [event.sequence for event in batch.events] == [1, 2]
        for batch in batches
    )
    for batch in batches:
        journal.mark_outbox_batch_sent(batch, now=11)
    next_batches = journal.claim_ready_outbox_batches(now=12, max_runs=2)
    assert all(
        [event.sequence for event in batch.events] == [3]
        for batch in next_batches
    )


def test_expired_sending_lease_is_reclaimed_and_old_worker_is_fenced(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1", now=1)
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="event-1",
            event_type="message.created",
            payload={},
            created_at=1,
        ),
    )
    old_batch = journal.claim_ready_outbox_batches(now=2, lease_seconds=1)[0]
    new_batch = journal.claim_ready_outbox_batches(now=4, lease_seconds=10)[0]

    assert old_batch.lease_token != new_batch.lease_token
    with pytest.raises(OutboxLeaseLostError):
        journal.mark_outbox_batch_sent(old_batch, now=5)
    journal.mark_outbox_batch_sent(new_batch, now=5)


def test_dead_letter_blocks_only_its_run(journal):
    for run_id in ("run-bad", "run-good"):
        journal.ensure_run(run_id=run_id, project_id="project-1", now=1)
        journal.append_event(
            run_id,
            RunEventDraft(
                event_id=f"{run_id}-event-1",
                event_type="message.created",
                payload={},
                created_at=1,
            ),
        )
    batches = journal.claim_ready_outbox_batches(now=2, max_runs=2)
    bad = next(batch for batch in batches if batch.run_id == "run-bad")
    good = next(batch for batch in batches if batch.run_id == "run-good")
    journal.block_outbox_batch(
        bad,
        failed_event_id=bad.events[0].event_id,
        error="invalid payload",
        now=3,
    )
    journal.retry_outbox_batch(
        good,
        error="network",
        next_attempt_at=3,
        now=3,
    )

    ready = journal.claim_ready_outbox_batches(now=4, max_runs=2)
    assert [batch.run_id for batch in ready] == ["run-good"]


@pytest.mark.asyncio
async def test_event_recorder_wakeup_runs_after_durable_commit(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    seen: list[str] = []

    def on_commit() -> None:
        seen.extend(row.event_id for row in journal.list_pending_outbox())

    recorder = EventRecorder(journal, on_commit=on_commit)
    await recorder.commit(
        "run-1",
        RunEventDraft(
            event_id="event-1",
            event_type="message.created",
            payload={},
        ),
    )

    assert seen == ["event-1"]


@pytest.mark.asyncio
async def test_event_recorder_requires_admitted_run_and_records_event(
    journal,
):
    recorder = EventRecorder(journal)

    with pytest.raises(RunNotFoundError):
        await recorder.record_legacy_step(
            project_id="project-1",
            run_id="run-1",
            step="activate_agent",
            data={"agent": "browser"},
        )

    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        timeout_policy_version="timeouts-v3",
    )

    committed = await recorder.record_legacy_step(
        project_id="project-1",
        run_id="run-1",
        step="activate_agent",
        data={"agent": "browser"},
        event_id="event-1",
        created_at=10.0,
    )

    run = journal.get_run("run-1")
    assert run is not None
    assert run.project_id == "project-1"
    assert run.timeout_policy_version == "timeouts-v3"
    assert committed.legacy_step == "activate_agent"
    assert committed.event_type == "legacy.activate_agent"
    assert committed.payload == {"agent": "browser"}
    assert journal.list_pending_outbox(now=10.0)[0].event_id == "event-1"


@pytest.mark.asyncio
async def test_event_recorder_rejects_cross_project_attribution(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    recorder = EventRecorder(journal)

    with pytest.raises(IdempotencyConflictError, match="project-1"):
        await recorder.record_legacy_step(
            project_id="project-2",
            run_id="run-1",
            step="notice",
            data={"message": "wrong project"},
        )

    await recorder.record_legacy_step(
        project_id="project-1",
        run_id="run-1",
        step="notice",
        data={"message": "original"},
        event_id="event-1",
    )
    with pytest.raises(IdempotencyConflictError, match="project-1"):
        await recorder.record_legacy_step(
            project_id="project-2",
            run_id="run-1",
            step="notice",
            data={"message": "original"},
            event_id="event-1",
        )


@pytest.mark.asyncio
async def test_legacy_end_requires_trusted_execution_stream(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    recorder = EventRecorder(journal)

    with pytest.raises(ValueError, match="trusted execution stream"):
        await recorder.record_legacy_step(
            project_id="project-1",
            run_id="run-1",
            step="end",
            data={},
        )

    await recorder.record_legacy_step(
        project_id="project-1",
        run_id="run-1",
        step="end",
        data={},
        allow_terminal=True,
    )
    assert journal.get_run("run-1").status == "completed"
