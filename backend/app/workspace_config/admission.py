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

from dataclasses import dataclass, replace
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
    ResolvedConnectorBinding,
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
        installed = self.journal.get_latest_workspace_config_materialization(
            space_id
        )
        effective_template = template
        local_context_sources: list[ResolvedContextSource] = []
        connector_bindings: list[ResolvedConnectorBinding] = []
        if installed is not None:
            revision = self.journal.get_workspace_config_revision(
                installed.revision_id
            )
            if revision is None:
                raise ValueError(
                    "Materialized Workspace Bundle revision is missing"
                )
            installed_manifest = WorkforceBundleManifest.model_validate(
                revision.manifest
            )
            proposal = (
                self.journal.get_materialized_workspace_bundle_proposal(
                    space_id=space_id,
                    revision_id=installed.revision_id,
                )
            )
            if proposal is not None:
                bindings = {
                    item.slot_id: item
                    for item in self.journal.list_workspace_bundle_local_bindings(
                        proposal.proposal_id
                    )
                }
                for source in installed_manifest.spec.context:
                    if source.kind == "bundle_asset":
                        local_context_sources.append(
                            ResolvedContextSource(
                                id=source.id,
                                kind=source.kind,
                                logical_uri=source.path,
                            )
                        )
                    elif source.kind == "local_path_slot" and source.slot:
                        binding = bindings.get(source.slot)
                        if binding is None or not binding.local_path:
                            raise ValueError(
                                f"Workspace Bundle path slot "
                                f"{source.slot!r} is not bound"
                            )
                        path = Path(binding.local_path).expanduser().resolve()
                        if not path.is_dir():
                            raise ValueError(
                                f"Workspace Bundle path slot "
                                f"{source.slot!r} is unavailable"
                            )
                        local_context_sources.append(
                            ResolvedContextSource(
                                id=source.id,
                                kind=source.kind,
                                slot_id=source.slot,
                                absolute_path=str(path),
                                root_fingerprint_digest=canonical_digest(
                                    {
                                        "slot_id": source.slot,
                                        "local_path": str(path),
                                    }
                                ),
                            )
                        )
                connector_bindings.extend(
                    ResolvedConnectorBinding(
                        connector_id=item.connector_id or "",
                        slot_id=item.slot_id,
                        local_binding_id=item.opaque_connection_id,
                        required_grants=item.required_grants,
                    )
                    for item in bindings.values()
                    if item.binding_kind == "connector"
                )
            effective_template = replace(
                template,
                manifest=installed_manifest,
                runtime_capability_manifest={
                    **template.runtime_capability_manifest,
                    "workspace_bundle": {
                        "revision_id": installed.revision_id,
                        "config_placement": installed.config_placement,
                    },
                },
            )

        current_profile = self.journal.get_space_permission_profile(space_id)
        permission_profile_revision = (
            f"space:{space_id}:{current_profile.revision}"
            if current_profile is not None
            else None
        )
        if not any(item.id == "workspace_root" for item in local_context_sources):
            local_context_sources.insert(
                0,
                ResolvedContextSource(
                    id="workspace_root",
                    kind="local_path_slot",
                    slot_id="workspace_root",
                    absolute_path=str(
                        working_directory.expanduser().resolve()
                    ),
                ),
            )
        local_materialization = LocalMaterialization(
            context_sources=tuple(local_context_sources),
            connector_bindings=tuple(connector_bindings),
        )
        git_repository = self.journal.get_space_git_repository(
            space_id=space_id
        )
        git_branch: str | None = None
        git_base_commit: str | None = None
        if git_repository is not None:
            try:
                # Local import avoids a workspace_config <-> workspace_git
                # package initialization cycle.
                from app.workspace_git.backend import (
                    GitBackend,
                    GitBackendError,
                )

                probe = GitBackend().probe(Path(git_repository.root_path))
                if probe.is_repository and probe.owns_requested_root:
                    git_branch = probe.branch
                    git_base_commit = probe.head_oid
            except GitBackendError:
                # Admission remains available in degraded mode. Repository
                # reconciliation owns the durable state transition and UI.
                pass
        git_capability = (
            {
                "available": False,
                "reason": "content_repository_disabled",
            }
            if git_repository is None
            else {
                "available": True,
                "repository_id": git_repository.repository_id,
                "logical_root": ".",
                "current_branch": git_branch,
                "base_commit": git_base_commit,
                "version_coverage": git_repository.version_coverage,
                "allowed_actions": [
                    "status",
                    "diff",
                    "log",
                    "checkpoint",
                    "branch_list",
                    "merge_request",
                    "advanced_preview",
                ],
            }
        )
        spec = self.resolver.resolve(
            manifest=effective_template.manifest,
            owner_type="run",
            owner_id=run_id,
            local_materialization=local_materialization,
            provider_capability=effective_template.provider_capability,
            thinking_effort_override=(
                effective_template.thinking_effort_requested
            ),
            permission_profile_revision_override=(permission_profile_revision),
            allow_dynamic_effort_remap=True,
            runtime_capability_manifest={
                **effective_template.runtime_capability_manifest,
                "workspace": {
                    "space_id": space_id,
                    "logical_root_slot": "workspace_root",
                },
                "git": git_capability,
            },
        )
        revision = self.journal.put_workspace_config_revision(
            revision_id=effective_template.manifest.revision_id,
            bundle_id=effective_template.manifest.metadata.id,
            revision_number=effective_template.manifest.metadata.revision,
            manifest=effective_template.manifest.canonical_payload(),
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
            template=effective_template,
            spec=spec,
            persisted_spec=persisted_spec,
            revision=revision,
            binding=binding,
        )
