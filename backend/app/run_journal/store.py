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

"""SQLite implementation of the Desktop-owned RunJournal.

The store owns one connection and serializes every transaction with a process
lock. SQLite still provides the durable cross-process writer lock; the local
lock makes the intended single-writer boundary explicit when async callers use
``asyncio.to_thread``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import threading
import time
import uuid
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.run_journal.cloud_projection import cloud_event_payload
from app.run_journal.memory_policy import assert_memory_entry_policy
from app.run_journal.models import (
    ApprovalRecord,
    ApprovalRuleRecord,
    ArtifactUploadSyncItem,
    AttemptEnvironmentBinding,
    AttemptEvidenceGapRecord,
    CloudRunEventReplica,
    CloudRunReplica,
    CommandResultEvent,
    CommandResultSyncBatch,
    CommittedRunEvent,
    ContextProjectionDiagnosticRecord,
    ContinuationClaimRecord,
    EffectiveEnvironmentSpecRecord,
    FollowUpRequestRecord,
    GitAgentWorkspaceRecord,
    GitChangeSetItemRecord,
    GitChangeSetRecord,
    GitCheckpointRecord,
    GitMutationIntentRecord,
    GitOperationRecord,
    GitRepositoryRecord,
    HumanInteractionDecisionRecord,
    HumanInteractionOptionRecord,
    HumanInteractionRecord,
    MemoryEntryRecord,
    MemoryMutationRecord,
    MemoryMutationResult,
    MemoryMutationSyncBatch,
    MemoryMutationSyncItem,
    MemoryReconciliationRecord,
    MemoryScopeStateRecord,
    ModelDocumentRetentionResult,
    ModelInvocationEventRecord,
    ModelInvocationRecord,
    ProjectExecutionStateRecord,
    ProjectGitStateRecord,
    ProjectHistoryEventRecord,
    ProjectWorkspaceBindingRecord,
    RemoteCommandInboxRecord,
    RunAttemptRecord,
    RunEventDraft,
    RunEventSyncBatch,
    RunEventSyncOutboxRecord,
    RunGitMaterializationRecord,
    RunRecord,
    SecurityAuditEventRecord,
    SpacePermissionProfileRecord,
    SpacePermissionProfileRevisionRecord,
    StartupReconciliationResult,
    ToolCallRecord,
    WorkspaceBundleInstallProposalRecord,
    WorkspaceBundleLocalBindingRecord,
    WorkspaceBundleSecretBindingRecord,
    WorkspaceConfigDraftAssetDescriptorRecord,
    WorkspaceConfigDraftAssetRecord,
    WorkspaceConfigDraftRecord,
    WorkspaceConfigMaterializationRecord,
    WorkspaceConfigRevisionRecord,
    WorkspaceOverlayEntryRecord,
    WorkspaceReadSnapshotRecord,
    WorkspaceSnapshotRangeRecord,
    WorkspaceWriterLeaseRecord,
    WorkspaceWriterReleaseResult,
    WorkspaceWriterRequestRecord,
)
from app.run_journal.paths import default_run_journal_path
from app.run_journal.semantic_events import semantic_event_fields
from app.run_journal.transitions import (
    ATTEMPT_ACTIVE_STATES,
    ATTEMPT_TRANSITIONS,
    COMMAND_TRANSITIONS,
    RUN_TRANSITIONS,
    TOOL_TERMINAL_STATES,
    TOOL_TRANSITIONS,
    transition_allowed,
)
from app.run_policy import (
    RunTimeoutPolicy,
    TimeoutOutcome,
    TimeoutScope,
    ToolSafetyClass,
    automatic_tool_replay_allowed,
)
from app.workload import (
    DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
    PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS,
    RETENTION_POLICY_PRODUCT_DEFAULT,
    WorkloadProfileRecord,
    default_workload_profile,
    workload_profile_digest,
    workload_profile_from_payload,
    workload_profile_payload,
)
from app.workspace_config.models import (
    EffectiveEnvironmentSpec,
    ThinkingEffort,
    canonical_digest,
    canonical_json,
)

SCHEMA_VERSION = 34
logger = logging.getLogger("run_journal")
# Per redacted request or response. Oversized documents retain a bounded JSON
# prefix plus the byte count and digest of the full redacted projection.
_MODEL_INVOCATION_DOCUMENT_MAX_BYTES = 1024 * 1024


def _redact_model_document(key: str, value: dict[str, Any]) -> dict[str, Any]:
    # Import lazily: permission_policy.service depends on RunJournal, so an
    # eager package import here would create a module-initialization cycle.
    from app.permission_policy.models import redact_action_arguments

    projected = redact_action_arguments({key: value})[key]
    assert isinstance(projected, dict)
    return projected


def _project_model_document(
    key: str,
    value: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    """Redact and bound one model document before it reaches SQLite."""

    projected = _redact_model_document(key, value)
    encoded = canonical_json(projected)
    encoded_bytes = encoded.encode("utf-8")
    if len(encoded_bytes) <= _MODEL_INVOCATION_DOCUMENT_MAX_BYTES:
        return projected, encoded

    metadata = {
        "truncated": True,
        "kind": key,
        "original_bytes": len(encoded_bytes),
        "original_sha256": hashlib.sha256(encoded_bytes).hexdigest(),
    }
    low = 0
    # A stored prefix cannot contain more characters than the byte budget.
    # Keeping this upper bound independent of the source size prevents the
    # budget calculation itself from copying very large candidate strings.
    high = min(len(encoded), _MODEL_INVOCATION_DOCUMENT_MAX_BYTES)
    bounded: dict[str, Any] = {}
    bounded_json = ""
    while low <= high:
        midpoint = (low + high) // 2
        candidate = {
            "_eigent_capture": metadata,
            "json_prefix": encoded[:midpoint],
        }
        candidate_json = canonical_json(candidate)
        if (
            len(candidate_json.encode("utf-8"))
            <= _MODEL_INVOCATION_DOCUMENT_MAX_BYTES
        ):
            bounded = candidate
            bounded_json = candidate_json
            low = midpoint + 1
        else:
            high = midpoint - 1
    if not bounded_json:
        raise ValueError("model invocation document budget is too small")
    return bounded, bounded_json


_MEMORY_SCOPE_TYPES = {"project", "space", "user"}
_MEMORY_KINDS = {
    "fact",
    "decision",
    "constraint",
    "preference",
    "todo",
    "lesson",
}
_MEMORY_SOURCE_TRUST = {
    "user_confirmed",
    "user_asserted",
    "system_verified",
    "tool_observed",
    "external_untrusted",
    "model_inferred",
    "legacy_unverified",
}
_MEMORY_DEFAULT_TOKEN_LIMITS = {"project": 1024, "space": 640, "user": 384}

_EVIDENCE_DIMENSIONS = {
    "intent",
    "harness",
    "model_decisions",
    "tool_actions",
    "external_observations",
    "initial_environment",
    "checkpoints",
    "terminal_environment",
    "workspace_delta",
    "artifacts",
    "user_outcome",
    "verifier_result",
}
_EVIDENCE_GAP_REASON_CODES = {
    "capture_disabled",
    "capture_failed",
    "provider_capability_missing",
    "content_not_enabled",
    "redacted",
    "truncated_budget",
    "process_crashed",
    "outcome_unknown",
    "consent_missing",
    "reference_unresolvable",
    "retention_expired",
    "not_yet_implemented",
}
_DEFAULT_WORKLOAD_PROFILE_JSON = canonical_json(
    workload_profile_payload(DEFAULT_PRODUCTION_WORKLOAD_PROFILE)
)
_DEFAULT_WORKLOAD_PROFILE_DIGEST = workload_profile_digest(
    DEFAULT_PRODUCTION_WORKLOAD_PROFILE
)
_MODEL_DOCUMENT_RETENTION_MARKER = canonical_json(
    {
        "_eigent_retention": {
            "expired": True,
            "policy_ref": RETENTION_POLICY_PRODUCT_DEFAULT,
            "version": 1,
        }
    }
)

_MIGRATION_V1 = """
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS run_journal_migrations (
    version INTEGER PRIMARY KEY,
    applied_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN (
            'pending', 'running', 'waiting_for_user', 'interrupted',
            'completed', 'failed', 'cancelled'
        )
    ),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    active_attempt_id TEXT,
    deadline_at REAL,
    timeout_policy_version TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS runs_project_updated_idx
ON runs(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS run_attempts (
    attempt_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    status TEXT NOT NULL,
    started_at REAL NOT NULL,
    ended_at REAL,
    outcome TEXT,
    timeout_reason TEXT,
    UNIQUE(run_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS run_events (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    run_version INTEGER NOT NULL CHECK (run_version > 0),
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    legacy_step TEXT,
    created_at REAL NOT NULL,
    UNIQUE(run_id, sequence)
);

CREATE INDEX IF NOT EXISTS run_events_replay_idx
ON run_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS run_event_sync_outbox (
    event_id TEXT PRIMARY KEY REFERENCES run_events(event_id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    run_sequence INTEGER NOT NULL CHECK (run_sequence > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'sending', 'sent', 'dead_letter')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at REAL NOT NULL,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(run_id, run_sequence)
);

CREATE INDEX IF NOT EXISTS run_event_sync_pending_idx
ON run_event_sync_outbox(status, next_attempt_at, run_id, run_sequence);

CREATE TABLE IF NOT EXISTS tool_calls (
    tool_call_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_id TEXT REFERENCES run_attempts(attempt_id) ON DELETE SET NULL,
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL,
    safety_class TEXT NOT NULL,
    idempotency_key TEXT,
    outcome TEXT,
    timeout_reason TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS tool_calls_run_idx
ON tool_calls(run_id, created_at);

CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_id TEXT REFERENCES run_attempts(attempt_id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    prompt_json TEXT NOT NULL,
    decision_json TEXT,
    created_at REAL NOT NULL,
    resolved_at REAL
);

CREATE INDEX IF NOT EXISTS approvals_run_idx
ON approvals(run_id, created_at);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (1, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 1;
COMMIT;
"""

_MIGRATION_V2 = """
BEGIN IMMEDIATE;

ALTER TABLE run_event_sync_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE run_event_sync_outbox ADD COLUMN lease_until REAL;

DROP INDEX IF EXISTS run_event_sync_pending_idx;
CREATE INDEX run_event_sync_pending_idx
ON run_event_sync_outbox(
    status, next_attempt_at, lease_until, run_id, run_sequence
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (2, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 2;
COMMIT;
"""

_MIGRATION_V3 = """
BEGIN IMMEDIATE;

CREATE TABLE remote_command_inbox (
    command_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    run_id TEXT,
    route_version INTEGER NOT NULL CHECK (route_version > 0),
    command_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    expires_at REAL NOT NULL,
    receipt_grace_until REAL NOT NULL CHECK (receipt_grace_until >= expires_at),
    requires_online_receipt_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (
        requires_online_receipt_confirmation IN (0, 1)
    ),
    receipt_event_id TEXT NOT NULL UNIQUE,
    receipt_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        receipt_status IN ('pending', 'confirmed', 'expired_late')
    ),
    state TEXT NOT NULL DEFAULT 'received' CHECK (
        state IN ('received', 'dispatched', 'accepted', 'rejected', 'completed', 'failed')
    ),
    dispatch_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempt_count >= 0),
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX remote_command_inbox_dispatch_idx
ON remote_command_inbox(state, updated_at, command_id);

CREATE TABLE command_result_events (
    event_id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL REFERENCES remote_command_inbox(command_id) ON DELETE CASCADE,
    command_event_sequence INTEGER NOT NULL CHECK (command_event_sequence > 0),
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at REAL NOT NULL,
    UNIQUE(command_id, command_event_sequence)
);

CREATE INDEX command_result_events_replay_idx
ON command_result_events(command_id, command_event_sequence);

CREATE TABLE command_result_outbox (
    event_id TEXT PRIMARY KEY REFERENCES command_result_events(event_id) ON DELETE CASCADE,
    command_id TEXT NOT NULL,
    command_event_sequence INTEGER NOT NULL CHECK (command_event_sequence > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'sending', 'sent', 'dead_letter')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at REAL NOT NULL,
    lease_token TEXT,
    lease_until REAL,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(command_id, command_event_sequence)
);

CREATE INDEX command_result_outbox_pending_idx
ON command_result_outbox(
    status, next_attempt_at, lease_until, command_id, command_event_sequence
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (3, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 3;
COMMIT;
"""

_MIGRATION_V4 = """
BEGIN IMMEDIATE;

ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(run_id);
ALTER TABLE runs ADD COLUMN timeout_policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE runs ADD COLUMN cancel_request_id TEXT;
ALTER TABLE runs ADD COLUMN cancel_requested_at REAL;

ALTER TABLE run_attempts ADD COLUMN resume_request_id TEXT;
ALTER TABLE run_attempts ADD COLUMN resume_reason TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE run_attempts ADD COLUMN policy_version TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE run_attempts ADD COLUMN elapsed_active_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_attempts ADD COLUMN last_consumer_heartbeat_at REAL;

CREATE UNIQUE INDEX run_attempts_resume_request_idx
ON run_attempts(run_id, resume_request_id)
WHERE resume_request_id IS NOT NULL;

ALTER TABLE tool_calls ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tool_calls ADD COLUMN result_json TEXT;
ALTER TABLE tool_calls ADD COLUMN prepared_at REAL;
ALTER TABLE tool_calls ADD COLUMN dispatched_at REAL;
ALTER TABLE tool_calls ADD COLUMN completed_at REAL;

ALTER TABLE approvals ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE approvals ADD COLUMN expires_at REAL;
ALTER TABLE approvals ADD COLUMN expiry_action TEXT NOT NULL DEFAULT 'keep_pending';

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (4, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 4;
COMMIT;
"""

_MIGRATION_V5 = """
BEGIN IMMEDIATE;

ALTER TABLE runs ADD COLUMN origin TEXT NOT NULL DEFAULT 'local' CHECK (
    origin IN ('local', 'cloud_restore')
);
ALTER TABLE runs ADD COLUMN resume_blocked_reason TEXT;

CREATE TABLE cloud_project_replicas (
    project_id TEXT PRIMARY KEY,
    last_cursor INTEGER NOT NULL DEFAULT 0 CHECK (last_cursor >= 0),
    last_synced_at REAL NOT NULL
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (5, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 5;
COMMIT;
"""

_MIGRATION_V6 = """
BEGIN IMMEDIATE;

CREATE TABLE workspace_config_revisions (
    revision_id TEXT PRIMARY KEY,
    bundle_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    status TEXT NOT NULL CHECK (
        status IN ('draft', 'validated', 'published', 'deprecated')
    ),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    manifest_json TEXT NOT NULL,
    manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64),
    created_by TEXT NOT NULL,
    created_at REAL NOT NULL,
    UNIQUE(bundle_id, revision_number)
);

CREATE INDEX workspace_config_revisions_bundle_idx
ON workspace_config_revisions(bundle_id, revision_number DESC);

CREATE TABLE workspace_config_materializations (
    materialization_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    revision_id TEXT NOT NULL REFERENCES workspace_config_revisions(
        revision_id
    ) ON DELETE RESTRICT,
    config_placement TEXT NOT NULL CHECK (
        config_placement IN ('in_repo', 'sidecar')
    ),
    state TEXT NOT NULL CHECK (
        state IN ('pending', 'materialized', 'needs_attention', 'degraded')
    ),
    local_override_digest TEXT NOT NULL DEFAULT '',
    materialized_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(space_id, revision_id, local_override_digest)
);

CREATE TABLE effective_environment_specs (
    environment_spec_id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('run', 'run_attempt')),
    owner_id TEXT NOT NULL,
    bundle_revision_id TEXT NOT NULL REFERENCES workspace_config_revisions(
        revision_id
    ) ON DELETE RESTRICT,
    manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64),
    spec_json TEXT NOT NULL,
    environment_spec_digest TEXT NOT NULL CHECK (
        length(environment_spec_digest) = 64
    ),
    semantic_spec_digest TEXT NOT NULL CHECK (
        length(semantic_spec_digest) = 64
    ),
    local_materialization_digest TEXT NOT NULL CHECK (
        length(local_materialization_digest) = 64
    ),
    redacted_spec_json TEXT NOT NULL,
    projection_digest TEXT NOT NULL CHECK (length(projection_digest) = 64),
    permission_profile_revision TEXT NOT NULL,
    provider_capability_revision TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE INDEX effective_environment_specs_owner_idx
ON effective_environment_specs(owner_type, owner_id, created_at DESC);

ALTER TABLE run_attempts ADD COLUMN environment_spec_id TEXT REFERENCES
    effective_environment_specs(environment_spec_id) ON DELETE RESTRICT;
ALTER TABLE run_attempts ADD COLUMN environment_spec_digest TEXT;
ALTER TABLE run_attempts ADD COLUMN bundle_revision_id TEXT REFERENCES
    workspace_config_revisions(revision_id) ON DELETE RESTRICT;
ALTER TABLE run_attempts ADD COLUMN permission_profile_revision TEXT;
ALTER TABLE run_attempts ADD COLUMN thinking_effort_requested TEXT CHECK (
    thinking_effort_requested IS NULL OR
    thinking_effort_requested IN ('low', 'medium', 'high', 'xhigh', 'max')
);
ALTER TABLE run_attempts ADD COLUMN thinking_effort_effective TEXT CHECK (
    thinking_effort_effective IS NULL OR
    thinking_effort_effective IN ('low', 'medium', 'high', 'xhigh', 'max')
);
ALTER TABLE run_attempts ADD COLUMN provider_capability_revision TEXT;

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (6, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 6;
COMMIT;
"""

_MIGRATION_V7 = """
BEGIN IMMEDIATE;

CREATE TABLE git_repositories (
    repository_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    repository_role TEXT NOT NULL CHECK (
        repository_role IN ('content', 'configuration')
    ),
    root_path TEXT NOT NULL,
    root_path_digest TEXT NOT NULL CHECK (length(root_path_digest) = 64),
    ownership TEXT NOT NULL CHECK (
        ownership IN ('eigent_owned', 'adopted')
    ),
    state TEXT NOT NULL CHECK (
        state IN ('ready', 'not_enabled', 'needs_attention', 'degraded')
    ),
    version_coverage TEXT NOT NULL CHECK (
        version_coverage IN ('full', 'managed_files_only', 'degraded')
    ),
    hooks_mode TEXT NOT NULL DEFAULT 'disabled' CHECK (
        hooks_mode IN ('disabled', 'trusted')
    ),
    repo_subdir TEXT,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(space_id, repository_role)
);

CREATE TABLE git_operations (
    operation_id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES git_repositories(
        repository_id
    ) ON DELETE RESTRICT,
    request_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
    status TEXT NOT NULL CHECK (
        status IN (
            'prepared', 'dispatched', 'completed', 'failed',
            'outcome_unknown'
        )
    ),
    expected_repo_state_digest TEXT,
    observed_repo_state_digest TEXT,
    result_json TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(repository_id, request_id)
);

CREATE INDEX git_operations_reconcile_idx
ON git_operations(status, updated_at, repository_id);

CREATE TABLE git_checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES git_repositories(
        repository_id
    ) ON DELETE RESTRICT,
    operation_id TEXT NOT NULL UNIQUE REFERENCES git_operations(
        operation_id
    ) ON DELETE RESTRICT,
    target_role TEXT NOT NULL CHECK (
        target_role IN ('user', 'project', 'run', 'agent')
    ),
    target_id TEXT NOT NULL,
    commit_oid TEXT NOT NULL,
    parent_oid TEXT,
    paths_json TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE INDEX git_checkpoints_repository_created_idx
ON git_checkpoints(repository_id, created_at DESC);

CREATE TABLE git_managed_paths (
    repository_id TEXT NOT NULL REFERENCES git_repositories(
        repository_id
    ) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    source TEXT NOT NULL CHECK (
        source IN (
            'agent_created', 'agent_modified', 'user_selected',
            'configuration', 'overlay_preimage'
        )
    ),
    first_checkpoint_id TEXT REFERENCES git_checkpoints(
        checkpoint_id
    ) ON DELETE SET NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY(repository_id, relative_path)
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (7, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 7;
COMMIT;
"""

_MIGRATION_V8 = """
BEGIN IMMEDIATE;

CREATE TABLE git_project_integrations (
    project_id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES git_repositories(
        repository_id
    ) ON DELETE RESTRICT,
    integration_ref TEXT,
    integration_head TEXT,
    last_synced_user_head TEXT,
    pending_apply INTEGER NOT NULL DEFAULT 0 CHECK (
        pending_apply IN (0, 1)
    ),
    worktree_path TEXT,
    projected_head TEXT,
    state TEXT NOT NULL DEFAULT 'unmaterialized' CHECK (
        state IN (
            'unmaterialized', 'ready', 'needs_attention', 'conflicted',
            'archived'
        )
    ),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX git_project_integrations_repository_idx
ON git_project_integrations(repository_id, updated_at DESC);

CREATE TABLE git_run_materializations (
    run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    repository_id TEXT NOT NULL REFERENCES git_repositories(
        repository_id
    ) ON DELETE RESTRICT,
    workspace_base_ref TEXT,
    workspace_base_commit TEXT,
    project_state_version INTEGER NOT NULL CHECK (
        project_state_version >= 0
    ),
    materialization_state TEXT NOT NULL DEFAULT 'unmaterialized' CHECK (
        materialization_state IN (
            'unmaterialized', 'materializing', 'materialized', 'promoted',
            'conflicted', 'needs_attention', 'archived'
        )
    ),
    run_ref TEXT,
    worktree_path TEXT,
    promoted_commit TEXT,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    FOREIGN KEY(project_id) REFERENCES git_project_integrations(project_id)
        ON DELETE RESTRICT
);

CREATE INDEX git_run_materializations_project_idx
ON git_run_materializations(project_id, created_at DESC);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (8, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 8;
COMMIT;
"""

_MIGRATION_V9 = """
BEGIN IMMEDIATE;

CREATE TABLE workspace_read_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    repository_id TEXT NOT NULL REFERENCES git_repositories(
        repository_id
    ) ON DELETE RESTRICT,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    project_base_commit TEXT,
    common_base_commit TEXT,
    project_state_version INTEGER NOT NULL CHECK (
        project_state_version >= 0
    ),
    snapshot_ref TEXT,
    user_head TEXT,
    user_working_state_digest TEXT NOT NULL CHECK (
        length(user_working_state_digest) = 64
    ),
    overlay_manifest_digest TEXT NOT NULL CHECK (
        length(overlay_manifest_digest) = 64
    ),
    state TEXT NOT NULL DEFAULT 'active' CHECK (
        state IN ('active', 'stale', 'unavailable', 'released')
    ),
    expires_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(run_id, generation)
);

CREATE INDEX workspace_read_snapshots_run_idx
ON workspace_read_snapshots(run_id, generation DESC);

CREATE TABLE workspace_overlay_entries (
    snapshot_id TEXT NOT NULL REFERENCES workspace_read_snapshots(
        snapshot_id
    ) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (
        source_kind IN ('project_blob', 'user_overlay', 'missing')
    ),
    entry_state TEXT NOT NULL CHECK (
        entry_state IN (
            'read_only', 'imported_preimage', 'agent_modified', 'conflicted'
        )
    ),
    source_token_json TEXT NOT NULL,
    project_blob_oid TEXT,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY(snapshot_id, relative_path)
);

CREATE TABLE workspace_snapshot_ranges (
    snapshot_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
    end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
    content_digest TEXT NOT NULL CHECK (length(content_digest) = 64),
    cache_key TEXT NOT NULL CHECK (length(cache_key) = 64),
    created_at REAL NOT NULL,
    PRIMARY KEY(snapshot_id, relative_path, start_offset, end_offset),
    FOREIGN KEY(snapshot_id, relative_path) REFERENCES workspace_overlay_entries(
        snapshot_id, relative_path
    ) ON DELETE CASCADE
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (9, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 9;
COMMIT;
"""

_MIGRATION_V10 = """
BEGIN IMMEDIATE;

ALTER TABLE workspace_overlay_entries
ADD COLUMN materialized_content_digest TEXT;

ALTER TABLE workspace_overlay_entries
ADD COLUMN preimage_cache_key TEXT;

CREATE TABLE git_change_sets (
    change_set_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES git_repositories(
        repository_id
    ) ON DELETE RESTRICT,
    worktree_ref TEXT NOT NULL,
    base_commit TEXT,
    state TEXT NOT NULL DEFAULT 'open' CHECK (
        state IN ('open', 'checkpointed', 'discarded', 'needs_attention')
    ),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(run_id, worktree_ref)
);

CREATE INDEX git_change_sets_run_idx
ON git_change_sets(run_id, created_at DESC);

CREATE TABLE git_change_set_items (
    change_set_id TEXT NOT NULL REFERENCES git_change_sets(
        change_set_id
    ) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    operation_request_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    change_kind TEXT NOT NULL CHECK (
        change_kind IN ('added', 'modified', 'deleted', 'renamed')
    ),
    source TEXT NOT NULL CHECK (
        source IN (
            'agent_created', 'agent_modified', 'user_selected',
            'overlay_preimage', 'artifact_event', 'worktree_delta'
        )
    ),
    preimage_digest TEXT,
    result_digest TEXT,
    size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
    item_state TEXT NOT NULL DEFAULT 'pending' CHECK (
        item_state IN (
            'pending', 'preimage_checkpointed', 'checkpointed', 'ignored'
        )
    ),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY(change_set_id, relative_path)
);

CREATE TABLE git_mutation_intents (
    intent_id TEXT PRIMARY KEY,
    change_set_id TEXT NOT NULL REFERENCES git_change_sets(
        change_set_id
    ) ON DELETE CASCADE,
    operation_request_id TEXT NOT NULL,
    mutation_scope TEXT NOT NULL CHECK (
        mutation_scope IN ('exact_path', 'broad_process')
    ),
    relative_path TEXT,
    preimage_digest TEXT,
    actor_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepared' CHECK (
        status IN ('prepared', 'completed', 'needs_attention')
    ),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(change_set_id, operation_request_id),
    CHECK (
        (mutation_scope = 'exact_path' AND relative_path IS NOT NULL)
        OR (mutation_scope = 'broad_process' AND relative_path IS NULL)
    )
);

CREATE INDEX git_mutation_intents_reconcile_idx
ON git_mutation_intents(status, updated_at, change_set_id);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (10, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 10;
COMMIT;
"""

_MIGRATION_V11 = """
BEGIN IMMEDIATE;

CREATE TABLE human_interactions (
    interaction_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_id TEXT REFERENCES run_attempts(attempt_id) ON DELETE SET NULL,
    interaction_type TEXT NOT NULL CHECK (
        interaction_type IN (
            'question', 'choice', 'form', 'confirmation', 'approval',
            'diff_review', 'merge_conflict', 'credential_binding'
        )
    ),
    status TEXT NOT NULL CHECK (
        status IN ('requested', 'presented', 'resolved', 'expired', 'cancelled')
    ),
    request_json TEXT NOT NULL,
    response_schema_json TEXT NOT NULL DEFAULT '{}',
    requested_by TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    expires_at REAL,
    presented_at REAL,
    resolved_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX human_interactions_run_status_idx
ON human_interactions(run_id, status, created_at);

CREATE TABLE human_interaction_options (
    interaction_id TEXT NOT NULL REFERENCES human_interactions(interaction_id)
        ON DELETE CASCADE,
    option_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    label TEXT NOT NULL,
    value_json TEXT NOT NULL,
    description TEXT,
    PRIMARY KEY(interaction_id, option_id),
    UNIQUE(interaction_id, position)
);

CREATE TABLE human_interaction_decisions (
    decision_id TEXT PRIMARY KEY,
    interaction_id TEXT NOT NULL REFERENCES human_interactions(interaction_id)
        ON DELETE CASCADE,
    decision_request_id TEXT NOT NULL,
    decision_json TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (
        actor_type IN ('user', 'auto_reviewer', 'system')
    ),
    actor_id TEXT,
    source TEXT NOT NULL CHECK (
        source IN ('desktop', 'remote_control', 'recovery', 'expiry')
    ),
    action_digest TEXT,
    created_at REAL NOT NULL,
    UNIQUE(interaction_id, decision_request_id)
);

CREATE INDEX human_interaction_decisions_interaction_idx
ON human_interaction_decisions(interaction_id, created_at);

ALTER TABLE approvals ADD COLUMN action_digest TEXT NOT NULL DEFAULT '';
ALTER TABLE approvals ADD COLUMN policy_revision TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE approvals ADD COLUMN safety_class TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE approvals ADD COLUMN decision_scope TEXT NOT NULL DEFAULT 'once';

INSERT INTO human_interactions(
    interaction_id, run_id, attempt_id, interaction_type, status,
    request_json, response_schema_json, requested_by, version, expires_at,
    presented_at, resolved_at, created_at, updated_at
)
SELECT approval_id, run_id, attempt_id, 'approval',
       CASE WHEN status = 'pending' THEN 'requested' ELSE 'resolved' END,
       prompt_json, '{}', 'legacy_approval', version, expires_at, NULL,
       resolved_at, created_at, COALESCE(resolved_at, created_at)
FROM approvals;

CREATE TABLE space_permission_profiles (
    space_id TEXT PRIMARY KEY,
    profile_name TEXT NOT NULL CHECK (
        profile_name IN (
            'read_only', 'request_approval', 'auto_reviewer', 'full_access'
        )
    ),
    sandbox_mode TEXT NOT NULL,
    approval_mode TEXT NOT NULL,
    reviewer_mode TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_by TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE approval_rules (
    rule_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    effect TEXT NOT NULL CHECK (effect IN ('allow', 'prompt', 'deny')),
    action_pattern TEXT NOT NULL,
    resource_pattern TEXT,
    scope TEXT NOT NULL CHECK (scope IN ('run', 'space')),
    run_id TEXT REFERENCES runs(run_id) ON DELETE CASCADE,
    source_interaction_id TEXT REFERENCES human_interactions(interaction_id)
        ON DELETE SET NULL,
    expires_at REAL,
    created_by TEXT NOT NULL,
    created_at REAL NOT NULL,
    CHECK ((scope = 'run' AND run_id IS NOT NULL) OR scope = 'space')
);

CREATE INDEX approval_rules_lookup_idx
ON approval_rules(space_id, action_pattern, effect, expires_at);

CREATE TABLE security_audit_events (
    audit_event_id TEXT PRIMARY KEY,
    space_id TEXT,
    run_id TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
    interaction_id TEXT REFERENCES human_interactions(interaction_id)
        ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    action_digest TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL
);

CREATE INDEX security_audit_events_run_idx
ON security_audit_events(run_id, created_at);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (11, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 11;
COMMIT;
"""

_MIGRATION_V12 = """
BEGIN IMMEDIATE;

CREATE TABLE space_permission_profile_revisions (
    revision_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    profile_name TEXT NOT NULL CHECK (
        profile_name IN (
            'read_only', 'request_approval', 'auto_reviewer', 'full_access'
        )
    ),
    sandbox_mode TEXT NOT NULL,
    approval_mode TEXT NOT NULL,
    reviewer_mode TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_by TEXT NOT NULL,
    created_at REAL NOT NULL,
    UNIQUE(space_id, revision)
);

INSERT INTO space_permission_profile_revisions(
    revision_id, space_id, profile_name, sandbox_mode, approval_mode,
    reviewer_mode, revision, created_by, created_at
)
SELECT 'space:' || space_id || ':' || revision, space_id, profile_name,
       sandbox_mode, approval_mode, reviewer_mode, revision, updated_by,
       updated_at
FROM space_permission_profiles;

CREATE INDEX space_permission_profile_revisions_space_idx
ON space_permission_profile_revisions(space_id, revision);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (12, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 12;
COMMIT;
"""

_MIGRATION_V13 = """
BEGIN IMMEDIATE;

CREATE TABLE git_agent_workspaces (
    workspace_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES git_run_materializations(run_id)
        ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES git_repositories(repository_id)
        ON DELETE RESTRICT,
    agent_id TEXT NOT NULL,
    agent_ref TEXT NOT NULL UNIQUE,
    worktree_path TEXT NOT NULL UNIQUE,
    base_commit TEXT NOT NULL,
    head_commit TEXT NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN (
            'admitted', 'materializing', 'ready', 'merging', 'merged',
            'conflicted', 'needs_attention', 'archived'
        )
    ),
    lease_owner TEXT,
    lease_token TEXT,
    lease_until REAL,
    last_operation_id TEXT,
    conflict_interaction_id TEXT REFERENCES human_interactions(interaction_id)
        ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(run_id, agent_id),
    CHECK (
        (lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)
        OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL
            AND lease_until IS NOT NULL)
    )
);

CREATE INDEX git_agent_workspaces_reconcile_idx
ON git_agent_workspaces(state, lease_until, updated_at);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (13, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 13;
COMMIT;
"""

_MIGRATION_V14 = """
BEGIN IMMEDIATE;

CREATE TABLE workspace_bundle_install_proposals (
    proposal_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    space_id TEXT NOT NULL,
    bundle_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    config_placement TEXT NOT NULL CHECK (
        config_placement IN ('in_repo', 'sidecar')
    ),
    state TEXT NOT NULL CHECK (
        state IN (
            'proposed', 'approved', 'materializing', 'materialized',
            'rejected', 'needs_attention'
        )
    ),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    manifest_json TEXT NOT NULL,
    manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64),
    assets_json TEXT NOT NULL,
    install_plan_json TEXT NOT NULL,
    decided_by TEXT,
    decided_at REAL,
    error_code TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    CHECK (
        (decided_by IS NULL AND decided_at IS NULL)
        OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX workspace_bundle_install_proposals_space_idx
ON workspace_bundle_install_proposals(space_id, updated_at DESC);

CREATE TABLE workspace_bundle_local_bindings (
    binding_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL REFERENCES workspace_bundle_install_proposals(
        proposal_id
    ) ON DELETE CASCADE,
    slot_id TEXT NOT NULL,
    binding_kind TEXT NOT NULL CHECK (
        binding_kind IN ('connector', 'local_path', 'script_approval')
    ),
    connector_id TEXT,
    opaque_connection_id TEXT,
    local_path TEXT,
    required_grants_json TEXT NOT NULL,
    authorized_by TEXT NOT NULL,
    authorized_at REAL NOT NULL,
    UNIQUE(proposal_id, slot_id)
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (14, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 14;
COMMIT;
"""

_MIGRATION_V15 = """
BEGIN IMMEDIATE;

-- Legacy tool approvals could wait forever after their owning attempt was
-- interrupted.  Give every unresolved approval a finite recovery horizon and
-- make expiry fail closed.  The paired HumanInteraction uses the same deadline
-- so Desktop and Remote Control project one lifecycle.
UPDATE approvals
SET expires_at = created_at + 86400,
    expiry_action = 'reject'
WHERE status = 'pending'
  AND expires_at IS NULL;

UPDATE human_interactions
SET expires_at = COALESCE(
        (
            SELECT approvals.expires_at
            FROM approvals
            WHERE approvals.approval_id = human_interactions.interaction_id
        ),
        created_at + 86400
    ),
    updated_at = MAX(updated_at, created_at)
WHERE interaction_type = 'approval'
  AND status IN ('requested', 'presented')
  AND expires_at IS NULL;

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (15, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 15;
COMMIT;
"""

_MIGRATION_V16 = """
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS workspace_config_drafts (
    space_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    base_revision_id TEXT REFERENCES workspace_config_revisions(
        revision_id
    ) ON DELETE RESTRICT,
    document_json TEXT NOT NULL,
    document_digest TEXT NOT NULL CHECK (length(document_digest) = 64),
    updated_by TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (16, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 16;
COMMIT;
"""

_MIGRATION_V17 = """
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS workspace_bundle_secret_bindings (
    binding_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL REFERENCES workspace_bundle_install_proposals(
        proposal_id
    ) ON DELETE CASCADE,
    requirement_key TEXT NOT NULL,
    requirement_kind TEXT NOT NULL CHECK (
        requirement_kind IN ('environment', 'mcp_secret')
    ),
    binding_version INTEGER NOT NULL DEFAULT 1 CHECK (binding_version >= 1),
    secret_ref TEXT NOT NULL,
    account_scope_digest TEXT NOT NULL CHECK (
        length(account_scope_digest) = 64
    ),
    authorized_by TEXT NOT NULL,
    authorized_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(proposal_id, requirement_key)
);

CREATE TABLE IF NOT EXISTS workspace_bundle_secret_binding_requests (
    client_request_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL REFERENCES workspace_bundle_install_proposals(
        proposal_id
    ) ON DELETE CASCADE,
    request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
    created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_bundle_secret_bindings_proposal_idx
ON workspace_bundle_secret_bindings(proposal_id, requirement_kind);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (17, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 17;
COMMIT;
"""

_MIGRATION_V18 = """
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS workspace_config_draft_asset_blobs (
    content_digest TEXT PRIMARY KEY CHECK (length(content_digest) = 64),
    content BLOB NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_config_draft_assets (
    space_id TEXT NOT NULL,
    draft_version INTEGER NOT NULL CHECK (draft_version >= 1),
    document_digest TEXT NOT NULL CHECK (length(document_digest) = 64),
    logical_path TEXT NOT NULL,
    content_digest TEXT NOT NULL REFERENCES workspace_config_draft_asset_blobs(
        content_digest
    ) ON DELETE RESTRICT,
    media_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    executable INTEGER NOT NULL CHECK (executable IN (0, 1)),
    provenance TEXT NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY(space_id, draft_version, logical_path)
);

CREATE INDEX IF NOT EXISTS workspace_config_draft_assets_digest_idx
ON workspace_config_draft_assets(content_digest);

CREATE TABLE IF NOT EXISTS workspace_agent_plugin_import_requests (
    client_request_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    expected_target_draft_version INTEGER NOT NULL CHECK (
        expected_target_draft_version >= 0
    ),
    expected_review_digest TEXT NOT NULL CHECK (
        length(expected_review_digest) = 64
    ),
    requested_by TEXT NOT NULL,
    request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
    result_version INTEGER NOT NULL CHECK (result_version >= 1),
    result_base_revision_id TEXT,
    result_document_json TEXT NOT NULL,
    result_document_digest TEXT NOT NULL CHECK (
        length(result_document_digest) = 64
    ),
    result_updated_by TEXT NOT NULL,
    result_created_at REAL NOT NULL,
    result_updated_at REAL NOT NULL,
    created_at REAL NOT NULL
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (18, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 18;
COMMIT;
"""

_MIGRATION_V19 = """
BEGIN IMMEDIATE;

CREATE UNIQUE INDEX IF NOT EXISTS run_events_one_assistant_final_idx
ON run_events(run_id)
WHERE event_type = 'assistant.final';

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (19, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 19;
COMMIT;
"""

_MIGRATION_V20 = """
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS follow_up_requests(
    request_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    attachment_paths_json TEXT NOT NULL DEFAULT '[]',
    delivery_mode TEXT NOT NULL DEFAULT 'wait'
        CHECK(delivery_mode IN ('wait', 'send_now')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'admitted', 'cancelled')),
    admitted_run_id TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS follow_up_requests_pending_idx
ON follow_up_requests(project_id, delivery_mode DESC, created_at)
WHERE status = 'pending';

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (20, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 20;
COMMIT;
"""

_MIGRATION_V21 = """
BEGIN IMMEDIATE;

-- The execution lease is the cross-writer enforcement point for the
-- one-executing-Run-per-Project invariant. A pending historical Run row is
-- not an execution owner; creating an Attempt is what acquires the lease.
CREATE TABLE IF NOT EXISTS project_run_execution_leases(
    project_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES run_attempts(attempt_id)
        ON DELETE CASCADE,
    acquired_at REAL NOT NULL
);

-- Existing databases may contain more than one active Attempt for a Project
-- because v20 had no cross-Run constraint. Keep the newest Attempt as owner;
-- startup reconciliation will interrupt the remaining orphaned Attempts.
INSERT OR IGNORE INTO project_run_execution_leases(
    project_id, run_id, attempt_id, acquired_at
)
SELECT runs.project_id, attempts.run_id, attempts.attempt_id,
       attempts.started_at
FROM run_attempts AS attempts
JOIN runs ON runs.run_id = attempts.run_id
WHERE attempts.status IN ('pending', 'running', 'waiting_for_user')
  AND NOT EXISTS (
      SELECT 1
      FROM run_attempts AS newer
      JOIN runs AS newer_run ON newer_run.run_id = newer.run_id
      WHERE newer_run.project_id = runs.project_id
        AND newer.status IN ('pending', 'running', 'waiting_for_user')
        AND (
            newer.started_at > attempts.started_at
            OR (newer.started_at = attempts.started_at
                AND newer.attempt_id > attempts.attempt_id)
        )
  );

ALTER TABLE follow_up_requests
ADD COLUMN source TEXT NOT NULL DEFAULT 'local'
    CHECK(source IN ('local', 'remote_control', 'scheduled'));
ALTER TABLE follow_up_requests ADD COLUMN source_command_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS follow_up_requests_source_command_idx
ON follow_up_requests(source_command_id)
WHERE source_command_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_execution_states(
    project_id TEXT PRIMARY KEY,
    state_version INTEGER NOT NULL DEFAULT 0 CHECK(state_version >= 0),
    frontier_json TEXT,
    frontier_digest TEXT CHECK(
        frontier_digest IS NULL OR length(frontier_digest) = 64
    ),
    frontier_run_id TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS continuation_claims(
    fingerprint TEXT PRIMARY KEY CHECK(length(fingerprint) = 64),
    request_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    project_state_version INTEGER NOT NULL CHECK(project_state_version >= 0),
    intent TEXT NOT NULL,
    base_run_id TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
    next_action TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS continuation_claims_project_idx
ON continuation_claims(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS context_projection_diagnostics(
    projection_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    source_event_ids_json TEXT NOT NULL,
    source_memory_ids_json TEXT NOT NULL,
    project_state_version INTEGER NOT NULL CHECK(project_state_version >= 0),
    projection_digest TEXT NOT NULL CHECK(length(projection_digest) = 64),
    token_count INTEGER NOT NULL CHECK(token_count >= 0),
    created_at REAL NOT NULL,
    UNIQUE(run_id, projection_digest)
);
CREATE INDEX IF NOT EXISTS context_projection_diagnostics_project_idx
ON context_projection_diagnostics(project_id, created_at DESC);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (21, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 21;
COMMIT;
"""

_MIGRATION_V22 = """
BEGIN IMMEDIATE;

-- History owns the durable, Project-wide order.  Run sequence remains the
-- causal order inside one Run; journal_cursor is only for cross-Run paging.
CREATE TABLE IF NOT EXISTS project_history_cursors(
    project_id TEXT PRIMARY KEY,
    next_cursor INTEGER NOT NULL DEFAULT 1 CHECK(next_cursor >= 1),
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS project_history_events(
    project_id TEXT NOT NULL,
    journal_cursor INTEGER NOT NULL CHECK(journal_cursor >= 1),
    event_id TEXT NOT NULL UNIQUE REFERENCES run_events(event_id)
        ON DELETE CASCADE,
    source_kind TEXT NOT NULL DEFAULT 'native' CHECK(
        source_kind IN ('native', 'legacy_cursor_backfill')
    ),
    created_at REAL NOT NULL,
    PRIMARY KEY(project_id, journal_cursor)
);
CREATE INDEX IF NOT EXISTS project_history_events_page_idx
ON project_history_events(project_id, journal_cursor);

-- Deterministic compatibility order for canonical events created before the
-- Project cursor existed.  It promises stable paging, not real-time order
-- between concurrent historical Runs.
INSERT OR IGNORE INTO project_history_events(
    project_id, journal_cursor, event_id, source_kind, created_at
)
SELECT project_id, project_cursor, event_id,
       'legacy_cursor_backfill', created_at
FROM (
    SELECT runs.project_id AS project_id,
           ROW_NUMBER() OVER (
               PARTITION BY runs.project_id
               ORDER BY run_events.created_at, run_events.run_id,
                        run_events.sequence, run_events.event_id
           ) AS project_cursor,
           run_events.event_id AS event_id,
           run_events.created_at AS created_at
    FROM run_events
    JOIN runs ON runs.run_id = run_events.run_id
);

INSERT OR REPLACE INTO project_history_cursors(
    project_id, next_cursor, updated_at
)
SELECT project_id, MAX(journal_cursor) + 1, MAX(created_at)
FROM project_history_events
GROUP BY project_id;

CREATE TABLE IF NOT EXISTS memory_scope_state(
    scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'space', 'user')),
    scope_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL CHECK(owner_kind IN ('desktop', 'cloud')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    capture_enabled INTEGER NOT NULL DEFAULT 1 CHECK(capture_enabled IN (0, 1)),
    use_enabled INTEGER NOT NULL DEFAULT 1 CHECK(use_enabled IN (0, 1)),
    sync_scope TEXT NOT NULL DEFAULT 'local_only' CHECK(
        sync_scope IN ('local_only', 'metadata_only', 'summary_only', 'full_memory')
    ),
    token_limit INTEGER NOT NULL CHECK(token_limit > 0),
    current_token_count INTEGER NOT NULL DEFAULT 0 CHECK(current_token_count >= 0),
    consolidate_threshold REAL NOT NULL DEFAULT 0.75 CHECK(
        consolidate_threshold > 0 AND consolidate_threshold <= 1
    ),
    processed_through_watermark TEXT,
    watermark_kind TEXT CHECK(
        watermark_kind IS NULL OR watermark_kind IN ('journal_cursor', 'cloud_cursor')
    ),
    extractor_version TEXT NOT NULL DEFAULT 'memory-v2',
    last_consolidated_at REAL,
    last_error TEXT,
    updated_at REAL NOT NULL,
    PRIMARY KEY(scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS memory_entries(
    memory_id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'space', 'user')),
    scope_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(
        kind IN ('fact', 'decision', 'constraint', 'preference', 'todo', 'lesson')
    ),
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal', 'high')),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    token_count INTEGER NOT NULL CHECK(token_count > 0),
    pinned_by_user INTEGER NOT NULL DEFAULT 0 CHECK(pinned_by_user IN (0, 1)),
    confirmed_by_user INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_by_user IN (0, 1)),
    created_by TEXT NOT NULL CHECK(
        created_by IN ('extractor', 'agent', 'user', 'importer')
    ),
    source_trust TEXT NOT NULL CHECK(
        source_trust IN (
            'user_confirmed', 'user_asserted', 'system_verified',
            'tool_observed', 'external_untrusted', 'model_inferred',
            'legacy_unverified'
        )
    ),
    sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK(
        sensitivity IN ('normal', 'personal', 'sensitive')
    ),
    source_refs_json TEXT NOT NULL DEFAULT '[]',
    last_used_at REAL,
    usage_count INTEGER NOT NULL DEFAULT 0 CHECK(usage_count >= 0),
    deleted_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_entries_scope_active_idx
ON memory_entries(scope_type, scope_id, deleted_at, pinned_by_user DESC,
                  priority DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_mutations(
    mutation_id TEXT PRIMARY KEY,
    memory_id TEXT,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'space', 'user')),
    scope_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(
        operation IN ('add', 'replace', 'remove', 'restore', 'confirm',
                      'pin', 'consolidate', 'noop')
    ),
    expected_version INTEGER,
    before_hash TEXT,
    after_hash TEXT,
    actor_type TEXT NOT NULL CHECK(
        actor_type IN ('extractor', 'agent', 'user', 'importer', 'system')
    ),
    actor_id TEXT,
    run_id TEXT,
    activity_id TEXT,
    reason TEXT NOT NULL,
    source_refs_json TEXT NOT NULL DEFAULT '[]',
    idempotency_key TEXT NOT NULL UNIQUE,
    request_digest TEXT NOT NULL CHECK(length(request_digest) = 64),
    decision_id TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_mutations_scope_idx
ON memory_mutations(scope_type, scope_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_mutations_entry_idx
ON memory_mutations(memory_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_mutation_outbox(
    mutation_id TEXT PRIMARY KEY REFERENCES memory_mutations(mutation_id)
        ON DELETE CASCADE,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(
        status IN ('pending', 'sending', 'sent', 'dead_letter')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    next_attempt_at REAL NOT NULL,
    lease_token TEXT,
    lease_until REAL,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_mutation_outbox_pending_idx
ON memory_mutation_outbox(status, next_attempt_at, lease_until,
                          scope_type, scope_id, created_at);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (22, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 22;
COMMIT;
"""

_MIGRATION_V23 = """
BEGIN IMMEDIATE;

-- The independent Memory lane must retain the exact post-mutation projection.
-- Reading the current entry at drain time would make an older mutation appear
-- to contain a later version after multiple offline edits.
ALTER TABLE memory_mutation_outbox
ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';

-- revision is the canonical per-scope order. Timestamps and UUIDs are not a
-- safe FIFO when multiple mutations commit inside the same clock tick.
ALTER TABLE memory_mutation_outbox
ADD COLUMN scope_revision INTEGER NOT NULL DEFAULT 0;

-- Memory Sync is a product-level invariant rather than a user preference.
UPDATE memory_scope_state SET sync_scope = 'full_memory';

CREATE INDEX IF NOT EXISTS memory_mutation_outbox_scope_revision_idx
ON memory_mutation_outbox(scope_type, scope_id, status, scope_revision);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (23, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 23;
COMMIT;
"""

_MIGRATION_V24 = """
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS legacy_memory_import_batches(
    source_path TEXT NOT NULL,
    source_checksum TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('completed', 'degraded')),
    imported_count INTEGER NOT NULL DEFAULT 0 CHECK(imported_count >= 0),
    skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count >= 0),
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY(source_path, source_checksum)
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (24, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 24;
COMMIT;
"""

_MIGRATION_V25 = """
BEGIN IMMEDIATE;

-- Memory content sync is mandatory.  Keep the invariant at the storage
-- boundary as well as in the API so no old caller can silently opt a scope
-- out and strand its independent mutation lane.
CREATE TRIGGER IF NOT EXISTS memory_scope_state_full_sync_insert
BEFORE INSERT ON memory_scope_state
WHEN NEW.sync_scope != 'full_memory'
BEGIN
    SELECT RAISE(ABORT, 'Memory sync is fixed to full_memory');
END;

CREATE TRIGGER IF NOT EXISTS memory_scope_state_full_sync_update
BEFORE UPDATE OF sync_scope ON memory_scope_state
WHEN NEW.sync_scope != 'full_memory'
BEGIN
    SELECT RAISE(ABORT, 'Memory sync is fixed to full_memory');
END;

-- Automatic extraction is Project-scoped in V2. Space/User Memory remains
-- editable and injectable, but cannot pretend to scan multiple Project
-- History streams with one cursor.
UPDATE memory_scope_state
SET capture_enabled = 0
WHERE scope_type IN ('space', 'user');

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (25, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 25;
COMMIT;
"""

_MIGRATION_V26 = """
BEGIN IMMEDIATE;

-- Artifact bytes use an independent durable lane. The canonical manifest and
-- this upload intent are committed together; successful upload later appends
-- artifact.uploaded and clears the lease in one local transaction.
CREATE TABLE IF NOT EXISTS artifact_upload_outbox(
    artifact_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    local_path TEXT NOT NULL,
    filename TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK(file_size >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(
        status IN ('pending', 'sending', 'sent', 'dead_letter')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    next_attempt_at REAL NOT NULL,
    lease_token TEXT,
    lease_until REAL,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS artifact_upload_outbox_pending_idx
ON artifact_upload_outbox(status, next_attempt_at, lease_until, created_at);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (26, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 26;
COMMIT;
"""

_MIGRATION_V27 = """
BEGIN IMMEDIATE;

-- A Desktop database can outlive login sessions. Memory scopes are bound to
-- the authenticated account that created/used the owning Space or Project;
-- unbound legacy/development rows never enter a later account's sync lane.
CREATE TABLE IF NOT EXISTS memory_scope_owners(
    scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'space', 'user')),
    scope_id TEXT NOT NULL,
    account_owner_id TEXT NOT NULL CHECK(length(trim(account_owner_id)) > 0),
    bound_at REAL NOT NULL,
    PRIMARY KEY(scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS memory_scope_owners_account_idx
ON memory_scope_owners(account_owner_id, scope_type, scope_id);

-- Request payload identity is only a candidate. CloudSync promotes it after
-- the device-registration response proves the authenticated Cloud account.
CREATE TABLE IF NOT EXISTS memory_scope_owner_candidates(
    scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'space', 'user')),
    scope_id TEXT NOT NULL,
    claimed_account_owner_id TEXT NOT NULL CHECK(
        length(trim(claimed_account_owner_id)) > 0
    ),
    created_at REAL NOT NULL,
    PRIMARY KEY(scope_type, scope_id, claimed_account_owner_id)
);
CREATE INDEX IF NOT EXISTS memory_scope_owner_candidates_claim_idx
ON memory_scope_owner_candidates(
    claimed_account_owner_id, scope_type, scope_id
);

-- Writer takeover conflicts are review facts, never silent last-write-wins.
CREATE TABLE IF NOT EXISTS memory_reconciliation_items(
    reconciliation_id TEXT PRIMARY KEY,
    account_owner_id TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    local_entry_json TEXT NOT NULL,
    cloud_entry_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(
        status IN ('pending', 'accepted_local', 'accepted_cloud', 'dismissed')
    ),
    created_at REAL NOT NULL,
    resolved_at REAL,
    UNIQUE(account_owner_id, scope_type, scope_id, memory_id, status)
);
CREATE INDEX IF NOT EXISTS memory_reconciliation_pending_idx
ON memory_reconciliation_items(account_owner_id, status, created_at);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (27, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 27;
COMMIT;
"""

_MIGRATION_V28 = """
BEGIN IMMEDIATE;

-- Persist the Cloud delivery fence across a Desktop restart between Inbox
-- commit and receipt confirmation.
ALTER TABLE remote_command_inbox ADD COLUMN delivery_lease_token TEXT;

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (28, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 28;
COMMIT;
"""

_MIGRATION_V29 = """
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

-- Memory adoption is a durable review interaction.  Earlier schemas knew
-- only the original doc-18 interaction types, so creating the review failed
-- after the user had already approved it.  Rebuild the parent table without
-- renaming it first so the child-table foreign keys continue to target the
-- canonical name when the replacement is installed.
CREATE TABLE human_interactions_v29 (
    interaction_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_id TEXT REFERENCES run_attempts(attempt_id) ON DELETE SET NULL,
    interaction_type TEXT NOT NULL CHECK (
        interaction_type IN (
            'question', 'choice', 'form', 'confirmation', 'approval',
            'diff_review', 'merge_conflict', 'credential_binding',
            'memory_change_review'
        )
    ),
    status TEXT NOT NULL CHECK (
        status IN ('requested', 'presented', 'resolved', 'expired', 'cancelled')
    ),
    request_json TEXT NOT NULL,
    response_schema_json TEXT NOT NULL DEFAULT '{}',
    requested_by TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    expires_at REAL,
    presented_at REAL,
    resolved_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

INSERT INTO human_interactions_v29(
    interaction_id, run_id, attempt_id, interaction_type, status,
    request_json, response_schema_json, requested_by, version, expires_at,
    presented_at, resolved_at, created_at, updated_at
)
SELECT interaction_id, run_id, attempt_id, interaction_type, status,
       request_json, response_schema_json, requested_by, version, expires_at,
       presented_at, resolved_at, created_at, updated_at
FROM human_interactions;

DROP TABLE human_interactions;
ALTER TABLE human_interactions_v29 RENAME TO human_interactions;
CREATE INDEX human_interactions_run_status_idx
ON human_interactions(run_id, status, created_at);

-- Cloud tombstones deliberately carry no plaintext.  The original v22
-- content CHECK made a freshly restored tombstone impossible to persist and
-- permanently wedged writer takeover.  Active Memory remains non-empty.
ALTER TABLE memory_entries RENAME TO memory_entries_v28;

CREATE TABLE memory_entries(
    memory_id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'space', 'user')),
    scope_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(
        kind IN ('fact', 'decision', 'constraint', 'preference', 'todo', 'lesson')
    ),
    content TEXT NOT NULL CHECK(
        length(trim(content)) > 0 OR deleted_at IS NOT NULL
    ),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal', 'high')),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    token_count INTEGER NOT NULL CHECK(token_count > 0),
    pinned_by_user INTEGER NOT NULL DEFAULT 0 CHECK(pinned_by_user IN (0, 1)),
    confirmed_by_user INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_by_user IN (0, 1)),
    created_by TEXT NOT NULL CHECK(
        created_by IN ('extractor', 'agent', 'user', 'importer')
    ),
    source_trust TEXT NOT NULL CHECK(
        source_trust IN (
            'user_confirmed', 'user_asserted', 'system_verified',
            'tool_observed', 'external_untrusted', 'model_inferred',
            'legacy_unverified'
        )
    ),
    sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK(
        sensitivity IN ('normal', 'personal', 'sensitive')
    ),
    source_refs_json TEXT NOT NULL DEFAULT '[]',
    last_used_at REAL,
    usage_count INTEGER NOT NULL DEFAULT 0 CHECK(usage_count >= 0),
    deleted_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

INSERT INTO memory_entries(
    memory_id, scope_type, scope_id, kind, content, priority, version,
    token_count, pinned_by_user, confirmed_by_user, created_by, source_trust,
    sensitivity, source_refs_json, last_used_at, usage_count, deleted_at,
    created_at, updated_at
)
SELECT memory_id, scope_type, scope_id, kind, content, priority, version,
       token_count, pinned_by_user, confirmed_by_user, created_by,
       source_trust, sensitivity, source_refs_json, last_used_at, usage_count,
       deleted_at, created_at, updated_at
FROM memory_entries_v28;

DROP TABLE memory_entries_v28;
CREATE INDEX memory_entries_scope_active_idx
ON memory_entries(scope_type, scope_id, deleted_at, pinned_by_user DESC,
                  priority DESC, updated_at DESC);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (29, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 29;
COMMIT;
PRAGMA foreign_keys = ON;
"""

_MIGRATION_V30 = """
BEGIN IMMEDIATE;

-- Model requests and responses are structured Run facts.  Legacy camel_log
-- JSON files are projections of these rows, never the authoritative source.
CREATE TABLE IF NOT EXISTS model_invocations(
    invocation_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_id TEXT REFERENCES run_attempts(attempt_id) ON DELETE SET NULL,
    agent_id TEXT NOT NULL,
    logical_call_id TEXT NOT NULL,
    retry_index INTEGER NOT NULL CHECK(retry_index >= 0),
    status TEXT NOT NULL CHECK(
        status IN ('dispatched', 'completed', 'failed', 'outcome_unknown')
    ),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    transport TEXT NOT NULL,
    thinking_effort TEXT,
    request_json TEXT NOT NULL,
    response_json TEXT,
    request_digest TEXT NOT NULL CHECK(length(request_digest) = 64),
    response_digest TEXT CHECK(
        response_digest IS NULL OR length(response_digest) = 64
    ),
    prompt_tokens INTEGER CHECK(prompt_tokens IS NULL OR prompt_tokens >= 0),
    completion_tokens INTEGER CHECK(
        completion_tokens IS NULL OR completion_tokens >= 0
    ),
    cache_read_tokens INTEGER CHECK(
        cache_read_tokens IS NULL OR cache_read_tokens >= 0
    ),
    cache_write_tokens INTEGER CHECK(
        cache_write_tokens IS NULL OR cache_write_tokens >= 0
    ),
    finish_reason TEXT,
    error_code TEXT,
    error_message TEXT,
    redaction_version TEXT NOT NULL,
    started_at REAL NOT NULL,
    first_token_at REAL,
    completed_at REAL,
    UNIQUE(logical_call_id, retry_index)
);
CREATE INDEX IF NOT EXISTS model_invocations_run_idx
ON model_invocations(run_id, started_at, invocation_id);
CREATE INDEX IF NOT EXISTS model_invocations_attempt_idx
ON model_invocations(attempt_id, started_at)
WHERE attempt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS model_invocation_events(
    event_id TEXT PRIMARY KEY,
    invocation_id TEXT NOT NULL REFERENCES model_invocations(invocation_id)
        ON DELETE CASCADE,
    event_index INTEGER NOT NULL CHECK(event_index > 0),
    event_type TEXT NOT NULL CHECK(
        event_type IN (
            'dispatched', 'first_token', 'completed', 'failed',
            'outcome_unknown'
        )
    ),
    payload_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    UNIQUE(invocation_id, event_index)
);
CREATE INDEX IF NOT EXISTS model_invocation_events_timeline_idx
ON model_invocation_events(invocation_id, event_index);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (30, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 30;
COMMIT;
"""

_MIGRATION_V31 = """
BEGIN IMMEDIATE;

-- Automatic Memory extraction can target Space and User scopes.  A shared
-- scope is fed by multiple independent Project History streams, so its
-- extraction cursor must be keyed by the source Project rather than stored as
-- one ambiguous scope-wide watermark.
CREATE TABLE IF NOT EXISTS memory_project_scope_bindings(
    project_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    user_id TEXT,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_extraction_watermarks(
    target_scope_type TEXT NOT NULL CHECK(
        target_scope_type IN ('space', 'user')
    ),
    target_scope_id TEXT NOT NULL,
    source_project_id TEXT NOT NULL,
    processed_through_watermark TEXT,
    watermark_kind TEXT CHECK(
        watermark_kind IS NULL OR
        watermark_kind IN ('journal_cursor', 'cloud_cursor')
    ),
    extractor_version TEXT NOT NULL DEFAULT 'memory-v2',
    last_error TEXT,
    updated_at REAL NOT NULL,
    PRIMARY KEY(target_scope_type, target_scope_id, source_project_id)
);
CREATE INDEX IF NOT EXISTS memory_extraction_watermarks_source_idx
ON memory_extraction_watermarks(source_project_id, target_scope_type,
                                target_scope_id);

-- Product policy: automatic extraction is available out of the box at every
-- Memory scope. Users can still disable an individual scope and can edit or
-- archive every extracted entry from Memory Center.
UPDATE memory_scope_state SET capture_enabled = 1;

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (31, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 31;
COMMIT;
"""

_MIGRATION_V32 = """
BEGIN IMMEDIATE;

-- A Project normally binds to the Space's primary checkout. Multiple Projects
-- may therefore share one checkout_id and are serialized by the writer lease
-- below. An explicit user branch/worktree receives a distinct checkout_id.
CREATE TABLE IF NOT EXISTS project_workspace_bindings(
    project_id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES git_repositories(repository_id)
        ON DELETE CASCADE,
    checkout_id TEXT NOT NULL,
    checkout_mode TEXT NOT NULL CHECK(
        checkout_mode IN ('primary_checkout', 'explicit_worktree')
    ),
    target_ref TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS project_workspace_bindings_checkout_idx
ON project_workspace_bindings(repository_id, checkout_id, updated_at DESC);

-- A Project execution lease prevents two Runs in one Project. This separate
-- checkout lease prevents mutating Tasks in different Projects from writing
-- the same physical checkout concurrently. Renderer/EventBus state is only a
-- projection of these canonical rows.
CREATE TABLE IF NOT EXISTS workspace_writer_requests(
    request_id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES git_repositories(repository_id)
        ON DELETE CASCADE,
    checkout_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    target_ref TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(
        status IN ('queued', 'acquired', 'released', 'interrupted')
    ),
    created_at REAL NOT NULL,
    acquired_at REAL,
    finished_at REAL,
    updated_at REAL NOT NULL,
    UNIQUE(repository_id, checkout_id, task_id)
);
CREATE INDEX IF NOT EXISTS workspace_writer_requests_queue_idx
ON workspace_writer_requests(
    repository_id, checkout_id, status, created_at, request_id
);

CREATE TABLE IF NOT EXISTS workspace_writer_leases(
    repository_id TEXT NOT NULL REFERENCES git_repositories(repository_id)
        ON DELETE CASCADE,
    checkout_id TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE REFERENCES workspace_writer_requests(
        request_id
    ) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    target_ref TEXT NOT NULL,
    acquired_at REAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    PRIMARY KEY(repository_id, checkout_id)
);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (32, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 32;
COMMIT;
"""

_MIGRATION_V33 = """
BEGIN IMMEDIATE;

ALTER TABLE follow_up_requests
ADD COLUMN review_handoff_ids_json TEXT NOT NULL DEFAULT '[]';

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (33, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 33;
COMMIT;
"""

_MIGRATION_V34 = """
BEGIN IMMEDIATE;

-- Workload purpose and SLA policy are immutable Attempt bindings. They are
-- deliberately separate from Workspace Bundle and EnvironmentSpec identity.
ALTER TABLE run_attempts
ADD COLUMN workload_kind TEXT NOT NULL DEFAULT 'production'
    CHECK(workload_kind IN ('production', 'test', 'ab', 'rollout'));
ALTER TABLE run_attempts
ADD COLUMN workload_profile_json TEXT NOT NULL
    DEFAULT '{"budget_policy_ref":"budget.product-default.v1","capture_policy_ref":"capture.best-effort.v1","isolation_policy_ref":"isolation.product-default.v1","network_policy_ref":"network.product-default.v1","profile_version":"1","retention_policy_ref":"retention.product-default.v1","schema_version":1,"verifier_policy_ref":"verifier.noop.v1","workload_kind":"production"}';
ALTER TABLE run_attempts
ADD COLUMN workload_profile_digest TEXT NOT NULL
    DEFAULT '4786bb51388abddfbbe18decc88ada3e3e896b4aa9967970c2b99865d4999302'
    CHECK(length(workload_profile_digest) = 64);
CREATE INDEX IF NOT EXISTS run_attempts_workload_kind_idx
ON run_attempts(workload_kind, started_at, attempt_id);

-- Model calls bind to the authored Step that was current at dispatch. Steps
-- remain canonical Run events; this nullable correlation is not a second Step
-- state store.
ALTER TABLE model_invocations ADD COLUMN step_id TEXT;
CREATE INDEX IF NOT EXISTS model_invocations_step_idx
ON model_invocations(run_id, step_id, started_at, invocation_id)
WHERE step_id IS NOT NULL;

-- A capture failure is a durable, queryable fact instead of a log line.
-- AttemptEvidenceManifest can aggregate these rows without rewriting canonical
-- ModelInvocation or ToolCall records.
CREATE TABLE IF NOT EXISTS attempt_evidence_gaps(
    gap_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    attempt_id TEXT NOT NULL REFERENCES run_attempts(attempt_id)
        ON DELETE CASCADE,
    step_id TEXT,
    dimension TEXT NOT NULL CHECK(
        dimension IN (
            'intent', 'harness', 'model_decisions', 'tool_actions',
            'external_observations', 'initial_environment', 'checkpoints',
            'terminal_environment', 'workspace_delta', 'artifacts',
            'user_outcome', 'verifier_result'
        )
    ),
    reason_code TEXT NOT NULL CHECK(
        reason_code IN (
            'capture_disabled', 'capture_failed',
            'provider_capability_missing', 'content_not_enabled', 'redacted',
            'truncated_budget', 'process_crashed', 'outcome_unknown',
            'consent_missing', 'reference_unresolvable',
            'retention_expired', 'not_yet_implemented'
        )
    ),
    source TEXT NOT NULL,
    detail_code TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS attempt_evidence_gaps_attempt_idx
ON attempt_evidence_gaps(attempt_id, step_id, created_at, gap_id);

INSERT OR IGNORE INTO run_journal_migrations(version, applied_at)
VALUES (34, CAST(strftime('%s', 'now') AS REAL));

PRAGMA user_version = 34;
COMMIT;
"""


class RunJournalError(RuntimeError):
    """Base error for local RunJournal operations."""


class RunNotFoundError(RunJournalError):
    pass


class OptimisticConcurrencyError(RunJournalError):
    pass


class IdempotencyConflictError(RunJournalError):
    pass


class UnsupportedSchemaVersionError(RunJournalError):
    pass


class OutboxLeaseLostError(RunJournalError):
    pass


class InvalidRunTransitionError(RunJournalError):
    pass


class UnsafeResumeError(RunJournalError):
    def __init__(self, tool_call_ids: list[str]) -> None:
        self.tool_call_ids = tuple(tool_call_ids)
        super().__init__(
            "resume is blocked by unresolved external side effects: "
            + ", ".join(tool_call_ids)
        )


class SQLiteRunJournal:
    """Short-transaction SQLite store for Desktop-owned Run facts."""

    def __init__(
        self,
        path: Path | None = None,
        *,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self.path = path or default_run_journal_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        # Durable approval rows are facts, not executable authority. A sibling
        # process with the same uid must not manufacture dispatch permission by
        # editing SQLite directly; only this live store can attest a decision.
        self._trusted_approval_decisions: set[tuple[str, int, str]] = set()
        self._trusted_attempt_permission_profiles: set[
            tuple[str, str | None]
        ] = set()
        self._trusted_approval_rules: set[str] = set()
        self._connection = sqlite3.connect(
            str(self.path),
            timeout=busy_timeout_ms / 1000,
            isolation_level=None,
            check_same_thread=False,
        )
        self._connection.row_factory = sqlite3.Row
        with self._lock:
            self._connection.execute("PRAGMA foreign_keys = ON")
            self._connection.execute(
                f"PRAGMA busy_timeout = {busy_timeout_ms}"
            )
            self._connection.execute("PRAGMA journal_mode = WAL")
            self._connection.execute("PRAGMA synchronous = FULL")
            self._migrate()

    def __enter__(self) -> SQLiteRunJournal:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    @property
    def schema_version(self) -> int:
        with self._lock:
            row = self._connection.execute("PRAGMA user_version").fetchone()
            return int(row[0])

    @staticmethod
    def _is_sha256(value: str) -> bool:
        return len(value) == 64 and not (set(value) - set("0123456789abcdef"))

    def database_settings(self) -> dict[str, Any]:
        with self._lock:
            return {
                "journal_mode": self._connection.execute(
                    "PRAGMA journal_mode"
                ).fetchone()[0],
                "foreign_keys": self._connection.execute(
                    "PRAGMA foreign_keys"
                ).fetchone()[0],
                "busy_timeout": self._connection.execute(
                    "PRAGMA busy_timeout"
                ).fetchone()[0],
                "synchronous": self._connection.execute(
                    "PRAGMA synchronous"
                ).fetchone()[0],
            }

    def put_workspace_config_revision(
        self,
        *,
        revision_id: str,
        bundle_id: str,
        revision_number: int,
        manifest: dict[str, Any],
        status: str = "validated",
        created_by: str,
        now: float | None = None,
    ) -> WorkspaceConfigRevisionRecord:
        """Insert one immutable Bundle revision or return its exact replay."""

        required = {
            "revision_id": revision_id,
            "bundle_id": bundle_id,
            "created_by": created_by,
        }
        for field_name, value in required.items():
            if not value.strip():
                raise ValueError(f"{field_name} is required")
        if revision_number < 1:
            raise ValueError("revision_number must be positive")
        if status not in {"draft", "validated", "published", "deprecated"}:
            raise ValueError("invalid workspace config revision status")
        timestamp = now if now is not None else time.time()
        manifest_json = canonical_json(manifest)
        manifest_digest = canonical_digest(manifest)
        expected = (
            revision_id,
            bundle_id,
            revision_number,
            manifest_json,
            manifest_digest,
        )
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM workspace_config_revisions
                WHERE revision_id = ?
                   OR (bundle_id = ? AND revision_number = ?)
                """,
                (revision_id, bundle_id, revision_number),
            ).fetchone()
            if row is not None:
                actual = (
                    row["revision_id"],
                    row["bundle_id"],
                    int(row["revision_number"]),
                    row["manifest_json"],
                    row["manifest_digest"],
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"workspace config revision {revision_id!r} conflicts "
                        "with an existing revision"
                    )
                return self._workspace_config_revision_from_row(row)
            connection.execute(
                """
                INSERT INTO workspace_config_revisions(
                    revision_id, bundle_id, revision_number,
                    status, manifest_json, manifest_digest,
                    created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    revision_id,
                    bundle_id,
                    revision_number,
                    status,
                    manifest_json,
                    manifest_digest,
                    created_by,
                    timestamp,
                ),
            )
            row = connection.execute(
                """
                SELECT * FROM workspace_config_revisions
                WHERE revision_id = ?
                """,
                (revision_id,),
            ).fetchone()
            assert row is not None
            return self._workspace_config_revision_from_row(row)

    def get_workspace_config_revision(
        self, revision_id: str
    ) -> WorkspaceConfigRevisionRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_config_revisions
                WHERE revision_id = ?
                """,
                (revision_id,),
            ).fetchone()
            return (
                self._workspace_config_revision_from_row(row)
                if row is not None
                else None
            )

    def put_workspace_config_materialization(
        self,
        *,
        materialization_id: str,
        space_id: str,
        revision_id: str,
        config_placement: str,
        state: str = "materialized",
        local_override_digest: str = "",
        now: float | None = None,
    ) -> WorkspaceConfigMaterializationRecord:
        """Record one Space-specific placement of a shared Bundle revision."""

        required = {
            "materialization_id": materialization_id,
            "space_id": space_id,
            "revision_id": revision_id,
        }
        for field_name, value in required.items():
            if not value.strip():
                raise ValueError(f"{field_name} is required")
        if config_placement not in {"in_repo", "sidecar"}:
            raise ValueError("invalid config_placement")
        if state not in {
            "pending",
            "materialized",
            "needs_attention",
            "degraded",
        }:
            raise ValueError("invalid workspace config materialization state")
        timestamp = now if now is not None else time.time()
        expected = (
            materialization_id,
            space_id,
            revision_id,
            config_placement,
            state,
            local_override_digest,
        )
        with self._write_transaction() as connection:
            revision = connection.execute(
                """
                SELECT revision_id FROM workspace_config_revisions
                WHERE revision_id = ?
                """,
                (revision_id,),
            ).fetchone()
            if revision is None:
                raise RunNotFoundError(
                    f"workspace config revision {revision_id!r} does not exist"
                )
            row = connection.execute(
                """
                SELECT * FROM workspace_config_materializations
                WHERE materialization_id = ?
                   OR (
                       space_id = ? AND revision_id = ?
                       AND local_override_digest = ?
                   )
                """,
                (
                    materialization_id,
                    space_id,
                    revision_id,
                    local_override_digest,
                ),
            ).fetchone()
            if row is not None:
                actual = (
                    row["materialization_id"],
                    row["space_id"],
                    row["revision_id"],
                    row["config_placement"],
                    row["state"],
                    row["local_override_digest"],
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"workspace config materialization "
                        f"{materialization_id!r} conflicts with an existing "
                        "Space installation"
                    )
                return self._workspace_config_materialization_from_row(row)
            connection.execute(
                """
                INSERT INTO workspace_config_materializations(
                    materialization_id, space_id, revision_id,
                    config_placement, state, local_override_digest,
                    materialized_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    *expected,
                    timestamp if state == "materialized" else None,
                    timestamp,
                    timestamp,
                ),
            )
            row = connection.execute(
                """
                SELECT * FROM workspace_config_materializations
                WHERE materialization_id = ?
                """,
                (materialization_id,),
            ).fetchone()
            assert row is not None
            return self._workspace_config_materialization_from_row(row)

    def get_workspace_config_materialization(
        self, materialization_id: str
    ) -> WorkspaceConfigMaterializationRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_config_materializations
                WHERE materialization_id = ?
                """,
                (materialization_id,),
            ).fetchone()
            return (
                self._workspace_config_materialization_from_row(row)
                if row is not None
                else None
            )

    def get_latest_workspace_config_materialization(
        self, space_id: str
    ) -> WorkspaceConfigMaterializationRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_config_materializations
                WHERE space_id = ? AND state = 'materialized'
                ORDER BY updated_at DESC, materialization_id DESC
                LIMIT 1
                """,
                (space_id,),
            ).fetchone()
            return (
                self._workspace_config_materialization_from_row(row)
                if row is not None
                else None
            )

    def get_workspace_config_draft(
        self, space_id: str
    ) -> WorkspaceConfigDraftRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_config_drafts
                WHERE space_id = ?
                """,
                (space_id,),
            ).fetchone()
            return (
                self._workspace_config_draft_from_row(row)
                if row is not None
                else None
            )

    def put_workspace_config_draft(
        self,
        *,
        space_id: str,
        expected_version: int,
        document: dict[str, Any],
        updated_by: str,
        base_revision_id: str | None = None,
        now: float | None = None,
    ) -> WorkspaceConfigDraftRecord:
        """Create or CAS-update the mutable Space configuration working copy."""

        if not space_id.strip():
            raise ValueError("space_id is required")
        if expected_version < 0:
            raise ValueError("expected_version cannot be negative")
        if not updated_by.strip():
            raise ValueError("updated_by is required")
        timestamp = now if now is not None else time.time()
        encoded = canonical_json(document)
        digest = canonical_digest(document)
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM workspace_config_drafts
                WHERE space_id = ?
                """,
                (space_id,),
            ).fetchone()
            if row is None:
                if expected_version != 0:
                    raise OptimisticConcurrencyError(
                        f"workspace configuration for {space_id!r} "
                        "does not exist at the expected version"
                    )
                if base_revision_id is not None:
                    revision = connection.execute(
                        """
                        SELECT revision_id FROM workspace_config_revisions
                        WHERE revision_id = ?
                        """,
                        (base_revision_id,),
                    ).fetchone()
                    if revision is None:
                        raise RunNotFoundError(
                            f"base workspace config revision "
                            f"{base_revision_id!r} does not exist"
                        )
                connection.execute(
                    """
                    INSERT INTO workspace_config_drafts(
                        space_id, version, base_revision_id,
                        document_json, document_digest, updated_by,
                        created_at, updated_at
                    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        space_id,
                        base_revision_id,
                        encoded,
                        digest,
                        updated_by,
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                current_version = int(row["version"])
                if current_version != expected_version:
                    raise OptimisticConcurrencyError(
                        f"workspace configuration for {space_id!r} changed"
                    )
                if row["base_revision_id"] != base_revision_id:
                    raise IdempotencyConflictError(
                        "workspace configuration base revision cannot change "
                        "during autosave"
                    )
                updated = connection.execute(
                    """
                    UPDATE workspace_config_drafts
                    SET version = version + 1,
                        document_json = ?,
                        document_digest = ?,
                        updated_by = ?,
                        updated_at = ?
                    WHERE space_id = ? AND version = ?
                    """,
                    (
                        encoded,
                        digest,
                        updated_by,
                        timestamp,
                        space_id,
                        expected_version,
                    ),
                )
                if updated.rowcount != 1:
                    raise OptimisticConcurrencyError(
                        f"workspace configuration for {space_id!r} changed"
                    )
                connection.execute(
                    """
                    INSERT INTO workspace_config_draft_assets(
                        space_id, draft_version, document_digest, logical_path,
                        content_digest, media_type, size_bytes, executable,
                        provenance, created_at
                    )
                    SELECT space_id, ?, ?, logical_path, content_digest,
                           media_type, size_bytes, executable, provenance, ?
                    FROM workspace_config_draft_assets
                    WHERE space_id = ? AND draft_version = ?
                    """,
                    (
                        current_version + 1,
                        digest,
                        timestamp,
                        space_id,
                        current_version,
                    ),
                )
            persisted = connection.execute(
                """
                SELECT * FROM workspace_config_drafts
                WHERE space_id = ?
                """,
                (space_id,),
            ).fetchone()
            assert persisted is not None
            return self._workspace_config_draft_from_row(persisted)

    def put_workspace_config_draft_from_import(
        self,
        *,
        space_id: str,
        expected_target_draft_version: int,
        client_request_id: str,
        document: dict[str, Any],
        review_digest: str,
        assets: tuple[dict[str, Any], ...],
        updated_by: str,
        now: float | None = None,
    ) -> WorkspaceConfigDraftRecord:
        """CAS an imported draft and retain its exact reviewed asset bytes.

        Idempotent replay is deliberately checked before the mutable draft CAS.
        A response retry therefore returns the original conversion result even
        after the working draft has advanced.
        """

        if not space_id.strip():
            raise ValueError("space_id is required")
        if expected_target_draft_version < 0:
            raise ValueError(
                "expected_target_draft_version cannot be negative"
            )
        if not client_request_id.strip():
            raise ValueError("client_request_id is required")
        if not updated_by.strip():
            raise ValueError("updated_by is required")
        if len(review_digest) != 64:
            raise ValueError("review_digest must be a SHA-256 digest")

        encoded = canonical_json(document)
        document_digest = canonical_digest(document)
        normalized_assets: list[dict[str, Any]] = []
        seen_paths: set[str] = set()
        for asset in assets:
            logical_path = asset.get("logical_path")
            content = asset.get("content")
            content_digest = asset.get("content_digest")
            size_bytes = asset.get("size_bytes")
            if (
                not isinstance(logical_path, str)
                or not logical_path.startswith("bundle://")
                or logical_path in seen_paths
                or not isinstance(content, bytes)
                or not isinstance(content_digest, str)
                or len(content_digest) != 64
                or hashlib.sha256(content).hexdigest() != content_digest
                or size_bytes != len(content)
                or not isinstance(asset.get("media_type"), str)
                or not isinstance(asset.get("provenance"), str)
                or not isinstance(asset.get("executable"), bool)
            ):
                raise ValueError("imported draft asset is invalid")
            seen_paths.add(logical_path)
            normalized_assets.append(
                {
                    "logical_path": logical_path,
                    "content_digest": content_digest,
                    "media_type": asset["media_type"],
                    "size_bytes": size_bytes,
                    "executable": asset["executable"],
                    "provenance": asset["provenance"],
                    "content": content,
                }
            )
        asset_fingerprint = [
            {key: item[key] for key in item if key != "content"}
            for item in normalized_assets
        ]
        request_digest = canonical_digest(
            {
                "space_id": space_id,
                "expected_target_draft_version": expected_target_draft_version,
                "document_digest": document_digest,
                "review_digest": review_digest,
                "assets": asset_fingerprint,
                "updated_by": updated_by,
            }
        )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            replay = connection.execute(
                """
                SELECT * FROM workspace_agent_plugin_import_requests
                WHERE client_request_id = ?
                """,
                (client_request_id,),
            ).fetchone()
            if replay is not None:
                if replay["request_digest"] != request_digest:
                    raise IdempotencyConflictError(
                        "Agent Plugin import request id was reused"
                    )
                return self._workspace_config_draft_from_import_request(replay)

            current = connection.execute(
                "SELECT * FROM workspace_config_drafts WHERE space_id = ?",
                (space_id,),
            ).fetchone()
            if current is None:
                if expected_target_draft_version != 0:
                    raise OptimisticConcurrencyError(
                        f"workspace configuration for {space_id!r} changed"
                    )
                result_version = 1
                base_revision_id = None
                created_at = timestamp
                connection.execute(
                    """
                    INSERT INTO workspace_config_drafts(
                        space_id, version, base_revision_id,
                        document_json, document_digest, updated_by,
                        created_at, updated_at
                    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
                    """,
                    (
                        space_id,
                        result_version,
                        encoded,
                        document_digest,
                        updated_by,
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                if int(current["version"]) != expected_target_draft_version:
                    raise OptimisticConcurrencyError(
                        f"workspace configuration for {space_id!r} changed"
                    )
                result_version = expected_target_draft_version + 1
                base_revision_id = current["base_revision_id"]
                created_at = float(current["created_at"])
                updated = connection.execute(
                    """
                    UPDATE workspace_config_drafts
                    SET version = ?, document_json = ?, document_digest = ?,
                        updated_by = ?, updated_at = ?
                    WHERE space_id = ? AND version = ?
                    """,
                    (
                        result_version,
                        encoded,
                        document_digest,
                        updated_by,
                        timestamp,
                        space_id,
                        expected_target_draft_version,
                    ),
                )
                if updated.rowcount != 1:
                    raise OptimisticConcurrencyError(
                        f"workspace configuration for {space_id!r} changed"
                    )

            for asset in normalized_assets:
                existing_blob = connection.execute(
                    """
                    SELECT content, size_bytes
                    FROM workspace_config_draft_asset_blobs
                    WHERE content_digest = ?
                    """,
                    (asset["content_digest"],),
                ).fetchone()
                if existing_blob is None:
                    connection.execute(
                        """
                        INSERT INTO workspace_config_draft_asset_blobs(
                            content_digest, content, size_bytes, created_at
                        ) VALUES (?, ?, ?, ?)
                        """,
                        (
                            asset["content_digest"],
                            asset["content"],
                            asset["size_bytes"],
                            timestamp,
                        ),
                    )
                elif (
                    bytes(existing_blob["content"]) != asset["content"]
                    or int(existing_blob["size_bytes"]) != asset["size_bytes"]
                ):
                    raise IdempotencyConflictError(
                        "content-addressed draft asset conflicts with stored bytes"
                    )
                connection.execute(
                    """
                    INSERT INTO workspace_config_draft_assets(
                        space_id, draft_version, document_digest, logical_path,
                        content_digest, media_type, size_bytes, executable,
                        provenance, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        space_id,
                        result_version,
                        document_digest,
                        asset["logical_path"],
                        asset["content_digest"],
                        asset["media_type"],
                        asset["size_bytes"],
                        int(asset["executable"]),
                        asset["provenance"],
                        timestamp,
                    ),
                )

            connection.execute(
                """
                INSERT INTO workspace_agent_plugin_import_requests(
                    client_request_id, space_id,
                    expected_target_draft_version,
                    expected_review_digest, requested_by, request_digest,
                    result_version, result_base_revision_id,
                    result_document_json, result_document_digest,
                    result_updated_by, result_created_at, result_updated_at,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    client_request_id,
                    space_id,
                    expected_target_draft_version,
                    review_digest,
                    updated_by,
                    request_digest,
                    result_version,
                    base_revision_id,
                    encoded,
                    document_digest,
                    updated_by,
                    created_at,
                    timestamp,
                    timestamp,
                ),
            )
            persisted = connection.execute(
                "SELECT * FROM workspace_config_drafts WHERE space_id = ?",
                (space_id,),
            ).fetchone()
            assert persisted is not None
            return self._workspace_config_draft_from_row(persisted)

    def replay_workspace_config_draft_import(
        self,
        *,
        client_request_id: str,
        space_id: str,
        expected_target_draft_version: int,
        expected_review_digest: str,
        updated_by: str,
    ) -> WorkspaceConfigDraftRecord | None:
        """Return a durable conversion response without rereading its source."""

        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_agent_plugin_import_requests
                WHERE client_request_id = ?
                """,
                (client_request_id,),
            ).fetchone()
        if row is None:
            return None
        if (
            row["space_id"] != space_id
            or int(row["expected_target_draft_version"])
            != expected_target_draft_version
            or row["expected_review_digest"] != expected_review_digest
            or row["requested_by"] != updated_by
        ):
            raise IdempotencyConflictError(
                "Agent Plugin import request id was reused"
            )
        return self._workspace_config_draft_from_import_request(row)

    def list_workspace_config_draft_assets(
        self,
        *,
        space_id: str,
        draft_version: int,
        document_digest: str | None = None,
    ) -> tuple[WorkspaceConfigDraftAssetRecord, ...]:
        """Read the exact imported bytes without depending on the source path."""

        query = """
            SELECT a.*, b.content
            FROM workspace_config_draft_assets AS a
            JOIN workspace_config_draft_asset_blobs AS b
              ON b.content_digest = a.content_digest
            WHERE a.space_id = ? AND a.draft_version = ?
        """
        parameters: list[Any] = [space_id, draft_version]
        if document_digest is not None:
            query += " AND a.document_digest = ?"
            parameters.append(document_digest)
        query += " ORDER BY a.logical_path"
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
        return tuple(
            WorkspaceConfigDraftAssetRecord(
                space_id=row["space_id"],
                draft_version=int(row["draft_version"]),
                document_digest=row["document_digest"],
                logical_path=row["logical_path"],
                content_digest=row["content_digest"],
                media_type=row["media_type"],
                size_bytes=int(row["size_bytes"]),
                executable=bool(row["executable"]),
                provenance=row["provenance"],
                content=bytes(row["content"]),
                created_at=float(row["created_at"]),
            )
            for row in rows
        )

    def list_workspace_config_draft_asset_descriptors(
        self,
        *,
        space_id: str,
        draft_version: int,
        document_digest: str | None = None,
    ) -> tuple[WorkspaceConfigDraftAssetDescriptorRecord, ...]:
        """List prepared assets without loading their BLOB content."""

        query = """
            SELECT * FROM workspace_config_draft_assets
            WHERE space_id = ? AND draft_version = ?
        """
        parameters: list[Any] = [space_id, draft_version]
        if document_digest is not None:
            query += " AND document_digest = ?"
            parameters.append(document_digest)
        query += " ORDER BY logical_path"
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
        return tuple(
            self._workspace_config_draft_asset_descriptor_from_row(row)
            for row in rows
        )

    def list_workspace_config_draft_asset_descriptor_snapshots(
        self,
        *,
        space_id: str,
        document_digest: str,
    ) -> tuple[tuple[WorkspaceConfigDraftAssetDescriptorRecord, ...], ...]:
        """List every persisted asset snapshot for one immutable document.

        A Cloud publish receipt may arrive after the mutable draft has advanced.
        Recovery must therefore compare the Cloud asset set with a historical
        ``(draft_version, document_digest)`` snapshot, never with the current
        draft version paired with the old digest.
        """

        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM workspace_config_draft_assets
                WHERE space_id = ? AND document_digest = ?
                ORDER BY draft_version, logical_path
                """,
                (space_id, document_digest),
            ).fetchall()
        snapshots: dict[
            int, list[WorkspaceConfigDraftAssetDescriptorRecord]
        ] = {}
        for row in rows:
            descriptor = (
                self._workspace_config_draft_asset_descriptor_from_row(row)
            )
            snapshots.setdefault(descriptor.draft_version, []).append(
                descriptor
            )
        return tuple(
            tuple(snapshots[version]) for version in sorted(snapshots)
        )

    def get_workspace_config_draft_asset(
        self,
        *,
        space_id: str,
        draft_version: int,
        document_digest: str,
        logical_path: str,
        content_digest: str,
    ) -> WorkspaceConfigDraftAssetRecord | None:
        """Load one exact prepared asset for bounded Brain-to-Cloud upload."""

        with self._lock:
            row = self._connection.execute(
                """
                SELECT a.*, b.content
                FROM workspace_config_draft_assets AS a
                JOIN workspace_config_draft_asset_blobs AS b
                  ON b.content_digest = a.content_digest
                WHERE a.space_id = ?
                  AND a.draft_version = ?
                  AND a.document_digest = ?
                  AND a.logical_path = ?
                  AND a.content_digest = ?
                """,
                (
                    space_id,
                    draft_version,
                    document_digest,
                    logical_path,
                    content_digest,
                ),
            ).fetchone()
        if row is None:
            return None
        return WorkspaceConfigDraftAssetRecord(
            space_id=row["space_id"],
            draft_version=int(row["draft_version"]),
            document_digest=row["document_digest"],
            logical_path=row["logical_path"],
            content_digest=row["content_digest"],
            media_type=row["media_type"],
            size_bytes=int(row["size_bytes"]),
            executable=bool(row["executable"]),
            provenance=row["provenance"],
            content=bytes(row["content"]),
            created_at=float(row["created_at"]),
        )

    def finalize_workspace_config_publish(
        self,
        *,
        space_id: str,
        expected_draft_version: int,
        revision_id: str,
        manifest_digest: str,
        published_manifest: dict[str, Any],
        actor_id: str,
        now: float | None = None,
    ) -> tuple[
        WorkspaceConfigRevisionRecord,
        WorkspaceConfigDraftRecord,
    ]:
        """Record a Cloud-published revision without activating it locally."""

        if len(manifest_digest) != 64:
            raise ValueError("manifest_digest must be a SHA-256 digest")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            draft = connection.execute(
                "SELECT * FROM workspace_config_drafts WHERE space_id = ?",
                (space_id,),
            ).fetchone()
            if draft is None:
                raise RunNotFoundError(
                    f"workspace configuration for {space_id!r} does not exist"
                )
            if int(draft["version"]) < expected_draft_version:
                raise OptimisticConcurrencyError(
                    f"workspace configuration for {space_id!r} changed"
                )
            if (
                not revision_id.startswith("wbr_")
                or len(revision_id) != 36
                or set(revision_id[4:]) - set("0123456789abcdef")
            ):
                raise ValueError("invalid revision_id")
            published_json = canonical_json(published_manifest)
            if canonical_digest(published_manifest) != manifest_digest:
                raise IdempotencyConflictError(
                    "published manifest digest does not match its content"
                )
            published_metadata = published_manifest.get("metadata", {})
            if (
                not isinstance(published_metadata.get("id"), str)
                or not isinstance(published_metadata.get("revision"), int)
                or isinstance(published_metadata.get("revision"), bool)
                or published_metadata.get("revision", 0) < 1
            ):
                raise IdempotencyConflictError(
                    "published manifest identity is invalid"
                )
            receipt_bundle_id = str(published_metadata["id"])
            receipt_revision_number = int(published_metadata["revision"])
            revision = connection.execute(
                """
                SELECT * FROM workspace_config_revisions
                WHERE revision_id = ?
                   OR (bundle_id = ? AND revision_number = ?)
                """,
                (revision_id, receipt_bundle_id, receipt_revision_number),
            ).fetchone()
            expected_revision = (
                revision_id,
                receipt_bundle_id,
                receipt_revision_number,
                published_json,
                manifest_digest,
            )
            actual_revision = (
                (
                    revision["revision_id"],
                    revision["bundle_id"],
                    int(revision["revision_number"]),
                    revision["manifest_json"],
                    revision["manifest_digest"],
                )
                if revision is not None
                else None
            )
            if revision is None:
                connection.execute(
                    """
                    INSERT INTO workspace_config_revisions(
                        revision_id, bundle_id, revision_number,
                        status, version, manifest_json, manifest_digest,
                        created_by, created_at
                    ) VALUES (?, ?, ?, 'published', 0, ?, ?, ?, ?)
                    """,
                    (
                        revision_id,
                        receipt_bundle_id,
                        receipt_revision_number,
                        published_json,
                        manifest_digest,
                        actor_id,
                        timestamp,
                    ),
                )
            elif actual_revision != expected_revision:
                raise IdempotencyConflictError(
                    "local revision conflicts with the Cloud publish"
                )
            elif revision["status"] in {"draft", "validated"}:
                connection.execute(
                    """
                    UPDATE workspace_config_revisions
                    SET status = 'published', version = version + 1
                    WHERE revision_id = ?
                      AND status IN ('draft', 'validated')
                    """,
                    (revision_id,),
                )
            elif revision["status"] != "published":
                raise InvalidRunTransitionError(
                    "local revision cannot become published"
                )

            if draft["base_revision_id"] != revision_id:
                document = json.loads(draft["document_json"])
                metadata = document.get("metadata", {})
                if (
                    metadata.get("id") != receipt_bundle_id
                    or metadata.get("revision") != receipt_revision_number
                ):
                    raise IdempotencyConflictError(
                        "published revision cannot rebase this working copy"
                    )
                # Whether unchanged or edited concurrently, keep the current
                # working content and move it to the next revision. The Cloud
                # fact remains immutable at N while local edits continue at
                # N+1 instead of being stranded behind a permanent conflict.
                document["metadata"]["revision"] = receipt_revision_number + 1
                next_json = canonical_json(document)
                next_digest = canonical_digest(document)
                updated = connection.execute(
                    """
                    UPDATE workspace_config_drafts
                    SET version = version + 1,
                        base_revision_id = ?,
                        document_json = ?,
                        document_digest = ?,
                        updated_by = ?,
                        updated_at = ?
                    WHERE space_id = ? AND version = ?
                    """,
                    (
                        revision_id,
                        next_json,
                        next_digest,
                        actor_id,
                        timestamp,
                        space_id,
                        int(draft["version"]),
                    ),
                )
                if updated.rowcount != 1:
                    raise OptimisticConcurrencyError(
                        f"workspace configuration for {space_id!r} changed"
                    )
                connection.execute(
                    """
                    INSERT INTO workspace_config_draft_assets(
                        space_id, draft_version, document_digest, logical_path,
                        content_digest, media_type, size_bytes, executable,
                        provenance, created_at
                    )
                    SELECT space_id, ?, ?, logical_path, content_digest,
                           media_type, size_bytes, executable, provenance, ?
                    FROM workspace_config_draft_assets
                    WHERE space_id = ? AND draft_version = ?
                    """,
                    (
                        int(draft["version"]) + 1,
                        next_digest,
                        timestamp,
                        space_id,
                        int(draft["version"]),
                    ),
                )
            revision = connection.execute(
                "SELECT * FROM workspace_config_revisions WHERE revision_id = ?",
                (revision_id,),
            ).fetchone()
            draft = connection.execute(
                "SELECT * FROM workspace_config_drafts WHERE space_id = ?",
                (space_id,),
            ).fetchone()
            assert revision is not None and draft is not None
            return (
                self._workspace_config_revision_from_row(revision),
                self._workspace_config_draft_from_row(draft),
            )

    def put_workspace_bundle_install_proposal(
        self,
        *,
        proposal_id: str,
        request_id: str,
        space_id: str,
        bundle_id: str,
        revision_id: str,
        config_placement: str,
        manifest: dict[str, Any],
        assets: list[dict[str, Any]],
        install_plan: dict[str, Any],
        now: float | None = None,
    ) -> WorkspaceBundleInstallProposalRecord:
        """Persist a reviewable install proposal without granting anything."""

        if any(
            not value.strip()
            for value in (
                proposal_id,
                request_id,
                space_id,
                bundle_id,
                revision_id,
            )
        ):
            raise ValueError("Bundle install proposal identity is required")
        if config_placement not in {"in_repo", "sidecar"}:
            raise ValueError("invalid config_placement")
        timestamp = now if now is not None else time.time()
        manifest_json = canonical_json(manifest)
        manifest_digest = canonical_digest(manifest)
        assets_json = canonical_json(assets)
        plan_json = canonical_json(install_plan)
        expected = (
            proposal_id,
            request_id,
            space_id,
            bundle_id,
            revision_id,
            config_placement,
            manifest_json,
            manifest_digest,
            assets_json,
            plan_json,
        )
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM workspace_bundle_install_proposals
                WHERE proposal_id = ? OR request_id = ?
                """,
                (proposal_id, request_id),
            ).fetchone()
            if row is not None:
                actual = (
                    row["proposal_id"],
                    row["request_id"],
                    row["space_id"],
                    row["bundle_id"],
                    row["revision_id"],
                    row["config_placement"],
                    row["manifest_json"],
                    row["manifest_digest"],
                    row["assets_json"],
                    row["install_plan_json"],
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        "Bundle install request was reused with another payload"
                    )
                return self._workspace_bundle_install_proposal_from_row(row)
            connection.execute(
                """
                INSERT INTO workspace_bundle_install_proposals(
                    proposal_id, request_id, space_id, bundle_id,
                    revision_id, config_placement, state, version,
                    manifest_json, manifest_digest, assets_json,
                    install_plan_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'proposed', 0, ?, ?, ?, ?, ?, ?)
                """,
                (
                    proposal_id,
                    request_id,
                    space_id,
                    bundle_id,
                    revision_id,
                    config_placement,
                    manifest_json,
                    manifest_digest,
                    assets_json,
                    plan_json,
                    timestamp,
                    timestamp,
                ),
            )
            row = connection.execute(
                """SELECT * FROM workspace_bundle_install_proposals
                WHERE proposal_id = ?""",
                (proposal_id,),
            ).fetchone()
            assert row is not None
            return self._workspace_bundle_install_proposal_from_row(row)

    def get_workspace_bundle_install_proposal(
        self, proposal_id: str
    ) -> WorkspaceBundleInstallProposalRecord | None:
        with self._lock:
            row = self._connection.execute(
                """SELECT * FROM workspace_bundle_install_proposals
                WHERE proposal_id = ?""",
                (proposal_id,),
            ).fetchone()
            return (
                self._workspace_bundle_install_proposal_from_row(row)
                if row is not None
                else None
            )

    def get_materialized_workspace_bundle_proposal(
        self, *, space_id: str, revision_id: str
    ) -> WorkspaceBundleInstallProposalRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_bundle_install_proposals
                WHERE space_id = ? AND revision_id = ?
                  AND state = 'materialized'
                ORDER BY updated_at DESC, proposal_id DESC
                LIMIT 1
                """,
                (space_id, revision_id),
            ).fetchone()
            return (
                self._workspace_bundle_install_proposal_from_row(row)
                if row is not None
                else None
            )

    def get_active_workspace_bundle_proposal(
        self, *, space_id: str, revision_id: str
    ) -> WorkspaceBundleInstallProposalRecord | None:
        """Return the proposal that currently controls an installed revision.

        Review-only proposals are deliberately excluded: creating a second
        proposal must not disable a currently usable installation. Once an
        approved proposal begins materialization, its state becomes an
        admission gate until materialization completes.
        """

        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_bundle_install_proposals
                WHERE space_id = ? AND revision_id = ?
                  AND state IN (
                      'materializing', 'materialized', 'needs_attention'
                  )
                ORDER BY updated_at DESC, proposal_id DESC
                LIMIT 1
                """,
                (space_id, revision_id),
            ).fetchone()
            return (
                self._workspace_bundle_install_proposal_from_row(row)
                if row is not None
                else None
            )

    def get_latest_workspace_bundle_install_proposal(
        self,
        *,
        space_id: str,
    ) -> WorkspaceBundleInstallProposalRecord | None:
        """Return the durable install/setup flow currently owned by a Space."""

        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_bundle_install_proposals
                WHERE space_id = ? AND state != 'rejected'
                ORDER BY updated_at DESC, proposal_id DESC
                LIMIT 1
                """,
                (space_id,),
            ).fetchone()
            return (
                self._workspace_bundle_install_proposal_from_row(row)
                if row is not None
                else None
            )

    def transition_workspace_bundle_install_proposal(
        self,
        proposal_id: str,
        *,
        expected_version: int,
        state: str,
        decided_by: str | None = None,
        error_code: str | None = None,
        now: float | None = None,
    ) -> WorkspaceBundleInstallProposalRecord:
        allowed = {
            "proposed": {"approved", "rejected"},
            "approved": {"materializing", "rejected"},
            "materializing": {"materialized", "needs_attention"},
            "needs_attention": {"materializing", "rejected"},
            "materialized": set(),
            "rejected": set(),
        }
        if state not in allowed:
            raise ValueError("invalid Bundle install proposal state")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                """SELECT * FROM workspace_bundle_install_proposals
                WHERE proposal_id = ?""",
                (proposal_id,),
            ).fetchone()
            if row is None:
                raise RunNotFoundError(
                    f"Bundle install proposal {proposal_id!r} does not exist"
                )
            if row["state"] == state:
                if state in {"approved", "rejected"} and (
                    not decided_by or row["decided_by"] != decided_by
                ):
                    raise IdempotencyConflictError(
                        "Bundle install decision actor does not match replay"
                    )
                return self._workspace_bundle_install_proposal_from_row(row)
            if int(row["version"]) != expected_version:
                raise OptimisticConcurrencyError(
                    f"Bundle install proposal {proposal_id!r} changed"
                )
            if state not in allowed[row["state"]]:
                raise InvalidRunTransitionError(
                    f"Bundle install proposal cannot move from "
                    f"{row['state']!r} to {state!r}"
                )
            decision_actor = row["decided_by"]
            decision_at = row["decided_at"]
            if state in {"approved", "rejected"}:
                if not decided_by or not decided_by.strip():
                    raise ValueError(
                        "decided_by is required for user decision"
                    )
                decision_actor = decided_by
                decision_at = timestamp
            updated = connection.execute(
                """
                UPDATE workspace_bundle_install_proposals
                SET state = ?, version = version + 1,
                    decided_by = ?, decided_at = ?, error_code = ?,
                    updated_at = ?
                WHERE proposal_id = ? AND version = ? AND state = ?
                """,
                (
                    state,
                    decision_actor,
                    decision_at,
                    error_code,
                    timestamp,
                    proposal_id,
                    expected_version,
                    row["state"],
                ),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    f"Bundle install proposal {proposal_id!r} changed"
                )
            row = connection.execute(
                """SELECT * FROM workspace_bundle_install_proposals
                WHERE proposal_id = ?""",
                (proposal_id,),
            ).fetchone()
            assert row is not None
            return self._workspace_bundle_install_proposal_from_row(row)

    def put_workspace_bundle_local_binding(
        self,
        *,
        proposal_id: str,
        expected_proposal_version: int,
        slot_id: str,
        binding_kind: str,
        connector_id: str | None,
        opaque_connection_id: str | None,
        local_path: str | None,
        required_grants: list[str],
        authorized_by: str,
        now: float | None = None,
    ) -> tuple[
        WorkspaceBundleLocalBindingRecord,
        WorkspaceBundleInstallProposalRecord,
    ]:
        if binding_kind not in {"connector", "local_path", "script_approval"}:
            raise ValueError("invalid Bundle local binding kind")
        if not slot_id.strip() or not authorized_by.strip():
            raise ValueError("binding slot and authorizer are required")
        if binding_kind == "connector" and (
            not connector_id or not opaque_connection_id
        ):
            raise ValueError(
                "connector binding requires connector and connection ids"
            )
        if binding_kind == "local_path" and not local_path:
            raise ValueError("local path binding requires a path")
        if binding_kind == "script_approval" and any(
            value is not None
            for value in (connector_id, opaque_connection_id, local_path)
        ):
            raise ValueError("script approval cannot carry a resource binding")
        binding_id = (
            "bundlebind_"
            + canonical_digest(
                {"proposal_id": proposal_id, "slot_id": slot_id}
            )[:32]
        )
        grants_json = canonical_json(sorted(set(required_grants)))
        expected = (
            binding_id,
            proposal_id,
            slot_id,
            binding_kind,
            connector_id,
            opaque_connection_id,
            local_path,
            grants_json,
            authorized_by,
        )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            proposal = connection.execute(
                """SELECT * FROM workspace_bundle_install_proposals
                WHERE proposal_id = ?""",
                (proposal_id,),
            ).fetchone()
            if proposal is None:
                raise RunNotFoundError(
                    f"Bundle install proposal {proposal_id!r} does not exist"
                )
            row = connection.execute(
                """SELECT * FROM workspace_bundle_local_bindings
                WHERE proposal_id = ? AND slot_id = ?""",
                (proposal_id, slot_id),
            ).fetchone()
            if row is not None:
                actual_resource = (
                    row["binding_kind"],
                    row["connector_id"],
                    row["opaque_connection_id"],
                    row["local_path"],
                    row["required_grants_json"],
                )
                desired_resource = (
                    binding_kind,
                    connector_id,
                    opaque_connection_id,
                    local_path,
                    grants_json,
                )
                if actual_resource == desired_resource:
                    return (
                        self._workspace_bundle_local_binding_from_row(row),
                        self._workspace_bundle_install_proposal_from_row(
                            proposal
                        ),
                    )
                if int(proposal["version"]) != expected_proposal_version:
                    raise OptimisticConcurrencyError(
                        f"Bundle install proposal {proposal_id!r} changed"
                    )
                if proposal["state"] not in {
                    "approved",
                    "needs_attention",
                    "materialized",
                }:
                    raise InvalidRunTransitionError(
                        "Bundle resources can only be rebound after approval"
                    )
                connection.execute(
                    """UPDATE workspace_bundle_local_bindings
                    SET binding_kind = ?, connector_id = ?,
                        opaque_connection_id = ?, local_path = ?,
                        required_grants_json = ?, authorized_by = ?,
                        authorized_at = ?
                    WHERE binding_id = ?""",
                    (
                        binding_kind,
                        connector_id,
                        opaque_connection_id,
                        local_path,
                        grants_json,
                        authorized_by,
                        timestamp,
                        binding_id,
                    ),
                )
                connection.execute(
                    """UPDATE workspace_bundle_install_proposals
                    SET version = version + 1,
                        state = CASE WHEN state = 'materialized'
                            THEN 'needs_attention' ELSE state END,
                        error_code = CASE WHEN state = 'materialized'
                            THEN 'bundle_reconfiguration_pending'
                            ELSE error_code END,
                        updated_at = ?
                    WHERE proposal_id = ? AND version = ?""",
                    (timestamp, proposal_id, expected_proposal_version),
                )
                row = connection.execute(
                    """SELECT * FROM workspace_bundle_local_bindings
                    WHERE binding_id = ?""",
                    (binding_id,),
                ).fetchone()
                proposal = connection.execute(
                    """SELECT * FROM workspace_bundle_install_proposals
                    WHERE proposal_id = ?""",
                    (proposal_id,),
                ).fetchone()
                assert row is not None and proposal is not None
                return (
                    self._workspace_bundle_local_binding_from_row(row),
                    self._workspace_bundle_install_proposal_from_row(proposal),
                )
            if int(proposal["version"]) != expected_proposal_version:
                raise OptimisticConcurrencyError(
                    f"Bundle install proposal {proposal_id!r} changed"
                )
            if proposal["state"] not in {
                "approved",
                "needs_attention",
                "materialized",
            }:
                raise InvalidRunTransitionError(
                    "Bundle resources can only be bound after approval"
                )
            connection.execute(
                """
                INSERT INTO workspace_bundle_local_bindings(
                    binding_id, proposal_id, slot_id, binding_kind,
                    connector_id, opaque_connection_id, local_path,
                    required_grants_json, authorized_by, authorized_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (*expected, timestamp),
            )
            connection.execute(
                """UPDATE workspace_bundle_install_proposals
                SET version = version + 1,
                    state = CASE WHEN state = 'materialized'
                        THEN 'needs_attention' ELSE state END,
                    error_code = CASE WHEN state = 'materialized'
                        THEN 'bundle_reconfiguration_pending'
                        ELSE error_code END,
                    updated_at = ?
                WHERE proposal_id = ? AND version = ?""",
                (timestamp, proposal_id, expected_proposal_version),
            )
            row = connection.execute(
                """SELECT * FROM workspace_bundle_local_bindings
                WHERE binding_id = ?""",
                (binding_id,),
            ).fetchone()
            proposal = connection.execute(
                """SELECT * FROM workspace_bundle_install_proposals
                WHERE proposal_id = ?""",
                (proposal_id,),
            ).fetchone()
            assert row is not None and proposal is not None
            return (
                self._workspace_bundle_local_binding_from_row(row),
                self._workspace_bundle_install_proposal_from_row(proposal),
            )

    def list_workspace_bundle_local_bindings(
        self, proposal_id: str
    ) -> tuple[WorkspaceBundleLocalBindingRecord, ...]:
        with self._lock:
            rows = self._connection.execute(
                """SELECT * FROM workspace_bundle_local_bindings
                WHERE proposal_id = ? ORDER BY slot_id""",
                (proposal_id,),
            ).fetchall()
            return tuple(
                self._workspace_bundle_local_binding_from_row(row)
                for row in rows
            )

    def put_workspace_bundle_secret_bindings(
        self,
        *,
        proposal_id: str,
        client_request_id: str,
        expected_proposal_version: int,
        bindings: list[dict[str, Any]],
        authorized_by: str,
        now: float | None = None,
    ) -> tuple[
        tuple[WorkspaceBundleSecretBindingRecord, ...],
        WorkspaceBundleInstallProposalRecord,
    ]:
        """CAS opaque vault references without ever accepting secret values."""

        if not client_request_id.strip() or not authorized_by.strip():
            raise ValueError("binding request and authorizer are required")
        if not bindings:
            raise ValueError("at least one secret binding is required")
        normalized: list[dict[str, Any]] = []
        keys: set[str] = set()
        allowed_ref_characters = (
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        )
        for item in bindings:
            requirement_key = str(item.get("requirement_key") or "")
            requirement_kind = str(item.get("requirement_kind") or "")
            secret_ref = str(item.get("secret_ref") or "")
            account_scope_digest = str(item.get("account_scope_digest") or "")
            expected_binding_version = item.get("expected_binding_version")
            if expected_binding_version is not None:
                expected_binding_version = int(expected_binding_version)
                if expected_binding_version < 1:
                    raise ValueError("invalid Bundle secret binding version")
            if requirement_kind not in {"environment", "mcp_secret"}:
                raise ValueError("invalid Bundle secret binding kind")
            if (
                not requirement_key.strip()
                or len(secret_ref) != 40
                or not secret_ref.startswith("wsvault_")
                or any(
                    character not in allowed_ref_characters
                    for character in secret_ref[8:]
                )
                or not self._is_sha256(account_scope_digest)
            ):
                raise ValueError("invalid Bundle secret binding reference")
            if requirement_key in keys:
                raise ValueError("duplicate Bundle secret binding requirement")
            keys.add(requirement_key)
            normalized.append(
                {
                    "requirement_key": requirement_key,
                    "requirement_kind": requirement_kind,
                    "secret_ref": secret_ref,
                    "account_scope_digest": account_scope_digest,
                    "expected_binding_version": expected_binding_version,
                }
            )
        normalized.sort(key=lambda item: str(item["requirement_key"]))
        request_digest = canonical_digest(
            {
                "proposal_id": proposal_id,
                "bindings": normalized,
                "authorized_by": authorized_by,
            }
        )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            receipt = connection.execute(
                """SELECT request_digest
                FROM workspace_bundle_secret_binding_requests
                WHERE client_request_id = ?""",
                (client_request_id,),
            ).fetchone()
            if receipt is not None:
                if receipt["request_digest"] != request_digest:
                    raise IdempotencyConflictError(
                        "Bundle secret binding request id was reused"
                    )
                rows = connection.execute(
                    """SELECT * FROM workspace_bundle_secret_bindings
                    WHERE proposal_id = ? AND requirement_key IN (
                        SELECT value FROM json_each(?)
                    ) ORDER BY requirement_key""",
                    (
                        proposal_id,
                        json.dumps(
                            [item["requirement_key"] for item in normalized],
                            separators=(",", ":"),
                        ),
                    ),
                ).fetchall()
                proposal = connection.execute(
                    """SELECT * FROM workspace_bundle_install_proposals
                    WHERE proposal_id = ?""",
                    (proposal_id,),
                ).fetchone()
                if proposal is None:
                    raise RunNotFoundError(
                        f"Bundle install proposal {proposal_id!r} does not exist"
                    )
                return (
                    tuple(
                        self._workspace_bundle_secret_binding_from_row(row)
                        for row in rows
                    ),
                    self._workspace_bundle_install_proposal_from_row(proposal),
                )
            proposal = connection.execute(
                """SELECT * FROM workspace_bundle_install_proposals
                WHERE proposal_id = ?""",
                (proposal_id,),
            ).fetchone()
            if proposal is None:
                raise RunNotFoundError(
                    f"Bundle install proposal {proposal_id!r} does not exist"
                )
            if int(proposal["version"]) != expected_proposal_version:
                raise OptimisticConcurrencyError(
                    f"Bundle install proposal {proposal_id!r} changed"
                )
            if proposal["state"] not in {
                "approved",
                "needs_attention",
                "materialized",
            }:
                raise InvalidRunTransitionError(
                    "Bundle values can only be bound after approval"
                )
            changed = False
            for item in normalized:
                requirement_key = str(item["requirement_key"])
                existing = connection.execute(
                    """SELECT * FROM workspace_bundle_secret_bindings
                    WHERE proposal_id = ? AND requirement_key = ?""",
                    (proposal_id, requirement_key),
                ).fetchone()
                expected_binding_version = item["expected_binding_version"]
                if existing is None:
                    if expected_binding_version is not None:
                        raise OptimisticConcurrencyError(
                            f"Bundle value {requirement_key!r} changed"
                        )
                    binding_id = (
                        "bundlesecret_"
                        + canonical_digest(
                            {
                                "proposal_id": proposal_id,
                                "requirement_key": requirement_key,
                            }
                        )[:32]
                    )
                    connection.execute(
                        """INSERT INTO workspace_bundle_secret_bindings(
                            binding_id, proposal_id, requirement_key,
                            requirement_kind, binding_version, secret_ref,
                            account_scope_digest, authorized_by,
                            authorized_at, updated_at
                        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)""",
                        (
                            binding_id,
                            proposal_id,
                            requirement_key,
                            item["requirement_kind"],
                            item["secret_ref"],
                            item["account_scope_digest"],
                            authorized_by,
                            timestamp,
                            timestamp,
                        ),
                    )
                    changed = True
                    continue
                if (
                    expected_binding_version is not None
                    and int(existing["binding_version"])
                    != expected_binding_version
                ):
                    raise OptimisticConcurrencyError(
                        f"Bundle value {requirement_key!r} changed"
                    )
                desired = (
                    item["requirement_kind"],
                    item["secret_ref"],
                    item["account_scope_digest"],
                )
                actual = (
                    existing["requirement_kind"],
                    existing["secret_ref"],
                    existing["account_scope_digest"],
                )
                if desired == actual:
                    continue
                if expected_binding_version is None:
                    raise IdempotencyConflictError(
                        f"Bundle value {requirement_key!r} already exists"
                    )
                connection.execute(
                    """UPDATE workspace_bundle_secret_bindings
                    SET requirement_kind = ?, binding_version = binding_version + 1,
                        secret_ref = ?,
                        account_scope_digest = ?, authorized_by = ?,
                        authorized_at = ?, updated_at = ?
                    WHERE binding_id = ?""",
                    (
                        item["requirement_kind"],
                        item["secret_ref"],
                        item["account_scope_digest"],
                        authorized_by,
                        timestamp,
                        timestamp,
                        existing["binding_id"],
                    ),
                )
                changed = True
            connection.execute(
                """INSERT INTO workspace_bundle_secret_binding_requests(
                    client_request_id, proposal_id, request_digest, created_at
                ) VALUES (?, ?, ?, ?)""",
                (
                    client_request_id,
                    proposal_id,
                    request_digest,
                    timestamp,
                ),
            )
            if changed:
                connection.execute(
                    """UPDATE workspace_bundle_install_proposals
                    SET version = version + 1, updated_at = ?
                    WHERE proposal_id = ? AND version = ?""",
                    (timestamp, proposal_id, expected_proposal_version),
                )
            rows = connection.execute(
                """SELECT * FROM workspace_bundle_secret_bindings
                WHERE proposal_id = ? AND requirement_key IN (
                    SELECT value FROM json_each(?)
                ) ORDER BY requirement_key""",
                (
                    proposal_id,
                    json.dumps(
                        [item["requirement_key"] for item in normalized],
                        separators=(",", ":"),
                    ),
                ),
            ).fetchall()
            proposal = connection.execute(
                """SELECT * FROM workspace_bundle_install_proposals
                WHERE proposal_id = ?""",
                (proposal_id,),
            ).fetchone()
            assert proposal is not None
            return (
                tuple(
                    self._workspace_bundle_secret_binding_from_row(row)
                    for row in rows
                ),
                self._workspace_bundle_install_proposal_from_row(proposal),
            )

    def list_workspace_bundle_secret_bindings(
        self, proposal_id: str
    ) -> tuple[WorkspaceBundleSecretBindingRecord, ...]:
        with self._lock:
            rows = self._connection.execute(
                """SELECT * FROM workspace_bundle_secret_bindings
                WHERE proposal_id = ? ORDER BY requirement_key""",
                (proposal_id,),
            ).fetchall()
            return tuple(
                self._workspace_bundle_secret_binding_from_row(row)
                for row in rows
            )

    def transition_workspace_config_revision(
        self,
        revision_id: str,
        *,
        expected_version: int,
        status: str,
    ) -> WorkspaceConfigRevisionRecord:
        """CAS the Bundle lifecycle without making its manifest mutable."""

        allowed = {
            "draft": {"validated"},
            "validated": {"published"},
            "published": {"deprecated"},
            "deprecated": set(),
        }
        if status not in allowed:
            raise ValueError("invalid workspace config revision status")
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM workspace_config_revisions
                WHERE revision_id = ?
                """,
                (revision_id,),
            ).fetchone()
            if row is None:
                raise RunNotFoundError(
                    f"workspace config revision {revision_id!r} does not exist"
                )
            if int(row["version"]) != expected_version:
                raise OptimisticConcurrencyError(
                    f"workspace config revision {revision_id!r} expected "
                    f"version {expected_version}, found {row['version']}"
                )
            if row["status"] == status:
                return self._workspace_config_revision_from_row(row)
            if status not in allowed[row["status"]]:
                raise InvalidRunTransitionError(
                    f"workspace config revision {revision_id!r} cannot move "
                    f"from {row['status']!r} to {status!r}"
                )
            updated = connection.execute(
                """
                UPDATE workspace_config_revisions
                SET status = ?, version = version + 1
                WHERE revision_id = ? AND version = ? AND status = ?
                """,
                (
                    status,
                    revision_id,
                    expected_version,
                    row["status"],
                ),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    f"workspace config revision {revision_id!r} changed "
                    "during transition"
                )
            row = connection.execute(
                """
                SELECT * FROM workspace_config_revisions
                WHERE revision_id = ?
                """,
                (revision_id,),
            ).fetchone()
            assert row is not None
            return self._workspace_config_revision_from_row(row)

    def put_effective_environment_spec(
        self,
        spec: EffectiveEnvironmentSpec,
        *,
        emit_run_event: bool = False,
        now: float | None = None,
    ) -> EffectiveEnvironmentSpecRecord:
        """Persist immutable local and redacted forms in one transaction."""

        timestamp = now if now is not None else time.time()
        local_payload = spec.local_payload()
        if canonical_digest(spec.semantic_spec) != spec.semantic_spec_digest:
            raise IdempotencyConflictError(
                "semantic EnvironmentSpec digest does not match its payload"
            )
        local_materialization_payload = spec.local_materialization.model_dump(
            exclude_none=True,
            mode="json",
        )
        if (
            canonical_digest(local_materialization_payload)
            != spec.local_materialization_digest
        ):
            raise IdempotencyConflictError(
                "local materialization digest does not match its payload"
            )
        spec_json = canonical_json(local_payload)
        environment_spec_digest = spec.digest
        redacted_payload = spec.cloud_projection()
        projection_digest = str(redacted_payload["projection_digest"])
        projection_body = {
            key: value
            for key, value in redacted_payload.items()
            if key != "projection_digest"
        }
        if canonical_digest(projection_body) != projection_digest:
            raise IdempotencyConflictError(
                "Cloud EnvironmentSpec projection digest is invalid"
            )
        redacted_spec_json = canonical_json(redacted_payload)
        with self._write_transaction() as connection:
            revision = connection.execute(
                """
                SELECT manifest_digest FROM workspace_config_revisions
                WHERE revision_id = ?
                """,
                (spec.bundle_revision_id,),
            ).fetchone()
            if revision is None:
                raise RunNotFoundError(
                    f"workspace config revision "
                    f"{spec.bundle_revision_id!r} does not exist"
                )
            if revision["manifest_digest"] != spec.manifest_digest:
                raise IdempotencyConflictError(
                    "EnvironmentSpec manifest digest does not match its "
                    "workspace config revision"
                )
            expected = (
                spec.spec_id,
                spec.owner_type,
                spec.owner_id,
                spec.bundle_revision_id,
                spec.manifest_digest,
                spec_json,
                environment_spec_digest,
                spec.semantic_spec_digest,
                spec.local_materialization_digest,
                redacted_spec_json,
                projection_digest,
                spec.permission_profile_revision,
                spec.provider_capability_revision,
            )
            row = connection.execute(
                """
                SELECT * FROM effective_environment_specs
                WHERE environment_spec_id = ?
                """,
                (spec.spec_id,),
            ).fetchone()
            if row is not None:
                actual = (
                    row["environment_spec_id"],
                    row["owner_type"],
                    row["owner_id"],
                    row["bundle_revision_id"],
                    row["manifest_digest"],
                    row["spec_json"],
                    row["environment_spec_digest"],
                    row["semantic_spec_digest"],
                    row["local_materialization_digest"],
                    row["redacted_spec_json"],
                    row["projection_digest"],
                    row["permission_profile_revision"],
                    row["provider_capability_revision"],
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"EnvironmentSpec {spec.spec_id!r} conflicts with "
                        "an existing immutable spec"
                    )
                if emit_run_event:
                    self._append_environment_resolved_event(
                        connection,
                        spec,
                        redacted_payload,
                        timestamp,
                    )
                return self._effective_environment_spec_from_row(row)
            connection.execute(
                """
                INSERT INTO effective_environment_specs(
                    environment_spec_id, owner_type, owner_id,
                    bundle_revision_id, manifest_digest, spec_json,
                    environment_spec_digest, semantic_spec_digest,
                    local_materialization_digest, redacted_spec_json,
                    projection_digest, permission_profile_revision,
                    provider_capability_revision, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (*expected, timestamp),
            )
            if emit_run_event:
                self._append_environment_resolved_event(
                    connection,
                    spec,
                    redacted_payload,
                    timestamp,
                )
            row = connection.execute(
                """
                SELECT * FROM effective_environment_specs
                WHERE environment_spec_id = ?
                """,
                (spec.spec_id,),
            ).fetchone()
            assert row is not None
            return self._effective_environment_spec_from_row(row)

    def _append_environment_resolved_event(
        self,
        connection: sqlite3.Connection,
        spec: EffectiveEnvironmentSpec,
        redacted_payload: dict[str, Any],
        timestamp: float,
    ) -> None:
        if spec.owner_type != "run":
            raise ValueError(
                "run.environment_resolved requires a Run-owned spec"
            )
        self._append_event_in_transaction(
            connection,
            spec.owner_id,
            RunEventDraft(
                event_id=f"environment:{spec.spec_id}:resolved",
                event_type="run.environment_resolved",
                payload=redacted_payload,
                created_at=timestamp,
            ),
        )

    def get_effective_environment_spec(
        self, environment_spec_id: str
    ) -> EffectiveEnvironmentSpecRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM effective_environment_specs
                WHERE environment_spec_id = ?
                """,
                (environment_spec_id,),
            ).fetchone()
            return (
                self._effective_environment_spec_from_row(row)
                if row is not None
                else None
            )

    def put_git_repository(
        self,
        *,
        repository_id: str,
        space_id: str,
        repository_role: str,
        root_path: str,
        root_path_digest: str,
        ownership: str,
        state: str,
        version_coverage: str,
        hooks_mode: str = "disabled",
        repo_subdir: str | None = None,
        now: float | None = None,
    ) -> GitRepositoryRecord:
        timestamp = now if now is not None else time.time()
        immutable_expected = (
            repository_id,
            space_id,
            repository_role,
            root_path,
            root_path_digest,
            ownership,
            version_coverage,
            hooks_mode,
            repo_subdir,
        )
        with self._write_transaction() as connection:
            by_identity = connection.execute(
                "SELECT * FROM git_repositories WHERE repository_id = ?",
                (repository_id,),
            ).fetchone()
            by_role = connection.execute(
                """
                SELECT * FROM git_repositories
                WHERE space_id = ? AND repository_role = ?
                """,
                (space_id, repository_role),
            ).fetchone()
            row = by_identity or by_role
            if row is not None:
                actual = (
                    row["repository_id"],
                    row["space_id"],
                    row["repository_role"],
                    row["root_path"],
                    row["root_path_digest"],
                    row["ownership"],
                    row["version_coverage"],
                    row["hooks_mode"],
                    row["repo_subdir"],
                )
                if actual != immutable_expected:
                    raise IdempotencyConflictError(
                        f"Git repository ownership for Space {space_id!r} "
                        "conflicts with the persisted binding"
                    )
                if row["state"] != state:
                    connection.execute(
                        """
                        UPDATE git_repositories
                        SET state = ?, version = version + 1, updated_at = ?
                        WHERE repository_id = ?
                        """,
                        (state, timestamp, row["repository_id"]),
                    )
                    row = connection.execute(
                        """
                        SELECT * FROM git_repositories
                        WHERE repository_id = ?
                        """,
                        (row["repository_id"],),
                    ).fetchone()
                    assert row is not None
                return self._git_repository_from_row(row)
            connection.execute(
                """
                INSERT INTO git_repositories(
                    repository_id, space_id, repository_role, root_path,
                    root_path_digest, ownership, state, version_coverage,
                    hooks_mode, repo_subdir, version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (
                    *immutable_expected[:6],
                    state,
                    *immutable_expected[6:],
                    timestamp,
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM git_repositories WHERE repository_id = ?",
                (repository_id,),
            ).fetchone()
            assert row is not None
            return self._git_repository_from_row(row)

    def update_git_repository_state(
        self,
        repository_id: str,
        *,
        state: str,
        expected_version: int,
        now: float | None = None,
    ) -> GitRepositoryRecord:
        if state not in {
            "ready",
            "not_enabled",
            "needs_attention",
            "degraded",
        }:
            raise ValueError(f"unsupported Git repository state {state!r}")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM git_repositories WHERE repository_id = ?",
                (repository_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown Git repository {repository_id!r}")
            if row["state"] == state:
                return self._git_repository_from_row(row)
            if int(row["version"]) != expected_version:
                raise IdempotencyConflictError(
                    f"Git repository {repository_id!r} changed concurrently"
                )
            connection.execute(
                """
                UPDATE git_repositories
                SET state = ?, version = version + 1, updated_at = ?
                WHERE repository_id = ? AND version = ?
                """,
                (state, timestamp, repository_id, expected_version),
            )
            row = connection.execute(
                "SELECT * FROM git_repositories WHERE repository_id = ?",
                (repository_id,),
            ).fetchone()
            assert row is not None
            return self._git_repository_from_row(row)

    def get_git_repository(
        self, repository_id: str
    ) -> GitRepositoryRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM git_repositories WHERE repository_id = ?",
                (repository_id,),
            ).fetchone()
            return (
                self._git_repository_from_row(row) if row is not None else None
            )

    def get_space_git_repository(
        self,
        *,
        space_id: str,
        repository_role: str = "content",
    ) -> GitRepositoryRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM git_repositories
                WHERE space_id = ? AND repository_role = ?
                """,
                (space_id, repository_role),
            ).fetchone()
            return (
                self._git_repository_from_row(row) if row is not None else None
            )

    def list_git_repositories(self) -> list[GitRepositoryRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM git_repositories
                ORDER BY created_at, repository_id
                """
            ).fetchall()
            return [self._git_repository_from_row(row) for row in rows]

    def begin_git_operation(
        self,
        *,
        operation_id: str,
        repository_id: str,
        request_id: str,
        operation_type: str,
        payload_digest: str,
        expected_repo_state_digest: str | None,
        now: float | None = None,
    ) -> GitOperationRecord:
        if len(payload_digest) != 64:
            raise ValueError("Git operation payload digest must be SHA-256")
        timestamp = now if now is not None else time.time()
        expected = (
            operation_id,
            repository_id,
            request_id,
            operation_type,
            payload_digest,
            expected_repo_state_digest,
        )
        with self._write_transaction() as connection:
            if (
                connection.execute(
                    "SELECT 1 FROM git_repositories WHERE repository_id = ?",
                    (repository_id,),
                ).fetchone()
                is None
            ):
                raise ValueError(f"unknown Git repository {repository_id!r}")
            row = connection.execute(
                """
                SELECT * FROM git_operations
                WHERE operation_id = ? OR (
                    repository_id = ? AND request_id = ?
                )
                """,
                (operation_id, repository_id, request_id),
            ).fetchone()
            if row is not None:
                actual = (
                    row["operation_id"],
                    row["repository_id"],
                    row["request_id"],
                    row["operation_type"],
                    row["payload_digest"],
                    row["expected_repo_state_digest"],
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"Git operation request {request_id!r} was reused "
                        "with a different action"
                    )
                return self._git_operation_from_row(row)
            connection.execute(
                """
                INSERT INTO git_operations(
                    operation_id, repository_id, request_id,
                    operation_type, payload_digest, status,
                    expected_repo_state_digest, observed_repo_state_digest,
                    result_json, error_code, error_message,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'prepared', ?, NULL, NULL, NULL,
                          NULL, ?, ?)
                """,
                (*expected, timestamp, timestamp),
            )
            row = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            assert row is not None
            return self._git_operation_from_row(row)

    def mark_git_operation_dispatched(
        self,
        operation_id: str,
        *,
        observed_repo_state_digest: str,
        now: float | None = None,
    ) -> GitOperationRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown Git operation {operation_id!r}")
            if row["status"] in {"dispatched", "completed"}:
                return self._git_operation_from_row(row)
            if row["status"] != "prepared":
                raise InvalidRunTransitionError(
                    f"Git operation {operation_id!r} cannot dispatch from "
                    f"{row['status']!r}"
                )
            connection.execute(
                """
                UPDATE git_operations
                SET status = 'dispatched', observed_repo_state_digest = ?,
                    updated_at = ?
                WHERE operation_id = ? AND status = 'prepared'
                """,
                (observed_repo_state_digest, timestamp, operation_id),
            )
            row = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            assert row is not None
            return self._git_operation_from_row(row)

    def complete_git_operation(
        self,
        operation_id: str,
        *,
        result: dict[str, Any],
        observed_repo_state_digest: str,
        now: float | None = None,
    ) -> GitOperationRecord:
        timestamp = now if now is not None else time.time()
        result_json = canonical_json(result)
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown Git operation {operation_id!r}")
            if row["status"] == "completed":
                if row["result_json"] != result_json:
                    raise IdempotencyConflictError(
                        f"Git operation {operation_id!r} completed with a "
                        "different result"
                    )
                return self._git_operation_from_row(row)
            if row["status"] != "dispatched":
                raise InvalidRunTransitionError(
                    f"Git operation {operation_id!r} cannot complete from "
                    f"{row['status']!r}"
                )
            connection.execute(
                """
                UPDATE git_operations
                SET status = 'completed', result_json = ?,
                    observed_repo_state_digest = ?, error_code = NULL,
                    error_message = NULL, updated_at = ?
                WHERE operation_id = ?
                """,
                (
                    result_json,
                    observed_repo_state_digest,
                    timestamp,
                    operation_id,
                ),
            )
            row = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            assert row is not None
            return self._git_operation_from_row(row)

    def fail_git_operation(
        self,
        operation_id: str,
        *,
        error_code: str,
        error_message: str,
        outcome_unknown: bool = False,
        now: float | None = None,
    ) -> GitOperationRecord:
        timestamp = now if now is not None else time.time()
        target = "outcome_unknown" if outcome_unknown else "failed"
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown Git operation {operation_id!r}")
            if row["status"] == "completed":
                return self._git_operation_from_row(row)
            if row["status"] in {"failed", "outcome_unknown"}:
                if row["status"] == target:
                    return self._git_operation_from_row(row)
                raise InvalidRunTransitionError(
                    f"Git operation {operation_id!r} cannot transition from "
                    f"{row['status']!r} to {target!r}"
                )
            if row["status"] == "prepared" and outcome_unknown:
                raise InvalidRunTransitionError(
                    "a Git operation cannot become outcome_unknown before "
                    "dispatch"
                )
            connection.execute(
                """
                UPDATE git_operations
                SET status = ?, error_code = ?, error_message = ?,
                    updated_at = ?
                WHERE operation_id = ?
                """,
                (
                    target,
                    error_code,
                    error_message,
                    timestamp,
                    operation_id,
                ),
            )
            row = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            assert row is not None
            return self._git_operation_from_row(row)

    def get_git_operation(
        self, operation_id: str
    ) -> GitOperationRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            return (
                self._git_operation_from_row(row) if row is not None else None
            )

    def list_git_operations(
        self,
        *,
        statuses: tuple[str, ...] | None = None,
    ) -> list[GitOperationRecord]:
        with self._lock:
            query = "SELECT * FROM git_operations"
            parameters: list[Any] = []
            if statuses:
                placeholders = ", ".join("?" for _ in statuses)
                query += f" WHERE status IN ({placeholders})"
                parameters.extend(statuses)
            query += " ORDER BY created_at, operation_id"
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._git_operation_from_row(row) for row in rows]

    def complete_git_checkpoint(
        self,
        *,
        checkpoint_id: str,
        operation_id: str,
        repository_id: str,
        target_role: str,
        target_id: str,
        commit_oid: str,
        parent_oid: str | None,
        paths: tuple[str, ...],
        managed_path_sources: dict[str, str],
        actor_id: str,
        trigger: str,
        message: str,
        observed_repo_state_digest: str,
        now: float | None = None,
    ) -> GitCheckpointRecord:
        if not paths or tuple(sorted(set(paths))) != paths:
            raise ValueError(
                "checkpoint paths must be non-empty, unique, and sorted"
            )
        if set(managed_path_sources) != set(paths):
            raise ValueError(
                "managed path sources must match checkpoint paths"
            )
        timestamp = now if now is not None else time.time()
        paths_json = canonical_json(list(paths))
        result = {
            "checkpoint_id": checkpoint_id,
            "commit_oid": commit_oid,
            "parent_oid": parent_oid,
            "paths": list(paths),
        }
        result_json = canonical_json(result)
        with self._write_transaction() as connection:
            operation = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            if (
                operation is None
                or operation["repository_id"] != repository_id
            ):
                raise ValueError("checkpoint operation/repository mismatch")
            existing = connection.execute(
                """
                SELECT * FROM git_checkpoints
                WHERE checkpoint_id = ? OR operation_id = ?
                """,
                (checkpoint_id, operation_id),
            ).fetchone()
            if existing is not None:
                expected = (
                    checkpoint_id,
                    repository_id,
                    operation_id,
                    target_role,
                    target_id,
                    commit_oid,
                    parent_oid,
                    paths_json,
                    actor_id,
                    trigger,
                    message,
                )
                actual = tuple(
                    existing[column]
                    for column in (
                        "checkpoint_id",
                        "repository_id",
                        "operation_id",
                        "target_role",
                        "target_id",
                        "commit_oid",
                        "parent_oid",
                        "paths_json",
                        "actor_id",
                        "trigger",
                        "message",
                    )
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"checkpoint {checkpoint_id!r} conflicts with its "
                        "persisted result"
                    )
                return self._git_checkpoint_from_row(existing)
            if operation["status"] != "dispatched":
                raise InvalidRunTransitionError(
                    f"Git operation {operation_id!r} cannot create a "
                    f"checkpoint from {operation['status']!r}"
                )
            connection.execute(
                """
                INSERT INTO git_checkpoints(
                    checkpoint_id, repository_id, operation_id, target_role,
                    target_id, commit_oid, parent_oid, paths_json, actor_id,
                    trigger, message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    checkpoint_id,
                    repository_id,
                    operation_id,
                    target_role,
                    target_id,
                    commit_oid,
                    parent_oid,
                    paths_json,
                    actor_id,
                    trigger,
                    message,
                    timestamp,
                ),
            )
            for relative_path, source in managed_path_sources.items():
                connection.execute(
                    """
                    INSERT INTO git_managed_paths(
                        repository_id, relative_path, source,
                        first_checkpoint_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(repository_id, relative_path) DO UPDATE SET
                        updated_at = excluded.updated_at
                    """,
                    (
                        repository_id,
                        relative_path,
                        source,
                        checkpoint_id,
                        timestamp,
                        timestamp,
                    ),
                )
            connection.execute(
                """
                UPDATE git_operations
                SET status = 'completed', result_json = ?,
                    observed_repo_state_digest = ?, error_code = NULL,
                    error_message = NULL, updated_at = ?
                WHERE operation_id = ?
                """,
                (
                    result_json,
                    observed_repo_state_digest,
                    timestamp,
                    operation_id,
                ),
            )
            row = connection.execute(
                "SELECT * FROM git_checkpoints WHERE checkpoint_id = ?",
                (checkpoint_id,),
            ).fetchone()
            assert row is not None
            return self._git_checkpoint_from_row(row)

    def get_git_checkpoint(
        self, checkpoint_id: str
    ) -> GitCheckpointRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM git_checkpoints WHERE checkpoint_id = ?",
                (checkpoint_id,),
            ).fetchone()
            return (
                self._git_checkpoint_from_row(row) if row is not None else None
            )

    def list_git_checkpoints(
        self,
        repository_id: str,
        *,
        limit: int = 100,
    ) -> list[GitCheckpointRecord]:
        if limit < 1:
            raise ValueError("checkpoint query limit must be positive")
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM git_checkpoints
                WHERE repository_id = ?
                ORDER BY created_at DESC, checkpoint_id DESC
                LIMIT ?
                """,
                (repository_id, limit),
            ).fetchall()
            return [self._git_checkpoint_from_row(row) for row in rows]

    def get_latest_git_checkpoint_for_target(
        self,
        *,
        repository_id: str,
        target_role: str,
        target_id: str,
    ) -> GitCheckpointRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM git_checkpoints
                WHERE repository_id = ? AND target_role = ? AND target_id = ?
                ORDER BY created_at DESC, checkpoint_id DESC
                LIMIT 1
                """,
                (repository_id, target_role, target_id),
            ).fetchone()
            return self._git_checkpoint_from_row(row) if row else None

    def list_git_managed_paths(self, repository_id: str) -> tuple[str, ...]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT relative_path FROM git_managed_paths
                WHERE repository_id = ?
                ORDER BY relative_path
                """,
                (repository_id,),
            ).fetchall()
            return tuple(row["relative_path"] for row in rows)

    def admit_git_run_workspace(
        self,
        *,
        run_id: str,
        project_id: str,
        repository_id: str,
        user_head: str | None,
        user_ref: str | None,
        now: float | None = None,
    ) -> tuple[ProjectGitStateRecord, RunGitMaterializationRecord]:
        """Pin a Run base without creating refs, branches, or worktrees."""

        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT project_id FROM runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if run is None:
                raise ValueError(f"unknown Run {run_id!r}")
            if run["project_id"] != project_id:
                raise IdempotencyConflictError(
                    f"Run {run_id!r} belongs to another Project"
                )
            repository = connection.execute(
                """
                SELECT repository_role FROM git_repositories
                WHERE repository_id = ?
                """,
                (repository_id,),
            ).fetchone()
            if (
                repository is None
                or repository["repository_role"] != "content"
            ):
                raise ValueError(
                    f"unknown Content Repository {repository_id!r}"
                )

            existing_run = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if existing_run is not None:
                if (
                    existing_run["project_id"] != project_id
                    or existing_run["repository_id"] != repository_id
                ):
                    raise IdempotencyConflictError(
                        f"Run {run_id!r} has another Git workspace owner"
                    )
                project = connection.execute(
                    """
                    SELECT * FROM git_project_integrations
                    WHERE project_id = ?
                    """,
                    (project_id,),
                ).fetchone()
                if project is None:
                    raise RunJournalError(
                        "Run Git admission has no Project Git state"
                    )
                return (
                    self._project_git_state_from_row(project),
                    self._run_git_materialization_from_row(existing_run),
                )

            project = connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
            if project is None:
                connection.execute(
                    """
                    INSERT INTO git_project_integrations(
                        project_id, repository_id, integration_ref,
                        integration_head, last_synced_user_head,
                        pending_apply, worktree_path, projected_head,
                        state, version, created_at, updated_at
                    ) VALUES (?, ?, NULL, NULL, ?, 0, NULL, NULL,
                              'unmaterialized', 0, ?, ?)
                    """,
                    (
                        project_id,
                        repository_id,
                        user_head,
                        timestamp,
                        timestamp,
                    ),
                )
                project = connection.execute(
                    """
                    SELECT * FROM git_project_integrations
                    WHERE project_id = ?
                    """,
                    (project_id,),
                ).fetchone()
            else:
                if project["repository_id"] != repository_id:
                    raise IdempotencyConflictError(
                        f"Project {project_id!r} belongs to another repository"
                    )
                if (
                    project["integration_head"] is None
                    and project["last_synced_user_head"] != user_head
                ):
                    connection.execute(
                        """
                        UPDATE git_project_integrations
                        SET last_synced_user_head = ?, version = version + 1,
                            updated_at = ?
                        WHERE project_id = ? AND version = ?
                        """,
                        (
                            user_head,
                            timestamp,
                            project_id,
                            int(project["version"]),
                        ),
                    )
                    project = connection.execute(
                        """
                        SELECT * FROM git_project_integrations
                        WHERE project_id = ?
                        """,
                        (project_id,),
                    ).fetchone()
            assert project is not None
            base_commit = project["integration_head"] or user_head
            base_ref = project["integration_ref"] or user_ref
            connection.execute(
                """
                INSERT INTO git_run_materializations(
                    run_id, project_id, repository_id, workspace_base_ref,
                    workspace_base_commit, project_state_version,
                    materialization_state, run_ref, worktree_path,
                    promoted_commit, version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'unmaterialized', NULL, NULL,
                          NULL, 0, ?, ?)
                """,
                (
                    run_id,
                    project_id,
                    repository_id,
                    base_ref,
                    base_commit,
                    int(project["version"]),
                    timestamp,
                    timestamp,
                ),
            )
            admitted = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            assert admitted is not None
            return (
                self._project_git_state_from_row(project),
                self._run_git_materialization_from_row(admitted),
            )

    def get_project_git_state(
        self,
        project_id: str,
    ) -> ProjectGitStateRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
            return (
                self._project_git_state_from_row(row)
                if row is not None
                else None
            )

    def rebase_unmaterialized_git_run(
        self,
        *,
        run_id: str,
        expected_base_commit: str | None,
        base_commit: str,
        base_ref: str,
        now: float | None = None,
    ) -> RunGitMaterializationRecord:
        """Move a direct Run boundary after preserving pre-existing dirt.

        This is legal only before the Run has produced a managed ChangeSet.
        It lets direct-checkout execution commit the user's visible preimage
        without incorrectly attributing that preimage to the Agent diff.
        """

        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            return self._rebase_unmaterialized_git_run_in_transaction(
                connection,
                run_id=run_id,
                expected_base_commit=expected_base_commit,
                base_commit=base_commit,
                base_ref=base_ref,
                timestamp=timestamp,
            )

    def refresh_git_run_base_after_writer_acquired(
        self,
        *,
        run_id: str,
        attempt_id: str,
        writer_request_id: str,
        expected_task_id: str,
        expected_checkout_id: str,
        expected_base_commit: str | None,
        base_commit: str,
        base_ref: str,
        now: float | None = None,
    ) -> RunGitMaterializationRecord:
        """Atomically refresh a queued direct Run before execution starts.

        Admission may happen while another Project owns the same physical
        checkout. The Run can therefore become stale while it waits. Only an
        acquired writer whose Attempt is still pending may move the boundary;
        the audit event is committed in the same transaction as that move.
        """

        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            admitted_run = connection.execute(
                """
                SELECT project_id, repository_id
                FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if admitted_run is None:
                raise RunNotFoundError(f"Run {run_id!r} has no Git admission")
            attempt = connection.execute(
                "SELECT run_id, status FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            if attempt is None or attempt["run_id"] != run_id:
                raise InvalidRunTransitionError(
                    "Run boundary refresh requires its pending Attempt"
                )
            if attempt["status"] != "pending":
                raise InvalidRunTransitionError(
                    "Run boundary cannot move after Attempt activation"
                )
            request = connection.execute(
                """
                SELECT * FROM workspace_writer_requests
                WHERE request_id = ?
                """,
                (writer_request_id,),
            ).fetchone()
            if (
                request is None
                or request["status"] != "acquired"
                or request["task_id"] != expected_task_id
                or request["checkout_id"] != expected_checkout_id
            ):
                raise InvalidRunTransitionError(
                    "Run boundary refresh requires its acquired writer lease"
                )
            if (
                request["project_id"] != admitted_run["project_id"]
                or request["repository_id"] != admitted_run["repository_id"]
            ):
                raise InvalidRunTransitionError(
                    "Run boundary writer does not own its Git admission"
                )
            lease = connection.execute(
                """
                SELECT request_id FROM workspace_writer_leases
                WHERE repository_id = ? AND checkout_id = ?
                """,
                (request["repository_id"], request["checkout_id"]),
            ).fetchone()
            if lease is None or lease["request_id"] != writer_request_id:
                raise InvalidRunTransitionError(
                    "Run boundary refresh requires the active writer lease"
                )
            binding = connection.execute(
                """
                SELECT repository_id, checkout_id, target_ref
                FROM project_workspace_bindings WHERE project_id = ?
                """,
                (request["project_id"],),
            ).fetchone()
            if (
                binding is None
                or binding["repository_id"] != request["repository_id"]
                or binding["checkout_id"] != request["checkout_id"]
                or binding["target_ref"] != base_ref
            ):
                raise InvalidRunTransitionError(
                    "Run boundary refresh cannot target an internal checkout"
                )
            change_set = connection.execute(
                "SELECT 1 FROM git_change_sets WHERE run_id = ? LIMIT 1",
                (run_id,),
            ).fetchone()
            if change_set is not None:
                raise InvalidRunTransitionError(
                    "Run boundary cannot move after ChangeSet creation"
                )
            updated = self._rebase_unmaterialized_git_run_in_transaction(
                connection,
                run_id=run_id,
                expected_base_commit=expected_base_commit,
                base_commit=base_commit,
                base_ref=base_ref,
                timestamp=timestamp,
            )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=(
                        f"workspace.run_base_refreshed:{run_id}:{base_commit}"
                    ),
                    event_type="workspace.run_base_refreshed",
                    payload={
                        "attempt_id": attempt_id,
                        "request_id": writer_request_id,
                        "task_id": expected_task_id,
                        "checkout_id": expected_checkout_id,
                        "base_ref": base_ref,
                        "previous_base_commit": expected_base_commit,
                        "base_commit": base_commit,
                        "reason": "writer_lease_acquired",
                    },
                    created_at=timestamp,
                ),
                expected_project_id=str(request["project_id"]),
            )
            return updated

    def _rebase_unmaterialized_git_run_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        expected_base_commit: str | None,
        base_commit: str,
        base_ref: str,
        timestamp: float,
    ) -> RunGitMaterializationRecord:
        run = connection.execute(
            "SELECT * FROM git_run_materializations WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if run is None:
            raise RunNotFoundError(f"Run {run_id!r} has no Git admission")
        if run["materialization_state"] != "unmaterialized":
            raise InvalidRunTransitionError(
                "only an unmaterialized direct Run can move its base"
            )
        if run["promoted_commit"] is not None:
            raise InvalidRunTransitionError(
                "a finalized direct Run cannot move its base"
            )
        if run["workspace_base_commit"] != expected_base_commit:
            raise OptimisticConcurrencyError("direct Run base changed")
        managed = connection.execute(
            """
            SELECT 1 FROM git_change_sets AS sets
            JOIN git_change_set_items AS items
              ON items.change_set_id = sets.change_set_id
            WHERE sets.run_id = ? LIMIT 1
            """,
            (run_id,),
        ).fetchone()
        if managed is not None:
            raise InvalidRunTransitionError(
                "direct Run already contains managed changes"
            )
        project = connection.execute(
            """
            SELECT * FROM git_project_integrations WHERE project_id = ?
            """,
            (run["project_id"],),
        ).fetchone()
        if project is None:
            raise RunJournalError("direct Run has no Project Git state")
        next_project_version = int(project["version"]) + 1
        connection.execute(
            """
            UPDATE git_project_integrations
            SET last_synced_user_head = ?, projected_head = ?,
                version = ?, updated_at = ?
            WHERE project_id = ? AND version = ?
            """,
            (
                base_commit,
                base_commit,
                next_project_version,
                timestamp,
                run["project_id"],
                int(project["version"]),
            ),
        )
        connection.execute(
            """
            UPDATE git_run_materializations
            SET workspace_base_ref = ?, workspace_base_commit = ?,
                project_state_version = ?, version = version + 1,
                updated_at = ?
            WHERE run_id = ? AND version = ?
            """,
            (
                base_ref,
                base_commit,
                next_project_version,
                timestamp,
                run_id,
                int(run["version"]),
            ),
        )
        updated = connection.execute(
            "SELECT * FROM git_run_materializations WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        assert updated is not None
        return self._run_git_materialization_from_row(updated)

    def complete_direct_git_run(
        self,
        *,
        run_id: str,
        expected_base_commit: str | None,
        terminal_commit: str,
        now: float | None = None,
    ) -> RunGitMaterializationRecord:
        """Persist exact OIDs for a Run executed in its bound checkout."""

        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM git_run_materializations WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"Run {run_id!r} has no Git admission")
            if run["materialization_state"] != "unmaterialized":
                raise InvalidRunTransitionError(
                    "direct Run was unexpectedly materialized"
                )
            if run["workspace_base_commit"] != expected_base_commit:
                raise OptimisticConcurrencyError("direct Run base changed")
            if run["promoted_commit"] is not None:
                if run["promoted_commit"] != terminal_commit:
                    raise IdempotencyConflictError(
                        "direct Run was finalized at another commit"
                    )
                return self._run_git_materialization_from_row(run)
            connection.execute(
                """
                UPDATE git_run_materializations
                SET promoted_commit = ?, version = version + 1, updated_at = ?
                WHERE run_id = ? AND promoted_commit IS NULL
                """,
                (terminal_commit, timestamp, run_id),
            )
            connection.execute(
                """
                UPDATE git_project_integrations
                SET last_synced_user_head = ?, projected_head = ?,
                    version = version + 1, updated_at = ?
                WHERE project_id = ?
                """,
                (
                    terminal_commit,
                    terminal_commit,
                    timestamp,
                    run["project_id"],
                ),
            )
            updated = connection.execute(
                "SELECT * FROM git_run_materializations WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            assert updated is not None
            return self._run_git_materialization_from_row(updated)

    def list_project_git_states(self) -> list[ProjectGitStateRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM git_project_integrations
                ORDER BY created_at, project_id
                """
            ).fetchall()
            return [self._project_git_state_from_row(row) for row in rows]

    def get_run_git_materialization(
        self,
        run_id: str,
    ) -> RunGitMaterializationRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            return (
                self._run_git_materialization_from_row(row)
                if row is not None
                else None
            )

    def list_run_git_materializations(
        self,
    ) -> list[RunGitMaterializationRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM git_run_materializations
                ORDER BY created_at, run_id
                """
            ).fetchall()
            return [
                self._run_git_materialization_from_row(row) for row in rows
            ]

    def claim_git_agent_workspace(
        self,
        *,
        workspace_id: str,
        run_id: str,
        repository_id: str,
        agent_id: str,
        agent_ref: str,
        worktree_path: str,
        base_commit: str,
        lease_owner: str,
        lease_token: str,
        lease_until: float,
        now: float | None = None,
    ) -> GitAgentWorkspaceRecord:
        timestamp = now if now is not None else time.time()
        if lease_until <= timestamp:
            raise ValueError("Agent workspace lease must expire in the future")
        identity = (
            run_id,
            repository_id,
            agent_id,
            agent_ref,
            worktree_path,
            base_commit,
        )
        with self._write_transaction() as connection:
            run = connection.execute(
                """
                SELECT repository_id, materialization_state
                FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if (
                run is None
                or run["repository_id"] != repository_id
                or run["materialization_state"]
                not in {
                    "materialized",
                    "promoted",
                }
            ):
                raise ValueError("Agent workspace Run is not materialized")
            row = connection.execute(
                """
                SELECT * FROM git_agent_workspaces
                WHERE workspace_id = ? OR (run_id = ? AND agent_id = ?)
                """,
                (workspace_id, run_id, agent_id),
            ).fetchone()
            if row is None:
                connection.execute(
                    """
                    INSERT INTO git_agent_workspaces(
                        workspace_id, run_id, repository_id, agent_id,
                        agent_ref, worktree_path, base_commit, head_commit,
                        state, lease_owner, lease_token, lease_until,
                        last_operation_id, conflict_interaction_id,
                        version, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admitted', ?, ?, ?,
                              NULL, NULL, 0, ?, ?)
                    """,
                    (
                        workspace_id,
                        *identity,
                        base_commit,
                        lease_owner,
                        lease_token,
                        lease_until,
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                actual = (
                    row["run_id"],
                    row["repository_id"],
                    row["agent_id"],
                    row["agent_ref"],
                    row["worktree_path"],
                    row["base_commit"],
                )
                if actual != identity:
                    raise IdempotencyConflictError(
                        f"Agent workspace {workspace_id!r} has another owner"
                    )
                if row["state"] == "archived":
                    raise InvalidRunTransitionError(
                        f"Agent workspace is {row['state']!r}"
                    )
                if (
                    row["lease_until"] is not None
                    and float(row["lease_until"]) > timestamp
                    and row["lease_owner"] != lease_owner
                ):
                    raise OutboxLeaseLostError(
                        f"Agent workspace {workspace_id!r} is leased"
                    )
                connection.execute(
                    """
                    UPDATE git_agent_workspaces
                    SET lease_owner = ?, lease_token = ?, lease_until = ?,
                        version = version + 1, updated_at = ?
                    WHERE workspace_id = ? AND version = ?
                    """,
                    (
                        lease_owner,
                        lease_token,
                        lease_until,
                        timestamp,
                        workspace_id,
                        int(row["version"]),
                    ),
                )
            claimed = connection.execute(
                "SELECT * FROM git_agent_workspaces WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchone()
            assert claimed is not None
            return self._git_agent_workspace_from_row(claimed)

    def transition_git_agent_workspace(
        self,
        workspace_id: str,
        *,
        lease_token: str,
        expected_state: str,
        state: str,
        head_commit: str | None = None,
        last_operation_id: str | None = None,
        conflict_interaction_id: str | None = None,
        release_lease: bool = False,
        run_event: RunEventDraft | None = None,
        now: float | None = None,
    ) -> GitAgentWorkspaceRecord:
        transitions = {
            "admitted": {"materializing", "needs_attention"},
            "materializing": {"ready", "needs_attention"},
            "ready": {"merging", "needs_attention", "archived"},
            "merging": {"ready", "merged", "conflicted", "needs_attention"},
            "merged": {"ready", "merging", "needs_attention", "archived"},
            "conflicted": {
                "ready",
                "merged",
                "needs_attention",
                "archived",
            },
            "needs_attention": {"ready", "archived"},
            "archived": set(),
        }
        if state != expected_state and state not in transitions.get(
            expected_state, set()
        ):
            raise InvalidRunTransitionError(
                f"Agent workspace cannot transition from {expected_state!r} "
                f"to {state!r}"
            )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM git_agent_workspaces WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchone()
            if row is None:
                raise RunNotFoundError(
                    f"Agent workspace {workspace_id!r} does not exist"
                )
            if row["lease_token"] != lease_token:
                raise OutboxLeaseLostError(
                    f"Agent workspace {workspace_id!r} lease changed"
                )
            if row["state"] != expected_state:
                raise OptimisticConcurrencyError(
                    f"Agent workspace expected {expected_state!r}, "
                    f"found {row['state']!r}"
                )
            updated = connection.execute(
                """
                UPDATE git_agent_workspaces
                SET state = ?, head_commit = COALESCE(?, head_commit),
                    last_operation_id = COALESCE(?, last_operation_id),
                    conflict_interaction_id = ?,
                    lease_owner = CASE WHEN ? THEN NULL ELSE lease_owner END,
                    lease_token = CASE WHEN ? THEN NULL ELSE lease_token END,
                    lease_until = CASE WHEN ? THEN NULL ELSE lease_until END,
                    version = version + 1, updated_at = ?
                WHERE workspace_id = ? AND version = ? AND state = ?
                  AND lease_token = ?
                """,
                (
                    state,
                    head_commit,
                    last_operation_id,
                    conflict_interaction_id,
                    release_lease,
                    release_lease,
                    release_lease,
                    timestamp,
                    workspace_id,
                    int(row["version"]),
                    expected_state,
                    lease_token,
                ),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    f"Agent workspace {workspace_id!r} changed"
                )
            if run_event is not None:
                self._append_event_in_transaction(
                    connection,
                    row["run_id"],
                    run_event,
                )
            current = connection.execute(
                "SELECT * FROM git_agent_workspaces WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchone()
            assert current is not None
            return self._git_agent_workspace_from_row(current)

    def release_git_agent_workspace_lease(
        self,
        workspace_id: str,
        *,
        lease_token: str,
        now: float | None = None,
    ) -> GitAgentWorkspaceRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE git_agent_workspaces
                SET lease_owner = NULL, lease_token = NULL,
                    lease_until = NULL, version = version + 1, updated_at = ?
                WHERE workspace_id = ? AND lease_token = ?
                """,
                (timestamp, workspace_id, lease_token),
            )
            if updated.rowcount != 1:
                raise OutboxLeaseLostError(
                    f"Agent workspace {workspace_id!r} lease changed"
                )
            row = connection.execute(
                "SELECT * FROM git_agent_workspaces WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchone()
            assert row is not None
            return self._git_agent_workspace_from_row(row)

    def renew_git_agent_workspace_lease(
        self,
        workspace_id: str,
        *,
        lease_token: str,
        lease_until: float,
        now: float | None = None,
    ) -> GitAgentWorkspaceRecord:
        """Extend an active Agent workspace lease using token CAS."""

        timestamp = now if now is not None else time.time()
        if lease_until <= timestamp:
            raise ValueError("Agent workspace lease must expire in the future")
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE git_agent_workspaces
                SET lease_until = ?, version = version + 1, updated_at = ?
                WHERE workspace_id = ? AND lease_token = ?
                  AND lease_until IS NOT NULL AND state != 'archived'
                """,
                (lease_until, timestamp, workspace_id, lease_token),
            )
            if updated.rowcount != 1:
                raise OutboxLeaseLostError(
                    f"Agent workspace {workspace_id!r} lease changed"
                )
            row = connection.execute(
                "SELECT * FROM git_agent_workspaces WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchone()
            assert row is not None
            return self._git_agent_workspace_from_row(row)

    def get_git_agent_workspace(
        self, run_id: str, agent_id: str
    ) -> GitAgentWorkspaceRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM git_agent_workspaces
                WHERE run_id = ? AND agent_id = ?
                """,
                (run_id, agent_id),
            ).fetchone()
            return self._git_agent_workspace_from_row(row) if row else None

    def list_git_agent_workspaces(
        self,
        *,
        run_id: str | None = None,
        states: tuple[str, ...] | None = None,
    ) -> list[GitAgentWorkspaceRecord]:
        clauses: list[str] = []
        parameters: list[Any] = []
        if run_id is not None:
            clauses.append("run_id = ?")
            parameters.append(run_id)
        if states:
            placeholders = ", ".join("?" for _ in states)
            clauses.append(f"state IN ({placeholders})")
            parameters.extend(states)
        query = "SELECT * FROM git_agent_workspaces"
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY created_at, workspace_id"
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._git_agent_workspace_from_row(row) for row in rows]

    def reset_git_agent_workspace_leases_after_restart(
        self,
        *,
        now: float | None = None,
    ) -> int:
        """Release process-local leases before startup reconciliation.

        Agent workspace leases protect concurrent operations in one Brain
        process. A restarted Brain cannot have a surviving local owner, so
        preserving those leases would only delay durable recovery.
        """

        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE git_agent_workspaces
                SET lease_owner = NULL, lease_token = NULL,
                    lease_until = NULL, version = version + 1, updated_at = ?
                WHERE state != 'archived' AND lease_token IS NOT NULL
                """,
                (timestamp,),
            )
            return int(updated.rowcount)

    def mark_run_git_attention(
        self,
        *,
        run_id: str,
        expected_version: int,
        now: float | None = None,
    ) -> RunGitMaterializationRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown Run Git state {run_id!r}")
            if row["materialization_state"] == "needs_attention":
                return self._run_git_materialization_from_row(row)
            if int(row["version"]) != expected_version:
                raise OptimisticConcurrencyError(
                    "Run Git state changed before attention marker"
                )
            if row["materialization_state"] not in {
                "materializing",
                "materialized",
                "promoted",
            }:
                raise InvalidRunTransitionError(
                    "Run Git state cannot enter needs_attention from "
                    f"{row['materialization_state']!r}"
                )
            connection.execute(
                """
                UPDATE git_run_materializations
                SET materialization_state = 'needs_attention',
                    version = version + 1, updated_at = ?
                WHERE run_id = ? AND version = ?
                """,
                (timestamp, run_id, expected_version),
            )
            row = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            assert row is not None
            return self._run_git_materialization_from_row(row)

    def archive_run_git_materialization(
        self,
        *,
        operation_id: str,
        run_id: str,
        expected_version: int,
        expected_run_ref: str,
        archive_ref: str,
        expected_head: str,
        observed_repo_state_digest: str,
        now: float | None = None,
    ) -> RunGitMaterializationRecord:
        timestamp = now if now is not None else time.time()
        result_json = canonical_json(
            {
                "run_id": run_id,
                "archive_ref": archive_ref,
                "commit_oid": expected_head,
            }
        )
        with self._write_transaction() as connection:
            operation = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            row = connection.execute(
                "SELECT * FROM git_run_materializations WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if operation is None or row is None:
                raise ValueError(f"unknown Run Git state {run_id!r}")
            if (
                operation["repository_id"] != row["repository_id"]
                or operation["operation_type"] != "run.archive"
            ):
                raise ValueError("Git archive operation does not own the Run")
            if row["materialization_state"] == "archived":
                if (
                    row["run_ref"] != archive_ref
                    or operation["status"] != "completed"
                    or operation["result_json"] != result_json
                ):
                    raise IdempotencyConflictError(
                        "Run was archived under another ref"
                    )
                return self._run_git_materialization_from_row(row)
            if operation["status"] != "dispatched":
                raise InvalidRunTransitionError(
                    "Run archive operation is not dispatched"
                )
            if (
                int(row["version"]) != expected_version
                or row["run_ref"] != expected_run_ref
                or row["promoted_commit"] != expected_head
                or row["materialization_state"] != "promoted"
            ):
                raise OptimisticConcurrencyError(
                    "Run Git state changed before archive"
                )
            connection.execute(
                """
                UPDATE git_run_materializations
                SET materialization_state = 'archived', run_ref = ?,
                    worktree_path = NULL, version = version + 1,
                    updated_at = ?
                WHERE run_id = ? AND version = ?
                  AND materialization_state = 'promoted'
                """,
                (archive_ref, timestamp, run_id, expected_version),
            )
            connection.execute(
                """
                UPDATE git_operations
                SET status = 'completed', result_json = ?,
                    observed_repo_state_digest = ?, error_code = NULL,
                    error_message = NULL, updated_at = ?
                WHERE operation_id = ? AND status = 'dispatched'
                """,
                (
                    result_json,
                    observed_repo_state_digest,
                    timestamp,
                    operation_id,
                ),
            )
            row = connection.execute(
                "SELECT * FROM git_run_materializations WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            assert row is not None
            return self._run_git_materialization_from_row(row)

    def dispatch_git_run_materialization(
        self,
        *,
        operation_id: str,
        run_id: str,
        observed_repo_state_digest: str,
        now: float | None = None,
    ) -> RunGitMaterializationRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            operation = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            run = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if operation is None or run is None:
                raise ValueError("unknown Git materialization operation")
            if operation["repository_id"] != run["repository_id"]:
                raise ValueError("Git materialization repository mismatch")
            if operation["operation_type"] != "run.materialize":
                raise ValueError("Git operation is not a Run materialization")
            if operation["status"] == "completed":
                return self._run_git_materialization_from_row(run)
            if operation["status"] == "dispatched":
                if run["materialization_state"] != "materializing":
                    raise RunJournalError(
                        "dispatched materialization has inconsistent Run state"
                    )
                return self._run_git_materialization_from_row(run)
            if operation["status"] != "prepared":
                raise InvalidRunTransitionError(
                    f"materialization cannot dispatch from "
                    f"{operation['status']!r}"
                )
            if run["materialization_state"] != "unmaterialized":
                raise InvalidRunTransitionError(
                    f"Run workspace cannot materialize from "
                    f"{run['materialization_state']!r}"
                )
            connection.execute(
                """
                UPDATE git_operations
                SET status = 'dispatched', observed_repo_state_digest = ?,
                    updated_at = ?
                WHERE operation_id = ? AND status = 'prepared'
                """,
                (observed_repo_state_digest, timestamp, operation_id),
            )
            connection.execute(
                """
                UPDATE git_run_materializations
                SET materialization_state = 'materializing',
                    version = version + 1, updated_at = ?
                WHERE run_id = ? AND materialization_state = 'unmaterialized'
                """,
                (timestamp, run_id),
            )
            run = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            assert run is not None
            return self._run_git_materialization_from_row(run)

    def complete_git_run_materialization(
        self,
        *,
        operation_id: str,
        run_id: str,
        expected_project_version: int,
        expected_project_head: str | None,
        project_ref: str,
        project_head: str,
        project_worktree_path: str,
        run_base_ref: str | None,
        run_base_commit: str,
        run_ref: str,
        run_worktree_path: str,
        observed_repo_state_digest: str,
        now: float | None = None,
    ) -> tuple[ProjectGitStateRecord, RunGitMaterializationRecord]:
        timestamp = now if now is not None else time.time()
        result = {
            "project_ref": project_ref,
            "project_head": project_head,
            "project_worktree_path": project_worktree_path,
            "run_base_ref": run_base_ref,
            "run_base_commit": run_base_commit,
            "run_ref": run_ref,
            "run_worktree_path": run_worktree_path,
        }
        result_json = canonical_json(result)
        with self._write_transaction() as connection:
            operation = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            run = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if operation is None or run is None:
                raise ValueError("unknown Git materialization operation")
            project = connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (run["project_id"],),
            ).fetchone()
            if project is None:
                raise RunJournalError("Run has no Project Git state")
            if operation["repository_id"] != run["repository_id"]:
                raise ValueError("Git materialization repository mismatch")
            if operation["status"] == "completed":
                if operation["result_json"] != result_json:
                    raise IdempotencyConflictError(
                        "completed Run materialization has another result"
                    )
                return (
                    self._project_git_state_from_row(project),
                    self._run_git_materialization_from_row(run),
                )
            if operation["status"] != "dispatched":
                raise InvalidRunTransitionError(
                    f"materialization cannot complete from "
                    f"{operation['status']!r}"
                )
            if run["materialization_state"] != "materializing":
                raise InvalidRunTransitionError(
                    f"Run workspace cannot complete from "
                    f"{run['materialization_state']!r}"
                )
            if (
                int(project["version"]) != expected_project_version
                or project["integration_head"] != expected_project_head
            ):
                raise OptimisticConcurrencyError(
                    "Project Integration changed during Run materialization"
                )
            if project["integration_ref"] not in {None, project_ref}:
                raise IdempotencyConflictError(
                    "Project Integration ref conflicts with persisted state"
                )
            if project["worktree_path"] not in {
                None,
                project_worktree_path,
            }:
                raise IdempotencyConflictError(
                    "Project Integration worktree conflicts with persisted state"
                )
            if project["integration_ref"] is None:
                connection.execute(
                    """
                    UPDATE git_project_integrations
                    SET integration_ref = ?, integration_head = ?,
                        worktree_path = ?, projected_head = ?, state = 'ready',
                        version = version + 1, updated_at = ?
                    WHERE project_id = ? AND version = ?
                    """,
                    (
                        project_ref,
                        project_head,
                        project_worktree_path,
                        project_head,
                        timestamp,
                        run["project_id"],
                        expected_project_version,
                    ),
                )
            elif project["integration_head"] != project_head:
                raise IdempotencyConflictError(
                    "Project Integration head conflicts with Git state"
                )
            connection.execute(
                """
                UPDATE git_run_materializations
                SET workspace_base_ref = ?, workspace_base_commit = ?,
                    materialization_state = 'materialized', run_ref = ?,
                    worktree_path = ?, version = version + 1, updated_at = ?
                WHERE run_id = ? AND materialization_state = 'materializing'
                """,
                (
                    run_base_ref,
                    run_base_commit,
                    run_ref,
                    run_worktree_path,
                    timestamp,
                    run_id,
                ),
            )
            connection.execute(
                """
                UPDATE git_operations
                SET status = 'completed', result_json = ?,
                    observed_repo_state_digest = ?, error_code = NULL,
                    error_message = NULL, updated_at = ?
                WHERE operation_id = ? AND status = 'dispatched'
                """,
                (
                    result_json,
                    observed_repo_state_digest,
                    timestamp,
                    operation_id,
                ),
            )
            project = connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (run["project_id"],),
            ).fetchone()
            run = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            assert project is not None and run is not None
            return (
                self._project_git_state_from_row(project),
                self._run_git_materialization_from_row(run),
            )

    def complete_git_run_promotion(
        self,
        *,
        operation_id: str,
        run_id: str,
        expected_project_version: int,
        expected_project_head: str,
        promoted_commit: str,
        observed_repo_state_digest: str,
        now: float | None = None,
    ) -> tuple[ProjectGitStateRecord, RunGitMaterializationRecord]:
        timestamp = now if now is not None else time.time()
        result = {
            "run_id": run_id,
            "expected_project_head": expected_project_head,
            "promoted_commit": promoted_commit,
        }
        result_json = canonical_json(result)
        with self._write_transaction() as connection:
            operation = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            run = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if operation is None or run is None:
                raise ValueError("unknown Git promotion operation")
            project = connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (run["project_id"],),
            ).fetchone()
            if project is None:
                raise RunJournalError("Run has no Project Git state")
            if operation["repository_id"] != run["repository_id"]:
                raise ValueError("Git promotion repository mismatch")
            if operation["operation_type"] != "run.promote":
                raise ValueError("Git operation is not a Run promotion")
            if operation["status"] == "completed":
                if operation["result_json"] != result_json:
                    raise IdempotencyConflictError(
                        "completed Run promotion has another result"
                    )
                return (
                    self._project_git_state_from_row(project),
                    self._run_git_materialization_from_row(run),
                )
            if operation["status"] != "dispatched":
                raise InvalidRunTransitionError(
                    f"promotion cannot complete from {operation['status']!r}"
                )
            if run["materialization_state"] != "materialized":
                raise InvalidRunTransitionError(
                    f"Run workspace cannot promote from "
                    f"{run['materialization_state']!r}"
                )
            if (
                int(project["version"]) != expected_project_version
                or project["integration_head"] != expected_project_head
            ):
                raise OptimisticConcurrencyError(
                    "Project Integration changed during Run promotion"
                )
            if run["workspace_base_commit"] != expected_project_head:
                raise OptimisticConcurrencyError(
                    "Run base is stale and requires merge simulation"
                )
            if promoted_commit != expected_project_head:
                connection.execute(
                    """
                    UPDATE git_project_integrations
                    SET integration_head = ?, pending_apply = 1,
                        version = version + 1, updated_at = ?
                    WHERE project_id = ? AND version = ?
                    """,
                    (
                        promoted_commit,
                        timestamp,
                        run["project_id"],
                        expected_project_version,
                    ),
                )
            connection.execute(
                """
                UPDATE git_run_materializations
                SET materialization_state = 'promoted', promoted_commit = ?,
                    version = version + 1, updated_at = ?
                WHERE run_id = ? AND materialization_state = 'materialized'
                """,
                (promoted_commit, timestamp, run_id),
            )
            connection.execute(
                """
                UPDATE git_operations
                SET status = 'completed', result_json = ?,
                    observed_repo_state_digest = ?, error_code = NULL,
                    error_message = NULL, updated_at = ?
                WHERE operation_id = ? AND status = 'dispatched'
                """,
                (
                    result_json,
                    observed_repo_state_digest,
                    timestamp,
                    operation_id,
                ),
            )
            project = connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (run["project_id"],),
            ).fetchone()
            run = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            assert project is not None and run is not None
            return (
                self._project_git_state_from_row(project),
                self._run_git_materialization_from_row(run),
            )

    def update_project_git_projection(
        self,
        *,
        project_id: str,
        expected_version: int,
        expected_integration_head: str,
        expected_projected_head: str,
        projected_head: str,
        now: float | None = None,
    ) -> ProjectGitStateRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown Project Git state {project_id!r}")
            if (
                row["integration_head"] == projected_head
                and row["projected_head"] == projected_head
            ):
                return self._project_git_state_from_row(row)
            if (
                int(row["version"]) != expected_version
                or row["integration_head"] != expected_integration_head
                or row["projected_head"] != expected_projected_head
                or projected_head != expected_integration_head
            ):
                raise OptimisticConcurrencyError(
                    "Project projection state changed concurrently"
                )
            connection.execute(
                """
                UPDATE git_project_integrations
                SET projected_head = ?, state = 'ready',
                    version = version + 1, updated_at = ?
                WHERE project_id = ? AND version = ?
                """,
                (projected_head, timestamp, project_id, expected_version),
            )
            row = connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
            assert row is not None
            return self._project_git_state_from_row(row)

    def complete_project_auto_apply(
        self,
        *,
        operation_id: str,
        project_id: str,
        expected_version: int,
        expected_integration_head: str,
        applied_path_sources: dict[str, str],
        observed_repo_state_digest: str,
        now: float | None = None,
    ) -> ProjectGitStateRecord:
        """Durably finish one safe Project Integration -> Space projection."""

        timestamp = now if now is not None else time.time()
        result = {
            "project_id": project_id,
            "integration_head": expected_integration_head,
            "applied_paths": sorted(applied_path_sources),
        }
        result_json = canonical_json(result)
        with self._write_transaction() as connection:
            operation = connection.execute(
                "SELECT * FROM git_operations WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
            project = connection.execute(
                "SELECT * FROM git_project_integrations WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if operation is None or project is None:
                raise ValueError("unknown Project auto-apply operation")
            if operation["operation_type"] != "project.auto_apply":
                raise ValueError("Git operation is not Project auto-apply")
            if operation["status"] == "completed":
                if operation["result_json"] != result_json:
                    raise IdempotencyConflictError(
                        "completed Project auto-apply has another result"
                    )
                return self._project_git_state_from_row(project)
            if operation["status"] != "dispatched":
                raise InvalidRunTransitionError(
                    "Project auto-apply must be dispatched before completion"
                )
            if (
                int(project["version"]) != expected_version
                or project["integration_head"] != expected_integration_head
                or project["projected_head"] != expected_integration_head
            ):
                raise OptimisticConcurrencyError(
                    "Project changed during automatic Space apply"
                )
            if set(applied_path_sources.values()) - {
                "agent_created",
                "agent_modified",
            }:
                raise ValueError("invalid Project auto-apply path source")
            for relative_path, source in applied_path_sources.items():
                connection.execute(
                    """
                    INSERT INTO git_managed_paths(
                        repository_id, relative_path, source,
                        first_checkpoint_id, created_at, updated_at
                    ) VALUES (?, ?, ?, NULL, ?, ?)
                    ON CONFLICT(repository_id, relative_path) DO UPDATE SET
                        updated_at = excluded.updated_at
                    """,
                    (
                        project["repository_id"],
                        relative_path,
                        source,
                        timestamp,
                        timestamp,
                    ),
                )
            connection.execute(
                """
                UPDATE git_project_integrations
                SET pending_apply = 0, state = 'ready', version = version + 1,
                    updated_at = ?
                WHERE project_id = ? AND version = ?
                """,
                (timestamp, project_id, expected_version),
            )
            connection.execute(
                """
                UPDATE git_operations
                SET status = 'completed', result_json = ?,
                    observed_repo_state_digest = ?, error_code = NULL,
                    error_message = NULL, updated_at = ?
                WHERE operation_id = ? AND status = 'dispatched'
                """,
                (
                    result_json,
                    observed_repo_state_digest,
                    timestamp,
                    operation_id,
                ),
            )
            project = connection.execute(
                "SELECT * FROM git_project_integrations WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            assert project is not None
            return self._project_git_state_from_row(project)

    def mark_project_git_attention(
        self,
        *,
        project_id: str,
        expected_version: int,
        now: float | None = None,
    ) -> ProjectGitStateRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown Project Git state {project_id!r}")
            if row["state"] == "needs_attention":
                return self._project_git_state_from_row(row)
            if int(row["version"]) != expected_version:
                raise OptimisticConcurrencyError(
                    "Project Git state changed before attention marker"
                )
            connection.execute(
                """
                UPDATE git_project_integrations
                SET state = 'needs_attention', version = version + 1,
                    updated_at = ?
                WHERE project_id = ? AND version = ?
                """,
                (timestamp, project_id, expected_version),
            )
            row = connection.execute(
                """
                SELECT * FROM git_project_integrations WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
            assert row is not None
            return self._project_git_state_from_row(row)

    def create_workspace_read_snapshot(
        self,
        *,
        snapshot_id: str,
        run_id: str,
        project_id: str,
        repository_id: str,
        project_base_commit: str | None,
        common_base_commit: str | None,
        project_state_version: int,
        snapshot_ref: str | None,
        user_head: str | None,
        user_working_state_digest: str,
        expires_at: float | None = None,
        now: float | None = None,
    ) -> WorkspaceReadSnapshotRecord:
        """Create the first lazy read snapshot, or return the active one.

        The transaction is intentionally metadata-only. File bytes and Git
        objects stay outside SQLite and are addressed by digest/ref.
        """

        if not self._is_sha256(user_working_state_digest):
            raise ValueError("working-state digest must be SHA-256")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            active = connection.execute(
                """
                SELECT * FROM workspace_read_snapshots
                WHERE run_id = ? AND state = 'active'
                ORDER BY generation DESC
                LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            if active is not None:
                return self._workspace_read_snapshot_from_row(active)
            run = connection.execute(
                """
                SELECT * FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if run is None:
                raise ValueError(f"Run {run_id!r} has no Git admission")
            if (
                run["project_id"] != project_id
                or run["repository_id"] != repository_id
            ):
                raise IdempotencyConflictError(
                    f"Run {run_id!r} has another snapshot owner"
                )
            generation_row = connection.execute(
                """
                SELECT COALESCE(MAX(generation), -1) + 1 AS generation
                FROM workspace_read_snapshots WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            assert generation_row is not None
            generation = int(generation_row["generation"])
            empty_manifest_digest = canonical_digest([])
            connection.execute(
                """
                INSERT INTO workspace_read_snapshots(
                    snapshot_id, run_id, project_id, repository_id,
                    generation, project_base_commit, common_base_commit,
                    project_state_version, snapshot_ref, user_head,
                    user_working_state_digest, overlay_manifest_digest,
                    state, expires_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active',
                          ?, ?, ?)
                """,
                (
                    snapshot_id,
                    run_id,
                    project_id,
                    repository_id,
                    generation,
                    project_base_commit,
                    common_base_commit,
                    project_state_version,
                    snapshot_ref,
                    user_head,
                    user_working_state_digest,
                    empty_manifest_digest,
                    expires_at,
                    timestamp,
                    timestamp,
                ),
            )
            row = connection.execute(
                """
                SELECT * FROM workspace_read_snapshots
                WHERE snapshot_id = ?
                """,
                (snapshot_id,),
            ).fetchone()
            assert row is not None
            return self._workspace_read_snapshot_from_row(row)

    def get_active_workspace_read_snapshot(
        self,
        run_id: str,
    ) -> WorkspaceReadSnapshotRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_read_snapshots
                WHERE run_id = ? AND state = 'active'
                ORDER BY generation DESC
                LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            return (
                self._workspace_read_snapshot_from_row(row)
                if row is not None
                else None
            )

    def get_workspace_read_snapshot(
        self,
        snapshot_id: str,
    ) -> WorkspaceReadSnapshotRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_read_snapshots
                WHERE snapshot_id = ?
                """,
                (snapshot_id,),
            ).fetchone()
            return (
                self._workspace_read_snapshot_from_row(row)
                if row is not None
                else None
            )

    def replace_active_workspace_read_snapshot(
        self,
        run_id: str,
        *,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            connection.execute(
                """
                UPDATE workspace_read_snapshots
                SET state = 'stale', updated_at = ?
                WHERE run_id = ? AND state = 'active'
                """,
                (timestamp, run_id),
            )

    def get_workspace_overlay_entry(
        self,
        snapshot_id: str,
        relative_path: str,
    ) -> WorkspaceOverlayEntryRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_overlay_entries
                WHERE snapshot_id = ? AND relative_path = ?
                """,
                (snapshot_id, relative_path),
            ).fetchone()
            return (
                self._workspace_overlay_entry_from_row(row)
                if row is not None
                else None
            )

    def list_workspace_overlay_entries(
        self,
        snapshot_id: str,
    ) -> list[WorkspaceOverlayEntryRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM workspace_overlay_entries
                WHERE snapshot_id = ?
                ORDER BY relative_path
                """,
                (snapshot_id,),
            ).fetchall()
            return [
                self._workspace_overlay_entry_from_row(row) for row in rows
            ]

    def put_workspace_overlay_entry(
        self,
        *,
        snapshot_id: str,
        relative_path: str,
        source_kind: str,
        entry_state: str,
        source_token: dict[str, Any],
        project_blob_oid: str | None,
        size_bytes: int,
        now: float | None = None,
    ) -> WorkspaceOverlayEntryRecord:
        timestamp = now if now is not None else time.time()
        source_token_json = canonical_json(source_token)
        expected = (
            source_kind,
            entry_state,
            source_token_json,
            project_blob_oid,
            size_bytes,
        )
        with self._write_transaction() as connection:
            snapshot = connection.execute(
                """
                SELECT state FROM workspace_read_snapshots
                WHERE snapshot_id = ?
                """,
                (snapshot_id,),
            ).fetchone()
            if snapshot is None:
                raise ValueError(f"unknown snapshot {snapshot_id!r}")
            if snapshot["state"] != "active":
                raise InvalidRunTransitionError(
                    f"snapshot {snapshot_id!r} is not active"
                )
            row = connection.execute(
                """
                SELECT * FROM workspace_overlay_entries
                WHERE snapshot_id = ? AND relative_path = ?
                """,
                (snapshot_id, relative_path),
            ).fetchone()
            if row is not None:
                actual = (
                    row["source_kind"],
                    row["entry_state"],
                    row["source_token_json"],
                    row["project_blob_oid"],
                    int(row["size_bytes"]),
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"snapshot path {relative_path!r} changed after pin"
                    )
                return self._workspace_overlay_entry_from_row(row)
            connection.execute(
                """
                INSERT INTO workspace_overlay_entries(
                    snapshot_id, relative_path, source_kind, entry_state,
                    source_token_json, project_blob_oid, size_bytes,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    snapshot_id,
                    relative_path,
                    *expected,
                    timestamp,
                    timestamp,
                ),
            )
            manifest_rows = connection.execute(
                """
                SELECT relative_path, source_kind, entry_state,
                       source_token_json, project_blob_oid, size_bytes
                FROM workspace_overlay_entries
                WHERE snapshot_id = ?
                ORDER BY relative_path
                """,
                (snapshot_id,),
            ).fetchall()
            manifest = [
                {
                    "relative_path": item["relative_path"],
                    "source_kind": item["source_kind"],
                    "entry_state": item["entry_state"],
                    "source_token": json.loads(item["source_token_json"]),
                    "project_blob_oid": item["project_blob_oid"],
                    "size_bytes": int(item["size_bytes"]),
                }
                for item in manifest_rows
            ]
            connection.execute(
                """
                UPDATE workspace_read_snapshots
                SET overlay_manifest_digest = ?, updated_at = ?
                WHERE snapshot_id = ? AND state = 'active'
                """,
                (canonical_digest(manifest), timestamp, snapshot_id),
            )
            row = connection.execute(
                """
                SELECT * FROM workspace_overlay_entries
                WHERE snapshot_id = ? AND relative_path = ?
                """,
                (snapshot_id, relative_path),
            ).fetchone()
            assert row is not None
            return self._workspace_overlay_entry_from_row(row)

    def record_workspace_snapshot_range(
        self,
        *,
        snapshot_id: str,
        relative_path: str,
        start_offset: int,
        end_offset: int,
        content_digest: str,
        cache_key: str,
        now: float | None = None,
    ) -> WorkspaceSnapshotRangeRecord:
        if start_offset < 0 or end_offset < start_offset:
            raise ValueError("invalid snapshot byte range")
        if not self._is_sha256(content_digest) or not self._is_sha256(
            cache_key
        ):
            raise ValueError("snapshot range digests must be SHA-256")
        timestamp = now if now is not None else time.time()
        expected = (content_digest, cache_key)
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM workspace_snapshot_ranges
                WHERE snapshot_id = ? AND relative_path = ?
                  AND start_offset = ? AND end_offset = ?
                """,
                (snapshot_id, relative_path, start_offset, end_offset),
            ).fetchone()
            if row is not None:
                actual = (row["content_digest"], row["cache_key"])
                if actual != expected:
                    raise IdempotencyConflictError(
                        "snapshot range content changed after pin"
                    )
                return self._workspace_snapshot_range_from_row(row)
            connection.execute(
                """
                INSERT INTO workspace_snapshot_ranges(
                    snapshot_id, relative_path, start_offset, end_offset,
                    content_digest, cache_key, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    snapshot_id,
                    relative_path,
                    start_offset,
                    end_offset,
                    content_digest,
                    cache_key,
                    timestamp,
                ),
            )
            row = connection.execute(
                """
                SELECT * FROM workspace_snapshot_ranges
                WHERE snapshot_id = ? AND relative_path = ?
                  AND start_offset = ? AND end_offset = ?
                """,
                (snapshot_id, relative_path, start_offset, end_offset),
            ).fetchone()
            assert row is not None
            return self._workspace_snapshot_range_from_row(row)

    def get_workspace_snapshot_range(
        self,
        *,
        snapshot_id: str,
        relative_path: str,
        start_offset: int,
        end_offset: int,
    ) -> WorkspaceSnapshotRangeRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_snapshot_ranges
                WHERE snapshot_id = ? AND relative_path = ?
                  AND start_offset = ? AND end_offset = ?
                """,
                (snapshot_id, relative_path, start_offset, end_offset),
            ).fetchone()
            return (
                self._workspace_snapshot_range_from_row(row)
                if row is not None
                else None
            )

    def update_workspace_overlay_entry_state(
        self,
        *,
        snapshot_id: str,
        relative_path: str,
        expected_state: str,
        state: str,
        now: float | None = None,
    ) -> WorkspaceOverlayEntryRecord:
        allowed = {
            "read_only": {"imported_preimage", "conflicted"},
            "imported_preimage": {"agent_modified", "conflicted"},
            "agent_modified": set(),
            "conflicted": set(),
        }
        if state != expected_state and state not in allowed.get(
            expected_state, set()
        ):
            raise InvalidRunTransitionError(
                f"overlay entry cannot transition from {expected_state!r} "
                f"to {state!r}"
            )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM workspace_overlay_entries
                WHERE snapshot_id = ? AND relative_path = ?
                """,
                (snapshot_id, relative_path),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown overlay path {relative_path!r}")
            if row["entry_state"] == state:
                return self._workspace_overlay_entry_from_row(row)
            if row["entry_state"] != expected_state:
                raise OptimisticConcurrencyError(
                    f"overlay path {relative_path!r} changed concurrently"
                )
            connection.execute(
                """
                UPDATE workspace_overlay_entries
                SET entry_state = ?, updated_at = ?
                WHERE snapshot_id = ? AND relative_path = ?
                  AND entry_state = ?
                """,
                (
                    state,
                    timestamp,
                    snapshot_id,
                    relative_path,
                    expected_state,
                ),
            )
            row = connection.execute(
                """
                SELECT * FROM workspace_overlay_entries
                WHERE snapshot_id = ? AND relative_path = ?
                """,
                (snapshot_id, relative_path),
            ).fetchone()
            assert row is not None
            return self._workspace_overlay_entry_from_row(row)

    def complete_workspace_overlay_materialization(
        self,
        *,
        snapshot_id: str,
        relative_path: str,
        content_digest: str,
        preimage_cache_key: str,
        now: float | None = None,
    ) -> WorkspaceOverlayEntryRecord:
        if not self._is_sha256(content_digest) or not self._is_sha256(
            preimage_cache_key
        ):
            raise ValueError("overlay materialization digests must be SHA-256")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM workspace_overlay_entries
                WHERE snapshot_id = ? AND relative_path = ?
                """,
                (snapshot_id, relative_path),
            ).fetchone()
            if row is None or row["source_kind"] != "user_overlay":
                raise ValueError("unknown User overlay entry")
            if row["entry_state"] == "imported_preimage":
                if (
                    row["materialized_content_digest"] != content_digest
                    or row["preimage_cache_key"] != preimage_cache_key
                ):
                    raise IdempotencyConflictError(
                        f"overlay path {relative_path!r} has another preimage"
                    )
                return self._workspace_overlay_entry_from_row(row)
            if row["entry_state"] != "read_only":
                raise InvalidRunTransitionError(
                    f"overlay path {relative_path!r} cannot materialize from "
                    f"{row['entry_state']!r}"
                )
            connection.execute(
                """
                UPDATE workspace_overlay_entries
                SET entry_state = 'imported_preimage',
                    materialized_content_digest = ?, preimage_cache_key = ?,
                    updated_at = ?
                WHERE snapshot_id = ? AND relative_path = ?
                  AND entry_state = 'read_only'
                """,
                (
                    content_digest,
                    preimage_cache_key,
                    timestamp,
                    snapshot_id,
                    relative_path,
                ),
            )
            row = connection.execute(
                """
                SELECT * FROM workspace_overlay_entries
                WHERE snapshot_id = ? AND relative_path = ?
                """,
                (snapshot_id, relative_path),
            ).fetchone()
            assert row is not None
            return self._workspace_overlay_entry_from_row(row)

    def ensure_git_change_set(
        self,
        *,
        change_set_id: str,
        run_id: str,
        repository_id: str,
        worktree_ref: str,
        base_commit: str | None,
        now: float | None = None,
    ) -> GitChangeSetRecord:
        timestamp = now if now is not None else time.time()
        expected = (run_id, repository_id, worktree_ref, base_commit)
        with self._write_transaction() as connection:
            run = connection.execute(
                """
                SELECT repository_id, run_ref, workspace_base_commit
                FROM git_run_materializations WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            if run is None or run["repository_id"] != repository_id:
                raise ValueError("ChangeSet Run/repository mismatch")
            if run["run_ref"] not in {None, worktree_ref}:
                agent_owner = connection.execute(
                    """
                    SELECT 1 FROM git_agent_workspaces
                    WHERE run_id = ? AND agent_ref = ?
                    """,
                    (run_id, worktree_ref),
                ).fetchone()
                if agent_owner is None:
                    raise IdempotencyConflictError(
                        "ChangeSet worktree ref does not belong to the Run"
                    )
            row = connection.execute(
                """
                SELECT * FROM git_change_sets
                WHERE change_set_id = ? OR (
                    run_id = ? AND worktree_ref = ?
                )
                """,
                (change_set_id, run_id, worktree_ref),
            ).fetchone()
            if row is not None:
                actual = (
                    row["run_id"],
                    row["repository_id"],
                    row["worktree_ref"],
                    row["base_commit"],
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"ChangeSet {change_set_id!r} has another owner"
                    )
                return self._git_change_set_from_row(row)
            connection.execute(
                """
                INSERT INTO git_change_sets(
                    change_set_id, run_id, repository_id, worktree_ref,
                    base_commit, state, version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'open', 0, ?, ?)
                """,
                (change_set_id, *expected, timestamp, timestamp),
            )
            row = connection.execute(
                """
                SELECT * FROM git_change_sets WHERE change_set_id = ?
                """,
                (change_set_id,),
            ).fetchone()
            assert row is not None
            return self._git_change_set_from_row(row)

    def get_git_change_set_for_run(
        self,
        run_id: str,
    ) -> GitChangeSetRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM git_change_sets
                WHERE run_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            return self._git_change_set_from_row(row) if row else None

    def list_git_change_sets(
        self,
        *,
        states: tuple[str, ...] | None = None,
    ) -> list[GitChangeSetRecord]:
        with self._lock:
            query = "SELECT * FROM git_change_sets"
            parameters: list[Any] = []
            if states:
                placeholders = ", ".join("?" for _ in states)
                query += f" WHERE state IN ({placeholders})"
                parameters.extend(states)
            query += " ORDER BY created_at, change_set_id"
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._git_change_set_from_row(row) for row in rows]

    def update_git_change_set_state(
        self,
        *,
        change_set_id: str,
        expected_state: str,
        state: str,
        now: float | None = None,
    ) -> GitChangeSetRecord:
        transitions = {
            "open": {"checkpointed", "discarded", "needs_attention"},
            "checkpointed": set(),
            "discarded": set(),
            "needs_attention": {"open", "discarded"},
        }
        if state != expected_state and state not in transitions.get(
            expected_state, set()
        ):
            raise InvalidRunTransitionError(
                f"ChangeSet cannot transition from {expected_state!r} "
                f"to {state!r}"
            )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM git_change_sets WHERE change_set_id = ?",
                (change_set_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown ChangeSet {change_set_id!r}")
            if row["state"] == state:
                return self._git_change_set_from_row(row)
            if row["state"] != expected_state:
                raise OptimisticConcurrencyError(
                    f"ChangeSet {change_set_id!r} changed concurrently"
                )
            connection.execute(
                """
                UPDATE git_change_sets
                SET state = ?, version = version + 1, updated_at = ?
                WHERE change_set_id = ? AND state = ?
                """,
                (state, timestamp, change_set_id, expected_state),
            )
            row = connection.execute(
                "SELECT * FROM git_change_sets WHERE change_set_id = ?",
                (change_set_id,),
            ).fetchone()
            assert row is not None
            return self._git_change_set_from_row(row)

    def put_git_change_set_item(
        self,
        *,
        change_set_id: str,
        relative_path: str,
        operation_request_id: str,
        actor_id: str,
        trigger: str,
        change_kind: str,
        source: str,
        preimage_digest: str | None,
        result_digest: str | None,
        size_bytes: int | None,
        now: float | None = None,
    ) -> GitChangeSetItemRecord:
        if not operation_request_id or not actor_id or not trigger:
            raise ValueError(
                "operation_request_id, actor_id, and trigger must not be empty"
            )
        if change_kind not in {"added", "modified", "deleted", "renamed"}:
            raise ValueError(f"unsupported change kind {change_kind!r}")
        if source not in {
            "agent_created",
            "agent_modified",
            "user_selected",
            "overlay_preimage",
            "artifact_event",
            "worktree_delta",
        }:
            raise ValueError(f"unsupported ChangeSet source {source!r}")
        for digest in (preimage_digest, result_digest):
            if digest is not None and not self._is_sha256(digest):
                raise ValueError("ChangeSet digests must be SHA-256")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            change_set = connection.execute(
                """
                SELECT state FROM git_change_sets WHERE change_set_id = ?
                """,
                (change_set_id,),
            ).fetchone()
            if change_set is None:
                raise ValueError(f"unknown ChangeSet {change_set_id!r}")
            if change_set["state"] != "open":
                raise InvalidRunTransitionError(
                    f"ChangeSet {change_set_id!r} is not open"
                )
            row = connection.execute(
                """
                SELECT * FROM git_change_set_items
                WHERE change_set_id = ? AND relative_path = ?
                """,
                (change_set_id, relative_path),
            ).fetchone()
            if row is None:
                connection.execute(
                    """
                    INSERT INTO git_change_set_items(
                        change_set_id, relative_path, operation_request_id,
                        actor_id, trigger, change_kind, source,
                        preimage_digest, result_digest, size_bytes,
                        item_state, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
                    """,
                    (
                        change_set_id,
                        relative_path,
                        operation_request_id,
                        actor_id,
                        trigger,
                        change_kind,
                        source,
                        preimage_digest,
                        result_digest,
                        size_bytes,
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                canonical = (
                    row["change_kind"] == change_kind
                    and row["operation_request_id"] == operation_request_id
                    and row["actor_id"] == actor_id
                    and row["trigger"] == trigger
                    and row["source"] == source
                    and row["preimage_digest"] == preimage_digest
                    and row["result_digest"] == result_digest
                    and row["size_bytes"] == size_bytes
                )
                if canonical:
                    return self._git_change_set_item_from_row(row)
                if row["item_state"] in {
                    "pending",
                    "preimage_checkpointed",
                }:
                    raise InvalidRunTransitionError(
                        f"ChangeSet path {relative_path!r} has an unfinished "
                        "operation"
                    )
                connection.execute(
                    """
                    UPDATE git_change_set_items
                    SET operation_request_id = ?, actor_id = ?, trigger = ?,
                        change_kind = ?, source = ?, preimage_digest = ?,
                        result_digest = ?, size_bytes = ?,
                        item_state = 'pending', updated_at = ?
                    WHERE change_set_id = ? AND relative_path = ?
                      AND item_state IN ('checkpointed', 'ignored')
                    """,
                    (
                        operation_request_id,
                        actor_id,
                        trigger,
                        change_kind,
                        source,
                        preimage_digest,
                        result_digest,
                        size_bytes,
                        timestamp,
                        change_set_id,
                        relative_path,
                    ),
                )
            connection.execute(
                """
                UPDATE git_change_sets
                SET version = version + 1, updated_at = ?
                WHERE change_set_id = ?
                """,
                (timestamp, change_set_id),
            )
            row = connection.execute(
                """
                SELECT * FROM git_change_set_items
                WHERE change_set_id = ? AND relative_path = ?
                """,
                (change_set_id, relative_path),
            ).fetchone()
            assert row is not None
            return self._git_change_set_item_from_row(row)

    def ensure_git_mutation_intent(
        self,
        *,
        intent_id: str,
        change_set_id: str,
        operation_request_id: str,
        mutation_scope: str,
        relative_path: str | None,
        preimage_digest: str | None,
        actor_id: str,
        trigger: str,
        now: float | None = None,
    ) -> GitMutationIntentRecord:
        if mutation_scope not in {"exact_path", "broad_process"}:
            raise ValueError(f"unsupported mutation scope {mutation_scope!r}")
        if (mutation_scope == "exact_path") != (relative_path is not None):
            raise ValueError("exact-path mutation intents must name one path")
        if preimage_digest is not None and not self._is_sha256(
            preimage_digest
        ):
            raise ValueError("mutation preimage digest must be SHA-256")
        if not operation_request_id or not actor_id or not trigger:
            raise ValueError("mutation intent identity must not be empty")
        timestamp = now if now is not None else time.time()
        expected = (
            change_set_id,
            operation_request_id,
            mutation_scope,
            relative_path,
            preimage_digest,
            actor_id,
            trigger,
        )
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM git_mutation_intents
                WHERE intent_id = ? OR (
                    change_set_id = ? AND operation_request_id = ?
                )
                """,
                (intent_id, change_set_id, operation_request_id),
            ).fetchone()
            if row is not None:
                actual = (
                    row["change_set_id"],
                    row["operation_request_id"],
                    row["mutation_scope"],
                    row["relative_path"],
                    row["preimage_digest"],
                    row["actor_id"],
                    row["trigger"],
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"mutation intent {intent_id!r} was reused"
                    )
                return self._git_mutation_intent_from_row(row)
            connection.execute(
                """
                INSERT INTO git_mutation_intents(
                    intent_id, change_set_id, operation_request_id,
                    mutation_scope, relative_path, preimage_digest,
                    actor_id, trigger, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)
                """,
                (intent_id, *expected, timestamp, timestamp),
            )
            row = connection.execute(
                "SELECT * FROM git_mutation_intents WHERE intent_id = ?",
                (intent_id,),
            ).fetchone()
            assert row is not None
            return self._git_mutation_intent_from_row(row)

    def list_git_mutation_intents(
        self,
        *,
        statuses: tuple[str, ...] | None = None,
    ) -> list[GitMutationIntentRecord]:
        with self._lock:
            query = "SELECT * FROM git_mutation_intents"
            parameters: list[Any] = []
            if statuses:
                placeholders = ", ".join("?" for _ in statuses)
                query += f" WHERE status IN ({placeholders})"
                parameters.extend(statuses)
            query += " ORDER BY created_at, intent_id"
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._git_mutation_intent_from_row(row) for row in rows]

    def update_git_mutation_intent_status(
        self,
        *,
        intent_id: str,
        expected_status: str,
        status: str,
        now: float | None = None,
    ) -> GitMutationIntentRecord:
        transitions = {
            "prepared": {"completed", "needs_attention"},
            "completed": set(),
            "needs_attention": {"prepared"},
        }
        if status != expected_status and status not in transitions.get(
            expected_status, set()
        ):
            raise InvalidRunTransitionError(
                f"mutation intent cannot transition from {expected_status!r} "
                f"to {status!r}"
            )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM git_mutation_intents WHERE intent_id = ?",
                (intent_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown mutation intent {intent_id!r}")
            if row["status"] == status:
                return self._git_mutation_intent_from_row(row)
            if row["status"] != expected_status:
                raise OptimisticConcurrencyError(
                    f"mutation intent {intent_id!r} changed concurrently"
                )
            connection.execute(
                """
                UPDATE git_mutation_intents
                SET status = ?, updated_at = ?
                WHERE intent_id = ? AND status = ?
                """,
                (status, timestamp, intent_id, expected_status),
            )
            row = connection.execute(
                "SELECT * FROM git_mutation_intents WHERE intent_id = ?",
                (intent_id,),
            ).fetchone()
            assert row is not None
            return self._git_mutation_intent_from_row(row)

    def list_git_change_set_items(
        self,
        change_set_id: str,
        *,
        states: tuple[str, ...] | None = None,
    ) -> list[GitChangeSetItemRecord]:
        with self._lock:
            query = (
                "SELECT * FROM git_change_set_items WHERE change_set_id = ?"
            )
            parameters: list[Any] = [change_set_id]
            if states:
                placeholders = ", ".join("?" for _ in states)
                query += f" AND item_state IN ({placeholders})"
                parameters.extend(states)
            query += " ORDER BY relative_path"
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._git_change_set_item_from_row(row) for row in rows]

    def update_git_change_set_item_state(
        self,
        *,
        change_set_id: str,
        relative_path: str,
        expected_state: str,
        state: str,
        now: float | None = None,
    ) -> GitChangeSetItemRecord:
        transitions = {
            "pending": {"preimage_checkpointed", "checkpointed", "ignored"},
            "preimage_checkpointed": {"checkpointed"},
            "checkpointed": set(),
            "ignored": set(),
        }
        if state != expected_state and state not in transitions.get(
            expected_state, set()
        ):
            raise InvalidRunTransitionError(
                f"ChangeSet item cannot transition from {expected_state!r} "
                f"to {state!r}"
            )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                """
                SELECT * FROM git_change_set_items
                WHERE change_set_id = ? AND relative_path = ?
                """,
                (change_set_id, relative_path),
            ).fetchone()
            if row is None:
                raise ValueError(f"unknown ChangeSet path {relative_path!r}")
            if row["item_state"] == state:
                return self._git_change_set_item_from_row(row)
            if row["item_state"] != expected_state:
                raise OptimisticConcurrencyError(
                    f"ChangeSet path {relative_path!r} changed concurrently"
                )
            connection.execute(
                """
                UPDATE git_change_set_items
                SET item_state = ?, updated_at = ?
                WHERE change_set_id = ? AND relative_path = ?
                  AND item_state = ?
                """,
                (
                    state,
                    timestamp,
                    change_set_id,
                    relative_path,
                    expected_state,
                ),
            )
            connection.execute(
                """
                UPDATE git_change_sets
                SET version = version + 1, updated_at = ?
                WHERE change_set_id = ?
                """,
                (timestamp, change_set_id),
            )
            row = connection.execute(
                """
                SELECT * FROM git_change_set_items
                WHERE change_set_id = ? AND relative_path = ?
                """,
                (change_set_id, relative_path),
            ).fetchone()
            assert row is not None
            return self._git_change_set_item_from_row(row)

    def ensure_run(
        self,
        *,
        run_id: str,
        project_id: str,
        status: str = "running",
        timeout_policy_version: str = "v1",
        deadline_at: float | None = None,
        now: float | None = None,
    ) -> RunRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO runs(
                    run_id, project_id, status, version, active_attempt_id,
                    deadline_at, timeout_policy_version, created_at, updated_at
                ) VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    project_id,
                    status,
                    deadline_at,
                    timeout_policy_version,
                    timestamp,
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert row is not None
            if row["project_id"] != project_id:
                raise IdempotencyConflictError(
                    f"run_id {run_id!r} already belongs to another project"
                )
            if row["timeout_policy_version"] != timeout_policy_version:
                raise IdempotencyConflictError(
                    f"run_id {run_id!r} was reused with a different timeout policy"
                )
            persisted_deadline = (
                float(row["deadline_at"])
                if row["deadline_at"] is not None
                else None
            )
            if persisted_deadline != deadline_at:
                raise IdempotencyConflictError(
                    f"run_id {run_id!r} was reused with a different deadline"
                )
            return self._run_from_row(row)

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            return self._run_from_row(row) if row is not None else None

    def start_model_invocation(
        self,
        *,
        invocation_id: str,
        run_id: str,
        attempt_id: str | None,
        step_id: str | None = None,
        agent_id: str,
        logical_call_id: str,
        provider: str,
        model: str,
        transport: str,
        thinking_effort: str | None,
        request: dict[str, Any],
        redaction_version: str = "model-invocation-v1",
        now: float | None = None,
    ) -> ModelInvocationRecord:
        """Persist the redacted CAMEL model-boundary request before dispatch.

        The caller may retry a logical model turn.  SQLite allocates the
        retry index while holding the writer lock so concurrent calls cannot
        claim the same trajectory position.
        """

        if not invocation_id.strip() or not logical_call_id.strip():
            raise ValueError("model invocation ids are required")
        if not agent_id.strip() or not provider.strip() or not model.strip():
            raise ValueError("model invocation identity is incomplete")
        if step_id is not None:
            step_id = step_id.strip()
            if not step_id:
                raise ValueError("model invocation step id cannot be blank")
        timestamp = now if now is not None else time.time()
        safe_request, request_json = _project_model_document(
            "request", request
        )
        request_digest = hashlib.sha256(
            request_json.encode("utf-8")
        ).hexdigest()

        with self._write_transaction() as connection:
            duplicate = connection.execute(
                "SELECT * FROM model_invocations WHERE invocation_id = ?",
                (invocation_id,),
            ).fetchone()
            if duplicate is not None:
                if (
                    duplicate["run_id"] != run_id
                    or duplicate["attempt_id"] != attempt_id
                    or duplicate["step_id"] != step_id
                    or duplicate["logical_call_id"] != logical_call_id
                    or duplicate["request_digest"] != request_digest
                ):
                    raise IdempotencyConflictError(
                        "model invocation id was reused with different input"
                    )
                return self._model_invocation_from_row(duplicate)

            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if attempt_id is not None:
                attempt = connection.execute(
                    "SELECT run_id FROM run_attempts WHERE attempt_id = ?",
                    (attempt_id,),
                ).fetchone()
                if attempt is None or attempt["run_id"] != run_id:
                    raise IdempotencyConflictError(
                        "model invocation attempt does not belong to the Run"
                    )
            if step_id is not None:
                step_exists = self._step_belongs_to_attempt_in_transaction(
                    connection,
                    run_id=run_id,
                    step_id=step_id,
                    attempt_id=attempt_id,
                )
                if not step_exists:
                    raise IdempotencyConflictError(
                        "model invocation step does not belong to the Run"
                    )
            retry_index = int(
                connection.execute(
                    """
                    SELECT COALESCE(MAX(retry_index), -1) + 1
                    FROM model_invocations WHERE logical_call_id = ?
                    """,
                    (logical_call_id,),
                ).fetchone()[0]
            )
            connection.execute(
                """
                INSERT INTO model_invocations(
                    invocation_id, run_id, attempt_id, step_id, agent_id,
                    logical_call_id, retry_index, status, provider, model,
                    transport, thinking_effort, request_json, response_json,
                    request_digest, response_digest, prompt_tokens,
                    completion_tokens, cache_read_tokens, cache_write_tokens,
                    finish_reason, error_code, error_message,
                    redaction_version, started_at, first_token_at, completed_at
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, 'dispatched', ?, ?, ?, ?, ?, NULL,
                    ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                    ?, ?, NULL, NULL
                )
                """,
                (
                    invocation_id,
                    run_id,
                    attempt_id,
                    step_id,
                    agent_id,
                    logical_call_id,
                    retry_index,
                    provider,
                    model,
                    transport,
                    thinking_effort,
                    request_json,
                    request_digest,
                    redaction_version,
                    timestamp,
                ),
            )
            event_payload = {
                "invocation_id": invocation_id,
                "attempt_id": attempt_id,
                "step_id": step_id,
                "agent_id": agent_id,
                "logical_call_id": logical_call_id,
                "retry_index": retry_index,
                "provider": provider,
                "model": model,
                "transport": transport,
                "request_digest": request_digest,
                "redaction_version": redaction_version,
            }
            self._insert_model_invocation_event(
                connection,
                invocation_id=invocation_id,
                event_type="dispatched",
                payload=event_payload,
                created_at=timestamp,
            )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"model-invocation:{invocation_id}:dispatched",
                    event_type="model.invocation.dispatched",
                    payload=event_payload,
                    created_at=timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM model_invocations WHERE invocation_id = ?",
                (invocation_id,),
            ).fetchone()
            assert row is not None
            return self._model_invocation_from_row(row)

    def mark_model_invocation_first_token(
        self,
        invocation_id: str,
        *,
        now: float | None = None,
    ) -> ModelInvocationRecord:
        """Persist one latency marker; token deltas are never journaled."""

        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM model_invocations WHERE invocation_id = ?",
                (invocation_id,),
            ).fetchone()
            if row is None:
                raise RunJournalError("model invocation does not exist")
            if row["first_token_at"] is None:
                connection.execute(
                    """
                    UPDATE model_invocations SET first_token_at = ?
                    WHERE invocation_id = ? AND first_token_at IS NULL
                    """,
                    (timestamp, invocation_id),
                )
                self._insert_model_invocation_event(
                    connection,
                    invocation_id=invocation_id,
                    event_type="first_token",
                    payload={"invocation_id": invocation_id},
                    created_at=timestamp,
                )
            updated = connection.execute(
                "SELECT * FROM model_invocations WHERE invocation_id = ?",
                (invocation_id,),
            ).fetchone()
            assert updated is not None
            return self._model_invocation_from_row(updated)

    def finish_model_invocation(
        self,
        invocation_id: str,
        *,
        status: str,
        response: dict[str, Any] | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        cache_read_tokens: int | None = None,
        cache_write_tokens: int | None = None,
        finish_reason: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        now: float | None = None,
    ) -> ModelInvocationRecord:
        """Close one provider call and append its lightweight Run event."""

        if status not in {"completed", "failed", "outcome_unknown"}:
            raise ValueError("invalid terminal model invocation status")
        timestamp = now if now is not None else time.time()
        safe_response: dict[str, Any] | None = None
        response_json: str | None = None
        response_digest: str | None = None
        if response is not None:
            safe_response, response_json = _project_model_document(
                "response", response
            )
            response_digest = hashlib.sha256(
                response_json.encode("utf-8")
            ).hexdigest()
        safe_error = None
        if error_message:
            from app.permission_policy.models import redact_action_arguments

            safe_error = str(
                redact_action_arguments({"message": error_message})["message"]
            )[:16_384]

        for name, value in {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cache_read_tokens": cache_read_tokens,
            "cache_write_tokens": cache_write_tokens,
        }.items():
            if value is not None and value < 0:
                raise ValueError(f"{name} cannot be negative")

        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM model_invocations WHERE invocation_id = ?",
                (invocation_id,),
            ).fetchone()
            if row is None:
                raise RunJournalError("model invocation does not exist")
            if row["status"] != "dispatched":
                if (
                    row["status"] == status
                    and row["response_digest"] == response_digest
                    and row["error_code"] == error_code
                    and row["error_message"] == safe_error
                    and row["prompt_tokens"] == prompt_tokens
                    and row["completion_tokens"] == completion_tokens
                    and row["cache_read_tokens"] == cache_read_tokens
                    and row["cache_write_tokens"] == cache_write_tokens
                    and row["finish_reason"] == finish_reason
                ):
                    return self._model_invocation_from_row(row)
                raise InvalidRunTransitionError(
                    f"model invocation {invocation_id!r} is already "
                    f"{row['status']!r}"
                )

            connection.execute(
                """
                UPDATE model_invocations
                SET status = ?, response_json = ?, response_digest = ?,
                    prompt_tokens = ?, completion_tokens = ?,
                    cache_read_tokens = ?, cache_write_tokens = ?,
                    finish_reason = ?, error_code = ?, error_message = ?,
                    completed_at = ?
                WHERE invocation_id = ? AND status = 'dispatched'
                """,
                (
                    status,
                    response_json,
                    response_digest,
                    prompt_tokens,
                    completion_tokens,
                    cache_read_tokens,
                    cache_write_tokens,
                    finish_reason,
                    error_code,
                    safe_error,
                    timestamp,
                    invocation_id,
                ),
            )
            event_payload: dict[str, Any] = {
                "invocation_id": invocation_id,
                "attempt_id": row["attempt_id"],
                "step_id": row["step_id"],
                "agent_id": row["agent_id"],
                "status": status,
                "request_digest": row["request_digest"],
                "response_digest": response_digest,
                "finish_reason": finish_reason,
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "cache_read_tokens": cache_read_tokens,
                    "cache_write_tokens": cache_write_tokens,
                },
                "error_code": error_code,
            }
            self._insert_model_invocation_event(
                connection,
                invocation_id=invocation_id,
                event_type=status,
                payload=event_payload,
                created_at=timestamp,
            )
            self._append_event_in_transaction(
                connection,
                str(row["run_id"]),
                RunEventDraft(
                    event_id=f"model-invocation:{invocation_id}:{status}",
                    event_type=f"model.invocation.{status}",
                    payload=event_payload,
                    created_at=timestamp,
                ),
            )
            updated = connection.execute(
                "SELECT * FROM model_invocations WHERE invocation_id = ?",
                (invocation_id,),
            ).fetchone()
            assert updated is not None
            return self._model_invocation_from_row(updated)

    def _record_model_capture_outcome_gap_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        invocation: sqlite3.Row,
        detail_code: str,
        suffix: str,
        timestamp: float,
    ) -> None:
        attempt_id = invocation["attempt_id"]
        if attempt_id is None:
            return
        invocation_id = str(invocation["invocation_id"])
        run_id = str(invocation["run_id"])
        gap_id = f"capture-gap:{invocation_id}:{suffix}"
        inserted = connection.execute(
            """
            INSERT OR IGNORE INTO attempt_evidence_gaps(
                gap_id, run_id, attempt_id, step_id, dimension,
                reason_code, source, detail_code, created_at
            ) VALUES (?, ?, ?, ?, 'model_decisions',
                      'outcome_unknown', 'model_capture', ?, ?)
            """,
            (
                gap_id,
                run_id,
                attempt_id,
                invocation["step_id"],
                detail_code,
                timestamp,
            ),
        )
        if inserted.rowcount != 1:
            return
        self._append_event_in_transaction(
            connection,
            run_id,
            RunEventDraft(
                event_id=f"attempt-evidence-gap:{gap_id}",
                event_type="attempt.evidence_gap_recorded",
                payload={
                    "gap_id": gap_id,
                    "attempt_id": attempt_id,
                    "step_id": invocation["step_id"],
                    "dimension": "model_decisions",
                    "reason_code": "outcome_unknown",
                    "source": "model_capture",
                    "detail_code": detail_code,
                },
                created_at=timestamp,
            ),
        )

    def _close_dispatched_model_invocations_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        terminal_event_type: str,
        timestamp: float,
    ) -> tuple[str, ...]:
        """Close provider calls that outlived their owning Run Attempt.

        Normal streaming capture commits the terminal provider chunk before a
        Run can finish.  This barrier covers consumer/provider edge cases and
        process integrations that return without exhausting or explicitly
        closing a stream.  Best-effort capture must remain non-blocking, but
        it must never leave a silently dispatched row in a terminal Run.
        """

        pending = connection.execute(
            """
            SELECT * FROM model_invocations
            WHERE run_id = ? AND status = 'dispatched'
            ORDER BY started_at, invocation_id
            """,
            (run_id,),
        ).fetchall()
        closed: list[str] = []
        for invocation in pending:
            invocation_id = str(invocation["invocation_id"])
            error_code = "run_terminal_before_model_capture_completed"
            error_message = (
                f"Run reached {terminal_event_type} before the model "
                "response was durably finalized"
            )
            updated = connection.execute(
                """
                UPDATE model_invocations
                SET status = 'outcome_unknown', error_code = ?,
                    error_message = ?, completed_at = ?
                WHERE invocation_id = ? AND status = 'dispatched'
                """,
                (error_code, error_message, timestamp, invocation_id),
            )
            if updated.rowcount != 1:
                continue
            payload = {
                "invocation_id": invocation_id,
                "attempt_id": invocation["attempt_id"],
                "step_id": invocation["step_id"],
                "agent_id": invocation["agent_id"],
                "status": "outcome_unknown",
                "request_digest": invocation["request_digest"],
                "response_digest": None,
                "finish_reason": None,
                "usage": {
                    "prompt_tokens": None,
                    "completion_tokens": None,
                    "cache_read_tokens": None,
                    "cache_write_tokens": None,
                },
                "error_code": error_code,
            }
            self._insert_model_invocation_event(
                connection,
                invocation_id=invocation_id,
                event_type="outcome_unknown",
                payload=payload,
                created_at=timestamp,
            )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=(
                        "run-terminal:model-invocation-outcome-unknown:"
                        f"{invocation_id}"
                    ),
                    event_type="model.invocation.outcome_unknown",
                    payload=payload,
                    created_at=timestamp,
                ),
            )

            self._record_model_capture_outcome_gap_in_transaction(
                connection,
                invocation=invocation,
                detail_code=error_code,
                suffix="run-terminal",
                timestamp=timestamp,
            )
            closed.append(invocation_id)
        return tuple(closed)

    def get_model_invocation(
        self, invocation_id: str
    ) -> ModelInvocationRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM model_invocations WHERE invocation_id = ?",
                (invocation_id,),
            ).fetchone()
        return self._model_invocation_from_row(row) if row else None

    def list_model_invocations(
        self, run_id: str
    ) -> tuple[ModelInvocationRecord, ...]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM model_invocations
                WHERE run_id = ? ORDER BY started_at, invocation_id
                """,
                (run_id,),
            ).fetchall()
        return tuple(self._model_invocation_from_row(row) for row in rows)

    def list_model_invocation_retention_candidates(
        self,
        *,
        now: float | None = None,
        limit: int = 100,
    ) -> tuple[str, ...]:
        """Return a bounded, policy-aware plan without mutating evidence.

        The immutable Attempt profile is the authority. Evidence-required
        workloads are therefore excluded even when their documents are old.
        Applying the plan is intentionally a separate, explicitly authorized
        data-lifecycle operation.
        """

        if limit < 1:
            raise ValueError("retention candidate limit must be positive")
        timestamp = now if now is not None else time.time()
        cutoff = timestamp - PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT model_invocations.invocation_id
                FROM model_invocations
                JOIN run_attempts
                  ON run_attempts.attempt_id = model_invocations.attempt_id
                WHERE model_invocations.status != 'dispatched'
                  AND model_invocations.completed_at IS NOT NULL
                  AND model_invocations.completed_at <= ?
                  AND run_attempts.workload_kind = 'production'
                  AND json_extract(
                        run_attempts.workload_profile_json,
                        '$.retention_policy_ref'
                      ) = ?
                  AND CASE
                        WHEN json_valid(model_invocations.request_json)
                        THEN json_extract(
                            model_invocations.request_json,
                            '$._eigent_retention.expired'
                        ) IS NULL
                        ELSE 1
                      END
                ORDER BY model_invocations.completed_at,
                         model_invocations.invocation_id
                LIMIT ?
                """,
                (cutoff, RETENTION_POLICY_PRODUCT_DEFAULT, limit),
            ).fetchall()
        return tuple(str(row["invocation_id"]) for row in rows)

    def expire_model_invocation_documents(
        self,
        *,
        now: float | None = None,
        limit: int = 100,
    ) -> ModelDocumentRetentionResult:
        """Expire one bounded batch of product-default model documents.

        The original request/response digests, usage, outcome, timing and
        identity remain canonical. Only the large redacted documents become
        a policy tombstone, with one durable evidence gap per invocation.
        """

        if limit < 1 or limit > 100:
            raise ValueError("retention batch limit must be between 1 and 100")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            candidates = connection.execute(
                """
                SELECT model_invocations.*
                FROM model_invocations
                JOIN run_attempts
                  ON run_attempts.attempt_id = model_invocations.attempt_id
                WHERE model_invocations.status != 'dispatched'
                  AND model_invocations.completed_at IS NOT NULL
                  AND model_invocations.completed_at <= ?
                  AND run_attempts.workload_kind = 'production'
                  AND json_extract(
                        run_attempts.workload_profile_json,
                        '$.retention_policy_ref'
                      ) = ?
                  AND CASE
                        WHEN json_valid(model_invocations.request_json)
                        THEN json_extract(
                            model_invocations.request_json,
                            '$._eigent_retention.expired'
                        ) IS NULL
                        ELSE 1
                      END
                ORDER BY model_invocations.completed_at,
                         model_invocations.invocation_id
                LIMIT ?
                """,
                (
                    timestamp - PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS,
                    RETENTION_POLICY_PRODUCT_DEFAULT,
                    limit,
                ),
            ).fetchall()
            expired: list[str] = []
            skipped: list[str] = []
            for invocation in candidates:
                invocation_id = str(invocation["invocation_id"])
                try:
                    with self._savepoint(
                        connection, "model_document_retention"
                    ):
                        self._expire_model_invocation_document_in_transaction(
                            connection,
                            invocation=invocation,
                            timestamp=timestamp,
                        )
                except Exception:
                    skipped.append(invocation_id)
                    logger.exception(
                        "Skipping model-document retention candidate",
                        extra={"invocation_id": invocation_id},
                    )
                    continue
                expired.append(invocation_id)
            remaining = int(
                connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM model_invocations
                    JOIN run_attempts
                      ON run_attempts.attempt_id = model_invocations.attempt_id
                    WHERE model_invocations.status != 'dispatched'
                      AND model_invocations.completed_at IS NOT NULL
                      AND model_invocations.completed_at <= ?
                      AND run_attempts.workload_kind = 'production'
                      AND json_extract(
                            run_attempts.workload_profile_json,
                            '$.retention_policy_ref'
                          ) = ?
                      AND CASE
                            WHEN json_valid(model_invocations.request_json)
                            THEN json_extract(
                                model_invocations.request_json,
                                '$._eigent_retention.expired'
                            ) IS NULL
                            ELSE 1
                          END
                    """,
                    (
                        timestamp - PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS,
                        RETENTION_POLICY_PRODUCT_DEFAULT,
                    ),
                ).fetchone()[0]
            )
            return ModelDocumentRetentionResult(
                expired_invocation_ids=tuple(expired),
                skipped_invocation_ids=tuple(skipped),
                remaining_candidate_count=remaining,
            )

    def _expire_model_invocation_document_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        invocation: sqlite3.Row,
        timestamp: float,
    ) -> None:
        """Replace one retained document without mutating its Run timeline."""

        invocation_id = str(invocation["invocation_id"])
        connection.execute(
            """
            UPDATE model_invocations
            SET request_json = ?,
                response_json = CASE
                    WHEN response_json IS NULL THEN NULL ELSE ? END,
                redaction_version = redaction_version || '+retention-v1'
            WHERE invocation_id = ?
            """,
            (
                _MODEL_DOCUMENT_RETENTION_MARKER,
                _MODEL_DOCUMENT_RETENTION_MARKER,
                invocation_id,
            ),
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO attempt_evidence_gaps(
                gap_id, run_id, attempt_id, step_id, dimension,
                reason_code, source, detail_code, created_at
            ) VALUES (?, ?, ?, ?, 'model_decisions',
                      'retention_expired', 'model_capture_retention',
                      'model_invocation_document_expired', ?)
            """,
            (
                f"retention-gap:{invocation_id}",
                invocation["run_id"],
                invocation["attempt_id"],
                invocation["step_id"],
                timestamp,
            ),
        )

    def list_model_invocation_events(
        self, invocation_id: str
    ) -> tuple[ModelInvocationEventRecord, ...]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM model_invocation_events
                WHERE invocation_id = ? ORDER BY event_index
                """,
                (invocation_id,),
            ).fetchall()
        return tuple(
            self._model_invocation_event_from_row(row) for row in rows
        )

    def record_attempt_evidence_gap(
        self,
        *,
        gap_id: str,
        run_id: str,
        attempt_id: str,
        step_id: str | None = None,
        dimension: str,
        reason_code: str,
        source: str,
        detail_code: str | None = None,
        now: float | None = None,
    ) -> AttemptEvidenceGapRecord:
        """Persist one idempotent completeness gap and its lightweight event."""

        if not gap_id.strip() or not source.strip():
            raise ValueError("evidence gap id and source are required")
        if dimension not in _EVIDENCE_DIMENSIONS:
            raise ValueError(f"unsupported evidence dimension {dimension!r}")
        if reason_code not in _EVIDENCE_GAP_REASON_CODES:
            raise ValueError(
                f"unsupported evidence gap reason {reason_code!r}"
            )
        safe_detail = detail_code.strip()[:160] if detail_code else None
        if step_id is not None:
            step_id = step_id.strip()
            if not step_id:
                raise ValueError("evidence gap step id cannot be blank")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            duplicate = connection.execute(
                "SELECT * FROM attempt_evidence_gaps WHERE gap_id = ?",
                (gap_id,),
            ).fetchone()
            expected = (
                run_id,
                attempt_id,
                step_id,
                dimension,
                reason_code,
                source,
                safe_detail,
            )
            if duplicate is not None:
                persisted = (
                    duplicate["run_id"],
                    duplicate["attempt_id"],
                    duplicate["step_id"],
                    duplicate["dimension"],
                    duplicate["reason_code"],
                    duplicate["source"],
                    duplicate["detail_code"],
                )
                if persisted != expected:
                    raise IdempotencyConflictError(
                        "evidence gap id was reused with different input"
                    )
                return self._attempt_evidence_gap_from_row(duplicate)

            attempt = connection.execute(
                "SELECT run_id FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            if attempt is None or attempt["run_id"] != run_id:
                raise IdempotencyConflictError(
                    "evidence gap Attempt does not belong to the Run"
                )
            if step_id is not None:
                step_exists = self._step_belongs_to_attempt_in_transaction(
                    connection,
                    run_id=run_id,
                    step_id=step_id,
                    attempt_id=attempt_id,
                )
                if not step_exists:
                    raise IdempotencyConflictError(
                        "evidence gap Step does not belong to the Run"
                    )
            connection.execute(
                """
                INSERT INTO attempt_evidence_gaps(
                    gap_id, run_id, attempt_id, step_id, dimension,
                    reason_code, source, detail_code, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (gap_id, *expected, timestamp),
            )
            payload = {
                "gap_id": gap_id,
                "attempt_id": attempt_id,
                "step_id": step_id,
                "dimension": dimension,
                "reason_code": reason_code,
                "source": source,
                "detail_code": safe_detail,
            }
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"attempt-evidence-gap:{gap_id}",
                    event_type="attempt.evidence_gap_recorded",
                    payload=payload,
                    created_at=timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM attempt_evidence_gaps WHERE gap_id = ?",
                (gap_id,),
            ).fetchone()
            assert row is not None
            return self._attempt_evidence_gap_from_row(row)

    def list_attempt_evidence_gaps(
        self, attempt_id: str
    ) -> tuple[AttemptEvidenceGapRecord, ...]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM attempt_evidence_gaps
                WHERE attempt_id = ? ORDER BY created_at, gap_id
                """,
                (attempt_id,),
            ).fetchall()
        return tuple(self._attempt_evidence_gap_from_row(row) for row in rows)

    def list_runs(
        self,
        *,
        project_id: str,
        statuses: tuple[str, ...] | None = None,
        limit: int = 50,
    ) -> list[RunRecord]:
        """Read the canonical Runs for one Project, newest first."""

        if not project_id.strip():
            raise ValueError("project_id is required")
        if limit < 1:
            raise ValueError("run query limit must be positive")
        parameters: list[Any] = [project_id]
        query = "SELECT * FROM runs WHERE project_id = ?"
        if statuses:
            placeholders = ",".join("?" for _ in statuses)
            query += f" AND status IN ({placeholders})"
            parameters.extend(statuses)
        query += " ORDER BY updated_at DESC, created_at DESC LIMIT ?"
        parameters.append(limit)
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._run_from_row(row) for row in rows]

    def list_recoverable_runs(self) -> list[RunRecord]:
        """Return Runs whose filesystem artifacts must precede reconciliation."""

        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM runs
                WHERE status IN ('pending', 'running', 'waiting_for_user')
                   OR (status = 'interrupted' AND cancel_request_id IS NOT NULL)
                ORDER BY created_at, run_id
                """
            ).fetchall()
        return [self._run_from_row(row) for row in rows]

    def get_active_project_run(self, project_id: str) -> RunRecord | None:
        """Return the Run that owns the Project execution lease, if any."""

        with self._lock:
            row = self._connection.execute(
                """
                SELECT runs.*
                FROM project_run_execution_leases AS lease
                JOIN runs ON runs.run_id = lease.run_id
                WHERE lease.project_id = ?
                """,
                (project_id,),
            ).fetchone()
            return self._run_from_row(row) if row is not None else None

    def get_project_execution_state(
        self, project_id: str
    ) -> ProjectExecutionStateRecord:
        """Return the latest semantic frontier for a Project.

        ``state_version`` increments only when a terminal Run changes the
        canonical frontier digest. Transport retries and Runs that reproduce
        the same frontier do not count as Project progress.
        """

        if not project_id.strip():
            raise ValueError("project_id is required")
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM project_execution_states WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if row is not None:
                return self._project_execution_state_from_row(row)

        # Schema v20 already contains canonical terminal history. Lazily
        # derive its first Project frontier after upgrading instead of making
        # a real v1.0.3 Project look empty until another Run completes.
        with self._write_transaction() as connection:
            self._backfill_project_execution_state_in_transaction(
                connection, project_id=project_id
            )
            row = connection.execute(
                "SELECT * FROM project_execution_states WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if row is not None:
                return self._project_execution_state_from_row(row)
        return ProjectExecutionStateRecord(
            project_id=project_id,
            state_version=0,
            frontier=None,
            frontier_digest=None,
            frontier_run_id=None,
            updated_at=0.0,
        )

    def claim_continuation(
        self,
        *,
        request_id: str,
        project_id: str,
        intent: str,
        base_run_id: str | None,
        next_action: str | None,
        now: float | None = None,
    ) -> tuple[ContinuationClaimRecord, bool]:
        """Claim one semantic continuation at the current Project version.

        Returns ``(claim, created)``. A different transport request attempting
        the same fingerprint receives the existing claim with ``created=False``
        and must not invoke the model again.
        """

        if (
            not request_id.strip()
            or not project_id.strip()
            or not intent.strip()
        ):
            raise ValueError("continuation identity is required")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            self._backfill_project_execution_state_in_transaction(
                connection, project_id=project_id
            )
            state = connection.execute(
                "SELECT * FROM project_execution_states WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            state_version = int(state["state_version"]) if state else 0
            canonical = canonical_json(
                {
                    "project_id": project_id,
                    "project_state_version": state_version,
                    "intent": intent,
                    "base_run_id": base_run_id,
                    "next_action": next_action,
                }
            )
            fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
            by_request = connection.execute(
                "SELECT * FROM continuation_claims WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            if by_request is not None:
                if by_request["fingerprint"] != fingerprint:
                    raise IdempotencyConflictError(
                        f"continuation request_id {request_id!r} was reused"
                    )
                return self._continuation_claim_from_row(by_request), False
            existing = connection.execute(
                "SELECT * FROM continuation_claims WHERE fingerprint = ?",
                (fingerprint,),
            ).fetchone()
            if existing is not None:
                return self._continuation_claim_from_row(existing), False
            connection.execute(
                """
                INSERT INTO continuation_claims(
                    fingerprint, request_id, project_id,
                    project_state_version, intent, base_run_id, next_action,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    fingerprint,
                    request_id,
                    project_id,
                    state_version,
                    intent,
                    base_run_id,
                    next_action,
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM continuation_claims WHERE fingerprint = ?",
                (fingerprint,),
            ).fetchone()
            assert row is not None
            return self._continuation_claim_from_row(row), True

    def release_unadmitted_continuation(self, *, request_id: str) -> bool:
        """Release a reservation only when admission created no Attempt.

        Environment or workspace preflight can fail after semantic admission
        has claimed a continuation fingerprint. Keeping that reservation would
        make a corrected retry with a new transport id look like duplicate
        work even though the model never ran.
        """

        if not request_id.strip():
            raise ValueError("continuation request_id is required")
        with self._write_transaction() as connection:
            claim = connection.execute(
                "SELECT request_id FROM continuation_claims WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            if claim is None:
                return False
            admitted = connection.execute(
                "SELECT 1 FROM run_attempts WHERE run_id = ? LIMIT 1",
                (request_id,),
            ).fetchone()
            if admitted is not None:
                return False
            deleted = connection.execute(
                "DELETE FROM continuation_claims WHERE request_id = ?",
                (request_id,),
            )
            return deleted.rowcount == 1

    def put_context_projection_diagnostic(
        self,
        *,
        projection_id: str,
        project_id: str,
        run_id: str,
        source_event_ids: list[str] | tuple[str, ...],
        source_memory_ids: list[str] | tuple[str, ...],
        project_state_version: int,
        projection_digest: str,
        token_count: int,
        now: float | None = None,
    ) -> ContextProjectionDiagnosticRecord:
        if len(projection_digest) != 64:
            raise ValueError("projection_digest must be sha256 hex")
        if project_state_version < 0 or token_count < 0:
            raise ValueError("projection counters must be non-negative")
        event_ids_json = canonical_json(sorted(set(source_event_ids)))
        memory_ids_json = canonical_json(sorted(set(source_memory_ids)))
        timestamp = now if now is not None else time.time()
        expected = (
            project_id,
            run_id,
            event_ids_json,
            memory_ids_json,
            project_state_version,
            projection_digest,
            token_count,
        )
        with self._write_transaction() as connection:
            existing = connection.execute(
                """SELECT * FROM context_projection_diagnostics
                WHERE projection_id = ? OR (
                    run_id = ? AND projection_digest = ?
                )""",
                (projection_id, run_id, projection_digest),
            ).fetchone()
            if existing is not None:
                actual = (
                    existing["project_id"],
                    existing["run_id"],
                    existing["source_event_ids_json"],
                    existing["source_memory_ids_json"],
                    int(existing["project_state_version"]),
                    existing["projection_digest"],
                    int(existing["token_count"]),
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"projection_id {projection_id!r} was reused"
                    )
                return self._context_projection_diagnostic_from_row(existing)
            connection.execute(
                """
                INSERT INTO context_projection_diagnostics(
                    projection_id, project_id, run_id,
                    source_event_ids_json, source_memory_ids_json,
                    project_state_version, projection_digest, token_count,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    projection_id,
                    project_id,
                    run_id,
                    event_ids_json,
                    memory_ids_json,
                    project_state_version,
                    projection_digest,
                    token_count,
                    timestamp,
                ),
            )
            row = connection.execute(
                """SELECT * FROM context_projection_diagnostics
                WHERE projection_id = ?""",
                (projection_id,),
            ).fetchone()
            assert row is not None
            return self._context_projection_diagnostic_from_row(row)

    def list_context_projection_diagnostics(
        self, *, run_id: str
    ) -> list[ContextProjectionDiagnosticRecord]:
        with self._lock:
            rows = self._connection.execute(
                """SELECT * FROM context_projection_diagnostics
                WHERE run_id = ? ORDER BY created_at, projection_id""",
                (run_id,),
            ).fetchall()
            return [
                self._context_projection_diagnostic_from_row(row)
                for row in rows
            ]

    def put_follow_up_request(
        self,
        *,
        request_id: str,
        project_id: str,
        content: str,
        attachment_paths: list[str] | tuple[str, ...] = (),
        review_handoff_ids: list[str] | tuple[str, ...] = (),
        delivery_mode: str = "wait",
        source: str = "local",
        source_command_id: str | None = None,
        now: float | None = None,
    ) -> FollowUpRequestRecord:
        """Durably enqueue one future Run instruction.

        ``request_id`` is also used as the future Run id by the renderer. A
        lost HTTP response can therefore retry both queue creation and Run
        admission without creating a duplicate Run.
        """

        normalized_id = request_id.strip()
        normalized_project = project_id.strip()
        normalized_content = content.strip()
        normalized_paths = tuple(str(path) for path in attachment_paths)
        normalized_handoff_ids = tuple(
            dict.fromkeys(str(value).strip() for value in review_handoff_ids)
        )
        if (
            not normalized_id
            or not normalized_project
            or not normalized_content
        ):
            raise ValueError("request_id, project_id and content are required")
        if delivery_mode not in {"wait", "send_now"}:
            raise ValueError("unsupported follow-up delivery mode")
        if source not in {"local", "remote_control", "scheduled"}:
            raise ValueError("unsupported follow-up source")
        normalized_command_id = (
            source_command_id.strip()
            if isinstance(source_command_id, str) and source_command_id.strip()
            else None
        )
        if source == "remote_control" and normalized_command_id is None:
            raise ValueError(
                "remote_control follow-ups require source_command_id"
            )
        if source != "remote_control" and normalized_command_id is not None:
            raise ValueError(
                "source_command_id is reserved for remote_control"
            )
        if len(normalized_paths) > 32 or any(
            not path.strip() for path in normalized_paths
        ):
            raise ValueError("follow-up attachment paths are invalid")
        if len(normalized_handoff_ids) > 64 or any(
            not value or len(value) > 128 for value in normalized_handoff_ids
        ):
            raise ValueError("follow-up review handoff ids are invalid")
        paths_json = json.dumps(
            normalized_paths,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        handoff_ids_json = json.dumps(
            normalized_handoff_ids,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            if normalized_command_id is not None:
                command_row = connection.execute(
                    """SELECT * FROM follow_up_requests
                    WHERE source_command_id = ?""",
                    (normalized_command_id,),
                ).fetchone()
                if command_row is not None:
                    if command_row["request_id"] != normalized_id:
                        raise IdempotencyConflictError(
                            f"remote command {normalized_command_id!r} was "
                            "already mapped to another follow-up"
                        )
                    if (
                        command_row["project_id"] != normalized_project
                        or command_row["content"] != normalized_content
                        or command_row["attachment_paths_json"] != paths_json
                        or command_row["review_handoff_ids_json"]
                        != handoff_ids_json
                    ):
                        raise IdempotencyConflictError(
                            f"remote command {normalized_command_id!r} was reused"
                        )
                    return self._follow_up_request_from_row(command_row)
            existing = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (normalized_id,),
            ).fetchone()
            if existing is not None:
                if (
                    existing["project_id"] != normalized_project
                    or existing["content"] != normalized_content
                    or existing["attachment_paths_json"] != paths_json
                    or existing["review_handoff_ids_json"] != handoff_ids_json
                    or existing["source"] != source
                    or existing["source_command_id"] != normalized_command_id
                ):
                    raise IdempotencyConflictError(
                        f"follow-up request_id {normalized_id!r} was reused"
                    )
                return self._follow_up_request_from_row(existing)
            if delivery_mode == "send_now":
                connection.execute(
                    """UPDATE follow_up_requests
                    SET delivery_mode = 'wait', updated_at = ?
                    WHERE project_id = ? AND status = 'pending'
                      AND delivery_mode = 'send_now'""",
                    (timestamp, normalized_project),
                )
            connection.execute(
                """
                INSERT INTO follow_up_requests(
                    request_id, project_id, content, attachment_paths_json,
                    review_handoff_ids_json,
                    delivery_mode, status, admitted_run_id, last_error,
                    created_at, updated_at, source, source_command_id
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, ?, ?)
                """,
                (
                    normalized_id,
                    normalized_project,
                    normalized_content,
                    paths_json,
                    handoff_ids_json,
                    delivery_mode,
                    timestamp,
                    timestamp,
                    source,
                    normalized_command_id,
                ),
            )
            row = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (normalized_id,),
            ).fetchone()
            assert row is not None
            return self._follow_up_request_from_row(row)

    def list_follow_up_requests(
        self,
        *,
        project_id: str,
        statuses: tuple[str, ...] = ("pending",),
    ) -> list[FollowUpRequestRecord]:
        if not project_id.strip():
            raise ValueError("project_id is required")
        if not statuses:
            return []
        if any(
            status not in {"pending", "admitted", "cancelled"}
            for status in statuses
        ):
            raise ValueError("unsupported follow-up status")
        selected_statuses = set(statuses)
        with self._lock:
            rows = self._connection.execute(
                """SELECT * FROM follow_up_requests
                WHERE project_id = ?
                  AND (
                    (status = 'pending' AND ?)
                    OR (status = 'admitted' AND ?)
                    OR (status = 'cancelled' AND ?)
                  )
                ORDER BY CASE delivery_mode WHEN 'send_now' THEN 0 ELSE 1 END,
                         created_at, request_id""",
                (
                    project_id,
                    "pending" in selected_statuses,
                    "admitted" in selected_statuses,
                    "cancelled" in selected_statuses,
                ),
            ).fetchall()
            return [self._follow_up_request_from_row(row) for row in rows]

    def list_pending_follow_up_requests_by_source(
        self, *, source: str
    ) -> list[FollowUpRequestRecord]:
        if source not in {"local", "remote_control", "scheduled"}:
            raise ValueError("unsupported follow-up source")
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM follow_up_requests
                WHERE source = ? AND status = 'pending'
                ORDER BY project_id,
                         CASE delivery_mode WHEN 'send_now' THEN 0 ELSE 1 END,
                         created_at, request_id
                """,
                (source,),
            ).fetchall()
            return [self._follow_up_request_from_row(row) for row in rows]

    def get_follow_up_request_by_source_command_id(
        self, *, source_command_id: str
    ) -> FollowUpRequestRecord | None:
        """Return the durable queue outcome owned by one remote command.

        This lookup is intentionally not limited to pending rows.  The Remote
        Control bridge uses it after a renderer restart to reconstruct the
        enqueue acknowledgement even when the follow-up was already admitted
        or rejected by Run admission.
        """

        normalized_command_id = source_command_id.strip()
        if not normalized_command_id:
            raise ValueError("source_command_id is required")
        with self._lock:
            row = self._connection.execute(
                """SELECT * FROM follow_up_requests
                WHERE source = 'remote_control' AND source_command_id = ?""",
                (normalized_command_id,),
            ).fetchone()
            return (
                self._follow_up_request_from_row(row)
                if row is not None
                else None
            )

    def set_follow_up_delivery_mode(
        self,
        *,
        request_id: str,
        project_id: str,
        delivery_mode: str,
        now: float | None = None,
    ) -> FollowUpRequestRecord:
        if delivery_mode not in {"wait", "send_now"}:
            raise ValueError("unsupported follow-up delivery mode")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            if row is None or row["project_id"] != project_id:
                raise RunNotFoundError(
                    f"follow-up request_id {request_id!r} does not exist"
                )
            if row["status"] != "pending":
                return self._follow_up_request_from_row(row)
            if delivery_mode == "send_now":
                # Only one message can own the interrupt-next position.  This
                # keeps the durable ordering identical to the renderer after
                # restart instead of letting an older send_now row win.
                connection.execute(
                    """UPDATE follow_up_requests
                    SET delivery_mode = 'wait', updated_at = ?
                    WHERE project_id = ? AND status = 'pending'
                      AND delivery_mode = 'send_now' AND request_id != ?""",
                    (timestamp, project_id, request_id),
                )
            connection.execute(
                """UPDATE follow_up_requests
                SET delivery_mode = ?, updated_at = ? WHERE request_id = ?""",
                (delivery_mode, timestamp, request_id),
            )
            updated = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            assert updated is not None
            return self._follow_up_request_from_row(updated)

    def cancel_follow_up_request(
        self,
        *,
        request_id: str,
        project_id: str,
        now: float | None = None,
    ) -> FollowUpRequestRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            if row is None or row["project_id"] != project_id:
                raise RunNotFoundError(
                    f"follow-up request_id {request_id!r} does not exist"
                )
            if row["status"] == "pending":
                connection.execute(
                    """UPDATE follow_up_requests
                    SET status = 'cancelled', updated_at = ? WHERE request_id = ?""",
                    (timestamp, request_id),
                )
            updated = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            assert updated is not None
            return self._follow_up_request_from_row(updated)

    def reject_follow_up_request(
        self,
        *,
        request_id: str,
        project_id: str,
        error: str,
        now: float | None = None,
    ) -> FollowUpRequestRecord:
        """Close a pending request that cannot be semantically admitted.

        Network and active-Run conflicts remain pending and retryable. This
        transition is reserved for durable admission outcomes that require a
        different user instruction, such as an ambiguous or duplicate weak
        continuation. The cancelled row remains the audit record.
        """

        normalized_error = error.strip()
        if not normalized_error:
            raise ValueError("follow-up rejection error is required")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            if row is None or row["project_id"] != project_id:
                raise RunNotFoundError(
                    f"follow-up request_id {request_id!r} does not exist"
                )
            if row["status"] == "pending":
                connection.execute(
                    """UPDATE follow_up_requests
                    SET status = 'cancelled', last_error = ?, updated_at = ?
                    WHERE request_id = ? AND status = 'pending'""",
                    (normalized_error[:4000], timestamp, request_id),
                )
            updated = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            assert updated is not None
            return self._follow_up_request_from_row(updated)

    def mark_follow_up_admitted(
        self,
        *,
        request_id: str,
        project_id: str,
        run_id: str,
        now: float | None = None,
    ) -> FollowUpRequestRecord:
        timestamp = now if now is not None else time.time()
        if run_id != request_id:
            raise IdempotencyConflictError(
                "a follow-up request must be admitted as its deterministic Run"
            )
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            run = connection.execute(
                "SELECT project_id, status FROM runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if row is None or row["project_id"] != project_id:
                raise RunNotFoundError(
                    f"follow-up request_id {request_id!r} does not exist"
                )
            if run is None or run["project_id"] != project_id:
                raise RunNotFoundError(
                    f"follow-up Run {run_id!r} does not exist in this Project"
                )
            if run["status"] in {"completed", "failed", "cancelled"}:
                raise InvalidRunTransitionError(
                    "a follow-up cannot be admitted to a terminal Run"
                )
            attempt = connection.execute(
                "SELECT 1 FROM run_attempts WHERE run_id = ? LIMIT 1",
                (run_id,),
            ).fetchone()
            if attempt is None:
                raise InvalidRunTransitionError(
                    "a follow-up cannot be admitted before Run admission"
                )
            if row["status"] == "admitted":
                if row["admitted_run_id"] != run_id:
                    raise IdempotencyConflictError(
                        "follow-up was admitted as a different Run"
                    )
                return self._follow_up_request_from_row(row)
            if row["status"] != "pending":
                raise InvalidRunTransitionError(
                    "a cancelled follow-up cannot be admitted"
                )
            connection.execute(
                """UPDATE follow_up_requests
                SET status = 'admitted', admitted_run_id = ?, last_error = NULL,
                    updated_at = ? WHERE request_id = ?""",
                (run_id, timestamp, request_id),
            )
            updated = connection.execute(
                "SELECT * FROM follow_up_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            assert updated is not None
            return self._follow_up_request_from_row(updated)

    def ensure_project_workspace_binding(
        self,
        *,
        project_id: str,
        repository_id: str,
        checkout_id: str,
        checkout_mode: str,
        target_ref: str,
        worktree_path: str,
        now: float | None = None,
    ) -> ProjectWorkspaceBindingRecord:
        """Persist a Project's physical checkout without silently rebinding it.

        Ordinary Projects share the Space primary checkout. Explicit user
        branch/worktree creation uses a different checkout id and must go
        through ``update_project_workspace_binding`` after the worktree exists.
        """

        values = {
            "project_id": project_id.strip(),
            "repository_id": repository_id.strip(),
            "checkout_id": checkout_id.strip(),
            "target_ref": target_ref.strip(),
            "worktree_path": worktree_path.strip(),
        }
        if any(not value for value in values.values()):
            raise ValueError("Project workspace binding identity is required")
        if any(len(value) > 4096 for value in values.values()):
            raise ValueError("Project workspace binding identity is too long")
        if checkout_mode not in {"primary_checkout", "explicit_worktree"}:
            raise ValueError("invalid Project checkout mode")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM project_workspace_bindings WHERE project_id = ?",
                (values["project_id"],),
            ).fetchone()
            if existing is not None:
                persisted = (
                    existing["repository_id"],
                    existing["checkout_id"],
                    existing["checkout_mode"],
                    existing["target_ref"],
                    existing["worktree_path"],
                )
                requested = (
                    values["repository_id"],
                    values["checkout_id"],
                    checkout_mode,
                    values["target_ref"],
                    values["worktree_path"],
                )
                if persisted != requested:
                    raise IdempotencyConflictError(
                        f"Project {project_id!r} already has another "
                        "workspace binding"
                    )
                return self._project_workspace_binding_from_row(existing)
            repository = connection.execute(
                """
                SELECT repository_role FROM git_repositories
                WHERE repository_id = ?
                """,
                (values["repository_id"],),
            ).fetchone()
            if (
                repository is None
                or repository["repository_role"] != "content"
            ):
                raise RunNotFoundError(
                    f"Content Repository {repository_id!r} does not exist"
                )
            connection.execute(
                """
                INSERT INTO project_workspace_bindings(
                    project_id, repository_id, checkout_id, checkout_mode,
                    target_ref, worktree_path, version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    values["project_id"],
                    values["repository_id"],
                    values["checkout_id"],
                    checkout_mode,
                    values["target_ref"],
                    values["worktree_path"],
                    timestamp,
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM project_workspace_bindings WHERE project_id = ?",
                (values["project_id"],),
            ).fetchone()
            assert row is not None
            return self._project_workspace_binding_from_row(row)

    def get_project_workspace_binding(
        self,
        project_id: str,
    ) -> ProjectWorkspaceBindingRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM project_workspace_bindings WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            return (
                self._project_workspace_binding_from_row(row)
                if row is not None
                else None
            )

    def update_project_workspace_binding(
        self,
        *,
        project_id: str,
        expected_version: int,
        checkout_id: str,
        checkout_mode: str,
        target_ref: str,
        worktree_path: str,
        now: float | None = None,
    ) -> ProjectWorkspaceBindingRecord:
        """CAS-switch a Project after an explicit checkout operation."""

        if expected_version < 1:
            raise ValueError(
                "expected Project workspace version must be positive"
            )
        values = {
            "checkout_id": checkout_id.strip(),
            "target_ref": target_ref.strip(),
            "worktree_path": worktree_path.strip(),
        }
        if any(not value for value in values.values()):
            raise ValueError("Project workspace binding identity is required")
        if checkout_mode not in {"primary_checkout", "explicit_worktree"}:
            raise ValueError("invalid Project checkout mode")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            cursor = connection.execute(
                """
                UPDATE project_workspace_bindings
                SET checkout_id = ?, checkout_mode = ?, target_ref = ?,
                    worktree_path = ?, version = version + 1, updated_at = ?
                WHERE project_id = ? AND version = ?
                """,
                (
                    values["checkout_id"],
                    checkout_mode,
                    values["target_ref"],
                    values["worktree_path"],
                    timestamp,
                    project_id,
                    expected_version,
                ),
            )
            if cursor.rowcount != 1:
                current = connection.execute(
                    """
                    SELECT version FROM project_workspace_bindings
                    WHERE project_id = ?
                    """,
                    (project_id,),
                ).fetchone()
                if current is None:
                    raise RunNotFoundError(
                        f"Project {project_id!r} has no workspace binding"
                    )
                raise OptimisticConcurrencyError(
                    f"Project {project_id!r} workspace binding changed"
                )
            row = connection.execute(
                "SELECT * FROM project_workspace_bindings WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            assert row is not None
            return self._project_workspace_binding_from_row(row)

    def enqueue_workspace_writer(
        self,
        *,
        request_id: str,
        repository_id: str,
        checkout_id: str,
        task_id: str,
        project_id: str,
        target_ref: str,
        reason: str,
        now: float | None = None,
    ) -> WorkspaceWriterRequestRecord:
        """Acquire or durably queue one Task for a physical checkout.

        The first request acquires the lease in the same transaction. Later
        requests remain FIFO queued even when they belong to another Project.
        Repeating one request id with the same payload is idempotent.
        """

        values = {
            "request_id": request_id.strip(),
            "repository_id": repository_id.strip(),
            "checkout_id": checkout_id.strip(),
            "task_id": task_id.strip(),
            "project_id": project_id.strip(),
            "target_ref": target_ref.strip(),
            "reason": reason.strip(),
        }
        if any(not value for value in values.values()):
            raise ValueError("workspace writer identity is required")
        if any(len(value) > 512 for value in values.values()):
            raise ValueError("workspace writer identity is too long")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM workspace_writer_requests WHERE request_id = ?",
                (values["request_id"],),
            ).fetchone()
            if existing is not None:
                persisted = (
                    existing["repository_id"],
                    existing["checkout_id"],
                    existing["task_id"],
                    existing["project_id"],
                    existing["target_ref"],
                    existing["reason"],
                )
                requested = (
                    values["repository_id"],
                    values["checkout_id"],
                    values["task_id"],
                    values["project_id"],
                    values["target_ref"],
                    values["reason"],
                )
                if persisted != requested:
                    raise IdempotencyConflictError(
                        f"workspace writer request_id {request_id!r} was reused"
                    )
                return self._workspace_writer_request_from_row(
                    connection,
                    existing,
                )
            repository = connection.execute(
                "SELECT 1 FROM git_repositories WHERE repository_id = ?",
                (values["repository_id"],),
            ).fetchone()
            if repository is None:
                raise RunNotFoundError(
                    f"Git repository {repository_id!r} does not exist"
                )
            task_request = connection.execute(
                """
                SELECT request_id FROM workspace_writer_requests
                WHERE repository_id = ? AND checkout_id = ? AND task_id = ?
                """,
                (
                    values["repository_id"],
                    values["checkout_id"],
                    values["task_id"],
                ),
            ).fetchone()
            if task_request is not None:
                raise IdempotencyConflictError(
                    f"Task {task_id!r} already has workspace writer request "
                    f"{task_request['request_id']!r}"
                )
            connection.execute(
                """
                INSERT INTO workspace_writer_requests(
                    request_id, repository_id, checkout_id, task_id,
                    project_id, target_ref, reason, status, created_at,
                    acquired_at, finished_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, ?)
                """,
                (
                    values["request_id"],
                    values["repository_id"],
                    values["checkout_id"],
                    values["task_id"],
                    values["project_id"],
                    values["target_ref"],
                    values["reason"],
                    timestamp,
                    timestamp,
                ),
            )
            lease = connection.execute(
                """
                SELECT 1 FROM workspace_writer_leases
                WHERE repository_id = ? AND checkout_id = ?
                """,
                (values["repository_id"], values["checkout_id"]),
            ).fetchone()
            if lease is None:
                self._acquire_workspace_writer_in_transaction(
                    connection,
                    request_id=values["request_id"],
                    now=timestamp,
                )
            row = connection.execute(
                "SELECT * FROM workspace_writer_requests WHERE request_id = ?",
                (values["request_id"],),
            ).fetchone()
            assert row is not None
            return self._workspace_writer_request_from_row(connection, row)

    def get_workspace_writer_request(
        self,
        request_id: str,
    ) -> WorkspaceWriterRequestRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM workspace_writer_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            return (
                self._workspace_writer_request_from_row(self._connection, row)
                if row is not None
                else None
            )

    def get_workspace_writer_lease(
        self,
        *,
        repository_id: str,
        checkout_id: str,
    ) -> WorkspaceWriterLeaseRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM workspace_writer_leases
                WHERE repository_id = ? AND checkout_id = ?
                """,
                (repository_id, checkout_id),
            ).fetchone()
            return (
                self._workspace_writer_lease_from_row(row)
                if row is not None
                else None
            )

    def list_workspace_writer_requests(
        self,
        *,
        repository_id: str,
        checkout_id: str,
        include_terminal: bool = False,
    ) -> list[WorkspaceWriterRequestRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM workspace_writer_requests
                WHERE repository_id = ? AND checkout_id = ?
                  AND (? OR status IN ('queued', 'acquired'))
                ORDER BY
                    CASE status
                        WHEN 'acquired' THEN 0
                        WHEN 'queued' THEN 1
                        ELSE 2
                    END,
                    created_at, request_id
                """,
                (repository_id, checkout_id, include_terminal),
            ).fetchall()
            return [
                self._workspace_writer_request_from_row(self._connection, row)
                for row in rows
            ]

    def list_active_workspace_writer_requests(
        self,
    ) -> list[WorkspaceWriterRequestRecord]:
        """Return every queued/acquired checkout writer for reconciliation.

        Startup recovery cannot enumerate by repository/checkout because the
        potentially orphaned request is itself the durable record that names
        those scopes.  Terminal rows remain audit history and are excluded.
        """

        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM workspace_writer_requests
                WHERE status IN ('queued', 'acquired')
                ORDER BY repository_id, checkout_id,
                    CASE status
                        WHEN 'acquired' THEN 0
                        ELSE 1
                    END,
                    created_at, request_id
                """
            ).fetchall()
            return [
                self._workspace_writer_request_from_row(self._connection, row)
                for row in rows
            ]

    def release_workspace_writer(
        self,
        *,
        request_id: str,
        task_id: str,
        now: float | None = None,
    ) -> WorkspaceWriterReleaseResult:
        return self._finish_workspace_writer(
            request_id=request_id,
            task_id=task_id,
            final_status="released",
            now=now,
        )

    def interrupt_workspace_writer(
        self,
        *,
        request_id: str,
        task_id: str,
        now: float | None = None,
    ) -> WorkspaceWriterReleaseResult:
        return self._finish_workspace_writer(
            request_id=request_id,
            task_id=task_id,
            final_status="interrupted",
            now=now,
        )

    def _finish_workspace_writer(
        self,
        *,
        request_id: str,
        task_id: str,
        final_status: str,
        now: float | None,
    ) -> WorkspaceWriterReleaseResult:
        if final_status not in {"released", "interrupted"}:
            raise ValueError("invalid workspace writer terminal status")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM workspace_writer_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            if row is None:
                raise RunNotFoundError(
                    f"workspace writer request_id {request_id!r} does not exist"
                )
            if row["task_id"] != task_id:
                raise InvalidRunTransitionError(
                    "workspace writer can only be finished by its owning Task"
                )
            if row["status"] in {"released", "interrupted"}:
                return WorkspaceWriterReleaseResult(
                    finished=self._workspace_writer_request_from_row(
                        connection,
                        row,
                    ),
                    next_acquired=None,
                )
            next_acquired = None
            if row["status"] == "acquired":
                lease = connection.execute(
                    """
                    SELECT * FROM workspace_writer_leases
                    WHERE repository_id = ? AND checkout_id = ?
                    """,
                    (row["repository_id"], row["checkout_id"]),
                ).fetchone()
                if lease is None or lease["request_id"] != request_id:
                    raise InvalidRunTransitionError(
                        "workspace writer lease ownership is inconsistent"
                    )
                connection.execute(
                    """
                    DELETE FROM workspace_writer_leases
                    WHERE repository_id = ? AND checkout_id = ?
                    """,
                    (row["repository_id"], row["checkout_id"]),
                )
            connection.execute(
                """
                UPDATE workspace_writer_requests
                SET status = ?, finished_at = ?, updated_at = ?
                WHERE request_id = ?
                """,
                (final_status, timestamp, timestamp, request_id),
            )
            if row["status"] == "acquired":
                queued = connection.execute(
                    """
                    SELECT request_id FROM workspace_writer_requests
                    WHERE repository_id = ? AND checkout_id = ?
                      AND status = 'queued'
                    ORDER BY created_at, request_id
                    LIMIT 1
                    """,
                    (row["repository_id"], row["checkout_id"]),
                ).fetchone()
                if queued is not None:
                    self._acquire_workspace_writer_in_transaction(
                        connection,
                        request_id=queued["request_id"],
                        now=timestamp,
                    )
                    acquired_row = connection.execute(
                        """
                        SELECT * FROM workspace_writer_requests
                        WHERE request_id = ?
                        """,
                        (queued["request_id"],),
                    ).fetchone()
                    assert acquired_row is not None
                    next_acquired = self._workspace_writer_request_from_row(
                        connection,
                        acquired_row,
                    )
            finished_row = connection.execute(
                "SELECT * FROM workspace_writer_requests WHERE request_id = ?",
                (request_id,),
            ).fetchone()
            assert finished_row is not None
            return WorkspaceWriterReleaseResult(
                finished=self._workspace_writer_request_from_row(
                    connection,
                    finished_row,
                ),
                next_acquired=next_acquired,
            )

    @staticmethod
    def _acquire_workspace_writer_in_transaction(
        connection: sqlite3.Connection,
        *,
        request_id: str,
        now: float,
    ) -> None:
        row = connection.execute(
            "SELECT * FROM workspace_writer_requests WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        if row is None or row["status"] != "queued":
            raise InvalidRunTransitionError(
                "only a queued workspace writer can acquire the lease"
            )
        connection.execute(
            """
            INSERT INTO workspace_writer_leases(
                repository_id, checkout_id, request_id, task_id, project_id,
                target_ref, acquired_at, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                row["repository_id"],
                row["checkout_id"],
                row["request_id"],
                row["task_id"],
                row["project_id"],
                row["target_ref"],
                now,
            ),
        )
        connection.execute(
            """
            UPDATE workspace_writer_requests
            SET status = 'acquired', acquired_at = ?, updated_at = ?
            WHERE request_id = ? AND status = 'queued'
            """,
            (now, now, request_id),
        )

    def list_all_runs(self) -> list[RunRecord]:
        """Return canonical Runs for startup projection reconciliation."""

        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM runs ORDER BY created_at"
            ).fetchall()
            return [self._run_from_row(row) for row in rows]

    def get_cloud_project_cursor(self, project_id: str) -> int:
        """Return the last canonical Cloud cursor imported into this device."""

        with self._lock:
            row = self._connection.execute(
                "SELECT last_cursor FROM cloud_project_replicas WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            return int(row["last_cursor"]) if row is not None else 0

    def import_cloud_project_page(
        self,
        *,
        project_id: str,
        after_cursor: int,
        next_cursor: int,
        events: list[CloudRunEventReplica],
        now: float | None = None,
    ) -> int:
        """Import a canonical PG event page without creating a new upload outbox.

        This is a read replica repair path. Imported history is deliberately
        marked ``cloud_restore`` so it can be rendered after local data loss,
        but cannot be mistaken for a locally executable Run with a bound
        workspace and credentials.
        """

        if not project_id.strip():
            raise ValueError("project_id is required")
        if after_cursor < 0 or next_cursor < after_cursor:
            raise ValueError("invalid cloud cursor range")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            cursor_row = connection.execute(
                "SELECT last_cursor FROM cloud_project_replicas WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            persisted_cursor = (
                int(cursor_row["last_cursor"]) if cursor_row is not None else 0
            )
            if persisted_cursor != after_cursor:
                raise OptimisticConcurrencyError(
                    f"project {project_id!r} cloud cursor expected {after_cursor}, "
                    f"found {persisted_cursor}"
                )
            expected_cursors = list(
                range(after_cursor + 1, after_cursor + 1 + len(events))
            )
            if [event.cloud_cursor for event in events] != expected_cursors:
                raise IdempotencyConflictError(
                    f"project {project_id!r} cloud event page is not contiguous"
                )
            if (
                events[-1].cloud_cursor if events else after_cursor
            ) != next_cursor:
                raise IdempotencyConflictError(
                    f"project {project_id!r} next_cursor does not match its event page"
                )

            for event in events:
                if event.project_id != project_id:
                    raise IdempotencyConflictError(
                        f"event {event.event_id!r} belongs to another project"
                    )
                if event.run_sequence < 1 or event.run_version < 1:
                    raise ValueError(
                        "cloud Run sequence and version must be positive"
                    )
                payload_json = json.dumps(
                    event.payload,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                )
                run = connection.execute(
                    "SELECT * FROM runs WHERE run_id = ?", (event.run_id,)
                ).fetchone()
                if run is None:
                    connection.execute(
                        """
                        INSERT INTO runs(
                            run_id, project_id, status, version,
                            active_attempt_id, deadline_at,
                            timeout_policy_version, created_at, updated_at,
                            origin, resume_blocked_reason
                        ) VALUES (?, ?, 'interrupted', 0, NULL, NULL, 'v1',
                                  ?, ?, 'cloud_restore',
                                  'cloud_restore_workspace_missing')
                        """,
                        (
                            event.run_id,
                            project_id,
                            event.created_at,
                            event.created_at,
                        ),
                    )
                    run = connection.execute(
                        "SELECT * FROM runs WHERE run_id = ?", (event.run_id,)
                    ).fetchone()
                assert run is not None
                if run["project_id"] != project_id:
                    raise IdempotencyConflictError(
                        f"run_id {event.run_id!r} belongs to another project"
                    )

                duplicate = connection.execute(
                    "SELECT * FROM run_events WHERE event_id = ?",
                    (event.event_id,),
                ).fetchone()
                sequence_owner = connection.execute(
                    "SELECT * FROM run_events WHERE run_id = ? AND sequence = ?",
                    (event.run_id, event.run_sequence),
                ).fetchone()
                existing = duplicate or sequence_owner
                if existing is not None:
                    existing_payload = json.loads(existing["payload_json"])
                    payload_matches = (
                        existing_payload == event.payload
                        or cloud_event_payload(
                            str(existing["event_type"]), existing_payload
                        )
                        == event.payload
                    )
                    if (
                        existing["event_id"] != event.event_id
                        or existing["run_id"] != event.run_id
                        or int(existing["sequence"]) != event.run_sequence
                        or int(existing["run_version"]) != event.run_version
                        or existing["event_type"] != event.event_type
                        or not payload_matches
                        or existing["legacy_step"] != event.legacy_step
                    ):
                        raise IdempotencyConflictError(
                            f"cloud event {event.event_id!r} conflicts with local history"
                        )
                else:
                    connection.execute(
                        """
                        INSERT INTO run_events(
                            event_id, run_id, sequence, run_version, event_type,
                            payload_json, legacy_step, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            event.event_id,
                            event.run_id,
                            event.run_sequence,
                            event.run_version,
                            event.event_type,
                            payload_json,
                            event.legacy_step,
                            event.created_at,
                        ),
                    )
                projected_status = self._terminal_status_for_event(
                    RunEventDraft(
                        event_id=event.event_id,
                        event_type=event.event_type,
                        payload=event.payload,
                        legacy_step=event.legacy_step,
                        created_at=event.created_at,
                    )
                )
                if run["origin"] == "cloud_restore":
                    connection.execute(
                        """
                        UPDATE runs
                        SET version = MAX(version, ?),
                            status = COALESCE(?, status),
                            updated_at = MAX(updated_at, ?)
                        WHERE run_id = ?
                        """,
                        (
                            event.run_version,
                            projected_status,
                            event.created_at,
                            event.run_id,
                        ),
                    )

            connection.execute(
                """
                INSERT INTO cloud_project_replicas(project_id, last_cursor, last_synced_at)
                VALUES (?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    last_cursor = excluded.last_cursor,
                    last_synced_at = excluded.last_synced_at
                """,
                (project_id, next_cursor, timestamp),
            )
            return next_cursor

    def reconcile_cloud_project_runs(
        self,
        *,
        project_id: str,
        current_cursor: int,
        runs: list[CloudRunReplica],
        now: float | None = None,
    ) -> None:
        """Apply Cloud aggregate status after every event page was imported."""

        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            cursor = connection.execute(
                "SELECT last_cursor FROM cloud_project_replicas WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            local_cursor = int(cursor["last_cursor"]) if cursor else 0
            if local_cursor != current_cursor:
                raise OptimisticConcurrencyError(
                    f"project {project_id!r} bootstrap ended at {local_cursor}, "
                    f"server watermark is {current_cursor}"
                )
            for replica in runs:
                row = connection.execute(
                    "SELECT * FROM runs WHERE run_id = ?", (replica.run_id,)
                ).fetchone()
                if row is None:
                    # A canonical Run without events is not executable either;
                    # retain it so the UI can show that recovery is incomplete.
                    connection.execute(
                        """
                        INSERT INTO runs(
                            run_id, project_id, status, version,
                            active_attempt_id, deadline_at,
                            timeout_policy_version, created_at, updated_at,
                            origin, resume_blocked_reason
                        ) VALUES (?, ?, ?, ?, NULL, NULL, 'v1', ?, ?,
                                  'cloud_restore',
                                  'cloud_restore_workspace_missing')
                        """,
                        (
                            replica.run_id,
                            project_id,
                            self._cloud_restored_status(replica.status),
                            max(0, replica.expected_next_run_sequence - 1),
                            replica.updated_at,
                            replica.updated_at,
                        ),
                    )
                    continue
                if row["project_id"] != project_id:
                    raise IdempotencyConflictError(
                        f"run_id {replica.run_id!r} belongs to another project"
                    )
                if row["origin"] == "cloud_restore":
                    connection.execute(
                        """
                        UPDATE runs
                        SET status = ?, version = MAX(version, ?),
                            updated_at = MAX(updated_at, ?),
                            resume_blocked_reason = 'cloud_restore_workspace_missing'
                        WHERE run_id = ?
                        """,
                        (
                            self._cloud_restored_status(replica.status),
                            max(0, replica.expected_next_run_sequence - 1),
                            replica.updated_at,
                            replica.run_id,
                        ),
                    )
            connection.execute(
                """
                UPDATE cloud_project_replicas
                SET last_synced_at = ? WHERE project_id = ?
                """,
                (timestamp, project_id),
            )

    def append_event(
        self,
        run_id: str,
        draft: RunEventDraft,
        *,
        expected_version: int | None = None,
        expected_project_id: str | None = None,
    ) -> CommittedRunEvent:
        payload_json = json.dumps(
            dict(draft.payload),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        with self._write_transaction() as connection:
            terminal_status = self._terminal_status_for_event(draft)
            event = self._append_event_in_transaction(
                connection,
                run_id,
                draft,
                payload_json=payload_json,
                expected_version=expected_version,
                expected_project_id=expected_project_id,
                run_status=terminal_status,
                clear_active_attempt=terminal_status is not None,
            )
            if terminal_status is not None:
                attempt_status = (
                    "completed"
                    if terminal_status == "completed"
                    else terminal_status
                )
                connection.execute(
                    """
                    UPDATE run_attempts
                    SET status = ?, ended_at = COALESCE(ended_at, ?),
                        outcome = COALESCE(outcome, ?)
                    WHERE run_id = ? AND status IN ('pending', 'running', 'waiting_for_user')
                    """,
                    (
                        attempt_status,
                        draft.created_at,
                        draft.event_type,
                        run_id,
                    ),
                )
            return event

    def append_events(
        self,
        run_id: str,
        drafts: list[RunEventDraft] | tuple[RunEventDraft, ...],
        *,
        expected_project_id: str | None = None,
    ) -> list[CommittedRunEvent]:
        """Atomically append a non-terminal typed event batch.

        Step reconciliation often needs to create and start/complete a Step in
        one plan update.  Keeping the batch in one SQLite transaction prevents
        replay from observing half of that lifecycle.
        """

        if not drafts:
            return []
        if any(self._terminal_status_for_event(draft) for draft in drafts):
            raise ValueError(
                "terminal Run events require their dedicated commit path"
            )
        with self._write_transaction() as connection:
            return [
                self._append_event_in_transaction(
                    connection,
                    run_id,
                    draft,
                    expected_project_id=expected_project_id,
                )
                for draft in drafts
            ]

    def append_event_with_workforce_step_projection(
        self,
        run_id: str,
        draft: RunEventDraft,
        *,
        expected_project_id: str,
    ) -> CommittedRunEvent:
        """Append a subtask fact plus its Step projection or a durable gap.

        Producer-side Workforce code authors the Step before dispatch. This
        transaction is the compatibility path for older or restored streams
        that contain only legacy subtask events. A savepoint prevents a failed
        projection from leaking a partial Step lifecycle; the legacy fact and
        a bounded projection-gap event still commit so UI narration is not
        misreported as a canonical write failure.
        """

        with self._write_transaction() as connection:
            event = self._append_event_in_transaction(
                connection,
                run_id,
                draft,
                expected_project_id=expected_project_id,
            )
            try:
                with self._savepoint(connection, "workforce_step_projection"):
                    self._project_workforce_subtask_step_in_transaction(
                        connection,
                        run_id=run_id,
                        event=event,
                    )
            except Exception as exc:
                logger.exception(
                    "Workforce Step compatibility projection failed",
                    extra={
                        "run_id": run_id,
                        "source_event_id": event.event_id,
                        "source_event_type": event.event_type,
                    },
                )
                gap_digest = hashlib.sha256(
                    event.event_id.encode("utf-8")
                ).hexdigest()[:24]
                self._append_event_in_transaction(
                    connection,
                    run_id,
                    RunEventDraft(
                        event_id=(
                            f"projection-gap:workforce-step:{gap_digest}"
                        ),
                        event_type="projection.workforce_step_failed",
                        payload={
                            "projection": "workforce_step.v1",
                            "source_event_id": event.event_id,
                            "source_event_type": event.event_type,
                            "task_id": str(event.payload.get("task_id") or "")[
                                :160
                            ],
                            "error_type": type(exc).__name__[:160],
                            "retryable": True,
                        },
                        created_at=event.created_at,
                    ),
                )
            return event

    def append_artifact_manifest_events(
        self,
        run_id: str,
        drafts: list[RunEventDraft] | tuple[RunEventDraft, ...],
        *,
        expected_project_id: str | None = None,
    ) -> CommittedRunEvent:
        """Commit one Run's Artifact lifecycle and manifest barrier once.

        Artifact discovery runs before this transaction and two terminal paths
        may race to publish its result. While a Run remains non-terminal a
        later scan may append a corrected manifest (for example after crash
        recovery). Once terminal, ``BEGIN IMMEDIATE`` plus the in-lock barrier
        lookup freezes and returns the latest committed manifest.
        """

        if (
            not drafts
            or drafts[-1].event_type != "artifact.manifest.finalized"
        ):
            raise ValueError(
                "artifact batch must end with a finalized manifest"
            )
        if any(
            self._terminal_status_for_event(draft) is not None
            for draft in drafts
        ):
            raise ValueError("artifact batches cannot contain terminal events")

        with self._write_transaction() as connection:
            existing = connection.execute(
                """
                SELECT event_id, run_id, sequence, run_version, event_type,
                       payload_json, legacy_step, created_at
                FROM run_events
                WHERE run_id = ? AND event_type = 'artifact.manifest.finalized'
                ORDER BY sequence DESC
                LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            run = connection.execute(
                "SELECT status, project_id FROM runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if existing is not None and run["status"] in {
                "completed",
                "failed",
                "cancelled",
            }:
                return self._event_from_row(existing)
            if existing is not None:
                existing_payload = json.loads(existing["payload_json"])
                incoming_payload = dict(drafts[-1].payload)
                if (
                    existing_payload.get("scan_status") == "complete"
                    and incoming_payload.get("scan_status") != "complete"
                ):
                    return self._event_from_row(existing)

            committed: list[CommittedRunEvent] = []
            for draft in drafts:
                committed.append(
                    self._append_event_in_transaction(
                        connection,
                        run_id,
                        draft,
                        expected_project_id=expected_project_id,
                    )
                )
            self._enqueue_artifact_uploads_in_transaction(
                connection,
                run_id=run_id,
                project_id=str(run["project_id"]),
                manifest_payload=dict(drafts[-1].payload),
                created_at=float(drafts[-1].created_at),
            )
            return committed[-1]

    @staticmethod
    def _enqueue_artifact_uploads_in_transaction(
        connection: sqlite3.Connection,
        *,
        run_id: str,
        project_id: str,
        manifest_payload: dict[str, Any],
        created_at: float,
    ) -> None:
        artifacts = manifest_payload.get("artifacts")
        if not isinstance(artifacts, list):
            return
        current_ids: list[str] = []
        for raw in artifacts:
            if not isinstance(raw, dict):
                continue
            artifact_id = str(raw.get("artifact_id") or "").strip()
            local_path = str(raw.get("path") or "").strip()
            if (
                not artifact_id
                or not local_path
                or raw.get("uploadPolicy") != "agent_generated"
            ):
                continue
            current_ids.append(artifact_id)
            connection.execute(
                """
                INSERT OR IGNORE INTO artifact_upload_outbox(
                    artifact_id, run_id, project_id, local_path, filename,
                    relative_path, file_size, status, attempt_count,
                    next_attempt_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
                """,
                (
                    artifact_id,
                    run_id,
                    project_id,
                    local_path,
                    str(raw.get("filename") or Path(local_path).name),
                    str(raw.get("relativePath") or Path(local_path).name),
                    max(0, int(raw.get("size") or 0)),
                    created_at,
                    created_at,
                    created_at,
                ),
            )

        if manifest_payload.get("scan_status") != "complete":
            return

        # A corrected non-terminal manifest may drop a vanished file. Do not
        # upload a stale path that is no longer part of the canonical barrier.
        if current_ids:
            connection.execute(
                """
                DELETE FROM artifact_upload_outbox
                WHERE run_id = ? AND status = 'pending'
                  AND artifact_id NOT IN (SELECT value FROM json_each(?))
                """,
                (run_id, json.dumps(current_ids, separators=(",", ":"))),
            )
        else:
            connection.execute(
                """
                DELETE FROM artifact_upload_outbox
                WHERE run_id = ? AND status = 'pending'
                """,
                (run_id,),
            )

    def complete_successful_run(
        self,
        run_id: str,
        *,
        assistant_final: RunEventDraft,
        terminal: RunEventDraft,
        artifact_manifest: CommittedRunEvent,
        expected_project_id: str,
    ) -> tuple[CommittedRunEvent, CommittedRunEvent]:
        """Atomically commit the canonical result and successful Run terminal.

        Artifact discovery intentionally happens before this short transaction.
        A crash after its manifest barrier is safe because a non-terminal Run may
        publish a later manifest generation; the successful assistant result and
        ``run.completed`` themselves never become separated.
        """

        if assistant_final.event_type != "assistant.final":
            raise ValueError("successful completion requires assistant.final")
        if terminal.event_type != "run.completed":
            raise ValueError("successful completion requires run.completed")
        if artifact_manifest.run_id != run_id:
            raise IdempotencyConflictError(
                "Artifact manifest belongs to another Run"
            )
        if artifact_manifest.event_type != "artifact.manifest.finalized":
            raise IdempotencyConflictError(
                "Successful completion requires an Artifact manifest"
            )
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["project_id"] != expected_project_id:
                raise IdempotencyConflictError(
                    f"run_id {run_id!r} belongs to another project"
                )

            unresolved_tools = connection.execute(
                """
                SELECT tool_call_id, safety_class, idempotency_key
                FROM tool_calls
                WHERE run_id = ? AND status IN ('dispatched', 'outcome_unknown')
                ORDER BY created_at, tool_call_id
                """,
                (run_id,),
            ).fetchall()
            blocking_tool = next(
                (
                    tool
                    for tool in unresolved_tools
                    if self._tool_call_requires_fail_closed(tool)
                ),
                None,
            )
            if blocking_tool is not None:
                raise InvalidRunTransitionError(
                    "a Run with an unresolved Tool outcome that is "
                    "non-replayable cannot complete successfully "
                    f"({blocking_tool['tool_call_id']})"
                )

            self._close_dispatched_model_invocations_in_transaction(
                connection,
                run_id=run_id,
                terminal_event_type=terminal.event_type,
                timestamp=terminal.created_at,
            )

            # Artifact discovery happens outside this short transaction and
            # two terminal paths may race. Pin the newest committed manifest
            # under the same writer lock as run.completed; never trust the
            # manifest object observed before this transaction began.
            latest_manifest = self._latest_artifact_manifest_in_transaction(
                connection,
                run_id,
            )
            terminal_payload = {
                **dict(terminal.payload),
                "artifact_manifest_event_id": latest_manifest.event_id,
                "artifact_count": int(
                    latest_manifest.payload.get("artifact_count", 0)
                ),
                "result_event_id": assistant_final.event_id,
            }
            terminal_draft = RunEventDraft(
                event_id=terminal.event_id,
                event_type=terminal.event_type,
                payload=terminal_payload,
                legacy_step=terminal.legacy_step,
                created_at=terminal.created_at,
            )

            result_event = self._append_event_in_transaction(
                connection,
                run_id,
                assistant_final,
                expected_project_id=expected_project_id,
                allow_assistant_final=True,
            )
            terminal_event = self._append_event_in_transaction(
                connection,
                run_id,
                terminal_draft,
                expected_project_id=expected_project_id,
                run_status="completed",
                clear_active_attempt=True,
            )
            connection.execute(
                """
                UPDATE run_attempts
                SET status = 'completed', ended_at = COALESCE(ended_at, ?),
                    outcome = COALESCE(outcome, 'run.completed')
                WHERE run_id = ?
                  AND status IN ('pending', 'running', 'waiting_for_user')
                """,
                (terminal_draft.created_at, run_id),
            )
            return result_event, terminal_event

    def append_terminal_with_latest_artifact_manifest(
        self,
        run_id: str,
        draft: RunEventDraft,
        *,
        expected_project_id: str | None = None,
    ) -> CommittedRunEvent:
        """Atomically bind a terminal outcome to the latest Artifact manifest."""

        terminal_status = self._terminal_status_for_event(draft)
        if terminal_status not in {"completed", "failed", "cancelled"}:
            raise ValueError(
                "Artifact terminal commit requires a terminal Run event"
            )
        with self._write_transaction() as connection:
            latest_manifest = self._latest_artifact_manifest_in_transaction(
                connection,
                run_id,
            )
            self._close_dispatched_model_invocations_in_transaction(
                connection,
                run_id=run_id,
                terminal_event_type=draft.event_type,
                timestamp=draft.created_at,
            )
            enriched = RunEventDraft(
                event_id=draft.event_id,
                event_type=draft.event_type,
                payload={
                    **dict(draft.payload),
                    "artifact_manifest_event_id": latest_manifest.event_id,
                    "artifact_count": int(
                        latest_manifest.payload.get("artifact_count", 0)
                    ),
                },
                legacy_step=draft.legacy_step,
                created_at=draft.created_at,
            )
            event = self._append_event_in_transaction(
                connection,
                run_id,
                enriched,
                expected_project_id=expected_project_id,
                run_status=terminal_status,
                clear_active_attempt=True,
            )
            attempt_status = (
                "completed"
                if terminal_status == "completed"
                else terminal_status
            )
            connection.execute(
                """
                UPDATE run_attempts
                SET status = ?, ended_at = COALESCE(ended_at, ?),
                    outcome = COALESCE(outcome, ?)
                WHERE run_id = ?
                  AND status IN ('pending', 'running', 'waiting_for_user')
                """,
                (
                    attempt_status,
                    enriched.created_at,
                    enriched.event_type,
                    run_id,
                ),
            )
            return event

    def _latest_artifact_manifest_in_transaction(
        self,
        connection: sqlite3.Connection,
        run_id: str,
    ) -> CommittedRunEvent:
        row = connection.execute(
            """
            SELECT event_id, run_id, sequence, run_version, event_type,
                   payload_json, legacy_step, created_at
            FROM run_events
            WHERE run_id = ?
              AND event_type = 'artifact.manifest.finalized'
            ORDER BY sequence DESC
            LIMIT 1
            """,
            (run_id,),
        ).fetchone()
        if row is None:
            raise InvalidRunTransitionError(
                f"run {run_id!r} cannot terminate before its Artifact manifest"
            )
        return self._event_from_row(row)

    def list_events(
        self,
        run_id: str,
        *,
        after_sequence: int = 0,
        limit: int | None = None,
        event_type_prefix: str | None = None,
    ) -> list[CommittedRunEvent]:
        if limit is not None and limit < 1:
            raise ValueError("event query limit must be positive")
        query = """
            SELECT event_id, run_id, sequence, run_version, event_type,
                   payload_json, legacy_step, created_at
            FROM run_events
            WHERE run_id = ? AND sequence > ?
        """
        parameters: list[Any] = [run_id, after_sequence]
        if event_type_prefix is not None:
            normalized_prefix = event_type_prefix.strip()
            if not normalized_prefix:
                raise ValueError("event type prefix cannot be blank")
            query += " AND event_type LIKE ?"
            parameters.append(f"{normalized_prefix}%")
        query += " ORDER BY sequence"
        if limit is not None:
            query += " LIMIT ?"
            parameters.append(limit)
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._event_from_row(row) for row in rows]

    def get_events_by_id(
        self, event_ids: tuple[str, ...] | list[str]
    ) -> list[CommittedRunEvent]:
        """Return canonical events in caller order for provenance checks."""

        identifiers = tuple(dict.fromkeys(event_ids))
        if not identifiers:
            return []
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT event_id, run_id, sequence, run_version, event_type,
                       payload_json, legacy_step, created_at
                FROM run_events
                WHERE event_id IN (SELECT value FROM json_each(?))
                """,
                (json.dumps(identifiers, separators=(",", ":")),),
            ).fetchall()
        by_id = {row["event_id"]: self._event_from_row(row) for row in rows}
        return [
            by_id[event_id] for event_id in identifiers if event_id in by_id
        ]

    def get_project_history_cursor(self, project_id: str) -> int:
        """Return the last committed Project History cursor."""

        if not project_id.strip():
            raise ValueError("project_id is required")
        with self._lock:
            row = self._connection.execute(
                """
                SELECT next_cursor - 1 AS current_cursor
                FROM project_history_cursors
                WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
            return int(row["current_cursor"]) if row is not None else 0

    def list_project_history_events(
        self,
        project_id: str,
        *,
        after_cursor: int = 0,
        limit: int = 100,
    ) -> list[ProjectHistoryEventRecord]:
        """Read a bounded cross-Run Project History page."""

        if not project_id.strip():
            raise ValueError("project_id is required")
        if after_cursor < 0:
            raise ValueError("after_cursor must be non-negative")
        if limit < 1 or limit > 500:
            raise ValueError("history query limit must be between 1 and 500")
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT history.project_id, history.journal_cursor,
                       history.source_kind,
                       events.event_id, events.run_id, events.sequence,
                       events.run_version, events.event_type,
                       events.payload_json, events.legacy_step,
                       events.created_at
                FROM project_history_events AS history
                JOIN run_events AS events ON events.event_id = history.event_id
                WHERE history.project_id = ? AND history.journal_cursor > ?
                ORDER BY history.journal_cursor
                LIMIT ?
                """,
                (project_id, after_cursor, limit),
            ).fetchall()
            return [
                ProjectHistoryEventRecord(
                    project_id=row["project_id"],
                    journal_cursor=int(row["journal_cursor"]),
                    event=self._event_from_row(row),
                    source_kind=row["source_kind"],
                )
                for row in rows
            ]

    def ensure_memory_scope_state(
        self,
        scope_type: str,
        scope_id: str,
        *,
        owner_kind: str = "desktop",
        token_limit: int | None = None,
        now: float | None = None,
    ) -> MemoryScopeStateRecord:
        self._validate_memory_scope(scope_type, scope_id)
        if owner_kind not in {"desktop", "cloud"}:
            raise ValueError("invalid Memory owner_kind")
        resolved_limit = (
            token_limit or _MEMORY_DEFAULT_TOKEN_LIMITS[scope_type]
        )
        if resolved_limit < 1:
            raise ValueError("Memory token_limit must be positive")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = self._ensure_memory_scope_state_in_transaction(
                connection,
                scope_type=scope_type,
                scope_id=scope_id,
                owner_kind=owner_kind,
                token_limit=resolved_limit,
                now=timestamp,
            )
            return self._memory_scope_state_from_row(row)

    def bind_memory_scope_owner(
        self,
        scope_type: str,
        scope_id: str,
        *,
        account_owner_id: str,
        now: float | None = None,
    ) -> None:
        """Bind a local scope to one authenticated account exactly once."""

        self._validate_memory_scope(scope_type, scope_id)
        owner = account_owner_id.strip()
        if not owner:
            raise ValueError("Memory account owner is required")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            existing = connection.execute(
                """
                SELECT account_owner_id FROM memory_scope_owners
                WHERE scope_type = ? AND scope_id = ?
                """,
                (scope_type, scope_id),
            ).fetchone()
            if existing is not None and existing["account_owner_id"] != owner:
                raise IdempotencyConflictError(
                    f"Memory scope {scope_type}:{scope_id} belongs to "
                    "another account"
                )
            connection.execute(
                """
                INSERT OR IGNORE INTO memory_scope_owners(
                    scope_type, scope_id, account_owner_id, bound_at
                ) VALUES (?, ?, ?, ?)
                """,
                (scope_type, scope_id, owner, timestamp),
            )

    def register_memory_scope_owner_candidates(
        self,
        *,
        project_id: str,
        space_id: str,
        claimed_account_owner_id: str | None,
        now: float | None = None,
    ) -> None:
        """Record an untrusted ownership claim for later Cloud confirmation."""

        owner = str(claimed_account_owner_id or "").strip()
        if not owner:
            return
        timestamp = now if now is not None else time.time()
        candidates = (
            ("project", project_id),
            ("space", space_id),
            ("user", owner),
        )
        with self._write_transaction() as connection:
            for scope_type, scope_id in candidates:
                self._validate_memory_scope(scope_type, scope_id)
                connection.execute(
                    """
                    INSERT OR IGNORE INTO memory_scope_owner_candidates(
                        scope_type, scope_id, claimed_account_owner_id,
                        created_at
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (scope_type, scope_id, owner, timestamp),
                )

    def list_memory_scope_owner_candidates(
        self,
        account_owner_id: str,
    ) -> list[tuple[str, str]]:
        """Return untrusted claims for explicit server authorization."""

        owner = account_owner_id.strip()
        if not owner:
            return []
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT scope_type, scope_id
                FROM memory_scope_owner_candidates
                WHERE claimed_account_owner_id = ?
                ORDER BY scope_type, scope_id
                """,
                (owner,),
            ).fetchall()
        return [(str(row["scope_type"]), str(row["scope_id"])) for row in rows]

    def confirm_memory_scope_owner_candidates(
        self,
        account_owner_id: str,
        authorized_scopes: list[tuple[str, str]],
        *,
        now: float | None = None,
    ) -> int:
        """Promote only scope keys explicitly authorized by eigent_server."""

        owner = account_owner_id.strip()
        if not owner:
            raise ValueError("Memory account owner is required")
        normalized = set(authorized_scopes)
        for scope_type, scope_id in normalized:
            self._validate_memory_scope(scope_type, scope_id)
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            rows = connection.execute(
                """
                SELECT scope_type, scope_id
                FROM memory_scope_owner_candidates
                WHERE claimed_account_owner_id = ?
                ORDER BY scope_type, scope_id
                """,
                (owner,),
            ).fetchall()
            promoted = 0
            for row in rows:
                key = (str(row["scope_type"]), str(row["scope_id"]))
                if key not in normalized:
                    continue
                existing = connection.execute(
                    """
                    SELECT account_owner_id FROM memory_scope_owners
                    WHERE scope_type = ? AND scope_id = ?
                    """,
                    (row["scope_type"], row["scope_id"]),
                ).fetchone()
                if existing is not None:
                    if existing["account_owner_id"] != owner:
                        continue
                else:
                    connection.execute(
                        """
                        INSERT INTO memory_scope_owners(
                            scope_type, scope_id, account_owner_id, bound_at
                        ) VALUES (?, ?, ?, ?)
                        """,
                        (
                            row["scope_type"],
                            row["scope_id"],
                            owner,
                            timestamp,
                        ),
                    )
                    promoted += 1
                connection.execute(
                    """
                    DELETE FROM memory_scope_owner_candidates
                    WHERE scope_type = ? AND scope_id = ?
                      AND claimed_account_owner_id = ?
                    """,
                    (row["scope_type"], row["scope_id"], owner),
                )
            return promoted

    def bind_run_memory_scopes(
        self,
        *,
        project_id: str,
        space_id: str,
        account_owner_id: str,
    ) -> None:
        for scope_type, scope_id in (
            ("project", project_id),
            ("space", space_id),
            ("user", account_owner_id),
        ):
            self.bind_memory_scope_owner(
                scope_type,
                scope_id,
                account_owner_id=account_owner_id,
            )

    def bind_memory_project_scopes(
        self,
        *,
        project_id: str,
        space_id: str,
        user_id: str | None,
        now: float | None = None,
    ) -> None:
        """Persist the shared Memory targets fed by one Project History.

        This is routing metadata, not an ownership assertion. Cloud ownership
        remains governed by ``memory_scope_owner_candidates`` and server-side
        authorization.
        """

        self._validate_memory_scope("project", project_id)
        self._validate_memory_scope("space", space_id)
        normalized_user_id = (
            str(user_id).strip() if user_id is not None else None
        )
        if normalized_user_id:
            self._validate_memory_scope("user", normalized_user_id)
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            connection.execute(
                """
                INSERT INTO memory_project_scope_bindings(
                    project_id, space_id, user_id, updated_at
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    space_id = excluded.space_id,
                    user_id = excluded.user_id,
                    updated_at = excluded.updated_at
                """,
                (project_id, space_id, normalized_user_id, timestamp),
            )

    def get_memory_project_scopes(
        self, project_id: str
    ) -> tuple[str | None, str | None]:
        self._validate_memory_scope("project", project_id)
        with self._lock:
            row = self._connection.execute(
                """
                SELECT space_id, user_id
                FROM memory_project_scope_bindings
                WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
        if row is None:
            return None, None
        return str(row["space_id"]), (
            str(row["user_id"]) if row["user_id"] is not None else None
        )

    def get_memory_extraction_watermark(
        self,
        *,
        target_scope_type: str,
        target_scope_id: str,
        source_project_id: str,
    ) -> str | None:
        if target_scope_type not in {"space", "user"}:
            raise ValueError("shared Memory extraction target is required")
        self._validate_memory_scope(target_scope_type, target_scope_id)
        self._validate_memory_scope("project", source_project_id)
        with self._lock:
            row = self._connection.execute(
                """
                SELECT processed_through_watermark
                FROM memory_extraction_watermarks
                WHERE target_scope_type = ? AND target_scope_id = ?
                  AND source_project_id = ?
                """,
                (target_scope_type, target_scope_id, source_project_id),
            ).fetchone()
        if row is None or row["processed_through_watermark"] is None:
            return None
        return str(row["processed_through_watermark"])

    def record_memory_extraction_watermark(
        self,
        *,
        target_scope_type: str,
        target_scope_id: str,
        source_project_id: str,
        processed_through_watermark: str | None,
        watermark_kind: str | None,
        extractor_version: str,
        last_error: str | None = None,
        now: float | None = None,
    ) -> None:
        """Record one source Project's progress into a shared target scope."""

        if target_scope_type not in {"space", "user"}:
            raise ValueError("shared Memory extraction target is required")
        self._validate_memory_scope(target_scope_type, target_scope_id)
        self._validate_memory_scope("project", source_project_id)
        if not extractor_version.strip():
            raise ValueError("Memory extractor_version is required")
        if last_error is None and (
            processed_through_watermark is None or watermark_kind is None
        ):
            raise ValueError("successful maintenance requires a watermark")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            connection.execute(
                """
                INSERT INTO memory_extraction_watermarks(
                    target_scope_type, target_scope_id, source_project_id,
                    processed_through_watermark, watermark_kind,
                    extractor_version, last_error, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(
                    target_scope_type, target_scope_id, source_project_id
                ) DO UPDATE SET
                    processed_through_watermark = CASE
                        WHEN excluded.processed_through_watermark IS NULL
                        THEN memory_extraction_watermarks.processed_through_watermark
                        ELSE excluded.processed_through_watermark
                    END,
                    watermark_kind = CASE
                        WHEN excluded.watermark_kind IS NULL
                        THEN memory_extraction_watermarks.watermark_kind
                        ELSE excluded.watermark_kind
                    END,
                    extractor_version = excluded.extractor_version,
                    last_error = excluded.last_error,
                    updated_at = excluded.updated_at
                """,
                (
                    target_scope_type,
                    target_scope_id,
                    source_project_id,
                    processed_through_watermark,
                    watermark_kind,
                    extractor_version,
                    last_error[:2000] if last_error else None,
                    timestamp,
                ),
            )

    def get_memory_scope_state(
        self, scope_type: str, scope_id: str
    ) -> MemoryScopeStateRecord | None:
        self._validate_memory_scope(scope_type, scope_id)
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM memory_scope_state
                WHERE scope_type = ? AND scope_id = ?
                """,
                (scope_type, scope_id),
            ).fetchone()
            return (
                self._memory_scope_state_from_row(row)
                if row is not None
                else None
            )

    def update_memory_scope_settings(
        self,
        scope_type: str,
        scope_id: str,
        *,
        expected_revision: int,
        capture_enabled: bool | None = None,
        use_enabled: bool | None = None,
        sync_scope: str | None = None,
        now: float | None = None,
    ) -> MemoryScopeStateRecord:
        self._validate_memory_scope(scope_type, scope_id)
        if sync_scope is not None and sync_scope != "full_memory":
            raise ValueError("Memory sync is fixed to full_memory")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = self._ensure_memory_scope_state_in_transaction(
                connection,
                scope_type=scope_type,
                scope_id=scope_id,
                owner_kind="desktop",
                token_limit=_MEMORY_DEFAULT_TOKEN_LIMITS[scope_type],
                now=timestamp,
            )
            if int(row["revision"]) != expected_revision:
                raise OptimisticConcurrencyError(
                    f"Memory scope {scope_type}:{scope_id} expected revision "
                    f"{expected_revision}, found {row['revision']}"
                )
            updated = connection.execute(
                """
                UPDATE memory_scope_state
                SET capture_enabled = COALESCE(?, capture_enabled),
                    use_enabled = COALESCE(?, use_enabled),
                    sync_scope = COALESCE(?, sync_scope),
                    revision = revision + 1,
                    updated_at = ?
                WHERE scope_type = ? AND scope_id = ? AND revision = ?
                """,
                (
                    int(capture_enabled)
                    if capture_enabled is not None
                    else None,
                    int(use_enabled) if use_enabled is not None else None,
                    sync_scope,
                    timestamp,
                    scope_type,
                    scope_id,
                    expected_revision,
                ),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    "Memory scope changed during update"
                )
            result = connection.execute(
                """
                SELECT * FROM memory_scope_state
                WHERE scope_type = ? AND scope_id = ?
                """,
                (scope_type, scope_id),
            ).fetchone()
            assert result is not None
            return self._memory_scope_state_from_row(result)

    def advance_memory_snapshot_revision_after_cloud_conflict(
        self,
        scope_type: str,
        scope_id: str,
        *,
        expected_revision: int,
        now: float | None = None,
    ) -> bool:
        """Publish a changed local projection as a new immutable revision.

        Older Desktop migrations changed snapshot-visible scope settings
        without advancing ``revision``. Cloud correctly rejects those bytes
        as a rewrite of an already stored revision. Repair only the scope
        named by that explicit conflict, and use CAS so a concurrent real
        Memory mutation always wins.
        """

        self._validate_memory_scope(scope_type, scope_id)
        if expected_revision < 0:
            raise ValueError("expected Memory revision must be non-negative")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE memory_scope_state
                SET revision = revision + 1, updated_at = ?
                WHERE scope_type = ? AND scope_id = ? AND revision = ?
                """,
                (timestamp, scope_type, scope_id, expected_revision),
            )
            return updated.rowcount == 1

    def get_memory_entry(self, memory_id: str) -> MemoryEntryRecord | None:
        if not memory_id.strip():
            raise ValueError("memory_id is required")
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM memory_entries WHERE memory_id = ?",
                (memory_id,),
            ).fetchone()
            return (
                self._memory_entry_from_row(row) if row is not None else None
            )

    def record_memory_maintenance_result(
        self,
        scope_type: str,
        scope_id: str,
        *,
        expected_revision: int,
        processed_through_watermark: str | None,
        watermark_kind: str | None,
        extractor_version: str,
        last_error: str | None = None,
        now: float | None = None,
    ) -> MemoryScopeStateRecord:
        """CAS-persist a bounded maintainer outcome.

        A failed pass records only its error. A successful pass advances the
        opaque History cursor after all idempotent mutations were applied.
        """

        self._validate_memory_scope(scope_type, scope_id)
        if not extractor_version.strip():
            raise ValueError("Memory extractor_version is required")
        if last_error is None and (
            processed_through_watermark is None or watermark_kind is None
        ):
            raise ValueError("successful maintenance requires a watermark")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = self._ensure_memory_scope_state_in_transaction(
                connection,
                scope_type=scope_type,
                scope_id=scope_id,
                owner_kind="desktop",
                token_limit=_MEMORY_DEFAULT_TOKEN_LIMITS[scope_type],
                now=timestamp,
            )
            if int(row["revision"]) != expected_revision:
                raise OptimisticConcurrencyError(
                    f"Memory scope {scope_type}:{scope_id} expected revision "
                    f"{expected_revision}, found {row['revision']}"
                )
            updated = connection.execute(
                """
                UPDATE memory_scope_state
                SET processed_through_watermark = CASE
                        WHEN ? IS NULL THEN processed_through_watermark ELSE ? END,
                    watermark_kind = CASE
                        WHEN ? IS NULL THEN watermark_kind ELSE ? END,
                    extractor_version = ?, last_error = ?,
                    revision = revision + 1, updated_at = ?
                WHERE scope_type = ? AND scope_id = ? AND revision = ?
                """,
                (
                    processed_through_watermark,
                    processed_through_watermark,
                    watermark_kind,
                    watermark_kind,
                    extractor_version,
                    last_error[:2000] if last_error else None,
                    timestamp,
                    scope_type,
                    scope_id,
                    expected_revision,
                ),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    "Memory scope changed during maintenance"
                )
            result = connection.execute(
                """SELECT * FROM memory_scope_state
                WHERE scope_type = ? AND scope_id = ?""",
                (scope_type, scope_id),
            ).fetchone()
            assert result is not None
            return self._memory_scope_state_from_row(result)

    def record_memory_consolidation_result(
        self,
        scope_type: str,
        scope_id: str,
        *,
        expected_revision: int,
        now: float | None = None,
    ) -> MemoryScopeStateRecord:
        """CAS-record a completed bounded consolidation pass."""

        self._validate_memory_scope(scope_type, scope_id)
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = self._ensure_memory_scope_state_in_transaction(
                connection,
                scope_type=scope_type,
                scope_id=scope_id,
                owner_kind="desktop",
                token_limit=_MEMORY_DEFAULT_TOKEN_LIMITS[scope_type],
                now=timestamp,
            )
            if int(row["revision"]) != expected_revision:
                raise OptimisticConcurrencyError(
                    f"Memory scope {scope_type}:{scope_id} expected revision "
                    f"{expected_revision}, found {row['revision']}"
                )
            updated = connection.execute(
                """
                UPDATE memory_scope_state
                SET last_consolidated_at = ?, last_error = NULL,
                    revision = revision + 1, updated_at = ?
                WHERE scope_type = ? AND scope_id = ? AND revision = ?
                """,
                (
                    timestamp,
                    timestamp,
                    scope_type,
                    scope_id,
                    expected_revision,
                ),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    "Memory scope changed during consolidation"
                )
            result = connection.execute(
                """SELECT * FROM memory_scope_state
                WHERE scope_type = ? AND scope_id = ?""",
                (scope_type, scope_id),
            ).fetchone()
            assert result is not None
            return self._memory_scope_state_from_row(result)

    def list_memory_entries(
        self,
        scope_type: str,
        scope_id: str,
        *,
        include_deleted: bool = False,
        limit: int = 200,
    ) -> list[MemoryEntryRecord]:
        self._validate_memory_scope(scope_type, scope_id)
        if limit < 1 or limit > 500:
            raise ValueError("Memory list limit must be between 1 and 500")
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM memory_entries
                WHERE scope_type = ? AND scope_id = ?
                  AND (? OR deleted_at IS NULL)
                ORDER BY pinned_by_user DESC,
                         CASE priority WHEN 'high' THEN 0 ELSE 1 END,
                         updated_at DESC, memory_id
                LIMIT ?
                """,
                (scope_type, scope_id, include_deleted, limit),
            ).fetchall()
            return [self._memory_entry_from_row(row) for row in rows]

    def list_memory_mutations(
        self,
        scope_type: str,
        scope_id: str,
        *,
        memory_id: str | None = None,
        limit: int = 100,
    ) -> list[MemoryMutationRecord]:
        self._validate_memory_scope(scope_type, scope_id)
        if limit < 1 or limit > 500:
            raise ValueError("Memory mutation limit must be between 1 and 500")
        query = """
            SELECT * FROM memory_mutations
            WHERE scope_type = ? AND scope_id = ?
        """
        parameters: list[Any] = [scope_type, scope_id]
        if memory_id is not None:
            query += " AND memory_id = ?"
            parameters.append(memory_id)
        query += " ORDER BY created_at DESC, mutation_id DESC LIMIT ?"
        parameters.append(limit)
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._memory_mutation_from_row(row) for row in rows]

    def list_memory_reconciliation_items(
        self,
        scope_type: str,
        scope_id: str,
        *,
        account_owner_id: str,
        status: str = "pending",
        limit: int = 100,
    ) -> list[MemoryReconciliationRecord]:
        """List explicit cross-device Memory conflicts for user review."""

        self._validate_memory_scope(scope_type, scope_id)
        if status not in {
            "pending",
            "accepted_local",
            "accepted_cloud",
            "dismissed",
        }:
            raise ValueError("invalid Memory reconciliation status")
        if limit < 1 or limit > 200:
            raise ValueError("Memory reconciliation limit is invalid")
        owner = account_owner_id.strip()
        if not owner:
            raise ValueError("Memory account owner is required")
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM memory_reconciliation_items
                WHERE scope_type = ? AND scope_id = ?
                  AND account_owner_id = ? AND status = ?
                ORDER BY created_at, reconciliation_id
                LIMIT ?
                """,
                (scope_type, scope_id, owner, status, limit),
            ).fetchall()
        return [self._memory_reconciliation_from_row(row) for row in rows]

    def get_memory_reconciliation_item(
        self, reconciliation_id: str
    ) -> MemoryReconciliationRecord | None:
        if not reconciliation_id.strip():
            raise ValueError("Memory reconciliation id is required")
        with self._lock:
            row = self._connection.execute(
                """SELECT * FROM memory_reconciliation_items
                WHERE reconciliation_id = ?""",
                (reconciliation_id,),
            ).fetchone()
        return (
            self._memory_reconciliation_from_row(row)
            if row is not None
            else None
        )

    def resolve_memory_reconciliation_item(
        self,
        reconciliation_id: str,
        *,
        resolution: str,
        now: float | None = None,
    ) -> MemoryReconciliationRecord:
        """CAS-close a conflict after the selected mutation was persisted."""

        if resolution not in {
            "accepted_local",
            "accepted_cloud",
            "dismissed",
        }:
            raise ValueError("invalid Memory reconciliation resolution")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            row = connection.execute(
                """SELECT * FROM memory_reconciliation_items
                WHERE reconciliation_id = ?""",
                (reconciliation_id,),
            ).fetchone()
            if row is None:
                raise RunNotFoundError("Memory reconciliation item not found")
            if row["status"] != "pending":
                if row["status"] != resolution:
                    raise IdempotencyConflictError(
                        "Memory reconciliation was already resolved differently"
                    )
                return self._memory_reconciliation_from_row(row)
            updated = connection.execute(
                """
                UPDATE memory_reconciliation_items
                SET status = ?, resolved_at = ?
                WHERE reconciliation_id = ? AND status = 'pending'
                """,
                (resolution, timestamp, reconciliation_id),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    "Memory reconciliation changed during resolution"
                )
            result = connection.execute(
                """SELECT * FROM memory_reconciliation_items
                WHERE reconciliation_id = ?""",
                (reconciliation_id,),
            ).fetchone()
            assert result is not None
            return self._memory_reconciliation_from_row(result)

    def apply_memory_mutation(
        self,
        *,
        mutation_id: str,
        idempotency_key: str,
        operation: str,
        scope_type: str,
        scope_id: str,
        memory_id: str | None,
        actor_type: str,
        reason: str,
        content: str | None = None,
        kind: str | None = None,
        priority: str = "normal",
        token_count: int | None = None,
        created_by: str | None = None,
        source_trust: str | None = None,
        sensitivity: str = "normal",
        source_refs: tuple[str, ...] = (),
        expected_version: int | None = None,
        actor_id: str | None = None,
        run_id: str | None = None,
        activity_id: str | None = None,
        decision_id: str | None = None,
        confirmed_by_user_action: bool = False,
        reviewed_operation: str | None = None,
        reviewed_memory_id: str | None = None,
        now: float | None = None,
    ) -> MemoryMutationResult:
        """Apply one canonical, CAS-guarded lightweight Memory mutation."""

        self._validate_memory_scope(scope_type, scope_id)
        if not mutation_id.strip() or not idempotency_key.strip():
            raise ValueError("mutation_id and idempotency_key are required")
        if operation not in {
            "add",
            "replace",
            "remove",
            "restore",
            "confirm",
            "pin",
            "consolidate",
            "noop",
        }:
            raise ValueError("invalid Memory operation")
        if actor_type not in {
            "extractor",
            "agent",
            "user",
            "importer",
            "system",
        }:
            raise ValueError("invalid Memory actor_type")
        if not reason.strip():
            raise ValueError("Memory mutation reason is required")
        if len(source_refs) > 32 or any(
            len(value) > 256 for value in source_refs
        ):
            raise ValueError("Memory source_refs exceed the bounded limit")
        timestamp = now if now is not None else time.time()
        encoded_refs = json.dumps(list(source_refs), separators=(",", ":"))
        request_digest = hashlib.sha256(
            json.dumps(
                {
                    "mutation_id": mutation_id,
                    "memory_id": memory_id,
                    "scope_type": scope_type,
                    "scope_id": scope_id,
                    "operation": operation,
                    "actor_type": actor_type,
                    "reason": reason,
                    "content": content,
                    "kind": kind,
                    "priority": priority,
                    "token_count": token_count,
                    "created_by": created_by,
                    "source_trust": source_trust,
                    "sensitivity": sensitivity,
                    "source_refs": list(source_refs),
                    "expected_version": expected_version,
                    "actor_id": actor_id,
                    "run_id": run_id,
                    "activity_id": activity_id,
                    "decision_id": decision_id,
                    "reviewed_operation": reviewed_operation,
                    "reviewed_memory_id": reviewed_memory_id,
                },
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()

        with self._write_transaction() as connection:
            if confirmed_by_user_action:
                self._assert_memory_user_decision_in_transaction(
                    connection,
                    decision_id=decision_id,
                    run_id=run_id,
                    memory_id=memory_id,
                    operation=operation,
                    reviewed_operation=reviewed_operation,
                    reviewed_memory_id=reviewed_memory_id,
                )
            duplicate = connection.execute(
                "SELECT * FROM memory_mutations WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if duplicate is not None:
                if (
                    duplicate["mutation_id"] != mutation_id
                    or duplicate["request_digest"] != request_digest
                ):
                    raise IdempotencyConflictError(
                        "Memory idempotency key was reused with different data"
                    )
                entry_row = (
                    connection.execute(
                        "SELECT * FROM memory_entries WHERE memory_id = ?",
                        (memory_id,),
                    ).fetchone()
                    if memory_id is not None
                    else None
                )
                state_row = self._ensure_memory_scope_state_in_transaction(
                    connection,
                    scope_type=scope_type,
                    scope_id=scope_id,
                    owner_kind="desktop",
                    token_limit=_MEMORY_DEFAULT_TOKEN_LIMITS[scope_type],
                    now=timestamp,
                )
                return MemoryMutationResult(
                    mutation=self._memory_mutation_from_row(duplicate),
                    entry=(
                        self._memory_entry_from_row(entry_row)
                        if entry_row is not None
                        else None
                    ),
                    scope_state=self._memory_scope_state_from_row(state_row),
                )

            state_row = self._ensure_memory_scope_state_in_transaction(
                connection,
                scope_type=scope_type,
                scope_id=scope_id,
                owner_kind="desktop",
                token_limit=_MEMORY_DEFAULT_TOKEN_LIMITS[scope_type],
                now=timestamp,
            )
            entry_row = (
                connection.execute(
                    "SELECT * FROM memory_entries WHERE memory_id = ?",
                    (memory_id,),
                ).fetchone()
                if memory_id is not None
                else None
            )
            before_hash = (
                self._memory_entry_digest(entry_row)
                if entry_row is not None
                else None
            )
            token_delta = 0

            if operation == "noop":
                if memory_id is not None:
                    raise ValueError(
                        "noop mutation must not target a memory_id"
                    )
            elif operation == "add":
                if memory_id is None or entry_row is not None:
                    raise IdempotencyConflictError(
                        "add requires a new, explicit memory_id"
                    )
                self._validate_memory_entry_values(
                    content=content,
                    kind=kind,
                    priority=priority,
                    token_count=token_count,
                    created_by=created_by,
                    source_trust=source_trust,
                    sensitivity=sensitivity,
                )
                token_delta = int(token_count or 0)
                self._assert_memory_capacity(state_row, token_delta)
                connection.execute(
                    """
                    INSERT INTO memory_entries(
                        memory_id, scope_type, scope_id, kind, content,
                        priority, version, token_count, pinned_by_user,
                        confirmed_by_user, created_by, source_trust,
                        sensitivity, source_refs_json, usage_count,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?)
                    """,
                    (
                        memory_id,
                        scope_type,
                        scope_id,
                        kind,
                        content.strip() if content else content,
                        priority,
                        token_count,
                        int(actor_type == "user" or confirmed_by_user_action),
                        created_by,
                        source_trust,
                        sensitivity,
                        encoded_refs,
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                if memory_id is None or entry_row is None:
                    raise RunNotFoundError("Memory entry does not exist")
                if (
                    entry_row["scope_type"] != scope_type
                    or entry_row["scope_id"] != scope_id
                ):
                    raise IdempotencyConflictError(
                        "Memory entry belongs to a different scope"
                    )
                if expected_version is None:
                    raise ValueError("expected_version is required")
                if int(entry_row["version"]) != expected_version:
                    raise OptimisticConcurrencyError(
                        f"Memory entry expected version {expected_version}, "
                        f"found {entry_row['version']}"
                    )
                was_active = entry_row["deleted_at"] is None
                old_tokens = int(entry_row["token_count"]) if was_active else 0
                if operation in {"replace", "consolidate"}:
                    if not was_active:
                        raise InvalidRunTransitionError(
                            "deleted Memory must be restored before replacement"
                        )
                    resolved_kind = kind or str(entry_row["kind"])
                    resolved_content = content or str(entry_row["content"])
                    resolved_tokens = token_count or int(
                        entry_row["token_count"]
                    )
                    resolved_created_by = created_by or str(
                        entry_row["created_by"]
                    )
                    resolved_trust = source_trust or str(
                        entry_row["source_trust"]
                    )
                    self._validate_memory_entry_values(
                        content=resolved_content,
                        kind=resolved_kind,
                        priority=priority,
                        token_count=resolved_tokens,
                        created_by=resolved_created_by,
                        source_trust=resolved_trust,
                        sensitivity=sensitivity,
                    )
                    token_delta = resolved_tokens - old_tokens
                    self._assert_memory_capacity(state_row, token_delta)
                    replacement_refs = (
                        encoded_refs
                        if source_refs
                        else str(entry_row["source_refs_json"])
                    )
                    connection.execute(
                        """
                        UPDATE memory_entries
                        SET kind = ?, content = ?, priority = ?,
                            token_count = ?, created_by = ?, source_trust = ?,
                            sensitivity = ?, source_refs_json = ?,
                            confirmed_by_user = CASE
                                WHEN ? THEN 1 ELSE confirmed_by_user END,
                            version = version + 1, updated_at = ?
                        WHERE memory_id = ? AND version = ?
                        """,
                        (
                            resolved_kind,
                            resolved_content.strip(),
                            priority,
                            resolved_tokens,
                            resolved_created_by,
                            resolved_trust,
                            sensitivity,
                            replacement_refs,
                            int(
                                actor_type == "user"
                                or confirmed_by_user_action
                            ),
                            timestamp,
                            memory_id,
                            expected_version,
                        ),
                    )
                elif operation == "remove":
                    if not was_active:
                        raise InvalidRunTransitionError(
                            "Memory is already deleted"
                        )
                    token_delta = -old_tokens
                    connection.execute(
                        """
                        UPDATE memory_entries
                        SET deleted_at = ?, version = version + 1, updated_at = ?
                        WHERE memory_id = ? AND version = ?
                        """,
                        (timestamp, timestamp, memory_id, expected_version),
                    )
                elif operation == "restore":
                    if was_active:
                        raise InvalidRunTransitionError(
                            "Memory is not deleted"
                        )
                    token_delta = int(entry_row["token_count"])
                    self._assert_memory_capacity(state_row, token_delta)
                    connection.execute(
                        """
                        UPDATE memory_entries
                        SET deleted_at = NULL, version = version + 1, updated_at = ?
                        WHERE memory_id = ? AND version = ?
                        """,
                        (timestamp, memory_id, expected_version),
                    )
                elif operation == "confirm":
                    if not was_active:
                        raise InvalidRunTransitionError(
                            "deleted Memory cannot be confirmed"
                        )
                    connection.execute(
                        """
                        UPDATE memory_entries
                        SET confirmed_by_user = 1,
                            version = version + 1, updated_at = ?
                        WHERE memory_id = ? AND version = ?
                        """,
                        (timestamp, memory_id, expected_version),
                    )
                elif operation == "pin":
                    if not was_active:
                        raise InvalidRunTransitionError(
                            "deleted Memory cannot be pinned"
                        )
                    connection.execute(
                        """
                        UPDATE memory_entries
                        SET pinned_by_user = 1,
                            version = version + 1, updated_at = ?
                        WHERE memory_id = ? AND version = ?
                        """,
                        (timestamp, memory_id, expected_version),
                    )

            if token_delta:
                connection.execute(
                    """
                    UPDATE memory_scope_state
                    SET current_token_count = current_token_count + ?
                    WHERE scope_type = ? AND scope_id = ?
                    """,
                    (token_delta, scope_type, scope_id),
                )
            connection.execute(
                """
                UPDATE memory_scope_state
                SET revision = revision + 1, updated_at = ?
                WHERE scope_type = ? AND scope_id = ?
                """,
                (timestamp, scope_type, scope_id),
            )
            final_entry = (
                connection.execute(
                    "SELECT * FROM memory_entries WHERE memory_id = ?",
                    (memory_id,),
                ).fetchone()
                if memory_id is not None
                else None
            )
            after_hash = (
                self._memory_entry_digest(final_entry)
                if final_entry is not None
                else None
            )
            connection.execute(
                """
                INSERT INTO memory_mutations(
                    mutation_id, memory_id, scope_type, scope_id, operation,
                    expected_version, before_hash, after_hash, actor_type,
                    actor_id, run_id, activity_id, reason, source_refs_json,
                    idempotency_key, request_digest, decision_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    mutation_id,
                    memory_id,
                    scope_type,
                    scope_id,
                    operation,
                    expected_version,
                    before_hash,
                    after_hash,
                    actor_type,
                    actor_id,
                    run_id,
                    activity_id,
                    reason,
                    encoded_refs,
                    idempotency_key,
                    request_digest,
                    decision_id,
                    timestamp,
                ),
            )
            state = connection.execute(
                """
                SELECT * FROM memory_scope_state
                WHERE scope_type = ? AND scope_id = ?
                """,
                (scope_type, scope_id),
            ).fetchone()
            assert state is not None
            if state["sync_scope"] == "full_memory":
                entry_projection = None
                if final_entry is not None:
                    entry_projection = {
                        "memory_id": final_entry["memory_id"],
                        "kind": final_entry["kind"],
                        "content": final_entry["content"],
                        "priority": final_entry["priority"],
                        "version": int(final_entry["version"]),
                        "token_count": int(final_entry["token_count"]),
                        "pinned_by_user": bool(final_entry["pinned_by_user"]),
                        "confirmed_by_user": bool(
                            final_entry["confirmed_by_user"]
                        ),
                        "created_by": final_entry["created_by"],
                        "source_trust": final_entry["source_trust"],
                        "sensitivity": final_entry["sensitivity"],
                        "source_refs": json.loads(
                            final_entry["source_refs_json"]
                        ),
                        "deleted_at": (
                            datetime.fromtimestamp(
                                float(final_entry["deleted_at"]), tz=UTC
                            ).isoformat()
                            if final_entry["deleted_at"] is not None
                            else None
                        ),
                        "created_at": datetime.fromtimestamp(
                            float(final_entry["created_at"]), tz=UTC
                        ).isoformat(),
                        "updated_at": datetime.fromtimestamp(
                            float(final_entry["updated_at"]), tz=UTC
                        ).isoformat(),
                    }
                outbox_payload = {
                    "mutation_id": mutation_id,
                    "memory_id": memory_id,
                    "operation": operation,
                    "expected_version": expected_version,
                    "actor_type": actor_type,
                    "actor_id": actor_id,
                    "run_id": run_id,
                    "reason": reason,
                    "idempotency_key": idempotency_key,
                    "request_digest": request_digest,
                    "decision_id": decision_id,
                    "created_at": datetime.fromtimestamp(
                        timestamp, tz=UTC
                    ).isoformat(),
                    "entry": entry_projection,
                }
                connection.execute(
                    """
                    INSERT INTO memory_mutation_outbox(
                        mutation_id, scope_type, scope_id, status,
                        attempt_count, next_attempt_at, created_at, updated_at,
                        payload_json, scope_revision
                    ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)
                    """,
                    (
                        mutation_id,
                        scope_type,
                        scope_id,
                        timestamp,
                        timestamp,
                        timestamp,
                        json.dumps(
                            outbox_payload,
                            ensure_ascii=False,
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                        int(state["revision"]),
                    ),
                )
            mutation_row = connection.execute(
                "SELECT * FROM memory_mutations WHERE mutation_id = ?",
                (mutation_id,),
            ).fetchone()
            assert mutation_row is not None
            return MemoryMutationResult(
                mutation=self._memory_mutation_from_row(mutation_row),
                entry=(
                    self._memory_entry_from_row(final_entry)
                    if final_entry is not None
                    else None
                ),
                scope_state=self._memory_scope_state_from_row(state),
            )

    @staticmethod
    def _assert_memory_user_decision_in_transaction(
        connection: sqlite3.Connection,
        *,
        decision_id: str | None,
        run_id: str | None,
        memory_id: str | None,
        operation: str,
        reviewed_operation: str | None = None,
        reviewed_memory_id: str | None = None,
    ) -> None:
        if not decision_id or not run_id:
            raise PermissionError(
                "reviewed Memory mutation requires a durable user decision"
            )
        row = connection.execute(
            """
            SELECT decisions.decision_json, decisions.actor_type,
                   interactions.run_id, interactions.request_json
            FROM human_interaction_decisions AS decisions
            JOIN human_interactions AS interactions
              ON interactions.interaction_id = decisions.interaction_id
            WHERE decisions.decision_id = ?
              AND interactions.interaction_type = 'memory_change_review'
              AND interactions.status = 'resolved'
            """,
            (decision_id,),
        ).fetchone()
        if (
            row is None
            or row["actor_type"] != "user"
            or row["run_id"] != run_id
        ):
            raise PermissionError("Memory review was not approved by the user")
        decision = json.loads(row["decision_json"])
        request = json.loads(row["request_json"])
        change = request.get("memory_change")
        if (
            decision.get("decision") != "approved"
            or not isinstance(change, dict)
            or change.get("operation") != (reviewed_operation or operation)
            or (
                (reviewed_memory_id or memory_id) is not None
                and change.get("memory_id")
                != (reviewed_memory_id or memory_id)
            )
        ):
            raise PermissionError(
                "Memory review does not authorize this exact mutation"
            )

    def get_run_final_result_event(
        self, run_id: str
    ) -> CommittedRunEvent | None:
        """Return the canonical assistant result for one Run.

        ``assistant.final`` is preferred.  The legacy fallback keeps Runs
        created before schema v19 readable while callers migrate to the typed
        contract.
        """

        with self._lock:
            row = self._connection.execute(
                """
                SELECT event_id, run_id, sequence, run_version, event_type,
                       payload_json, legacy_step, created_at
                FROM run_events
                WHERE run_id = ?
                  AND (event_type = 'assistant.final' OR legacy_step = 'end')
                ORDER BY CASE WHEN event_type = 'assistant.final' THEN 0 ELSE 1 END,
                         sequence DESC
                LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            return self._event_from_row(row) if row is not None else None

    def get_run_artifact_manifest_event(
        self, run_id: str
    ) -> CommittedRunEvent | None:
        """Return the latest finalized canonical Artifact manifest."""

        with self._lock:
            row = self._connection.execute(
                """
                SELECT event_id, run_id, sequence, run_version, event_type,
                       payload_json, legacy_step, created_at
                FROM run_events
                WHERE run_id = ?
                  AND event_type = 'artifact.manifest.finalized'
                ORDER BY sequence DESC
                LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            return self._event_from_row(row) if row is not None else None

    def set_timeout_policy(
        self,
        run_id: str,
        policy: RunTimeoutPolicy,
        *,
        now: float | None = None,
    ) -> RunRecord:
        timestamp = now if now is not None else time.time()
        encoded = json.dumps(
            policy.to_dict(),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            connection.execute(
                """
                UPDATE runs
                SET timeout_policy_json = ?, timeout_policy_version = ?,
                    deadline_at = ?, updated_at = ?
                WHERE run_id = ?
                """,
                (
                    encoded,
                    policy.policy_version,
                    policy.run_deadline_at,
                    timestamp,
                    run_id,
                ),
            )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"timeout-policy:{run_id}:{policy.policy_version}",
                    event_type="run.timeout_policy_configured",
                    payload=policy.to_dict(),
                    created_at=timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert row is not None
            return self._run_from_row(row)

    def create_run_attempt(
        self,
        run_id: str,
        *,
        request_id: str,
        reason: str,
        activate: bool = False,
        attempt_id: str | None = None,
        environment: AttemptEnvironmentBinding | None = None,
        workload_profile: WorkloadProfileRecord | None = None,
        now: float | None = None,
    ) -> RunAttemptRecord:
        if not request_id.strip() or not reason.strip():
            raise ValueError("attempt request_id and reason are required")
        timestamp = now if now is not None else time.time()
        identifier = attempt_id or str(uuid.uuid4())
        environment_values = self._attempt_environment_values(environment)
        workload = workload_profile or default_workload_profile()
        workload_values = self._attempt_workload_values(workload)
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            duplicate = connection.execute(
                """
                SELECT * FROM run_attempts
                WHERE run_id = ? AND resume_request_id = ?
                """,
                (run_id, request_id),
            ).fetchone()
            if duplicate is not None:
                if duplicate["resume_reason"] != reason:
                    raise IdempotencyConflictError(
                        f"attempt request_id {request_id!r} was reused with a different reason"
                    )
                persisted_environment = (
                    duplicate["environment_spec_id"],
                    duplicate["environment_spec_digest"],
                    duplicate["bundle_revision_id"],
                    duplicate["permission_profile_revision"],
                    duplicate["thinking_effort_requested"],
                    duplicate["thinking_effort_effective"],
                    duplicate["provider_capability_revision"],
                )
                if persisted_environment != environment_values:
                    raise IdempotencyConflictError(
                        f"attempt request_id {request_id!r} was reused with "
                        "a different environment"
                    )
                persisted_workload = (
                    duplicate["workload_kind"],
                    duplicate["workload_profile_json"],
                    duplicate["workload_profile_digest"],
                )
                if persisted_workload != workload_values:
                    raise IdempotencyConflictError(
                        f"attempt request_id {request_id!r} was reused with "
                        "a different workload profile"
                    )
                # An idempotent row loaded from SQLite is audit/recovery data,
                # not a fresh control-plane attestation. The original process
                # already attested a genuinely in-process creation.
                return self._attempt_from_row(duplicate)
            if run["origin"] == "cloud_restore":
                raise InvalidRunTransitionError(
                    f"run {run_id!r} was restored from Cloud without its local "
                    "workspace and execution context; start a new Run or fork it "
                    "after explicitly binding a workspace"
                )
            if run["status"] in {"completed", "failed", "cancelled"}:
                raise InvalidRunTransitionError(
                    f"cannot create an attempt for terminal run {run_id!r}"
                )
            if run["cancel_request_id"] is not None:
                raise InvalidRunTransitionError(
                    f"run {run_id!r} has a persisted cancel intent"
                )
            self._cancel_orphaned_tool_approvals_in_transaction(
                connection,
                run_id=run_id,
                timestamp=timestamp,
                source="recovery",
            )
            self._repair_restart_interrupted_internal_controls_in_transaction(
                connection,
                run_id=run_id,
                timestamp=timestamp,
                source="resume_admission",
                include_dispatched=False,
            )
            active = connection.execute(
                """
                SELECT attempt_id FROM run_attempts
                WHERE run_id = ? AND status IN ('pending', 'running', 'waiting_for_user')
                LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            if active is not None:
                raise InvalidRunTransitionError(
                    f"run {run_id!r} already has active attempt {active['attempt_id']!r}"
                )
            project_lease = connection.execute(
                """
                SELECT run_id, attempt_id
                FROM project_run_execution_leases
                WHERE project_id = ?
                """,
                (run["project_id"],),
            ).fetchone()
            if project_lease is not None:
                if project_lease["run_id"] != run_id:
                    raise InvalidRunTransitionError(
                        f"project {run['project_id']!r} already executes Run "
                        f"{project_lease['run_id']!r}"
                    )
                # A same-Run lease without an active Attempt is stale. This
                # can only be left by a pre-v21 crash or manual DB repair;
                # reclaim it inside the same writer transaction.
                connection.execute(
                    """DELETE FROM project_run_execution_leases
                    WHERE project_id = ? AND run_id = ?""",
                    (run["project_id"], run_id),
                )
            blockers = self._unsafe_resume_blockers(connection, run_id)
            if blockers:
                raise UnsafeResumeError(blockers)
            unresolved_tools = connection.execute(
                """
                SELECT calls.tool_call_id, calls.run_id
                FROM tool_calls AS calls
                JOIN runs AS owner ON owner.run_id = calls.run_id
                WHERE owner.project_id = ?
                  AND calls.status IN ('prepared', 'dispatched')
                ORDER BY calls.created_at
                LIMIT 1
                """,
                (run["project_id"],),
            ).fetchone()
            if unresolved_tools is not None:
                raise InvalidRunTransitionError(
                    f"project {run['project_id']!r} still has unresolved Tool "
                    f"call {unresolved_tools['tool_call_id']!r} in Run "
                    f"{unresolved_tools['run_id']!r}"
                )
            pending_approvals = connection.execute(
                """
                SELECT approval_id FROM approvals
                WHERE run_id = ? AND status = 'pending'
                ORDER BY created_at
                """,
                (run_id,),
            ).fetchall()
            if pending_approvals:
                raise InvalidRunTransitionError(
                    f"run {run_id!r} has pending approvals: "
                    + ", ".join(
                        row["approval_id"] for row in pending_approvals
                    )
                )
            pending_interactions = connection.execute(
                """
                SELECT interaction_id FROM human_interactions
                WHERE run_id = ? AND interaction_type != 'approval'
                  AND status IN ('requested', 'presented')
                ORDER BY created_at
                """,
                (run_id,),
            ).fetchall()
            if pending_interactions:
                raise InvalidRunTransitionError(
                    f"run {run_id!r} has pending human interactions: "
                    + ", ".join(
                        row["interaction_id"] for row in pending_interactions
                    )
                )
            if environment is not None:
                spec = connection.execute(
                    """
                    SELECT * FROM effective_environment_specs
                    WHERE environment_spec_id = ?
                    """,
                    (environment.environment_spec_id,),
                ).fetchone()
                if spec is None:
                    raise RunNotFoundError(
                        f"EnvironmentSpec "
                        f"{environment.environment_spec_id!r} does not exist"
                    )
                expected_owner_id = (
                    run_id if spec["owner_type"] == "run" else identifier
                )
                if spec["owner_id"] != expected_owner_id:
                    raise IdempotencyConflictError(
                        "EnvironmentSpec belongs to another Run/Attempt"
                    )
                persisted_spec_values = (
                    spec["environment_spec_digest"],
                    spec["bundle_revision_id"],
                    spec["permission_profile_revision"],
                    spec["provider_capability_revision"],
                )
                binding_spec_values = (
                    environment.environment_spec_digest,
                    environment.bundle_revision_id,
                    environment.permission_profile_revision,
                    environment.provider_capability_revision,
                )
                if persisted_spec_values != binding_spec_values:
                    raise IdempotencyConflictError(
                        "Attempt environment binding does not match its "
                        "immutable EnvironmentSpec"
                    )
            number = int(
                connection.execute(
                    """
                    SELECT COALESCE(MAX(attempt_number), 0) + 1
                    FROM run_attempts WHERE run_id = ?
                    """,
                    (run_id,),
                ).fetchone()[0]
            )
            status = "running" if activate else "pending"
            connection.execute(
                """
                INSERT INTO run_attempts(
                    attempt_id, run_id, attempt_number, status, started_at,
                    ended_at, outcome, timeout_reason, resume_request_id,
                    resume_reason, policy_version, elapsed_active_ms,
                    last_consumer_heartbeat_at, environment_spec_id,
                    environment_spec_digest, bundle_revision_id,
                    permission_profile_revision, thinking_effort_requested,
                    thinking_effort_effective, provider_capability_revision,
                    workload_kind, workload_profile_json,
                    workload_profile_digest
                ) VALUES (
                    ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 0, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
                """,
                (
                    identifier,
                    run_id,
                    number,
                    status,
                    timestamp,
                    request_id,
                    reason,
                    run["timeout_policy_version"],
                    timestamp if activate else None,
                    *environment_values,
                    *workload_values,
                ),
            )
            try:
                connection.execute(
                    """
                    INSERT INTO project_run_execution_leases(
                        project_id, run_id, attempt_id, acquired_at
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (run["project_id"], run_id, identifier, timestamp),
                )
            except sqlite3.IntegrityError as exc:
                owner = connection.execute(
                    """SELECT run_id FROM project_run_execution_leases
                    WHERE project_id = ?""",
                    (run["project_id"],),
                ).fetchone()
                owner_id = owner["run_id"] if owner is not None else "unknown"
                raise InvalidRunTransitionError(
                    f"project {run['project_id']!r} already executes Run "
                    f"{owner_id!r}"
                ) from exc
            environment_payload = (
                {
                    "environment_spec_id": environment.environment_spec_id,
                    "environment_spec_digest": (
                        environment.environment_spec_digest
                    ),
                    "bundle_revision_id": environment.bundle_revision_id,
                    "permission_profile_revision": (
                        environment.permission_profile_revision
                    ),
                    "thinking_effort_requested": (
                        environment.thinking_effort_requested
                    ),
                    "thinking_effort_effective": (
                        environment.thinking_effort_effective
                    ),
                    "provider_capability_revision": (
                        environment.provider_capability_revision
                    ),
                }
                if environment is not None
                else {}
            )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"attempt:{identifier}:created",
                    event_type="run.attempt_created",
                    payload={
                        "attempt_id": identifier,
                        "attempt_number": number,
                        "reason": reason,
                        "status": status,
                        "policy_version": run["timeout_policy_version"],
                        "workload_profile": workload_profile_payload(workload),
                        "workload_profile_digest": workload_values[2],
                        **environment_payload,
                    },
                    created_at=timestamp,
                ),
                run_status=status,
                active_attempt_id=identifier,
            )
            # A follow-up's request_id is its deterministic Run id.  Admit the
            # durable queue row in the same transaction as its first Attempt,
            # so a renderer crash cannot leave an executing Run queued forever.
            connection.execute(
                """
                UPDATE follow_up_requests
                SET status = 'admitted', admitted_run_id = ?,
                    last_error = NULL, updated_at = ?
                WHERE request_id = ? AND project_id = ? AND status = 'pending'
                """,
                (run_id, timestamp, run_id, run["project_id"]),
            )
            row = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (identifier,),
            ).fetchone()
            assert row is not None
            resolved = self._attempt_from_row(row)
            self._trusted_attempt_permission_profiles.add(
                (resolved.attempt_id, resolved.permission_profile_revision)
            )
            return resolved

    def bind_pending_attempt_environment(
        self,
        attempt_id: str,
        *,
        run_id: str,
        request_id: str,
        environment: AttemptEnvironmentBinding,
        now: float | None = None,
    ) -> RunAttemptRecord:
        """Attach the explicitly selected environment before an Attempt starts.

        The Run control endpoint durably reserves a pending Resume Attempt
        before ``/chat`` receives the fresh local credentials and Workspace
        bindings needed to resolve an EnvironmentSpec. Legacy Runs can have no
        prior spec to inherit, so Resume silently backfills that compatibility
        snapshot exactly once. Running or terminal Attempts are immutable and
        can never be rebound.
        """

        timestamp = now if now is not None else time.time()
        environment_values = self._attempt_environment_values(environment)
        with self._write_transaction() as connection:
            row = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            if row is None:
                raise RunNotFoundError(
                    f"attempt_id {attempt_id!r} does not exist"
                )
            if (
                row["run_id"] != run_id
                or row["resume_request_id"] != request_id
            ):
                raise IdempotencyConflictError(
                    "pending Attempt does not match the Resume request"
                )
            persisted_environment = (
                row["environment_spec_id"],
                row["environment_spec_digest"],
                row["bundle_revision_id"],
                row["permission_profile_revision"],
                row["thinking_effort_requested"],
                row["thinking_effort_effective"],
                row["provider_capability_revision"],
            )
            if row["environment_spec_id"] is not None:
                if persisted_environment != environment_values:
                    raise IdempotencyConflictError(
                        "pending Attempt is already bound to a different environment"
                    )
                return self._attempt_from_row(row)
            if row["status"] != "pending":
                raise InvalidRunTransitionError(
                    "only a pending Attempt can receive an environment binding"
                )

            spec = connection.execute(
                """
                SELECT * FROM effective_environment_specs
                WHERE environment_spec_id = ?
                """,
                (environment.environment_spec_id,),
            ).fetchone()
            if spec is None:
                raise RunNotFoundError(
                    f"EnvironmentSpec {environment.environment_spec_id!r} does not exist"
                )
            expected_owner_id = (
                run_id if spec["owner_type"] == "run" else attempt_id
            )
            if spec["owner_id"] != expected_owner_id:
                raise IdempotencyConflictError(
                    "EnvironmentSpec belongs to another Run/Attempt"
                )
            persisted_spec_values = (
                spec["environment_spec_digest"],
                spec["bundle_revision_id"],
                spec["permission_profile_revision"],
                spec["provider_capability_revision"],
            )
            binding_spec_values = (
                environment.environment_spec_digest,
                environment.bundle_revision_id,
                environment.permission_profile_revision,
                environment.provider_capability_revision,
            )
            if persisted_spec_values != binding_spec_values:
                raise IdempotencyConflictError(
                    "Attempt environment binding does not match its immutable "
                    "EnvironmentSpec"
                )

            updated = connection.execute(
                """
                UPDATE run_attempts
                SET environment_spec_id = ?, environment_spec_digest = ?,
                    bundle_revision_id = ?, permission_profile_revision = ?,
                    thinking_effort_requested = ?, thinking_effort_effective = ?,
                    provider_capability_revision = ?
                WHERE attempt_id = ? AND run_id = ? AND resume_request_id = ?
                  AND status = 'pending' AND environment_spec_id IS NULL
                """,
                (*environment_values, attempt_id, run_id, request_id),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    "pending Attempt changed while binding its environment"
                )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"attempt:{attempt_id}:environment-bound",
                    event_type="run.attempt_environment_bound",
                    payload={
                        "attempt_id": attempt_id,
                        "environment_spec_id": environment.environment_spec_id,
                        "environment_spec_digest": (
                            environment.environment_spec_digest
                        ),
                        "bundle_revision_id": environment.bundle_revision_id,
                        "permission_profile_revision": (
                            environment.permission_profile_revision
                        ),
                        "thinking_effort_requested": (
                            environment.thinking_effort_requested
                        ),
                        "thinking_effort_effective": (
                            environment.thinking_effort_effective
                        ),
                        "provider_capability_revision": (
                            environment.provider_capability_revision
                        ),
                        "reason": "legacy_environment_backfill",
                    },
                    created_at=timestamp,
                ),
                run_status="pending",
                active_attempt_id=attempt_id,
            )
            rebound = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            assert rebound is not None
            resolved = self._attempt_from_row(rebound)
            self._trusted_attempt_permission_profiles.add(
                (resolved.attempt_id, resolved.permission_profile_revision)
            )
            return resolved

    def get_run_attempt(self, attempt_id: str) -> RunAttemptRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            return self._attempt_from_row(row) if row is not None else None

    def attempt_permission_profile_is_trusted(
        self,
        attempt_id: str,
        permission_profile_revision: str | None,
    ) -> bool:
        return (attempt_id, permission_profile_revision) in (
            self._trusted_attempt_permission_profiles
        )

    def list_run_attempts(self, run_id: str) -> list[RunAttemptRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM run_attempts
                WHERE run_id = ? ORDER BY attempt_number
                """,
                (run_id,),
            ).fetchall()
            return [self._attempt_from_row(row) for row in rows]

    def heartbeat_attempt(
        self,
        attempt_id: str,
        *,
        expected_run_id: str | None = None,
        now: float | None = None,
    ) -> RunAttemptRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE run_attempts
                SET elapsed_active_ms = elapsed_active_ms + CAST(
                        MAX(0, ? - COALESCE(last_consumer_heartbeat_at, ?)) * 1000
                        AS INTEGER
                    ),
                    last_consumer_heartbeat_at = ?
                WHERE attempt_id = ? AND status = 'running'
                """,
                (timestamp, timestamp, timestamp, attempt_id),
            )
            if updated.rowcount != 1:
                raise InvalidRunTransitionError(
                    f"attempt {attempt_id!r} is not running"
                )
            row = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            assert row is not None
            if (
                expected_run_id is not None
                and row["run_id"] != expected_run_id
            ):
                raise IdempotencyConflictError(
                    f"attempt {attempt_id!r} does not belong to run {expected_run_id!r}"
                )
            return self._attempt_from_row(row)

    def activate_run_attempt(
        self,
        attempt_id: str,
        *,
        expected_run_id: str | None = None,
        now: float | None = None,
    ) -> RunAttemptRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            attempt = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            if attempt is None:
                raise RunNotFoundError(
                    f"attempt_id {attempt_id!r} does not exist"
                )
            if (
                expected_run_id is not None
                and attempt["run_id"] != expected_run_id
            ):
                raise IdempotencyConflictError(
                    f"attempt {attempt_id!r} does not belong to run {expected_run_id!r}"
                )
            if attempt["status"] == "running":
                return self._attempt_from_row(attempt)
            if not transition_allowed(
                ATTEMPT_TRANSITIONS,
                str(attempt["status"]),
                "running",
            ):
                raise InvalidRunTransitionError(
                    f"attempt {attempt_id!r} is not pending"
                )
            connection.execute(
                """
                UPDATE run_attempts
                SET status = 'running', last_consumer_heartbeat_at = ?
                WHERE attempt_id = ? AND status = 'pending'
                """,
                (timestamp, attempt_id),
            )
            self._append_event_in_transaction(
                connection,
                attempt["run_id"],
                RunEventDraft(
                    event_id=f"attempt:{attempt_id}:started",
                    event_type="run.attempt_started",
                    payload={
                        "attempt_id": attempt_id,
                        "attempt_number": int(attempt["attempt_number"]),
                        "policy_version": attempt["policy_version"],
                    },
                    created_at=timestamp,
                ),
                run_status="running",
                active_attempt_id=attempt_id,
            )
            row = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            assert row is not None
            return self._attempt_from_row(row)

    def fork_run(
        self,
        source_run_id: str,
        *,
        new_run_id: str,
        request_id: str,
        now: float | None = None,
    ) -> tuple[RunRecord, RunAttemptRecord]:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (new_run_id,)
            ).fetchone()
            if existing is not None:
                if existing["parent_run_id"] != source_run_id:
                    raise IdempotencyConflictError(
                        f"fork target {new_run_id!r} already exists"
                    )
                attempts = connection.execute(
                    "SELECT * FROM run_attempts WHERE run_id = ? ORDER BY attempt_number",
                    (new_run_id,),
                ).fetchall()
                if not attempts:
                    raise IdempotencyConflictError(
                        "fork is missing its checkpoint attempt"
                    )
                if attempts[0]["resume_request_id"] != request_id:
                    raise IdempotencyConflictError(
                        f"fork target {new_run_id!r} was created by another request"
                    )
                return self._run_from_row(existing), self._attempt_from_row(
                    attempts[0]
                )
            source = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (source_run_id,)
            ).fetchone()
            if source is None:
                raise RunNotFoundError(
                    f"run_id {source_run_id!r} does not exist"
                )
            attempt_id = str(uuid.uuid4())
            inherited_policy = json.loads(
                source["timeout_policy_json"] or "{}"
            )
            inherited_policy["run_deadline_at"] = None
            connection.execute(
                """
                INSERT INTO runs(
                    run_id, project_id, status, version, active_attempt_id,
                    deadline_at, timeout_policy_version, created_at, updated_at,
                    parent_run_id, timeout_policy_json
                ) VALUES (?, ?, 'interrupted', 0, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_run_id,
                    source["project_id"],
                    None,
                    source["timeout_policy_version"],
                    timestamp,
                    timestamp,
                    source_run_id,
                    json.dumps(
                        inherited_policy,
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                ),
            )
            connection.execute(
                """
                INSERT INTO run_attempts(
                    attempt_id, run_id, attempt_number, status, started_at,
                    ended_at, outcome, timeout_reason, resume_request_id,
                    resume_reason, policy_version, elapsed_active_ms
                ) VALUES (?, ?, 1, 'interrupted', ?, ?, 'fork_checkpoint',
                          NULL, ?, 'fork', ?, 0)
                """,
                (
                    attempt_id,
                    new_run_id,
                    timestamp,
                    timestamp,
                    request_id,
                    source["timeout_policy_version"],
                ),
            )
            self._append_event_in_transaction(
                connection,
                new_run_id,
                RunEventDraft(
                    event_id=f"fork:{new_run_id}:{request_id}",
                    event_type="run.forked",
                    payload={
                        "source_run_id": source_run_id,
                        "checkpoint_attempt_id": attempt_id,
                        "requires_resume": True,
                    },
                    created_at=timestamp,
                ),
                run_status="interrupted",
            )
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (new_run_id,)
            ).fetchone()
            attempt = connection.execute(
                "SELECT * FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            assert run is not None and attempt is not None
            return self._run_from_row(run), self._attempt_from_row(attempt)

    def request_cancel(
        self,
        run_id: str,
        *,
        request_id: str,
        reason: str,
        now: float | None = None,
    ) -> RunRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["status"] == "cancelled":
                return self._run_from_row(run)
            if run["status"] in {"completed", "failed"}:
                raise InvalidRunTransitionError(
                    f"cannot cancel terminal run {run_id!r}"
                )
            if run["cancel_request_id"] not in {None, request_id}:
                raise InvalidRunTransitionError(
                    f"run {run_id!r} already has another cancel intent"
                )
            if run["cancel_request_id"] is not None:
                event = connection.execute(
                    "SELECT payload_json FROM run_events WHERE event_id = ?",
                    (f"cancel:{request_id}:requested",),
                ).fetchone()
                if (
                    event is None
                    or json.loads(event["payload_json"]).get("reason")
                    != reason
                ):
                    raise IdempotencyConflictError(
                        f"cancel request_id {request_id!r} was reused with different data"
                    )
            else:
                connection.execute(
                    """
                    UPDATE runs SET cancel_request_id = ?, cancel_requested_at = ?
                    WHERE run_id = ?
                    """,
                    (request_id, timestamp, run_id),
                )
                self._append_event_in_transaction(
                    connection,
                    run_id,
                    RunEventDraft(
                        event_id=f"cancel:{request_id}:requested",
                        event_type="run.cancel_requested",
                        payload={"request_id": request_id, "reason": reason},
                        created_at=timestamp,
                    ),
                )
            row = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert row is not None
            return self._run_from_row(row)

    def complete_cancel(
        self,
        run_id: str,
        *,
        request_id: str,
        now: float | None = None,
    ) -> RunRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["status"] == "cancelled":
                return self._run_from_row(run)
            if run["cancel_request_id"] != request_id:
                raise InvalidRunTransitionError(
                    "cancel completion has no matching intent"
                )
            connection.execute(
                """
                UPDATE run_attempts
                SET status = 'cancelled', ended_at = COALESCE(ended_at, ?),
                    outcome = COALESCE(outcome, 'explicit_cancel')
                WHERE run_id = ? AND status IN ('pending', 'running', 'waiting_for_user')
                """,
                (timestamp, run_id),
            )
            dispatched_tools = connection.execute(
                """
                SELECT * FROM tool_calls
                WHERE run_id = ? AND status = 'dispatched'
                  AND outcome IS NULL
                ORDER BY created_at, tool_call_id
                """,
                (run_id,),
            ).fetchall()
            for tool in dispatched_tools:
                connection.execute(
                    """
                    UPDATE tool_calls
                    SET status = 'outcome_unknown',
                        outcome = 'outcome_unknown', updated_at = ?
                    WHERE tool_call_id = ? AND status = 'dispatched'
                    """,
                    (timestamp, tool["tool_call_id"]),
                )
                self._append_event_in_transaction(
                    connection,
                    run_id,
                    RunEventDraft(
                        event_id=(
                            "cancel:tool-outcome-unknown:"
                            f"{tool['tool_call_id']}"
                        ),
                        event_type="tool.outcome_unknown",
                        payload={
                            "tool_call_id": tool["tool_call_id"],
                            "safety_class": tool["safety_class"],
                            "reason": "cancelled_after_dispatch",
                        },
                        created_at=timestamp,
                    ),
                )
            payload: dict[str, Any] = {
                "request_id": request_id,
                "reason": "explicit_cancel",
            }
            manifest = connection.execute(
                """
                SELECT * FROM run_events
                WHERE run_id = ?
                  AND event_type = 'artifact.manifest.finalized'
                ORDER BY sequence DESC LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            if manifest is not None:
                manifest_event = self._event_from_row(manifest)
                payload.update(
                    artifact_manifest_event_id=manifest_event.event_id,
                    artifact_count=int(
                        manifest_event.payload.get("artifact_count", 0)
                    ),
                )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"cancel:{request_id}:completed",
                    event_type="run.cancelled",
                    payload=payload,
                    created_at=timestamp,
                ),
                run_status="cancelled",
                clear_active_attempt=True,
            )
            row = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert row is not None
            return self._run_from_row(row)

    def checkpoint_tool_call(
        self,
        *,
        tool_call_id: str,
        run_id: str,
        attempt_id: str | None,
        tool_name: str,
        safety_class: ToolSafetyClass,
        status: str,
        request: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        outcome: str | None = None,
        timeout_reason: str | None = None,
        toolkit_name: str | None = None,
        agent_name: str | None = None,
        task_id: str | None = None,
        step_id: str | None = None,
        display_title: str | None = None,
        display_input: str | None = None,
        display_output: str | None = None,
        display_summary: str | None = None,
        display_duration_ms: int | None = None,
        now: float | None = None,
    ) -> ToolCallRecord:
        if status not in {
            value for allowed in TOOL_TRANSITIONS.values() for value in allowed
        }:
            raise ValueError("unsupported tool checkpoint status")
        if (
            safety_class is ToolSafetyClass.IDEMPOTENT_WRITE
            and not idempotency_key
        ):
            raise ValueError("idempotent writes require an idempotency key")
        timestamp = now if now is not None else time.time()
        request_json = json.dumps(
            request or {},
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        result_json = (
            json.dumps(
                result,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            if result is not None
            else None
        )
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT run_id FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            existing = connection.execute(
                "SELECT * FROM tool_calls WHERE tool_call_id = ?",
                (tool_call_id,),
            ).fetchone()
            if attempt_id is not None:
                attempt = connection.execute(
                    "SELECT run_id FROM run_attempts WHERE attempt_id = ?",
                    (attempt_id,),
                ).fetchone()
                if attempt is None or attempt["run_id"] != run_id:
                    raise IdempotencyConflictError(
                        f"attempt {attempt_id!r} does not belong to run {run_id!r}"
                    )
            previous = existing["status"] if existing is not None else None
            if (
                status == "timed_out"
                and safety_class is ToolSafetyClass.UNSAFE_WRITE
            ):
                raise InvalidRunTransitionError(
                    f"unsafe write tool {tool_call_id!r} must enter outcome_unknown, "
                    "not timed_out"
                )
            if existing is not None and (
                existing["run_id"] != run_id
                or existing["tool_name"] != tool_name
                or existing["safety_class"] != safety_class.value
                or existing["idempotency_key"] != idempotency_key
                or existing["request_json"] != request_json
            ):
                raise IdempotencyConflictError(
                    f"tool_call_id {tool_call_id!r} was reused with different data"
                )
            if (
                existing is not None
                and previous == status
                and existing["result_json"] == result_json
            ):
                return self._tool_call_from_row(existing)
            if not transition_allowed(TOOL_TRANSITIONS, previous, status):
                raise InvalidRunTransitionError(
                    f"tool call {tool_call_id!r} cannot move from {previous!r} to {status!r}"
                )
            if existing is None:
                connection.execute(
                    """
                    INSERT INTO tool_calls(
                        tool_call_id, run_id, attempt_id, tool_name, status,
                        safety_class, idempotency_key, outcome, timeout_reason,
                        created_at, updated_at, request_json, result_json,
                        prepared_at, dispatched_at, completed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                    """,
                    (
                        tool_call_id,
                        run_id,
                        attempt_id,
                        tool_name,
                        status,
                        safety_class.value,
                        idempotency_key,
                        outcome,
                        timeout_reason,
                        timestamp,
                        timestamp,
                        request_json,
                        result_json,
                        timestamp,
                    ),
                )
            elif status != previous or result_json != existing["result_json"]:
                connection.execute(
                    """
                    UPDATE tool_calls
                    SET status = ?, result_json = COALESCE(?, result_json),
                        outcome = COALESCE(?, outcome),
                        timeout_reason = COALESCE(?, timeout_reason),
                        dispatched_at = CASE WHEN ? = 'dispatched'
                            THEN COALESCE(dispatched_at, ?) ELSE dispatched_at END,
                        completed_at = CASE WHEN ? IN (
                            'completed', 'failed', 'timed_out', 'outcome_unknown'
                        )
                            THEN COALESCE(completed_at, ?) ELSE completed_at END,
                        updated_at = ?
                    WHERE tool_call_id = ?
                    """,
                    (
                        status,
                        result_json,
                        outcome,
                        timeout_reason,
                        status,
                        timestamp,
                        status,
                        timestamp,
                        timestamp,
                        tool_call_id,
                    ),
                )
            tool = connection.execute(
                "SELECT * FROM tool_calls WHERE tool_call_id = ?",
                (tool_call_id,),
            ).fetchone()
            assert tool is not None
            if (
                status in TOOL_TERMINAL_STATES
                and tool["dispatched_at"] is None
            ):
                self._cancel_orphaned_tool_approval_in_transaction(
                    connection,
                    tool=tool,
                    timestamp=timestamp,
                    source="desktop",
                )
            event_type = f"tool.{status}"
            event_id = f"tool:{tool_call_id}:{status}"
            payload = {
                "tool_call_id": tool_call_id,
                "attempt_id": attempt_id,
                "tool_name": tool_name,
                "safety_class": safety_class.value,
                "status": status,
                "outcome": outcome,
                "timeout_reason": timeout_reason,
                "step_id": step_id,
                "request": request or {},
                "result": result,
            }
            normalized_tool_name = tool_name.strip().lower().replace("-", "_")
            if normalized_tool_name in {"todo_write", "update_plan"}:
                semantic_kind = "plan_operation"
            elif normalized_tool_name in {
                "agent_run_subagent",
                "agent_get_task_output",
                "agent_stop_task",
            }:
                semantic_kind = "subtask"
            elif normalized_tool_name.startswith(
                ("shell", "terminal", "exec", "run_")
            ):
                semantic_kind = "command_execution"
            elif any(
                marker in normalized_tool_name
                for marker in ("file", "folder", "directory")
            ):
                semantic_kind = "file_operation"
            elif normalized_tool_name.startswith(
                ("browser", "navigate", "visit")
            ):
                semantic_kind = "browser_operation"
            else:
                semantic_kind = "tool_call"
            semantic_phase = {
                "prepared": "requested",
                "dispatched": "started",
                "completed": "completed",
                "failed": "failed",
                "timed_out": "failed",
                "outcome_unknown": "unknown",
            }.get(status, "progress")
            semantic_status = {
                "prepared": "pending",
                "dispatched": "running",
                "completed": "completed",
                "failed": "failed",
                "timed_out": "timed_out",
                "outcome_unknown": "outcome_unknown",
            }.get(status, "unknown")
            payload.update(
                semantic_event_fields(
                    kind=semantic_kind,
                    subject_type="tool_call",
                    subject_id=tool_call_id,
                    phase=semantic_phase,
                    status=semantic_status,
                    source="tool_checkpoint",
                    actor_type="agent",
                    actor_name=agent_name,
                    correlation={
                        "attempt_id": attempt_id,
                        "task_id": task_id,
                        "step_id": step_id,
                    },
                )
            )
            display_fields = {
                "toolkit_name": toolkit_name,
                "agent_name": agent_name,
                "process_task_id": task_id,
                "step_id": step_id,
                "display_title": display_title,
                "display_input": display_input,
                "display_output": display_output,
                "display_summary": display_summary,
                "display_duration_ms": display_duration_ms,
            }
            payload.update(
                {
                    key: value
                    for key, value in display_fields.items()
                    if value is not None
                }
            )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=event_id,
                    event_type=event_type,
                    payload=payload,
                    created_at=timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM tool_calls WHERE tool_call_id = ?",
                (tool_call_id,),
            ).fetchone()
            assert row is not None
            return self._tool_call_from_row(row)

    def _cancel_orphaned_tool_approval_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        tool: sqlite3.Row,
        timestamp: float,
        source: str,
        reason: str = "tool_terminal_before_dispatch",
    ) -> bool:
        """Close a pending approval whose ToolCall can no longer dispatch."""

        if tool["status"] not in TOOL_TERMINAL_STATES:
            return False
        if tool["dispatched_at"] is not None:
            return False
        approval_id = f"approval:{tool['tool_call_id']}"
        approval = connection.execute(
            """
            SELECT * FROM approvals
            WHERE approval_id = ? AND run_id = ? AND status = 'pending'
            """,
            (approval_id, tool["run_id"]),
        ).fetchone()
        if approval is None:
            return False

        decision_json = json.dumps(
            {"decision": "rejected", "reason": reason},
            separators=(",", ":"),
            sort_keys=True,
        )
        connection.execute(
            """
            UPDATE approvals
            SET status = 'rejected', decision_json = ?, resolved_at = ?,
                version = version + 1
            WHERE approval_id = ? AND status = 'pending'
            """,
            (decision_json, timestamp, approval_id),
        )
        connection.execute(
            """
            UPDATE human_interactions
            SET status = 'cancelled', resolved_at = ?, updated_at = ?,
                version = version + 1
            WHERE interaction_id = ?
              AND status IN ('requested', 'presented')
            """,
            (timestamp, timestamp, approval_id),
        )
        decision_request_id = f"{source}:{approval_id}:{reason}"
        connection.execute(
            """
            INSERT OR IGNORE INTO human_interaction_decisions(
                decision_id, interaction_id, decision_request_id,
                decision_json, actor_type, actor_id, source,
                action_digest, created_at
            ) VALUES (?, ?, ?, ?, 'system', NULL, ?, ?, ?)
            """,
            (
                f"decision:{decision_request_id}",
                approval_id,
                decision_request_id,
                decision_json,
                source,
                approval["action_digest"],
                timestamp,
            ),
        )
        remaining_interaction = connection.execute(
            """
            SELECT 1 FROM human_interactions
            WHERE run_id = ? AND status IN ('requested', 'presented')
            LIMIT 1
            """,
            (tool["run_id"],),
        ).fetchone()
        run = connection.execute(
            "SELECT status FROM runs WHERE run_id = ?",
            (tool["run_id"],),
        ).fetchone()
        interrupt_run = bool(
            remaining_interaction is None
            and run is not None
            and run["status"] not in {"completed", "failed", "cancelled"}
        )
        if interrupt_run and approval["attempt_id"] is not None:
            connection.execute(
                """
                UPDATE run_attempts
                SET status = 'interrupted', ended_at = COALESCE(ended_at, ?),
                    outcome = COALESCE(outcome, ?)
                WHERE attempt_id = ? AND status = 'waiting_for_user'
                """,
                (timestamp, reason, approval["attempt_id"]),
            )
        step_id = self._interaction_step_id_in_transaction(
            connection,
            run_id=str(tool["run_id"]),
            interaction_id=approval_id,
        )
        cancellation_payload = {
            "approval_id": approval_id,
            "interaction_id": approval_id,
            "attempt_id": approval["attempt_id"],
            "tool_call_id": tool["tool_call_id"],
            "decision": "rejected",
            "reason": reason,
            "source": source,
            "continued_attempt": False,
        }
        if step_id:
            cancellation_payload["step_id"] = step_id
        self._append_event_in_transaction(
            connection,
            tool["run_id"],
            RunEventDraft(
                event_id=f"approval:{approval_id}:cancelled:{reason}",
                event_type="approval.cancelled",
                payload=cancellation_payload,
                created_at=timestamp,
            ),
            run_status="interrupted" if interrupt_run else None,
            clear_active_attempt=interrupt_run,
        )
        return True

    def _backfill_cancelled_approval_events_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        timestamp: float,
    ) -> tuple[str, ...]:
        """Restore the missing durable terminal fact for legacy repairs.

        Older startup recovery updated the approval and interaction tables but
        did not append ``approval.cancelled``. Event-native clients therefore
        kept presenting an already-terminal approval forever. This repair is
        append-only and idempotent: a terminal event is added only when the
        canonical interaction row is cancelled and no cancellation event for
        that exact interaction exists.
        """

        terminal_ids: set[tuple[str, str]] = set()
        event_rows = connection.execute(
            """
            SELECT run_id, payload_json FROM run_events
            WHERE event_type IN ('approval.cancelled', 'approval.canceled')
            """
        ).fetchall()
        for event in event_rows:
            try:
                payload = json.loads(event["payload_json"])
            except (TypeError, ValueError):
                continue
            if not isinstance(payload, dict):
                continue
            interaction_id = payload.get("interaction_id") or payload.get(
                "approval_id"
            )
            if isinstance(interaction_id, str) and interaction_id:
                terminal_ids.add((str(event["run_id"]), interaction_id))

        interactions = connection.execute(
            """
            SELECT interaction.*, approval.decision_json,
                   approval.action_digest
            FROM human_interactions AS interaction
            JOIN approvals AS approval
              ON approval.approval_id = interaction.interaction_id
             AND approval.run_id = interaction.run_id
            WHERE interaction.interaction_type = 'approval'
              AND interaction.status = 'cancelled'
            ORDER BY interaction.created_at, interaction.interaction_id
            """
        ).fetchall()
        repaired: list[str] = []
        for interaction in interactions:
            identity = (
                str(interaction["run_id"]),
                str(interaction["interaction_id"]),
            )
            if identity in terminal_ids:
                continue
            try:
                decision = json.loads(interaction["decision_json"] or "{}")
            except (TypeError, ValueError):
                decision = {}
            if not isinstance(decision, dict):
                decision = {}
            reason = str(
                decision.get("reason") or "historical_terminal_interaction"
            )
            interaction_id = str(interaction["interaction_id"])
            step_id = self._interaction_step_id_in_transaction(
                connection,
                run_id=str(interaction["run_id"]),
                interaction_id=interaction_id,
            )
            cancellation_payload = {
                "approval_id": interaction_id,
                "interaction_id": interaction_id,
                "attempt_id": interaction["attempt_id"],
                "decision": "rejected",
                "reason": reason,
                "source": "recovery",
                "continued_attempt": False,
                "backfilled": True,
            }
            if step_id:
                cancellation_payload["step_id"] = step_id
            self._append_event_in_transaction(
                connection,
                str(interaction["run_id"]),
                RunEventDraft(
                    event_id=f"recovery:{interaction_id}:cancelled",
                    event_type="approval.cancelled",
                    payload=cancellation_payload,
                    created_at=timestamp,
                ),
            )
            terminal_ids.add(identity)
            repaired.append(interaction_id)
        return tuple(repaired)

    def _cancel_open_human_interactions_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        timestamp: float,
        reason: str,
    ) -> int:
        """Close HumanInteractions that cannot outlive a terminal Run."""

        interactions = connection.execute(
            """
            SELECT * FROM human_interactions
            WHERE run_id = ? AND status IN ('requested', 'presented')
            ORDER BY created_at, interaction_id
            """,
            (run_id,),
        ).fetchall()
        cancelled = 0
        for interaction in interactions:
            updated = connection.execute(
                """
                UPDATE human_interactions
                SET status = 'cancelled', resolved_at = ?, updated_at = ?,
                    version = version + 1
                WHERE interaction_id = ?
                  AND status IN ('requested', 'presented')
                """,
                (
                    timestamp,
                    timestamp,
                    interaction["interaction_id"],
                ),
            )
            if updated.rowcount != 1:
                continue

            approval = None
            if interaction["interaction_type"] == "approval":
                approval = connection.execute(
                    "SELECT * FROM approvals WHERE approval_id = ?",
                    (interaction["interaction_id"],),
                ).fetchone()
                if approval is not None and approval["status"] == "pending":
                    connection.execute(
                        """
                        UPDATE approvals
                        SET status = 'rejected', decision_json = ?,
                            resolved_at = ?, version = version + 1
                        WHERE approval_id = ? AND status = 'pending'
                        """,
                        (
                            canonical_json(
                                {"decision": "rejected", "reason": reason}
                            ),
                            timestamp,
                            interaction["interaction_id"],
                        ),
                    )

            is_approval = interaction["interaction_type"] == "approval"
            decision = {
                "decision": "rejected" if is_approval else "cancelled",
                "reason": reason,
            }
            decision_request_id = (
                f"system:{interaction['interaction_id']}:{reason}"
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO human_interaction_decisions(
                    decision_id, interaction_id, decision_request_id,
                    decision_json, actor_type, actor_id, source,
                    action_digest, created_at
                ) VALUES (?, ?, ?, ?, 'system', NULL, 'recovery', ?, ?)
                """,
                (
                    f"decision:{decision_request_id}",
                    interaction["interaction_id"],
                    decision_request_id,
                    canonical_json(decision),
                    approval["action_digest"]
                    if approval is not None
                    else None,
                    timestamp,
                ),
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO security_audit_events(
                    audit_event_id, space_id, run_id, interaction_id,
                    event_type, actor_type, actor_id, action_digest,
                    details_json, created_at
                ) VALUES (?, NULL, ?, ?, 'human_interaction.cancelled',
                          'system', NULL, ?, ?, ?)
                """,
                (
                    f"interaction-cancelled:{interaction['interaction_id']}:{reason}",
                    run_id,
                    interaction["interaction_id"],
                    approval["action_digest"]
                    if approval is not None
                    else None,
                    canonical_json(
                        {
                            "interaction_type": interaction[
                                "interaction_type"
                            ],
                            "reason": reason,
                        }
                    ),
                    timestamp,
                ),
            )

            event_type = (
                "approval.cancelled"
                if is_approval
                else "interaction.cancelled"
            )
            payload = {
                "interaction_id": interaction["interaction_id"],
                "interaction_type": interaction["interaction_type"],
                "attempt_id": interaction["attempt_id"],
                "reason": reason,
                "source": "system",
            }
            step_id = self._interaction_step_id_in_transaction(
                connection,
                run_id=run_id,
                interaction_id=str(interaction["interaction_id"]),
            )
            if step_id:
                payload["step_id"] = step_id
            if is_approval:
                payload.update(
                    approval_id=interaction["interaction_id"],
                    decision="rejected",
                    continued_attempt=False,
                )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=(
                        f"{event_type}:{interaction['interaction_id']}:{reason}"
                    ),
                    event_type=event_type,
                    payload=payload,
                    created_at=timestamp,
                ),
            )
            cancelled += 1
        return cancelled

    def _cancel_orphaned_tool_approvals_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str | None,
        timestamp: float,
        source: str,
    ) -> tuple[str, ...]:
        tools = connection.execute(
            """
            SELECT calls.*
            FROM tool_calls AS calls
            JOIN approvals AS approval
              ON approval.approval_id = 'approval:' || calls.tool_call_id
             AND approval.run_id = calls.run_id
             AND approval.status = 'pending'
            WHERE calls.status IN (
                'completed', 'failed', 'timed_out', 'outcome_unknown'
            )
              AND calls.dispatched_at IS NULL
              AND (? IS NULL OR calls.run_id = ?)
            ORDER BY calls.created_at, calls.tool_call_id
            """,
            (run_id, run_id),
        ).fetchall()
        cancelled: list[str] = []
        for tool in tools:
            if self._cancel_orphaned_tool_approval_in_transaction(
                connection,
                tool=tool,
                timestamp=timestamp,
                source=source,
            ):
                cancelled.append(f"approval:{tool['tool_call_id']}")
        return tuple(cancelled)

    def list_tool_calls(self, run_id: str) -> list[ToolCallRecord]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM tool_calls WHERE run_id = ? ORDER BY created_at",
                (run_id,),
            ).fetchall()
            return [self._tool_call_from_row(row) for row in rows]

    def create_human_interaction(
        self,
        *,
        interaction_id: str,
        run_id: str,
        attempt_id: str | None,
        interaction_type: str,
        request: dict[str, Any],
        response_schema: dict[str, Any] | None = None,
        options: list[dict[str, Any]] | None = None,
        requested_by: str = "agent",
        step_id: str | None = None,
        expires_at: float | None = None,
        now: float | None = None,
    ) -> HumanInteractionRecord:
        if interaction_type not in {
            "question",
            "choice",
            "form",
            "confirmation",
            "diff_review",
            "merge_conflict",
            "credential_binding",
            "memory_change_review",
        }:
            if interaction_type == "approval":
                raise ValueError(
                    "approval interactions must be created by create_approval"
                )
            raise ValueError(
                f"unsupported interaction type {interaction_type!r}"
            )
        timestamp = now if now is not None else time.time()
        request_json = canonical_json(request)
        response_schema_json = canonical_json(response_schema or {})
        normalized_options = list(options or [])
        option_rows: list[tuple[str, int, str, str, str | None]] = []
        seen_option_ids: set[str] = set()
        for position, option in enumerate(normalized_options):
            option_id = str(option.get("option_id") or option.get("id") or "")
            label = str(option.get("label") or "")
            if not option_id or not label or option_id in seen_option_ids:
                raise ValueError(
                    "interaction options require unique ids and labels"
                )
            seen_option_ids.add(option_id)
            option_rows.append(
                (
                    option_id,
                    position,
                    label,
                    canonical_json(option.get("value", option_id)),
                    (
                        str(option["description"])
                        if option.get("description") is not None
                        else None
                    ),
                )
            )
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM human_interactions WHERE interaction_id = ?",
                (interaction_id,),
            ).fetchone()
            if existing is not None:
                existing_options = connection.execute(
                    """
                    SELECT option_id, position, label, value_json, description
                    FROM human_interaction_options
                    WHERE interaction_id = ? ORDER BY position
                    """,
                    (interaction_id,),
                ).fetchall()
                if (
                    existing["run_id"] != run_id
                    or existing["attempt_id"] != attempt_id
                    or existing["interaction_type"] != interaction_type
                    or existing["request_json"] != request_json
                    or existing["response_schema_json"] != response_schema_json
                    or existing["requested_by"] != requested_by
                    or existing["expires_at"] != expires_at
                    or [tuple(row) for row in existing_options] != option_rows
                ):
                    raise IdempotencyConflictError(
                        f"interaction_id {interaction_id!r} was reused"
                    )
                return self._human_interaction_from_row(existing)
            run = connection.execute(
                "SELECT status, active_attempt_id FROM runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["status"] in {"completed", "failed", "cancelled"}:
                raise InvalidRunTransitionError(
                    f"terminal run {run_id!r} cannot request human interaction"
                )
            self._validate_waiting_attempt(
                connection,
                run_id=run_id,
                attempt_id=attempt_id,
                active_attempt_id=run["active_attempt_id"],
                interaction_label="human interaction",
            )
            resolved_step_id = self._append_step_transition_in_transaction(
                connection,
                run_id=run_id,
                step_id=step_id,
                event="blocked",
                status="blocked",
                allowed_previous={"pending", "running"},
                attempt_id=attempt_id,
                reason_code=f"interaction_requested:{interaction_type}",
                provenance_source="human_interaction",
            )
            connection.execute(
                """
                INSERT INTO human_interactions(
                    interaction_id, run_id, attempt_id, interaction_type,
                    status, request_json, response_schema_json, requested_by,
                    version, expires_at, presented_at, resolved_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, 0, ?, NULL, NULL, ?, ?)
                """,
                (
                    interaction_id,
                    run_id,
                    attempt_id,
                    interaction_type,
                    request_json,
                    response_schema_json,
                    requested_by,
                    expires_at,
                    timestamp,
                    timestamp,
                ),
            )
            connection.executemany(
                """
                INSERT INTO human_interaction_options(
                    interaction_id, option_id, position, label, value_json,
                    description
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [(interaction_id, *row) for row in option_rows],
            )
            if attempt_id is not None:
                updated_attempt = connection.execute(
                    """
                    UPDATE run_attempts SET status = 'waiting_for_user'
                    WHERE attempt_id = ? AND status = 'running'
                    """,
                    (attempt_id,),
                )
                if updated_attempt.rowcount == 0:
                    waiting_attempt = connection.execute(
                        "SELECT status FROM run_attempts WHERE attempt_id = ?",
                        (attempt_id,),
                    ).fetchone()
                    if (
                        waiting_attempt is None
                        or waiting_attempt["status"] != "waiting_for_user"
                    ):
                        raise InvalidRunTransitionError(
                            f"interaction attempt {attempt_id!r} is no longer "
                            "running or waiting"
                        )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"interaction:{interaction_id}:requested",
                    event_type="interaction.requested",
                    payload={
                        "interaction_id": interaction_id,
                        "version": 0,
                        "interaction_type": interaction_type,
                        "attempt_id": attempt_id,
                        "request": request,
                        "response_schema": response_schema or {},
                        "options": normalized_options,
                        "requested_by": requested_by,
                        "step_id": resolved_step_id,
                        "expires_at": expires_at,
                    },
                    created_at=timestamp,
                ),
                run_status="waiting_for_user",
                active_attempt_id=attempt_id,
            )
            row = connection.execute(
                "SELECT * FROM human_interactions WHERE interaction_id = ?",
                (interaction_id,),
            ).fetchone()
            assert row is not None
            return self._human_interaction_from_row(row)

    def resolve_human_interaction(
        self,
        interaction_id: str,
        *,
        decision_request_id: str,
        decision: dict[str, Any],
        expected_version: int,
        expected_run_id: str | None = None,
        actor_type: str = "user",
        actor_id: str | None = None,
        source: str = "desktop",
        continue_active_attempt: bool = False,
        now: float | None = None,
    ) -> HumanInteractionRecord:
        if not decision_request_id:
            raise ValueError("decision_request_id is required")
        if actor_type not in {"user", "auto_reviewer", "system"}:
            raise ValueError("invalid interaction decision actor_type")
        if source not in {"desktop", "remote_control", "recovery", "expiry"}:
            raise ValueError("invalid interaction decision source")
        timestamp = now if now is not None else time.time()
        decision_json = canonical_json(decision)
        with self._write_transaction() as connection:
            interaction = connection.execute(
                "SELECT * FROM human_interactions WHERE interaction_id = ?",
                (interaction_id,),
            ).fetchone()
            if interaction is None:
                raise RunNotFoundError(
                    f"interaction_id {interaction_id!r} does not exist"
                )
            if interaction["interaction_type"] == "approval":
                raise InvalidRunTransitionError(
                    "approval interactions must be resolved by decide_approval"
                )
            if (
                expected_run_id is not None
                and interaction["run_id"] != expected_run_id
            ):
                raise IdempotencyConflictError(
                    f"interaction {interaction_id!r} does not belong to run "
                    f"{expected_run_id!r}"
                )
            duplicate = connection.execute(
                """
                SELECT * FROM human_interaction_decisions
                WHERE interaction_id = ? AND decision_request_id = ?
                """,
                (interaction_id, decision_request_id),
            ).fetchone()
            if duplicate is not None:
                if (
                    duplicate["decision_json"] != decision_json
                    or duplicate["actor_type"] != actor_type
                    or duplicate["actor_id"] != actor_id
                    or duplicate["source"] != source
                ):
                    raise IdempotencyConflictError(
                        f"decision_request_id {decision_request_id!r} was reused"
                    )
                return self._human_interaction_from_row(interaction)
            if interaction["status"] not in {"requested", "presented"}:
                raise InvalidRunTransitionError(
                    f"interaction {interaction_id!r} is already "
                    f"{interaction['status']}"
                )
            if int(interaction["version"]) != expected_version:
                raise OptimisticConcurrencyError(
                    f"interaction {interaction_id!r} expected version "
                    f"{expected_version}"
                )
            (
                can_continue,
                remains_waiting,
                remaining_interaction_count,
            ) = self._resolve_waiting_attempt(
                connection,
                interaction_id=interaction_id,
                attempt_id=interaction["attempt_id"],
                continue_active_attempt=continue_active_attempt,
                timestamp=timestamp,
                outcome="human_interaction_resolved",
            )
            step_id = self._interaction_step_id_in_transaction(
                connection,
                run_id=str(interaction["run_id"]),
                interaction_id=interaction_id,
            )
            connection.execute(
                """
                INSERT INTO human_interaction_decisions(
                    decision_id, interaction_id, decision_request_id,
                    decision_json, actor_type, actor_id, source,
                    action_digest, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    str(uuid.uuid4()),
                    interaction_id,
                    decision_request_id,
                    decision_json,
                    actor_type,
                    actor_id,
                    source,
                    timestamp,
                ),
            )
            updated = connection.execute(
                """
                UPDATE human_interactions
                SET status = 'resolved', resolved_at = ?, updated_at = ?,
                    version = version + 1
                WHERE interaction_id = ? AND version = ?
                  AND status IN ('requested', 'presented')
                """,
                (timestamp, timestamp, interaction_id, expected_version),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError(
                    f"interaction {interaction_id!r} changed while resolving"
                )
            connection.execute(
                """
                INSERT OR IGNORE INTO security_audit_events(
                    audit_event_id, space_id, run_id, interaction_id,
                    event_type, actor_type, actor_id, action_digest,
                    details_json, created_at
                ) VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    f"interaction-decision:{interaction_id}:{decision_request_id}",
                    interaction["run_id"],
                    interaction_id,
                    "human_interaction.resolved",
                    actor_type,
                    actor_id,
                    canonical_json(
                        {
                            "interaction_type": interaction[
                                "interaction_type"
                            ],
                            "source": source,
                            "decision_fields": sorted(decision),
                        }
                    ),
                    timestamp,
                ),
            )
            if can_continue and not remains_waiting and step_id:
                self._append_step_transition_in_transaction(
                    connection,
                    run_id=str(interaction["run_id"]),
                    step_id=step_id,
                    event="resumed",
                    status="running",
                    allowed_previous={"blocked", "interrupted"},
                    attempt_id=(
                        str(interaction["attempt_id"])
                        if interaction["attempt_id"]
                        else None
                    ),
                    reason_code="interaction_resolved",
                    provenance_source="human_interaction",
                )
            self._append_event_in_transaction(
                connection,
                interaction["run_id"],
                RunEventDraft(
                    event_id=(
                        f"interaction:{interaction_id}:decision:"
                        f"{decision_request_id}"
                    ),
                    event_type="interaction.resolved",
                    payload={
                        "interaction_id": interaction_id,
                        "interaction_type": interaction["interaction_type"],
                        "decision_request_id": decision_request_id,
                        "decision": decision,
                        "actor_type": actor_type,
                        "actor_id": actor_id,
                        "source": source,
                        "step_id": step_id,
                        "continued_attempt": can_continue,
                        "remaining_interaction_count": (
                            remaining_interaction_count
                        ),
                    },
                    created_at=timestamp,
                ),
                run_status=(
                    "waiting_for_user"
                    if remains_waiting
                    else "running"
                    if can_continue
                    else "interrupted"
                ),
                active_attempt_id=(
                    interaction["attempt_id"]
                    if can_continue or remains_waiting
                    else None
                ),
                clear_active_attempt=not can_continue and not remains_waiting,
            )
            row = connection.execute(
                "SELECT * FROM human_interactions WHERE interaction_id = ?",
                (interaction_id,),
            ).fetchone()
            assert row is not None
            return self._human_interaction_from_row(row)

    def get_human_interaction(
        self, interaction_id: str
    ) -> HumanInteractionRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM human_interactions WHERE interaction_id = ?",
                (interaction_id,),
            ).fetchone()
            return self._human_interaction_from_row(row) if row else None

    def list_human_interactions(
        self, run_id: str, *, pending_only: bool = False
    ) -> list[HumanInteractionRecord]:
        query = "SELECT * FROM human_interactions WHERE run_id = ?"
        if pending_only:
            query += " AND status IN ('requested', 'presented')"
        query += " ORDER BY created_at, interaction_id"
        with self._lock:
            rows = self._connection.execute(query, (run_id,)).fetchall()
            return [self._human_interaction_from_row(row) for row in rows]

    def list_human_interaction_options(
        self, interaction_id: str
    ) -> list[HumanInteractionOptionRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM human_interaction_options
                WHERE interaction_id = ? ORDER BY position
                """,
                (interaction_id,),
            ).fetchall()
            return [
                self._human_interaction_option_from_row(row) for row in rows
            ]

    def list_human_interaction_decisions(
        self, interaction_id: str
    ) -> list[HumanInteractionDecisionRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM human_interaction_decisions
                WHERE interaction_id = ? ORDER BY created_at, decision_id
                """,
                (interaction_id,),
            ).fetchall()
            return [
                self._human_interaction_decision_from_row(row) for row in rows
            ]

    def get_space_permission_profile(
        self, space_id: str
    ) -> SpacePermissionProfileRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM space_permission_profiles WHERE space_id = ?",
                (space_id,),
            ).fetchone()
            return (
                self._space_permission_profile_from_row(row) if row else None
            )

    def get_space_permission_profile_revision(
        self,
        revision_id: str,
    ) -> SpacePermissionProfileRevisionRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM space_permission_profile_revisions
                WHERE revision_id = ?
                """,
                (revision_id,),
            ).fetchone()
            return (
                self._space_permission_profile_revision_from_row(row)
                if row
                else None
            )

    def put_space_permission_profile(
        self,
        *,
        space_id: str,
        profile_name: str,
        sandbox_mode: str,
        approval_mode: str,
        reviewer_mode: str,
        updated_by: str,
        expected_revision: int | None = None,
        audit_request_id: str | None = None,
        now: float | None = None,
    ) -> SpacePermissionProfileRecord:
        if profile_name not in {
            "read_only",
            "request_approval",
            "auto_reviewer",
            "full_access",
        }:
            raise ValueError("invalid permission profile name")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM space_permission_profiles WHERE space_id = ?",
                (space_id,),
            ).fetchone()
            values = (
                profile_name,
                sandbox_mode,
                approval_mode,
                reviewer_mode,
                updated_by,
            )
            if existing is None:
                if expected_revision not in {None, 0}:
                    raise OptimisticConcurrencyError(
                        f"space {space_id!r} has no permission profile at "
                        f"revision {expected_revision}"
                    )
                connection.execute(
                    """
                    INSERT INTO space_permission_profiles(
                        space_id, profile_name, sandbox_mode, approval_mode,
                        reviewer_mode, revision, updated_by, created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
                    """,
                    (space_id, *values, timestamp, timestamp),
                )
                next_revision = 1
            else:
                current_values = (
                    existing["profile_name"],
                    existing["sandbox_mode"],
                    existing["approval_mode"],
                    existing["reviewer_mode"],
                    existing["updated_by"],
                )
                if current_values == values:
                    next_revision = int(existing["revision"])
                else:
                    if (
                        expected_revision is not None
                        and int(existing["revision"]) != expected_revision
                    ):
                        raise OptimisticConcurrencyError(
                            f"space {space_id!r} permission profile expected "
                            f"revision {expected_revision}"
                        )
                    connection.execute(
                        """
                        UPDATE space_permission_profiles
                        SET profile_name = ?, sandbox_mode = ?, approval_mode = ?,
                            reviewer_mode = ?, revision = revision + 1,
                            updated_by = ?, updated_at = ?
                        WHERE space_id = ? AND revision = ?
                        """,
                        (
                            profile_name,
                            sandbox_mode,
                            approval_mode,
                            reviewer_mode,
                            updated_by,
                            timestamp,
                            space_id,
                            int(existing["revision"]),
                        ),
                    )
                    next_revision = int(existing["revision"]) + 1
            row = connection.execute(
                "SELECT * FROM space_permission_profiles WHERE space_id = ?",
                (space_id,),
            ).fetchone()
            assert row is not None
            connection.execute(
                """
                INSERT OR IGNORE INTO space_permission_profile_revisions(
                    revision_id, space_id, profile_name, sandbox_mode,
                    approval_mode, reviewer_mode, revision, created_by,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"space:{space_id}:{next_revision}",
                    space_id,
                    profile_name,
                    sandbox_mode,
                    approval_mode,
                    reviewer_mode,
                    next_revision,
                    updated_by,
                    timestamp,
                ),
            )
            if audit_request_id:
                audit_event_id = (
                    f"permission-profile:{space_id}:{audit_request_id}"
                )
                details_json = canonical_json(
                    {
                        "profile_name": profile_name,
                        "revision": next_revision,
                    }
                )
                existing_audit = connection.execute(
                    """
                    SELECT * FROM security_audit_events
                    WHERE audit_event_id = ?
                    """,
                    (audit_event_id,),
                ).fetchone()
                audit_values = (
                    space_id,
                    "permission.profile.modified",
                    "user",
                    updated_by,
                    details_json,
                )
                if existing_audit is not None:
                    persisted = (
                        existing_audit["space_id"],
                        existing_audit["event_type"],
                        existing_audit["actor_type"],
                        existing_audit["actor_id"],
                        existing_audit["details_json"],
                    )
                    if persisted != audit_values:
                        raise IdempotencyConflictError(
                            f"audit request {audit_request_id!r} was reused"
                        )
                else:
                    connection.execute(
                        """
                        INSERT INTO security_audit_events(
                            audit_event_id, space_id, run_id, interaction_id,
                            event_type, actor_type, actor_id, action_digest,
                            details_json, created_at
                        ) VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?)
                        """,
                        (audit_event_id, *audit_values, timestamp),
                    )
            return self._space_permission_profile_from_row(row)

    def create_approval_rule(
        self,
        *,
        rule_id: str,
        space_id: str,
        effect: str,
        action_pattern: str,
        resource_pattern: str | None,
        scope: str,
        run_id: str | None,
        source_interaction_id: str | None,
        expires_at: float | None,
        created_by: str,
        now: float | None = None,
    ) -> ApprovalRuleRecord:
        if effect not in {"allow", "prompt", "deny"}:
            raise ValueError(
                "approval rule effect must be allow, prompt, or deny"
            )
        if scope not in {"run", "space"}:
            raise ValueError("approval rule scope must be run or space")
        if scope == "run" and not run_id:
            raise ValueError("run-scoped approval rules require run_id")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM approval_rules WHERE rule_id = ?", (rule_id,)
            ).fetchone()
            values = (
                space_id,
                effect,
                action_pattern,
                resource_pattern,
                scope,
                run_id,
                source_interaction_id,
                expires_at,
                created_by,
            )
            if existing is not None:
                persisted = tuple(
                    existing[key]
                    for key in (
                        "space_id",
                        "effect",
                        "action_pattern",
                        "resource_pattern",
                        "scope",
                        "run_id",
                        "source_interaction_id",
                        "expires_at",
                        "created_by",
                    )
                )
                if persisted != values:
                    raise IdempotencyConflictError(
                        f"approval rule {rule_id!r} was reused"
                    )
                # Replaying a persisted rule must not convert arbitrary SQLite
                # contents into an in-process ALLOW attestation.
                return self._approval_rule_from_row(existing)
            connection.execute(
                """
                INSERT INTO approval_rules(
                    rule_id, space_id, effect, action_pattern,
                    resource_pattern, scope, run_id,
                    source_interaction_id, expires_at, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (rule_id, *values, timestamp),
            )
            row = connection.execute(
                "SELECT * FROM approval_rules WHERE rule_id = ?", (rule_id,)
            ).fetchone()
            assert row is not None
            resolved = self._approval_rule_from_row(row)
            self._trusted_approval_rules.add(resolved.rule_id)
            return resolved

    def approval_rule_is_trusted(self, rule_id: str) -> bool:
        return rule_id in self._trusted_approval_rules

    def list_approval_rules(
        self,
        *,
        space_id: str,
        run_id: str | None = None,
        now: float | None = None,
    ) -> list[ApprovalRuleRecord]:
        timestamp = now if now is not None else time.time()
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM approval_rules
                WHERE space_id = ?
                  AND (expires_at IS NULL OR expires_at > ?)
                  AND (scope = 'space' OR (scope = 'run' AND run_id = ?))
                ORDER BY created_at, rule_id
                """,
                (space_id, timestamp, run_id),
            ).fetchall()
            return [self._approval_rule_from_row(row) for row in rows]

    def append_security_audit_event(
        self,
        *,
        audit_event_id: str,
        event_type: str,
        actor_type: str,
        details: dict[str, Any] | None = None,
        space_id: str | None = None,
        run_id: str | None = None,
        interaction_id: str | None = None,
        actor_id: str | None = None,
        action_digest: str | None = None,
        now: float | None = None,
    ) -> SecurityAuditEventRecord:
        timestamp = now if now is not None else time.time()
        details_json = canonical_json(details or {})
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM security_audit_events WHERE audit_event_id = ?",
                (audit_event_id,),
            ).fetchone()
            values = (
                space_id,
                run_id,
                interaction_id,
                event_type,
                actor_type,
                actor_id,
                action_digest,
                details_json,
            )
            if existing is not None:
                persisted = tuple(
                    existing[key]
                    for key in (
                        "space_id",
                        "run_id",
                        "interaction_id",
                        "event_type",
                        "actor_type",
                        "actor_id",
                        "action_digest",
                        "details_json",
                    )
                )
                if persisted != values:
                    raise IdempotencyConflictError(
                        f"audit_event_id {audit_event_id!r} was reused"
                    )
                return self._security_audit_event_from_row(existing)
            connection.execute(
                """
                INSERT INTO security_audit_events(
                    audit_event_id, space_id, run_id, interaction_id,
                    event_type, actor_type, actor_id, action_digest,
                    details_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (audit_event_id, *values, timestamp),
            )
            row = connection.execute(
                "SELECT * FROM security_audit_events WHERE audit_event_id = ?",
                (audit_event_id,),
            ).fetchone()
            assert row is not None
            return self._security_audit_event_from_row(row)

    @staticmethod
    def _validate_waiting_attempt(
        connection: sqlite3.Connection,
        *,
        run_id: str,
        attempt_id: str | None,
        active_attempt_id: str | None,
        interaction_label: str,
    ) -> None:
        if attempt_id is not None:
            attempt = connection.execute(
                "SELECT run_id, status FROM run_attempts WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            if attempt is None or attempt["run_id"] != run_id:
                raise IdempotencyConflictError(
                    f"attempt {attempt_id!r} does not belong to run {run_id!r}"
                )
            attempt_status = str(attempt["status"])
            can_enter_or_share_wait = attempt_status == "waiting_for_user" or (
                transition_allowed(
                    ATTEMPT_TRANSITIONS,
                    attempt_status,
                    "waiting_for_user",
                )
            )
            if not can_enter_or_share_wait or active_attempt_id != attempt_id:
                raise InvalidRunTransitionError(
                    f"{interaction_label} attempt {attempt_id!r} must be the "
                    "active running attempt or already waiting for user"
                )
        elif active_attempt_id is not None:
            raise InvalidRunTransitionError(
                f"{interaction_label} for a Run with an active attempt must "
                "bind that attempt"
            )

    @staticmethod
    def _resolve_waiting_attempt(
        connection: sqlite3.Connection,
        *,
        interaction_id: str,
        attempt_id: str | None,
        continue_active_attempt: bool,
        timestamp: float,
        outcome: str,
    ) -> tuple[bool, bool, int]:
        if attempt_id is None:
            return False, False, 0
        attempt = connection.execute(
            "SELECT status FROM run_attempts WHERE attempt_id = ?",
            (attempt_id,),
        ).fetchone()
        status = attempt["status"] if attempt is not None else None
        if status in ATTEMPT_ACTIVE_STATES and status != "waiting_for_user":
            raise InvalidRunTransitionError(
                f"interaction attempt {attempt_id!r} is in active state "
                f"{status!r}, not waiting_for_user"
            )
        remaining_interaction_count = int(
            connection.execute(
                """
                SELECT COUNT(*) FROM human_interactions
                WHERE attempt_id = ? AND interaction_id != ?
                  AND status IN ('requested', 'presented')
                """,
                (attempt_id, interaction_id),
            ).fetchone()[0]
        )
        remains_waiting = bool(
            status == "waiting_for_user" and remaining_interaction_count > 0
        )
        can_continue = bool(
            continue_active_attempt
            and status == "waiting_for_user"
            and not remains_waiting
        )
        if can_continue:
            connection.execute(
                """
                UPDATE run_attempts
                SET status = 'running', last_consumer_heartbeat_at = ?
                WHERE attempt_id = ? AND status = 'waiting_for_user'
                """,
                (timestamp, attempt_id),
            )
        elif not remains_waiting:
            connection.execute(
                """
                UPDATE run_attempts
                SET status = 'interrupted', ended_at = COALESCE(ended_at, ?),
                    outcome = ?
                WHERE attempt_id = ? AND status = 'waiting_for_user'
                """,
                (timestamp, outcome, attempt_id),
            )
        return can_continue, remains_waiting, remaining_interaction_count

    def create_approval(
        self,
        *,
        approval_id: str,
        run_id: str,
        attempt_id: str | None,
        prompt: dict[str, Any],
        action_digest: str | None = None,
        policy_revision: str = "legacy",
        safety_class: str = "unknown",
        decision_scope: str = "once",
        step_id: str | None = None,
        expires_at: float | None = None,
        expiry_action: str = "keep_pending",
        now: float | None = None,
    ) -> ApprovalRecord:
        if expiry_action not in {"keep_pending", "reject"}:
            raise ValueError("invalid approval expiry action")
        timestamp = now if now is not None else time.time()
        prompt_json = json.dumps(
            prompt, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        )
        resolved_action_digest = action_digest or canonical_digest(
            {
                "kind": "legacy_approval",
                "run_id": run_id,
                "attempt_id": attempt_id,
                "prompt": prompt,
            }
        )
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)
            ).fetchone()
            if existing is not None:
                if (
                    existing["run_id"] != run_id
                    or existing["attempt_id"] != attempt_id
                    or existing["prompt_json"] != prompt_json
                    or existing["expires_at"] != expires_at
                    or existing["expiry_action"] != expiry_action
                    or existing["action_digest"] != resolved_action_digest
                    or existing["policy_revision"] != policy_revision
                    or existing["safety_class"] != safety_class
                    or existing["decision_scope"] != decision_scope
                ):
                    raise IdempotencyConflictError(
                        f"approval_id {approval_id!r} was reused"
                    )
                return self._approval_from_row(existing)
            run = connection.execute(
                "SELECT status, active_attempt_id FROM runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["status"] in {"completed", "failed", "cancelled"}:
                raise InvalidRunTransitionError(
                    f"terminal run {run_id!r} cannot request approval"
                )
            self._validate_waiting_attempt(
                connection,
                run_id=run_id,
                attempt_id=attempt_id,
                active_attempt_id=run["active_attempt_id"],
                interaction_label="approval",
            )
            resolved_step_id = self._append_step_transition_in_transaction(
                connection,
                run_id=run_id,
                step_id=step_id,
                event="blocked",
                status="blocked",
                allowed_previous={"pending", "running"},
                attempt_id=attempt_id,
                reason_code="approval_requested",
                provenance_source="human_interaction",
            )
            connection.execute(
                """
                INSERT INTO human_interactions(
                    interaction_id, run_id, attempt_id, interaction_type,
                    status, request_json, response_schema_json, requested_by,
                    version, expires_at, presented_at, resolved_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'approval', 'requested', ?, '{}',
                    'permission_policy', 0, ?, NULL, NULL, ?, ?)
                """,
                (
                    approval_id,
                    run_id,
                    attempt_id,
                    prompt_json,
                    expires_at,
                    timestamp,
                    timestamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO approvals(
                    approval_id, run_id, attempt_id, status, prompt_json,
                    decision_json, created_at, resolved_at, version,
                    expires_at, expiry_action, action_digest, policy_revision,
                    safety_class, decision_scope
                ) VALUES (?, ?, ?, 'pending', ?, NULL, ?, NULL, 0, ?, ?, ?, ?, ?, ?)
                """,
                (
                    approval_id,
                    run_id,
                    attempt_id,
                    prompt_json,
                    timestamp,
                    expires_at,
                    expiry_action,
                    resolved_action_digest,
                    policy_revision,
                    safety_class,
                    decision_scope,
                ),
            )
            if attempt_id is not None:
                updated_attempt = connection.execute(
                    """
                    UPDATE run_attempts SET status = 'waiting_for_user'
                    WHERE attempt_id = ? AND status = 'running'
                    """,
                    (attempt_id,),
                )
                if updated_attempt.rowcount == 0:
                    waiting_attempt = connection.execute(
                        "SELECT status FROM run_attempts WHERE attempt_id = ?",
                        (attempt_id,),
                    ).fetchone()
                    if (
                        waiting_attempt is None
                        or waiting_attempt["status"] != "waiting_for_user"
                    ):
                        raise InvalidRunTransitionError(
                            f"approval attempt {attempt_id!r} is no longer "
                            "running or waiting"
                        )
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"approval:{approval_id}:requested",
                    event_type="approval.requested",
                    payload={
                        "approval_id": approval_id,
                        "version": 0,
                        "attempt_id": attempt_id,
                        "prompt": prompt,
                        "expires_at": expires_at,
                        "expiry_action": expiry_action,
                        "action_digest": resolved_action_digest,
                        "policy_revision": policy_revision,
                        "safety_class": safety_class,
                        "decision_scope": decision_scope,
                        "step_id": resolved_step_id,
                    },
                    created_at=timestamp,
                ),
                run_status="waiting_for_user",
                active_attempt_id=attempt_id,
            )
            row = connection.execute(
                "SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)
            ).fetchone()
            assert row is not None
            return self._approval_from_row(row)

    def approval_decision_is_trusted(
        self,
        approval_id: str,
        *,
        version: int,
        action_digest: str,
    ) -> bool:
        """Return whether this process committed the dispatching decision.

        SQLite remains the recovery/audit source of truth, while this volatile
        attestation prevents a sibling process from turning a direct DB edit
        into authority for an already-waiting live tool call. Restart loses the
        attestation and therefore fails closed instead of replaying approval.
        """

        return (approval_id, version, action_digest) in (
            self._trusted_approval_decisions
        )

    def decide_approval(
        self,
        approval_id: str,
        *,
        decision: str,
        details: dict[str, Any] | None = None,
        expected_version: int,
        expected_run_id: str | None = None,
        continue_active_attempt: bool = False,
        decision_request_id: str | None = None,
        action_digest: str | None = None,
        actor_type: str = "user",
        actor_id: str | None = None,
        source: str = "desktop",
        decision_scope: str = "once",
        rule_space_id: str | None = None,
        rule_id: str | None = None,
        rule_action_pattern: str | None = None,
        rule_resource_pattern: str | None = None,
        rule_expires_at: float | None = None,
        now: float | None = None,
    ) -> ApprovalRecord:
        if decision not in {"approved", "rejected"}:
            raise ValueError("approval decision must be approved or rejected")
        if actor_type not in {"user", "auto_reviewer", "system"}:
            raise ValueError("invalid approval decision actor_type")
        if source not in {"desktop", "remote_control", "recovery", "expiry"}:
            raise ValueError("invalid approval decision source")
        if decision_scope not in {"once", "run", "space"}:
            raise ValueError(
                "approval decision scope must be once, run, or space"
            )
        if decision == "approved" and decision_scope in {"run", "space"}:
            if (
                not rule_space_id
                or not rule_id
                or not rule_action_pattern
                or not rule_resource_pattern
            ):
                raise ValueError(
                    "bounded approval scope requires space, rule id, action, "
                    "and an exact resource matcher"
                )
        timestamp = now if now is not None else time.time()
        decision_value = {"decision": decision, **(details or {})}
        decision_json = json.dumps(
            decision_value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        resolved_request_id = decision_request_id or (
            f"legacy:{approval_id}:{expected_version + 1}"
        )
        with self._write_transaction() as connection:
            approval = connection.execute(
                "SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)
            ).fetchone()
            if approval is None:
                raise RunNotFoundError(
                    f"approval_id {approval_id!r} does not exist"
                )
            if (
                expected_run_id is not None
                and approval["run_id"] != expected_run_id
            ):
                raise IdempotencyConflictError(
                    f"approval {approval_id!r} does not belong to run {expected_run_id!r}"
                )
            if (
                action_digest is not None
                and approval["action_digest"] != action_digest
            ):
                raise IdempotencyConflictError(
                    f"approval {approval_id!r} action digest changed"
                )
            duplicate = connection.execute(
                """
                SELECT * FROM human_interaction_decisions
                WHERE interaction_id = ? AND decision_request_id = ?
                """,
                (approval_id, resolved_request_id),
            ).fetchone()
            if duplicate is not None:
                if (
                    duplicate["decision_json"] != decision_json
                    or duplicate["actor_type"] != actor_type
                    or duplicate["actor_id"] != actor_id
                    or duplicate["source"] != source
                    or duplicate["action_digest"] != approval["action_digest"]
                ):
                    raise IdempotencyConflictError(
                        f"decision_request_id {resolved_request_id!r} was reused"
                    )
                return self._approval_from_row(approval)
            if approval["status"] != "pending":
                if (
                    approval["status"] == decision
                    and approval["decision_json"] == decision_json
                ):
                    return self._approval_from_row(approval)
                raise InvalidRunTransitionError(
                    f"approval {approval_id!r} is already resolved"
                )
            if int(approval["version"]) != expected_version:
                raise OptimisticConcurrencyError(
                    f"approval {approval_id!r} expected version {expected_version}"
                )
            run = connection.execute(
                "SELECT status FROM runs WHERE run_id = ?",
                (approval["run_id"],),
            ).fetchone()
            if run is None:
                raise RunNotFoundError(
                    f"run_id {approval['run_id']!r} does not exist"
                )
            if run["status"] in {"completed", "failed", "cancelled"}:
                raise InvalidRunTransitionError(
                    f"terminal run {approval['run_id']!r} cannot accept an approval decision"
                )
            (
                can_continue,
                remains_waiting,
                remaining_interaction_count,
            ) = self._resolve_waiting_attempt(
                connection,
                interaction_id=approval_id,
                attempt_id=approval["attempt_id"],
                continue_active_attempt=continue_active_attempt,
                timestamp=timestamp,
                outcome="approval_decision_persisted",
            )
            step_id = self._interaction_step_id_in_transaction(
                connection,
                run_id=str(approval["run_id"]),
                interaction_id=approval_id,
            )
            connection.execute(
                """
                UPDATE approvals
                SET status = ?, decision_json = ?, resolved_at = ?,
                    decision_scope = ?, version = version + 1
                WHERE approval_id = ? AND version = ? AND status = 'pending'
                """,
                (
                    decision,
                    decision_json,
                    timestamp,
                    decision_scope,
                    approval_id,
                    expected_version,
                ),
            )
            connection.execute(
                """
                INSERT INTO human_interaction_decisions(
                    decision_id, interaction_id, decision_request_id,
                    decision_json, actor_type, actor_id, source,
                    action_digest, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    approval_id,
                    resolved_request_id,
                    decision_json,
                    actor_type,
                    actor_id,
                    source,
                    approval["action_digest"],
                    timestamp,
                ),
            )
            updated_interaction = connection.execute(
                """
                UPDATE human_interactions
                SET status = 'resolved', resolved_at = ?, updated_at = ?,
                    version = version + 1
                WHERE interaction_id = ? AND version = ?
                  AND status IN ('requested', 'presented')
                """,
                (
                    timestamp,
                    timestamp,
                    approval_id,
                    expected_version,
                ),
            )
            if updated_interaction.rowcount != 1:
                raise OptimisticConcurrencyError(
                    f"approval interaction {approval_id!r} changed while resolving"
                )
            if decision == "approved" and decision_scope in {"run", "space"}:
                connection.execute(
                    """
                    INSERT INTO approval_rules(
                        rule_id, space_id, effect, action_pattern,
                        resource_pattern, scope, run_id,
                        source_interaction_id, expires_at, created_by,
                        created_at
                    ) VALUES (?, ?, 'allow', ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(rule_id) DO NOTHING
                    """,
                    (
                        rule_id,
                        rule_space_id,
                        rule_action_pattern,
                        rule_resource_pattern,
                        decision_scope,
                        approval["run_id"]
                        if decision_scope == "run"
                        else None,
                        approval_id,
                        rule_expires_at,
                        actor_id or actor_type,
                        timestamp,
                    ),
                )
            connection.execute(
                """
                INSERT OR IGNORE INTO security_audit_events(
                    audit_event_id, space_id, run_id, interaction_id,
                    event_type, actor_type, actor_id, action_digest,
                    details_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"approval-decision:{approval_id}:{resolved_request_id}",
                    rule_space_id,
                    approval["run_id"],
                    approval_id,
                    f"approval.{decision}",
                    actor_type,
                    actor_id,
                    approval["action_digest"],
                    canonical_json(
                        {
                            "decision_scope": decision_scope,
                            "source": source,
                            "rule_id": rule_id,
                        }
                    ),
                    timestamp,
                ),
            )
            if can_continue and not remains_waiting and step_id:
                self._append_step_transition_in_transaction(
                    connection,
                    run_id=str(approval["run_id"]),
                    step_id=step_id,
                    event="resumed",
                    status="running",
                    allowed_previous={"blocked", "interrupted"},
                    attempt_id=(
                        str(approval["attempt_id"])
                        if approval["attempt_id"]
                        else None
                    ),
                    reason_code="approval_decided",
                    provenance_source="human_interaction",
                )
            self._append_event_in_transaction(
                connection,
                approval["run_id"],
                RunEventDraft(
                    event_id=f"approval:{approval_id}:decision:{expected_version + 1}",
                    event_type="approval.decided",
                    payload={
                        "approval_id": approval_id,
                        "interaction_id": approval_id,
                        "decision_request_id": resolved_request_id,
                        "action_digest": approval["action_digest"],
                        "decision_scope": approval["decision_scope"],
                        "resolved_decision_scope": decision_scope,
                        "actor_type": actor_type,
                        "actor_id": actor_id,
                        "source": source,
                        "step_id": step_id,
                        "continued_attempt": can_continue,
                        "remaining_interaction_count": (
                            remaining_interaction_count
                        ),
                        **decision_value,
                    },
                    created_at=timestamp,
                ),
                run_status=(
                    "waiting_for_user"
                    if remains_waiting
                    else "running"
                    if can_continue
                    else "interrupted"
                ),
                active_attempt_id=(
                    approval["attempt_id"]
                    if can_continue or remains_waiting
                    else None
                ),
                clear_active_attempt=not can_continue and not remains_waiting,
            )
            row = connection.execute(
                "SELECT * FROM approvals WHERE approval_id = ?", (approval_id,)
            ).fetchone()
            assert row is not None
            resolved = self._approval_from_row(row)
        self._trusted_approval_decisions.add(
            (resolved.approval_id, resolved.version, resolved.action_digest)
        )
        if decision == "approved" and decision_scope in {"run", "space"}:
            assert rule_id is not None
            self._trusted_approval_rules.add(rule_id)
        return resolved

    def list_approvals(
        self, run_id: str, *, pending_only: bool = False
    ) -> list[ApprovalRecord]:
        query = "SELECT * FROM approvals WHERE run_id = ?"
        if pending_only:
            query += " AND status = 'pending'"
        query += " ORDER BY created_at"
        with self._lock:
            rows = self._connection.execute(query, (run_id,)).fetchall()
            return [self._approval_from_row(row) for row in rows]

    def record_timeout_outcome(
        self, outcome: TimeoutOutcome
    ) -> CommittedRunEvent:
        if outcome.scope in {
            TimeoutScope.TRANSPORT_IDLE,
            TimeoutScope.REMOTE_COMMAND_TTL,
            TimeoutScope.CLOUD_SYNC,
        }:
            raise ValueError(
                f"{outcome.scope.value} is not owned by RunJournal"
            )
        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (outcome.run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(
                    f"run_id {outcome.run_id!r} does not exist"
                )
            event_type = {
                TimeoutScope.RUNTIME_LIVENESS: "runtime.interrupted",
                TimeoutScope.ACTIVITY: "activity.timed_out",
                TimeoutScope.TOOL: "tool.timed_out",
                TimeoutScope.RUN_DEADLINE: "run.deadline_reached",
                TimeoutScope.APPROVAL_EXPIRY: "approval.expired",
            }[outcome.scope]
            run_status: str | None = None
            clear_attempt = False
            if outcome.scope is TimeoutScope.RUNTIME_LIVENESS:
                run_status = "interrupted"
                clear_attempt = True
            elif outcome.scope is TimeoutScope.RUN_DEADLINE:
                if run["deadline_at"] is None or outcome.ended_at < float(
                    run["deadline_at"]
                ):
                    raise InvalidRunTransitionError(
                        "run deadline outcome does not match a reached persisted deadline"
                    )
                run_status = "failed"
                clear_attempt = True
            elif outcome.scope is TimeoutScope.TOOL:
                tool = connection.execute(
                    "SELECT * FROM tool_calls WHERE tool_call_id = ?",
                    (outcome.tool_call_id,),
                ).fetchone()
                if tool is None:
                    raise RunNotFoundError(
                        f"tool_call_id {outcome.tool_call_id!r} does not exist"
                    )
                if tool["run_id"] != outcome.run_id:
                    raise InvalidRunTransitionError(
                        f"tool call {outcome.tool_call_id!r} belongs to run "
                        f"{tool['run_id']!r}, not {outcome.run_id!r}"
                    )
                if tool["status"] in {"completed", "failed"}:
                    raise InvalidRunTransitionError(
                        f"tool call {outcome.tool_call_id!r} is already {tool['status']}"
                    )
                if tool["status"] not in {
                    "dispatched",
                    "timed_out",
                    "outcome_unknown",
                }:
                    raise InvalidRunTransitionError(
                        f"tool call {outcome.tool_call_id!r} cannot time out from "
                        f"{tool['status']!r}"
                    )
                replayable = not self._tool_call_requires_fail_closed(tool)
                tool_status = "timed_out" if replayable else "outcome_unknown"
                event_type = (
                    "tool.timed_out" if replayable else "tool.outcome_unknown"
                )
                connection.execute(
                    """
                    UPDATE tool_calls
                    SET status = ?, outcome = ?, timeout_reason = ?, updated_at = ?
                    WHERE tool_call_id = ?
                    """,
                    (
                        tool_status,
                        "retry_allowed" if replayable else "outcome_unknown",
                        outcome.reason,
                        outcome.ended_at,
                        outcome.tool_call_id,
                    ),
                )
            elif outcome.scope is TimeoutScope.APPROVAL_EXPIRY:
                approval = connection.execute(
                    "SELECT * FROM approvals WHERE approval_id = ?",
                    (outcome.approval_id,),
                ).fetchone()
                if approval is None:
                    raise RunNotFoundError(
                        f"approval_id {outcome.approval_id!r} does not exist"
                    )
                approval_run_id = approval["run_id"]
                if approval_run_id != outcome.run_id:
                    raise InvalidRunTransitionError(
                        f"approval {outcome.approval_id!r} belongs to run "
                        f"{approval_run_id!r}, not {outcome.run_id!r}"
                    )
                if approval["status"] != "pending":
                    raise InvalidRunTransitionError(
                        f"approval {outcome.approval_id!r} is already resolved"
                    )
                if approval["expiry_action"] == "reject":
                    event_type = "approval.expired_rejected"
                    decision_json = json.dumps(
                        {
                            "decision": "rejected",
                            "reason": "approval_expired",
                        },
                        separators=(",", ":"),
                        sort_keys=True,
                    )
                    connection.execute(
                        """
                        UPDATE approvals
                        SET status = 'rejected', decision_json = ?,
                            resolved_at = ?, version = version + 1
                        WHERE approval_id = ? AND status = 'pending'
                        """,
                        (
                            decision_json,
                            outcome.ended_at,
                            outcome.approval_id,
                        ),
                    )
                    connection.execute(
                        """
                        UPDATE human_interactions
                        SET status = 'expired', resolved_at = ?, updated_at = ?,
                            version = version + 1
                        WHERE interaction_id = ?
                          AND status IN ('requested', 'presented')
                        """,
                        (
                            outcome.ended_at,
                            outcome.ended_at,
                            outcome.approval_id,
                        ),
                    )
                    connection.execute(
                        """
                        INSERT OR IGNORE INTO human_interaction_decisions(
                            decision_id, interaction_id, decision_request_id,
                            decision_json, actor_type, actor_id, source,
                            action_digest, created_at
                        ) VALUES (?, ?, ?, ?, 'system', NULL, 'expiry', ?, ?)
                        """,
                        (
                            str(uuid.uuid4()),
                            outcome.approval_id,
                            f"expiry:{outcome.approval_id}",
                            decision_json,
                            approval["action_digest"],
                            outcome.ended_at,
                        ),
                    )
                    run_status = "interrupted"
                    clear_attempt = True
                else:
                    event_type = "approval.expiry_observed"
            if clear_attempt:
                connection.execute(
                    """
                    UPDATE run_attempts
                    SET status = ?, ended_at = COALESCE(ended_at, ?),
                        timeout_reason = ?, outcome = ?
                    WHERE run_id = ? AND status IN ('pending', 'running', 'waiting_for_user')
                    """,
                    (
                        "timed_out"
                        if outcome.scope is TimeoutScope.RUN_DEADLINE
                        else "interrupted",
                        outcome.ended_at,
                        outcome.reason,
                        event_type,
                        outcome.run_id,
                    ),
                )
            identity = {
                TimeoutScope.RUNTIME_LIVENESS: outcome.attempt_id,
                TimeoutScope.ACTIVITY: outcome.activity_id,
                TimeoutScope.TOOL: outcome.tool_call_id,
                TimeoutScope.RUN_DEADLINE: outcome.run_id,
                TimeoutScope.APPROVAL_EXPIRY: outcome.approval_id,
            }[outcome.scope]
            return self._append_event_in_transaction(
                connection,
                outcome.run_id,
                RunEventDraft(
                    event_id=(
                        f"timeout:{outcome.scope.value}:{outcome.run_id}:"
                        f"{identity or outcome.ended_at}:{outcome.policy_version}"
                    ),
                    event_type=event_type,
                    payload=outcome.to_payload(),
                    created_at=outcome.ended_at,
                ),
                run_status=run_status,
                clear_active_attempt=clear_attempt,
            )

    def reconcile_startup(
        self, *, now: float | None = None
    ) -> StartupReconciliationResult:
        timestamp = now if now is not None else time.time()
        interrupted_runs: list[str] = []
        completed_cancels: list[str] = []
        deadline_runs: list[str] = []
        detached_attempts: list[str] = []
        unknown_tools: list[str] = []
        unknown_model_invocations: list[str] = []
        with self._write_transaction() as connection:
            # Older terminal paths could leave a question or approval open.
            # Repair those rows before normal startup reconciliation so a
            # failed/completed Run never keeps rendering actionable input.
            terminal_interaction_runs = connection.execute(
                """
                SELECT DISTINCT runs.run_id, runs.status
                FROM runs
                JOIN human_interactions
                  ON human_interactions.run_id = runs.run_id
                WHERE runs.status IN ('completed', 'failed', 'cancelled')
                  AND human_interactions.status IN ('requested', 'presented')
                ORDER BY runs.created_at, runs.run_id
                """
            ).fetchall()
            for terminal_run in terminal_interaction_runs:
                self._cancel_open_human_interactions_in_transaction(
                    connection,
                    run_id=terminal_run["run_id"],
                    timestamp=timestamp,
                    reason=f"terminal_run_recovery:{terminal_run['status']}",
                )

            # A provider call is already across its dispatch boundary.  If the
            # Brain exited before committing its response, the model outcome
            # cannot be inferred from the interrupted Run.  Close it
            # explicitly so training/replay consumers never mistake a stale
            # `dispatched` row for a response that can still arrive.
            pending_model_invocations = connection.execute(
                """
                SELECT * FROM model_invocations
                WHERE status = 'dispatched'
                ORDER BY started_at, invocation_id
                """
            ).fetchall()
            for invocation in pending_model_invocations:
                try:
                    with self._savepoint(
                        connection, "startup_model_invocation"
                    ):
                        updated = connection.execute(
                            """
                            UPDATE model_invocations
                            SET status = 'outcome_unknown',
                                error_code = 'brain_restart_after_dispatch',
                                error_message = ?, completed_at = ?
                            WHERE invocation_id = ? AND status = 'dispatched'
                            """,
                            (
                                "Brain restarted after model dispatch and "
                                "before the response was durably recorded",
                                timestamp,
                                invocation["invocation_id"],
                            ),
                        )
                        if updated.rowcount != 1:
                            continue
                        payload = {
                            "invocation_id": invocation["invocation_id"],
                            "attempt_id": invocation["attempt_id"],
                            "step_id": invocation["step_id"],
                            "agent_id": invocation["agent_id"],
                            "status": "outcome_unknown",
                            "request_digest": invocation["request_digest"],
                            "response_digest": None,
                            "finish_reason": None,
                            "usage": {
                                "prompt_tokens": None,
                                "completion_tokens": None,
                                "cache_read_tokens": None,
                                "cache_write_tokens": None,
                            },
                            "error_code": "brain_restart_after_dispatch",
                        }
                        self._insert_model_invocation_event(
                            connection,
                            invocation_id=invocation["invocation_id"],
                            event_type="outcome_unknown",
                            payload=payload,
                            created_at=timestamp,
                        )
                        self._append_event_in_transaction(
                            connection,
                            invocation["run_id"],
                            RunEventDraft(
                                event_id=(
                                    "startup:model-invocation-outcome-unknown:"
                                    f"{invocation['invocation_id']}"
                                ),
                                event_type="model.invocation.outcome_unknown",
                                payload=payload,
                                created_at=timestamp,
                            ),
                        )
                        self._record_model_capture_outcome_gap_in_transaction(
                            connection,
                            invocation=invocation,
                            detail_code="brain_restart_after_dispatch",
                            suffix="startup-reconciliation",
                            timestamp=timestamp,
                        )
                except Exception:
                    logger.exception(
                        "Startup reconciliation skipped one model invocation",
                        extra={"invocation_id": invocation["invocation_id"]},
                    )
                    continue
                unknown_model_invocations.append(invocation["invocation_id"])
            # A prepared ToolCall has not crossed the dispatch boundary.  It
            # therefore has a known, side-effect-free outcome after a process
            # restart and must not remain as a permanent Project-wide blocker.
            # Resolve its paired approval in the same transaction before the
            # owning Run is interrupted below.
            prepared_tools = connection.execute(
                """
                SELECT * FROM tool_calls
                WHERE status = 'prepared' AND outcome IS NULL
                ORDER BY created_at, tool_call_id
                """
            ).fetchall()
            for tool in prepared_tools:
                try:
                    with self._savepoint(connection, "startup_prepared_tool"):
                        tool_step_id = self._tool_step_id_in_transaction(
                            connection,
                            run_id=str(tool["run_id"]),
                            tool_call_id=str(tool["tool_call_id"]),
                        )
                        updated = connection.execute(
                            """
                            UPDATE tool_calls
                            SET status = 'failed',
                                outcome = 'failed_before_dispatch',
                                updated_at = ?
                            WHERE tool_call_id = ?
                              AND status = 'prepared' AND outcome IS NULL
                            """,
                            (timestamp, tool["tool_call_id"]),
                        )
                        if updated.rowcount != 1:
                            continue
                        terminal_tool = connection.execute(
                            "SELECT * FROM tool_calls WHERE tool_call_id = ?",
                            (tool["tool_call_id"],),
                        ).fetchone()
                        assert terminal_tool is not None
                        self._cancel_orphaned_tool_approval_in_transaction(
                            connection,
                            tool=terminal_tool,
                            timestamp=timestamp,
                            source="recovery",
                            reason="brain_restart_before_dispatch",
                        )
                        self._append_event_in_transaction(
                            connection,
                            tool["run_id"],
                            RunEventDraft(
                                event_id=(
                                    "startup:tool-failed-before-dispatch:"
                                    f"{tool['tool_call_id']}"
                                ),
                                event_type="tool.failed",
                                payload={
                                    "tool_call_id": tool["tool_call_id"],
                                    "safety_class": tool["safety_class"],
                                    "reason": "brain_restart_before_dispatch",
                                    "outcome_known": True,
                                    "step_id": tool_step_id,
                                },
                                created_at=timestamp,
                            ),
                        )
                        if (
                            str(tool["tool_name"])
                            .strip()
                            .lower()
                            .replace("-", "_")
                            == "agent_run_subagent"
                            and tool_step_id
                        ):
                            self._append_step_transition_in_transaction(
                                connection,
                                run_id=str(tool["run_id"]),
                                step_id=tool_step_id,
                                event="cancelled",
                                status="cancelled",
                                allowed_previous={
                                    "pending",
                                    "running",
                                    "blocked",
                                    "interrupted",
                                },
                                attempt_id=(
                                    str(tool["attempt_id"])
                                    if tool["attempt_id"]
                                    else None
                                ),
                                reason_code="brain_restart_before_dispatch",
                                provenance_source="startup_reconciliation",
                            )
                except Exception:
                    logger.exception(
                        "Startup reconciliation skipped one prepared ToolCall",
                        extra={"tool_call_id": tool["tool_call_id"]},
                    )
                    continue
            self._cancel_orphaned_tool_approvals_in_transaction(
                connection,
                run_id=None,
                timestamp=timestamp,
                source="recovery",
            )
            self._backfill_cancelled_approval_events_in_transaction(
                connection,
                timestamp=timestamp,
            )
            self._repair_restart_interrupted_internal_controls_in_transaction(
                connection,
                run_id=None,
                timestamp=timestamp,
                source="startup_reconciliation",
                include_dispatched=True,
            )
            runs = connection.execute(
                """
                SELECT * FROM runs
                WHERE status IN ('pending', 'running', 'waiting_for_user')
                   OR (status = 'interrupted' AND cancel_request_id IS NOT NULL)
                ORDER BY created_at
                """
            ).fetchall()
            for run in runs:
                run_interrupted = False
                run_cancelled = False
                run_deadline = False
                run_attempt_ids: list[str] = []
                try:
                    with self._savepoint(connection, "startup_run"):
                        active_attempts = connection.execute(
                            """
                            SELECT * FROM run_attempts
                            WHERE run_id = ?
                              AND status IN ('pending', 'running', 'waiting_for_user')
                            """,
                            (run["run_id"],),
                        ).fetchall()
                        pending_interaction = connection.execute(
                            """
                            SELECT 1
                            FROM human_interactions
                            WHERE run_id = ?
                              AND status IN ('requested', 'presented')
                            LIMIT 1
                            """,
                            (run["run_id"],),
                        ).fetchone()
                        if run["cancel_request_id"] is not None:
                            target_status = "cancelled"
                            event_type = "run.cancelled"
                            run_cancelled = True
                        elif (
                            run["deadline_at"] is not None
                            and float(run["deadline_at"]) <= timestamp
                        ):
                            target_status = "failed"
                            event_type = "run.deadline_reached"
                            run_deadline = True
                        elif (
                            run["status"] == "waiting_for_user"
                            and not active_attempts
                            and pending_interaction is not None
                        ):
                            continue
                        else:
                            target_status = (
                                "waiting_for_user"
                                if run["status"] == "waiting_for_user"
                                and pending_interaction is not None
                                else "interrupted"
                            )
                            event_type = "runtime.interrupted"
                            run_interrupted = True
                        run_attempt_ids = [
                            attempt["attempt_id"]
                            for attempt in active_attempts
                        ]
                        connection.execute(
                            """
                            UPDATE run_attempts
                            SET status = ?, ended_at = COALESCE(
                                    ended_at,
                                    last_consumer_heartbeat_at,
                                    started_at,
                                    ?
                                ),
                                outcome = COALESCE(outcome, ?)
                            WHERE run_id = ?
                              AND status IN ('pending', 'running', 'waiting_for_user')
                            """,
                            (
                                "cancelled"
                                if target_status == "cancelled"
                                else (
                                    "timed_out"
                                    if event_type == "run.deadline_reached"
                                    else "interrupted"
                                ),
                                timestamp,
                                event_type,
                                run["run_id"],
                            ),
                        )
                        self._append_event_in_transaction(
                            connection,
                            run["run_id"],
                            RunEventDraft(
                                event_id=(
                                    f"startup:{event_type}:{run['run_id']}:"
                                    f"{run['version']}"
                                ),
                                event_type=event_type,
                                payload={
                                    "previous_status": run["status"],
                                    "reason": "brain_restart",
                                    "policy_version": run[
                                        "timeout_policy_version"
                                    ],
                                },
                                created_at=timestamp,
                            ),
                            run_status=target_status,
                            clear_active_attempt=True,
                        )
                except Exception:
                    logger.exception(
                        "Startup reconciliation skipped one Run",
                        extra={"run_id": run["run_id"]},
                    )
                    continue
                detached_attempts.extend(run_attempt_ids)
                if run_interrupted:
                    interrupted_runs.append(run["run_id"])
                if run_cancelled:
                    completed_cancels.append(run["run_id"])
                if run_deadline:
                    deadline_runs.append(run["run_id"])
            tool_rows = connection.execute(
                """
                SELECT * FROM tool_calls
                WHERE status = 'dispatched' AND outcome IS NULL
                """
            ).fetchall()
            for tool in tool_rows:
                try:
                    with self._savepoint(connection, "startup_tool"):
                        replayable = not self._tool_call_requires_fail_closed(
                            tool
                        )
                        tool_status = (
                            "timed_out" if replayable else "outcome_unknown"
                        )
                        tool_outcome = (
                            "retry_allowed"
                            if replayable
                            else "outcome_unknown"
                        )
                        event_type = (
                            "tool.timed_out"
                            if replayable
                            else "tool.outcome_unknown"
                        )
                        connection.execute(
                            """
                            UPDATE tool_calls
                            SET status = ?, outcome = ?, timeout_reason = ?,
                                updated_at = ?
                            WHERE tool_call_id = ? AND status = 'dispatched'
                            """,
                            (
                                tool_status,
                                tool_outcome,
                                "brain_restart_after_dispatch",
                                timestamp,
                                tool["tool_call_id"],
                            ),
                        )
                        self._append_event_in_transaction(
                            connection,
                            tool["run_id"],
                            RunEventDraft(
                                event_id=(
                                    f"startup:{event_type}:"
                                    f"{tool['tool_call_id']}"
                                ),
                                event_type=event_type,
                                payload={
                                    "tool_call_id": tool["tool_call_id"],
                                    "safety_class": tool["safety_class"],
                                    "reason": "brain_restart_after_dispatch",
                                    "outcome": tool_outcome,
                                },
                                created_at=timestamp,
                            ),
                        )
                except Exception:
                    logger.exception(
                        "Startup reconciliation skipped one ToolCall",
                        extra={"tool_call_id": tool["tool_call_id"]},
                    )
                    continue
                if not replayable:
                    unknown_tools.append(tool["tool_call_id"])
            expired_approvals = connection.execute(
                """
                SELECT approvals.*, runs.status AS run_status
                FROM approvals
                JOIN runs ON runs.run_id = approvals.run_id
                WHERE approvals.status = 'pending'
                  AND approvals.expiry_action = 'reject'
                  AND approvals.expires_at IS NOT NULL
                  AND approvals.expires_at <= ?
                ORDER BY approvals.expires_at, approvals.approval_id
                """,
                (timestamp,),
            ).fetchall()
            for approval in expired_approvals:
                if approval["run_status"] in {
                    "completed",
                    "failed",
                    "cancelled",
                }:
                    continue
                try:
                    with self._savepoint(connection, "startup_approval"):
                        decision_json = json.dumps(
                            {
                                "decision": "rejected",
                                "reason": "approval_expired",
                            },
                            separators=(",", ":"),
                            sort_keys=True,
                        )
                        connection.execute(
                            """
                            UPDATE approvals
                            SET status = 'rejected', decision_json = ?,
                                resolved_at = ?, version = version + 1
                            WHERE approval_id = ? AND status = 'pending'
                            """,
                            (
                                decision_json,
                                timestamp,
                                approval["approval_id"],
                            ),
                        )
                        connection.execute(
                            """
                            UPDATE human_interactions
                            SET status = 'expired', resolved_at = ?,
                                updated_at = ?, version = version + 1
                            WHERE interaction_id = ?
                              AND status IN ('requested', 'presented')
                            """,
                            (
                                timestamp,
                                timestamp,
                                approval["approval_id"],
                            ),
                        )
                        connection.execute(
                            """
                            INSERT OR IGNORE INTO human_interaction_decisions(
                                decision_id, interaction_id,
                                decision_request_id, decision_json,
                                actor_type, actor_id, source, action_digest,
                                created_at
                            ) VALUES (?, ?, ?, ?, 'system', NULL, 'expiry', ?, ?)
                            """,
                            (
                                str(uuid.uuid4()),
                                approval["approval_id"],
                                f"expiry:{approval['approval_id']}",
                                decision_json,
                                approval["action_digest"],
                                timestamp,
                            ),
                        )
                        connection.execute(
                            """
                            UPDATE run_attempts
                            SET status = 'interrupted',
                                ended_at = COALESCE(ended_at, ?),
                                outcome = 'approval_expired'
                            WHERE attempt_id = ?
                              AND status = 'waiting_for_user'
                            """,
                            (timestamp, approval["attempt_id"]),
                        )
                        self._append_event_in_transaction(
                            connection,
                            approval["run_id"],
                            RunEventDraft(
                                event_id=(
                                    f"approval:{approval['approval_id']}:expired"
                                ),
                                event_type="approval.expired_rejected",
                                payload={
                                    "approval_id": approval["approval_id"],
                                    "expiry_action": "reject",
                                    "reason": "approval_expired",
                                },
                                created_at=timestamp,
                            ),
                            run_status="interrupted",
                            clear_active_attempt=True,
                        )
                except Exception:
                    logger.exception(
                        "Startup reconciliation skipped one Approval",
                        extra={"approval_id": approval["approval_id"]},
                    )
            expired_interactions = connection.execute(
                """
                SELECT human_interactions.*, runs.status AS run_status
                FROM human_interactions
                JOIN runs ON runs.run_id = human_interactions.run_id
                WHERE human_interactions.interaction_type != 'approval'
                  AND human_interactions.status IN ('requested', 'presented')
                  AND human_interactions.expires_at IS NOT NULL
                  AND human_interactions.expires_at <= ?
                ORDER BY human_interactions.expires_at,
                         human_interactions.interaction_id
                """,
                (timestamp,),
            ).fetchall()
            for interaction in expired_interactions:
                if interaction["run_status"] in {
                    "completed",
                    "failed",
                    "cancelled",
                }:
                    continue
                try:
                    with self._savepoint(connection, "startup_interaction"):
                        connection.execute(
                            """
                            UPDATE human_interactions
                            SET status = 'expired', resolved_at = ?,
                                updated_at = ?, version = version + 1
                            WHERE interaction_id = ?
                              AND status IN ('requested', 'presented')
                            """,
                            (
                                timestamp,
                                timestamp,
                                interaction["interaction_id"],
                            ),
                        )
                        connection.execute(
                            """
                            UPDATE run_attempts
                            SET status = 'interrupted',
                                ended_at = COALESCE(ended_at, ?),
                                outcome = 'human_interaction_expired'
                            WHERE attempt_id = ?
                              AND status = 'waiting_for_user'
                            """,
                            (timestamp, interaction["attempt_id"]),
                        )
                        self._append_event_in_transaction(
                            connection,
                            interaction["run_id"],
                            RunEventDraft(
                                event_id=(
                                    "interaction:"
                                    f"{interaction['interaction_id']}:expired"
                                ),
                                event_type="interaction.expired",
                                payload={
                                    "interaction_id": interaction[
                                        "interaction_id"
                                    ],
                                    "interaction_type": interaction[
                                        "interaction_type"
                                    ],
                                },
                                created_at=timestamp,
                            ),
                            run_status="interrupted",
                            clear_active_attempt=True,
                        )
                except Exception:
                    logger.exception(
                        "Startup reconciliation skipped one HumanInteraction",
                        extra={
                            "interaction_id": interaction["interaction_id"]
                        },
                    )
            approvals = connection.execute(
                "SELECT approval_id FROM approvals WHERE status = 'pending' ORDER BY created_at"
            ).fetchall()
            commands = connection.execute(
                """
                SELECT command_id FROM remote_command_inbox
                WHERE state IN ('received', 'dispatched', 'accepted')
                ORDER BY updated_at
                """
            ).fetchall()
            bundle_installs = connection.execute(
                """
                SELECT proposal_id FROM workspace_bundle_install_proposals
                WHERE state = 'materializing'
                ORDER BY updated_at, proposal_id
                """
            ).fetchall()
            connection.execute(
                """
                UPDATE workspace_bundle_install_proposals
                SET state = 'needs_attention', version = version + 1,
                    error_code = 'desktop_restarted_during_materialization',
                    updated_at = ?
                WHERE state = 'materializing'
                """,
                (timestamp,),
            )
        try:
            retention = self.expire_model_invocation_documents(
                now=timestamp,
                limit=100,
            )
        except Exception:
            # Retention maintenance cannot make the Desktop unavailable. The
            # immutable policy query is level-triggered and will retry on the
            # next startup.
            logger.exception(
                "Startup model-document retention maintenance failed"
            )
        else:
            if retention.remaining_candidate_count:
                logger.warning(
                    "Model-document retention batch left %s candidate(s); "
                    "expired=%s skipped=%s",
                    retention.remaining_candidate_count,
                    len(retention.expired_invocation_ids),
                    len(retention.skipped_invocation_ids),
                )
            elif (
                retention.expired_invocation_ids
                or retention.skipped_invocation_ids
            ):
                logger.info(
                    "Model-document retention batch completed; "
                    "expired=%s skipped=%s remaining=0",
                    len(retention.expired_invocation_ids),
                    len(retention.skipped_invocation_ids),
                )

        return StartupReconciliationResult(
            interrupted_run_ids=tuple(interrupted_runs),
            completed_cancel_run_ids=tuple(completed_cancels),
            deadline_run_ids=tuple(deadline_runs),
            detached_attempt_ids=tuple(detached_attempts),
            outcome_unknown_tool_call_ids=tuple(unknown_tools),
            pending_approval_ids=tuple(
                row["approval_id"] for row in approvals
            ),
            reconcilable_command_ids=tuple(
                row["command_id"] for row in commands
            ),
            reconcilable_bundle_install_ids=tuple(
                row["proposal_id"] for row in bundle_installs
            ),
            outcome_unknown_model_invocation_ids=tuple(
                unknown_model_invocations
            ),
        )

    def persist_remote_command(
        self,
        *,
        command_id: str,
        session_id: str,
        user_id: int,
        project_id: str,
        run_id: str | None,
        route_version: int,
        command_type: str,
        payload: dict[str, Any],
        expires_at: float,
        receipt_grace_until: float,
        requires_online_receipt_confirmation: bool,
        delivery_lease_token: str | None = None,
        receipt_event_id: str | None = None,
        now: float | None = None,
    ) -> RemoteCommandInboxRecord:
        """Commit the Inbox row and receipt event/outbox in one transaction."""

        if route_version < 1:
            raise ValueError("route_version must be positive")
        if receipt_grace_until < expires_at:
            raise ValueError("receipt grace must not precede expiry")
        timestamp = now if now is not None else time.time()
        receipt_id = receipt_event_id or str(uuid.uuid4())
        payload_json = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        with self._write_transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            if existing is not None:
                canonical = (
                    existing["session_id"] == session_id
                    and int(existing["user_id"]) == user_id
                    and existing["project_id"] == project_id
                    and existing["run_id"] == run_id
                    and int(existing["route_version"]) == route_version
                    and existing["command_type"] == command_type
                    and existing["payload_json"] == payload_json
                    and float(existing["expires_at"]) == expires_at
                    and float(existing["receipt_grace_until"])
                    == receipt_grace_until
                    and bool(existing["requires_online_receipt_confirmation"])
                    == requires_online_receipt_confirmation
                )
                if not canonical:
                    raise IdempotencyConflictError(
                        f"command_id {command_id!r} was reused with different data"
                    )
                if (
                    delivery_lease_token
                    and existing["receipt_status"] == "pending"
                    and existing["delivery_lease_token"]
                    != delivery_lease_token
                ):
                    connection.execute(
                        """
                        UPDATE remote_command_inbox
                        SET delivery_lease_token = ?, updated_at = ?
                        WHERE command_id = ? AND receipt_status = 'pending'
                        """,
                        (delivery_lease_token, timestamp, command_id),
                    )
                    existing = connection.execute(
                        "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                        (command_id,),
                    ).fetchone()
                return self._command_from_row(existing)

            connection.execute(
                """
                INSERT INTO remote_command_inbox(
                    command_id, session_id, user_id, project_id, run_id,
                    route_version, command_type, payload_json, expires_at,
                    receipt_grace_until,
                    requires_online_receipt_confirmation, receipt_event_id,
                    delivery_lease_token,
                    receipt_status, state, dispatch_attempt_count, last_error,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                          'pending', 'received', 0, NULL, ?, ?)
                """,
                (
                    command_id,
                    session_id,
                    user_id,
                    project_id,
                    run_id,
                    route_version,
                    command_type,
                    payload_json,
                    expires_at,
                    receipt_grace_until,
                    int(requires_online_receipt_confirmation),
                    receipt_id,
                    delivery_lease_token,
                    timestamp,
                    timestamp,
                ),
            )
            receipt_payload = "{}"
            connection.execute(
                """
                INSERT INTO command_result_events(
                    event_id, command_id, command_event_sequence, event_type,
                    payload_json, occurred_at
                ) VALUES (?, ?, 1, 'receipt.durably_received', ?, ?)
                """,
                (receipt_id, command_id, receipt_payload, timestamp),
            )
            connection.execute(
                """
                INSERT INTO command_result_outbox(
                    event_id, command_id, command_event_sequence, status,
                    attempt_count, next_attempt_at, lease_token, lease_until,
                    last_error, created_at, updated_at
                ) VALUES (?, ?, 1, 'pending', 0, ?, NULL, NULL, NULL, ?, ?)
                """,
                (receipt_id, command_id, timestamp, timestamp, timestamp),
            )
            row = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            assert row is not None
            return self._command_from_row(row)

    def get_remote_command(
        self, command_id: str
    ) -> RemoteCommandInboxRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            return self._command_from_row(row) if row is not None else None

    def get_latest_command_execution_result(
        self, command_id: str
    ) -> CommandResultEvent | None:
        """Return the durable terminal execution result used for ACK replay."""

        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM command_result_events
                WHERE command_id = ?
                  AND event_type IN ('execution.completed', 'execution.failed')
                ORDER BY command_event_sequence DESC
                LIMIT 1
                """,
                (command_id,),
            ).fetchone()
            return (
                self._command_event_from_row(row) if row is not None else None
            )

    def list_reconcilable_commands(
        self, *, limit: int = 100
    ) -> list[RemoteCommandInboxRecord]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM remote_command_inbox
                WHERE state IN ('received', 'dispatched', 'accepted')
                ORDER BY updated_at, command_id
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [self._command_from_row(row) for row in rows]

    def mark_command_dispatched(
        self, command_id: str, *, now: float | None = None
    ) -> RemoteCommandInboxRecord:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE remote_command_inbox
                SET state = 'dispatched',
                    dispatch_attempt_count = dispatch_attempt_count + 1,
                    updated_at = ?
                WHERE command_id = ? AND state IN ('received', 'dispatched')
                """,
                (timestamp, command_id),
            )
            if updated.rowcount != 1:
                row = connection.execute(
                    "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                    (command_id,),
                ).fetchone()
                if row is None:
                    raise RunNotFoundError(
                        f"command_id {command_id!r} does not exist"
                    )
                return self._command_from_row(row)
            row = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            assert row is not None
            return self._command_from_row(row)

    def set_command_receipt_status(
        self,
        command_id: str,
        status: str,
        *,
        error: str | None = None,
        now: float | None = None,
    ) -> RemoteCommandInboxRecord:
        if status not in {"confirmed", "expired_late"}:
            raise ValueError("invalid command receipt status")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            updated = connection.execute(
                """
                UPDATE remote_command_inbox
                SET receipt_status = ?, last_error = ?, updated_at = ?
                WHERE command_id = ?
                """,
                (status, error, timestamp, command_id),
            )
            if updated.rowcount != 1:
                raise RunNotFoundError(
                    f"command_id {command_id!r} does not exist"
                )
            row = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            assert row is not None
            return self._command_from_row(row)

    def append_command_result(
        self,
        command_id: str,
        *,
        event_type: str,
        payload: dict[str, Any] | None = None,
        event_id: str | None = None,
        occurred_at: float | None = None,
    ) -> CommandResultEvent:
        state_by_event = {
            "admission.accepted": "accepted",
            "admission.rejected": "rejected",
            "execution.completed": "completed",
            "execution.failed": "failed",
        }
        if (
            event_type not in state_by_event
            and event_type != "execution.started"
        ):
            raise ValueError("unsupported command result event type")
        timestamp = occurred_at if occurred_at is not None else time.time()
        result_event_id = event_id or str(uuid.uuid4())
        payload_value = payload or {}
        payload_json = json.dumps(
            payload_value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        with self._write_transaction() as connection:
            duplicate = connection.execute(
                "SELECT * FROM command_result_events WHERE event_id = ?",
                (result_event_id,),
            ).fetchone()
            if duplicate is not None:
                if (
                    duplicate["command_id"] != command_id
                    or duplicate["event_type"] != event_type
                    or duplicate["payload_json"] != payload_json
                ):
                    raise IdempotencyConflictError(
                        f"command event {result_event_id!r} was reused"
                    )
                return self._command_event_from_row(duplicate)
            inbox = connection.execute(
                "SELECT * FROM remote_command_inbox WHERE command_id = ?",
                (command_id,),
            ).fetchone()
            if inbox is None:
                raise RunNotFoundError(
                    f"command_id {command_id!r} does not exist"
                )
            next_state = state_by_event.get(event_type)
            if next_state is not None and not transition_allowed(
                COMMAND_TRANSITIONS,
                str(inbox["state"]),
                next_state,
            ):
                raise InvalidRunTransitionError(
                    f"command {command_id!r} cannot move from "
                    f"{inbox['state']!r} to {next_state!r}"
                )
            if (
                event_type == "execution.started"
                and inbox["state"] != "accepted"
            ):
                raise InvalidRunTransitionError(
                    f"command {command_id!r} cannot start execution from "
                    f"{inbox['state']!r}"
                )
            sequence = int(
                connection.execute(
                    """
                    SELECT COALESCE(MAX(command_event_sequence), 0) + 1
                    FROM command_result_events WHERE command_id = ?
                    """,
                    (command_id,),
                ).fetchone()[0]
            )
            connection.execute(
                """
                INSERT INTO command_result_events(
                    event_id, command_id, command_event_sequence, event_type,
                    payload_json, occurred_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    result_event_id,
                    command_id,
                    sequence,
                    event_type,
                    payload_json,
                    timestamp,
                ),
            )
            connection.execute(
                """
                INSERT INTO command_result_outbox(
                    event_id, command_id, command_event_sequence, status,
                    attempt_count, next_attempt_at, lease_token, lease_until,
                    last_error, created_at, updated_at
                ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?)
                """,
                (
                    result_event_id,
                    command_id,
                    sequence,
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )
            if next_state is not None:
                connection.execute(
                    """
                    UPDATE remote_command_inbox
                    SET state = ?, last_error = ?, updated_at = ?
                    WHERE command_id = ?
                    """,
                    (
                        next_state,
                        payload_value.get("error"),
                        timestamp,
                        command_id,
                    ),
                )
            return CommandResultEvent(
                event_id=result_event_id,
                command_id=command_id,
                command_event_sequence=sequence,
                event_type=event_type,
                payload=payload_value,
                occurred_at=timestamp,
            )

    def claim_command_result_batches(
        self,
        *,
        now: float | None = None,
        max_commands: int = 8,
        batch_size: int = 100,
        lease_seconds: float = 30.0,
    ) -> list[CommandResultSyncBatch]:
        if max_commands < 1 or batch_size < 1 or lease_seconds <= 0:
            raise ValueError("command outbox claim limits must be positive")
        timestamp = now if now is not None else time.time()
        batches: list[CommandResultSyncBatch] = []
        with self._write_transaction() as connection:
            connection.execute(
                """
                UPDATE command_result_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE status = 'sending'
                  AND (lease_until IS NULL OR lease_until <= ?)
                """,
                (timestamp, timestamp),
            )
            candidates = connection.execute(
                """
                WITH heads AS (
                    SELECT command_id,
                           MIN(command_event_sequence) AS head_sequence
                    FROM command_result_outbox
                    WHERE status != 'sent'
                    GROUP BY command_id
                )
                SELECT heads.command_id, heads.head_sequence
                FROM heads
                JOIN command_result_outbox AS head
                  ON head.command_id = heads.command_id
                 AND head.command_event_sequence = heads.head_sequence
                WHERE head.status = 'pending'
                  AND head.next_attempt_at <= ?
                ORDER BY head.updated_at, heads.command_id
                LIMIT ?
                """,
                (timestamp, max_commands),
            ).fetchall()
            for candidate in candidates:
                rows = connection.execute(
                    """
                    SELECT e.*, o.status, o.attempt_count, o.next_attempt_at,
                           i.delivery_lease_token
                    FROM command_result_outbox AS o
                    JOIN command_result_events AS e ON e.event_id = o.event_id
                    JOIN remote_command_inbox AS i
                      ON i.command_id = o.command_id
                    WHERE o.command_id = ? AND o.command_event_sequence >= ?
                      AND o.status != 'sent'
                    ORDER BY o.command_event_sequence
                    LIMIT ?
                    """,
                    (
                        candidate["command_id"],
                        candidate["head_sequence"],
                        batch_size,
                    ),
                ).fetchall()
                ready: list[sqlite3.Row] = []
                expected = int(candidate["head_sequence"])
                for row in rows:
                    if (
                        int(row["command_event_sequence"]) != expected
                        or row["status"] != "pending"
                        or float(row["next_attempt_at"]) > timestamp
                    ):
                        break
                    ready.append(row)
                    expected += 1
                if not ready:
                    continue
                token = uuid.uuid4().hex
                event_ids = [row["event_id"] for row in ready]
                updated = connection.execute(
                    """
                    UPDATE command_result_outbox
                    SET status = 'sending', lease_token = ?, lease_until = ?,
                        updated_at = ?
                    WHERE status = 'pending' AND event_id IN (
                        SELECT value FROM json_each(?)
                    )
                    """,
                    (
                        token,
                        timestamp + lease_seconds,
                        timestamp,
                        json.dumps(event_ids, separators=(",", ":")),
                    ),
                )
                if updated.rowcount != len(event_ids):
                    raise OutboxLeaseLostError(
                        f"failed to lease command lane {candidate['command_id']!r}"
                    )
                batches.append(
                    CommandResultSyncBatch(
                        command_id=candidate["command_id"],
                        delivery_lease_token=ready[0]["delivery_lease_token"],
                        lease_token=token,
                        attempt_count=int(ready[0]["attempt_count"]),
                        events=tuple(
                            self._command_event_from_row(row) for row in ready
                        ),
                    )
                )
        return batches

    def mark_command_result_batch_sent(
        self,
        batch: CommandResultSyncBatch,
        *,
        now: float | None = None,
    ) -> None:
        self._finish_command_result_batch(batch, "sent", now=now)

    def retry_command_result_batch(
        self,
        batch: CommandResultSyncBatch,
        *,
        error: str,
        next_attempt_at: float,
        now: float | None = None,
    ) -> None:
        self._finish_command_result_batch(
            batch,
            "pending",
            error=error,
            next_attempt_at=next_attempt_at,
            increment_attempt=True,
            now=now,
        )

    def block_command_result_batch(
        self,
        batch: CommandResultSyncBatch,
        *,
        failed_event_id: str,
        error: str,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        if failed_event_id not in event_ids:
            raise ValueError("failed event must belong to command batch")
        with self._write_transaction() as connection:
            self._assert_command_batch_lease(connection, batch, event_ids)
            connection.execute(
                """
                UPDATE command_result_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE event_id IN (SELECT value FROM json_each(?))
                """,
                (timestamp, json.dumps(event_ids, separators=(",", ":"))),
            )
            connection.execute(
                """
                UPDATE command_result_outbox
                SET status = 'dead_letter', attempt_count = attempt_count + 1,
                    last_error = ?, updated_at = ?
                WHERE event_id = ?
                """,
                (error[:4000], timestamp, failed_event_id),
            )

    def list_pending_outbox(
        self, *, now: float | None = None, limit: int = 100
    ) -> list[RunEventSyncOutboxRecord]:
        timestamp = now if now is not None else time.time()
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT *
                FROM run_event_sync_outbox
                WHERE status = 'pending' AND next_attempt_at <= ?
                ORDER BY run_id, run_sequence
                LIMIT ?
                """,
                (timestamp, limit),
            ).fetchall()
            return [self._outbox_from_row(row) for row in rows]

    def claim_ready_artifact_uploads(
        self,
        *,
        now: float | None = None,
        limit: int = 4,
        lease_seconds: float = 60.0,
    ) -> list[ArtifactUploadSyncItem]:
        if limit < 1 or lease_seconds <= 0:
            raise ValueError("artifact upload claim limits must be positive")
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            connection.execute(
                """
                UPDATE artifact_upload_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE status = 'sending'
                  AND (lease_until IS NULL OR lease_until <= ?)
                """,
                (timestamp, timestamp),
            )
            rows = connection.execute(
                """
                SELECT artifact_upload_outbox.*
                FROM artifact_upload_outbox
                JOIN runs USING(run_id)
                WHERE artifact_upload_outbox.status = 'pending'
                  AND artifact_upload_outbox.next_attempt_at <= ?
                  AND runs.status IN ('completed', 'failed', 'cancelled')
                ORDER BY artifact_upload_outbox.created_at,
                         artifact_upload_outbox.artifact_id
                LIMIT ?
                """,
                (timestamp, limit),
            ).fetchall()
            claimed: list[ArtifactUploadSyncItem] = []
            for row in rows:
                lease_token = uuid.uuid4().hex
                updated = connection.execute(
                    """
                    UPDATE artifact_upload_outbox
                    SET status = 'sending', lease_token = ?, lease_until = ?,
                        updated_at = ?
                    WHERE artifact_id = ? AND status = 'pending'
                    """,
                    (
                        lease_token,
                        timestamp + lease_seconds,
                        timestamp,
                        row["artifact_id"],
                    ),
                )
                if updated.rowcount != 1:
                    continue
                claimed.append(
                    ArtifactUploadSyncItem(
                        artifact_id=str(row["artifact_id"]),
                        run_id=str(row["run_id"]),
                        project_id=str(row["project_id"]),
                        local_path=str(row["local_path"]),
                        filename=str(row["filename"]),
                        relative_path=str(row["relative_path"]),
                        file_size=int(row["file_size"]),
                        lease_token=lease_token,
                        attempt_count=int(row["attempt_count"]),
                    )
                )
            return claimed

    @staticmethod
    def _assert_artifact_upload_lease(
        connection: sqlite3.Connection,
        item: ArtifactUploadSyncItem,
    ) -> None:
        row = connection.execute(
            """
            SELECT status, lease_token FROM artifact_upload_outbox
            WHERE artifact_id = ?
            """,
            (item.artifact_id,),
        ).fetchone()
        if (
            row is None
            or row["status"] != "sending"
            or row["lease_token"] != item.lease_token
        ):
            raise OutboxLeaseLostError(
                f"artifact upload lease lost for {item.artifact_id!r}"
            )

    def complete_artifact_upload(
        self,
        item: ArtifactUploadSyncItem,
        *,
        chat_file_id: int,
        s3_bucket: str,
        s3_key: str,
        filename: str,
        file_size: int,
        file_type: str,
        now: float | None = None,
    ) -> CommittedRunEvent:
        timestamp = now if now is not None else time.time()
        payload = {
            "artifact_id": item.artifact_id,
            "relativePath": item.relative_path,
            "filename": filename,
            "asset_ref": {
                "chat_file_id": chat_file_id,
                "bucket": s3_bucket,
                "key": s3_key,
                "filename": filename,
                "size": file_size,
                "content_type": file_type,
            },
        }
        fingerprint = hashlib.sha256(
            json.dumps(
                {"run_id": item.run_id, **payload},
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        draft = RunEventDraft(
            event_id=f"au_{fingerprint[:61]}",
            event_type="artifact.uploaded",
            payload=payload,
            created_at=timestamp,
        )
        with self._write_transaction() as connection:
            self._assert_artifact_upload_lease(connection, item)
            event = self._append_event_in_transaction(
                connection,
                item.run_id,
                draft,
                expected_project_id=item.project_id,
            )
            connection.execute(
                """
                UPDATE artifact_upload_outbox
                SET status = 'sent', lease_token = NULL, lease_until = NULL,
                    last_error = NULL, updated_at = ?
                WHERE artifact_id = ?
                """,
                (timestamp, item.artifact_id),
            )
            return event

    def retry_artifact_upload(
        self,
        item: ArtifactUploadSyncItem,
        *,
        error: str,
        next_attempt_at: float,
        now: float | None = None,
        dead_letter: bool = False,
    ) -> None:
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            self._assert_artifact_upload_lease(connection, item)
            connection.execute(
                """
                UPDATE artifact_upload_outbox
                SET status = ?, attempt_count = attempt_count + 1,
                    next_attempt_at = ?, last_error = ?, lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE artifact_id = ?
                """,
                (
                    "dead_letter" if dead_letter else "pending",
                    next_attempt_at,
                    error[:4000],
                    timestamp,
                    item.artifact_id,
                ),
            )

    def claim_ready_outbox_batches(
        self,
        *,
        now: float | None = None,
        max_runs: int = 4,
        batch_size: int = 100,
        lease_seconds: float = 30.0,
    ) -> list[RunEventSyncBatch]:
        """Lease one consecutive FIFO batch from each ready Run.

        A dead-letter row remains the earliest non-sent row and therefore blocks
        only its own Run. Expired ``sending`` rows are reclaimed after a crash.
        """

        if max_runs < 1 or batch_size < 1 or lease_seconds <= 0:
            raise ValueError("outbox claim limits and lease must be positive")
        timestamp = now if now is not None else time.time()
        lease_until = timestamp + lease_seconds
        batches: list[RunEventSyncBatch] = []
        with self._write_transaction() as connection:
            connection.execute(
                """
                UPDATE run_event_sync_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE status = 'sending'
                  AND (lease_until IS NULL OR lease_until <= ?)
                """,
                (timestamp, timestamp),
            )
            candidates = connection.execute(
                """
                SELECT o.run_id, r.project_id, o.run_sequence
                FROM run_event_sync_outbox AS o
                JOIN runs AS r ON r.run_id = o.run_id
                WHERE o.status = 'pending'
                  AND o.next_attempt_at <= ?
                  AND o.run_sequence = (
                      SELECT MIN(head.run_sequence)
                      FROM run_event_sync_outbox AS head
                      WHERE head.run_id = o.run_id
                        AND head.status != 'sent'
                  )
                ORDER BY o.updated_at, o.run_id
                LIMIT ?
                """,
                (timestamp, max_runs),
            ).fetchall()
            for candidate in candidates:
                rows = connection.execute(
                    """
                    SELECT e.event_id, e.run_id, e.sequence, e.run_version,
                           e.event_type, e.payload_json, e.legacy_step,
                           e.created_at, o.status, o.attempt_count,
                           o.next_attempt_at
                    FROM run_event_sync_outbox AS o
                    JOIN run_events AS e ON e.event_id = o.event_id
                    WHERE o.run_id = ? AND o.run_sequence >= ?
                      AND o.status != 'sent'
                    ORDER BY o.run_sequence
                    LIMIT ?
                    """,
                    (
                        candidate["run_id"],
                        candidate["run_sequence"],
                        batch_size,
                    ),
                ).fetchall()
                ready: list[sqlite3.Row] = []
                expected = int(candidate["run_sequence"])
                for row in rows:
                    if (
                        int(row["sequence"]) != expected
                        or row["status"] != "pending"
                        or float(row["next_attempt_at"]) > timestamp
                    ):
                        break
                    ready.append(row)
                    expected += 1
                if not ready:
                    continue
                lease_token = uuid.uuid4().hex
                event_ids = [row["event_id"] for row in ready]
                claimed = connection.execute(
                    """
                    UPDATE run_event_sync_outbox
                    SET status = 'sending', lease_token = ?, lease_until = ?,
                        updated_at = ?
                    WHERE status = 'pending' AND event_id IN (
                        SELECT value FROM json_each(?)
                    )
                    """,
                    (
                        lease_token,
                        lease_until,
                        timestamp,
                        json.dumps(event_ids, separators=(",", ":")),
                    ),
                )
                if claimed.rowcount != len(event_ids):
                    raise OutboxLeaseLostError(
                        f"failed to lease all events for {candidate['run_id']!r}"
                    )
                batches.append(
                    RunEventSyncBatch(
                        project_id=candidate["project_id"],
                        run_id=candidate["run_id"],
                        lease_token=lease_token,
                        attempt_count=int(ready[0]["attempt_count"]),
                        events=tuple(
                            self._event_from_row(row) for row in ready
                        ),
                    )
                )
        return batches

    def mark_outbox_batch_sent(
        self,
        batch: RunEventSyncBatch,
        *,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        with self._write_transaction() as connection:
            self._assert_batch_lease(connection, batch, event_ids)
            connection.execute(
                """
                UPDATE run_event_sync_outbox
                SET status = 'sent', lease_token = NULL, lease_until = NULL,
                    last_error = NULL, updated_at = ?
                WHERE event_id IN (SELECT value FROM json_each(?))
                """,
                (timestamp, json.dumps(event_ids, separators=(",", ":"))),
            )

    def retry_outbox_batch(
        self,
        batch: RunEventSyncBatch,
        *,
        error: str,
        next_attempt_at: float,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        with self._write_transaction() as connection:
            self._assert_batch_lease(connection, batch, event_ids)
            connection.execute(
                """
                UPDATE run_event_sync_outbox
                SET status = 'pending', attempt_count = attempt_count + 1,
                    next_attempt_at = ?, last_error = ?, lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE event_id IN (SELECT value FROM json_each(?))
                """,
                (
                    next_attempt_at,
                    error[:4000],
                    timestamp,
                    json.dumps(event_ids, separators=(",", ":")),
                ),
            )

    def block_outbox_batch(
        self,
        batch: RunEventSyncBatch,
        *,
        failed_event_id: str,
        error: str,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        if failed_event_id not in event_ids:
            raise ValueError("failed event must belong to the leased batch")
        with self._write_transaction() as connection:
            self._assert_batch_lease(connection, batch, event_ids)
            connection.execute(
                """
                UPDATE run_event_sync_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE event_id IN (SELECT value FROM json_each(?))
                """,
                (timestamp, json.dumps(event_ids, separators=(",", ":"))),
            )
            connection.execute(
                """
                UPDATE run_event_sync_outbox
                SET status = 'dead_letter', attempt_count = attempt_count + 1,
                    last_error = ?, updated_at = ?
                WHERE event_id = ?
                """,
                (error[:4000], timestamp, failed_event_id),
            )

    @staticmethod
    def _memory_entry_cloud_projection(
        entry: dict[str, Any] | None,
        sync_scope: str,
    ) -> dict[str, Any] | None:
        if entry is None:
            return None
        if sync_scope != "full_memory":
            raise InvalidRunTransitionError(
                "Memory sync is fixed to full_memory"
            )
        projected = dict(entry)
        from app.run_journal.memory_policy import (
            normalize_memory_provenance_for_cloud,
        )

        projected["kind"], projected["source_trust"] = (
            normalize_memory_provenance_for_cloud(
                kind=str(projected.get("kind") or ""),
                source_trust=str(projected.get("source_trust") or ""),
                deleted=projected.get("deleted_at") is not None,
            )
        )
        content = (
            ""
            if projected.get("deleted_at") is not None
            else str(projected.get("content") or "")
        )
        if content:
            # Import lazily to keep the RunJournal storage module independent
            # from permission-policy initialization while sharing the exact
            # credential and device-identity projection used elsewhere.
            from app.permission_policy.models import redact_sensitive_text
            from app.workspace_config.models import redact_device_home_paths

            content = redact_device_home_paths(redact_sensitive_text(content))
        projected["content"] = content
        projected["content_digest"] = hashlib.sha256(
            content.encode("utf-8")
        ).hexdigest()
        redacted_refs: list[str] = []
        for value in projected.get("source_refs", [])[:20]:
            text = str(value)
            suffix = text.removeprefix("ref:")
            if (
                text.startswith("ref:")
                and len(suffix) == 20
                and all(
                    character in "0123456789abcdef" for character in suffix
                )
            ):
                redacted_refs.append(text)
            else:
                redacted_refs.append(
                    "ref:"
                    + hashlib.sha256(text.encode("utf-8")).hexdigest()[:20]
                )
        projected["source_refs"] = redacted_refs
        return projected

    def list_memory_sync_snapshots(
        self, account_owner_id: str
    ) -> list[dict[str, Any]]:
        """Return bounded derived snapshots for anti-entropy bootstrap."""

        owner = account_owner_id.strip()
        if not owner:
            return []

        with self._lock:
            states = self._connection.execute(
                """
                SELECT state.*
                FROM memory_scope_state AS state
                JOIN memory_scope_owners AS owner
                  ON owner.scope_type = state.scope_type
                 AND owner.scope_id = state.scope_id
                WHERE state.sync_scope = 'full_memory'
                  AND owner.account_owner_id = ?
                ORDER BY state.scope_type, state.scope_id
                """,
                (owner,),
            ).fetchall()
            snapshots: list[dict[str, Any]] = []
            for state in states:
                entries = self._connection.execute(
                    """
                    SELECT * FROM memory_entries
                    WHERE scope_type = ? AND scope_id = ?
                    ORDER BY created_at, memory_id
                    """,
                    (state["scope_type"], state["scope_id"]),
                ).fetchall()
                sync_scope = str(state["sync_scope"])
                snapshots.append(
                    {
                        "scope_type": state["scope_type"],
                        "scope_id": state["scope_id"],
                        "scope": {
                            "capture_enabled": bool(state["capture_enabled"]),
                            "use_enabled": bool(state["use_enabled"]),
                            "sync_scope": sync_scope,
                            "token_limit": int(state["token_limit"]),
                            "processed_through_watermark": state[
                                "processed_through_watermark"
                            ],
                            "watermark_kind": state["watermark_kind"],
                            "updated_at": datetime.fromtimestamp(
                                float(state["updated_at"]), tz=UTC
                            ).isoformat(),
                        },
                        "revision": int(state["revision"]),
                        "entries": [
                            self._memory_entry_cloud_projection(
                                {
                                    "memory_id": row["memory_id"],
                                    "kind": row["kind"],
                                    "content": row["content"],
                                    "priority": row["priority"],
                                    "version": int(row["version"]),
                                    "token_count": int(row["token_count"]),
                                    "pinned_by_user": bool(
                                        row["pinned_by_user"]
                                    ),
                                    "confirmed_by_user": bool(
                                        row["confirmed_by_user"]
                                    ),
                                    "created_by": row["created_by"],
                                    "source_trust": row["source_trust"],
                                    "sensitivity": row["sensitivity"],
                                    "source_refs": json.loads(
                                        row["source_refs_json"]
                                    ),
                                    "deleted_at": (
                                        datetime.fromtimestamp(
                                            float(row["deleted_at"]), tz=UTC
                                        ).isoformat()
                                        if row["deleted_at"] is not None
                                        else None
                                    ),
                                    "created_at": datetime.fromtimestamp(
                                        float(row["created_at"]), tz=UTC
                                    ).isoformat(),
                                    "updated_at": datetime.fromtimestamp(
                                        float(row["updated_at"]), tz=UTC
                                    ).isoformat(),
                                },
                                sync_scope,
                            )
                            for row in entries
                        ],
                    }
                )
            return snapshots

    def merge_cloud_memory_baseline(
        self,
        *,
        scope_type: str,
        scope_id: str,
        account_owner_id: str,
        scope: dict[str, Any],
        entries: list[dict[str, Any]],
    ) -> int:
        """Hydrate a new writer before it publishes a rebase snapshot.

        This is a read-model import, not a user/agent mutation: it never emits
        a Memory mutation or advances the local revision. Local entries are
        retained. Any differing entry with the same id becomes an explicit
        review item; neither timestamp nor version is allowed to silently
        overwrite user-visible Memory. The final union must still fit the
        fixed scope cap.
        """

        self._validate_memory_scope(scope_type, scope_id)
        if scope.get("sync_scope") != "full_memory":
            raise InvalidRunTransitionError(
                "Cloud Memory baseline must contain full_memory"
            )

        def parse_timestamp(value: Any) -> float:
            if isinstance(value, (int, float)):
                return float(value)
            if not isinstance(value, str):
                raise ValueError("Cloud Memory timestamp is invalid")
            return datetime.fromisoformat(
                value.replace("Z", "+00:00")
            ).timestamp()

        timestamp = time.time()
        owner = account_owner_id.strip()
        if not owner:
            raise ValueError("Memory account owner is required")
        with self._write_transaction() as connection:
            ownership = connection.execute(
                """
                SELECT account_owner_id FROM memory_scope_owners
                WHERE scope_type = ? AND scope_id = ?
                """,
                (scope_type, scope_id),
            ).fetchone()
            if ownership is None or ownership["account_owner_id"] != owner:
                raise InvalidRunTransitionError(
                    "Cloud Memory baseline scope is not bound to the "
                    "authenticated account"
                )
            state = self._ensure_memory_scope_state_in_transaction(
                connection,
                scope_type=scope_type,
                scope_id=scope_id,
                owner_kind="desktop",
                token_limit=_MEMORY_DEFAULT_TOKEN_LIMITS[scope_type],
                now=timestamp,
            )
            seen: set[str] = set()
            reconciliation_count = 0
            for raw in entries:
                memory_id = str(raw.get("memory_id") or "").strip()
                if not memory_id or memory_id in seen:
                    raise IdempotencyConflictError(
                        "Cloud Memory baseline contains duplicate ids"
                    )
                seen.add(memory_id)
                content = str(raw.get("content") or "")
                if hashlib.sha256(content.encode("utf-8")).hexdigest() != str(
                    raw.get("content_digest") or ""
                ):
                    raise IdempotencyConflictError(
                        "Cloud Memory baseline content digest does not match"
                    )
                incoming_deleted = (
                    parse_timestamp(raw["deleted_at"])
                    if raw.get("deleted_at") is not None
                    else None
                )
                self._validate_memory_entry_values(
                    content=content,
                    kind=str(raw.get("kind") or ""),
                    priority=str(raw.get("priority") or "normal"),
                    token_count=int(raw.get("token_count") or 0),
                    created_by=str(raw.get("created_by") or ""),
                    source_trust=str(raw.get("source_trust") or ""),
                    sensitivity=str(raw.get("sensitivity") or "normal"),
                    allow_empty_content=incoming_deleted is not None,
                )
                incoming_kind = str(raw.get("kind") or "")
                incoming_trust = str(raw.get("source_trust") or "")
                incoming_created_by = str(raw.get("created_by") or "")
                incoming_confirmed = bool(raw.get("confirmed_by_user"))
                incoming_refs = list(raw.get("source_refs") or [])
                assert_memory_entry_policy(
                    kind=incoming_kind,
                    content=content,
                    created_by=incoming_created_by,
                    source_trust=incoming_trust,
                    confirmed_by_user=incoming_confirmed,
                    source_refs=incoming_refs,
                    deleted=incoming_deleted is not None,
                    cloud_projection=True,
                )
                incoming_updated = parse_timestamp(raw.get("updated_at"))
                incoming_created = parse_timestamp(raw.get("created_at"))
                existing = connection.execute(
                    "SELECT * FROM memory_entries WHERE memory_id = ?",
                    (memory_id,),
                ).fetchone()
                if existing is not None and (
                    existing["scope_type"] != scope_type
                    or existing["scope_id"] != scope_id
                ):
                    raise IdempotencyConflictError(
                        "Cloud Memory id belongs to another local scope"
                    )
                incoming_version = int(raw.get("version") or 0)
                if existing is not None:
                    local_deleted = (
                        float(existing["deleted_at"])
                        if existing["deleted_at"] is not None
                        else None
                    )
                    local_shape = {
                        "kind": existing["kind"],
                        "content": (
                            ""
                            if local_deleted is not None
                            else existing["content"]
                        ),
                        "priority": existing["priority"],
                        "token_count": int(existing["token_count"]),
                        "created_by": existing["created_by"],
                        "source_trust": existing["source_trust"],
                        "sensitivity": existing["sensitivity"],
                        "source_refs": json.loads(
                            existing["source_refs_json"]
                        ),
                        "deleted_at": local_deleted,
                    }
                    cloud_shape = {
                        "kind": str(raw["kind"]),
                        "content": content,
                        "priority": str(raw.get("priority") or "normal"),
                        "token_count": int(raw["token_count"]),
                        "created_by": str(raw["created_by"]),
                        "source_trust": str(raw["source_trust"]),
                        "sensitivity": str(raw.get("sensitivity") or "normal"),
                        "source_refs": incoming_refs,
                        "deleted_at": incoming_deleted,
                    }
                    if local_shape == cloud_shape:
                        continue
                    reconciliation_id = (
                        "memrecon_"
                        + hashlib.sha256(
                            json.dumps(
                                {
                                    "owner": owner,
                                    "scope_type": scope_type,
                                    "scope_id": scope_id,
                                    "memory_id": memory_id,
                                    "local": local_shape,
                                    "cloud": cloud_shape,
                                },
                                sort_keys=True,
                                separators=(",", ":"),
                            ).encode("utf-8")
                        ).hexdigest()[:32]
                    )
                    inserted = connection.execute(
                        """
                        INSERT OR IGNORE INTO memory_reconciliation_items(
                            reconciliation_id, account_owner_id, scope_type,
                            scope_id, memory_id, local_entry_json,
                            cloud_entry_json, status, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                        """,
                        (
                            reconciliation_id,
                            owner,
                            scope_type,
                            scope_id,
                            memory_id,
                            json.dumps(
                                local_shape,
                                ensure_ascii=False,
                                sort_keys=True,
                                separators=(",", ":"),
                            ),
                            json.dumps(
                                dict(raw),
                                ensure_ascii=False,
                                sort_keys=True,
                                separators=(",", ":"),
                            ),
                            timestamp,
                        ),
                    )
                    reconciliation_count += int(inserted.rowcount == 1)
                    continue
                values = (
                    scope_type,
                    scope_id,
                    str(raw["kind"]),
                    content,
                    str(raw.get("priority") or "normal"),
                    incoming_version,
                    int(raw["token_count"]),
                    int(bool(raw.get("pinned_by_user"))),
                    int(bool(raw.get("confirmed_by_user"))),
                    str(raw["created_by"]),
                    str(raw["source_trust"]),
                    str(raw.get("sensitivity") or "normal"),
                    json.dumps(
                        incoming_refs,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    incoming_deleted,
                    incoming_created,
                    incoming_updated,
                    memory_id,
                )
                if existing is None:
                    connection.execute(
                        """
                        INSERT INTO memory_entries(
                            scope_type, scope_id, kind, content, priority,
                            version, token_count, pinned_by_user,
                            confirmed_by_user, created_by, source_trust,
                            sensitivity, source_refs_json, deleted_at,
                            created_at, updated_at, memory_id, usage_count
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                  ?, ?, ?, 0)
                        """,
                        values,
                    )
                else:
                    connection.execute(
                        """
                        UPDATE memory_entries
                        SET scope_type = ?, scope_id = ?, kind = ?, content = ?,
                            priority = ?, version = ?, token_count = ?,
                            pinned_by_user = ?, confirmed_by_user = ?,
                            created_by = ?, source_trust = ?, sensitivity = ?,
                            source_refs_json = ?, deleted_at = ?, created_at = ?,
                            updated_at = ?
                        WHERE memory_id = ?
                        """,
                        values,
                    )

            active_tokens = int(
                connection.execute(
                    """
                    SELECT COALESCE(SUM(token_count), 0)
                    FROM memory_entries
                    WHERE scope_type = ? AND scope_id = ?
                      AND deleted_at IS NULL
                    """,
                    (scope_type, scope_id),
                ).fetchone()[0]
            )
            if active_tokens > int(state["token_limit"]):
                raise InvalidRunTransitionError(
                    "Merged Cloud Memory baseline exceeds the local hard cap"
                )
            if int(state["revision"]) == 0:
                connection.execute(
                    """
                    UPDATE memory_scope_state
                    SET capture_enabled = ?, use_enabled = ?,
                        current_token_count = ?, updated_at = ?
                    WHERE scope_type = ? AND scope_id = ?
                    """,
                    (
                        int(bool(scope.get("capture_enabled"))),
                        int(bool(scope.get("use_enabled"))),
                        active_tokens,
                        timestamp,
                        scope_type,
                        scope_id,
                    ),
                )
            else:
                connection.execute(
                    """
                    UPDATE memory_scope_state
                    SET current_token_count = ?, updated_at = ?
                    WHERE scope_type = ? AND scope_id = ?
                    """,
                    (active_tokens, timestamp, scope_type, scope_id),
                )
            return reconciliation_count

    def get_memory_sync_status(
        self, scope_type: str, scope_id: str
    ) -> dict[str, Any]:
        """Return truthful local delivery state for the Memory Center."""

        with self._lock:
            row = self._connection.execute(
                """
                SELECT
                    SUM(CASE WHEN status IN ('pending', 'sending')
                             THEN 1 ELSE 0 END) AS pending_count,
                    SUM(CASE WHEN status = 'dead_letter'
                             THEN 1 ELSE 0 END) AS blocked_count,
                    MAX(CASE WHEN status != 'sent' THEN last_error END)
                        AS last_error,
                    MAX(CASE WHEN status = 'sent' THEN updated_at END)
                        AS last_synced_at
                FROM memory_mutation_outbox
                WHERE scope_type = ? AND scope_id = ?
                """,
                (scope_type, scope_id),
            ).fetchone()
        pending = int(row["pending_count"] or 0)
        blocked = int(row["blocked_count"] or 0)
        return {
            "state": (
                "blocked" if blocked else "pending" if pending else "synced"
            ),
            "pending_count": pending,
            "blocked_count": blocked,
            "last_error": row["last_error"],
            "last_synced_at": row["last_synced_at"],
        }

    def has_legacy_memory_import(
        self, source_path: str, source_checksum: str
    ) -> bool:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT 1 FROM legacy_memory_import_batches
                WHERE source_path = ? AND source_checksum = ?
                  AND status = 'completed'
                """,
                (source_path, source_checksum),
            ).fetchone()
        return row is not None

    def record_legacy_memory_import(
        self,
        *,
        source_path: str,
        source_checksum: str,
        status: str,
        imported_count: int,
        skipped_count: int,
        error: str | None = None,
        now: float | None = None,
    ) -> None:
        if status not in {"completed", "degraded"}:
            raise ValueError("invalid legacy Memory import status")
        if imported_count < 0 or skipped_count < 0:
            raise ValueError(
                "legacy Memory import counts must be non-negative"
            )
        timestamp = now if now is not None else time.time()
        with self._write_transaction() as connection:
            connection.execute(
                """
                INSERT INTO legacy_memory_import_batches(
                    source_path, source_checksum, status, imported_count,
                    skipped_count, last_error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_path, source_checksum) DO UPDATE SET
                    status = excluded.status,
                    imported_count = excluded.imported_count,
                    skipped_count = excluded.skipped_count,
                    last_error = excluded.last_error,
                    updated_at = excluded.updated_at
                """,
                (
                    source_path,
                    source_checksum,
                    status,
                    imported_count,
                    skipped_count,
                    error[:4000] if error else None,
                    timestamp,
                    timestamp,
                ),
            )

    def claim_ready_memory_mutation_batches(
        self,
        *,
        now: float | None = None,
        max_scopes: int = 4,
        batch_size: int = 100,
        lease_seconds: float = 30.0,
        eligible_scopes: set[tuple[str, str]] | None = None,
    ) -> list[MemoryMutationSyncBatch]:
        if max_scopes < 1 or batch_size < 1 or lease_seconds <= 0:
            raise ValueError("Memory outbox claim limits must be positive")
        timestamp = now if now is not None else time.time()
        batches: list[MemoryMutationSyncBatch] = []
        with self._write_transaction() as connection:
            connection.execute(
                """
                UPDATE memory_mutation_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE status = 'sending'
                  AND (lease_until IS NULL OR lease_until <= ?)
                """,
                (timestamp, timestamp),
            )
            candidates = connection.execute(
                """
                SELECT outbox.scope_type, outbox.scope_id,
                       MIN(outbox.scope_revision) AS head_scope_revision
                FROM memory_mutation_outbox AS outbox
                WHERE outbox.status = 'pending'
                  AND outbox.next_attempt_at <= ?
                  AND outbox.scope_revision = (
                      SELECT MIN(head.scope_revision)
                      FROM memory_mutation_outbox AS head
                      WHERE head.scope_type = outbox.scope_type
                        AND head.scope_id = outbox.scope_id
                        AND head.status != 'sent'
                  )
                GROUP BY outbox.scope_type, outbox.scope_id
                ORDER BY head_scope_revision, outbox.scope_type, outbox.scope_id
                """,
                (timestamp,),
            ).fetchall()
            for candidate in candidates:
                scope_key = (
                    str(candidate["scope_type"]),
                    str(candidate["scope_id"]),
                )
                if (
                    eligible_scopes is not None
                    and scope_key not in eligible_scopes
                ):
                    continue
                if len(batches) >= max_scopes:
                    break
                state = connection.execute(
                    """
                    SELECT * FROM memory_scope_state
                    WHERE scope_type = ? AND scope_id = ?
                    """,
                    (candidate["scope_type"], candidate["scope_id"]),
                ).fetchone()
                if state is None or state["sync_scope"] != "full_memory":
                    continue
                rows = connection.execute(
                    """
                    SELECT * FROM memory_mutation_outbox
                    WHERE scope_type = ? AND scope_id = ?
                      AND status != 'sent' AND scope_revision >= ?
                    ORDER BY scope_revision
                    LIMIT ?
                    """,
                    (
                        candidate["scope_type"],
                        candidate["scope_id"],
                        candidate["head_scope_revision"],
                        batch_size,
                    ),
                ).fetchall()
                ready: list[sqlite3.Row] = []
                expected_scope_revision = int(rows[0]["scope_revision"])
                for row in rows:
                    if (
                        row["status"] != "pending"
                        or float(row["next_attempt_at"]) > timestamp
                        or row["payload_json"] == "{}"
                        or int(row["scope_revision"])
                        != expected_scope_revision
                    ):
                        break
                    ready.append(row)
                    expected_scope_revision += 1
                if not ready:
                    continue
                lease_token = uuid.uuid4().hex
                mutation_ids = [row["mutation_id"] for row in ready]
                claimed = connection.execute(
                    """
                    UPDATE memory_mutation_outbox
                    SET status = 'sending', lease_token = ?, lease_until = ?,
                        updated_at = ?
                    WHERE status = 'pending' AND mutation_id IN (
                        SELECT value FROM json_each(?)
                    )
                    """,
                    (
                        lease_token,
                        timestamp + lease_seconds,
                        timestamp,
                        json.dumps(mutation_ids, separators=(",", ":")),
                    ),
                )
                if claimed.rowcount != len(ready):
                    raise OutboxLeaseLostError(
                        "failed to lease all Memory mutations"
                    )
                sync_scope = str(state["sync_scope"])
                items: list[MemoryMutationSyncItem] = []
                for row in ready:
                    payload = json.loads(row["payload_json"])
                    payload["scope_revision"] = int(row["scope_revision"])
                    payload["entry"] = self._memory_entry_cloud_projection(
                        payload.get("entry"), sync_scope
                    )
                    items.append(
                        MemoryMutationSyncItem(
                            mutation_id=row["mutation_id"],
                            payload=payload,
                        )
                    )
                batches.append(
                    MemoryMutationSyncBatch(
                        scope_type=candidate["scope_type"],
                        scope_id=candidate["scope_id"],
                        scope={
                            "capture_enabled": bool(state["capture_enabled"]),
                            "use_enabled": bool(state["use_enabled"]),
                            "sync_scope": sync_scope,
                            "token_limit": int(state["token_limit"]),
                            "processed_through_watermark": state[
                                "processed_through_watermark"
                            ],
                            "watermark_kind": state["watermark_kind"],
                            "updated_at": datetime.fromtimestamp(
                                float(state["updated_at"]), tz=UTC
                            ).isoformat(),
                        },
                        source_revision=int(state["revision"]),
                        lease_token=lease_token,
                        attempt_count=int(ready[0]["attempt_count"]),
                        items=tuple(items),
                    )
                )
        return batches

    def _finish_memory_mutation_batch(
        self,
        batch: MemoryMutationSyncBatch,
        status: str,
        *,
        error: str | None = None,
        next_attempt_at: float | None = None,
        increment_attempt: bool = False,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        mutation_ids = [item.mutation_id for item in batch.items]
        with self._write_transaction() as connection:
            rows = connection.execute(
                """
                SELECT mutation_id FROM memory_mutation_outbox
                WHERE status = 'sending' AND lease_token = ?
                  AND mutation_id IN (SELECT value FROM json_each(?))
                """,
                (
                    batch.lease_token,
                    json.dumps(mutation_ids, separators=(",", ":")),
                ),
            ).fetchall()
            if {row["mutation_id"] for row in rows} != set(mutation_ids):
                raise OutboxLeaseLostError("Memory mutation lease was lost")
            connection.execute(
                """
                UPDATE memory_mutation_outbox
                SET status = ?, attempt_count = attempt_count + ?,
                    next_attempt_at = COALESCE(?, next_attempt_at),
                    last_error = ?, lease_token = NULL, lease_until = NULL,
                    updated_at = ?
                WHERE lease_token = ?
                  AND mutation_id IN (SELECT value FROM json_each(?))
                """,
                (
                    status,
                    int(increment_attempt),
                    next_attempt_at,
                    error[:4000] if error else None,
                    timestamp,
                    batch.lease_token,
                    json.dumps(mutation_ids, separators=(",", ":")),
                ),
            )

    def mark_memory_mutation_batch_sent(
        self, batch: MemoryMutationSyncBatch, *, now: float | None = None
    ) -> None:
        self._finish_memory_mutation_batch(batch, "sent", now=now)

    def retry_memory_mutation_batch(
        self,
        batch: MemoryMutationSyncBatch,
        *,
        error: str,
        next_attempt_at: float,
        now: float | None = None,
    ) -> None:
        self._finish_memory_mutation_batch(
            batch,
            "pending",
            error=error,
            next_attempt_at=next_attempt_at,
            increment_attempt=True,
            now=now,
        )

    def block_memory_mutation_batch(
        self,
        batch: MemoryMutationSyncBatch,
        *,
        failed_mutation_id: str,
        error: str,
        now: float | None = None,
    ) -> None:
        if failed_mutation_id not in {
            item.mutation_id for item in batch.items
        }:
            raise ValueError("failed mutation must belong to batch")
        timestamp = now if now is not None else time.time()
        mutation_ids = [item.mutation_id for item in batch.items]
        with self._write_transaction() as connection:
            rows = connection.execute(
                """
                SELECT mutation_id FROM memory_mutation_outbox
                WHERE status = 'sending' AND lease_token = ?
                  AND mutation_id IN (SELECT value FROM json_each(?))
                """,
                (
                    batch.lease_token,
                    json.dumps(mutation_ids, separators=(",", ":")),
                ),
            ).fetchall()
            if {row["mutation_id"] for row in rows} != set(mutation_ids):
                raise OutboxLeaseLostError("Memory mutation lease was lost")
            connection.execute(
                """
                UPDATE memory_mutation_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE lease_token = ?
                  AND mutation_id IN (SELECT value FROM json_each(?))
                """,
                (
                    timestamp,
                    batch.lease_token,
                    json.dumps(mutation_ids, separators=(",", ":")),
                ),
            )
            connection.execute(
                """
                UPDATE memory_mutation_outbox
                SET status = 'dead_letter', attempt_count = attempt_count + 1,
                    last_error = ?, updated_at = ?
                WHERE mutation_id = ?
                """,
                (error[:4000], timestamp, failed_mutation_id),
            )

    @staticmethod
    def _terminal_status_for_event(draft: RunEventDraft) -> str | None:
        # assistant.final keeps legacy_step='end' for old projectors, but the
        # Coordinator remains the sole owner of the Run terminal transition.
        if draft.event_type == "assistant.final":
            return None
        if draft.event_type == "run.completed":
            return "completed"
        if draft.event_type in {"run.failed", "run.deadline_reached"}:
            return "failed"
        if draft.event_type == "run.cancelled":
            return "cancelled"
        if draft.event_type in {"run.interrupted", "runtime.interrupted"}:
            return "interrupted"
        return None

    @staticmethod
    def _bounded_frontier_text(value: Any, *, limit: int = 1000) -> str:
        text = str(value or "").strip()
        return text if len(text) <= limit else text[:limit] + "…"

    @classmethod
    def _project_frontier_for_terminal_run(
        cls,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        terminal_status: str,
        terminal_payload: dict[str, Any],
    ) -> dict[str, Any]:
        rows = connection.execute(
            """
            SELECT event_type, payload_json, legacy_step
            FROM run_events
            WHERE run_id = ?
              AND (
                event_type IN (
                    'user.message', 'tool.outcome_unknown',
                    'artifact.manifest.finalized'
                )
                OR legacy_step = 'todo_state'
              )
            ORDER BY sequence
            """,
            (run_id,),
        ).fetchall()
        objective = ""
        latest_todos: list[dict[str, Any]] = []
        saw_todo_state = False
        artifact_ids: set[str] = set()
        outcome_unknown = False
        for row in rows:
            payload = json.loads(row["payload_json"])
            if row["event_type"] == "user.message" and not objective:
                objective = cls._bounded_frontier_text(
                    payload.get("content") or payload.get("message")
                )
            if row["legacy_step"] == "todo_state":
                candidate = payload.get("todos")
                if isinstance(candidate, list):
                    saw_todo_state = True
                    latest_todos = [
                        item for item in candidate if isinstance(item, dict)
                    ][:100]
            if row["event_type"] == "tool.outcome_unknown":
                outcome_unknown = True
            artifact_id = payload.get("artifact_id")
            if isinstance(artifact_id, str) and artifact_id.strip():
                if len(artifact_ids) < 500:
                    artifact_ids.add(artifact_id.strip())
            many = payload.get("artifact_ids")
            if isinstance(many, list):
                for value in many:
                    if len(artifact_ids) >= 500:
                        break
                    if isinstance(value, str) and value.strip():
                        artifact_ids.add(value.strip())
            artifacts = payload.get("artifacts")
            if isinstance(artifacts, list):
                for artifact in artifacts:
                    if isinstance(artifact, dict):
                        value = artifact.get("artifact_id") or artifact.get(
                            "id"
                        )
                        if isinstance(value, str) and value.strip():
                            if len(artifact_ids) < 500:
                                artifact_ids.add(value.strip())

        completed: list[str] = []
        remaining: list[str] = []
        in_progress: str | None = None
        next_action: str | None = None
        for todo in latest_todos:
            content = cls._bounded_frontier_text(todo.get("content"))
            active_form = cls._bounded_frontier_text(todo.get("active_form"))
            if not content:
                continue
            status = str(todo.get("status") or "pending")
            if status == "completed":
                completed.append(content)
            elif status == "in_progress" and in_progress is None:
                in_progress = active_form or content
                next_action = in_progress
            else:
                remaining.append(content)
        if next_action is None and remaining:
            next_action = remaining[0]
        owner = connection.execute(
            "SELECT project_id FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        previous_state = (
            connection.execute(
                "SELECT frontier_json FROM project_execution_states WHERE project_id = ?",
                (owner["project_id"],),
            ).fetchone()
            if owner is not None
            else None
        )
        previous_frontier = (
            json.loads(previous_state["frontier_json"])
            if previous_state is not None
            and previous_state["frontier_json"] is not None
            else None
        )
        continuation = connection.execute(
            "SELECT * FROM continuation_claims WHERE request_id = ?",
            (run_id,),
        ).fetchone()
        if continuation is not None and isinstance(previous_frontier, dict):
            objective = cls._bounded_frontier_text(
                previous_frontier.get("objective")
            )
            for value in previous_frontier.get("artifact_ids", []):
                if len(artifact_ids) >= 500:
                    break
                if isinstance(value, str) and value:
                    artifact_ids.add(value)
            if not saw_todo_state:
                completed = [
                    cls._bounded_frontier_text(value)
                    for value in previous_frontier.get("completed", [])
                    if cls._bounded_frontier_text(value)
                ]
                remaining = [
                    cls._bounded_frontier_text(value)
                    for value in previous_frontier.get("remaining", [])
                    if cls._bounded_frontier_text(value)
                ]
                claimed_action = cls._bounded_frontier_text(
                    continuation["next_action"]
                )
                if terminal_status == "completed" and claimed_action:
                    if claimed_action not in completed:
                        completed.append(claimed_action)
                    remaining = [
                        value for value in remaining if value != claimed_action
                    ]
                in_progress = None
                next_action = remaining[0] if remaining else None
        elif terminal_status == "completed" and not latest_todos and objective:
            completed = [objective]

        blocked_by: str | None = None
        if outcome_unknown:
            blocked_by = "external_tool_outcome_unknown"
        elif terminal_status != "completed":
            blocked_by = cls._bounded_frontier_text(
                terminal_payload.get("reason")
                or terminal_payload.get("error")
                or terminal_status
            )
        return {
            "objective": objective,
            "completed": completed,
            "in_progress": in_progress,
            "remaining": remaining,
            "next_action": next_action,
            "blocked_by": blocked_by,
            "artifact_ids": sorted(artifact_ids),
        }

    @classmethod
    def _refresh_project_execution_state_in_transaction(
        cls,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        terminal_status: str,
        terminal_payload: dict[str, Any],
        updated_at: float,
    ) -> None:
        run = connection.execute(
            "SELECT project_id FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if run is None:
            raise RunNotFoundError(f"run_id {run_id!r} does not exist")
        frontier = cls._project_frontier_for_terminal_run(
            connection,
            run_id=run_id,
            terminal_status=terminal_status,
            terminal_payload=terminal_payload,
        )
        frontier_json = canonical_json(frontier)
        frontier_digest = hashlib.sha256(
            frontier_json.encode("utf-8")
        ).hexdigest()
        current = connection.execute(
            "SELECT * FROM project_execution_states WHERE project_id = ?",
            (run["project_id"],),
        ).fetchone()
        if (
            current is not None
            and current["frontier_digest"] == frontier_digest
        ):
            return
        next_version = int(current["state_version"]) + 1 if current else 1
        connection.execute(
            """
            INSERT INTO project_execution_states(
                project_id, state_version, frontier_json, frontier_digest,
                frontier_run_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                state_version = excluded.state_version,
                frontier_json = excluded.frontier_json,
                frontier_digest = excluded.frontier_digest,
                frontier_run_id = excluded.frontier_run_id,
                updated_at = excluded.updated_at
            """,
            (
                run["project_id"],
                next_version,
                frontier_json,
                frontier_digest,
                run_id,
                updated_at,
            ),
        )

    @classmethod
    def _backfill_project_execution_state_in_transaction(
        cls,
        connection: sqlite3.Connection,
        *,
        project_id: str,
    ) -> None:
        existing = connection.execute(
            "SELECT 1 FROM project_execution_states WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        if existing is not None:
            return
        run = connection.execute(
            """
            SELECT run_id, status, updated_at
            FROM runs
            WHERE project_id = ?
              AND status IN ('completed', 'failed', 'cancelled', 'interrupted')
            ORDER BY updated_at DESC, created_at DESC, run_id DESC
            LIMIT 1
            """,
            (project_id,),
        ).fetchone()
        if run is None:
            return
        terminal_payload: dict[str, Any] = {}
        events = connection.execute(
            """
            SELECT event_type, payload_json, legacy_step
            FROM run_events WHERE run_id = ? ORDER BY sequence DESC
            """,
            (run["run_id"],),
        ).fetchall()
        for event in events:
            candidate = RunEventDraft(
                event_id="historical-frontier-probe",
                event_type=event["event_type"],
                payload=json.loads(event["payload_json"]),
                legacy_step=event["legacy_step"],
            )
            if cls._terminal_status_for_event(candidate) == run["status"]:
                terminal_payload = dict(candidate.payload)
                break
        cls._refresh_project_execution_state_in_transaction(
            connection,
            run_id=run["run_id"],
            terminal_status=run["status"],
            terminal_payload=terminal_payload,
            updated_at=float(run["updated_at"]),
        )

    @staticmethod
    def _latest_step_snapshots_in_transaction(
        connection: sqlite3.Connection,
        *,
        run_id: str,
    ) -> list[dict[str, Any]]:
        """Replay only the latest snapshot for every authored Step."""

        rows = connection.execute(
            """
            SELECT sequence, event_type, payload_json
            FROM run_events
            WHERE run_id = ? AND event_type LIKE 'step.%'
            ORDER BY sequence DESC
            """,
            (run_id,),
        ).fetchall()
        snapshots: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in rows:
            try:
                payload = json.loads(row["payload_json"])
            except (TypeError, ValueError):
                continue
            step = payload.get("step")
            if not isinstance(step, dict):
                continue
            step_id = str(step.get("step_id") or "").strip()
            if not step_id or step_id in seen:
                continue
            seen.add(step_id)
            snapshots.append(
                {
                    "sequence": int(row["sequence"]),
                    "event_type": str(row["event_type"]),
                    "payload": payload,
                    "step": step,
                }
            )
        return snapshots

    def _project_workforce_subtask_step_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        event: CommittedRunEvent,
    ) -> None:
        """Project one legacy Workforce event without leaving the txn."""

        self._apply_workforce_subtask_step_in_transaction(
            connection,
            run_id=run_id,
            event_type=event.event_type,
            payload=event.payload,
            provenance_source="legacy_workforce_projection",
        )

    def persist_workforce_subtask_step(
        self,
        *,
        run_id: str,
        expected_project_id: str,
        task_id: str,
        title: str,
        agent_id: str | None,
        phase: str,
        summary: str | None = None,
    ) -> str:
        """Author one Workforce Step transition in a single transaction.

        The producer calls this before publishing queue/dispatch UI facts.
        State lookup and transition commit share one SQLite writer lock, so a
        concurrent legacy projection cannot race the producer's decision.
        """

        event_type = {
            "queued": "subtask.queued",
            "running": "subtask.started",
            "completed": "subtask.completed",
            "failed": "subtask.failed",
            "cancelled": "subtask.cancelled",
        }.get(phase)
        if event_type is None:
            raise ValueError(f"unsupported Workforce Step phase {phase!r}")
        normalized_task_id = task_id.strip()
        if not normalized_task_id:
            raise ValueError("Workforce task id is required")

        from app.run_runtime.step_coordinator import stable_step_id

        with self._write_transaction() as connection:
            run = connection.execute(
                "SELECT project_id FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if run is None:
                raise RunNotFoundError(f"run_id {run_id!r} does not exist")
            if run["project_id"] != expected_project_id:
                raise IdempotencyConflictError(
                    f"run_id {run_id!r} belongs to another project"
                )
            self._apply_workforce_subtask_step_in_transaction(
                connection,
                run_id=run_id,
                event_type=event_type,
                payload={
                    "task_id": normalized_task_id,
                    "display_title": title,
                    "display_summary": summary,
                    "assignee_id": agent_id,
                },
                provenance_source="workforce_dispatch",
            )
        return stable_step_id(run_id, f"subtask:{normalized_task_id}")

    def _apply_workforce_subtask_step_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        event_type: str,
        payload: Mapping[str, Any],
        provenance_source: str,
    ) -> None:
        """Apply one Workforce lifecycle fact to authored Step history."""

        if event_type not in {
            "subtask.created",
            "subtask.queued",
            "subtask.started",
            "subtask.completed",
            "subtask.failed",
            "subtask.cancelled",
        }:
            return
        task_id = str(payload.get("task_id") or "").strip()
        if not task_id:
            return

        from app.run_runtime.step_coordinator import (
            stable_step_id,
            step_event_draft,
        )

        run = connection.execute(
            "SELECT active_attempt_id FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if run is None:
            raise RunNotFoundError(f"run_id {run_id!r} does not exist")

        plan_item_id = f"subtask:{task_id}"
        step_id = stable_step_id(run_id, plan_item_id)
        snapshots = self._latest_step_snapshots_in_transaction(
            connection,
            run_id=run_id,
        )
        snapshot = next(
            (
                candidate
                for candidate in snapshots
                if candidate["step"].get("step_id") == step_id
            ),
            None,
        )
        semantic = payload.get("semantic")
        actor = semantic.get("actor") if isinstance(semantic, dict) else None
        actor_id = (
            str(actor.get("id") or "").strip()
            if isinstance(actor, dict)
            else ""
        )
        agent_id = (
            str(payload.get("assignee_id") or "").strip() or actor_id or None
        )
        title = str(payload.get("display_title") or "Subtask")
        summary = str(payload.get("display_summary") or "").strip() or None

        def append_step(
            *,
            step: dict[str, Any],
            transition: str,
            status: str,
            transition_summary: str | None,
            reason_code: str | None = None,
        ) -> None:
            owner = step.get("owner")
            owner = owner if isinstance(owner, dict) else {}
            persisted_owner_kind = str(owner.get("kind") or "workforce")
            if persisted_owner_kind not in {
                "single_agent",
                "subagent",
                "workforce",
                "system",
            }:
                persisted_owner_kind = "workforce"
            persisted_source = str(step.get("source") or "workforce")
            if persisted_source not in {"plan", "subagent", "workforce"}:
                persisted_source = "workforce"
            self._append_event_in_transaction(
                connection,
                run_id,
                step_event_draft(
                    run_id=run_id,
                    attempt_id=(
                        str(run["active_attempt_id"])
                        if run["active_attempt_id"]
                        else None
                    ),
                    step_id=step_id,
                    plan_item_id=str(step.get("plan_item_id") or plan_item_id),
                    parent_step_id=(
                        str(step["parent_step_id"])
                        if step.get("parent_step_id")
                        else None
                    ),
                    title=str(step.get("title") or title),
                    summary=transition_summary,
                    ordinal=int(step.get("ordinal") or 0),
                    agent_id=(
                        str(owner["agent_id"])
                        if owner.get("agent_id")
                        else agent_id
                    ),
                    event=transition,
                    status=status,  # type: ignore[arg-type]
                    reason_code=reason_code,
                    provenance_source=provenance_source,
                    authored_by="system",
                    owner_kind=persisted_owner_kind,  # type: ignore[arg-type]
                    source=persisted_source,  # type: ignore[arg-type]
                ),
            )

        if snapshot is None:
            if event_type not in {
                "subtask.created",
                "subtask.queued",
                "subtask.started",
            }:
                # Parent completion facts and incomplete historical streams do
                # not prove that a delegated child Step ever existed.
                return
            step = {
                "step_id": step_id,
                "plan_item_id": plan_item_id,
                "parent_step_id": None,
                "title": title,
                "ordinal": max(
                    (
                        int(candidate["step"].get("ordinal") or 0)
                        for candidate in snapshots
                    ),
                    default=0,
                )
                + 1,
                "owner": {"kind": "workforce", "agent_id": agent_id},
                "source": "workforce",
            }
            append_step(
                step=step,
                transition="created",
                status="pending",
                transition_summary=None,
            )
            if event_type == "subtask.started":
                append_step(
                    step=step,
                    transition="started",
                    status="running",
                    transition_summary=summary or "Delegated work started.",
                )
            return

        step = snapshot["step"]
        current_status = str(step.get("status") or "pending")
        if event_type in {"subtask.created", "subtask.queued"}:
            return
        if event_type == "subtask.started":
            transition = {
                "pending": "started",
                "blocked": "resumed",
                "interrupted": "resumed",
            }.get(current_status)
            if transition is not None:
                append_step(
                    step=step,
                    transition=transition,
                    status="running",
                    transition_summary=summary or "Delegated work started.",
                )
            return

        outcome = {
            "subtask.completed": "completed",
            "subtask.failed": "failed",
            "subtask.cancelled": "cancelled",
        }[event_type]
        allowed = {"pending", "running", "blocked"}
        if outcome == "cancelled":
            allowed.add("interrupted")
        if current_status not in allowed:
            return
        append_step(
            step=step,
            transition=outcome,
            status=outcome,
            transition_summary=summary,
            reason_code=(
                "workforce_failed"
                if outcome == "failed"
                else "workforce_cancelled"
                if outcome == "cancelled"
                else None
            ),
        )

    @staticmethod
    def _step_belongs_to_attempt_in_transaction(
        connection: sqlite3.Connection,
        *,
        run_id: str,
        step_id: str,
        attempt_id: str | None,
    ) -> bool:
        """Return whether canonical Step history contains this binding.

        A stable Step identity may receive events across multiple Attempts.
        Correlation validation therefore scans historical Step facts instead
        of consulting only the newest replay snapshot.
        """

        rows = connection.execute(
            """
            SELECT payload_json FROM run_events
            WHERE run_id = ? AND event_type LIKE 'step.%'
            ORDER BY sequence DESC
            """,
            (run_id,),
        ).fetchall()
        for row in rows:
            try:
                payload = json.loads(row["payload_json"])
            except (TypeError, ValueError):
                continue
            step = payload.get("step")
            if not isinstance(step, dict) or step.get("step_id") != step_id:
                continue
            if attempt_id is None or payload.get("attempt_id") == attempt_id:
                return True
        return False

    @staticmethod
    def _interaction_step_id_in_transaction(
        connection: sqlite3.Connection,
        *,
        run_id: str,
        interaction_id: str,
    ) -> str | None:
        rows = connection.execute(
            """
            SELECT payload_json
            FROM run_events
            WHERE run_id = ?
              AND event_type IN ('interaction.requested', 'approval.requested')
            ORDER BY sequence DESC
            """,
            (run_id,),
        ).fetchall()
        for row in rows:
            try:
                payload = json.loads(row["payload_json"])
            except (TypeError, ValueError):
                continue
            candidate_id = payload.get("interaction_id") or payload.get(
                "approval_id"
            )
            if str(candidate_id or "") != interaction_id:
                continue
            step_id = str(payload.get("step_id") or "").strip()
            return step_id or None
        return None

    @staticmethod
    def _tool_step_id_in_transaction(
        connection: sqlite3.Connection,
        *,
        run_id: str,
        tool_call_id: str,
    ) -> str | None:
        """Recover ToolCall-to-Step correlation from canonical events."""

        rows = connection.execute(
            """
            SELECT payload_json
            FROM run_events
            WHERE run_id = ? AND event_type LIKE 'tool.%'
            ORDER BY sequence DESC
            """,
            (run_id,),
        ).fetchall()
        for row in rows:
            try:
                payload = json.loads(row["payload_json"])
            except (TypeError, ValueError):
                continue
            if str(payload.get("tool_call_id") or "") != tool_call_id:
                continue
            step_id = str(payload.get("step_id") or "").strip()
            if step_id:
                return step_id
        return None

    def _append_step_transition_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        event: str,
        status: str,
        allowed_previous: set[str],
        attempt_id: str | None,
        reason_code: str,
        provenance_source: str,
        step_id: str | None = None,
    ) -> str | None:
        snapshots = self._latest_step_snapshots_in_transaction(
            connection,
            run_id=run_id,
        )
        eligible_statuses = set(allowed_previous)
        if event == "blocked":
            # More than one approval/interaction may share the same authored
            # Step. The first request transitions it to blocked; later
            # requests keep the same explicit correlation without emitting a
            # duplicate lifecycle transition.
            eligible_statuses.add("blocked")
        eligible = [
            candidate
            for candidate in snapshots
            if (step_id is None or candidate["step"].get("step_id") == step_id)
            and candidate["step"].get("status") in eligible_statuses
        ]
        # Without an explicit identity, only one eligible Step is proof. In a
        # parent/child or multi-agent Run, choosing the newest candidate would
        # create a false canonical relationship.
        if len(eligible) != 1:
            return None
        snapshot = eligible[0]
        if event == "blocked" and snapshot["step"].get("status") == "blocked":
            return str(snapshot["step"]["step_id"])
        step = snapshot["step"]
        owner = step.get("owner")
        owner = owner if isinstance(owner, dict) else {}
        owner_kind = str(owner.get("kind") or "single_agent")
        if owner_kind not in {
            "single_agent",
            "subagent",
            "workforce",
            "system",
        }:
            owner_kind = "single_agent"
        step_source = str(step.get("source") or "plan")
        if step_source not in {"plan", "subagent", "workforce"}:
            step_source = "plan"
        from app.run_runtime.step_coordinator import step_event_draft

        draft = step_event_draft(
            run_id=run_id,
            attempt_id=attempt_id,
            step_id=str(step["step_id"]),
            plan_item_id=str(step.get("plan_item_id") or step["step_id"]),
            parent_step_id=(
                str(step["parent_step_id"])
                if step.get("parent_step_id")
                else None
            ),
            title=str(step.get("title") or "Task step"),
            summary=(str(step["summary"]) if step.get("summary") else None),
            ordinal=int(step.get("ordinal") or 0),
            agent_id=(
                str(owner["agent_id"]) if owner.get("agent_id") else None
            ),
            event=event,
            status=status,  # type: ignore[arg-type]
            reason_code=reason_code,
            provenance_source=provenance_source,
            authored_by="system",
            owner_kind=owner_kind,  # type: ignore[arg-type]
            source=step_source,  # type: ignore[arg-type]
        )
        self._append_event_in_transaction(connection, run_id, draft)
        return str(step["step_id"])

    def _append_step_terminals_for_run_transition_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str,
        run_status: str,
        attempt_id: str | None,
        reason_code: str,
    ) -> None:
        transition = {
            "interrupted": (
                "interrupted",
                "interrupted",
                {"running", "blocked"},
            ),
            "completed": ("completed", "completed", {"running"}),
            "failed": ("failed", "failed", {"running", "blocked"}),
            "cancelled": (
                "cancelled",
                "cancelled",
                {"pending", "running", "blocked", "interrupted"},
            ),
        }.get(run_status)
        if transition is None:
            return
        event, status, allowed = transition
        step_ids = [
            str(snapshot["step"]["step_id"])
            for snapshot in self._latest_step_snapshots_in_transaction(
                connection,
                run_id=run_id,
            )
            if snapshot["step"].get("status") in allowed
        ]
        for current_step_id in step_ids:
            self._append_step_transition_in_transaction(
                connection,
                run_id=run_id,
                step_id=current_step_id,
                event=event,
                status=status,
                allowed_previous=allowed,
                attempt_id=attempt_id,
                reason_code=reason_code,
                provenance_source="run_terminal_reconciliation",
            )
        cancel_unstarted = {
            "completed": {"pending", "blocked", "interrupted"},
            "failed": {"pending", "interrupted"},
        }.get(run_status, set())
        if not cancel_unstarted:
            return
        pending_step_ids = [
            str(snapshot["step"]["step_id"])
            for snapshot in self._latest_step_snapshots_in_transaction(
                connection,
                run_id=run_id,
            )
            if snapshot["step"].get("status") in cancel_unstarted
        ]
        for pending_step_id in pending_step_ids:
            self._append_step_transition_in_transaction(
                connection,
                run_id=run_id,
                step_id=pending_step_id,
                event="cancelled",
                status="cancelled",
                allowed_previous=cancel_unstarted,
                attempt_id=attempt_id,
                reason_code=f"{reason_code}:not_executed",
                provenance_source="run_terminal_reconciliation",
            )

    def _append_event_in_transaction(
        self,
        connection: sqlite3.Connection,
        run_id: str,
        draft: RunEventDraft,
        *,
        payload_json: str | None = None,
        expected_version: int | None = None,
        expected_project_id: str | None = None,
        run_status: str | None = None,
        active_attempt_id: str | None = None,
        clear_active_attempt: bool = False,
        allow_assistant_final: bool = False,
    ) -> CommittedRunEvent:
        encoded_payload = payload_json or json.dumps(
            dict(draft.payload),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        duplicate = connection.execute(
            "SELECT * FROM run_events WHERE event_id = ?",
            (draft.event_id,),
        ).fetchone()
        if duplicate is not None:
            if expected_project_id is not None:
                owner = connection.execute(
                    "SELECT project_id FROM runs WHERE run_id = ?",
                    (duplicate["run_id"],),
                ).fetchone()
                if (
                    owner is not None
                    and owner["project_id"] != expected_project_id
                ):
                    raise IdempotencyConflictError(
                        f"event_id {draft.event_id!r} belongs to project "
                        f"{owner['project_id']!r}, not {expected_project_id!r}"
                    )
            return self._resolve_duplicate_event(
                connection,
                duplicate,
                run_id=run_id,
                draft=draft,
                payload_json=encoded_payload,
            )
        run = connection.execute(
            "SELECT * FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if run is None:
            raise RunNotFoundError(f"run_id {run_id!r} does not exist")
        if run["origin"] == "cloud_restore":
            raise InvalidRunTransitionError(
                f"run {run_id!r} is read-only Cloud-restored history"
            )
        if draft.event_type == "assistant.final":
            if not allow_assistant_final:
                raise InvalidRunTransitionError(
                    "assistant.final may only be committed atomically with "
                    "run.completed"
                )
            if run["status"] not in {
                "pending",
                "running",
                "waiting_for_user",
                "interrupted",
            }:
                raise InvalidRunTransitionError(
                    f"terminal run {run_id!r} cannot accept assistant.final"
                )
        if run_status is not None and not transition_allowed(
            RUN_TRANSITIONS,
            str(run["status"]),
            run_status,
        ):
            raise InvalidRunTransitionError(
                f"run {run_id!r} cannot move from {run['status']!r} to {run_status!r}"
            )
        if (
            expected_project_id is not None
            and run["project_id"] != expected_project_id
        ):
            raise IdempotencyConflictError(
                f"run_id {run_id!r} belongs to project {run['project_id']!r}, "
                f"not {expected_project_id!r}"
            )
        current_version = int(run["version"])
        if (
            expected_version is not None
            and current_version != expected_version
        ):
            raise OptimisticConcurrencyError(
                f"run_id {run_id!r} expected version {expected_version}, "
                f"found {current_version}"
            )
        if run_status in {"interrupted", "completed", "failed", "cancelled"}:
            self._close_dispatched_model_invocations_in_transaction(
                connection,
                run_id=run_id,
                terminal_event_type=draft.event_type,
                timestamp=draft.created_at,
            )
            self._append_step_terminals_for_run_transition_in_transaction(
                connection,
                run_id=run_id,
                run_status=run_status,
                attempt_id=(active_attempt_id or run["active_attempt_id"]),
                reason_code=str(
                    draft.payload.get("reason")
                    or draft.payload.get("reason_code")
                    or f"run_{run_status}"
                ),
            )
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert run is not None
            current_version = int(run["version"])
        if run_status in {"completed", "failed", "cancelled"}:
            self._cancel_open_human_interactions_in_transaction(
                connection,
                run_id=run_id,
                timestamp=draft.created_at,
                reason=f"run_terminal:{run_status}",
            )
            # Cancellation events advance the Run version inside this same
            # transaction. Commit the terminal event against that new head.
            run = connection.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            assert run is not None
            current_version = int(run["version"])
        sequence = int(
            connection.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = ?",
                (run_id,),
            ).fetchone()[0]
        )
        connection.execute(
            """
            INSERT INTO run_events(
                event_id, run_id, sequence, run_version, event_type,
                payload_json, legacy_step, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                draft.event_id,
                run_id,
                sequence,
                current_version + 1,
                draft.event_type,
                encoded_payload,
                draft.legacy_step,
                draft.created_at,
            ),
        )
        self._allocate_project_history_cursor_in_transaction(
            connection,
            project_id=str(run["project_id"]),
            event_id=draft.event_id,
            created_at=draft.created_at,
        )
        connection.execute(
            """
            INSERT INTO run_event_sync_outbox(
                event_id, run_id, run_sequence, status, attempt_count,
                next_attempt_at, last_error, created_at, updated_at
            ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?, ?)
            """,
            (
                draft.event_id,
                run_id,
                sequence,
                draft.created_at,
                draft.created_at,
                draft.created_at,
            ),
        )
        updated = connection.execute(
            """UPDATE runs
            SET version = version + 1,
                updated_at = ?,
                status = CASE WHEN ? THEN ? ELSE status END,
                active_attempt_id = CASE
                    WHEN ? THEN NULL
                    WHEN ? THEN ?
                    ELSE active_attempt_id
                END
            WHERE run_id = ? AND version = ?""",
            (
                draft.created_at,
                run_status is not None,
                run_status,
                clear_active_attempt,
                not clear_active_attempt and active_attempt_id is not None,
                active_attempt_id,
                run_id,
                current_version,
            ),
        )
        if updated.rowcount != 1:
            raise OptimisticConcurrencyError(
                f"run_id {run_id!r} changed while appending event"
            )
        if run_status is not None and run_status in {
            "interrupted",
            "completed",
            "failed",
            "cancelled",
        }:
            connection.execute(
                "DELETE FROM project_run_execution_leases WHERE run_id = ?",
                (run_id,),
            )
            if draft.payload.get("advance_project_state", True) is not False:
                self._refresh_project_execution_state_in_transaction(
                    connection,
                    run_id=run_id,
                    terminal_status=run_status,
                    terminal_payload=dict(draft.payload),
                    updated_at=draft.created_at,
                )
        return CommittedRunEvent(
            event_id=draft.event_id,
            run_id=run_id,
            sequence=sequence,
            event_type=draft.event_type,
            payload=dict(draft.payload),
            legacy_step=draft.legacy_step,
            created_at=draft.created_at,
            run_version=current_version + 1,
        )

    @staticmethod
    def _insert_model_invocation_event(
        connection: sqlite3.Connection,
        *,
        invocation_id: str,
        event_type: str,
        payload: dict[str, Any],
        created_at: float,
    ) -> None:
        event_index = int(
            connection.execute(
                """
                SELECT COALESCE(MAX(event_index), 0) + 1
                FROM model_invocation_events WHERE invocation_id = ?
                """,
                (invocation_id,),
            ).fetchone()[0]
        )
        connection.execute(
            """
            INSERT INTO model_invocation_events(
                event_id, invocation_id, event_index, event_type,
                payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                f"model-invocation-event:{invocation_id}:{event_index}",
                invocation_id,
                event_index,
                event_type,
                canonical_json(payload),
                created_at,
            ),
        )

    @staticmethod
    def _allocate_project_history_cursor_in_transaction(
        connection: sqlite3.Connection,
        *,
        project_id: str,
        event_id: str,
        created_at: float,
    ) -> int:
        existing = connection.execute(
            """
            SELECT journal_cursor FROM project_history_events
            WHERE event_id = ?
            """,
            (event_id,),
        ).fetchone()
        if existing is not None:
            return int(existing["journal_cursor"])

        cursor_row = connection.execute(
            """
            SELECT next_cursor FROM project_history_cursors
            WHERE project_id = ?
            """,
            (project_id,),
        ).fetchone()
        if cursor_row is None:
            cursor = 1
            connection.execute(
                """
                INSERT INTO project_history_cursors(
                    project_id, next_cursor, updated_at
                ) VALUES (?, 2, ?)
                """,
                (project_id, created_at),
            )
        else:
            cursor = int(cursor_row["next_cursor"])
            connection.execute(
                """
                UPDATE project_history_cursors
                SET next_cursor = ?, updated_at = ?
                WHERE project_id = ?
                """,
                (cursor + 1, created_at, project_id),
            )
        connection.execute(
            """
            INSERT INTO project_history_events(
                project_id, journal_cursor, event_id, source_kind, created_at
            ) VALUES (?, ?, ?, 'native', ?)
            """,
            (project_id, cursor, event_id, created_at),
        )
        return cursor

    def _migrate(self) -> None:
        version = int(
            self._connection.execute("PRAGMA user_version").fetchone()[0]
        )
        if version > SCHEMA_VERSION:
            raise UnsupportedSchemaVersionError(
                f"RunJournal schema {version} is newer than supported "
                f"version {SCHEMA_VERSION}"
            )
        if version < 1:
            self._connection.executescript(_MIGRATION_V1)
        if version < 2:
            self._connection.executescript(_MIGRATION_V2)
        if version < 3:
            self._connection.executescript(_MIGRATION_V3)
        if version < 4:
            self._connection.executescript(_MIGRATION_V4)
        if version < 5:
            self._connection.executescript(_MIGRATION_V5)
        if version < 6:
            self._connection.executescript(_MIGRATION_V6)
        if version < 7:
            self._connection.executescript(_MIGRATION_V7)
        if version < 8:
            self._connection.executescript(_MIGRATION_V8)
        if version < 9:
            self._connection.executescript(_MIGRATION_V9)
        if version < 10:
            self._connection.executescript(_MIGRATION_V10)
        if version < 11:
            self._connection.executescript(_MIGRATION_V11)
        if version < 12:
            self._connection.executescript(_MIGRATION_V12)
        if version < 13:
            self._connection.executescript(_MIGRATION_V13)
        if version < 14:
            self._connection.executescript(_MIGRATION_V14)
        if version < 15:
            self._connection.executescript(_MIGRATION_V15)
        if version < 16:
            self._connection.executescript(_MIGRATION_V16)
        if version < 17:
            self._connection.executescript(_MIGRATION_V17)
        if version < 18:
            self._connection.executescript(_MIGRATION_V18)
        if version < 19:
            self._connection.executescript(_MIGRATION_V19)
        if version < 20:
            self._connection.executescript(_MIGRATION_V20)
        if version < 21:
            migration = _MIGRATION_V21
            follow_up_columns = {
                row["name"]
                for row in self._connection.execute(
                    "PRAGMA table_info(follow_up_requests)"
                ).fetchall()
            }
            if "source" in follow_up_columns:
                migration = migration.replace(
                    """ALTER TABLE follow_up_requests
ADD COLUMN source TEXT NOT NULL DEFAULT 'local'
    CHECK(source IN ('local', 'remote_control', 'scheduled'));
""",
                    "",
                )
            if "source_command_id" in follow_up_columns:
                migration = migration.replace(
                    """ALTER TABLE follow_up_requests ADD COLUMN source_command_id TEXT;
""",
                    "",
                )
            self._connection.executescript(migration)
        if version < 22:
            self._connection.executescript(_MIGRATION_V22)
        if version < 23:
            columns = {
                row["name"]
                for row in self._connection.execute(
                    "PRAGMA table_info(memory_mutation_outbox)"
                ).fetchall()
            }
            migration = _MIGRATION_V23
            if "payload_json" in columns:
                migration = migration.replace(
                    "ALTER TABLE memory_mutation_outbox\n"
                    "ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';\n",
                    "",
                )
            if "scope_revision" in columns:
                migration = migration.replace(
                    "ALTER TABLE memory_mutation_outbox\n"
                    "ADD COLUMN scope_revision INTEGER NOT NULL DEFAULT 0;\n",
                    "",
                )
            self._connection.executescript(migration)
        if version < 24:
            self._connection.executescript(_MIGRATION_V24)
        if version < 25:
            self._connection.executescript(_MIGRATION_V25)
        if version < 26:
            self._connection.executescript(_MIGRATION_V26)
        if version < 27:
            self._connection.executescript(_MIGRATION_V27)
        if version < 28:
            inbox_columns = {
                row["name"]
                for row in self._connection.execute(
                    "PRAGMA table_info(remote_command_inbox)"
                ).fetchall()
            }
            migration = _MIGRATION_V28
            if "delivery_lease_token" in inbox_columns:
                migration = migration.replace(
                    "ALTER TABLE remote_command_inbox "
                    "ADD COLUMN delivery_lease_token TEXT;\n",
                    "",
                )
            self._connection.executescript(migration)
        if version < 29:
            self._connection.executescript(_MIGRATION_V29)
        if version < 30:
            self._connection.executescript(_MIGRATION_V30)
        if version < 31:
            self._connection.executescript(_MIGRATION_V31)
        if version < 32:
            self._connection.executescript(_MIGRATION_V32)
        if version < 33:
            follow_up_columns = {
                row["name"]
                for row in self._connection.execute(
                    "PRAGMA table_info(follow_up_requests)"
                ).fetchall()
            }
            migration = _MIGRATION_V33
            if "review_handoff_ids_json" in follow_up_columns:
                migration = migration.replace(
                    "ALTER TABLE follow_up_requests\n"
                    "ADD COLUMN review_handoff_ids_json TEXT NOT NULL "
                    "DEFAULT '[]';\n",
                    "",
                )
            self._connection.executescript(migration)
        if version < 34:
            attempt_columns = {
                row["name"]
                for row in self._connection.execute(
                    "PRAGMA table_info(run_attempts)"
                ).fetchall()
            }
            migration = _MIGRATION_V34
            for column, statement in (
                (
                    "workload_kind",
                    "ALTER TABLE run_attempts\n"
                    "ADD COLUMN workload_kind TEXT NOT NULL DEFAULT "
                    "'production'\n"
                    "    CHECK(workload_kind IN "
                    "('production', 'test', 'ab', 'rollout'));\n",
                ),
                (
                    "workload_profile_json",
                    "ALTER TABLE run_attempts\n"
                    "ADD COLUMN workload_profile_json TEXT NOT NULL\n"
                    '    DEFAULT \'{"budget_policy_ref":"budget.product-default.v1","capture_policy_ref":"capture.best-effort.v1","isolation_policy_ref":"isolation.product-default.v1","network_policy_ref":"network.product-default.v1","profile_version":"1","retention_policy_ref":"retention.product-default.v1","schema_version":1,"verifier_policy_ref":"verifier.noop.v1","workload_kind":"production"}\';\n',
                ),
                (
                    "workload_profile_digest",
                    "ALTER TABLE run_attempts\n"
                    "ADD COLUMN workload_profile_digest TEXT NOT NULL\n"
                    "    DEFAULT '4786bb51388abddfbbe18decc88ada3e3e896b4aa9967970c2b99865d4999302'\n"
                    "    CHECK(length(workload_profile_digest) = 64);\n",
                ),
            ):
                if column in attempt_columns:
                    migration = migration.replace(statement, "")
            model_invocation_columns = {
                row["name"]
                for row in self._connection.execute(
                    "PRAGMA table_info(model_invocations)"
                ).fetchall()
            }
            if "step_id" in model_invocation_columns:
                migration = migration.replace(
                    "ALTER TABLE model_invocations ADD COLUMN step_id TEXT;\n",
                    "",
                )
            self._connection.executescript(migration)

    @contextmanager
    def _write_transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                yield self._connection
            except BaseException:
                self._connection.rollback()
                raise
            else:
                self._connection.commit()

    @contextmanager
    def _savepoint(
        self,
        connection: sqlite3.Connection,
        prefix: str,
    ) -> Iterator[None]:
        name = f"{prefix}_{uuid.uuid4().hex}"
        connection.execute(f"SAVEPOINT {name}")
        try:
            yield
        except BaseException:
            connection.execute(f"ROLLBACK TO SAVEPOINT {name}")
            connection.execute(f"RELEASE SAVEPOINT {name}")
            raise
        else:
            connection.execute(f"RELEASE SAVEPOINT {name}")

    def _resolve_duplicate_event(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        *,
        run_id: str,
        draft: RunEventDraft,
        payload_json: str,
    ) -> CommittedRunEvent:
        if (
            row["run_id"] != run_id
            or row["event_type"] != draft.event_type
            or row["payload_json"] != payload_json
            or row["legacy_step"] != draft.legacy_step
        ):
            raise IdempotencyConflictError(
                f"event_id {draft.event_id!r} was reused with different data"
            )
        return self._event_from_row(row)

    @staticmethod
    def _assert_batch_lease(
        connection: sqlite3.Connection,
        batch: RunEventSyncBatch,
        event_ids: list[str],
    ) -> None:
        if not event_ids:
            raise ValueError("outbox batch must contain events")
        count = int(
            connection.execute(
                """
                SELECT COUNT(*)
                FROM run_event_sync_outbox
                WHERE status = 'sending' AND lease_token = ?
                  AND event_id IN (SELECT value FROM json_each(?))
                """,
                (
                    batch.lease_token,
                    json.dumps(event_ids, separators=(",", ":")),
                ),
            ).fetchone()[0]
        )
        if count != len(event_ids):
            raise OutboxLeaseLostError(
                f"outbox lease for {batch.run_id!r} is stale"
            )

    @staticmethod
    def _assert_command_batch_lease(
        connection: sqlite3.Connection,
        batch: CommandResultSyncBatch,
        event_ids: list[str],
    ) -> None:
        if not event_ids:
            raise ValueError("command outbox batch must contain events")
        count = int(
            connection.execute(
                """
                SELECT COUNT(*) FROM command_result_outbox
                WHERE status = 'sending' AND lease_token = ?
                  AND event_id IN (SELECT value FROM json_each(?))
                """,
                (
                    batch.lease_token,
                    json.dumps(event_ids, separators=(",", ":")),
                ),
            ).fetchone()[0]
        )
        if count != len(event_ids):
            raise OutboxLeaseLostError(
                f"command outbox lease for {batch.command_id!r} is stale"
            )

    @staticmethod
    def _tool_call_requires_fail_closed(tool: sqlite3.Row) -> bool:
        safety = ToolSafetyClass(tool["safety_class"])
        return not automatic_tool_replay_allowed(
            safety,
            idempotency_key=tool["idempotency_key"],
        )

    def _repair_restart_interrupted_internal_controls_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        run_id: str | None,
        timestamp: float,
        source: str,
        include_dispatched: bool,
    ) -> tuple[str, ...]:
        """Terminalize process-local controls that cannot survive a restart.

        ``INTERNAL_CONTROL`` remains fail-closed while the owning Brain is
        alive: cancelling an await does not prove that a delegated thread has
        stopped. Once that process has restarted, however, an in-memory CAMEL
        sub-agent cannot still be running. Its own nested ToolCalls remain the
        authoritative ledger for any side effects and retain their independent
        replay safety. Keeping the parent control as ``outcome_unknown`` would
        therefore strand an otherwise safely resumable Run forever.

        The ``outcome_unknown`` branch repairs rows written by older startup
        reconciliation releases, so Resume admission heals existing local
        journals without manual database edits.
        """

        rows = connection.execute(
            """
            SELECT * FROM tool_calls
            WHERE safety_class = 'internal_control'
              AND (? IS NULL OR run_id = ?)
              AND (
                    (
                        status = 'outcome_unknown'
                        AND timeout_reason = 'brain_restart_after_dispatch'
                    )
                    OR (
                        ? = 1
                        AND status = 'dispatched'
                        AND outcome IS NULL
                    )
              )
            ORDER BY created_at, tool_call_id
            """,
            (run_id, run_id, int(include_dispatched)),
        ).fetchall()
        repaired: list[str] = []
        for tool in rows:
            tool_call_id = str(tool["tool_call_id"])
            tool_run_id = str(tool["run_id"])
            tool_step_id = self._tool_step_id_in_transaction(
                connection,
                run_id=tool_run_id,
                tool_call_id=tool_call_id,
            )
            result = {
                "error": "In-process delegated work stopped when Eigent restarted",
                "delegated_work_may_still_be_running": False,
                "safe_to_resume": True,
            }
            updated = connection.execute(
                """
                UPDATE tool_calls
                SET status = 'failed',
                    outcome = 'interrupted_by_restart',
                    timeout_reason = COALESCE(
                        timeout_reason,
                        'brain_restart_after_dispatch'
                    ),
                    result_json = COALESCE(?, result_json),
                    completed_at = COALESCE(completed_at, ?),
                    updated_at = ?
                WHERE tool_call_id = ?
                  AND safety_class = 'internal_control'
                  AND (? IS NULL OR run_id = ?)
                  AND (
                        (
                            status = 'outcome_unknown'
                            AND timeout_reason = 'brain_restart_after_dispatch'
                        )
                        OR (
                            ? = 1
                            AND status = 'dispatched'
                            AND outcome IS NULL
                        )
                  )
                """,
                (
                    canonical_json(result),
                    timestamp,
                    timestamp,
                    tool_call_id,
                    run_id,
                    run_id,
                    int(include_dispatched),
                ),
            )
            if updated.rowcount != 1:
                continue
            payload = {
                "tool_call_id": tool_call_id,
                "attempt_id": tool["attempt_id"],
                "tool_name": tool["tool_name"],
                "safety_class": tool["safety_class"],
                "status": "failed",
                "outcome": "interrupted_by_restart",
                "timeout_reason": "brain_restart_after_dispatch",
                "reason": "brain_restart_after_dispatch",
                "outcome_known": True,
                "request": json.loads(tool["request_json"] or "{}"),
                "result": result,
                "step_id": tool_step_id,
                "display_title": "Sub-agent stopped when Eigent closed",
                "display_output": (
                    "The in-process sub-agent cannot survive a Backend restart. "
                    "Resume can safely continue unfinished work."
                ),
                "display_summary": "Interrupted by restart; safe to resume",
            }
            payload.update(
                semantic_event_fields(
                    kind="subtask",
                    subject_type="tool_call",
                    subject_id=tool_call_id,
                    phase="failed",
                    status="failed",
                    source=source,
                    actor_type="system",
                    correlation={
                        "attempt_id": tool["attempt_id"],
                        "step_id": tool_step_id,
                    },
                )
            )
            self._append_event_in_transaction(
                connection,
                tool_run_id,
                RunEventDraft(
                    event_id=f"recovery:internal-control-interrupted:{tool_call_id}",
                    event_type="tool.failed",
                    payload=payload,
                    created_at=timestamp,
                ),
            )
            if tool_step_id:
                self._append_step_transition_in_transaction(
                    connection,
                    run_id=tool_run_id,
                    step_id=tool_step_id,
                    event="cancelled",
                    status="cancelled",
                    allowed_previous={
                        "pending",
                        "running",
                        "blocked",
                        "interrupted",
                        "outcome_unknown",
                    },
                    attempt_id=(
                        str(tool["attempt_id"]) if tool["attempt_id"] else None
                    ),
                    reason_code="brain_restart_after_dispatch",
                    provenance_source=source,
                )
            repaired.append(tool_call_id)
        return tuple(repaired)

    @staticmethod
    def _unsafe_resume_blockers(
        connection: sqlite3.Connection, run_id: str
    ) -> list[str]:
        rows = connection.execute(
            """
            SELECT tool_call_id, safety_class, idempotency_key
            FROM tool_calls
            WHERE run_id = ?
              AND status IN ('dispatched', 'timed_out', 'outcome_unknown')
            ORDER BY created_at
            """,
            (run_id,),
        ).fetchall()
        return [
            row["tool_call_id"]
            for row in rows
            if SQLiteRunJournal._tool_call_requires_fail_closed(row)
        ]

    def _finish_command_result_batch(
        self,
        batch: CommandResultSyncBatch,
        status: str,
        *,
        error: str | None = None,
        next_attempt_at: float | None = None,
        increment_attempt: bool = False,
        now: float | None = None,
    ) -> None:
        timestamp = now if now is not None else time.time()
        event_ids = [event.event_id for event in batch.events]
        with self._write_transaction() as connection:
            self._assert_command_batch_lease(connection, batch, event_ids)
            connection.execute(
                """
                UPDATE command_result_outbox
                SET status = ?,
                    attempt_count = attempt_count + ?,
                    next_attempt_at = COALESCE(?, next_attempt_at),
                    lease_token = NULL, lease_until = NULL,
                    last_error = ?, updated_at = ?
                WHERE event_id IN (SELECT value FROM json_each(?))
                """,
                (
                    status,
                    int(increment_attempt),
                    next_attempt_at,
                    error[:4000] if error else None,
                    timestamp,
                    json.dumps(event_ids, separators=(",", ":")),
                ),
            )

    @staticmethod
    def _run_from_row(row: sqlite3.Row) -> RunRecord:
        return RunRecord(
            run_id=row["run_id"],
            project_id=row["project_id"],
            status=row["status"],
            version=int(row["version"]),
            active_attempt_id=row["active_attempt_id"],
            deadline_at=row["deadline_at"],
            timeout_policy_version=row["timeout_policy_version"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
            parent_run_id=row["parent_run_id"],
            timeout_policy=json.loads(row["timeout_policy_json"] or "{}"),
            cancel_request_id=row["cancel_request_id"],
            cancel_requested_at=(
                float(row["cancel_requested_at"])
                if row["cancel_requested_at"] is not None
                else None
            ),
            origin=row["origin"],
            resume_blocked_reason=row["resume_blocked_reason"],
        )

    @staticmethod
    def _cloud_restored_status(status: str) -> str:
        if status in {"completed", "failed", "cancelled"}:
            return status
        return "interrupted"

    @staticmethod
    def _attempt_from_row(row: sqlite3.Row) -> RunAttemptRecord:
        workload_profile = workload_profile_from_payload(
            json.loads(row["workload_profile_json"])
        )
        if workload_profile.workload_kind != row["workload_kind"]:
            raise RunJournalError("persisted WorkloadProfile kind mismatch")
        persisted_workload_digest = row["workload_profile_digest"]
        if (
            workload_profile_digest(workload_profile)
            != persisted_workload_digest
        ):
            raise RunJournalError("persisted WorkloadProfile digest mismatch")
        return RunAttemptRecord(
            attempt_id=row["attempt_id"],
            run_id=row["run_id"],
            attempt_number=int(row["attempt_number"]),
            status=row["status"],
            started_at=float(row["started_at"]),
            ended_at=(
                float(row["ended_at"]) if row["ended_at"] is not None else None
            ),
            outcome=row["outcome"],
            timeout_reason=row["timeout_reason"],
            resume_request_id=row["resume_request_id"],
            resume_reason=row["resume_reason"],
            policy_version=row["policy_version"],
            elapsed_active_ms=int(row["elapsed_active_ms"]),
            last_consumer_heartbeat_at=(
                float(row["last_consumer_heartbeat_at"])
                if row["last_consumer_heartbeat_at"] is not None
                else None
            ),
            environment_spec_id=row["environment_spec_id"],
            environment_spec_digest=row["environment_spec_digest"],
            bundle_revision_id=row["bundle_revision_id"],
            permission_profile_revision=row["permission_profile_revision"],
            thinking_effort_requested=row["thinking_effort_requested"],
            thinking_effort_effective=row["thinking_effort_effective"],
            provider_capability_revision=row["provider_capability_revision"],
            workload_profile=workload_profile,
            workload_profile_digest=persisted_workload_digest,
        )

    @staticmethod
    def _attempt_environment_values(
        environment: AttemptEnvironmentBinding | None,
    ) -> tuple[str | None, ...]:
        if environment is None:
            return (None, None, None, None, None, None, None)
        required = (
            environment.environment_spec_id,
            environment.environment_spec_digest,
            environment.bundle_revision_id,
            environment.permission_profile_revision,
            environment.provider_capability_revision,
        )
        if any(not value.strip() for value in required):
            raise ValueError("Attempt environment binding fields are required")
        for value in (
            environment.thinking_effort_requested,
            environment.thinking_effort_effective,
        ):
            try:
                ThinkingEffort(value)
            except ValueError as exc:
                raise ValueError(
                    f"invalid persisted thinking effort {value!r}"
                ) from exc
        return (
            environment.environment_spec_id,
            environment.environment_spec_digest,
            environment.bundle_revision_id,
            environment.permission_profile_revision,
            environment.thinking_effort_requested,
            environment.thinking_effort_effective,
            environment.provider_capability_revision,
        )

    @staticmethod
    def _attempt_workload_values(
        profile: WorkloadProfileRecord,
    ) -> tuple[str, str, str]:
        payload = workload_profile_payload(profile)
        return (
            profile.workload_kind,
            canonical_json(payload),
            workload_profile_digest(profile),
        )

    @staticmethod
    def _workspace_config_revision_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceConfigRevisionRecord:
        return WorkspaceConfigRevisionRecord(
            revision_id=row["revision_id"],
            bundle_id=row["bundle_id"],
            revision_number=int(row["revision_number"]),
            status=row["status"],
            version=int(row["version"]),
            manifest=json.loads(row["manifest_json"]),
            manifest_digest=row["manifest_digest"],
            created_by=row["created_by"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _workspace_config_materialization_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceConfigMaterializationRecord:
        return WorkspaceConfigMaterializationRecord(
            materialization_id=row["materialization_id"],
            space_id=row["space_id"],
            revision_id=row["revision_id"],
            config_placement=row["config_placement"],
            state=row["state"],
            local_override_digest=row["local_override_digest"],
            materialized_at=(
                float(row["materialized_at"])
                if row["materialized_at"] is not None
                else None
            ),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _workspace_config_draft_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceConfigDraftRecord:
        return WorkspaceConfigDraftRecord(
            space_id=row["space_id"],
            version=int(row["version"]),
            base_revision_id=row["base_revision_id"],
            document=json.loads(row["document_json"]),
            document_digest=row["document_digest"],
            updated_by=row["updated_by"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _workspace_config_draft_asset_descriptor_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceConfigDraftAssetDescriptorRecord:
        return WorkspaceConfigDraftAssetDescriptorRecord(
            space_id=row["space_id"],
            draft_version=int(row["draft_version"]),
            document_digest=row["document_digest"],
            logical_path=row["logical_path"],
            content_digest=row["content_digest"],
            media_type=row["media_type"],
            size_bytes=int(row["size_bytes"]),
            executable=bool(row["executable"]),
            provenance=row["provenance"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _workspace_config_draft_from_import_request(
        row: sqlite3.Row,
    ) -> WorkspaceConfigDraftRecord:
        return WorkspaceConfigDraftRecord(
            space_id=row["space_id"],
            version=int(row["result_version"]),
            base_revision_id=row["result_base_revision_id"],
            document=json.loads(row["result_document_json"]),
            document_digest=row["result_document_digest"],
            updated_by=row["result_updated_by"],
            created_at=float(row["result_created_at"]),
            updated_at=float(row["result_updated_at"]),
        )

    @staticmethod
    def _workspace_bundle_install_proposal_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceBundleInstallProposalRecord:
        return WorkspaceBundleInstallProposalRecord(
            proposal_id=row["proposal_id"],
            request_id=row["request_id"],
            space_id=row["space_id"],
            bundle_id=row["bundle_id"],
            revision_id=row["revision_id"],
            config_placement=row["config_placement"],
            state=row["state"],
            version=int(row["version"]),
            manifest=json.loads(row["manifest_json"]),
            manifest_digest=row["manifest_digest"],
            assets=tuple(json.loads(row["assets_json"])),
            install_plan=json.loads(row["install_plan_json"]),
            decided_by=row["decided_by"],
            decided_at=(
                float(row["decided_at"])
                if row["decided_at"] is not None
                else None
            ),
            error_code=row["error_code"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _workspace_bundle_local_binding_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceBundleLocalBindingRecord:
        return WorkspaceBundleLocalBindingRecord(
            binding_id=row["binding_id"],
            proposal_id=row["proposal_id"],
            slot_id=row["slot_id"],
            binding_kind=row["binding_kind"],
            connector_id=row["connector_id"],
            opaque_connection_id=row["opaque_connection_id"],
            local_path=row["local_path"],
            required_grants=tuple(json.loads(row["required_grants_json"])),
            authorized_by=row["authorized_by"],
            authorized_at=float(row["authorized_at"]),
        )

    @staticmethod
    def _workspace_bundle_secret_binding_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceBundleSecretBindingRecord:
        return WorkspaceBundleSecretBindingRecord(
            binding_id=row["binding_id"],
            proposal_id=row["proposal_id"],
            requirement_key=row["requirement_key"],
            requirement_kind=row["requirement_kind"],
            binding_version=int(row["binding_version"]),
            secret_ref=row["secret_ref"],
            account_scope_digest=row["account_scope_digest"],
            authorized_by=row["authorized_by"],
            authorized_at=float(row["authorized_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _effective_environment_spec_from_row(
        row: sqlite3.Row,
    ) -> EffectiveEnvironmentSpecRecord:
        return EffectiveEnvironmentSpecRecord(
            environment_spec_id=row["environment_spec_id"],
            owner_type=row["owner_type"],
            owner_id=row["owner_id"],
            bundle_revision_id=row["bundle_revision_id"],
            manifest_digest=row["manifest_digest"],
            spec=json.loads(row["spec_json"]),
            environment_spec_digest=row["environment_spec_digest"],
            semantic_spec_digest=row["semantic_spec_digest"],
            local_materialization_digest=row["local_materialization_digest"],
            redacted_spec=json.loads(row["redacted_spec_json"]),
            projection_digest=row["projection_digest"],
            permission_profile_revision=row["permission_profile_revision"],
            provider_capability_revision=row["provider_capability_revision"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _git_repository_from_row(row: sqlite3.Row) -> GitRepositoryRecord:
        return GitRepositoryRecord(
            repository_id=row["repository_id"],
            space_id=row["space_id"],
            repository_role=row["repository_role"],
            root_path=row["root_path"],
            root_path_digest=row["root_path_digest"],
            ownership=row["ownership"],
            state=row["state"],
            version_coverage=row["version_coverage"],
            hooks_mode=row["hooks_mode"],
            repo_subdir=row["repo_subdir"],
            version=int(row["version"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _git_operation_from_row(row: sqlite3.Row) -> GitOperationRecord:
        return GitOperationRecord(
            operation_id=row["operation_id"],
            repository_id=row["repository_id"],
            request_id=row["request_id"],
            operation_type=row["operation_type"],
            payload_digest=row["payload_digest"],
            status=row["status"],
            expected_repo_state_digest=row["expected_repo_state_digest"],
            observed_repo_state_digest=row["observed_repo_state_digest"],
            result=(
                json.loads(row["result_json"])
                if row["result_json"] is not None
                else None
            ),
            error_code=row["error_code"],
            error_message=row["error_message"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _git_checkpoint_from_row(row: sqlite3.Row) -> GitCheckpointRecord:
        return GitCheckpointRecord(
            checkpoint_id=row["checkpoint_id"],
            repository_id=row["repository_id"],
            operation_id=row["operation_id"],
            target_role=row["target_role"],
            target_id=row["target_id"],
            commit_oid=row["commit_oid"],
            parent_oid=row["parent_oid"],
            paths=tuple(json.loads(row["paths_json"])),
            actor_id=row["actor_id"],
            trigger=row["trigger"],
            message=row["message"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _project_git_state_from_row(
        row: sqlite3.Row,
    ) -> ProjectGitStateRecord:
        return ProjectGitStateRecord(
            project_id=row["project_id"],
            repository_id=row["repository_id"],
            integration_ref=row["integration_ref"],
            integration_head=row["integration_head"],
            last_synced_user_head=row["last_synced_user_head"],
            pending_apply=bool(row["pending_apply"]),
            worktree_path=row["worktree_path"],
            projected_head=row["projected_head"],
            state=row["state"],
            version=int(row["version"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _run_git_materialization_from_row(
        row: sqlite3.Row,
    ) -> RunGitMaterializationRecord:
        return RunGitMaterializationRecord(
            run_id=row["run_id"],
            project_id=row["project_id"],
            repository_id=row["repository_id"],
            workspace_base_ref=row["workspace_base_ref"],
            workspace_base_commit=row["workspace_base_commit"],
            project_state_version=int(row["project_state_version"]),
            materialization_state=row["materialization_state"],
            run_ref=row["run_ref"],
            worktree_path=row["worktree_path"],
            promoted_commit=row["promoted_commit"],
            version=int(row["version"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _git_agent_workspace_from_row(
        row: sqlite3.Row,
    ) -> GitAgentWorkspaceRecord:
        return GitAgentWorkspaceRecord(
            workspace_id=row["workspace_id"],
            run_id=row["run_id"],
            repository_id=row["repository_id"],
            agent_id=row["agent_id"],
            agent_ref=row["agent_ref"],
            worktree_path=row["worktree_path"],
            base_commit=row["base_commit"],
            head_commit=row["head_commit"],
            state=row["state"],
            lease_owner=row["lease_owner"],
            lease_token=row["lease_token"],
            lease_until=(
                float(row["lease_until"])
                if row["lease_until"] is not None
                else None
            ),
            last_operation_id=row["last_operation_id"],
            conflict_interaction_id=row["conflict_interaction_id"],
            version=int(row["version"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _workspace_read_snapshot_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceReadSnapshotRecord:
        return WorkspaceReadSnapshotRecord(
            snapshot_id=row["snapshot_id"],
            run_id=row["run_id"],
            project_id=row["project_id"],
            repository_id=row["repository_id"],
            generation=int(row["generation"]),
            project_base_commit=row["project_base_commit"],
            common_base_commit=row["common_base_commit"],
            project_state_version=int(row["project_state_version"]),
            snapshot_ref=row["snapshot_ref"],
            user_head=row["user_head"],
            user_working_state_digest=row["user_working_state_digest"],
            overlay_manifest_digest=row["overlay_manifest_digest"],
            state=row["state"],
            expires_at=(
                float(row["expires_at"])
                if row["expires_at"] is not None
                else None
            ),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _workspace_overlay_entry_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceOverlayEntryRecord:
        return WorkspaceOverlayEntryRecord(
            snapshot_id=row["snapshot_id"],
            relative_path=row["relative_path"],
            source_kind=row["source_kind"],
            entry_state=row["entry_state"],
            source_token=json.loads(row["source_token_json"]),
            project_blob_oid=row["project_blob_oid"],
            materialized_content_digest=row["materialized_content_digest"],
            preimage_cache_key=row["preimage_cache_key"],
            size_bytes=int(row["size_bytes"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _workspace_snapshot_range_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceSnapshotRangeRecord:
        return WorkspaceSnapshotRangeRecord(
            snapshot_id=row["snapshot_id"],
            relative_path=row["relative_path"],
            start_offset=int(row["start_offset"]),
            end_offset=int(row["end_offset"]),
            content_digest=row["content_digest"],
            cache_key=row["cache_key"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _git_change_set_from_row(row: sqlite3.Row) -> GitChangeSetRecord:
        return GitChangeSetRecord(
            change_set_id=row["change_set_id"],
            run_id=row["run_id"],
            repository_id=row["repository_id"],
            worktree_ref=row["worktree_ref"],
            base_commit=row["base_commit"],
            state=row["state"],
            version=int(row["version"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _git_change_set_item_from_row(
        row: sqlite3.Row,
    ) -> GitChangeSetItemRecord:
        return GitChangeSetItemRecord(
            change_set_id=row["change_set_id"],
            relative_path=row["relative_path"],
            operation_request_id=row["operation_request_id"],
            actor_id=row["actor_id"],
            trigger=row["trigger"],
            change_kind=row["change_kind"],
            source=row["source"],
            preimage_digest=row["preimage_digest"],
            result_digest=row["result_digest"],
            size_bytes=(
                int(row["size_bytes"])
                if row["size_bytes"] is not None
                else None
            ),
            item_state=row["item_state"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _git_mutation_intent_from_row(
        row: sqlite3.Row,
    ) -> GitMutationIntentRecord:
        return GitMutationIntentRecord(
            intent_id=row["intent_id"],
            change_set_id=row["change_set_id"],
            operation_request_id=row["operation_request_id"],
            mutation_scope=row["mutation_scope"],
            relative_path=row["relative_path"],
            preimage_digest=row["preimage_digest"],
            actor_id=row["actor_id"],
            trigger=row["trigger"],
            status=row["status"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _tool_call_from_row(row: sqlite3.Row) -> ToolCallRecord:
        return ToolCallRecord(
            tool_call_id=row["tool_call_id"],
            run_id=row["run_id"],
            attempt_id=row["attempt_id"],
            tool_name=row["tool_name"],
            status=row["status"],
            safety_class=row["safety_class"],
            idempotency_key=row["idempotency_key"],
            request=json.loads(row["request_json"] or "{}"),
            result=(
                json.loads(row["result_json"]) if row["result_json"] else None
            ),
            outcome=row["outcome"],
            timeout_reason=row["timeout_reason"],
            prepared_at=(
                float(row["prepared_at"])
                if row["prepared_at"] is not None
                else None
            ),
            dispatched_at=(
                float(row["dispatched_at"])
                if row["dispatched_at"] is not None
                else None
            ),
            completed_at=(
                float(row["completed_at"])
                if row["completed_at"] is not None
                else None
            ),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _approval_from_row(row: sqlite3.Row) -> ApprovalRecord:
        return ApprovalRecord(
            approval_id=row["approval_id"],
            run_id=row["run_id"],
            attempt_id=row["attempt_id"],
            status=row["status"],
            prompt=json.loads(row["prompt_json"]),
            decision=(
                json.loads(row["decision_json"])
                if row["decision_json"] is not None
                else None
            ),
            version=int(row["version"]),
            expires_at=(
                float(row["expires_at"])
                if row["expires_at"] is not None
                else None
            ),
            expiry_action=row["expiry_action"],
            created_at=float(row["created_at"]),
            resolved_at=(
                float(row["resolved_at"])
                if row["resolved_at"] is not None
                else None
            ),
            action_digest=row["action_digest"],
            policy_revision=row["policy_revision"],
            safety_class=row["safety_class"],
            decision_scope=row["decision_scope"],
        )

    @staticmethod
    def _human_interaction_from_row(
        row: sqlite3.Row,
    ) -> HumanInteractionRecord:
        return HumanInteractionRecord(
            interaction_id=row["interaction_id"],
            run_id=row["run_id"],
            attempt_id=row["attempt_id"],
            interaction_type=row["interaction_type"],
            status=row["status"],
            request=json.loads(row["request_json"]),
            response_schema=json.loads(row["response_schema_json"]),
            requested_by=row["requested_by"],
            version=int(row["version"]),
            expires_at=(
                float(row["expires_at"])
                if row["expires_at"] is not None
                else None
            ),
            presented_at=(
                float(row["presented_at"])
                if row["presented_at"] is not None
                else None
            ),
            resolved_at=(
                float(row["resolved_at"])
                if row["resolved_at"] is not None
                else None
            ),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _human_interaction_option_from_row(
        row: sqlite3.Row,
    ) -> HumanInteractionOptionRecord:
        return HumanInteractionOptionRecord(
            interaction_id=row["interaction_id"],
            option_id=row["option_id"],
            position=int(row["position"]),
            label=row["label"],
            value=json.loads(row["value_json"]),
            description=row["description"],
        )

    @staticmethod
    def _human_interaction_decision_from_row(
        row: sqlite3.Row,
    ) -> HumanInteractionDecisionRecord:
        return HumanInteractionDecisionRecord(
            decision_id=row["decision_id"],
            interaction_id=row["interaction_id"],
            decision_request_id=row["decision_request_id"],
            decision=json.loads(row["decision_json"]),
            actor_type=row["actor_type"],
            actor_id=row["actor_id"],
            source=row["source"],
            action_digest=row["action_digest"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _space_permission_profile_from_row(
        row: sqlite3.Row,
    ) -> SpacePermissionProfileRecord:
        return SpacePermissionProfileRecord(
            space_id=row["space_id"],
            profile_name=row["profile_name"],
            sandbox_mode=row["sandbox_mode"],
            approval_mode=row["approval_mode"],
            reviewer_mode=row["reviewer_mode"],
            revision=int(row["revision"]),
            updated_by=row["updated_by"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _space_permission_profile_revision_from_row(
        row: sqlite3.Row,
    ) -> SpacePermissionProfileRevisionRecord:
        return SpacePermissionProfileRevisionRecord(
            revision_id=row["revision_id"],
            space_id=row["space_id"],
            profile_name=row["profile_name"],
            sandbox_mode=row["sandbox_mode"],
            approval_mode=row["approval_mode"],
            reviewer_mode=row["reviewer_mode"],
            revision=int(row["revision"]),
            created_by=row["created_by"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _approval_rule_from_row(row: sqlite3.Row) -> ApprovalRuleRecord:
        return ApprovalRuleRecord(
            rule_id=row["rule_id"],
            space_id=row["space_id"],
            effect=row["effect"],
            action_pattern=row["action_pattern"],
            resource_pattern=row["resource_pattern"],
            scope=row["scope"],
            run_id=row["run_id"],
            source_interaction_id=row["source_interaction_id"],
            expires_at=(
                float(row["expires_at"])
                if row["expires_at"] is not None
                else None
            ),
            created_by=row["created_by"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _security_audit_event_from_row(
        row: sqlite3.Row,
    ) -> SecurityAuditEventRecord:
        return SecurityAuditEventRecord(
            audit_event_id=row["audit_event_id"],
            space_id=row["space_id"],
            run_id=row["run_id"],
            interaction_id=row["interaction_id"],
            event_type=row["event_type"],
            actor_type=row["actor_type"],
            actor_id=row["actor_id"],
            action_digest=row["action_digest"],
            details=json.loads(row["details_json"]),
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _validate_memory_scope(scope_type: str, scope_id: str) -> None:
        if scope_type not in _MEMORY_SCOPE_TYPES:
            raise ValueError("invalid Memory scope_type")
        if not scope_id.strip() or len(scope_id) > 256:
            raise ValueError("Memory scope_id is required and bounded")

    @staticmethod
    def _validate_memory_entry_values(
        *,
        content: str | None,
        kind: str | None,
        priority: str,
        token_count: int | None,
        created_by: str | None,
        source_trust: str | None,
        sensitivity: str,
        allow_empty_content: bool = False,
    ) -> None:
        if (
            content is None
            or (not allow_empty_content and not content.strip())
            or len(content) > 8192
        ):
            raise ValueError("Memory content is required and bounded")
        if kind not in _MEMORY_KINDS:
            raise ValueError("invalid Memory kind")
        if priority not in {"normal", "high"}:
            raise ValueError("invalid Memory priority")
        if token_count is None or token_count < 1:
            raise ValueError("Memory token_count must be positive")
        if created_by not in {"extractor", "agent", "user", "importer"}:
            raise ValueError("invalid Memory created_by")
        if source_trust not in _MEMORY_SOURCE_TRUST:
            raise ValueError("invalid Memory source_trust")
        if sensitivity not in {"normal", "personal", "sensitive"}:
            raise ValueError("invalid Memory sensitivity")

    @staticmethod
    def _ensure_memory_scope_state_in_transaction(
        connection: sqlite3.Connection,
        *,
        scope_type: str,
        scope_id: str,
        owner_kind: str,
        token_limit: int,
        now: float,
    ) -> sqlite3.Row:
        connection.execute(
            """
            INSERT OR IGNORE INTO memory_scope_state(
                scope_type, scope_id, owner_kind, revision,
                capture_enabled, use_enabled, sync_scope, token_limit,
                current_token_count, consolidate_threshold,
                extractor_version, updated_at
            ) VALUES (?, ?, ?, 0, ?, 1, 'full_memory', ?, 0, 0.75,
                      'memory-v2', ?)
            """,
            (
                scope_type,
                scope_id,
                owner_kind,
                1,
                token_limit,
                now,
            ),
        )
        row = connection.execute(
            """
            SELECT * FROM memory_scope_state
            WHERE scope_type = ? AND scope_id = ?
            """,
            (scope_type, scope_id),
        ).fetchone()
        assert row is not None
        if row["owner_kind"] != owner_kind:
            raise InvalidRunTransitionError(
                f"Memory scope is owned by {row['owner_kind']!r}, not {owner_kind!r}"
            )
        return row

    @staticmethod
    def _assert_memory_capacity(state: sqlite3.Row, token_delta: int) -> None:
        resulting = int(state["current_token_count"]) + token_delta
        limit = int(state["token_limit"])
        if resulting < 0:
            raise RunJournalError(
                "Memory token accounting would become negative"
            )
        if resulting > limit:
            raise InvalidRunTransitionError(
                f"Memory capacity exceeded by {resulting - limit} tokens"
            )

    @staticmethod
    def _memory_entry_digest(row: sqlite3.Row) -> str:
        payload = {
            "memory_id": row["memory_id"],
            "scope_type": row["scope_type"],
            "scope_id": row["scope_id"],
            "kind": row["kind"],
            "content": row["content"],
            "priority": row["priority"],
            "version": int(row["version"]),
            "token_count": int(row["token_count"]),
            "pinned_by_user": bool(row["pinned_by_user"]),
            "confirmed_by_user": bool(row["confirmed_by_user"]),
            "created_by": row["created_by"],
            "source_trust": row["source_trust"],
            "sensitivity": row["sensitivity"],
            "source_refs": json.loads(row["source_refs_json"]),
            "deleted_at": row["deleted_at"],
        }
        return hashlib.sha256(
            json.dumps(
                payload,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()

    @staticmethod
    def _memory_scope_state_from_row(
        row: sqlite3.Row,
    ) -> MemoryScopeStateRecord:
        return MemoryScopeStateRecord(
            scope_type=row["scope_type"],
            scope_id=row["scope_id"],
            owner_kind=row["owner_kind"],
            revision=int(row["revision"]),
            capture_enabled=bool(row["capture_enabled"]),
            use_enabled=bool(row["use_enabled"]),
            sync_scope=row["sync_scope"],
            token_limit=int(row["token_limit"]),
            current_token_count=int(row["current_token_count"]),
            consolidate_threshold=float(row["consolidate_threshold"]),
            processed_through_watermark=row["processed_through_watermark"],
            watermark_kind=row["watermark_kind"],
            extractor_version=row["extractor_version"],
            last_consolidated_at=(
                float(row["last_consolidated_at"])
                if row["last_consolidated_at"] is not None
                else None
            ),
            last_error=row["last_error"],
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _memory_entry_from_row(row: sqlite3.Row) -> MemoryEntryRecord:
        return MemoryEntryRecord(
            memory_id=row["memory_id"],
            scope_type=row["scope_type"],
            scope_id=row["scope_id"],
            kind=row["kind"],
            content=row["content"],
            priority=row["priority"],
            version=int(row["version"]),
            token_count=int(row["token_count"]),
            pinned_by_user=bool(row["pinned_by_user"]),
            confirmed_by_user=bool(row["confirmed_by_user"]),
            created_by=row["created_by"],
            source_trust=row["source_trust"],
            sensitivity=row["sensitivity"],
            source_refs=tuple(json.loads(row["source_refs_json"])),
            last_used_at=(
                float(row["last_used_at"])
                if row["last_used_at"] is not None
                else None
            ),
            usage_count=int(row["usage_count"]),
            deleted_at=(
                float(row["deleted_at"])
                if row["deleted_at"] is not None
                else None
            ),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _memory_mutation_from_row(row: sqlite3.Row) -> MemoryMutationRecord:
        return MemoryMutationRecord(
            mutation_id=row["mutation_id"],
            memory_id=row["memory_id"],
            scope_type=row["scope_type"],
            scope_id=row["scope_id"],
            operation=row["operation"],
            expected_version=(
                int(row["expected_version"])
                if row["expected_version"] is not None
                else None
            ),
            before_hash=row["before_hash"],
            after_hash=row["after_hash"],
            actor_type=row["actor_type"],
            actor_id=row["actor_id"],
            run_id=row["run_id"],
            activity_id=row["activity_id"],
            reason=row["reason"],
            source_refs=tuple(json.loads(row["source_refs_json"])),
            idempotency_key=row["idempotency_key"],
            request_digest=row["request_digest"],
            decision_id=row["decision_id"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _memory_reconciliation_from_row(
        row: sqlite3.Row,
    ) -> MemoryReconciliationRecord:
        return MemoryReconciliationRecord(
            reconciliation_id=row["reconciliation_id"],
            account_owner_id=row["account_owner_id"],
            scope_type=row["scope_type"],
            scope_id=row["scope_id"],
            memory_id=row["memory_id"],
            local_entry=json.loads(row["local_entry_json"]),
            cloud_entry=json.loads(row["cloud_entry_json"]),
            status=row["status"],
            created_at=float(row["created_at"]),
            resolved_at=(
                float(row["resolved_at"])
                if row["resolved_at"] is not None
                else None
            ),
        )

    @staticmethod
    def _event_from_row(row: sqlite3.Row) -> CommittedRunEvent:
        return CommittedRunEvent(
            event_id=row["event_id"],
            run_id=row["run_id"],
            sequence=int(row["sequence"]),
            event_type=row["event_type"],
            payload=json.loads(row["payload_json"]),
            legacy_step=row["legacy_step"],
            created_at=float(row["created_at"]),
            run_version=int(row["run_version"]),
        )

    @staticmethod
    def _model_invocation_from_row(
        row: sqlite3.Row,
    ) -> ModelInvocationRecord:
        return ModelInvocationRecord(
            invocation_id=row["invocation_id"],
            run_id=row["run_id"],
            attempt_id=row["attempt_id"],
            step_id=row["step_id"],
            agent_id=row["agent_id"],
            logical_call_id=row["logical_call_id"],
            retry_index=int(row["retry_index"]),
            status=row["status"],
            provider=row["provider"],
            model=row["model"],
            transport=row["transport"],
            thinking_effort=row["thinking_effort"],
            request=json.loads(row["request_json"]),
            response=(
                json.loads(row["response_json"])
                if row["response_json"] is not None
                else None
            ),
            request_digest=row["request_digest"],
            response_digest=row["response_digest"],
            prompt_tokens=(
                int(row["prompt_tokens"])
                if row["prompt_tokens"] is not None
                else None
            ),
            completion_tokens=(
                int(row["completion_tokens"])
                if row["completion_tokens"] is not None
                else None
            ),
            cache_read_tokens=(
                int(row["cache_read_tokens"])
                if row["cache_read_tokens"] is not None
                else None
            ),
            cache_write_tokens=(
                int(row["cache_write_tokens"])
                if row["cache_write_tokens"] is not None
                else None
            ),
            finish_reason=row["finish_reason"],
            error_code=row["error_code"],
            error_message=row["error_message"],
            redaction_version=row["redaction_version"],
            started_at=float(row["started_at"]),
            first_token_at=(
                float(row["first_token_at"])
                if row["first_token_at"] is not None
                else None
            ),
            completed_at=(
                float(row["completed_at"])
                if row["completed_at"] is not None
                else None
            ),
        )

    @staticmethod
    def _model_invocation_event_from_row(
        row: sqlite3.Row,
    ) -> ModelInvocationEventRecord:
        return ModelInvocationEventRecord(
            event_id=row["event_id"],
            invocation_id=row["invocation_id"],
            event_index=int(row["event_index"]),
            event_type=row["event_type"],
            payload=json.loads(row["payload_json"]),
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _attempt_evidence_gap_from_row(
        row: sqlite3.Row,
    ) -> AttemptEvidenceGapRecord:
        return AttemptEvidenceGapRecord(
            gap_id=row["gap_id"],
            run_id=row["run_id"],
            attempt_id=row["attempt_id"],
            step_id=row["step_id"],
            dimension=row["dimension"],
            reason_code=row["reason_code"],
            source=row["source"],
            detail_code=row["detail_code"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _follow_up_request_from_row(
        row: sqlite3.Row,
    ) -> FollowUpRequestRecord:
        return FollowUpRequestRecord(
            request_id=row["request_id"],
            project_id=row["project_id"],
            content=row["content"],
            attachment_paths=tuple(json.loads(row["attachment_paths_json"])),
            review_handoff_ids=tuple(
                json.loads(row["review_handoff_ids_json"])
            ),
            delivery_mode=row["delivery_mode"],
            status=row["status"],
            admitted_run_id=row["admitted_run_id"],
            source=row["source"],
            source_command_id=row["source_command_id"],
            last_error=row["last_error"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _project_workspace_binding_from_row(
        row: sqlite3.Row,
    ) -> ProjectWorkspaceBindingRecord:
        return ProjectWorkspaceBindingRecord(
            project_id=row["project_id"],
            repository_id=row["repository_id"],
            checkout_id=row["checkout_id"],
            checkout_mode=row["checkout_mode"],
            target_ref=row["target_ref"],
            worktree_path=row["worktree_path"],
            version=int(row["version"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _workspace_writer_lease_from_row(
        row: sqlite3.Row,
    ) -> WorkspaceWriterLeaseRecord:
        return WorkspaceWriterLeaseRecord(
            repository_id=row["repository_id"],
            checkout_id=row["checkout_id"],
            request_id=row["request_id"],
            task_id=row["task_id"],
            project_id=row["project_id"],
            target_ref=row["target_ref"],
            acquired_at=float(row["acquired_at"]),
            version=int(row["version"]),
        )

    @staticmethod
    def _workspace_writer_request_from_row(
        connection: sqlite3.Connection,
        row: sqlite3.Row,
    ) -> WorkspaceWriterRequestRecord:
        queue_position = None
        blocker_task_id = None
        if row["status"] == "queued":
            position = connection.execute(
                """
                SELECT COUNT(*) AS position
                FROM workspace_writer_requests
                WHERE repository_id = ? AND checkout_id = ?
                  AND status = 'queued'
                  AND (
                    created_at < ?
                    OR (created_at = ? AND request_id <= ?)
                  )
                """,
                (
                    row["repository_id"],
                    row["checkout_id"],
                    row["created_at"],
                    row["created_at"],
                    row["request_id"],
                ),
            ).fetchone()
            assert position is not None
            queue_position = int(position["position"])
            lease = connection.execute(
                """
                SELECT task_id FROM workspace_writer_leases
                WHERE repository_id = ? AND checkout_id = ?
                """,
                (row["repository_id"], row["checkout_id"]),
            ).fetchone()
            blocker_task_id = lease["task_id"] if lease is not None else None
        return WorkspaceWriterRequestRecord(
            request_id=row["request_id"],
            repository_id=row["repository_id"],
            checkout_id=row["checkout_id"],
            task_id=row["task_id"],
            project_id=row["project_id"],
            target_ref=row["target_ref"],
            reason=row["reason"],
            status=row["status"],
            queue_position=queue_position,
            blocker_task_id=blocker_task_id,
            created_at=float(row["created_at"]),
            acquired_at=(
                float(row["acquired_at"])
                if row["acquired_at"] is not None
                else None
            ),
            finished_at=(
                float(row["finished_at"])
                if row["finished_at"] is not None
                else None
            ),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _project_execution_state_from_row(
        row: sqlite3.Row,
    ) -> ProjectExecutionStateRecord:
        return ProjectExecutionStateRecord(
            project_id=row["project_id"],
            state_version=int(row["state_version"]),
            frontier=(
                json.loads(row["frontier_json"])
                if row["frontier_json"] is not None
                else None
            ),
            frontier_digest=row["frontier_digest"],
            frontier_run_id=row["frontier_run_id"],
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _continuation_claim_from_row(
        row: sqlite3.Row,
    ) -> ContinuationClaimRecord:
        return ContinuationClaimRecord(
            fingerprint=row["fingerprint"],
            request_id=row["request_id"],
            project_id=row["project_id"],
            project_state_version=int(row["project_state_version"]),
            intent=row["intent"],
            base_run_id=row["base_run_id"],
            next_action=row["next_action"],
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _context_projection_diagnostic_from_row(
        row: sqlite3.Row,
    ) -> ContextProjectionDiagnosticRecord:
        return ContextProjectionDiagnosticRecord(
            projection_id=row["projection_id"],
            project_id=row["project_id"],
            run_id=row["run_id"],
            source_event_ids=tuple(json.loads(row["source_event_ids_json"])),
            source_memory_ids=tuple(json.loads(row["source_memory_ids_json"])),
            project_state_version=int(row["project_state_version"]),
            projection_digest=row["projection_digest"],
            token_count=int(row["token_count"]),
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _command_from_row(row: sqlite3.Row) -> RemoteCommandInboxRecord:
        return RemoteCommandInboxRecord(
            command_id=row["command_id"],
            session_id=row["session_id"],
            user_id=int(row["user_id"]),
            project_id=row["project_id"],
            run_id=row["run_id"],
            route_version=int(row["route_version"]),
            command_type=row["command_type"],
            payload=json.loads(row["payload_json"]),
            expires_at=float(row["expires_at"]),
            receipt_grace_until=float(row["receipt_grace_until"]),
            requires_online_receipt_confirmation=bool(
                row["requires_online_receipt_confirmation"]
            ),
            delivery_lease_token=row["delivery_lease_token"],
            receipt_event_id=row["receipt_event_id"],
            receipt_status=row["receipt_status"],
            state=row["state"],
            dispatch_attempt_count=int(row["dispatch_attempt_count"]),
            last_error=row["last_error"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _command_event_from_row(row: sqlite3.Row) -> CommandResultEvent:
        return CommandResultEvent(
            event_id=row["event_id"],
            command_id=row["command_id"],
            command_event_sequence=int(row["command_event_sequence"]),
            event_type=row["event_type"],
            payload=json.loads(row["payload_json"]),
            occurred_at=float(row["occurred_at"]),
        )

    @staticmethod
    def _outbox_from_row(row: sqlite3.Row) -> RunEventSyncOutboxRecord:
        return RunEventSyncOutboxRecord(
            event_id=row["event_id"],
            run_id=row["run_id"],
            run_sequence=int(row["run_sequence"]),
            status=row["status"],
            attempt_count=int(row["attempt_count"]),
            next_attempt_at=float(row["next_attempt_at"]),
            last_error=row["last_error"],
            lease_token=row["lease_token"],
            lease_until=(
                float(row["lease_until"])
                if row["lease_until"] is not None
                else None
            ),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )
