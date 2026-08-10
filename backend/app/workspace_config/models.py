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

"""Immutable Workforce Bundle and environment materialization contracts."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from enum import StrEnum
from pathlib import PurePosixPath
from types import MappingProxyType
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class WorkspaceConfigError(ValueError):
    """Base error for invalid workspace configuration."""


class SecretValueInManifestError(WorkspaceConfigError):
    """Raised when a secret-bearing field appears in a shareable manifest."""


class UnsupportedThinkingEffortError(WorkspaceConfigError):
    """Raised when a provider cannot honor a requested effort."""


class UnsafeCloudProjectionError(WorkspaceConfigError):
    """Raised when a Cloud projection contains device-local identity."""


class ThinkingEffort(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"
    MAX = "max"


class ConfigPlacement(StrEnum):
    IN_REPO = "in_repo"
    SIDECAR = "sidecar"


_EFFORT_ALIASES = {
    "light": ThinkingEffort.LOW,
    "extra_high": ThinkingEffort.XHIGH,
    "extra high": ThinkingEffort.XHIGH,
    "ultra": ThinkingEffort.MAX,
}
_EFFORT_ORDER = (
    ThinkingEffort.LOW,
    ThinkingEffort.MEDIUM,
    ThinkingEffort.HIGH,
    ThinkingEffort.XHIGH,
    ThinkingEffort.MAX,
)


def normalize_thinking_effort(value: str | ThinkingEffort) -> ThinkingEffort:
    if isinstance(value, ThinkingEffort):
        return value
    normalized = value.strip().lower()
    if normalized in _EFFORT_ALIASES:
        return _EFFORT_ALIASES[normalized]
    try:
        return ThinkingEffort(normalized)
    except ValueError as exc:
        raise WorkspaceConfigError(
            f"unsupported thinking effort {value!r}"
        ) from exc


def canonical_json(value: Any) -> str:
    """Return the only JSON encoding used for semantic digests."""

    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def canonical_digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


_SECRET_FIELD_NAMES = {
    "access_token",
    "api_key",
    "authorization",
    "client_secret",
    "cookie",
    "credential",
    "credentials",
    "password",
    "private_key",
    "refresh_token",
    "secret",
    "secret_value",
    "token",
}
_SLOT_REFERENCE_KEYS = {"slot", "slot_id", "connection_slot", "secret_slot"}
_CLOUD_FORBIDDEN_FIELD_NAMES = {
    "absolute_path",
    "device_credential",
    "device_identity",
    "local_binding_id",
    "local_connection_id",
    "worktree_root",
}
_WINDOWS_ABSOLUTE_PATH = re.compile(r"^[a-zA-Z]:[\\/]")
_DEVICE_HOME_PATH = re.compile(
    r"(?i)(?:~[/\\]|/Users/[^/\s]+/|/home/[^/\s]+/|"
    r"[A-Z]:\\+Users\\+[^\\\s]+\\+)"
)
_SECRET_VALUE_PATTERNS = (
    re.compile(r"\bsk-(?:live|test|ant)-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9]{32,}\b"),
    re.compile(r"\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{32,}\b"),
    re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b"),
    re.compile(
        r"-----BEGIN (?:ENCRYPTED |OPENSSH |RSA |DSA |EC )?PRIVATE KEY-----"
    ),
)
_FORBIDDEN_ASSET_FILENAMES = {
    ".env",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
}
_FORBIDDEN_ASSET_SUFFIXES = {".key", ".p12", ".pfx"}


def _normalized_field_name(value: str) -> str:
    value = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", value)
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    return value.replace("-", "_").lower()


def _is_slot_reference(value: Any) -> bool:
    if isinstance(value, str):
        return value.startswith(("slot://", "connection://", "binding://"))
    if not isinstance(value, dict) or not value:
        return False
    return set(map(_normalized_field_name, value)).issubset(
        _SLOT_REFERENCE_KEYS
    )


def _is_secret_field_name(value: str) -> bool:
    normalized = _normalized_field_name(value)
    return normalized in _SECRET_FIELD_NAMES or (
        normalized.endswith("s") and normalized[:-1] in _SECRET_FIELD_NAMES
    )


def _contains_secret_value(value: str) -> bool:
    return any(pattern.search(value) for pattern in _SECRET_VALUE_PATTERNS)


def _contains_device_home_path(value: str) -> bool:
    return bool(_DEVICE_HOME_PATH.search(value))


def assert_manifest_secret_free(value: Any, path: str = "$") -> None:
    """Reject secret values while allowing opaque slot references."""

    if isinstance(value, dict):
        for key, child in value.items():
            field_path = f"{path}.{key}"
            if _is_secret_field_name(str(key)) and not _is_slot_reference(
                child
            ):
                raise SecretValueInManifestError(
                    f"secret-bearing field is forbidden in Bundle manifest: "
                    f"{field_path}"
                )
            assert_manifest_secret_free(child, field_path)
        return
    if isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            assert_manifest_secret_free(child, f"{path}[{index}]")
        return
    if (
        isinstance(value, str)
        and not _is_slot_reference(value)
        and _contains_secret_value(value)
    ):
        raise SecretValueInManifestError(
            f"secret-like value is forbidden in Bundle manifest: {path}"
        )


def assert_bundle_asset_safe(logical_path: str, content: bytes) -> None:
    """Scan downloaded Bundle assets before local materialization."""

    path = PurePosixPath(logical_path.removeprefix("bundle://"))
    name = path.name.lower()
    if (
        name in _FORBIDDEN_ASSET_FILENAMES
        or name.startswith(".env.")
        or path.suffix.lower() in _FORBIDDEN_ASSET_SUFFIXES
    ):
        raise SecretValueInManifestError(
            "secret-bearing file type is forbidden in Bundle assets"
        )
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return
    if _contains_secret_value(text):
        raise SecretValueInManifestError(
            f"secret-like value is forbidden in Bundle asset {logical_path!r}"
        )


def assert_cloud_projection_safe(value: Any, path: str = "$") -> None:
    """Enforce the server-side projection schema's local-data denylist."""

    if isinstance(value, dict):
        for key, child in value.items():
            field_path = f"{path}.{key}"
            normalized = _normalized_field_name(str(key))
            if normalized in _CLOUD_FORBIDDEN_FIELD_NAMES:
                raise UnsafeCloudProjectionError(
                    f"device-local field is forbidden in Cloud projection: "
                    f"{field_path}"
                )
            if (
                isinstance(child, str)
                and (
                    normalized == "path"
                    or normalized.endswith("_path")
                    or normalized.endswith("_root")
                )
                and (
                    child.startswith(("/", "~/", "\\\\"))
                    or _WINDOWS_ABSOLUTE_PATH.match(child)
                )
            ):
                raise UnsafeCloudProjectionError(
                    f"absolute path is forbidden in Cloud projection: "
                    f"{field_path}"
                )
            assert_cloud_projection_safe(child, field_path)
        return
    if isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            assert_cloud_projection_safe(child, f"{path}[{index}]")
        return
    if isinstance(value, str) and _contains_device_home_path(value):
        raise UnsafeCloudProjectionError(
            f"device-local home path is forbidden in Cloud projection: {path}"
        )


