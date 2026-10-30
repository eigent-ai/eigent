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

import json
import math
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.model.project.project import ProjectOut
from app.model.space.apply import ApplyResolutionIn
from app.model.space.space import SpaceOut

RemoteControlCommandType = Literal[
    "user_message",
    "human_reply",
    "interaction_decision",
    "stop",
    "skip_task",
    "add_task",
    "remove_task",
    "supplement",
    "switch_project_view",
    "space_project_upsert",
    "space_overlay_list",
    "space_apply_project_run",
    "space_refresh_project",
    "space_discard_project_overlays",
]


def _bounded_interaction_value(value: Any) -> bool:
    node_count = 0

    def visit(item: Any, depth: int) -> bool:
        nonlocal node_count
        node_count += 1
        if node_count > 1024 or depth > 6:
            return False
        if isinstance(item, dict):
            return all(
                isinstance(key, str) and len(key) <= 255 and visit(child, depth + 1) for key, child in item.items()
            )
        if isinstance(item, list):
            return len(item) <= 256 and all(visit(child, depth + 1) for child in item)
        if isinstance(item, float):
            return math.isfinite(item)
        return item is None or isinstance(item, (str, int, bool))

    if not visit(value, 0):
        return False
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) <= 256 * 1024


class RemoteControlCreateSessionIn(BaseModel):
    desktop_instance_id: str
    space_id: str | None = None
    project_id: str | None = None
    active_task_id: str | None = None
    brain_session_id: str | None = None
    initial_project_id: str | None = None
    initial_task_id: str | None = None
    initial_history_id: str | None = None
    title: str = ""
    expires_in_seconds: int = Field(default=86400, ge=60, le=604800)


class RemoteControlCreateSessionOut(BaseModel):
    session_id: str
    url: str
    expires_at: datetime
    bridge_status: str
    space_id: str | None = None
    space_name: str | None = None
    current_project_id: str | None = None
    current_task_id: str | None = None
    current_history_id: str | None = None
    current_brain_session_id: str | None = None


class RemoteControlSessionOut(BaseModel):
    session_id: str
    desktop_instance_id: str
    space_id: str | None = None
    space_name: str | None = None
    space: SpaceOut | None = None
    project_id: str | None = None
    active_task_id: str | None = None
    brain_session_id: str | None = None
    current_project_id: str | None = None
    current_task_id: str | None = None
    current_history_id: str | None = None
    current_brain_session_id: str | None = None
    title: str
    status: str
    bridge_status: str
    execution_mode: str
    capabilities: dict[str, Any]
    created_at: datetime | None
    expires_at: datetime


class RemoteControlExtendIn(BaseModel):
    extend_seconds: int


class RemoteControlExtendOut(BaseModel):
    expires_at: datetime


