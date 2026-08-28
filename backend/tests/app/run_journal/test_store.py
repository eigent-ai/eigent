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
import sqlite3
import threading
from unittest.mock import patch

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
from app.run_journal.cloud_projection import cloud_event_payload
from app.run_policy import TimeoutOutcome, TimeoutScope, ToolSafetyClass
from app.run_runtime.step_coordinator import (
    PlanStepInput,
    RunStepCoordinator,
    stable_step_id,
)
from app.workspace_config import (
    EnvironmentConfigResolver,
    LocalMaterialization,
    ProviderModelCapability,
    ThinkingEffort,
    parse_workspace_manifest,
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
        "model_invocations",
        "model_invocation_events",
        "attempt_evidence_gaps",
        "tool_calls",
        "approvals",
        "workspace_config_revisions",
        "workspace_config_materializations",
        "workspace_config_drafts",
        "workspace_config_draft_asset_blobs",
        "workspace_config_draft_assets",
        "workspace_agent_plugin_import_requests",
        "effective_environment_specs",
        "human_interactions",
        "human_interaction_options",
        "human_interaction_decisions",
        "space_permission_profiles",
        "space_permission_profile_revisions",
        "approval_rules",
        "security_audit_events",
        "project_history_cursors",
        "project_history_events",
        "memory_scope_state",
        "memory_entries",
        "memory_mutations",
        "memory_mutation_outbox",
        "project_workspace_bindings",
        "workspace_writer_requests",
        "workspace_writer_leases",
    } <= tables


def _put_content_repository(
    journal, *, repository_id="repo-1", space_id="space-1"
):
    return journal.put_git_repository(
        repository_id=repository_id,
        space_id=space_id,
        repository_role="content",
        root_path=f"/tmp/{space_id}",
        root_path_digest="a" * 64,
        ownership="eigent_owned",
        state="ready",
        version_coverage="full",
        now=1,
    )


def test_project_workspace_binding_defaults_to_shared_primary_checkout(
    journal,
):
    _put_content_repository(journal)

    first = journal.ensure_project_workspace_binding(
        project_id="project-1",
        repository_id="repo-1",
        checkout_id="checkout-primary",
        checkout_mode="primary_checkout",
        target_ref="refs/heads/main",
        worktree_path="/tmp/space-1",
        now=10,
    )
    second = journal.ensure_project_workspace_binding(
        project_id="project-2",
        repository_id="repo-1",
        checkout_id="checkout-primary",
        checkout_mode="primary_checkout",
        target_ref="refs/heads/main",
        worktree_path="/tmp/space-1",
        now=11,
    )

    assert first.checkout_mode == "primary_checkout"
    assert first.checkout_id == second.checkout_id
    assert first.worktree_path == second.worktree_path
    assert journal.get_project_workspace_binding("project-1") == first

    replay = journal.ensure_project_workspace_binding(
        project_id="project-1",
        repository_id="repo-1",
        checkout_id="checkout-primary",
        checkout_mode="primary_checkout",
        target_ref="refs/heads/main",
        worktree_path="/tmp/space-1",
        now=99,
    )
    assert replay == first

    with pytest.raises(IdempotencyConflictError, match="another workspace"):
        journal.ensure_project_workspace_binding(
            project_id="project-1",
            repository_id="repo-1",
            checkout_id="checkout-silent-fork",
            checkout_mode="explicit_worktree",
            target_ref="refs/heads/feature",
            worktree_path="/tmp/feature",
        )


def test_project_workspace_binding_requires_explicit_cas_to_switch(journal):
    _put_content_repository(journal)
    original = journal.ensure_project_workspace_binding(
        project_id="project-1",
        repository_id="repo-1",
        checkout_id="checkout-primary",
        checkout_mode="primary_checkout",
        target_ref="refs/heads/main",
        worktree_path="/tmp/space-1",
        now=10,
    )

    switched = journal.update_project_workspace_binding(
        project_id="project-1",
        expected_version=original.version,
        checkout_id="checkout-feature",
        checkout_mode="explicit_worktree",
        target_ref="refs/heads/feature",
        worktree_path="/tmp/feature",
        now=11,
    )

    assert switched.version == original.version + 1
    assert switched.checkout_mode == "explicit_worktree"
    assert switched.target_ref == "refs/heads/feature"
    with pytest.raises(OptimisticConcurrencyError, match="binding changed"):
        journal.update_project_workspace_binding(
            project_id="project-1",
            expected_version=original.version,
            checkout_id="checkout-other",
            checkout_mode="explicit_worktree",
            target_ref="refs/heads/other",
            worktree_path="/tmp/other",
        )