class _StrictFrozenModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )


class BundleMetadata(_StrictFrozenModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    revision: int = Field(ge=1)


class ContextSource(_StrictFrozenModel):
    id: str = Field(min_length=1)
    kind: Literal[
        "bundle_asset",
        "inline",
        "connection_query",
        "local_path_slot",
        "artifact_ref",
        "memory_scope",
    ]
    slot: str | None = None
    path: str | None = None
    content: str | None = None
    query: dict[str, Any] | None = None
    sharing: Literal["bundled", "reference_only", "authorized_artifact"] = (
        "reference_only"
    )

    @model_validator(mode="after")
    def validate_source_shape(self) -> ContextSource:
        if self.kind == "local_path_slot" and not self.slot:
            raise ValueError("local_path_slot requires slot")
        if self.kind == "local_path_slot" and self.path is not None:
            raise ValueError("local_path_slot cannot contain a physical path")
        if self.kind == "bundle_asset":
            if not self.path or not self.path.startswith("bundle://"):
                raise ValueError(
                    "bundle_asset path must use a bundle:// logical URI"
                )
        if self.kind == "inline" and self.content is None:
            raise ValueError("inline context requires content")
        # System paths in prose (for example /etc/hosts) remain shareable,
        # but a concrete user's home path would disclose device identity.
        if (
            self.kind == "inline"
            and self.content is not None
            and _contains_device_home_path(self.content)
        ):
            raise ValueError("inline context cannot contain a device home path")
        if self.kind == "connection_query" and self.query is None:
            raise ValueError("connection_query requires query")
        return self


class SkillAssignment(_StrictFrozenModel):
    ref: str = Field(min_length=1)
    assign_to: tuple[str, ...] = Field(
        default_factory=tuple,
        alias="assignTo",
    )

    @field_validator("ref")
    @classmethod
    def validate_logical_ref(cls, value: str) -> str:
        if not value.startswith(("bundle://", "registry://")):
            raise ValueError("skill ref must use bundle:// or registry://")
        return value


class ConnectorRequirement(_StrictFrozenModel):
    id: str = Field(min_length=1)
    connector: str = Field(min_length=1)
    connection_slot: str = Field(min_length=1, alias="connectionSlot")
    required_grants: tuple[str, ...] = Field(
        default_factory=tuple,
        alias="requiredGrants",
    )


class McpServerRequirement(_StrictFrozenModel):
    id: str = Field(min_length=1)
    definition: str = Field(min_length=1)
    secret_slots: tuple[str, ...] = Field(
        default_factory=tuple,
        alias="secretSlots",
    )
    assign_to: tuple[str, ...] = Field(
        default_factory=tuple,
        alias="assignTo",
    )

    @field_validator("definition")
    @classmethod
    def validate_logical_definition(cls, value: str) -> str:
        if not value.startswith(("bundle://", "registry://")):
            raise ValueError(
                "MCP definition must use bundle:// or registry://"
            )
        return value


class AgentProfile(_StrictFrozenModel):
    id: str = Field(min_length=1)
    role: str = Field(min_length=1)
    model_profile: str = Field(min_length=1, alias="modelProfile")


class ModelProfile(_StrictFrozenModel):
    model_ref: str = Field(min_length=1, alias="modelRef")
    thinking_effort: ThinkingEffort = Field(
        default=ThinkingEffort.MEDIUM,
        alias="thinkingEffort",
    )

    @field_validator("thinking_effort", mode="before")
    @classmethod
    def normalize_effort(cls, value: Any) -> ThinkingEffort:
        if not isinstance(value, (str, ThinkingEffort)):
            raise ValueError("thinkingEffort must be a string")
        return normalize_thinking_effort(value)

    @field_validator("model_ref")
    @classmethod
    def validate_model_ref(cls, value: str) -> str:
        if not value.startswith("provider://"):
            raise ValueError("modelRef must use provider://")
        return value


class PermissionRule(_StrictFrozenModel):
    action: str = Field(min_length=1)
    effect: Literal["allow", "prompt", "deny"]


class PermissionProfile(_StrictFrozenModel):
    profile: Literal[
        "request_approval",
        "auto_review",
        "workspace_write",
        "full_access",
    ] = "request_approval"
    rules: tuple[PermissionRule, ...] = Field(default_factory=tuple)


class GitPolicy(_StrictFrozenModel):
    enabled: bool = True
    checkpoint_policy: str = Field(
        default="user_and_run_terminal",
        alias="checkpointPolicy",
    )
    agent_isolation: Literal["worktree"] = Field(
        default="worktree",
        alias="agentIsolation",
    )
    remote_policy: Literal["deny", "prompt", "allow"] = Field(
        default="prompt",
        alias="remotePolicy",
    )


class BundleSpec(_StrictFrozenModel):
    instructions: dict[str, str] = Field(default_factory=dict)
    context: tuple[ContextSource, ...] = Field(default_factory=tuple)
    skills: tuple[SkillAssignment, ...] = Field(default_factory=tuple)
    connectors: tuple[ConnectorRequirement, ...] = Field(default_factory=tuple)
    mcp_servers: tuple[McpServerRequirement, ...] = Field(
        default_factory=tuple,
        alias="mcpServers",
    )
    agents: tuple[AgentProfile, ...] = Field(default_factory=tuple)
    models: dict[str, ModelProfile] = Field(default_factory=dict)
    permissions: PermissionProfile = Field(default_factory=PermissionProfile)
    git: GitPolicy = Field(default_factory=GitPolicy)

    @field_validator("instructions")
    @classmethod
    def validate_instruction_refs(
        cls, value: dict[str, str]
    ) -> dict[str, str]:
        invalid = [
            role
            for role, ref in value.items()
            if not ref.startswith("bundle://")
        ]
        if invalid:
            raise ValueError(
                "instruction refs must use bundle://: "
                + ", ".join(sorted(invalid))
            )
        return value

    @model_validator(mode="after")
    def validate_references(self) -> BundleSpec:
        agent_ids = {agent.id for agent in self.agents}
        if len(agent_ids) != len(self.agents):
            raise ValueError("agent ids must be unique")
        context_ids = {source.id for source in self.context}
        if len(context_ids) != len(self.context):
            raise ValueError("context source ids must be unique")
        connector_ids = {item.id for item in self.connectors}
        if len(connector_ids) != len(self.connectors):
            raise ValueError("connector ids must be unique")
        mcp_ids = {item.id for item in self.mcp_servers}
        if len(mcp_ids) != len(self.mcp_servers):
            raise ValueError("MCP server ids must be unique")
        if "default" not in self.models:
            raise ValueError("Bundle models must define the default profile")
        missing_profiles = {
            agent.model_profile
            for agent in self.agents
            if agent.model_profile not in self.models
        }
        if missing_profiles:
            raise ValueError(
                "agents reference missing model profiles: "
                + ", ".join(sorted(missing_profiles))
            )
        assigned_agents = {
            agent_id
            for assignment in (*self.skills, *self.mcp_servers)
            for agent_id in assignment.assign_to
        }
        unknown_agents = assigned_agents - agent_ids
        if unknown_agents:
            raise ValueError(
                "assignTo references unknown agents: "
                + ", ".join(sorted(unknown_agents))
            )
        return self


class WorkforceBundleManifest(_StrictFrozenModel):
    api_version: Literal["eigent.ai/v1alpha1"] = Field(alias="apiVersion")
    kind: Literal["WorkforceBundle"]
    metadata: BundleMetadata
    spec: BundleSpec

    @model_validator(mode="after")
    def reject_secret_values(self) -> WorkforceBundleManifest:
        assert_manifest_secret_free(self.canonical_payload())
        return self

    def canonical_payload(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True, mode="json")

    @property
    def digest(self) -> str:
        return canonical_digest(self.canonical_payload())

    @property
    def revision_id(self) -> str:
        return f"{self.metadata.id}@{self.metadata.revision}"


class LockedDependency(_StrictFrozenModel):
    ref: str = Field(min_length=1)
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    version: str | None = None


class WorkspaceLock(_StrictFrozenModel):
    api_version: Literal["eigent.ai/lock/v1alpha1"] = Field(alias="apiVersion")
    bundle_revision: str = Field(min_length=1, alias="bundleRevision")
    manifest_digest: str = Field(
        pattern=r"^[0-9a-f]{64}$",
        alias="manifestDigest",
    )
    assets: tuple[LockedDependency, ...] = Field(default_factory=tuple)
    skills: tuple[LockedDependency, ...] = Field(default_factory=tuple)
    mcp_packages: tuple[LockedDependency, ...] = Field(
        default_factory=tuple,
        alias="mcpPackages",
    )

    @model_validator(mode="after")
    def reject_local_or_secret_values(self) -> WorkspaceLock:
        payload = self.canonical_payload()
        assert_manifest_secret_free(payload)
        assert_cloud_projection_safe(payload)
        return self

    def canonical_payload(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True, mode="json")


@dataclass(frozen=True)
class EffortResolution:
    requested: ThinkingEffort
    effective: ThinkingEffort
    provider_parameter_name: str | None
    provider_value: str
    capability_revision: str
    remapped: bool


@dataclass(frozen=True)
class ProviderModelCapability:
    supported_efforts: tuple[ThinkingEffort, ...]
    default_effort: ThinkingEffort
    provider_mapping: dict[ThinkingEffort, str]
    capability_revision: str
    dynamic_model: bool = False
    provider_parameter_name: str | None = None

    def __post_init__(self) -> None:
        supported = tuple(dict.fromkeys(self.supported_efforts))
        if not supported:
            raise WorkspaceConfigError(
                "provider capability must support at least one effort"
            )
        if self.default_effort not in supported:
            raise WorkspaceConfigError(
                "provider default effort must be supported"
            )
        missing = set(supported) - set(self.provider_mapping)
        if missing:
            raise WorkspaceConfigError(
                "provider mapping is missing efforts: "
                + ", ".join(sorted(item.value for item in missing))
            )
        if not self.capability_revision.strip():
            raise WorkspaceConfigError(
                "provider capability revision is required"
            )
        object.__setattr__(self, "supported_efforts", supported)
        object.__setattr__(
            self,
            "provider_mapping",
            MappingProxyType(dict(self.provider_mapping)),
        )

    def resolve(
        self,
        requested: str | ThinkingEffort | None,
        *,
        allow_dynamic_remap: bool = False,
    ) -> EffortResolution:
        normalized = (
            normalize_thinking_effort(requested)
            if requested is not None
            else self.default_effort
        )
        effective = normalized
        if effective not in self.supported_efforts:
            if not (self.dynamic_model and allow_dynamic_remap):
                raise UnsupportedThinkingEffortError(
                    f"effort {effective.value!r} is not supported by "
                    f"capability {self.capability_revision!r}"
                )
            requested_index = _EFFORT_ORDER.index(effective)
            effective = min(
                self.supported_efforts,
                key=lambda candidate: (
                    abs(_EFFORT_ORDER.index(candidate) - requested_index),
                    _EFFORT_ORDER.index(candidate) > requested_index,
                ),
            )
        return EffortResolution(
            requested=normalized,
            effective=effective,
            provider_parameter_name=self.provider_parameter_name,
            provider_value=self.provider_mapping[effective],
            capability_revision=self.capability_revision,
            remapped=effective is not normalized,
        )


class ResolvedContextSource(_StrictFrozenModel):
    id: str
    kind: str
    logical_uri: str | None = None
    slot_id: str | None = None
    absolute_path: str | None = None
    root_fingerprint_digest: str | None = None

    def cloud_projection(self) -> dict[str, Any]:
        return self.model_dump(
            include={
                "id",
                "kind",
                "logical_uri",
                "slot_id",
                "root_fingerprint_digest",
            },
            exclude_none=True,
            mode="json",
        )


class ResolvedConnectorBinding(_StrictFrozenModel):
    connector_id: str
    slot_id: str
    local_binding_id: str | None = None
    required_grants: tuple[str, ...] = Field(default_factory=tuple)

    def cloud_projection(self) -> dict[str, Any]:
        return self.model_dump(
            include={"connector_id", "slot_id", "required_grants"},
            mode="json",
        )


class WorktreeMaterialization(_StrictFrozenModel):
    repository_id: str
    logical_worktree_role: str
    absolute_path: str | None = None
    base_commit: str | None = None

    def cloud_projection(self) -> dict[str, Any]:
        return self.model_dump(
            include={
                "repository_id",
                "logical_worktree_role",
                "base_commit",
            },
            exclude_none=True,
            mode="json",
        )


class LocalMaterialization(_StrictFrozenModel):
    context_sources: tuple[ResolvedContextSource, ...] = Field(
        default_factory=tuple
    )
    connector_bindings: tuple[ResolvedConnectorBinding, ...] = Field(
        default_factory=tuple
    )
    worktree: WorktreeMaterialization | None = None

    def cloud_projection(self) -> dict[str, Any]:
        return {
            "context_sources": [
                source.cloud_projection() for source in self.context_sources
            ],
            "connector_bindings": [
                binding.cloud_projection()
                for binding in self.connector_bindings
            ],
            "worktree": (
                self.worktree.cloud_projection() if self.worktree else None
            ),
        }


class EffectiveEnvironmentSpec(_StrictFrozenModel):
    spec_id: str
    owner_type: Literal["run", "run_attempt"]
    owner_id: str
    bundle_revision_id: str
    manifest_digest: str
    semantic_spec: dict[str, Any]
    semantic_spec_digest: str
    local_materialization: LocalMaterialization
    local_materialization_digest: str
    permission_profile_revision: str
    thinking_effort_requested: ThinkingEffort
    thinking_effort_effective: ThinkingEffort
    provider_parameter_name: str | None = None
    provider_value: str
    provider_capability_revision: str
    redaction_schema_version: int = 1

    @classmethod
    def create(
        cls,
        *,
        owner_type: Literal["run", "run_attempt"],
        owner_id: str,
        manifest: WorkforceBundleManifest,
        semantic_spec: dict[str, Any],
        local_materialization: LocalMaterialization,
        permission_profile_revision: str,
        effort: EffortResolution,
    ) -> EffectiveEnvironmentSpec:
        assert_manifest_secret_free(semantic_spec)
        semantic_digest = canonical_digest(semantic_spec)
        local_payload = local_materialization.model_dump(
            exclude_none=True,
            mode="json",
        )
        local_digest = canonical_digest(local_payload)
        identity = {
            "owner_type": owner_type,
            "owner_id": owner_id,
            "bundle_revision_id": manifest.revision_id,
            "semantic_spec_digest": semantic_digest,
            "local_materialization_digest": local_digest,
            "permission_profile_revision": permission_profile_revision,
            "thinking_effort_requested": effort.requested.value,
            "thinking_effort_effective": effort.effective.value,
            "provider_capability_revision": effort.capability_revision,
        }
        spec_id = f"envspec_{canonical_digest(identity)}"
        return cls(
            spec_id=spec_id,
            owner_type=owner_type,
            owner_id=owner_id,
            bundle_revision_id=manifest.revision_id,
            manifest_digest=manifest.digest,
            semantic_spec=semantic_spec,
            semantic_spec_digest=semantic_digest,
            local_materialization=local_materialization,
            local_materialization_digest=local_digest,
            permission_profile_revision=permission_profile_revision,
            thinking_effort_requested=effort.requested,
            thinking_effort_effective=effort.effective,
            provider_parameter_name=effort.provider_parameter_name,
            provider_value=effort.provider_value,
            provider_capability_revision=effort.capability_revision,
        )

    def local_payload(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True, mode="json")

    @property
    def digest(self) -> str:
        return canonical_digest(self.local_payload())

    def cloud_projection(self) -> dict[str, Any]:
        payload = {
            "schema_version": 1,
            "owner_type": self.owner_type,
            "owner_id": self.owner_id,
            "bundle_revision_id": self.bundle_revision_id,
            "manifest_digest": self.manifest_digest,
            "semantic_spec": self.semantic_spec,
            "semantic_spec_digest": self.semantic_spec_digest,
            "local_projection": self.local_materialization.cloud_projection(),
            "permission_profile_revision": self.permission_profile_revision,
            "thinking_effort_requested": self.thinking_effort_requested.value,
            "thinking_effort_effective": self.thinking_effort_effective.value,
            "provider_parameter_name": self.provider_parameter_name,
            "provider_parameter_value": self.provider_value,
            "provider_capability_revision": (
                self.provider_capability_revision
            ),
            "redaction_schema_version": self.redaction_schema_version,
        }
        assert_cloud_projection_safe(payload)
        projection = {
            **payload,
            "projection_digest": canonical_digest(payload),
        }
        assert_cloud_projection_safe(projection)
        return projection
