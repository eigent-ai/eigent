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

import json
import logging
import sqlite3
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from app.run_journal.models import (
    ApprovalRecord,
    ApprovalRuleRecord,
    AttemptEnvironmentBinding,
    CloudRunEventReplica,
    CloudRunReplica,
    CommandResultEvent,
    CommandResultSyncBatch,
    CommittedRunEvent,
    EffectiveEnvironmentSpecRecord,
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
    ProjectGitStateRecord,
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
    WorkspaceConfigMaterializationRecord,
    WorkspaceConfigRevisionRecord,
    WorkspaceOverlayEntryRecord,
    WorkspaceReadSnapshotRecord,
    WorkspaceSnapshotRangeRecord,
)
from app.run_journal.paths import default_run_journal_path
from app.run_journal.transitions import (
    ATTEMPT_ACTIVE_STATES,
    ATTEMPT_TRANSITIONS,
    COMMAND_TRANSITIONS,
    RUN_TRANSITIONS,
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
from app.workspace_config.models import (
    EffectiveEnvironmentSpec,
    ThinkingEffort,
    canonical_digest,
    canonical_json,
)

SCHEMA_VERSION = 15
logger = logging.getLogger("run_journal")

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
                actual = (
                    row["binding_id"],
                    row["proposal_id"],
                    row["slot_id"],
                    row["binding_kind"],
                    row["connector_id"],
                    row["opaque_connection_id"],
                    row["local_path"],
                    row["required_grants_json"],
                    row["authorized_by"],
                )
                if actual != expected:
                    raise IdempotencyConflictError(
                        f"Bundle slot {slot_id!r} already has another decision"
                    )
                return (
                    self._workspace_bundle_local_binding_from_row(row),
                    self._workspace_bundle_install_proposal_from_row(proposal),
                )
            if int(proposal["version"]) != expected_proposal_version:
                raise OptimisticConcurrencyError(
                    f"Bundle install proposal {proposal_id!r} changed"
                )
            if proposal["state"] not in {"approved", "needs_attention"}:
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
                SET version = version + 1, updated_at = ?
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
                    if (
                        existing["event_id"] != event.event_id
                        or existing["run_id"] != event.run_id
                        or int(existing["sequence"]) != event.run_sequence
                        or int(existing["run_version"]) != event.run_version
                        or existing["event_type"] != event.event_type
                        or existing["payload_json"] != payload_json
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

    def list_events(
        self,
        run_id: str,
        *,
        after_sequence: int = 0,
        limit: int | None = None,
    ) -> list[CommittedRunEvent]:
        if limit is not None and limit < 1:
            raise ValueError("event query limit must be positive")
        query = """
            SELECT event_id, run_id, sequence, run_version, event_type,
                   payload_json, legacy_step, created_at
            FROM run_events
            WHERE run_id = ? AND sequence > ?
            ORDER BY sequence
        """
        parameters: list[Any] = [run_id, after_sequence]
        if limit is not None:
            query += " LIMIT ?"
            parameters.append(limit)
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
            return [self._event_from_row(row) for row in rows]

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
        now: float | None = None,
    ) -> RunAttemptRecord:
        if not request_id.strip() or not reason.strip():
            raise ValueError("attempt request_id and reason are required")
        timestamp = now if now is not None else time.time()
        identifier = attempt_id or str(uuid.uuid4())
        environment_values = self._attempt_environment_values(environment)
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
            blockers = self._unsafe_resume_blockers(connection, run_id)
            if blockers:
                raise UnsafeResumeError(blockers)
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
                    thinking_effort_effective, provider_capability_revision
                ) VALUES (
                    ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 0, ?,
                    ?, ?, ?, ?, ?, ?, ?
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
                ),
            )
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
                        **environment_payload,
                    },
                    created_at=timestamp,
                ),
                run_status=status,
                active_attempt_id=identifier,
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
            self._append_event_in_transaction(
                connection,
                run_id,
                RunEventDraft(
                    event_id=f"cancel:{request_id}:completed",
                    event_type="run.cancelled",
                    payload={
                        "request_id": request_id,
                        "reason": "explicit_cancel",
                    },
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
            if not transition_allowed(TOOL_TRANSITIONS, previous, status):
                raise InvalidRunTransitionError(
                    f"tool call {tool_call_id!r} cannot move from {previous!r} to {status!r}"
                )
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
                        completed_at = CASE WHEN ? IN ('completed', 'failed')
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
                "request": request or {},
                "result": result,
            }
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
                if updated_attempt.rowcount != 1:
                    raise InvalidRunTransitionError(
                        f"interaction attempt {attempt_id!r} is no longer running"
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
            can_continue = self._resolve_waiting_attempt(
                connection,
                attempt_id=interaction["attempt_id"],
                continue_active_attempt=continue_active_attempt,
                timestamp=timestamp,
                outcome="human_interaction_resolved",
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
                        "continued_attempt": can_continue,
                    },
                    created_at=timestamp,
                ),
                run_status="running" if can_continue else "interrupted",
                active_attempt_id=(
                    interaction["attempt_id"] if can_continue else None
                ),
                clear_active_attempt=not can_continue,
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
            if (
                not transition_allowed(
                    ATTEMPT_TRANSITIONS,
                    str(attempt["status"]),
                    "waiting_for_user",
                )
                or active_attempt_id != attempt_id
            ):
                raise InvalidRunTransitionError(
                    f"{interaction_label} attempt {attempt_id!r} must be the "
                    "active running attempt"
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
        attempt_id: str | None,
        continue_active_attempt: bool,
        timestamp: float,
        outcome: str,
    ) -> bool:
        if attempt_id is None:
            return False
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
        can_continue = bool(
            continue_active_attempt and status == "waiting_for_user"
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
        else:
            connection.execute(
                """
                UPDATE run_attempts
                SET status = 'interrupted', ended_at = COALESCE(ended_at, ?),
                    outcome = ?
                WHERE attempt_id = ? AND status = 'waiting_for_user'
                """,
                (timestamp, outcome, attempt_id),
            )
        return can_continue

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
                if updated_attempt.rowcount != 1:
                    raise InvalidRunTransitionError(
                        f"approval attempt {attempt_id!r} is no longer running"
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
            can_continue = False
            attempt_status: str | None = None
            if continue_active_attempt and approval["attempt_id"] is not None:
                attempt = connection.execute(
                    "SELECT status FROM run_attempts WHERE attempt_id = ?",
                    (approval["attempt_id"],),
                ).fetchone()
                can_continue = (
                    attempt is not None
                    and attempt["status"] == "waiting_for_user"
                )
                attempt_status = (
                    attempt["status"] if attempt is not None else None
                )
            elif approval["attempt_id"] is not None:
                attempt = connection.execute(
                    "SELECT status FROM run_attempts WHERE attempt_id = ?",
                    (approval["attempt_id"],),
                ).fetchone()
                attempt_status = (
                    attempt["status"] if attempt is not None else None
                )
            if (
                attempt_status in ATTEMPT_ACTIVE_STATES
                and attempt_status != "waiting_for_user"
            ):
                raise InvalidRunTransitionError(
                    f"approval {approval_id!r} is bound to active attempt state "
                    f"{attempt_status!r}, not waiting_for_user"
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
            if can_continue:
                connection.execute(
                    """
                    UPDATE run_attempts
                    SET status = 'running', last_consumer_heartbeat_at = ?
                    WHERE attempt_id = ? AND status = 'waiting_for_user'
                    """,
                    (timestamp, approval["attempt_id"]),
                )
            elif approval["attempt_id"] is not None:
                connection.execute(
                    """
                    UPDATE run_attempts
                    SET status = 'interrupted', ended_at = COALESCE(ended_at, ?),
                        outcome = 'approval_decision_persisted'
                    WHERE attempt_id = ? AND status = 'waiting_for_user'
                    """,
                    (timestamp, approval["attempt_id"]),
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
                        "continued_attempt": can_continue,
                        **decision_value,
                    },
                    created_at=timestamp,
                ),
                run_status="running" if can_continue else "interrupted",
                active_attempt_id=(
                    approval["attempt_id"] if can_continue else None
                ),
                clear_active_attempt=not can_continue,
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
                safety = ToolSafetyClass(tool["safety_class"])
                replayable = automatic_tool_replay_allowed(
                    safety, idempotency_key=tool["idempotency_key"]
                )
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
        with self._write_transaction() as connection:
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
                        ):
                            continue
                        else:
                            target_status = (
                                "waiting_for_user"
                                if run["status"] == "waiting_for_user"
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
                            tool["run_id"],
                            RunEventDraft(
                                event_id=(
                                    "startup:tool-outcome-unknown:"
                                    f"{tool['tool_call_id']}"
                                ),
                                event_type="tool.outcome_unknown",
                                payload={
                                    "tool_call_id": tool["tool_call_id"],
                                    "safety_class": tool["safety_class"],
                                    "reason": "brain_restart_after_dispatch",
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
                return self._command_from_row(existing)

            connection.execute(
                """
                INSERT INTO remote_command_inbox(
                    command_id, session_id, user_id, project_id, run_id,
                    route_version, command_type, payload_json, expires_at,
                    receipt_grace_until,
                    requires_online_receipt_confirmation, receipt_event_id,
                    receipt_status, state, dispatch_attempt_count, last_error,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
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
                    SELECT e.*, o.status, o.attempt_count, o.next_attempt_at
                    FROM command_result_outbox AS o
                    JOIN command_result_events AS e ON e.event_id = o.event_id
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
                placeholders = ",".join("?" for _ in event_ids)
                updated = connection.execute(
                    f"""
                    UPDATE command_result_outbox
                    SET status = 'sending', lease_token = ?, lease_until = ?,
                        updated_at = ?
                    WHERE status = 'pending' AND event_id IN ({placeholders})
                    """,
                    (
                        token,
                        timestamp + lease_seconds,
                        timestamp,
                        *event_ids,
                    ),
                )
                if updated.rowcount != len(event_ids):
                    raise OutboxLeaseLostError(
                        f"failed to lease command lane {candidate['command_id']!r}"
                    )
                batches.append(
                    CommandResultSyncBatch(
                        command_id=candidate["command_id"],
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
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE command_result_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (timestamp, *event_ids),
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
                placeholders = ",".join("?" for _ in event_ids)
                claimed = connection.execute(
                    f"""
                    UPDATE run_event_sync_outbox
                    SET status = 'sending', lease_token = ?, lease_until = ?,
                        updated_at = ?
                    WHERE status = 'pending' AND event_id IN ({placeholders})
                    """,
                    (lease_token, lease_until, timestamp, *event_ids),
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
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE run_event_sync_outbox
                SET status = 'sent', lease_token = NULL, lease_until = NULL,
                    last_error = NULL, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (timestamp, *event_ids),
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
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE run_event_sync_outbox
                SET status = 'pending', attempt_count = attempt_count + 1,
                    next_attempt_at = ?, last_error = ?, lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (next_attempt_at, error[:4000], timestamp, *event_ids),
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
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE run_event_sync_outbox
                SET status = 'pending', lease_token = NULL,
                    lease_until = NULL, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (timestamp, *event_ids),
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
    def _terminal_status_for_event(draft: RunEventDraft) -> str | None:
        if draft.event_type == "run.completed" or draft.legacy_step == "end":
            return "completed"
        if draft.event_type in {"run.failed", "run.deadline_reached"}:
            return "failed"
        if draft.event_type == "run.cancelled":
            return "cancelled"
        if draft.event_type in {"run.interrupted", "runtime.interrupted"}:
            return "interrupted"
        return None

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
        assignments = ["version = version + 1", "updated_at = ?"]
        parameters: list[Any] = [draft.created_at]
        if run_status is not None:
            assignments.append("status = ?")
            parameters.append(run_status)
        if clear_active_attempt:
            assignments.append("active_attempt_id = NULL")
        elif active_attempt_id is not None:
            assignments.append("active_attempt_id = ?")
            parameters.append(active_attempt_id)
        parameters.extend([run_id, current_version])
        updated = connection.execute(
            f"UPDATE runs SET {', '.join(assignments)} "
            "WHERE run_id = ? AND version = ?",
            parameters,
        )
        if updated.rowcount != 1:
            raise OptimisticConcurrencyError(
                f"run_id {run_id!r} changed while appending event"
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
        placeholders = ",".join("?" for _ in event_ids)
        count = int(
            connection.execute(
                f"""
                SELECT COUNT(*)
                FROM run_event_sync_outbox
                WHERE status = 'sending' AND lease_token = ?
                  AND event_id IN ({placeholders})
                """,
                (batch.lease_token, *event_ids),
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
        placeholders = ",".join("?" for _ in event_ids)
        count = int(
            connection.execute(
                f"""
                SELECT COUNT(*) FROM command_result_outbox
                WHERE status = 'sending' AND lease_token = ?
                  AND event_id IN ({placeholders})
                """,
                (batch.lease_token, *event_ids),
            ).fetchone()[0]
        )
        if count != len(event_ids):
            raise OutboxLeaseLostError(
                f"command outbox lease for {batch.command_id!r} is stale"
            )

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
        blockers: list[str] = []
        for row in rows:
            safety = ToolSafetyClass(row["safety_class"])
            if not automatic_tool_replay_allowed(
                safety, idempotency_key=row["idempotency_key"]
            ):
                blockers.append(row["tool_call_id"])
        return blockers

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
            placeholders = ",".join("?" for _ in event_ids)
            connection.execute(
                f"""
                UPDATE command_result_outbox
                SET status = ?,
                    attempt_count = attempt_count + ?,
                    next_attempt_at = COALESCE(?, next_attempt_at),
                    lease_token = NULL, lease_until = NULL,
                    last_error = ?, updated_at = ?
                WHERE event_id IN ({placeholders})
                """,
                (
                    status,
                    int(increment_attempt),
                    next_attempt_at,
                    error[:4000] if error else None,
                    timestamp,
                    *event_ids,
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