def test_workspace_writer_queue_serializes_one_checkout_and_not_another(
    journal,
):
    _put_content_repository(journal)

    first = journal.enqueue_workspace_writer(
        request_id="writer-1",
        repository_id="repo-1",
        checkout_id="checkout-primary",
        task_id="task-1",
        project_id="project-1",
        target_ref="refs/heads/main",
        reason="filesystem.write",
        now=10,
    )
    second = journal.enqueue_workspace_writer(
        request_id="writer-2",
        repository_id="repo-1",
        checkout_id="checkout-primary",
        task_id="task-2",
        project_id="project-2",
        target_ref="refs/heads/main",
        reason="terminal.execute",
        now=11,
    )
    third = journal.enqueue_workspace_writer(
        request_id="writer-3",
        repository_id="repo-1",
        checkout_id="checkout-primary",
        task_id="task-3",
        project_id="project-3",
        target_ref="refs/heads/main",
        reason="skill.script.execute",
        now=12,
    )
    independent = journal.enqueue_workspace_writer(
        request_id="writer-4",
        repository_id="repo-1",
        checkout_id="checkout-explicit-worktree",
        task_id="task-4",
        project_id="project-4",
        target_ref="refs/heads/feature",
        reason="filesystem.write",
        now=13,
    )

    assert first.status == "acquired"
    assert (first.queue_position, first.blocker_task_id) == (None, None)
    assert (second.status, second.queue_position, second.blocker_task_id) == (
        "queued",
        1,
        "task-1",
    )
    assert (third.status, third.queue_position, third.blocker_task_id) == (
        "queued",
        2,
        "task-1",
    )
    assert independent.status == "acquired"

    replay = journal.enqueue_workspace_writer(
        request_id="writer-2",
        repository_id="repo-1",
        checkout_id="checkout-primary",
        task_id="task-2",
        project_id="project-2",
        target_ref="refs/heads/main",
        reason="terminal.execute",
        now=99,
    )
    assert replay == second

    released = journal.release_workspace_writer(
        request_id="writer-1",
        task_id="task-1",
        now=20,
    )
    assert released.finished.status == "released"
    assert released.next_acquired is not None
    assert released.next_acquired.task_id == "task-2"
    assert released.next_acquired.status == "acquired"

    waiting = journal.get_workspace_writer_request("writer-3")
    assert waiting is not None
    assert (waiting.queue_position, waiting.blocker_task_id) == (1, "task-2")
    lease = journal.get_workspace_writer_lease(
        repository_id="repo-1",
        checkout_id="checkout-primary",
    )
    assert lease is not None
    assert (lease.request_id, lease.task_id) == ("writer-2", "task-2")

    interrupted = journal.interrupt_workspace_writer(
        request_id="writer-3",
        task_id="task-3",
        now=21,
    )
    assert interrupted.finished.status == "interrupted"
    assert interrupted.next_acquired is None
    assert (
        journal.get_workspace_writer_lease(
            repository_id="repo-1",
            checkout_id="checkout-primary",
        )
        == lease
    )


def test_workspace_writer_queue_is_cross_connection_durable(tmp_path):
    path = tmp_path / "run-journal.sqlite3"
    with SQLiteRunJournal(path) as first:
        _put_content_repository(first)
        acquired = first.enqueue_workspace_writer(
            request_id="writer-1",
            repository_id="repo-1",
            checkout_id="checkout-primary",
            task_id="task-1",
            project_id="project-1",
            target_ref="refs/heads/main",
            reason="filesystem.write",
            now=10,
        )
        assert acquired.status == "acquired"

        with SQLiteRunJournal(path) as second:
            queued = second.enqueue_workspace_writer(
                request_id="writer-2",
                repository_id="repo-1",
                checkout_id="checkout-primary",
                task_id="task-2",
                project_id="project-2",
                target_ref="refs/heads/main",
                reason="filesystem.write",
                now=11,
            )
            assert (queued.status, queued.blocker_task_id) == (
                "queued",
                "task-1",
            )

    with SQLiteRunJournal(path) as reopened:
        lease = reopened.get_workspace_writer_lease(
            repository_id="repo-1",
            checkout_id="checkout-primary",
        )
        queued = reopened.get_workspace_writer_request("writer-2")
        assert lease is not None and lease.task_id == "task-1"
        assert queued is not None
        assert (queued.queue_position, queued.blocker_task_id) == (1, "task-1")


def test_workspace_writer_request_rejects_identity_reuse(journal):
    _put_content_repository(journal)
    journal.enqueue_workspace_writer(
        request_id="writer-1",
        repository_id="repo-1",
        checkout_id="checkout-primary",
        task_id="task-1",
        project_id="project-1",
        target_ref="refs/heads/main",
        reason="filesystem.write",
    )

    with pytest.raises(IdempotencyConflictError, match="was reused"):
        journal.enqueue_workspace_writer(
            request_id="writer-1",
            repository_id="repo-1",
            checkout_id="checkout-primary",
            task_id="task-other",
            project_id="project-1",
            target_ref="refs/heads/main",
            reason="filesystem.write",
        )
    with pytest.raises(InvalidRunTransitionError, match="owning Task"):
        journal.release_workspace_writer(
            request_id="writer-1",
            task_id="task-other",
        )


def _persist_environment_spec(journal, *, owner_id: str = "run-1"):
    manifest = parse_workspace_manifest(
        """
apiVersion: eigent.ai/v1alpha1
kind: WorkspaceBundle
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
    manifest = parse_workspace_manifest(
        """
apiVersion: eigent.ai/v1alpha1
kind: WorkspaceBundle
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


def test_workspace_config_draft_autosave_uses_version_cas(journal):
    document = {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkspaceBundle",
        "metadata": {
            "id": "bundle_working_copy",
            "name": "Working copy",
            "revision": 1,
        },
        "spec": {
            "models": {
                "default": {
                    "modelRef": "provider://default",
                    "thinkingEffort": "medium",
                }
            }
        },
    }

    created = journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=0,
        document=document,
        updated_by="user-1",
        now=10,
    )
    updated_document = {
        **document,
        "metadata": {**document["metadata"], "name": "Renamed"},
    }
    updated = journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=1,
        document=updated_document,
        updated_by="user-1",
        now=11,
    )

    assert created.version == 1
    assert updated.version == 2
    assert updated.document["metadata"]["name"] == "Renamed"
    assert journal.get_workspace_config_draft("space-1") == updated
    with pytest.raises(OptimisticConcurrencyError):
        journal.put_workspace_config_draft(
            space_id="space-1",
            expected_version=1,
            document=document,
            updated_by="user-1",
        )


def test_workspace_config_draft_cannot_change_its_base_revision(journal):
    revision, _, _ = _persist_environment_spec(journal)
    document = revision.manifest
    journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=0,
        base_revision_id=revision.revision_id,
        document=document,
        updated_by="user-1",
    )

    with pytest.raises(IdempotencyConflictError, match="base revision"):
        journal.put_workspace_config_draft(
            space_id="space-1",
            expected_version=1,
            base_revision_id=None,
            document=document,
            updated_by="user-1",
        )


def test_workspace_config_publish_is_atomic_and_idempotently_advances_draft(
    journal,
):
    document = {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkspaceBundle",
        "metadata": {
            "id": "bundle_publish",
            "name": "Publish",
            "revision": 1,
        },
        "spec": {
            "models": {
                "default": {
                    "modelRef": "provider://default",
                    "thinkingEffort": "medium",
                }
            }
        },
    }
    draft = journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=0,
        document=document,
        updated_by="user-1",
    )

    revision, next_draft = journal.finalize_workspace_config_publish(
        space_id="space-1",
        expected_draft_version=draft.version,
        revision_id="wbr_11111111111111111111111111111111",
        manifest_digest=draft.document_digest,
        published_manifest=document,
        actor_id="user-1",
        now=20,
    )
    replay = journal.finalize_workspace_config_publish(
        space_id="space-1",
        expected_draft_version=draft.version,
        revision_id="wbr_11111111111111111111111111111111",
        manifest_digest=draft.document_digest,
        published_manifest=document,
        actor_id="user-1",
        now=21,
    )

    assert revision.status == "published"
    assert next_draft.version == 2
    assert (
        next_draft.base_revision_id == "wbr_11111111111111111111111111111111"
    )
    assert next_draft.document["metadata"]["revision"] == 2
    assert replay[1] == next_draft
    assert (
        journal.get_latest_workspace_config_materialization("space-1") is None
    )


def test_workspace_config_publish_rejects_same_digest_wrong_revision_identity(
    journal,
):
    document = {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkspaceBundle",
        "metadata": {
            "id": "bundle_publish",
            "name": "Publish",
            "revision": 1,
        },
        "spec": {
            "models": {
                "default": {
                    "modelRef": "provider://default",
                    "thinkingEffort": "medium",
                }
            }
        },
    }
    draft = journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=0,
        document=document,
        updated_by="user-1",
    )
    journal.put_workspace_config_revision(
        revision_id="wbr_11111111111111111111111111111111",
        bundle_id="other_bundle",
        revision_number=7,
        manifest=document,
        status="published",
        created_by="user-1",
    )

    with pytest.raises(IdempotencyConflictError, match="conflicts"):
        journal.finalize_workspace_config_publish(
            space_id="space-1",
            expected_draft_version=draft.version,
            revision_id="wbr_11111111111111111111111111111111",
            manifest_digest=draft.document_digest,
            published_manifest=document,
            actor_id="user-1",
        )

    assert journal.get_workspace_config_draft("space-1") == draft
    assert (
        journal.get_latest_workspace_config_materialization("space-1") is None
    )


def test_workspace_config_publish_rebases_concurrent_edit_to_next_revision(
    journal,
):
    published_document = {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkspaceBundle",
        "metadata": {
            "id": "bundle_publish",
            "name": "Published A",
            "revision": 1,
        },
        "spec": {
            "models": {
                "default": {
                    "modelRef": "provider://default",
                    "thinkingEffort": "medium",
                }
            }
        },
    }
    original = journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=0,
        document=published_document,
        updated_by="user-1",
    )
    edited_document = json.loads(json.dumps(published_document))
    edited_document["metadata"]["name"] = "Concurrent B"
    edited = journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=original.version,
        document=edited_document,
        updated_by="user-2",
    )

    revision, rebased = journal.finalize_workspace_config_publish(
        space_id="space-1",
        expected_draft_version=original.version,
        revision_id="wbr_11111111111111111111111111111111",
        manifest_digest=original.document_digest,
        published_manifest=published_document,
        actor_id="user-1",
    )

    assert revision.manifest["metadata"]["name"] == "Published A"
    assert rebased.version == edited.version + 1
    assert rebased.base_revision_id == "wbr_11111111111111111111111111111111"
    assert rebased.document["metadata"] == {
        "id": "bundle_publish",
        "name": "Concurrent B",
        "revision": 2,
    }


