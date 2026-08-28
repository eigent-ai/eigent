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

"""Deterministic Phase-1 EnvironmentSpec resolver."""

from __future__ import annotations

from typing import Any, Literal

from app.workspace_config.models import (
    EffectiveEnvironmentSpec,
    LocalMaterialization,
    ProviderModelCapability,
    ThinkingEffort,
    WorkspaceBundleManifest,
    canonical_digest,
)


class EnvironmentConfigResolver:
    """Resolve immutable semantic/local snapshots without reading secrets."""

    def resolve(
        self,
        *,
        manifest: WorkspaceBundleManifest,
        owner_type: Literal["run", "run_attempt"],
        owner_id: str,
        local_materialization: LocalMaterialization,
        provider_capability: ProviderModelCapability,
        model_profile: str = "default",
        thinking_effort_override: str | ThinkingEffort | None = None,
        permission_profile_revision_override: str | None = None,
        allow_dynamic_effort_remap: bool = False,
        runtime_capability_manifest: dict[str, Any] | None = None,
    ) -> EffectiveEnvironmentSpec:
        try:
            profile = manifest.spec.models[model_profile]
        except KeyError as exc:
            raise ValueError(
                f"Bundle does not define model profile {model_profile!r}"
            ) from exc
        requested_effort = (
            thinking_effort_override
            if thinking_effort_override is not None
            else profile.thinking_effort
        )
        effort = provider_capability.resolve(
            requested_effort,
            allow_dynamic_remap=allow_dynamic_effort_remap,
        )
        permission_payload = manifest.spec.permissions.model_dump(
            by_alias=True,
            mode="json",
        )
        permission_revision = (
            permission_profile_revision_override
            or canonical_digest(permission_payload)
        )
        semantic_spec = {
            "bundle": manifest.canonical_payload(),
            "selected_model_profile": model_profile,
            "model_ref": profile.model_ref,
            "runtime_capability_manifest": runtime_capability_manifest or {},
        }
        return EffectiveEnvironmentSpec.create(
            owner_type=owner_type,
            owner_id=owner_id,
            manifest=manifest,
            semantic_spec=semantic_spec,
            local_materialization=local_materialization,
            permission_profile_revision=permission_revision,
            effort=effort,
        )
