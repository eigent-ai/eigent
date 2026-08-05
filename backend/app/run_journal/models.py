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
