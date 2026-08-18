"""Fail-closed, in-memory runtime assembly for materialized Bundles."""

from __future__ import annotations

import copy
import hashlib
import json
import os
from collections.abc import Callable, Iterable
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from app.run_journal import (
    SQLiteRunJournal,
    WorkspaceBundleInstallProposalRecord,
    WorkspaceBundleLocalBindingRecord,
    WorkspaceBundleSecretBindingRecord,
)
from app.workspace_bundle.mcp_destination import (
    McpDestinationError,
    attestation_from_grants,
    inspect_bundle_mcp_destination,
    secret_binding_attestation,
    secret_binding_attestation_from_grants,
)
from app.workspace_bundle.secrets import (
    WorkspaceSecretBroker,
    WorkspaceSecretBrokerError,
    WorkspaceSecretIdentity,
)
from app.workspace_config.models import (
    EffectiveEnvironmentSpec,
    WorkspaceBundleManifest,
    WorkspaceLock,
    canonical_digest,
)


class EnvironmentSetupRequiredError(RuntimeError):
    """The pinned Bundle cannot safely dispatch tools on this device."""

    code = "environment_setup_required"

    def __init__(self, issues: Iterable[str]) -> None:
        normalized = tuple(sorted(set(str(item) for item in issues if item)))
        self.issues = normalized or ("workspace_bundle_setup_incomplete",)
        super().__init__(
            "Workspace Bundle setup is required before this Run can start: "
            + ", ".join(self.issues)
        )


@dataclass(frozen=True, repr=False)
class ResolvedRuntimeContext:
    id: str
    kind: str
    content: str | None = field(default=None, repr=False)
    path: str | None = None
    query: dict[str, Any] | None = field(default=None, repr=False)


@dataclass(frozen=True, repr=False)
class ResolvedRuntimeSkill:
    ref: str
    path: str
    content: str = field(repr=False)
    assign_to: tuple[str, ...] = ()


@dataclass(frozen=True, repr=False)
class ResolvedRuntimeConnector:
    id: str
    connector_id: str
    slot_id: str
    opaque_connection_id: str = field(repr=False)
    required_grants: tuple[str, ...] = ()


@dataclass(frozen=True, repr=False)
class ResolvedRuntimeEnvironment:
    """A non-serializable snapshot consumed by one live Attempt.

    Secret-bearing MCP configuration intentionally has no repr. This object
    must never be placed in RunJournal payloads or events.
    """

    environment_spec_id: str
    bundle_revision_id: str
    proposal_id: str
    configuration_root: str
    instructions: tuple[tuple[str, str], ...] = field(repr=False)
    context: tuple[ResolvedRuntimeContext, ...] = field(repr=False)
    skills: tuple[ResolvedRuntimeSkill, ...] = field(repr=False)
    connectors: tuple[ResolvedRuntimeConnector, ...] = field(repr=False)
    agent_aliases: tuple[str, ...]
    permission_profile: str
    permission_rules: tuple[tuple[str, str], ...]
    _mcp_servers: dict[str, dict[str, Any]] = field(repr=False)
    _secret_identities: tuple[WorkspaceSecretIdentity, ...] = field(repr=False)
    _environment_bindings: tuple[tuple[str, str], ...] = field(repr=False)
    _secret_broker_factory: Callable[[], WorkspaceSecretBroker] = field(
        repr=False,
        compare=False,
    )

    @contextmanager
    def process_environment(self):
        """Resolve only workspace environment bindings for one spawn."""

        requirements = {
            requirement for _, requirement in self._environment_bindings
        }
        identities = tuple(
            item
            for item in self._secret_identities
            if item.slot_id in requirements
        )
        values = _resolve_bound_secret_values(
            self._secret_broker_factory,
            identities,
        )
        environment = {
            name: values[requirement]
            for name, requirement in self._environment_bindings
        }
        try:
            yield environment
        finally:
            environment.clear()
            values.clear()

    def pinned_skill_sources(
        self,
        agent_name: str | None = None,
    ) -> dict[str, str]:
        aliases = {
            str(agent_name or "").strip(),
            "single_agent",
            *self.agent_aliases,
        }
        return {
            item.path: item.content
            for item in self.skills
            if not item.assign_to or bool(set(item.assign_to) & aliases)
        }

    def connector_bindings(self) -> tuple[ResolvedRuntimeConnector, ...]:
        """Return verified opaque bindings for the connector adapter."""

        return self.connectors

    def has_process_environment(self) -> bool:
        return bool(self._environment_bindings)

    def mcp_config_without_secrets(self) -> dict[str, Any] | None:
        if any(
            identity.slot_id.startswith("mcp_secret:")
            for identity in self._secret_identities
        ):
            raise EnvironmentSetupRequiredError(
                ["mcp_destination_confirmation_required"]
            )
        if not self._mcp_servers:
            return None
        return {"mcpServers": copy.deepcopy(self._mcp_servers)}

    def prompt_context(self) -> str:
        blocks: list[str] = []
        if self.instructions:
            blocks.append("=== Workspace Bundle Instructions ===")
            blocks.extend(
                f"[{role}]\n{content}" for role, content in self.instructions
            )
            blocks.append("=== End Workspace Bundle Instructions ===")
        if self.context:
            blocks.append("=== Workspace Bundle Context ===")
            for item in self.context:
                if item.content is not None:
                    blocks.append(f"[{item.id} | {item.kind}]\n{item.content}")
                elif item.path is not None:
                    blocks.append(f"[{item.id} | {item.kind}] {item.path}")
                elif item.query is not None:
                    blocks.append(
                        f"[{item.id} | {item.kind}] "
                        + json.dumps(
                            item.query,
                            ensure_ascii=False,
                            separators=(",", ":"),
                            sort_keys=True,
                        )
                    )
            blocks.append("=== End Workspace Bundle Context ===")
        if self.connectors:
            blocks.append("=== Workspace Bundle Connections ===")
            blocks.extend(
                f"[{item.id}] {item.connector_id} "
                f"(grants: {', '.join(item.required_grants) or 'none'})"
                for item in self.connectors
            )
            blocks.append("=== End Workspace Bundle Connections ===")
        return "\n\n".join(blocks)


