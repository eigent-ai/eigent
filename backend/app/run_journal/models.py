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

"""Typed records for the Desktop-owned SQLite RunJournal."""

from __future__ import annotations

import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    project_id: str
    status: str
    version: int
    active_attempt_id: str | None
    deadline_at: float | None
    timeout_policy_version: str
    created_at: float
    updated_at: float
    parent_run_id: str | None = None
    timeout_policy: dict[str, Any] = field(default_factory=dict)
    cancel_request_id: str | None = None
    cancel_requested_at: float | None = None
    origin: str = "local"
    resume_blocked_reason: str | None = None


@dataclass(frozen=True)
class CloudRunReplica:
    run_id: str
    status: str
    expected_next_run_sequence: int
    updated_at: float


@dataclass(frozen=True)
class CloudRunEventReplica:
    event_id: str
    project_id: str
    run_id: str
    run_sequence: int
    run_version: int
    cloud_cursor: int
    event_type: str
    payload: dict[str, Any]
    legacy_step: str | None
    created_at: float


@dataclass(frozen=True)
class RunAttemptRecord:
    attempt_id: str
    run_id: str
    attempt_number: int
    status: str
    started_at: float
    ended_at: float | None
    outcome: str | None
    timeout_reason: str | None
    resume_request_id: str | None
    resume_reason: str
    policy_version: str
    elapsed_active_ms: int
    last_consumer_heartbeat_at: float | None
    environment_spec_id: str | None = None
    environment_spec_digest: str | None = None
    bundle_revision_id: str | None = None
    permission_profile_revision: str | None = None
    thinking_effort_requested: str | None = None
    thinking_effort_effective: str | None = None
    provider_capability_revision: str | None = None


@dataclass(frozen=True)
class AttemptEnvironmentBinding:
    environment_spec_id: str
    environment_spec_digest: str
    bundle_revision_id: str
    permission_profile_revision: str
    thinking_effort_requested: str
    thinking_effort_effective: str
    provider_capability_revision: str


@dataclass(frozen=True)
class WorkspaceConfigRevisionRecord:
    revision_id: str
    bundle_id: str
    revision_number: int
    status: str
    version: int
    manifest: dict[str, Any]
    manifest_digest: str
    created_by: str
    created_at: float


@dataclass(frozen=True)
class WorkspaceConfigMaterializationRecord:
    materialization_id: str
    space_id: str
    revision_id: str
    config_placement: str
    state: str
    local_override_digest: str
    materialized_at: float | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class EffectiveEnvironmentSpecRecord:
    environment_spec_id: str
    owner_type: str
    owner_id: str
    bundle_revision_id: str
    manifest_digest: str
    spec: dict[str, Any]
    environment_spec_digest: str
    semantic_spec_digest: str
    local_materialization_digest: str
    redacted_spec: dict[str, Any]
    projection_digest: str
    permission_profile_revision: str
    provider_capability_revision: str
    created_at: float


@dataclass(frozen=True)
class GitRepositoryRecord:
    repository_id: str
    space_id: str
    repository_role: str
    root_path: str
    root_path_digest: str
    ownership: str
    state: str
    version_coverage: str
    hooks_mode: str
    repo_subdir: str | None
    version: int
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class GitOperationRecord:
    operation_id: str
    repository_id: str
    request_id: str
    operation_type: str
    payload_digest: str
    status: str
    expected_repo_state_digest: str | None
    observed_repo_state_digest: str | None
    result: dict[str, Any] | None
    error_code: str | None
    error_message: str | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class GitCheckpointRecord:
    checkpoint_id: str
    repository_id: str
    operation_id: str
    target_role: str
    target_id: str
    commit_oid: str
    parent_oid: str | None
    paths: tuple[str, ...]
    actor_id: str
    trigger: str
    message: str
    created_at: float


@dataclass(frozen=True)
class ProjectGitStateRecord:
    project_id: str
    repository_id: str
    integration_ref: str | None
    integration_head: str | None
    last_synced_user_head: str | None
    pending_apply: bool
    worktree_path: str | None
    projected_head: str | None
    state: str
    version: int
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class RunGitMaterializationRecord:
    run_id: str
    project_id: str
    repository_id: str
    workspace_base_ref: str | None
    workspace_base_commit: str | None
    project_state_version: int
    materialization_state: str
    run_ref: str | None
    worktree_path: str | None
    promoted_commit: str | None
    version: int
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class WorkspaceReadSnapshotRecord:
    snapshot_id: str
    run_id: str
    project_id: str
    repository_id: str
    generation: int
    project_base_commit: str | None
    common_base_commit: str | None
    project_state_version: int
    snapshot_ref: str | None
    user_head: str | None
    user_working_state_digest: str
    overlay_manifest_digest: str
    state: str
    expires_at: float | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class WorkspaceOverlayEntryRecord:
    snapshot_id: str
    relative_path: str
    source_kind: str
    entry_state: str
    source_token: dict[str, Any]
    project_blob_oid: str | None
    materialized_content_digest: str | None
    preimage_cache_key: str | None
    size_bytes: int
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class WorkspaceSnapshotRangeRecord:
    snapshot_id: str
    relative_path: str
    start_offset: int
    end_offset: int
    content_digest: str
    cache_key: str
    created_at: float


