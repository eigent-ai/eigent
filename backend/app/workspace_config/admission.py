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

"""Compatibility admission adapter for immutable EnvironmentSpec rollout."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.run_journal.models import (
    AttemptEnvironmentBinding,
    EffectiveEnvironmentSpecRecord,
    WorkspaceConfigRevisionRecord,
)
from app.run_journal.store import SQLiteRunJournal
from app.workspace_config.capabilities import ModelCapabilityRegistry
from app.workspace_config.models import (
    EffectiveEnvironmentSpec,
    LocalMaterialization,
    ProviderModelCapability,
    ResolvedContextSource,
    ThinkingEffort,
    WorkforceBundleManifest,
    canonical_digest,
    normalize_thinking_effort,
)
from app.workspace_config.resolver import EnvironmentConfigResolver

_LEGACY_IMPORTER_VERSION = 1


@dataclass(frozen=True)
class EnvironmentAdmissionTemplate:
    manifest: WorkforceBundleManifest
    provider_capability: ProviderModelCapability
    runtime_capability_manifest: dict[str, Any]
    thinking_effort_requested: ThinkingEffort


@dataclass(frozen=True)
class EnvironmentAdmissionResult:
    template: EnvironmentAdmissionTemplate
    spec: EffectiveEnvironmentSpec
    persisted_spec: EffectiveEnvironmentSpecRecord
    revision: WorkspaceConfigRevisionRecord
    binding: AttemptEnvironmentBinding


class LegacyEnvironmentImporter:
    """Convert current Chat inputs into a secret-free compatibility Bundle."""

    def __init__(
        self,
        capability_registry: ModelCapabilityRegistry | None = None,
    ) -> None:
        self.capability_registry = (
            capability_registry or ModelCapabilityRegistry()
        )

    def build_template(
        self,
        *,
        model_platform: str,
        model_type: str,
        auth_source: str | None,
        requested_effort: str | ThinkingEffort | None,
        allow_local_system: bool,
        mcp_server_names: tuple[str, ...] = (),
        session_mode: str = "workforce",
    ) -> EnvironmentAdmissionTemplate:
        capability = self.capability_registry.resolve(
            model_platform=model_platform,
            model_type=model_type,
            auth_source=auth_source,
        )
        effort = (
            normalize_thinking_effort(requested_effort)
            if requested_effort is not None
            else capability.default_effort
        )
        unique_mcp_names = tuple(sorted(set(mcp_server_names)))
        spec = {
            "models": {
                "default": {
                    "modelRef": "provider://default",
                    "thinkingEffort": effort.value,
                }
            },
            "permissions": {
                "profile": (
                    "workspace_write"
                    if allow_local_system
                    else "request_approval"
                ),
                "rules": [],
            },
            "mcpServers": [
                {
                    "id": name,
                    "definition": "registry://mcp/legacy@1",
                    "secretSlots": [],
                    "assignTo": [],
                }
                for name in unique_mcp_names
            ],
        }
        identity = canonical_digest(
            {
                "legacy_importer_version": _LEGACY_IMPORTER_VERSION,
                "spec": spec,
                "model_platform": model_platform.strip().lower(),
                "model_type": model_type.strip().lower(),
            }
        )
        manifest = WorkforceBundleManifest.model_validate(
            {
                "apiVersion": "eigent.ai/v1alpha1",
                "kind": "WorkforceBundle",
                "metadata": {
                    "id": f"bundle_legacy_{identity[:24]}",
                    "name": "Legacy Workspace Compatibility Bundle",
                    "revision": 1,
                },
                "spec": spec,
            }
        )
        runtime_capability_manifest = {
            "schema_version": 1,
            "legacy_importer_version": _LEGACY_IMPORTER_VERSION,
            "model": {
                "platform": model_platform.strip().lower(),
                "type": model_type,
                "auth_source": auth_source or "request_api_key",
            },
            "mcp_server_ids": list(unique_mcp_names),
            "session_mode": session_mode,
        }
        return EnvironmentAdmissionTemplate(
            manifest=manifest,
            provider_capability=capability,
            runtime_capability_manifest=runtime_capability_manifest,
            thinking_effort_requested=effort,
        )


class EnvironmentAdmissionService:
    def __init__(
        self,
        journal: SQLiteRunJournal,
        resolver: EnvironmentConfigResolver | None = None,
    ) -> None:
        self.journal = journal
        self.resolver = resolver or EnvironmentConfigResolver()

    def persist_for_run(
        self,
        *,
        run_id: str,
        space_id: str,
        working_directory: Path,
        created_by: str,
        template: EnvironmentAdmissionTemplate,
    ) -> EnvironmentAdmissionResult:
        current_profile = self.journal.get_space_permission_profile(space_id)
        permission_profile_revision = (
            f"space:{space_id}:{current_profile.revision}"
            if current_profile is not None
            else None
        )
        local_materialization = LocalMaterialization(
            context_sources=(
                ResolvedContextSource(
                    id="workspace_root",
                    kind="local_path_slot",
                    slot_id="workspace_root",
                    absolute_path=str(
                        working_directory.expanduser().resolve()
                    ),
                ),
            )
        )
        spec = self.resolver.resolve(
            manifest=template.manifest,
            owner_type="run",
            owner_id=run_id,
            local_materialization=local_materialization,
            provider_capability=template.provider_capability,
            thinking_effort_override=template.thinking_effort_requested,
            permission_profile_revision_override=(permission_profile_revision),
            allow_dynamic_effort_remap=True,
            runtime_capability_manifest={
                **template.runtime_capability_manifest,
                "workspace": {
                    "space_id": space_id,
                    "logical_root_slot": "workspace_root",
                },
            },
        )
        revision = self.journal.put_workspace_config_revision(
            revision_id=template.manifest.revision_id,
            bundle_id=template.manifest.metadata.id,
            revision_number=template.manifest.metadata.revision,
            manifest=template.manifest.canonical_payload(),
            status="validated",
            created_by=created_by,
        )
        persisted_spec = self.journal.put_effective_environment_spec(
            spec,
            emit_run_event=True,
        )
        binding = AttemptEnvironmentBinding(
            environment_spec_id=spec.spec_id,
            environment_spec_digest=spec.digest,
            bundle_revision_id=spec.bundle_revision_id,
            permission_profile_revision=spec.permission_profile_revision,
            thinking_effort_requested=spec.thinking_effort_requested.value,
            thinking_effort_effective=spec.thinking_effort_effective.value,
            provider_capability_revision=spec.provider_capability_revision,
        )
        return EnvironmentAdmissionResult(
            template=template,
            spec=spec,
            persisted_spec=persisted_spec,
            revision=revision,
            binding=binding,
        )