def _resolve_bound_secret_values(
    broker_factory: Callable[[], WorkspaceSecretBroker],
    identities: tuple[WorkspaceSecretIdentity, ...],
) -> dict[str, str]:
    if not identities:
        return {}
    try:
        broker = broker_factory()
        resolutions = []
        maximum = max(1, int(getattr(broker, "MAX_BATCH_BINDINGS", 100)))
        for index in range(0, len(identities), maximum):
            resolutions.extend(
                broker.resolve_many(identities[index : index + maximum])
            )
    except WorkspaceSecretBrokerError as exc:
        raise EnvironmentSetupRequiredError(
            ["workspace_secrets_unavailable"]
        ) from exc
    if len(resolutions) != len(identities):
        raise EnvironmentSetupRequiredError(["workspace_secrets_unavailable"])
    values: dict[str, str] = {}
    for expected, resolution in zip(identities, resolutions, strict=True):
        encoded = resolution.value.encode("utf-8")
        if resolution.identity != expected or len(encoded) > 64 * 1024:
            raise EnvironmentSetupRequiredError(
                ["workspace_secret_value_invalid"]
            )
        values[expected.slot_id] = resolution.value
    return values


def _verify_bound_secret_identities(
    broker_factory: Callable[[], WorkspaceSecretBroker],
    identities: tuple[WorkspaceSecretIdentity, ...],
) -> None:
    if not identities:
        return
    try:
        broker = broker_factory()
        verifications = []
        maximum = max(1, int(getattr(broker, "MAX_BATCH_BINDINGS", 100)))
        for index in range(0, len(identities), maximum):
            verifications.extend(
                broker.verify_many(identities[index : index + maximum])
            )
    except WorkspaceSecretBrokerError as exc:
        raise EnvironmentSetupRequiredError(
            ["workspace_secrets_unavailable"]
        ) from exc
    if len(verifications) != len(identities) or any(
        verification.identity != expected or verification.state != "available"
        for expected, verification in zip(
            identities,
            verifications,
            strict=True,
        )
    ):
        raise EnvironmentSetupRequiredError(["workspace_secrets_unavailable"])