@dataclass(frozen=True)
class GitChangeSetRecord:
    change_set_id: str
    run_id: str
    repository_id: str
    worktree_ref: str
    base_commit: str | None
    state: str
    version: int
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class GitChangeSetItemRecord:
    change_set_id: str
    relative_path: str
    operation_request_id: str
    actor_id: str
    trigger: str
    change_kind: str
    source: str
    preimage_digest: str | None
    result_digest: str | None
    size_bytes: int | None
    item_state: str
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class GitMutationIntentRecord:
    intent_id: str
    change_set_id: str
    operation_request_id: str
    mutation_scope: str
    relative_path: str | None
    preimage_digest: str | None
    actor_id: str
    trigger: str
    status: str
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class ToolCallRecord:
    tool_call_id: str
    run_id: str
    attempt_id: str | None
    tool_name: str
    status: str
    safety_class: str
    idempotency_key: str | None
    request: dict[str, Any]
    result: dict[str, Any] | None
    outcome: str | None
    timeout_reason: str | None
    prepared_at: float | None
    dispatched_at: float | None
    completed_at: float | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class ApprovalRecord:
    approval_id: str
    run_id: str
    attempt_id: str | None
    status: str
    prompt: dict[str, Any]
    decision: dict[str, Any] | None
    version: int
    expires_at: float | None
    expiry_action: str
    created_at: float
    resolved_at: float | None
    action_digest: str = ""
    policy_revision: str = "legacy"
    safety_class: str = "unknown"
    decision_scope: str = "once"


@dataclass(frozen=True)
class HumanInteractionRecord:
    interaction_id: str
    run_id: str
    attempt_id: str | None
    interaction_type: str
    status: str
    request: dict[str, Any]
    response_schema: dict[str, Any]
    requested_by: str
    version: int
    expires_at: float | None
    presented_at: float | None
    resolved_at: float | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class HumanInteractionOptionRecord:
    interaction_id: str
    option_id: str
    position: int
    label: str
    value: Any
    description: str | None


@dataclass(frozen=True)
class HumanInteractionDecisionRecord:
    decision_id: str
    interaction_id: str
    decision_request_id: str
    decision: dict[str, Any]
    actor_type: str
    actor_id: str | None
    source: str
    action_digest: str | None
    created_at: float


@dataclass(frozen=True)
class SpacePermissionProfileRecord:
    space_id: str
    profile_name: str
    sandbox_mode: str
    approval_mode: str
    reviewer_mode: str
    revision: int
    updated_by: str
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class SpacePermissionProfileRevisionRecord:
    revision_id: str
    space_id: str
    profile_name: str
    sandbox_mode: str
    approval_mode: str
    reviewer_mode: str
    revision: int
    created_by: str
    created_at: float


@dataclass(frozen=True)
class ApprovalRuleRecord:
    rule_id: str
    space_id: str
    effect: str
    action_pattern: str
    resource_pattern: str | None
    scope: str
    run_id: str | None
    source_interaction_id: str | None
    expires_at: float | None
    created_by: str
    created_at: float


@dataclass(frozen=True)
class SecurityAuditEventRecord:
    audit_event_id: str
    space_id: str | None
    run_id: str | None
    interaction_id: str | None
    event_type: str
    actor_type: str
    actor_id: str | None
    action_digest: str | None
    details: dict[str, Any]
    created_at: float


@dataclass(frozen=True)
class StartupReconciliationResult:
    interrupted_run_ids: tuple[str, ...]
    completed_cancel_run_ids: tuple[str, ...]
    deadline_run_ids: tuple[str, ...]
    detached_attempt_ids: tuple[str, ...]
    outcome_unknown_tool_call_ids: tuple[str, ...]
    pending_approval_ids: tuple[str, ...]
    reconcilable_command_ids: tuple[str, ...]


@dataclass(frozen=True)
class RunEventDraft:
    event_type: str
    payload: Mapping[str, Any]
    legacy_step: str | None = None
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: float = field(default_factory=time.time)


@dataclass(frozen=True)
class CommittedRunEvent:
    event_id: str
    run_id: str
    sequence: int
    event_type: str
    payload: dict[str, Any]
    legacy_step: str | None
    created_at: float
    run_version: int


@dataclass(frozen=True)
class RunEventSyncOutboxRecord:
    event_id: str
    run_id: str
    run_sequence: int
    status: str
    attempt_count: int
    next_attempt_at: float
    last_error: str | None
    lease_token: str | None
    lease_until: float | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class RunEventSyncBatch:
    project_id: str
    run_id: str
    lease_token: str
    attempt_count: int
    events: tuple[CommittedRunEvent, ...]


@dataclass(frozen=True)
class RemoteCommandInboxRecord:
    command_id: str
    session_id: str
    user_id: int
    project_id: str
    run_id: str | None
    route_version: int
    command_type: str
    payload: dict[str, Any]
    expires_at: float
    receipt_grace_until: float
    requires_online_receipt_confirmation: bool
    receipt_event_id: str
    receipt_status: str
    state: str
    dispatch_attempt_count: int
    last_error: str | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class CommandResultEvent:
    event_id: str
    command_id: str
    command_event_sequence: int
    event_type: str
    payload: dict[str, Any]
    occurred_at: float


@dataclass(frozen=True)
class CommandResultSyncBatch:
    command_id: str
    lease_token: str
    attempt_count: int
    events: tuple[CommandResultEvent, ...]