def test_workspace_config_publish_mismatch_rolls_back_every_local_fact(
    journal,
):
    document = {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkspaceBundle",
        "metadata": {
            "id": "bundle_publish",
            "name": "Publish",
            "revision": 1,
        },
        "spec": {
            "models": {
                "default": {
                    "modelRef": "provider://default",
                    "thinkingEffort": "medium",
                }
            }
        },
    }
    draft = journal.put_workspace_config_draft(
        space_id="space-1",
        expected_version=0,
        document=document,
        updated_by="user-1",
    )

    with pytest.raises(IdempotencyConflictError, match="does not match"):
        journal.finalize_workspace_config_publish(
            space_id="space-1",
            expected_draft_version=draft.version,
            revision_id="wbr_11111111111111111111111111111111",
            manifest_digest="f" * 64,
            published_manifest=document,
            actor_id="user-1",
        )

    assert (
        journal.get_workspace_config_revision(
            "wbr_11111111111111111111111111111111"
        )
        is None
    )
    assert journal.get_workspace_config_draft("space-1") == draft
    assert (
        journal.get_latest_workspace_config_materialization("space-1") is None
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


def test_pending_resume_can_bind_legacy_environment_backfill_once(journal):
    _, spec, _ = _persist_environment_spec(journal)
    journal.ensure_run(
        run_id="run-1",
        project_id="project-1",
        status="interrupted",
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="resume-upgrade-1",
        reason="explicit_resume",
        attempt_id="attempt-upgrade-1",
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

    bound = journal.bind_pending_attempt_environment(
        attempt.attempt_id,
        run_id="run-1",
        request_id="resume-upgrade-1",
        environment=environment,
        now=3,
    )
    replay = journal.bind_pending_attempt_environment(
        attempt.attempt_id,
        run_id="run-1",
        request_id="resume-upgrade-1",
        environment=environment,
        now=4,
    )

    assert replay == bound
    assert bound.environment_spec_id == spec.spec_id
    events = journal.list_events("run-1")
    assert [event.event_type for event in events] == [
        "run.attempt_created",
        "run.attempt_environment_bound",
    ]
    assert events[-1].payload["reason"] == "legacy_environment_backfill"

    with pytest.raises(
        IdempotencyConflictError, match="different environment"
    ):
        journal.bind_pending_attempt_environment(
            attempt.attempt_id,
            run_id="run-1",
            request_id="resume-upgrade-1",
            environment=AttemptEnvironmentBinding(
                **{
                    **environment.__dict__,
                    "environment_spec_digest": "different",
                }
            ),
        )


def test_legacy_environment_backfill_never_mutates_running_attempt(journal):
    _, spec, _ = _persist_environment_spec(journal)
    journal.ensure_run(run_id="run-1", project_id="project-1")
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="running-attempt",
        reason="initial_execution",
        activate=True,
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

    with pytest.raises(
        InvalidRunTransitionError, match="only a pending Attempt"
    ):
        journal.bind_pending_attempt_environment(
            attempt.attempt_id,
            run_id="run-1",
            request_id="running-attempt",
            environment=environment,
        )

    assert journal.get_run_attempt(attempt.attempt_id) == attempt


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


def test_cloud_bootstrap_accepts_redacted_projection_of_local_approval(
    journal,
):
    journal.ensure_run(run_id="run-local", project_id="project-local")
    payload = {
        "approval_id": "approval-1",
        "prompt": {
            "action": {
                "operation": "filesystem.write",
                "normalized_arguments": {
                    "path": "/Users/alice/private/report.md",
                    "content": "private contents",
                },
                "target_resources": ["/Users/alice/private/report.md"],
            },
            "target_resources": ["/Users/alice/private/report.md"],
        },
    }
    local = journal.append_event(
        "run-local",
        RunEventDraft(
            event_id="approval-1-requested",
            event_type="approval.requested",
            payload=payload,
            created_at=10.0,
        ),
    )
    replica = CloudRunEventReplica(
        event_id=local.event_id,
        project_id="project-local",
        run_id="run-local",
        run_sequence=local.sequence,
        run_version=local.run_version,
        cloud_cursor=1,
        event_type=local.event_type,
        payload=cloud_event_payload(local.event_type, payload),
        legacy_step=None,
        created_at=local.created_at,
    )

    assert (
        journal.import_cloud_project_page(
            project_id="project-local",
            after_cursor=0,
            next_cursor=1,
            events=[replica],
        )
        == 1
    )
    assert journal.list_events("run-local")[0].payload == payload


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


def test_v31_database_adds_workspace_binding_and_writer_queue_without_losing_runs(
    tmp_path,
):
    path = tmp_path / "run-journal.sqlite3"
    with SQLiteRunJournal(path) as current:
        current.ensure_run(run_id="run-1", project_id="project-1")

    with sqlite3.connect(path) as connection:
        connection.execute("DROP TABLE workspace_writer_leases")
        connection.execute("DROP TABLE workspace_writer_requests")
        connection.execute("DROP TABLE project_workspace_bindings")
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 32"
        )
        connection.execute("PRAGMA user_version = 31")

    with SQLiteRunJournal(path) as upgraded:
        assert upgraded.schema_version == SCHEMA_VERSION
        assert upgraded.get_run("run-1") is not None
        tables = {
            row[0]
            for row in upgraded._connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        assert {
            "project_workspace_bindings",
            "workspace_writer_requests",
            "workspace_writer_leases",
        } <= tables


def test_v28_database_adds_memory_review_without_losing_interaction_children(
    tmp_path,
):
    path = tmp_path / "run-journal.sqlite3"
    with SQLiteRunJournal(path) as current:
        current.ensure_run(run_id="run-1", project_id="project-1", now=1)
        attempt = current.create_run_attempt(
            "run-1",
            request_id="initial",
            reason="initial_execution",
            activate=True,
            now=2,
        )
        current.create_human_interaction(
            interaction_id="question-1",
            run_id="run-1",
            attempt_id=attempt.attempt_id,
            interaction_type="question",
            request={"question": "Continue?"},
            response_schema={"type": "boolean"},
            requested_by="agent:test",
            now=3,
        )
        current.resolve_human_interaction(
            "question-1",
            decision_request_id="decision-1",
            decision={"value": True},
            expected_version=0,
            expected_run_id="run-1",
            continue_active_attempt=True,
            now=4,
        )

    with sqlite3.connect(path) as connection:
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 29"
        )
        connection.execute("PRAGMA user_version = 28")

    with SQLiteRunJournal(path) as upgraded:
        interaction = upgraded.get_human_interaction("question-1")
        decisions = upgraded.list_human_interaction_decisions("question-1")

        assert upgraded.schema_version == SCHEMA_VERSION
        assert interaction is not None
        assert interaction.status == "resolved"
        assert [decision.decision_request_id for decision in decisions] == [
            "decision-1"
        ]
        assert (
            upgraded._connection.execute("PRAGMA foreign_key_check").fetchall()
            == []
        )


def test_v17_database_adds_agent_plugin_import_tables_without_losing_draft(
    tmp_path,
):
    path = tmp_path / "run-journal.sqlite3"
    document = {
        "apiVersion": "eigent.ai/v1alpha1",
        "kind": "WorkspaceBundle",
        "metadata": {
            "id": "bundle_existing",
            "name": "Existing",
            "revision": 1,
        },
        "spec": {},
    }
    with SQLiteRunJournal(path) as current:
        current.put_workspace_config_draft(
            space_id="space-1",
            expected_version=0,
            document=document,
            updated_by="user-1",
        )

    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("DROP TABLE workspace_agent_plugin_import_requests")
        connection.execute("DROP TABLE workspace_config_draft_assets")
        connection.execute("DROP TABLE workspace_config_draft_asset_blobs")
        connection.execute(
            "DELETE FROM run_journal_migrations WHERE version = 18"
        )
        connection.execute("PRAGMA user_version = 17")

    with SQLiteRunJournal(path) as upgraded:
        draft = upgraded.get_workspace_config_draft("space-1")
        assert upgraded.schema_version == SCHEMA_VERSION
        assert draft is not None
        assert draft.document == document
        assert (
            upgraded.list_workspace_config_draft_assets(
                space_id="space-1",
                draft_version=draft.version,
            )
            == ()
        )


def test_bundle_secret_bindings_persist_only_opaque_refs_and_replay_requests(
    tmp_path,
):
    path = tmp_path / "run-journal.sqlite3"
    sentinel = "raw-secret-must-never-enter-journal"
    with SQLiteRunJournal(path) as journal:
        proposal = journal.put_workspace_bundle_install_proposal(
            proposal_id="proposal-1",
            request_id="proposal-request-1",
            space_id="space-1",
            bundle_id="bundle-1",
            revision_id="bundle-1@1",
            config_placement="sidecar",
            manifest={"spec": {}},
            assets=[],
            install_plan={},
        )
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="approved",
            decided_by="user-1",
        )
        first_ref = f"wsvault_{'A' * 32}"
        second_ref = f"wsvault_{'B' * 32}"
        bindings = [
            {
                "requirement_key": "environment:API_TOKEN",
                "requirement_kind": "environment",
                "secret_ref": first_ref,
                "account_scope_digest": "a" * 64,
            }
        ]
        stored, advanced = journal.put_workspace_bundle_secret_bindings(
            proposal_id=proposal.proposal_id,
            client_request_id="bind-request-1",
            expected_proposal_version=proposal.version,
            bindings=bindings,
            authorized_by="user-1",
        )
        replay, replay_proposal = journal.put_workspace_bundle_secret_bindings(
            proposal_id=proposal.proposal_id,
            client_request_id="bind-request-1",
            expected_proposal_version=proposal.version,
            bindings=bindings,
            authorized_by="user-1",
        )

        assert replay == stored
        assert replay_proposal == advanced
        assert stored[0].secret_ref == first_ref
        assert stored[0].binding_version == 1
        with pytest.raises(IdempotencyConflictError):
            journal.put_workspace_bundle_secret_bindings(
                proposal_id=proposal.proposal_id,
                client_request_id="bind-request-1",
                expected_proposal_version=advanced.version,
                bindings=[
                    {
                        **bindings[0],
                        "secret_ref": f"wsvault_{'C' * 32}",
                    }
                ],
                authorized_by="user-1",
            )

        replaced, replaced_proposal = (
            journal.put_workspace_bundle_secret_bindings(
                proposal_id=proposal.proposal_id,
                client_request_id="bind-request-2",
                expected_proposal_version=advanced.version,
                bindings=[
                    {
                        **bindings[0],
                        "secret_ref": second_ref,
                        "expected_binding_version": 1,
                    }
                ],
                authorized_by="user-1",
            )
        )
        assert replaced[0].binding_version == 2
        assert replaced[0].secret_ref == second_ref
        assert replaced_proposal.version == advanced.version + 1
        with pytest.raises(OptimisticConcurrencyError):
            journal.put_workspace_bundle_secret_bindings(
                proposal_id=proposal.proposal_id,
                client_request_id="bind-request-stale",
                expected_proposal_version=replaced_proposal.version,
                bindings=[
                    {
                        **bindings[0],
                        "secret_ref": f"wsvault_{'D' * 32}",
                        "expected_binding_version": 1,
                    }
                ],
                authorized_by="user-1",
            )

    database_bytes = path.read_bytes()
    wal = path.with_name(path.name + "-wal")
    if wal.exists():
        database_bytes += wal.read_bytes()
    assert sentinel.encode() not in database_bytes