class RemoteControlCommandIn(BaseModel):
    client_request_id: str = Field(min_length=1, max_length=128)
    source_channel: str = "remote_web"
    type: RemoteControlCommandType
    payload: dict[str, Any] = Field(default_factory=dict)
    space_id: str | None = None
    target_project_id: str | None = None
    target_task_id: str | None = None
    target_brain_session_id: str | None = None

    @model_validator(mode="after")
    def validate_interaction_decision(self):
        if self.type != "interaction_decision":
            return self
        allowed = {
            "run_id",
            "interaction_id",
            "expected_version",
            "action_digest",
            "decision",
            "supersedes_command_id",
        }
        unknown = set(self.payload) - allowed
        if unknown:
            raise ValueError("unsupported interaction decision fields: " + ", ".join(sorted(unknown)))
        run_id = self.payload.get("run_id")
        interaction_id = self.payload.get("interaction_id")
        expected_version = self.payload.get("expected_version")
        decision = self.payload.get("decision")
        if not isinstance(run_id, str) or not 1 <= len(run_id) <= 128:
            raise ValueError("interaction_decision requires a valid run_id")
        if not isinstance(interaction_id, str) or not 1 <= len(interaction_id) <= 128:
            raise ValueError("interaction_decision requires a valid interaction_id")
        if not isinstance(expected_version, int) or isinstance(expected_version, bool) or expected_version < 0:
            raise ValueError("interaction_decision requires a non-negative expected_version")
        action_digest = self.payload.get("action_digest")
        if action_digest is not None and (
            not isinstance(action_digest, str)
            or len(action_digest) != 64
            or any(character not in "0123456789abcdef" for character in action_digest)
        ):
            raise ValueError("interaction_decision action_digest is invalid")
        supersedes_command_id = self.payload.get("supersedes_command_id")
        if supersedes_command_id is not None and (
            not isinstance(supersedes_command_id, str) or not 1 <= len(supersedes_command_id) <= 64
        ):
            raise ValueError("interaction_decision supersedes_command_id is invalid")
        if not isinstance(decision, dict) or not decision:
            raise ValueError("interaction_decision requires a decision object")
        allowed_decision_fields = {
            "reply",
            "decision",
            "scope",
            "option_id",
            "value",
            "values",
        }
        unknown_decision_fields = set(decision) - allowed_decision_fields
        if unknown_decision_fields:
            raise ValueError("unsupported interaction response fields: " + ", ".join(sorted(unknown_decision_fields)))
        variants = sum(key in decision for key in ("reply", "decision", "option_id", "values"))
        if variants != 1:
            raise ValueError("interaction_decision must contain exactly one response shape")
        if "reply" in decision and set(decision) != {"reply"}:
            raise ValueError("interaction reply has incompatible fields")
        if "decision" in decision and not set(decision).issubset({"decision", "scope"}):
            raise ValueError("interaction approval has incompatible fields")
        if "option_id" in decision and not set(decision).issubset({"option_id", "value"}):
            raise ValueError("interaction choice has incompatible fields")
        if "values" in decision and set(decision) != {"values"}:
            raise ValueError("interaction form has incompatible fields")
        if "reply" in decision and (
            not isinstance(decision["reply"], str) or not decision["reply"].strip() or len(decision["reply"]) > 100_000
        ):
            raise ValueError("interaction reply is invalid")
        if "decision" in decision and decision["decision"] not in {
            "approved",
            "rejected",
        }:
            raise ValueError("interaction approval decision is invalid")
        if "scope" in decision and decision["scope"] not in {
            "once",
            "run",
            "space",
        }:
            raise ValueError("interaction decision scope is invalid")
        if "option_id" in decision and (
            not isinstance(decision["option_id"], str)
            or not decision["option_id"].strip()
            or len(decision["option_id"]) > 255
        ):
            raise ValueError("interaction option_id is invalid")
        if "values" in decision and (
            not isinstance(decision["values"], dict)
            or not decision["values"]
            or len(decision["values"]) > 128
            or not _bounded_interaction_value(decision["values"])
        ):
            raise ValueError("interaction form values are invalid")
        if not _bounded_interaction_value(decision):
            raise ValueError("interaction decision payload is too large or deeply nested")
        return self


class DeviceRegistrationIn(BaseModel):
    install_public_key: str | None = Field(default=None, max_length=8192)
    app_version: str | None = Field(default=None, max_length=64)
    capabilities: dict[str, Any] = Field(default_factory=dict)


class DeviceRegistrationOut(BaseModel):
    device_id: str
    account_owner_id: str
    credential_version: int
    registered_at: datetime


class ProjectRouteClaimIn(BaseModel):
    expected_route_version: int | None = Field(default=None, ge=1)


class ProjectRouteOut(BaseModel):
    project_id: str
    target_device_id: str
    route_version: int


class PendingCommandOut(BaseModel):
    command_id: str
    session_id: str
    user_id: int
    project_id: str
    run_id: str | None
    route_version: int
    command_type: str
    payload: dict[str, Any]
    space_id: str | None
    target_brain_session_id: str | None
    source_channel: str
    next_task_id: str | None
    expires_at: datetime
    receipt_grace_until: datetime
    requires_online_receipt_confirmation: bool
    lease_token: str = Field(min_length=1, max_length=64)


