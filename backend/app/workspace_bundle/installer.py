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

"""Review-first local Workspace Bundle installation and materialization."""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from typing import Any

from app.run_journal import (
    InvalidRunTransitionError,
    SQLiteRunJournal,
    WorkspaceBundleInstallProposalRecord,
    WorkspaceBundleLocalBindingRecord,
    WorkspaceBundleSecretBindingRecord,
)
from app.workspace_bundle.cloud import WorkspaceBundleCloudTransport
from app.workspace_bundle.mcp_destination import (
    McpDestinationError,
    attestation_grant,
    inspect_bundle_mcp_destination,
    registry_unavailable_destination,
    secret_binding_attestation,
    secret_binding_grant,
)
from app.workspace_bundle.secrets import (
    WorkspaceSecretBroker,
    WorkspaceSecretBrokerError,
    WorkspaceSecretIdentity,
)
from app.workspace_config import (
    ConfigPlacement,
    SecretValueInManifestError,
    WorkspaceBundleManifest,
    assert_bundle_asset_safe,
    canonical_digest,
)
from app.workspace_git import ConfigurationRepositoryService


class WorkspaceBundleInstallError(RuntimeError):
    pass


class WorkspaceBundleBindingsIncomplete(WorkspaceBundleInstallError):
    def __init__(self, missing_slots: list[str]) -> None:
        self.missing_slots = tuple(sorted(missing_slots))
        super().__init__(
            "Bundle installation is missing explicit bindings: "
            + ", ".join(self.missing_slots)
        )