def test_materialized_bundle_bindings_can_be_reconfigured_with_cas(tmp_path):
    with SQLiteRunJournal(tmp_path / "run-journal.sqlite3") as journal:
        proposal = journal.put_workspace_bundle_install_proposal(
            proposal_id="proposal-installed",
            request_id="proposal-installed-request",
            space_id="space-1",
            bundle_id="bundle-1",
            revision_id="bundle-1@1",
            config_placement="sidecar",
            manifest={"spec": {}},
            assets=[],
            install_plan={},
        )
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="approved",
            decided_by="user-1",
        )
        _, proposal = journal.put_workspace_bundle_local_binding(
            proposal_id=proposal.proposal_id,
            expected_proposal_version=proposal.version,
            slot_id="docs",
            binding_kind="local_path",
            connector_id=None,
            opaque_connection_id=None,
            local_path="/first/docs",
            required_grants=[],
            authorized_by="user-1",
        )
        secret_bindings, proposal = (
            journal.put_workspace_bundle_secret_bindings(
                proposal_id=proposal.proposal_id,
                client_request_id="secret-first",
                expected_proposal_version=proposal.version,
                bindings=[
                    {
                        "requirement_key": "environment:API_TOKEN",
                        "requirement_kind": "environment",
                        "secret_ref": f"wsvault_{'A' * 32}",
                        "account_scope_digest": "a" * 64,
                    }
                ],
                authorized_by="user-1",
            )
        )
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="materializing",
        )
        proposal = journal.transition_workspace_bundle_install_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            state="materialized",
        )

        rebound_path, proposal = journal.put_workspace_bundle_local_binding(
            proposal_id=proposal.proposal_id,
            expected_proposal_version=proposal.version,
            slot_id="docs",
            binding_kind="local_path",
            connector_id=None,
            opaque_connection_id=None,
            local_path="/replacement/docs",
            required_grants=[],
            authorized_by="user-2",
        )
        rebound_secret, proposal = (
            journal.put_workspace_bundle_secret_bindings(
                proposal_id=proposal.proposal_id,
                client_request_id="secret-replacement",
                expected_proposal_version=proposal.version,
                bindings=[
                    {
                        "requirement_key": "environment:API_TOKEN",
                        "requirement_kind": "environment",
                        "secret_ref": f"wsvault_{'B' * 32}",
                        "account_scope_digest": "a" * 64,
                        "expected_binding_version": secret_bindings[
                            0
                        ].binding_version,
                    }
                ],
                authorized_by="user-2",
            )
        )

        assert proposal.state == "needs_attention"
        assert proposal.error_code == "bundle_reconfiguration_pending"
        assert rebound_path.local_path == "/replacement/docs"
        assert rebound_path.authorized_by == "user-2"
        assert rebound_secret[0].binding_version == 2
        assert rebound_secret[0].secret_ref == f"wsvault_{'B' * 32}"


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


