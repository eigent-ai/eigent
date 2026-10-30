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

"""Trusted registration and exact restoration of the two restricted profiles."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import asdict, replace
from pathlib import Path

from app.permission_policy import PRESET_PROFILES, PermissionProfileName
from app.workspace_config.capabilities import ModelCapabilityRegistry
from app.workspace_config.models import (
    ProviderModelCapability,
    ThinkingEffort,
    WorkspaceBundleManifest,
    canonical_digest,
)

from .agent_adapter import SingleAgentExecutionAdapter
from .agent_configuration import (
    AgentConfigurationUnavailable,
    FrozenAgentConfiguration,
    ResolvedCredential,
)
from .authorization_check import run_authorization_check
from .configuration_source import ConfigurationSnapshot
from .content import ContentStore
from .git_provider import GitWorkspaceProvider
from .provider import DirectoryWorkspaceProvider
from .service import ExecutionForbidden, ExecutionOrigin
from .store import WorkspaceStateStore
from .workforce_adapter import WorkforceExecutionAdapter

logger = logging.getLogger(__name__)


def unavailable():
    raise AgentConfigurationUnavailable("configuration_revision_unavailable")


class RegistrationStore:
    def __init__(self, journal):
        self.journal = journal

    def all(self):
        with self.journal._lock:
            return [
                dict(row)
                for row in self.journal._connection.execute(
                    "SELECT * FROM managed_execution_configurations ORDER BY created_at,configuration_revision"
                )
            ]

    def put(self, configuration, document, *, claim_session=False):
        encoded = json.dumps(document, sort_keys=True, allow_nan=False)
        snapshot = configuration.snapshot
        with self.journal._write_transaction() as connection:
            if claim_session:
                from .routing import claim_managed_in_transaction

                claim_managed_in_transaction(connection, configuration)
            owners = connection.execute(
                "SELECT DISTINCT principal_ref FROM managed_execution_configurations WHERE project_id=?",
                (snapshot["project_id"],),
            ).fetchall()
            if any(row[0] != snapshot["principal_ref"] for row in owners):
                raise ExecutionForbidden(
                    "Project configuration belongs to another principal"
                )
            existing = connection.execute(
                "SELECT document_json FROM managed_execution_configurations WHERE configuration_revision=?",
                (configuration.configuration_revision,),
            ).fetchone()
            if existing is not None:
                if existing[0] != encoded:
                    unavailable()
                return
            connection.execute(
                "INSERT INTO managed_execution_configurations VALUES (?,?,?,?,?)",
                (
                    configuration.configuration_revision,
                    snapshot["project_id"],
                    snapshot["principal_ref"],
                    encoded,
                    time.time(),
                ),
            )


def restore_capability(snapshot):
    return ProviderModelCapability(
        supported_efforts=tuple(
            ThinkingEffort(item) for item in snapshot["supported_efforts"]
        ),
        default_effort=ThinkingEffort(snapshot["default_effort"]),
        provider_mapping={
            ThinkingEffort(key): value
            for key, value in snapshot["provider_mapping"].items()
        },
        capability_revision=snapshot["revision"],
        dynamic_model=snapshot["dynamic_model"],
        provider_parameter_name=snapshot["provider_parameter_name"],
        transport=snapshot["api_mode"],
        source=snapshot["source"],
        diagnostic=snapshot["diagnostic"],
    )


class RegisteredConfiguration:
    def __init__(self, manager, document):
        self.manager = manager
        self.document = json.loads(
            json.dumps(document, sort_keys=True, allow_nan=False)
        )
        if set(document) != {"binding", "manifest", "configuration"}:
            unavailable()
        binding = self.document["binding"]
        if set(binding) - {"history_context"} != {
            "authority",
            "source",
            "workspace_binding",
            "source_root",
            "physical_identity",
            "workspace_provider",
            "repository_identity",
            "materialization_id",
            "proposal_id",
            "proposal_version",
            "permission_revision",
        }:
            unavailable()
        history = binding.get("history_context")
        if "history_context" in binding and (
            history != "journal-context-v1"
            or not manager.session_history_enabled
        ):
            # Never silently downgrade an already registered queue intent.
            unavailable()
        if binding["authority"] != manager.source.authority:
            unavailable()
        self.source_snapshot = ConfigurationSnapshot.model_validate(
            binding["source"]
        )
        self.origin = manager.source.origin(self.source_snapshot)
        self._proof = None
        self._refresh_lock = asyncio.Lock()
        snapshot = document["configuration"]
        manifest = WorkspaceBundleManifest.model_validate(document["manifest"])
        provider_snapshot = self.source_snapshot.provider
        self.configuration = FrozenAgentConfiguration(
            manifest=manifest,
            provider_capability=restore_capability(
                snapshot["provider_capability"]
            ),
            **{
                key: snapshot[key]
                for key in (
                    "space_id",
                    "project_id",
                    "principal_ref",
                    "permission_profile_revision",
                    "credential_ref",
                    "model_platform",
                    "model_type",
                    "api_url",
                    "thinking_effort",
                    "tokenizer_ref",
                    "model_config_dict",
                    "extra_params",
                    "session_mode",
                    "tool_authorizations",
                    "registration_binding",
                )
            }
            | {
                "model_config_dict": provider_snapshot.model_config_dict,
                "extra_params": provider_snapshot.extra_params,
                "thinking_effort": self.source_snapshot.thinking_effort
                or manifest.spec.models["default"].thinking_effort,
                "permission_profile_revision": binding["permission_revision"],
            },
            credential_resolver=self.credential,
        )
        if self.configuration.snapshot != snapshot or snapshot[
            "registration_binding"
        ] != "binding:" + canonical_digest(binding):
            unavailable()
        if (
            snapshot["principal_ref"] != self.origin.principal_ref
            or snapshot["credential_ref"]
            != self.source_snapshot.provider.provider_ref
        ):
            unavailable()
        for field in ("space_id", "project_id", "session_mode"):
            if snapshot[field] != getattr(self.source_snapshot, field):
                unavailable()
        provider_snapshot = self.source_snapshot.provider
        for field in ("model_platform", "model_type", "api_url"):
            if snapshot[field] != getattr(provider_snapshot, field):
                unavailable()
        tokenizer = manager.tokenizers.get(snapshot["model_type"])
        if (
            tokenizer is None
            or tokenizer.reference != snapshot["tokenizer_ref"]
        ):
            unavailable()
        adapter_type = (
            SingleAgentExecutionAdapter
            if snapshot["session_mode"] == "single-agent"
            else WorkforceExecutionAdapter
        )
        self.adapter = adapter_type(
            manager.journal,
            self.configuration,
            tokenizer,
            history_enabled=history is not None,
        )
        root = Path(binding["source_root"])
        # The provider is determined from the pinned root during registration.
        # Presence/type changes are checked by the physical/source validators.
        if binding["workspace_provider"] not in {"git", "directory"}:
            unavailable()
        provider_type = (
            GitWorkspaceProvider
            if binding["workspace_provider"] == "git"
            else DirectoryWorkspaceProvider
        )
        kwargs = (
            {"repository_root": root}
            if provider_type is GitWorkspaceProvider
            else {}
        )
        provider = provider_type(
            manager.content,
            manager.runtime_root / canonical_digest(snapshot["project_id"]),
            retention=manager.state,
            **kwargs,
        )
        if (
            getattr(provider, "repository_identity", None)
            != binding["repository_identity"]
        ):
            unavailable()
        self.provider = provider
        self.policy = replace(
            self.adapter.policy(
                source_root=root, provider=provider, authorize=self.authorize
            ),
            refresh_authorization=self.refresh,
            threaded_authorization=True,
            authorization_state=self.authorization_state,
            validate_authorization_state=self.validate_authorization_state,
            authorize_control=lambda origin: origin == self.origin
            and manager.source.authorize_control(origin),
        )

    def local_binding_valid(self):
        return self._local_binding_valid(check_repository=True)

    def _local_binding_valid(self, *, check_repository):
        binding = self.document["binding"]
        snapshot = self.source_snapshot
        current = self.manager.workspace_store.get_canonical_binding(
            snapshot.account_owner_id, snapshot.space_id
        )
        if current is None or asdict(current) != binding["workspace_binding"]:
            return False
        root, identity = self.manager.state.physical_identity(
            Path(current.workspace_root)
        )
        if (root, identity) != (
            binding["source_root"],
            binding["physical_identity"],
        ):
            return False
        if (
            "git" if (Path(root) / ".git").exists() else "directory"
        ) != binding["workspace_provider"]:
            return False
        if (
            check_repository
            and isinstance(self.provider, GitWorkspaceProvider)
            and self.provider._repository_identity()
            != binding["repository_identity"]
        ):
            return False
        if (
            self.manager.permission_revision(snapshot.space_id)
            != binding["permission_revision"]
        ):
            return False
        journal = self.manager.journal
        installed = journal.get_workspace_config_materialization(
            binding["materialization_id"]
        )
        if (
            installed is None
            or installed.space_id != snapshot.space_id
            or installed.state != "materialized"
            or installed.local_override_digest
        ):
            return False
        manifest = WorkspaceBundleManifest.model_validate(
            self.document["manifest"]
        )
        revision = journal.get_workspace_config_revision(installed.revision_id)
        if (
            revision is None
            or installed.revision_id != manifest.revision_id
            or revision.manifest != manifest.canonical_payload()
        ):
            return False
        proposal = journal.get_workspace_bundle_install_proposal(
            binding["proposal_id"]
        )
        if (
            proposal is None
            or proposal.assets
            or proposal.manifest != manifest.canonical_payload()
            or journal.list_workspace_bundle_local_bindings(
                proposal.proposal_id
            )
            or journal.list_workspace_bundle_secret_bindings(
                proposal.proposal_id
            )
        ):
            return False
        return proposal is not None and (
            proposal.space_id,
            proposal.revision_id,
            proposal.state,
            proposal.version,
        ) == (
            snapshot.space_id,
            manifest.revision_id,
            "materialized",
            binding["proposal_version"],
        )

    def _authorization_binding_state(self):
        # All mutable non-Git authority is checked again, including within the
        # admission transaction (the journal RLock is reentrant). Git's full
        # identity command stays in the complete worker check.
        with self.manager.journal._lock:
            proof = self._proof
            if (
                proof is None
                or self.manager.source.current() != proof[1]
                or not self._local_binding_valid(check_repository=False)
            ):
                unavailable()
            return proof, canonical_digest(self.document["binding"])

    def authorization_state(self):
        # Git dependency discovery stays off the loop and outside journal locks.
        repository = (
            self.provider.capture_authorization_state()
            if isinstance(self.provider, GitWorkspaceProvider)
            else None
        )
        return self._authorization_binding_state(), repository

    def validate_authorization_state(self, state):
        binding, repository = state
        return self._authorization_binding_state() == binding and (
            self.provider.authorization_state_current(repository)
            if isinstance(self.provider, GitWorkspaceProvider)
            else repository is None
        )

    def authorize(self, origin):
        try:
            return (
                origin == self.origin
                and self._proof is not None
                and self.manager.source.current() == self._proof[1]
                and self.local_binding_valid()
            )
        except Exception:
            return False

    def credential(self, reference, principal):
        if (
            reference != self.source_snapshot.provider.provider_ref
            or principal != self.origin.principal_ref
            or not self.authorize(self.origin)
        ):
            unavailable()
        return ResolvedCredential(
            reference, principal, self._proof[0].api_key.get_secret_value()
        )

    async def refresh(self):
        async with self._refresh_lock:
            try:
                result, context = await self.manager.source.resolve(
                    self.source_snapshot
                )
                for field in (
                    "account_owner_id",
                    "desktop_instance_id",
                    "device_credential_version",
                    "project_id",
                    "space_id",
                    "session_mode",
                    "space_root",
                    "provider",
                ):
                    if getattr(result, field) != getattr(
                        self.source_snapshot, field
                    ):
                        unavailable()
                if (
                    not result.api_key.get_secret_value().strip()
                    or not await run_authorization_check(
                        self.local_binding_valid
                    )
                    or (
                        self.source_snapshot.space_source_type is not None
                        and result.space_source_type
                        != self.source_snapshot.space_source_type
                    )
                ):
                    unavailable()
                self._proof = (result, context)
                return True
            except asyncio.CancelledError:
                self._proof = None
                raise
            except Exception:
                self._proof = None
                return False


class ExecutionRegistrationService:
    def __init__(
        self,
        journal,
        policies,
        source,
        workspace_store,
        tokenizers,
        runtime_root,
        *,
        capability_registry=None,
        session_history_enabled=False,
        local_single_session_enabled=False,
    ):
        if type(session_history_enabled) is not bool:
            unavailable()
        self.session_history_enabled = session_history_enabled
        if type(local_single_session_enabled) is not bool:
            unavailable()
        self.local_single_session_enabled = local_single_session_enabled
        self.journal = journal
        self.policies = policies
        self.source = source
        self.workspace_store = workspace_store
        self.tokenizers = dict(tokenizers)
        self.runtime_root = Path(runtime_root)
        self.state = WorkspaceStateStore(journal)
        self.content = ContentStore(self.runtime_root / "objects")
        self.store = RegistrationStore(journal)
        self.capability_registry = (
            capability_registry or ModelCapabilityRegistry()
        )
        self.registered = {}

    def permission_revision(self, space_id):
        record = self.journal.get_space_permission_profile(space_id)
        if record is None:
            return PRESET_PROFILES[
                PermissionProfileName.REQUEST_APPROVAL
            ].revision
        revision = f"space:{space_id}:{record.revision}"
        if (
            self.journal.get_space_permission_profile_revision(revision)
            is None
        ):
            unavailable()
        return revision

    def restore(self):
        for row in self.store.all():
            try:
                entry = RegisteredConfiguration(
                    self, json.loads(row["document_json"])
                )
                config = entry.configuration
                if (
                    config.configuration_revision,
                    config.snapshot["project_id"],
                    config.snapshot["principal_ref"],
                ) != (
                    row["configuration_revision"],
                    row["project_id"],
                    row["principal_ref"],
                ):
                    unavailable()
                self._install(entry)
            except Exception:
                # Retain unavailable rows and their queue intents. No Attempt
                # or guessed adapter/config is created while restoring them.
                logger.warning(
                    "Managed execution configuration unavailable during restore"
                )

    def _install(self, entry):
        revision = entry.configuration.configuration_revision
        if revision not in self.registered:
            self.policies.register_revision(
                entry.source_snapshot.project_id, entry.policy
            )
            self.registered[revision] = entry
        return self.registered[revision]

    def profiles(self):
        return sorted(
            {
                entry.configuration.snapshot["profile"]
                for entry in self.registered.values()
            }
        )

    async def _prepare_registration(
        self, project_id: str, origin: ExecutionOrigin, *, inspection=False
    ):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", project_id):
            unavailable()
        source, _ = await self.source.read(project_id)
        if (
            source.project_id != project_id
            or self.source.origin(source) != origin
        ):
            raise ExecutionForbidden("configuration account differs")
        workspace = self.workspace_store.get_canonical_binding(
            source.account_owner_id, source.space_id
        )
        if (
            workspace is None
            or not Path(workspace.workspace_root).is_absolute()
            or not Path(source.space_root).is_absolute()
        ):
            unavailable()
        root, identity = self.state.physical_identity(
            Path(workspace.workspace_root)
        )
        if self.state.physical_identity(Path(source.space_root)) != (
            root,
            identity,
        ):
            unavailable()
        installed = self.journal.get_latest_workspace_config_materialization(
            source.space_id
        )
        if installed is None or installed.local_override_digest:
            unavailable()
        revision = self.journal.get_workspace_config_revision(
            installed.revision_id
        )
        if revision is None:
            unavailable()
        manifest = WorkspaceBundleManifest.model_validate(revision.manifest)
        proposal = self.journal.get_materialized_workspace_bundle_proposal(
            space_id=source.space_id, revision_id=installed.revision_id
        )
        if proposal is None:
            unavailable()
        permission = self.permission_revision(source.space_id)
        repository_identity = None
        if not inspection and (Path(root) / ".git").exists():
            provider = GitWorkspaceProvider(
                self.content,
                self.runtime_root / canonical_digest(project_id),
                retention=self.state,
                repository_root=Path(root),
            )
            repository_identity = provider.repository_identity
        binding = {
            "authority": self.source.authority,
            "source": source.model_dump(mode="json"),
            "workspace_binding": asdict(workspace),
            "source_root": root,
            "physical_identity": identity,
            "workspace_provider": "git"
            if (Path(root) / ".git").exists()
            else "directory",
            "repository_identity": repository_identity,
            "materialization_id": installed.materialization_id,
            "proposal_id": proposal.proposal_id,
            "proposal_version": proposal.version,
            "permission_revision": permission,
        }
        if self.session_history_enabled:
            binding["history_context"] = "journal-context-v1"
        tokenizer = self.tokenizers.get(source.provider.model_type)
        if tokenizer is None:
            unavailable()
        provider = source.provider
        capability = self.capability_registry.resolve(
            model_platform=provider.model_platform,
            model_type=provider.model_type,
            api_mode=provider.extra_params.get("api_mode"),
            has_function_tools=True,
        )
        config = FrozenAgentConfiguration(
            manifest=manifest,
            provider_capability=capability,
            space_id=source.space_id,
            project_id=project_id,
            principal_ref=origin.principal_ref,
            permission_profile_revision=permission,
            credential_ref=provider.provider_ref,
            model_platform=provider.model_platform,
            model_type=provider.model_type,
            api_url=provider.api_url,
            thinking_effort=source.thinking_effort
            or manifest.spec.models["default"].thinking_effort,
            tokenizer_ref=tokenizer.reference,
            credential_resolver=lambda *_: unavailable(),
            model_config_dict=provider.model_config_dict,
            extra_params=provider.extra_params,
            session_mode=source.session_mode,
            registration_binding="binding:" + canonical_digest(binding),
        )
        document = {
            "binding": binding,
            "manifest": manifest.canonical_payload(),
            "configuration": config.snapshot,
        }
        return config, document

    def _require_single_session(self, config, document, origin):
        from .routing import SINGLE_PROFILE

        if not self.local_single_session_enabled:
            raise AgentConfigurationUnavailable("session_entry_disabled")
        if (
            origin.source != "local"
            or config.snapshot["profile"] != SINGLE_PROFILE
        ):
            raise AgentConfigurationUnavailable("single_agent_required")
        if document["binding"]["source"].get("space_source_type") not in {
            "blank",
            "folder",
        }:
            raise AgentConfigurationUnavailable("local_space_required")
        # This slice has no approval interaction bridge. A registered Space
        # must already permit its file workflow; never increase permissions.
        permission = self.journal.get_space_permission_profile(
            config.snapshot["space_id"]
        )
        if (
            permission is None
            or permission.profile_name
            != PermissionProfileName.FULL_ACCESS.value
            or document["manifest"]["spec"]["permissions"]["profile"]
            != "full_access"
        ):
            raise AgentConfigurationUnavailable(
                "permission_interaction_unsupported"
            )
        proposal = self.journal.get_workspace_bundle_install_proposal(
            document["binding"]["proposal_id"]
        )
        if (
            proposal is None
            or proposal.assets
            or self.journal.list_workspace_bundle_local_bindings(
                proposal.proposal_id
            )
            or self.journal.list_workspace_bundle_secret_bindings(
                proposal.proposal_id
            )
        ):
            raise AgentConfigurationUnavailable("agent_profile_unsupported")

    async def register(
        self, project_id: str, origin: ExecutionOrigin, *, claim_session=False
    ):
        if claim_session and not self.local_single_session_enabled:
            raise AgentConfigurationUnavailable("session_entry_disabled")
        config, document = await self._prepare_registration(project_id, origin)
        if claim_session:
            self._require_single_session(config, document, origin)
        entry = RegisteredConfiguration(self, document)
        if await entry.refresh() is not True:
            unavailable()
        self.store.put(config, document, claim_session=claim_session)
        entry = self._install(entry)
        return {
            "configuration_revision": config.configuration_revision,
            "envelope": entry.configuration.configuration,
            "project_id": project_id,
        }

    async def session_projection(self, project_id, origin):
        """Inspect trusted inputs without resolving credentials or registering.

        Inspection never constructs a workspace provider (which creates private
        directories), persists a configuration, or claims the Session. Only a
        later registration writer can settle an ownership race.
        """
        from .entry_guard import owns_managed_execution_in_connection
        from .routing import (
            SINGLE_PROFILE,
            queue_window,
            registration_reason,
            route_row,
        )

        # Even an ineligible/legacy Session must belong to this account.
        source, _ = await self.source.read(project_id)
        if (
            source.project_id != project_id
            or self.source.origin(source) != origin
        ):
            raise ExecutionForbidden("configuration account differs")
        with self.journal._lock:
            connection = self.journal._connection
            owned = owns_managed_execution_in_connection(
                connection, project_id=project_id
            )
            row = route_row(connection, project_id)
            window = queue_window(connection, project_id)
            reason = registration_reason(
                connection, project_id, origin.principal_ref
            )
            if (
                row is not None
                and row["route"] == "managed_single"
                and row["space_id"] != source.space_id
            ):
                raise ExecutionForbidden("Session Space differs")
        result = {
            **window,
            "project_id": project_id,
            "route": "managed" if owned else "legacy",
            "entry_enabled": self.local_single_session_enabled,
            "eligible": False,
            "reason": reason,
            "profile": SINGLE_PROFILE
            if row is not None and row["route"] == "managed_single"
            else None,
            "configuration": None,
            "selection": None,
        }
        if not self.local_single_session_enabled:
            result["reason"] = "session_entry_disabled"
            return result
        if reason:
            return result
        try:
            config, document = await self._prepare_registration(
                project_id, origin, inspection=True
            )
            self._require_single_session(config, document, origin)
        except AgentConfigurationUnavailable as exc:
            safe_reasons = {
                "single_agent_required",
                "local_space_required",
                "permission_interaction_unsupported",
                "agent_profile_unsupported",
                "model_effort_unsupported",
                "model_parameter_unsupported",
                "explicit_model_endpoint_required",
            }
            result["reason"] = (
                str(exc)
                if str(exc) in safe_reasons
                else "configuration_required"
            )
            return result
        result.update(eligible=True, reason=None, profile=SINGLE_PROFILE)
        result["selection"] = {
            "modelType": "custom",
            "provider_id": int(source.provider.provider_ref.split(":")[1]),
            "model_platform": source.provider.model_platform,
            "model_type": source.provider.model_type,
        }
        if document["binding"]["source"] != source.model_dump(mode="json"):
            raise AgentConfigurationUnavailable("configuration_changed")
        for entry in reversed(tuple(self.registered.values())):
            if entry.source_snapshot == source and entry.local_binding_valid():
                result["configuration"] = {
                    "configuration_revision": entry.configuration.configuration_revision,
                    "envelope": entry.configuration.configuration,
                    "project_id": project_id,
                }
                break
        return result

    async def authorize_project_control(self, project_id, origin):
        """Read owned durable intent even if its model/config is unavailable."""
        from .routing import route_row

        if not self.source.authorize_control(origin):
            raise ExecutionForbidden("account identity unavailable")
        with self.journal._lock:
            row = route_row(self.journal._connection, project_id)
            if row is not None and row["route"] == "managed_single":
                if row["principal_ref"] != origin.principal_ref:
                    raise ExecutionForbidden(
                        "Session belongs to another principal"
                    )
                return
            principals = self.journal._connection.execute(
                """SELECT DISTINCT principal_ref FROM managed_execution_configurations
                WHERE project_id=?""",
                (project_id,),
            ).fetchall()
            if principals:
                if any(row[0] != origin.principal_ref for row in principals):
                    raise ExecutionForbidden(
                        "Session belongs to another principal"
                    )
                return
        source, _ = await self.source.read(project_id)
        if (
            source.project_id != project_id
            or self.source.origin(source) != origin
        ):
            raise ExecutionForbidden("configuration account differs")