def bundle_runtime_binding_digest(
    proposal: WorkspaceBundleInstallProposalRecord,
    local_bindings: Iterable[WorkspaceBundleLocalBindingRecord],
    secret_bindings: Iterable[WorkspaceBundleSecretBindingRecord],
) -> str:
    """Pin opaque local authorities without including any secret value."""

    return canonical_digest(
        {
            "proposal_id": proposal.proposal_id,
            "proposal_version": proposal.version,
            "revision_id": proposal.revision_id,
            "local_bindings": [
                {
                    "slot_id": item.slot_id,
                    "binding_kind": item.binding_kind,
                    "connector_id": item.connector_id,
                    "opaque_connection_id": item.opaque_connection_id,
                    "local_path": item.local_path,
                    "required_grants": list(item.required_grants),
                }
                for item in sorted(
                    local_bindings,
                    key=lambda value: value.slot_id,
                )
            ],
            "secret_bindings": [
                {
                    "requirement_key": item.requirement_key,
                    "requirement_kind": item.requirement_kind,
                    "binding_version": item.binding_version,
                    "secret_ref": item.secret_ref,
                    "account_scope_digest": item.account_scope_digest,
                }
                for item in sorted(
                    secret_bindings,
                    key=lambda value: value.requirement_key,
                )
            ],
        }
    )