class WorkspaceBundleInstaller:
    MAX_TOTAL_ASSET_BYTES = 128 * 1024 * 1024
    REQUIRED_CLOUD_CAPABILITIES = frozenset(
        {
            "bundle.asset.integrity.v1",
            "bundle.install.review.v1",
        }
    )

    def __init__(
        self,
        journal: SQLiteRunJournal,
        configuration_repository: ConfigurationRepositoryService,
        cloud: WorkspaceBundleCloudTransport | None,
        secret_broker: WorkspaceSecretBroker | None = None,
    ) -> None:
        self.journal = journal
        self.configuration_repository = configuration_repository
        self.cloud = cloud
        self.secret_broker = secret_broker

    async def propose(
        self,
        *,
        proposal_id: str,
        request_id: str,
        space_id: str,
        publisher_namespace: str,
        slug: str,
        version: int,
        config_placement: ConfigPlacement,
    ) -> WorkspaceBundleInstallProposalRecord:
        if self.cloud is None:
            raise WorkspaceBundleInstallError(
                "Bundle Cloud transport is unavailable"
            )
        revision = await self.cloud.get_catalog_revision(
            publisher_namespace,
            slug,
            version,
        )
        if revision.get("status") != "published":
            raise WorkspaceBundleInstallError(
                "Only published Bundle revisions can be installed"
            )
        manifest_value = revision.get("manifest")
        if not isinstance(manifest_value, dict):
            raise WorkspaceBundleInstallError("Bundle manifest is missing")
        manifest = WorkspaceBundleManifest.model_validate(manifest_value)
        bundle_id = revision.get("bundle_id")
        revision_id = revision.get("revision_id")
        if (
            not isinstance(bundle_id, str)
            or not isinstance(revision_id, str)
            or manifest.metadata.id != slug
            or manifest.metadata.revision != version
            or revision.get("publisher_namespace") != publisher_namespace
            or revision.get("slug") != slug
            or revision.get("version") != version
        ):
            raise WorkspaceBundleInstallError(
                "Bundle revision identity mismatch"
            )
        if revision.get("manifest_digest") != manifest.digest:
            raise WorkspaceBundleInstallError(
                "Bundle manifest digest mismatch"
            )
        assets = revision.get("assets", [])
        if not isinstance(assets, list):
            raise WorkspaceBundleInstallError(
                "Bundle asset manifest is invalid"
            )
        normalized_assets = [
            self._validate_asset_descriptor(item) for item in assets
        ]
        logical_paths = [item["logical_path"] for item in normalized_assets]
        if len(set(logical_paths)) != len(logical_paths):
            raise WorkspaceBundleInstallError(
                "Bundle asset logical paths must be unique"
            )
        mcp_destinations = await self._inspect_mcp_destinations(
            manifest,
            normalized_assets,
        )
        install_plan = self._install_plan(
            manifest,
            normalized_assets,
            mcp_destinations=mcp_destinations,
        )
        install_plan["public_coordinate"] = (
            f"@{publisher_namespace}/{slug}@{version}"
        )
        return self.journal.put_workspace_bundle_install_proposal(
            proposal_id=proposal_id,
            request_id=request_id,
            space_id=space_id,
            bundle_id=bundle_id,
            revision_id=revision_id,
            config_placement=config_placement.value,
            manifest=manifest.canonical_payload(),
            assets=normalized_assets,
            install_plan=install_plan,
        )

    def decide(
        self,
        proposal_id: str,
        *,
        expected_version: int,
        approved: bool,
        decided_by: str,
    ) -> WorkspaceBundleInstallProposalRecord:
        return self.journal.transition_workspace_bundle_install_proposal(
            proposal_id,
            expected_version=expected_version,
            state="approved" if approved else "rejected",
            decided_by=decided_by,
        )

    def bind_connector(
        self,
        proposal_id: str,
        *,
        expected_version: int,
        slot_id: str,
        connector_id: str,
        opaque_connection_id: str,
        authorized_by: str,
    ) -> tuple[
        WorkspaceBundleLocalBindingRecord,
        WorkspaceBundleInstallProposalRecord,
    ]:
        proposal = self._proposal(proposal_id)
        connector = next(
            (
                item
                for item in proposal.install_plan["connector_slots"]
                if item["slot_id"] == slot_id
            ),
            None,
        )
        if connector is None or connector["connector_id"] != connector_id:
            raise WorkspaceBundleInstallError(
                "Connector does not match a declared Bundle slot"
            )
        return self.journal.put_workspace_bundle_local_binding(
            proposal_id=proposal_id,
            expected_proposal_version=expected_version,
            slot_id=slot_id,
            binding_kind="connector",
            connector_id=connector_id,
            opaque_connection_id=opaque_connection_id,
            local_path=None,
            required_grants=connector["required_grants"],
            authorized_by=authorized_by,
        )

    def bind_local_path(
        self,
        proposal_id: str,
        *,
        expected_version: int,
        slot_id: str,
        local_path: Path,
        authorized_by: str,
    ) -> tuple[
        WorkspaceBundleLocalBindingRecord,
        WorkspaceBundleInstallProposalRecord,
    ]:
        proposal = self._proposal(proposal_id)
        if slot_id not in proposal.install_plan["local_path_slots"]:
            raise WorkspaceBundleInstallError(
                "Local path does not match a declared Bundle slot"
            )
        resolved = local_path.expanduser().resolve()
        if not resolved.is_dir():
            raise WorkspaceBundleInstallError("Local path must be a directory")
        return self.journal.put_workspace_bundle_local_binding(
            proposal_id=proposal_id,
            expected_proposal_version=expected_version,
            slot_id=slot_id,
            binding_kind="local_path",
            connector_id=None,
            opaque_connection_id=None,
            local_path=str(resolved),
            required_grants=[],
            authorized_by=authorized_by,
        )

    def approve_script_action(
        self,
        proposal_id: str,
        *,
        expected_version: int,
        action_id: str,
        authorized_by: str,
    ) -> tuple[
        WorkspaceBundleLocalBindingRecord,
        WorkspaceBundleInstallProposalRecord,
    ]:
        proposal = self._proposal(proposal_id)
        if action_id not in proposal.install_plan["script_actions"]:
            raise WorkspaceBundleInstallError(
                "Script action is not declared by this Bundle"
            )
        required_grants: list[str] = []
        if action_id.startswith("mcp.server.start:"):
            server_id = action_id.removeprefix("mcp.server.start:")
            destination = next(
                (
                    item
                    for item in proposal.install_plan.get(
                        "mcp_destinations", []
                    )
                    if item.get("mcp_id") == server_id
                ),
                None,
            )
            if destination is None:
                raise WorkspaceBundleInstallError(
                    "MCP destination review is unavailable"
                )
            if destination.get("requires_secret_confirmation"):
                digest = destination.get("attestation_digest")
                if not isinstance(digest, str):
                    issue = destination.get("availability_issue") or (
                        "mcp_destination_confirmation_required"
                    )
                    raise WorkspaceBundleInstallError(str(issue))
                required_grants.append(attestation_grant(digest))
                secret_bindings = (
                    self.journal.list_workspace_bundle_secret_bindings(
                        proposal_id
                    )
                )
                expected_keys = {
                    item["requirement_key"]
                    for item in proposal.install_plan.get(
                        "mcp_secret_requirements", []
                    )
                    if item.get("mcp_id") == server_id
                }
                current = {
                    item.requirement_key: item
                    for item in secret_bindings
                    if item.requirement_key in expected_keys
                }
                if set(current) != expected_keys:
                    raise WorkspaceBundleBindingsIncomplete(
                        sorted(expected_keys - set(current))
                    )
                binding_digest = secret_binding_attestation(
                    mcp_id=server_id,
                    bindings=[
                        {
                            "requirement_key": item.requirement_key,
                            "secret_ref": item.secret_ref,
                            "binding_version": item.binding_version,
                            "account_scope_digest": (
                                item.account_scope_digest
                            ),
                        }
                        for item in current.values()
                    ],
                )
                required_grants.append(secret_binding_grant(binding_digest))
        return self.journal.put_workspace_bundle_local_binding(
            proposal_id=proposal_id,
            expected_proposal_version=expected_version,
            slot_id=action_id,
            binding_kind="script_approval",
            connector_id=None,
            opaque_connection_id=None,
            local_path=None,
            required_grants=required_grants,
            authorized_by=authorized_by,
        )

    def bind_local_values(
        self,
        proposal_id: str,
        *,
        client_request_id: str,
        expected_version: int,
        bindings: list[dict[str, Any]],
        authorized_by: str,
    ) -> tuple[
        tuple[WorkspaceBundleSecretBindingRecord, ...],
        WorkspaceBundleInstallProposalRecord,
    ]:
        proposal = self._proposal(proposal_id)
        requirements = {
            item["requirement_key"]: ("environment", item)
            for item in proposal.install_plan.get(
                "environment_requirements", []
            )
        }
        requirements.update(
            {
                item["requirement_key"]: ("mcp_secret", item)
                for item in proposal.install_plan.get(
                    "mcp_secret_requirements", []
                )
            }
        )
        if self.secret_broker is None:
            raise WorkspaceBundleInstallError(
                "Local secret storage is unavailable"
            )
        normalized: list[dict[str, Any]] = []
        identities: list[WorkspaceSecretIdentity] = []
        for binding in bindings:
            requirement_key = str(binding.get("requirement_key") or "")
            requirement_kind = str(binding.get("requirement_kind") or "")
            requirement = requirements.get(requirement_key)
            if requirement is None or requirement[0] != requirement_kind:
                raise WorkspaceBundleInstallError(
                    "Local value does not match a declared Bundle requirement"
                )
            identity = WorkspaceSecretIdentity(
                secret_ref=str(binding.get("secret_ref") or ""),
                account_scope_digest=str(
                    binding.get("account_scope_digest") or ""
                ),
                space_id=proposal.space_id,
                revision_id=proposal.revision_id,
                slot_id=requirement_key,
            )
            identities.append(identity)
            normalized.append(
                {
                    "requirement_key": requirement_key,
                    "requirement_kind": requirement_kind,
                    "secret_ref": identity.secret_ref,
                    "account_scope_digest": identity.account_scope_digest,
                    "expected_binding_version": binding.get(
                        "expected_binding_version"
                    ),
                }
            )
        try:
            verifications = self.secret_broker.verify_many(identities)
        except WorkspaceSecretBrokerError as exc:
            raise WorkspaceBundleInstallError(
                "Local values must be rebound"
            ) from exc
        unavailable = [
            verification.identity.slot_id
            for verification in verifications
            if verification.state != "available"
        ]
        if unavailable:
            raise WorkspaceBundleInstallError(
                f"Local value {unavailable[0]!r} must be rebound"
            )
        return self.journal.put_workspace_bundle_secret_bindings(
            proposal_id=proposal_id,
            client_request_id=client_request_id,
            expected_proposal_version=expected_version,
            bindings=normalized,
            authorized_by=authorized_by,
        )

    async def materialize(
        self,
        proposal_id: str,
        *,
        expected_version: int,
        space_root: Path,
        actor_id: str,
        allow_content_repository_init: bool = False,
    ) -> WorkspaceBundleInstallProposalRecord:
        proposal = self._proposal(proposal_id)
        if self.cloud is None:
            raise WorkspaceBundleInstallError(
                "Bundle Cloud transport is unavailable"
            )
        if proposal.state == "materialized":
            return proposal
        if proposal.version != expected_version:
            raise InvalidRunTransitionError("Bundle install proposal changed")
        bindings = self.journal.list_workspace_bundle_local_bindings(
            proposal_id
        )
        secret_bindings = self.journal.list_workspace_bundle_secret_bindings(
            proposal_id
        )
        self._require_complete_bindings(proposal, bindings, secret_bindings)
        self._verify_secret_bindings(proposal, secret_bindings)
        materializing = (
            self.journal.transition_workspace_bundle_install_proposal(
                proposal_id,
                expected_version=expected_version,
                state="materializing",
            )
        )
        try:
            (
                cloud_installation,
                previous_revision_id,
            ) = await self._ensure_cloud_installation(proposal)
            cloud_version = int(cloud_installation["version"])
            for binding in bindings:
                if binding.binding_kind != "connector":
                    continue
                cloud_installation = await self.cloud.bind_connection(
                    proposal.space_id,
                    {
                        "bundle_id": proposal.bundle_id,
                        "slot_id": binding.slot_id,
                        "connector_id": binding.connector_id,
                        "connection_id": binding.opaque_connection_id,
                        "acknowledged_grants": list(binding.required_grants),
                        "expected_installation_version": cloud_version,
                    },
                )
                cloud_version = int(cloud_installation["version"])
            assets, executable_assets = await self._download_assets(proposal)
            manifest = WorkspaceBundleManifest.model_validate(
                proposal.manifest
            )
            lock_payload = {
                "apiVersion": "eigent.ai/lock/v1alpha1",
                "bundleRevision": proposal.revision_id,
                "manifestDigest": proposal.manifest_digest,
                "assets": [
                    {
                        "ref": f"bundle://{item['logical_path']}",
                        "digest": item["content_digest"],
                        "provenance": item["provenance"],
                        "executable": item["executable"],
                    }
                    for item in proposal.assets
                ],
                "skills": [],
                "mcpPackages": [],
            }
            await asyncio.to_thread(
                self.configuration_repository.bootstrap,
                space_id=proposal.space_id,
                space_root=space_root,
                manifest=manifest,
                placement=ConfigPlacement(proposal.config_placement),
                created_by=actor_id,
                lock_payload=lock_payload,
                assets=assets,
                executable_assets=executable_assets,
                expected_previous_revision_id=previous_revision_id,
                allow_content_repository_init=allow_content_repository_init,
            )
            revision = self.journal.get_workspace_config_revision(
                proposal.revision_id
            )
            if revision is None:
                raise WorkspaceBundleInstallError(
                    "Materialized Bundle revision was not persisted"
                )
            self.journal.transition_workspace_config_revision(
                proposal.revision_id,
                expected_version=revision.version,
                status="published",
            )
            projection = self._space_projection(proposal, bindings)
            semantic_spec_digest = canonical_digest(proposal.manifest["spec"])
            projection_id = self._environment_projection_id(
                space_id=proposal.space_id,
                owner_type="space",
                owner_id=proposal.space_id,
                semantic_spec_digest=semantic_spec_digest,
                projection_digest=projection["projection_digest"],
                redaction_schema_version=1,
            )
            await self.cloud.put_environment_projection(
                {
                    "projection_id": projection_id,
                    "space_id": proposal.space_id,
                    "owner_type": "space",
                    "owner_id": proposal.space_id,
                    "semantic_spec_digest": semantic_spec_digest,
                    "redacted_spec": projection["redacted_spec"],
                    "redaction_schema_version": 1,
                    "projection_digest": projection["projection_digest"],
                    "capability_revision": "unresolved-at-space-install",
                    "installation_version": cloud_version,
                }
            )
        except Exception:
            self.journal.transition_workspace_bundle_install_proposal(
                proposal_id,
                expected_version=materializing.version,
                state="needs_attention",
                error_code="bundle_materialization_failed",
            )
            raise
        return self.journal.transition_workspace_bundle_install_proposal(
            proposal_id,
            expected_version=materializing.version,
            state="materialized",
        )

    async def _ensure_cloud_installation(
        self,
        proposal: WorkspaceBundleInstallProposalRecord,
    ) -> tuple[dict[str, Any], str | None]:
        assert self.cloud is not None
        environment = await self.cloud.get_environment(proposal.space_id)
        if "protocol_capabilities" in environment:
            capabilities = environment["protocol_capabilities"]
            if not isinstance(capabilities, list):
                raise WorkspaceBundleInstallError(
                    "Cloud returned invalid Bundle protocol capabilities"
                )
            available = {str(item) for item in capabilities}
            missing = sorted(self.REQUIRED_CLOUD_CAPABILITIES - available)
            if missing:
                raise WorkspaceBundleInstallError(
                    "Cloud must be upgraded before installing this Bundle; "
                    "missing protocol capabilities: " + ", ".join(missing)
                )
        installation = environment.get("installation")
        if installation is None:
            installation = await self.cloud.install(
                proposal.space_id,
                proposal.bundle_id,
                proposal.revision_id,
            )
            return await self._confirm_cloud_installation(
                proposal, installation
            ), None
        if not isinstance(installation, dict):
            raise WorkspaceBundleInstallError(
                "Cloud returned an invalid Bundle installation"
            )
        installed_bundle_id = str(installation.get("bundle_id", ""))
        installed_revision_id = str(
            installation.get("installed_revision_id", "")
        )
        if installed_bundle_id != proposal.bundle_id:
            raise WorkspaceBundleInstallError(
                "Space already uses a different Workspace Bundle"
            )
        if installed_revision_id == proposal.revision_id:
            local_materialization = (
                self.journal.get_latest_workspace_config_materialization(
                    proposal.space_id
                )
            )
            previous_revision_id = (
                local_materialization.revision_id
                if local_materialization is not None
                and local_materialization.revision_id != proposal.revision_id
                else None
            )
            return (
                await self._confirm_cloud_installation(proposal, installation),
                previous_revision_id,
            )
        try:
            installed_version = int(installation["version"])
        except (KeyError, TypeError, ValueError) as exc:
            raise WorkspaceBundleInstallError(
                "Cloud Bundle installation version is invalid"
            ) from exc
        upgraded = await self.cloud.upgrade(
            proposal.space_id,
            revision_id=proposal.revision_id,
            expected_installed_revision_id=installed_revision_id,
            expected_version=installed_version,
        )
        return (
            await self._confirm_cloud_installation(proposal, upgraded),
            installed_revision_id,
        )

    async def _confirm_cloud_installation(
        self,
        proposal: WorkspaceBundleInstallProposalRecord,
        installation: dict[str, Any],
    ) -> dict[str, Any]:
        assert self.cloud is not None
        if installation.get("state") != "proposed":
            return installation
        try:
            expected_version = int(installation["version"])
        except (KeyError, TypeError, ValueError) as exc:
            raise WorkspaceBundleInstallError(
                "Cloud Bundle install proposal version is invalid"
            ) from exc
        reviewed_slots = [
            {
                "slot_id": item["slot_id"],
                "connector_id": item["connector_id"],
                "required_grants": sorted(
                    set(item.get("required_grants", []))
                ),
            }
            for item in proposal.install_plan["connector_slots"]
        ]
        return await self.cloud.confirm_install(
            proposal.space_id,
            {
                "bundle_id": proposal.bundle_id,
                "revision_id": proposal.revision_id,
                "expected_version": expected_version,
                "reviewed_manifest_digest": proposal.manifest_digest,
                "reviewed_slots": reviewed_slots,
            },
        )

    @staticmethod
    def _environment_projection_id(
        *,
        space_id: str,
        owner_type: str,
        owner_id: str,
        semantic_spec_digest: str,
        projection_digest: str,
        redaction_schema_version: int,
    ) -> str:
        return (
            "envproj_"
            + canonical_digest(
                {
                    "space_id": space_id,
                    "owner_type": owner_type,
                    "owner_id": owner_id,
                    "semantic_spec_digest": semantic_spec_digest,
                    "projection_digest": projection_digest,
                    "redaction_schema_version": redaction_schema_version,
                }
            )[:40]
        )

    def _proposal(
        self, proposal_id: str
    ) -> WorkspaceBundleInstallProposalRecord:
        proposal = self.journal.get_workspace_bundle_install_proposal(
            proposal_id
        )
        if proposal is None:
            raise WorkspaceBundleInstallError(
                "Bundle install proposal not found"
            )
        return proposal

    @staticmethod
    def _validate_asset_descriptor(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise WorkspaceBundleInstallError(
                "Bundle asset descriptor is invalid"
            )
        required = (
            "id",
            "logical_path",
            "content_digest",
            "media_type",
            "size_bytes",
        )
        if any(value.get(key) is None for key in required):
            raise WorkspaceBundleInstallError(
                "Bundle asset descriptor is incomplete"
            )
        digest = str(value["content_digest"])
        size = int(value["size_bytes"])
        if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
            raise WorkspaceBundleInstallError("Bundle asset digest is invalid")
        if size < 0 or size > 16 * 1024 * 1024:
            raise WorkspaceBundleInstallError("Bundle asset size is invalid")
        executable = value.get("executable", False)
        if not isinstance(executable, bool):
            raise WorkspaceBundleInstallError(
                "Bundle asset executable metadata is invalid"
            )
        return {
            "id": str(value["id"]),
            "logical_path": str(value["logical_path"]),
            "content_digest": digest,
            "media_type": str(value["media_type"]),
            "size_bytes": size,
            "provenance": str(value.get("provenance", "bundle_author")),
            "executable": executable,
        }

    @staticmethod
    def _install_plan(
        manifest: WorkspaceBundleManifest,
        assets: list[dict[str, Any]],
        *,
        mcp_destinations: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        script_actions = [
            f"skill.script.execute:{item.ref}"
            for item in manifest.spec.skills
            if item.ref.startswith("bundle://")
        ] + [
            f"mcp.server.start:{item.id}" for item in manifest.spec.mcp_servers
        ]
        return {
            "connector_slots": [
                {
                    "slot_id": item.connection_slot,
                    "connector_id": item.connector,
                    "required_grants": list(item.required_grants),
                }
                for item in manifest.spec.connectors
            ],
            "local_path_slots": sorted(
                {
                    source.slot
                    for source in manifest.spec.context
                    if source.kind == "local_path_slot" and source.slot
                }
            ),
            "script_actions": sorted(script_actions),
            "environment_requirements": [
                {
                    "requirement_key": f"environment:{item.name}",
                    "name": item.name,
                    "required": item.required,
                    "sensitive": item.sensitive,
                    "description": item.description,
                    "example": item.example,
                }
                for item in (
                    manifest.spec.environment.variables
                    if manifest.spec.environment
                    else ()
                )
            ],
            "mcp_secret_requirements": sorted(
                (
                    {
                        "requirement_key": (
                            f"mcp_secret:{server.id}:{slot_id}"
                        ),
                        "mcp_id": server.id,
                        "slot_id": slot_id,
                        "required": True,
                    }
                    for server in manifest.spec.mcp_servers
                    for slot_id in server.secret_slots
                ),
                key=lambda item: item["requirement_key"],
            ),
            "mcp_destinations": list(mcp_destinations or []),
            "permission_profile": manifest.spec.permissions.profile,
            "git_policy": manifest.spec.git.model_dump(
                by_alias=True, mode="json"
            ),
            "asset_count": len(assets),
            "asset_bytes": sum(int(item["size_bytes"]) for item in assets),
            "automatic_grants": [],
        }

    async def _inspect_mcp_destinations(
        self,
        manifest: WorkspaceBundleManifest,
        assets: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        assert self.cloud is not None
        assets_by_ref = {
            f"bundle://{item['logical_path']}": item for item in assets
        }
        destinations: list[dict[str, Any]] = []
        for server in manifest.spec.mcp_servers:
            if server.definition.startswith("registry://"):
                destinations.append(
                    registry_unavailable_destination(
                        mcp_id=server.id,
                        definition_ref=server.definition,
                        secret_slots=server.secret_slots,
                    )
                )
                continue
            descriptor = assets_by_ref.get(server.definition)
            if descriptor is None:
                raise WorkspaceBundleInstallError(
                    f"MCP definition asset is missing: {server.id}"
                )
            content = await self.cloud.download_asset(
                manifest.metadata.id,
                manifest.revision_id,
                descriptor["id"],
            )
            if len(content) != int(descriptor["size_bytes"]):
                raise WorkspaceBundleInstallError(
                    "MCP definition asset size mismatch"
                )
            try:
                assert_bundle_asset_safe(descriptor["logical_path"], content)
                destination = inspect_bundle_mcp_destination(
                    revision_id=manifest.revision_id,
                    mcp_id=server.id,
                    definition_ref=server.definition,
                    definition_digest=descriptor["content_digest"],
                    content=content,
                    secret_slots=server.secret_slots,
                    executable_assets_by_ref=assets_by_ref,
                )
            except (McpDestinationError, SecretValueInManifestError) as exc:
                raise WorkspaceBundleInstallError(
                    f"MCP destination review failed: {server.id}"
                ) from exc
            destinations.append(destination)
        return destinations

    @staticmethod
    def _require_complete_bindings(
        proposal: WorkspaceBundleInstallProposalRecord,
        bindings: tuple[WorkspaceBundleLocalBindingRecord, ...],
        secret_bindings: tuple[WorkspaceBundleSecretBindingRecord, ...],
    ) -> None:
        present = {binding.slot_id for binding in bindings}
        required = {
            item["slot_id"]
            for item in proposal.install_plan["connector_slots"]
        }
        required.update(proposal.install_plan["local_path_slots"])
        required.update(proposal.install_plan["script_actions"])
        secret_present = {
            binding.requirement_key for binding in secret_bindings
        }
        secret_required = {
            item["requirement_key"]
            for item in proposal.install_plan.get(
                "environment_requirements", []
            )
            if item["required"]
        }
        secret_required.update(
            item["requirement_key"]
            for item in proposal.install_plan.get(
                "mcp_secret_requirements", []
            )
        )
        missing = sorted(
            (required - present) | (secret_required - secret_present)
        )
        if missing:
            raise WorkspaceBundleBindingsIncomplete(missing)

    def _verify_secret_bindings(
        self,
        proposal: WorkspaceBundleInstallProposalRecord,
        bindings: tuple[WorkspaceBundleSecretBindingRecord, ...],
    ) -> None:
        if not bindings:
            return
        if self.secret_broker is None:
            raise WorkspaceBundleBindingsIncomplete(
                [binding.requirement_key for binding in bindings]
            )
        identities = tuple(
            WorkspaceSecretIdentity(
                secret_ref=binding.secret_ref,
                account_scope_digest=binding.account_scope_digest,
                space_id=proposal.space_id,
                revision_id=proposal.revision_id,
                slot_id=binding.requirement_key,
            )
            for binding in bindings
        )
        try:
            verifications = self.secret_broker.verify_many(identities)
            missing = [
                verification.identity.slot_id
                for verification in verifications
                if verification.state != "available"
            ]
        except WorkspaceSecretBrokerError:
            missing = [identity.slot_id for identity in identities]
        if missing:
            raise WorkspaceBundleBindingsIncomplete(missing)

    async def _download_assets(
        self, proposal: WorkspaceBundleInstallProposalRecord
    ) -> tuple[dict[str, bytes], set[str]]:
        total = sum(int(item["size_bytes"]) for item in proposal.assets)
        if total > self.MAX_TOTAL_ASSET_BYTES:
            raise WorkspaceBundleInstallError(
                "Bundle assets exceed the Desktop installation limit"
            )
        downloaded: dict[str, bytes] = {}
        executable_assets: set[str] = set()
        for item in proposal.assets:
            content = await self.cloud.download_asset(
                proposal.bundle_id,
                proposal.revision_id,
                item["id"],
            )
            if len(content) != int(item["size_bytes"]):
                raise WorkspaceBundleInstallError("Bundle asset size mismatch")
            if hashlib.sha256(content).hexdigest() != item["content_digest"]:
                raise WorkspaceBundleInstallError(
                    "Bundle asset digest mismatch"
                )
            try:
                assert_bundle_asset_safe(item["logical_path"], content)
            except SecretValueInManifestError as exc:
                raise WorkspaceBundleInstallError(
                    f"Bundle asset failed the local safety scan: "
                    f"{item['logical_path']}"
                ) from exc
            downloaded[item["logical_path"]] = content
            if item["executable"]:
                executable_assets.add(item["logical_path"])
        return downloaded, executable_assets

    @staticmethod
    def _space_projection(
        proposal: WorkspaceBundleInstallProposalRecord,
        bindings: tuple[WorkspaceBundleLocalBindingRecord, ...],
    ) -> dict[str, Any]:
        local_paths = [
            {
                "slot_id": item.slot_id,
                "root_fingerprint_digest": canonical_digest(
                    {"slot_id": item.slot_id, "local_path": item.local_path}
                ),
            }
            for item in bindings
            if item.binding_kind == "local_path"
        ]
        connectors = [
            {
                "slot_id": item.slot_id,
                "connector_id": item.connector_id,
                "required_grants": list(item.required_grants),
            }
            for item in bindings
            if item.binding_kind == "connector"
        ]
        redacted = {
            "bundle_revision_id": proposal.revision_id,
            "manifest_digest": proposal.manifest_digest,
            "context_sources": local_paths,
            "connector_bindings": connectors,
            "permission_profile": proposal.install_plan["permission_profile"],
            "git_policy": proposal.install_plan["git_policy"],
        }
        return {
            "redacted_spec": redacted,
            "projection_digest": canonical_digest(redacted),
        }
