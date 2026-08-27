"""Review-first local Workforce Bundle installation and materialization."""

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
)
from app.workspace_bundle.cloud import WorkspaceBundleCloudTransport
from app.workspace_config import (
    ConfigPlacement,
    SecretValueInManifestError,
    WorkforceBundleManifest,
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
    ) -> None:
        self.journal = journal
        self.configuration_repository = configuration_repository
        self.cloud = cloud

    async def propose(
        self,
        *,
        proposal_id: str,
        request_id: str,
        space_id: str,
        bundle_id: str,
        revision_id: str,
        config_placement: ConfigPlacement,
    ) -> WorkspaceBundleInstallProposalRecord:
        if self.cloud is None:
            raise WorkspaceBundleInstallError(
                "Bundle Cloud transport is unavailable"
            )
        revision = await self.cloud.get_revision(bundle_id, revision_id)
        if revision.get("status") != "published":
            raise WorkspaceBundleInstallError(
                "Only published Bundle revisions can be installed"
            )
        manifest_value = revision.get("manifest")
        if not isinstance(manifest_value, dict):
            raise WorkspaceBundleInstallError("Bundle manifest is missing")
        manifest = WorkforceBundleManifest.model_validate(manifest_value)
        if (
            manifest.metadata.id != bundle_id
            or manifest.revision_id != revision_id
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
        install_plan = self._install_plan(manifest, normalized_assets)
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
        return self.journal.put_workspace_bundle_local_binding(
            proposal_id=proposal_id,
            expected_proposal_version=expected_version,
            slot_id=action_id,
            binding_kind="script_approval",
            connector_id=None,
            opaque_connection_id=None,
            local_path=None,
            required_grants=[],
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
        self._require_complete_bindings(proposal, bindings)
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
            assets = await self._download_assets(proposal)
            manifest = WorkforceBundleManifest.model_validate(
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
                "Space already uses a different Workforce Bundle"
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
        return {
            "id": str(value["id"]),
            "logical_path": str(value["logical_path"]),
            "content_digest": digest,
            "media_type": str(value["media_type"]),
            "size_bytes": size,
            "provenance": str(value.get("provenance", "bundle_author")),
        }

    @staticmethod
    def _install_plan(
        manifest: WorkforceBundleManifest,
        assets: list[dict[str, Any]],
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
            "permission_profile": manifest.spec.permissions.profile,
            "git_policy": manifest.spec.git.model_dump(
                by_alias=True, mode="json"
            ),
            "asset_count": len(assets),
            "asset_bytes": sum(int(item["size_bytes"]) for item in assets),
            "automatic_grants": [],
        }

    @staticmethod
    def _require_complete_bindings(
        proposal: WorkspaceBundleInstallProposalRecord,
        bindings: tuple[WorkspaceBundleLocalBindingRecord, ...],
    ) -> None:
        present = {binding.slot_id for binding in bindings}
        required = {
            item["slot_id"]
            for item in proposal.install_plan["connector_slots"]
        }
        required.update(proposal.install_plan["local_path_slots"])
        required.update(proposal.install_plan["script_actions"])
        missing = sorted(required - present)
        if missing:
            raise WorkspaceBundleBindingsIncomplete(missing)

    async def _download_assets(
        self, proposal: WorkspaceBundleInstallProposalRecord
    ) -> dict[str, bytes]:
        total = sum(int(item["size_bytes"]) for item in proposal.assets)
        if total > self.MAX_TOTAL_ASSET_BYTES:
            raise WorkspaceBundleInstallError(
                "Bundle assets exceed the Desktop installation limit"
            )
        downloaded: dict[str, bytes] = {}
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
        return downloaded

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