def test_outbox_event_ids_remain_parameter_bound(journal):
    adversarial_event_id = "event-1') OR 1=1 --"
    journal.ensure_run(run_id="run-1", project_id="project-1", now=1)
    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id=adversarial_event_id,
            event_type="message.created",
            payload={},
            created_at=1,
        ),
    )

    batch = journal.claim_ready_outbox_batches(now=2)[0]

    assert [event.event_id for event in batch.events] == [adversarial_event_id]
    journal.mark_outbox_batch_sent(batch, now=3)
    assert journal.list_pending_outbox(now=4) == []


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
    assert committed.event_type == "agent.started"
    assert committed.payload["semantic_schema_version"] == 1
    assert committed.payload["semantic"] == {
        "kind": "agent_turn",
        "subject": {"type": "agent_turn", "id": ""},
        "actor": {"type": "agent"},
        "lifecycle": {"phase": "started", "status": "running"},
        "completeness": {
            "state": "partial",
            "missing_fields": [
                "correlation.agent_turn_id",
                "subject.id",
            ],
        },
        "provenance": {"source": "legacy.activate_agent"},
    }
    assert journal.list_pending_outbox(now=10.0)[0].event_id == "event-1"


@pytest.mark.asyncio
async def test_event_recorder_correlates_legacy_facts_to_running_step(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    coordinator = RunStepCoordinator(journal)
    coordinator.reconcile_plan(
        project_id="project-1",
        run_id="run-1",
        agent_id="agent-1",
        items=[
            PlanStepInput(
                plan_item_id="pli-1",
                title="Inspect files",
                active_form="Inspecting files",
                status="in_progress",
                ordinal=1,
            )
        ],
    )
    step_id = coordinator.current_running_step_id("run-1")

    committed = await EventRecorder(journal).record_legacy_step(
        project_id="project-1",
        run_id="run-1",
        step="write_file",
        data={"relative_path": "report.md"},
    )

    assert committed.payload["step_id"] == step_id
    assert committed.payload["semantic"]["correlation"]["step_id"] == step_id


@pytest.mark.asyncio
async def test_event_recorder_projects_workforce_subtask_lifecycle_to_step(
    journal,
):
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    recorder = EventRecorder(journal)

    await recorder.record_legacy_step(
        project_id="project-1",
        run_id="run-1",
        step="assign_task",
        data={
            "task_id": "run-1.1",
            "assignee_id": "worker-1",
            "content": "Inspect the generated report",
            "state": "RUNNING",
        },
    )

    coordinator = RunStepCoordinator(journal)
    steps = list(coordinator.replay("run-1").values())
    assert len(steps) == 1
    assert steps[0].status == "running"
    assert steps[0].agent_id == "worker-1"
    assert steps[0].owner_kind == "workforce"
    assert steps[0].source == "workforce"
    assert (
        coordinator.current_running_step_id("run-1", agent_id="worker-1")
        == steps[0].step_id
    )

    # Workforce can emit a stale queued projection after started; it must not
    # move the durable Step backwards.
    await recorder.record_legacy_step(
        project_id="project-1",
        run_id="run-1",
        step="assign_task",
        data={
            "task_id": "run-1.1",
            "assignee_id": "worker-1",
            "content": "Inspect the generated report",
            "state": "OPEN",
        },
    )
    assert coordinator.replay("run-1")[steps[0].step_id].status == "running"

    await recorder.record_legacy_step(
        project_id="project-1",
        run_id="run-1",
        step="task_state",
        data={
            "task_id": "run-1.1",
            "content": "Inspect the generated report",
            "state": "DONE",
        },
    )
    assert coordinator.replay("run-1")[steps[0].step_id].status == (
        "completed"
    )


@pytest.mark.asyncio
async def test_workforce_subtask_never_inherits_running_sibling_step(journal):
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    coordinator = RunStepCoordinator(journal)
    first_step_id = coordinator.create_child_step(
        project_id="project-1",
        run_id="run-1",
        parent_step_id=None,
        task_identity="task-one",
        title="First task",
        agent_id="worker-1",
        start=True,
    )

    committed = await EventRecorder(journal).record_legacy_step(
        project_id="project-1",
        run_id="run-1",
        step="assign_task",
        data={
            "task_id": "task-two",
            "assignee_id": "worker-2",
            "content": "Second task",
            "state": "OPEN",
        },
    )

    second_step_id = stable_step_id("run-1", "subtask:task-two")
    assert committed.payload["step_id"] == second_step_id
    assert committed.payload["step_id"] != first_step_id
    steps = coordinator.replay("run-1")
    assert steps[first_step_id].status == "running"
    assert steps[second_step_id].status == "pending"


@pytest.mark.asyncio
async def test_workforce_projection_failure_commits_fact_and_durable_gap(
    journal,
):
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    original = journal._append_event_in_transaction

    def fail_step_projection(connection, run_id, draft, **kwargs):
        if draft.event_type.startswith("step."):
            raise RuntimeError("step projection failed")
        return original(connection, run_id, draft, **kwargs)

    with patch.object(
        journal,
        "_append_event_in_transaction",
        side_effect=fail_step_projection,
    ):
        committed = await EventRecorder(journal).record_legacy_step(
            project_id="project-1",
            run_id="run-1",
            step="assign_task",
            data={
                "task_id": "task-one",
                "assignee_id": "worker-1",
                "content": "First task",
                "state": "OPEN",
            },
        )

    events = journal.list_events("run-1")
    assert committed.event_type == "subtask.queued"
    assert events[-2].event_id == committed.event_id
    assert events[-1].event_type == "projection.workforce_step_failed"
    assert events[-1].payload["source_event_id"] == committed.event_id
    assert events[-1].payload["error_type"] == "RuntimeError"
    assert RunStepCoordinator(journal).replay("run-1") == {}


def test_workforce_producer_transition_is_idempotent_and_single_transaction(
    journal,
):
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )

    first = journal.persist_workforce_subtask_step(
        run_id="run-1",
        expected_project_id="project-1",
        task_id="task-one",
        title="First task",
        agent_id="worker-1",
        phase="running",
    )
    replay = journal.persist_workforce_subtask_step(
        run_id="run-1",
        expected_project_id="project-1",
        task_id="task-one",
        title="First task",
        agent_id="worker-1",
        phase="running",
    )

    assert replay == first
    step_events = journal.list_events("run-1", event_type_prefix="step.")
    assert [event.event_type for event in step_events] == [
        "step.created",
        "step.started",
    ]