class PendingCommandsOut(BaseModel):
    items: list[PendingCommandOut]


class ConfirmCommandReceiptIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=64)
    desktop_event_sequence: int = Field(ge=1)
    occurred_at: datetime
    lease_token: str = Field(min_length=1, max_length=64)


class ConfirmCommandReceiptOut(BaseModel):
    result: str
    command_id: str
    receipt_state: str
    expected_next_desktop_event_sequence: int
    may_execute: bool


class CommandEventIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=64)
    desktop_event_sequence: int = Field(ge=1)
    event_type: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime


class CommandEventsIn(BaseModel):
    events: list[CommandEventIn] = Field(min_length=1, max_length=100)
    delivery_lease_token: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def require_consecutive_unique_events(self):
        event_ids = [event.event_id for event in self.events]
        if len(event_ids) != len(set(event_ids)):
            raise ValueError("event_id values must be unique within a batch")
        sequences = [event.desktop_event_sequence for event in self.events]
        if sequences != list(range(sequences[0], sequences[0] + len(sequences))):
            raise ValueError("events must be ordered by consecutive desktop_event_sequence")
        return self


class CommandEventAckOut(BaseModel):
    event_id: str
    desktop_event_sequence: int
    inserted: bool


class CommandEventsOut(BaseModel):
    command_id: str
    expected_next_desktop_event_sequence: int
    receipt_state: str
    admission_state: str
    execution_state: str
    late_result: bool
    items: list[CommandEventAckOut]


class CommandStateEventOut(BaseModel):
    event_id: str
    producer: str
    desktop_event_sequence: int | None
    server_recorded_version: int | None
    # Temporary protocol alias for Desktop builds released before the
    # self-hosted server renamed this lane. It carries the same local value;
    # no hosted/cloud storage is involved.
    cloud_recorded_version: int | None = None
    event_type: str
    payload: dict[str, Any]
    occurred_at: datetime


class CommandStateOut(BaseModel):
    command_id: str
    project_id: str
    run_id: str | None
    route_device_id: str
    route_version: int
    receipt_state: str
    admission_state: str
    execution_state: str
    actual_execution_state: str | None
    late_result: bool
    integrity_alert: str | None
    expires_at: datetime
    receipt_grace_until: datetime
    events: list[CommandStateEventOut]


class RemoteControlPatchTargetIn(BaseModel):
    project_id: str
    task_id: str | None = None
    history_id: str | None = None


class RemoteControlPatchTargetOut(BaseModel):
    space_id: str | None = None
    current_project_id: str
    current_task_id: str | None = None
    current_history_id: str | None = None
    current_brain_session_id: str
    desktop_ready: Literal["pending", "ready", "failed"] = "pending"


class RemoteControlCommandOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    command_id: str
    status: str
    next_task_id: str | None = None


class RemoteControlStepOut(BaseModel):
    step_id: int
    task_id: str
    project_id: str | None = None
    step: str
    data: Any
    timestamp: float | None = None


class RemoteControlStepsOut(BaseModel):
    items: list[RemoteControlStepOut]
    has_more: bool
    next_since: int


class RemoteControlProjectListOut(BaseModel):
    space: SpaceOut
    items: list[ProjectOut]


class RemoteControlCreateProjectIn(BaseModel):
    name: str
    description: str | None = None
    mode: Literal["single-agent", "workforce"] = "single-agent"
    workdir_mode: str | None = None
    metadata: dict[str, Any] | None = None


class RemoteControlFolderApplyIn(BaseModel):
    run_id: str
    paths: list[str] | None = None
    force_resolutions: list[ApplyResolutionIn] | None = None
    confirm: bool = False


class RemoteControlFolderDiscardIn(BaseModel):
    run_id: str | None = None
    paths: list[str] | None = None
    confirm: bool = False


class RemoteControlFolderRefreshIn(BaseModel):
    force: bool = False


class RemoteControlOverlayListOut(BaseModel):
    command_id: str
    status: str


class RemoteControlFolderOperationOut(BaseModel):
    command_id: str
    status: str