class RuntimeEnvironmentAssembler:
    """Resolve one pinned EnvironmentSpec without consulting legacy config."""

    MAX_TEXT_ASSET_BYTES = 1024 * 1024
    MAX_PROMPT_BYTES = 2 * 1024 * 1024

    def __init__(
        self,
        journal: SQLiteRunJournal,
        *,
        state_root: Path,
        secret_broker_factory: Callable[[], WorkspaceSecretBroker]
        | None = None,
    ) -> None:
        self.journal = journal
        self.state_root = state_root.expanduser().resolve()
        self.secret_broker_factory = (
            secret_broker_factory or WorkspaceSecretBroker.from_environment
        )

    def assemble(
        self,
        spec: EffectiveEnvironmentSpec,
        *,
        space_id: str,
        space_root: Path,
    ) -> ResolvedRuntimeEnvironment | None:
        marker = spec.semantic_spec.get("runtime_capability_manifest", {}).get(
            "workspace_bundle"
        )
        if not isinstance(marker, dict):
            return None

        issues: list[str] = []
        materialization = (
            self.journal.get_latest_workspace_config_materialization(space_id)
        )
        if (
            materialization is None
            or materialization.state != "materialized"
            or materialization.revision_id != spec.bundle_revision_id
        ):
            raise EnvironmentSetupRequiredError(
                ["materialized_bundle_revision_changed"]
            )
        revision = self.journal.get_workspace_config_revision(
            spec.bundle_revision_id
        )
        if revision is None:
            raise EnvironmentSetupRequiredError(["bundle_revision_missing"])
        try:
            manifest = WorkspaceBundleManifest.model_validate(
                spec.semantic_spec.get("bundle")
            )
        except Exception as exc:
            raise EnvironmentSetupRequiredError(
                ["pinned_bundle_manifest_invalid"]
            ) from exc
        if (
            manifest.revision_id != spec.bundle_revision_id
            or manifest.digest != spec.manifest_digest
            or revision.manifest_digest != spec.manifest_digest
            or revision.manifest != manifest.canonical_payload()
        ):
            raise EnvironmentSetupRequiredError(
                ["pinned_bundle_manifest_changed"]
            )

        proposal_id = spec.local_materialization.bundle_proposal_id
        if not proposal_id:
            raise EnvironmentSetupRequiredError(
                ["bundle_proposal_pin_missing"]
            )
        proposal = self.journal.get_workspace_bundle_install_proposal(
            proposal_id
        )
        if (
            proposal is None
            or proposal.space_id != space_id
            or proposal.revision_id != spec.bundle_revision_id
            or proposal.state != "materialized"
            or proposal.version
            != spec.local_materialization.bundle_proposal_version
        ):
            raise EnvironmentSetupRequiredError(["bundle_proposal_changed"])
        local_bindings = self.journal.list_workspace_bundle_local_bindings(
            proposal.proposal_id
        )
        secret_bindings = self.journal.list_workspace_bundle_secret_bindings(
            proposal.proposal_id
        )
        if (
            bundle_runtime_binding_digest(
                proposal, local_bindings, secret_bindings
            )
            != spec.local_materialization.bundle_binding_digest
        ):
            raise EnvironmentSetupRequiredError(["bundle_bindings_changed"])

        expected_root = self._configuration_root(
            space_id=space_id,
            space_root=space_root,
            placement=materialization.config_placement,
        )
        pinned_root = spec.local_materialization.configuration_root
        if not pinned_root:
            raise EnvironmentSetupRequiredError(
                ["configuration_root_pin_missing"]
            )
        try:
            configuration_root = (
                Path(pinned_root).expanduser().resolve(strict=True)
            )
        except OSError as exc:
            raise EnvironmentSetupRequiredError(
                ["configuration_root_unavailable"]
            ) from exc
        if configuration_root != expected_root:
            raise EnvironmentSetupRequiredError(["configuration_root_changed"])

        lock = self._load_configuration_contract(configuration_root, manifest)
        asset_digests = {
            item.ref: item.digest
            for item in (*lock.assets, *lock.skills, *lock.mcp_packages)
        }
        executable_assets = {
            item.ref: {
                "content_digest": item.digest,
                "executable": item.executable,
            }
            for item in (*lock.assets, *lock.skills, *lock.mcp_packages)
        }
        file_cache: dict[str, tuple[Path, bytes]] = {}

        def asset(ref: str) -> tuple[Path, bytes]:
            cached = file_cache.get(ref)
            if cached is not None:
                return cached
            resolved = self._read_bundle_asset(
                configuration_root,
                ref,
                asset_digests,
            )
            file_cache[ref] = resolved
            return resolved

        local_by_slot = {item.slot_id: item for item in local_bindings}
        self._validate_declared_bindings(
            manifest,
            proposal,
            local_by_slot,
            secret_bindings,
            spec,
            issues,
        )
        if issues:
            raise EnvironmentSetupRequiredError(issues)

        declared_agents = tuple(item.id for item in manifest.spec.agents)
        if len(declared_agents) > 1:
            raise EnvironmentSetupRequiredError(
                ["multi_agent_runtime_adapter_unavailable"]
            )

        if manifest.spec.connectors:
            # Binding verification alone does not create an executable Cloud
            # connector adapter in Brain. Reporting this installation Ready
            # would mislead the model and user, so remain fail-closed until the
            # gateway consumer is wired in a dedicated phase.
            raise EnvironmentSetupRequiredError(
                [
                    f"connector_runtime_adapter_unavailable:{item.id}"
                    for item in manifest.spec.connectors
                ]
            )

        secret_mcp_servers = tuple(
            server
            for server in manifest.spec.mcp_servers
            if server.secret_slots
        )
        if secret_mcp_servers:
            self._validate_secret_mcp_attestations(
                proposal=proposal,
                servers=secret_mcp_servers,
                local_by_slot=local_by_slot,
                secret_bindings=secret_bindings,
                asset=asset,
                executable_assets=executable_assets,
            )
            # The authorization contract is now complete and stale-safe, but
            # plaintext injection still requires an Eigent-owned stdio adapter
            # that does not retain values in MCPClient configuration. Until
            # that adapter lands, remain explicitly fail-closed before any
            # secret broker call.
            raise EnvironmentSetupRequiredError(
                [
                    f"mcp_secret_stdio_runtime_adapter_unavailable:{server.id}"
                    for server in secret_mcp_servers
                ]
            )

        declared_secret_keys = {
            f"mcp_secret:{server.id}:{slot}"
            for server in manifest.spec.mcp_servers
            for slot in server.secret_slots
        }
        declared_secret_keys.update(
            f"environment:{item.name}"
            for item in (
                manifest.spec.environment.variables
                if manifest.spec.environment
                else ()
            )
        )
        runtime_secret_bindings = tuple(
            item
            for item in secret_bindings
            if item.requirement_key in declared_secret_keys
        )
        secret_identities = self._secret_identities(
            proposal,
            runtime_secret_bindings,
        )
        # Admission verifies only identity-bound availability. Plaintext is
        # resolved later at the exact process/client boundary.
        _verify_bound_secret_identities(
            self.secret_broker_factory,
            secret_identities,
        )
        instructions: list[tuple[str, str]] = []
        prompt_bytes = 0
        for role, ref in sorted(manifest.spec.instructions.items()):
            _, content = asset(ref)
            text = self._decode_text(ref, content)
            prompt_bytes += len(content)
            instructions.append((role, text))

        contexts: list[ResolvedRuntimeContext] = []
        pinned_sources = {
            item.id: item
            for item in spec.local_materialization.context_sources
        }
        for source in manifest.spec.context:
            if source.kind == "bundle_asset":
                assert source.path is not None
                _, content = asset(source.path)
                text = self._decode_text(source.path, content)
                prompt_bytes += len(content)
                contexts.append(
                    ResolvedRuntimeContext(
                        id=source.id,
                        kind=source.kind,
                        content=text,
                    )
                )
            elif source.kind == "inline":
                content = source.content or ""
                prompt_bytes += len(content.encode("utf-8"))
                contexts.append(
                    ResolvedRuntimeContext(
                        id=source.id,
                        kind=source.kind,
                        content=content,
                    )
                )
            elif source.kind == "local_path_slot":
                pinned = pinned_sources.get(source.id)
                binding = local_by_slot.get(source.slot or "")
                if (
                    pinned is None
                    or binding is None
                    or not pinned.absolute_path
                    or binding.local_path != pinned.absolute_path
                ):
                    raise EnvironmentSetupRequiredError(
                        [f"path_binding_changed:{source.slot}"]
                    )
                contexts.append(
                    ResolvedRuntimeContext(
                        id=source.id,
                        kind=source.kind,
                        path=pinned.absolute_path,
                    )
                )
            else:
                contexts.append(
                    ResolvedRuntimeContext(
                        id=source.id,
                        kind=source.kind,
                        path=source.path,
                        query=copy.deepcopy(source.query),
                    )
                )
        if prompt_bytes > self.MAX_PROMPT_BYTES:
            raise EnvironmentSetupRequiredError(["bundle_prompt_too_large"])

        skills: list[ResolvedRuntimeSkill] = []
        for skill in manifest.spec.skills:
            if not skill.ref.startswith("bundle://"):
                raise EnvironmentSetupRequiredError(
                    [f"registry_skill_unmaterialized:{skill.ref}"]
                )
            path, content = asset(skill.ref)
            text = self._decode_text(skill.ref, content)
            if path.name != "SKILL.md":
                raise EnvironmentSetupRequiredError(
                    [f"bundle_skill_not_portable:{skill.ref}"]
                )
            skills.append(
                ResolvedRuntimeSkill(
                    ref=skill.ref,
                    path=str(path),
                    content=text,
                    assign_to=skill.assign_to,
                )
            )

        mcp_servers: dict[str, dict[str, Any]] = {}
        for server in manifest.spec.mcp_servers:
            if not server.definition.startswith("bundle://"):
                raise EnvironmentSetupRequiredError(
                    [f"registry_mcp_unmaterialized:{server.id}"]
                )
            definition_path, content = asset(server.definition)
            mcp_servers[server.id] = self._resolve_mcp_server(
                server_id=server.id,
                definition_path=definition_path,
                content=content,
                secret_slots=server.secret_slots,
            )

        connectors = tuple(
            ResolvedRuntimeConnector(
                id=item.id,
                connector_id=item.connector,
                slot_id=item.connection_slot,
                opaque_connection_id=(
                    local_by_slot[item.connection_slot].opaque_connection_id
                    or ""
                ),
                required_grants=item.required_grants,
            )
            for item in manifest.spec.connectors
        )
        return ResolvedRuntimeEnvironment(
            environment_spec_id=spec.spec_id,
            bundle_revision_id=spec.bundle_revision_id,
            proposal_id=proposal.proposal_id,
            configuration_root=str(configuration_root),
            instructions=tuple(instructions),
            context=tuple(contexts),
            skills=tuple(skills),
            connectors=connectors,
            # A one-Agent Bundle may use any portable logical id (for example
            # ``coordinator`` or ``lead``). The current Desktop runtime maps
            # that sole logical Agent onto its concrete ``single_agent``
            # implementation; only actual multi-Agent graphs are unsupported.
            agent_aliases=declared_agents,
            permission_profile=manifest.spec.permissions.profile,
            permission_rules=tuple(
                (item.action, item.effect)
                for item in manifest.spec.permissions.rules
            ),
            _mcp_servers=mcp_servers,
            _secret_identities=secret_identities,
            _environment_bindings=tuple(
                (
                    item.name,
                    f"environment:{item.name}",
                )
                for item in (
                    manifest.spec.environment.variables
                    if manifest.spec.environment
                    else ()
                )
                if f"environment:{item.name}" in declared_secret_keys
                and any(
                    binding.requirement_key == f"environment:{item.name}"
                    for binding in runtime_secret_bindings
                )
            ),
            _secret_broker_factory=self.secret_broker_factory,
        )

    def _configuration_root(
        self,
        *,
        space_id: str,
        space_root: Path,
        placement: str,
    ) -> Path:
        root = space_root.expanduser().resolve()
        if placement == "in_repo":
            candidate = root / ".eigent"
        elif placement == "sidecar":
            if not space_id or any(
                character
                not in (
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
                    "0123456789._-"
                )
                for character in space_id
            ):
                raise EnvironmentSetupRequiredError(["space_identity_invalid"])
            candidate = self.state_root / "spaces" / space_id / "configuration"
        else:
            raise EnvironmentSetupRequiredError(["config_placement_invalid"])
        try:
            return candidate.resolve(strict=True)
        except OSError as exc:
            raise EnvironmentSetupRequiredError(
                ["configuration_root_unavailable"]
            ) from exc

    def _load_configuration_contract(
        self,
        root: Path,
        manifest: WorkspaceBundleManifest,
    ) -> WorkspaceLock:
        try:
            manifest_value = yaml.safe_load(
                self._read_limited(root / "workspace.yaml").decode("utf-8")
            )
            materialized_manifest = WorkspaceBundleManifest.model_validate(
                manifest_value
            )
            lock_value = yaml.safe_load(
                self._read_limited(root / "workspace.lock").decode("utf-8")
            )
            lock = WorkspaceLock.model_validate(lock_value)
        except Exception as exc:
            raise EnvironmentSetupRequiredError(
                ["configuration_contract_invalid"]
            ) from exc
        if (
            materialized_manifest.digest != manifest.digest
            or materialized_manifest.revision_id != manifest.revision_id
            or lock.bundle_revision != manifest.revision_id
            or lock.manifest_digest != manifest.digest
        ):
            raise EnvironmentSetupRequiredError(
                ["configuration_contract_changed"]
            )
        return lock

    def _read_bundle_asset(
        self,
        root: Path,
        ref: str,
        asset_digests: dict[str, str],
    ) -> tuple[Path, bytes]:
        if not ref.startswith("bundle://") or ref not in asset_digests:
            raise EnvironmentSetupRequiredError(
                [f"bundle_asset_missing:{ref}"]
            )
        relative = PurePosixPath(ref.removeprefix("bundle://"))
        if (
            relative.is_absolute()
            or not relative.parts
            or any(part in {"", ".", ".."} for part in relative.parts)
        ):
            raise EnvironmentSetupRequiredError(["bundle_asset_path_invalid"])
        try:
            target = (root / Path(*relative.parts)).resolve(strict=True)
            target.relative_to(root)
        except (OSError, ValueError) as exc:
            raise EnvironmentSetupRequiredError(
                [f"bundle_asset_unavailable:{ref}"]
            ) from exc
        if not target.is_file():
            raise EnvironmentSetupRequiredError(
                [f"bundle_asset_unavailable:{ref}"]
            )
        content = self._read_limited(target)
        if hashlib.sha256(content).hexdigest() != asset_digests[ref]:
            raise EnvironmentSetupRequiredError(
                [f"bundle_asset_digest_changed:{ref}"]
            )
        return target, content

    def _read_limited(self, path: Path) -> bytes:
        with path.open("rb") as handle:
            content = handle.read(self.MAX_TEXT_ASSET_BYTES + 1)
        if len(content) > self.MAX_TEXT_ASSET_BYTES:
            raise EnvironmentSetupRequiredError(
                ["bundle_text_asset_too_large"]
            )
        return content

    @staticmethod
    def _decode_text(ref: str, content: bytes) -> str:
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise EnvironmentSetupRequiredError(
                [f"bundle_text_asset_invalid:{ref}"]
            ) from exc

    def _validate_declared_bindings(
        self,
        manifest: WorkspaceBundleManifest,
        proposal: WorkspaceBundleInstallProposalRecord,
        local_by_slot: dict[str, WorkspaceBundleLocalBindingRecord],
        secret_bindings: tuple[WorkspaceBundleSecretBindingRecord, ...],
        spec: EffectiveEnvironmentSpec,
        issues: list[str],
    ) -> None:
        pinned_connectors = {
            item.slot_id: item
            for item in spec.local_materialization.connector_bindings
        }
        for connector in manifest.spec.connectors:
            binding = local_by_slot.get(connector.connection_slot)
            pinned = pinned_connectors.get(connector.connection_slot)
            if (
                binding is None
                or binding.binding_kind != "connector"
                or binding.connector_id != connector.connector
                or not binding.opaque_connection_id
                or tuple(sorted(binding.required_grants))
                != tuple(sorted(connector.required_grants))
                or pinned is None
                or pinned.connector_id != connector.connector
                or pinned.local_binding_id != binding.opaque_connection_id
                or tuple(sorted(pinned.required_grants))
                != tuple(sorted(connector.required_grants))
            ):
                issues.append(
                    f"connector_binding_missing:{connector.connection_slot}"
                )
        for source in manifest.spec.context:
            if source.kind != "local_path_slot" or not source.slot:
                continue
            binding = local_by_slot.get(source.slot)
            if (
                binding is None
                or binding.binding_kind != "local_path"
                or not binding.local_path
                or not Path(binding.local_path).expanduser().is_dir()
            ):
                issues.append(f"path_binding_missing:{source.slot}")
        script_actions = {
            *(
                f"skill.script.execute:{item.ref}"
                for item in manifest.spec.skills
            ),
            *(
                f"mcp.server.start:{item.id}"
                for item in manifest.spec.mcp_servers
            ),
        }
        for action in script_actions:
            binding = local_by_slot.get(action)
            if binding is None or binding.binding_kind != "script_approval":
                issues.append(f"script_approval_missing:{action}")
        secret_by_key = {
            item.requirement_key: item for item in secret_bindings
        }
        required_secrets = {
            f"mcp_secret:{server.id}:{slot}"
            for server in manifest.spec.mcp_servers
            for slot in server.secret_slots
        }
        required_secrets.update(
            f"environment:{item.name}"
            for item in (
                manifest.spec.environment.variables
                if manifest.spec.environment
                else ()
            )
            if item.required
        )
        for requirement in sorted(required_secrets):
            if requirement not in secret_by_key:
                issues.append(f"secret_binding_missing:{requirement}")
        if (
            proposal.manifest_digest != manifest.digest
            or proposal.manifest != manifest.canonical_payload()
        ):
            issues.append("proposal_manifest_changed")

    def _validate_secret_mcp_attestations(
        self,
        *,
        proposal: WorkspaceBundleInstallProposalRecord,
        servers,
        local_by_slot: dict[str, WorkspaceBundleLocalBindingRecord],
        secret_bindings: tuple[WorkspaceBundleSecretBindingRecord, ...],
        asset: Callable[[str], tuple[Path, bytes]],
        executable_assets: dict[str, dict[str, Any]],
    ) -> None:
        destinations = {
            str(item.get("mcp_id")): item
            for item in proposal.install_plan.get("mcp_destinations", [])
            if isinstance(item, dict) and item.get("mcp_id")
        }
        secret_records = [
            {
                "requirement_key": item.requirement_key,
                "secret_ref": item.secret_ref,
                "binding_version": item.binding_version,
                "account_scope_digest": item.account_scope_digest,
            }
            for item in secret_bindings
        ]
        for server in servers:
            issue = f"mcp_destination_confirmation_stale:{server.id}"
            destination = destinations.get(server.id)
            binding = local_by_slot.get(f"mcp.server.start:{server.id}")
            if (
                destination is None
                or binding is None
                or binding.binding_kind != "script_approval"
            ):
                raise EnvironmentSetupRequiredError([issue])
            availability_issue = destination.get("availability_issue")
            if availability_issue:
                raise EnvironmentSetupRequiredError(
                    [f"{availability_issue}:{server.id}"]
                )
            expected_destination_digest = destination.get("attestation_digest")
            if not isinstance(expected_destination_digest, str):
                raise EnvironmentSetupRequiredError([issue])
            if not server.definition.startswith("bundle://"):
                raise EnvironmentSetupRequiredError(
                    [f"registry_mcp_unmaterialized:{server.id}"]
                )
            try:
                _, definition_content = asset(server.definition)
                current = inspect_bundle_mcp_destination(
                    revision_id=proposal.revision_id,
                    mcp_id=server.id,
                    definition_ref=server.definition,
                    definition_digest=hashlib.sha256(
                        definition_content
                    ).hexdigest(),
                    content=definition_content,
                    secret_slots=server.secret_slots,
                    executable_assets_by_ref=executable_assets,
                )
                executable_ref = current.get("executable_asset_ref")
                if isinstance(executable_ref, str):
                    # ``asset`` repeats the locked digest check against the
                    # actual materialized executable before authorization is
                    # considered current.
                    asset(executable_ref)
            except (McpDestinationError, EnvironmentSetupRequiredError):
                raise EnvironmentSetupRequiredError([issue]) from None
            current_destination_digest = current.get("attestation_digest")
            current_secret_digest = secret_binding_attestation(
                mcp_id=server.id,
                bindings=secret_records,
            )
            if (
                current_destination_digest != expected_destination_digest
                or attestation_from_grants(binding.required_grants)
                != current_destination_digest
                or secret_binding_attestation_from_grants(
                    binding.required_grants
                )
                != current_secret_digest
            ):
                raise EnvironmentSetupRequiredError([issue])

    @staticmethod
    def _secret_identities(
        proposal: WorkspaceBundleInstallProposalRecord,
        bindings: tuple[WorkspaceBundleSecretBindingRecord, ...],
    ) -> tuple[WorkspaceSecretIdentity, ...]:
        return tuple(
            WorkspaceSecretIdentity(
                secret_ref=item.secret_ref,
                account_scope_digest=item.account_scope_digest,
                space_id=proposal.space_id,
                revision_id=proposal.revision_id,
                slot_id=item.requirement_key,
            )
            for item in bindings
        )

    def _resolve_secret_values(
        self,
        proposal: WorkspaceBundleInstallProposalRecord,
        bindings: tuple[WorkspaceBundleSecretBindingRecord, ...],
    ) -> dict[str, str]:
        return _resolve_bound_secret_values(
            self.secret_broker_factory,
            self._secret_identities(proposal, bindings),
        )

    def _resolve_mcp_server(
        self,
        *,
        server_id: str,
        definition_path: Path,
        content: bytes,
        secret_slots: tuple[str, ...],
    ) -> dict[str, Any]:
        try:
            definition = json.loads(content)
            server = copy.deepcopy(definition["mcpServers"][server_id])
        except Exception as exc:
            raise EnvironmentSetupRequiredError(
                [f"mcp_definition_invalid:{server_id}"]
            ) from exc
        if not isinstance(server, dict):
            raise EnvironmentSetupRequiredError(
                [f"mcp_definition_invalid:{server_id}"]
            )
        root = definition_path.parent.resolve()
        used_slots: set[str] = set()
        for category in ("env", "headers"):
            values = server.get(category, {})
            if not isinstance(values, dict):
                raise EnvironmentSetupRequiredError(
                    [f"mcp_definition_invalid:{server_id}"]
                )
            for name, value in list(values.items()):
                if not isinstance(name, str) or not isinstance(value, str):
                    raise EnvironmentSetupRequiredError(
                        [f"mcp_definition_invalid:{server_id}"]
                    )
                if not value.startswith("slot://"):
                    continue
                slot = value.removeprefix("slot://")
                if slot not in secret_slots:
                    raise EnvironmentSetupRequiredError(
                        [f"mcp_secret_unavailable:{server_id}:{slot}"]
                    )
                values[name] = f"slot://mcp_secret:{server_id}:{slot}"
                used_slots.add(slot)
        if used_slots != set(secret_slots):
            raise EnvironmentSetupRequiredError(
                [f"mcp_secret_mapping_changed:{server_id}"]
            )
        for key in ("command", "cwd"):
            value = server.get(key)
            if isinstance(value, str):
                server[key] = value.replace("${PLUGIN_ROOT}", str(root))
        args = server.get("args")
        if isinstance(args, list):
            server["args"] = [
                item.replace("${PLUGIN_ROOT}", str(root))
                if isinstance(item, str)
                else item
                for item in args
            ]
        command = server.get("command")
        if isinstance(command, str) and command.startswith("./"):
            executable = self._contained_runtime_path(root, command[2:])
            if not executable.is_file() or not os.access(executable, os.X_OK):
                raise EnvironmentSetupRequiredError(
                    [f"mcp_executable_unavailable:{server_id}"]
                )
            server["command"] = str(executable)
        cwd = server.get("cwd")
        if isinstance(cwd, str):
            candidate = Path(cwd)
            if not candidate.is_absolute():
                candidate = self._contained_runtime_path(root, cwd)
            try:
                candidate = candidate.resolve(strict=True)
                candidate.relative_to(root)
            except (OSError, ValueError) as exc:
                raise EnvironmentSetupRequiredError(
                    [f"mcp_cwd_unavailable:{server_id}"]
                ) from exc
            if not candidate.is_dir():
                raise EnvironmentSetupRequiredError(
                    [f"mcp_cwd_unavailable:{server_id}"]
                )
            server["cwd"] = str(candidate)
        return server

    @staticmethod
    def _contained_runtime_path(root: Path, relative: str) -> Path:
        logical = PurePosixPath(relative)
        if (
            logical.is_absolute()
            or not logical.parts
            or any(part in {"", ".", ".."} for part in logical.parts)
        ):
            raise EnvironmentSetupRequiredError(["runtime_path_invalid"])
        try:
            candidate = (root / Path(*logical.parts)).resolve(strict=True)
            candidate.relative_to(root)
        except (OSError, ValueError) as exc:
            raise EnvironmentSetupRequiredError(
                ["runtime_path_unavailable"]
            ) from exc
        return candidate
