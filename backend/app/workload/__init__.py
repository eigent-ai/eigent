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

"""Product-neutral workload contracts shared by every Run Attempt.

The profile describes purpose and SLA policy references. It deliberately does
not fork the Run state machine and is not part of Workspace Bundle or
EffectiveEnvironmentSpec identity.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Any

from app.workspace_config.models import canonical_digest

WORKLOAD_PROFILE_SCHEMA_VERSION = 1
WORKLOAD_PROFILE_MIN_SUPPORTED_SCHEMA_VERSION = 1
WORKLOAD_KINDS = frozenset({"production", "test", "ab", "rollout"})

CAPTURE_POLICY_BEST_EFFORT = "capture.best-effort.v1"
CAPTURE_POLICY_REQUIRED = "capture.required.v1"
CAPTURE_POLICIES = frozenset(
    {CAPTURE_POLICY_BEST_EFFORT, CAPTURE_POLICY_REQUIRED}
)
RETENTION_POLICY_PRODUCT_DEFAULT = "retention.product-default.v1"
RETENTION_POLICY_EVIDENCE_REQUIRED = "retention.evidence-required.v1"
PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS = 30 * 24 * 60 * 60


@dataclass(frozen=True)
class WorkloadProfileRecord:
    """Immutable purpose/SLA policy binding for one Run Attempt."""

    schema_version: int
    workload_kind: str
    profile_version: str
    isolation_policy_ref: str
    capture_policy_ref: str
    verifier_policy_ref: str
    budget_policy_ref: str
    network_policy_ref: str
    retention_policy_ref: str
    pairing_key: str | None = None
    experiment_id: str | None = None
    rollout_batch_id: str | None = None


DEFAULT_PRODUCTION_WORKLOAD_PROFILE = WorkloadProfileRecord(
    schema_version=WORKLOAD_PROFILE_SCHEMA_VERSION,
    workload_kind="production",
    profile_version="1",
    isolation_policy_ref="isolation.product-default.v1",
    capture_policy_ref=CAPTURE_POLICY_BEST_EFFORT,
    verifier_policy_ref="verifier.noop.v1",
    budget_policy_ref="budget.product-default.v1",
    network_policy_ref="network.product-default.v1",
    retention_policy_ref=RETENTION_POLICY_PRODUCT_DEFAULT,
)


def default_workload_profile() -> WorkloadProfileRecord:
    """Resolve compatibility configuration once, at Attempt admission.

    Runtime capture decisions must use the immutable profile persisted on the
    Attempt. The environment variable remains a compatibility entry point,
    but it is translated into that profile instead of being consulted for
    every model dispatch.
    """

    if os.environ.get("EIGENT_MODEL_CAPTURE_REQUIRED", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }:
        return replace(
            DEFAULT_PRODUCTION_WORKLOAD_PROFILE,
            capture_policy_ref=CAPTURE_POLICY_REQUIRED,
        )
    return DEFAULT_PRODUCTION_WORKLOAD_PROFILE


def workload_profile_payload(profile: WorkloadProfileRecord) -> dict[str, Any]:
    """Return the only canonical JSON shape used for profile persistence."""

    payload: dict[str, Any] = {
        "schema_version": profile.schema_version,
        "workload_kind": profile.workload_kind,
        "profile_version": profile.profile_version,
        "isolation_policy_ref": profile.isolation_policy_ref,
        "capture_policy_ref": profile.capture_policy_ref,
        "verifier_policy_ref": profile.verifier_policy_ref,
        "budget_policy_ref": profile.budget_policy_ref,
        "network_policy_ref": profile.network_policy_ref,
        "retention_policy_ref": profile.retention_policy_ref,
    }
    for key in ("pairing_key", "experiment_id", "rollout_batch_id"):
        value = getattr(profile, key)
        if value is not None:
            payload[key] = value
    return payload


def validate_workload_profile(
    profile: WorkloadProfileRecord,
) -> WorkloadProfileRecord:
    if not (
        WORKLOAD_PROFILE_MIN_SUPPORTED_SCHEMA_VERSION
        <= profile.schema_version
        <= WORKLOAD_PROFILE_SCHEMA_VERSION
    ):
        raise ValueError(
            f"unsupported WorkloadProfile schema {profile.schema_version}"
        )
    if profile.workload_kind not in WORKLOAD_KINDS:
        raise ValueError(
            f"unsupported workload kind {profile.workload_kind!r}"
        )
    required = (
        profile.profile_version,
        profile.isolation_policy_ref,
        profile.capture_policy_ref,
        profile.verifier_policy_ref,
        profile.budget_policy_ref,
        profile.network_policy_ref,
        profile.retention_policy_ref,
    )
    if any(not value.strip() for value in required):
        raise ValueError("WorkloadProfile policy references are required")
    if profile.capture_policy_ref not in CAPTURE_POLICIES:
        raise ValueError(
            f"unsupported capture policy {profile.capture_policy_ref!r}"
        )
    optional = (
        profile.pairing_key,
        profile.experiment_id,
        profile.rollout_batch_id,
    )
    if any(value is not None and not value.strip() for value in optional):
        raise ValueError("WorkloadProfile optional identities cannot be blank")
    return profile


def workload_profile_digest(profile: WorkloadProfileRecord) -> str:
    return canonical_digest(
        workload_profile_payload(validate_workload_profile(profile))
    )


def workload_profile_from_payload(
    payload: dict[str, Any],
) -> WorkloadProfileRecord:
    profile = WorkloadProfileRecord(
        schema_version=int(payload["schema_version"]),
        workload_kind=str(payload["workload_kind"]),
        profile_version=str(payload["profile_version"]),
        isolation_policy_ref=str(payload["isolation_policy_ref"]),
        capture_policy_ref=str(payload["capture_policy_ref"]),
        verifier_policy_ref=str(payload["verifier_policy_ref"]),
        budget_policy_ref=str(payload["budget_policy_ref"]),
        network_policy_ref=str(payload["network_policy_ref"]),
        retention_policy_ref=str(payload["retention_policy_ref"]),
        pairing_key=_optional_text(payload.get("pairing_key")),
        experiment_id=_optional_text(payload.get("experiment_id")),
        rollout_batch_id=_optional_text(payload.get("rollout_batch_id")),
    )
    return validate_workload_profile(profile)


def capture_required(profile: WorkloadProfileRecord | None) -> bool:
    return bool(
        profile is not None
        and profile.capture_policy_ref == CAPTURE_POLICY_REQUIRED
    )


def _optional_text(value: Any) -> str | None:
    return str(value) if value is not None else None


__all__ = [
    "CAPTURE_POLICY_BEST_EFFORT",
    "CAPTURE_POLICIES",
    "CAPTURE_POLICY_REQUIRED",
    "DEFAULT_PRODUCTION_WORKLOAD_PROFILE",
    "PRODUCT_MODEL_DOCUMENT_RETENTION_SECONDS",
    "RETENTION_POLICY_EVIDENCE_REQUIRED",
    "RETENTION_POLICY_PRODUCT_DEFAULT",
    "WORKLOAD_KINDS",
    "WORKLOAD_PROFILE_MIN_SUPPORTED_SCHEMA_VERSION",
    "WORKLOAD_PROFILE_SCHEMA_VERSION",
    "WorkloadProfileRecord",
    "capture_required",
    "default_workload_profile",
    "validate_workload_profile",
    "workload_profile_digest",
    "workload_profile_from_payload",
    "workload_profile_payload",
]