def test_workforce_terminal_without_precursor_does_not_invent_step(journal):
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )

    step_id = journal.persist_workforce_subtask_step(
        run_id="run-1",
        expected_project_id="project-1",
        task_id="task-one",
        title="First task",
        agent_id="worker-1",
        phase="completed",
    )

    assert step_id == stable_step_id("run-1", "subtask:task-one")
    assert journal.list_events("run-1", event_type_prefix="step.") == []


def test_run_terminal_preserves_workforce_step_ownership(journal):
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
        activate=True,
    )
    step_id = journal.persist_workforce_subtask_step(
        run_id="run-1",
        expected_project_id="project-1",
        task_id="task-one",
        title="First task",
        agent_id="worker-1",
        phase="running",
    )

    journal.append_event(
        "run-1",
        RunEventDraft(
            event_id="run-failed:run-1",
            event_type="run.failed",
            payload={"reason": "test_failure"},
        ),
        expected_project_id="project-1",
    )

    step = RunStepCoordinator(journal).replay("run-1")[step_id]
    assert step.status == "failed"
    assert step.owner_kind == "workforce"
    assert step.source == "workforce"


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
async def test_legacy_end_requires_trusted_stream_but_cannot_terminalize_run(
    journal,
):
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
    assert journal.get_run("run-1").status == "running"


@pytest.mark.asyncio
async def test_event_recorder_rejects_standalone_assistant_final(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    recorder = EventRecorder(journal)

    with pytest.raises(RuntimeError, match="committed atomically"):
        await recorder.record_assistant_final(
            project_id="project-1",
            run_id="run-1",
            data={"message": "must not be written alone"},
        )

    assert journal.list_events("run-1") == []


def _test_artifact_manifest(journal, run_id: str):
    return journal.append_artifact_manifest_events(
        run_id,
        [
            RunEventDraft(
                event_id=f"artifact-manifest:{run_id}:test",
                event_type="artifact.manifest.finalized",
                payload={
                    "artifacts": [],
                    "artifact_count": 0,
                    "scan_status": "complete",
                },
            )
        ],
        expected_project_id="project-1",
    )


def test_successful_completion_rejects_unknown_tool_outcome(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.checkpoint_tool_call(
        tool_call_id="tool-1",
        run_id="run-1",
        attempt_id=None,
        tool_name="send_email",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
        status="prepared",
        request={"to": "user@example.com"},
        now=1,
    )
    journal.checkpoint_tool_call(
        tool_call_id="tool-1",
        run_id="run-1",
        attempt_id=None,
        tool_name="send_email",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
        status="dispatched",
        request={"to": "user@example.com"},
        now=2,
    )
    manifest = _test_artifact_manifest(journal, "run-1")

    with pytest.raises(
        InvalidRunTransitionError,
        match="unresolved Tool outcome",
    ):
        journal.complete_successful_run(
            "run-1",
            assistant_final=RunEventDraft(
                event_id="assistant-final:run-1",
                event_type="assistant.final",
                payload={"message": "Done"},
            ),
            terminal=RunEventDraft(
                event_id="run-completed:run-1",
                event_type="run.completed",
                payload={"reason": "success"},
            ),
            artifact_manifest=manifest,
            expected_project_id="project-1",
        )

    event_types = [event.event_type for event in journal.list_events("run-1")]
    assert "assistant.final" not in event_types
    assert "run.completed" not in event_types


def test_successful_completion_allows_replayable_tool_timeout(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.checkpoint_tool_call(
        tool_call_id="tool-1",
        run_id="run-1",
        attempt_id=None,
        tool_name="read_page",
        safety_class=ToolSafetyClass.SAFE_READ,
        status="prepared",
        request={"url": "https://example.com"},
        now=1,
    )
    journal.checkpoint_tool_call(
        tool_call_id="tool-1",
        run_id="run-1",
        attempt_id=None,
        tool_name="read_page",
        safety_class=ToolSafetyClass.SAFE_READ,
        status="dispatched",
        request={"url": "https://example.com"},
        now=2,
    )
    journal.record_timeout_outcome(
        TimeoutOutcome(
            scope=TimeoutScope.TOOL,
            policy_version="v1",
            reason="brain_restart_after_dispatch",
            started_at=2,
            ended_at=3,
            run_id="run-1",
            tool_call_id="tool-1",
        )
    )
    manifest = _test_artifact_manifest(journal, "run-1")

    result, terminal = journal.complete_successful_run(
        "run-1",
        assistant_final=RunEventDraft(
            event_id="assistant-final:run-1",
            event_type="assistant.final",
            payload={"message": "Done without unsafe side effects"},
        ),
        terminal=RunEventDraft(
            event_id="run-completed:run-1",
            event_type="run.completed",
            payload={"reason": "success"},
        ),
        artifact_manifest=manifest,
        expected_project_id="project-1",
    )

    assert result.event_type == "assistant.final"
    assert terminal.event_type == "run.completed"
    assert journal.get_run("run-1").status == "completed"


def test_successful_completion_allows_legacy_safe_read_outcome_unknown(
    journal,
):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    values = dict(
        tool_call_id="tool-1",
        run_id="run-1",
        attempt_id=None,
        tool_name="read_page",
        safety_class=ToolSafetyClass.SAFE_READ,
        request={"url": "https://example.com"},
    )
    journal.checkpoint_tool_call(status="prepared", now=1, **values)
    journal.checkpoint_tool_call(status="dispatched", now=2, **values)
    journal.checkpoint_tool_call(
        status="outcome_unknown",
        outcome="outcome_unknown",
        timeout_reason="legacy_brain_restart_after_dispatch",
        now=3,
        **values,
    )
    manifest = _test_artifact_manifest(journal, "run-1")

    _, terminal = journal.complete_successful_run(
        "run-1",
        assistant_final=RunEventDraft(
            event_id="assistant-final:run-1",
            event_type="assistant.final",
            payload={"message": "Done after a safe Resume"},
        ),
        terminal=RunEventDraft(
            event_id="run-completed:run-1",
            event_type="run.completed",
            payload={"reason": "success"},
        ),
        artifact_manifest=manifest,
        expected_project_id="project-1",
    )

    assert terminal.event_type == "run.completed"
    assert journal.get_run("run-1").status == "completed"


def test_successful_completion_closes_unfinalized_model_capture_with_gap(
    journal,
):
    journal.ensure_run(
        run_id="run-1", project_id="project-1", status="pending"
    )
    attempt = journal.create_run_attempt(
        "run-1",
        request_id="initial",
        reason="initial_execution",
    )
    journal.start_model_invocation(
        invocation_id="model-1",
        run_id="run-1",
        attempt_id=attempt.attempt_id,
        agent_id="agent-1",
        logical_call_id="logical-1",
        provider="openai",
        model="gpt-test",
        transport="responses",
        thinking_effort=None,
        request={"messages": []},
        now=1,
    )
    manifest = _test_artifact_manifest(journal, "run-1")

    journal.complete_successful_run(
        "run-1",
        assistant_final=RunEventDraft(
            event_id="assistant-final:run-1",
            event_type="assistant.final",
            payload={"message": "Done"},
            created_at=3,
        ),
        terminal=RunEventDraft(
            event_id="run-completed:run-1",
            event_type="run.completed",
            payload={"reason": "success"},
            created_at=3,
        ),
        artifact_manifest=manifest,
        expected_project_id="project-1",
    )

    invocation = journal.get_model_invocation("model-1")
    assert invocation is not None
    assert invocation.status == "outcome_unknown"
    assert invocation.completed_at == 3
    gaps = journal.list_attempt_evidence_gaps(attempt.attempt_id)
    assert len(gaps) == 1
    assert gaps[0].dimension == "model_decisions"
    assert gaps[0].reason_code == "outcome_unknown"
    event_types = [event.event_type for event in journal.list_events("run-1")]
    assert "model.invocation.outcome_unknown" in event_types
    assert "attempt.evidence_gap_recorded" in event_types


def test_cancel_marks_dispatched_tool_outcome_unknown_before_terminal(journal):
    journal.ensure_run(run_id="run-1", project_id="project-1")
    journal.checkpoint_tool_call(
        tool_call_id="tool-1",
        run_id="run-1",
        attempt_id=None,
        tool_name="send_email",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
        status="prepared",
        request={"to": "user@example.com"},
        now=1,
    )
    journal.checkpoint_tool_call(
        tool_call_id="tool-1",
        run_id="run-1",
        attempt_id=None,
        tool_name="send_email",
        safety_class=ToolSafetyClass.UNSAFE_WRITE,
        status="dispatched",
        request={"to": "user@example.com"},
        now=2,
    )
    journal.request_cancel(
        "run-1",
        request_id="cancel-1",
        reason="user_request",
        now=3,
    )

    cancelled = journal.complete_cancel(
        "run-1",
        request_id="cancel-1",
        now=4,
    )

    assert cancelled.status == "cancelled"
    assert journal.list_tool_calls("run-1")[0].status == "outcome_unknown"
    assert [event.event_type for event in journal.list_events("run-1")][
        -2:
    ] == [
        "tool.outcome_unknown",
        "run.cancelled",
    ]
