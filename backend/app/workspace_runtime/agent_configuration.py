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

"""Exact, secret-free configuration for the managed file Agent profiles.

Registered by trusted backend code, never by deserializing Chat/UI state.
Credentials remain ephemeral and are resolved by exact identity, without an
environment, subscription-account or latest Workspace Bundle fallback.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from app.permission_policy import PRESET_PROFILES, PermissionProfileName
from app.run_journal.models import AttemptEnvironmentBinding
from app.workspace_config.models import (
    LocalMaterialization,
    ProviderModelCapability,
    WorkspaceBundleManifest,
    WorktreeMaterialization,
    canonical_digest,
)
from app.workspace_config.resolver import EnvironmentConfigResolver

from .service import ExecutionForbidden, ExecutionUnavailable


class AgentConfigurationUnavailable(ExecutionUnavailable):
    code = "agent_configuration_unavailable"


@dataclass(frozen=True)
class ResolvedCredential:
    ref: str
    principal_ref: str
    api_key: str = field(repr=False)


@dataclass(frozen=True, init=False)
class FrozenAgentConfiguration:
    _manifest_json: str = field(repr=False)
    _snapshot_json: str = field(repr=False)
    _capability: ProviderModelCapability = field(repr=False)
    _credential_resolver: object = field(repr=False)
    configuration_revision: str

    def __init__(
        self,
        *,
        manifest,
        provider_capability,
        space_id,
        project_id,
        principal_ref,
        permission_profile_revision,
        credential_ref,
        model_platform,
        model_type,
        api_url,
        thinking_effort,
        tokenizer_ref,
        credential_resolver,
        model_config_dict=None,
        extra_params=None,
        session_mode="single-agent",
        tool_authorizations=("workspace_files",),
        registration_binding=None,
    ):
        manifest = WorkspaceBundleManifest.model_validate(
            manifest.canonical_payload()
        )
        spec = manifest.spec
        if (
            type(provider_capability) is not ProviderModelCapability
            or session_mode not in {"single-agent", "workforce"}
            or model_platform != "openai"
            or provider_capability.transport != "chat_completions"
            or tuple(tool_authorizations) != ("workspace_files",)
            or set(spec.models) != {"default"}
            or spec.instructions
            or spec.context
            or spec.skills
            or spec.connectors
            or spec.mcp_servers
            or spec.environment
            or spec.agents
            or spec.permissions.rules
        ):
            raise AgentConfigurationUnavailable("agent_profile_unsupported")
        endpoint = urlsplit(api_url)
        if (
            endpoint.scheme != "https"
            or not endpoint.hostname
            or endpoint.username
            or endpoint.password
            or endpoint.query
            or endpoint.fragment
        ):
            raise AgentConfigurationUnavailable(
                "explicit_model_endpoint_required"
            )
        # Constructor values and inference parameters have separate closed
        # schemas. No headers, SDK objects, tools, auth callbacks or secrets.
        parameters = dict(model_config_dict or {})
        allowed = {
            "temperature",
            "top_p",
            "max_tokens",
            "max_completion_tokens",
            "seed",
            "frequency_penalty",
            "presence_penalty",
            "stream",
            "n",
            "reasoning_effort",
        }
        if set(parameters) - allowed:
            raise AgentConfigurationUnavailable("model_parameter_unsupported")
        for key, value in parameters.items():
            if key in {"stream", "n", "reasoning_effort"}:
                continue
            if type(value) not in {int, float} or not math.isfinite(value):
                raise AgentConfigurationUnavailable("model_parameter_invalid")
        if (
            parameters.get("stream", False) is not False
            or type(parameters.get("n", 1)) is not int
            or parameters.get("n", 1) != 1
        ):
            raise AgentConfigurationUnavailable("model_streaming_unsupported")
        parameters["stream"] = False
        constructor = dict(extra_params or {})
        if set(constructor) - {"api_mode", "timeout", "max_retries"}:
            raise AgentConfigurationUnavailable(
                "model_constructor_unsupported"
            )
        constructor.setdefault("api_mode", "chat_completions")
        constructor.setdefault("timeout", 60)
        constructor.setdefault("max_retries", 0)
        if (
            constructor["api_mode"] != "chat_completions"
            or type(constructor["timeout"]) not in {int, float}
            or not math.isfinite(constructor["timeout"])
            or not 0 < constructor["timeout"] <= 600
            or type(constructor["max_retries"]) is not int
            or not 0 <= constructor["max_retries"] <= 3
        ):
            raise AgentConfigurationUnavailable("model_constructor_invalid")
        from app.model.effort import resolve_model_effort_config

        try:
            effort = provider_capability.resolve(thinking_effort)
            resolve_model_effort_config(
                model_platform=model_platform,
                model_type=model_type,
                model_config=parameters,
                pinned_transport=provider_capability.transport,
                pinned_parameter=effort.provider_parameter_name,
                pinned_value=effort.provider_value,
                pinned_capability=provider_capability,
                has_function_tools=True,
            )
        except (ValueError, RuntimeError) as error:
            raise AgentConfigurationUnavailable(
                "model_effort_unsupported"
            ) from error
        if "reasoning_effort" in parameters and (
            effort.provider_parameter_name != "reasoning_effort"
            or parameters["reasoning_effort"] != effort.provider_value
        ):
            raise AgentConfigurationUnavailable("model_effort_conflict")
        for value in (
            space_id,
            project_id,
            principal_ref,
            credential_ref,
            permission_profile_revision,
            model_type,
            tokenizer_ref,
        ):
            if (
                not isinstance(value, str)
                or not value.strip()
                or len(value) > 512
            ):
                raise AgentConfigurationUnavailable(
                    "configuration_identity_invalid"
                )
        object.__setattr__(
            self,
            "_manifest_json",
            json.dumps(manifest.canonical_payload(), sort_keys=True),
        )
        object.__setattr__(self, "_capability", provider_capability)
        object.__setattr__(self, "_credential_resolver", credential_resolver)
        snapshot = {
            "profile": f"{session_mode}-workspace-files-v1",
            "space_id": space_id,
            "project_id": project_id,
            "principal_ref": principal_ref,
            "credential_ref": credential_ref,
            "permission_profile_revision": permission_profile_revision,
            "bundle_revision_id": manifest.revision_id,
            "model_platform": model_platform,
            "model_type": model_type,
            "api_url": api_url,
            "model_config_dict": parameters,
            "extra_params": constructor,
            "thinking_effort": effort.requested.value,
            "provider_capability": {
                **provider_capability.snapshot(),
                "default_effort": provider_capability.default_effort.value,
                "dynamic_model": provider_capability.dynamic_model,
            },
            "tokenizer_ref": tokenizer_ref,
            "session_mode": session_mode,
            "tool_authorizations": list(tool_authorizations),
        }
        if session_mode == "workforce":
            snapshot["workforce"] = {
                "workers": ["managed_file_author", "managed_file_editor"],
                "max_subtasks": 16,
                "dynamic_workers": False,
                "recovery_strategies": [],
                "share_memory": False,
            }
        if registration_binding is not None:
            if not isinstance(registration_binding, str) or not re.fullmatch(
                r"binding:[0-9a-f]{64}", registration_binding
            ):
                raise AgentConfigurationUnavailable(
                    "registration_binding_invalid"
                )
            snapshot["registration_binding"] = registration_binding
        object.__setattr__(
            self,
            "_snapshot_json",
            json.dumps(snapshot, sort_keys=True, allow_nan=False),
        )
        object.__setattr__(
            self,
            "configuration_revision",
            "agentcfg:" + canonical_digest(snapshot),
        )

    @property
    def snapshot(self):
        return json.loads(self._snapshot_json)

    @property
    def provider_capability(self):
        return self._capability

    @property
    def configuration(self):
        snapshot = self.snapshot
        result = {
            key: snapshot[key]
            for key in (
                "space_id",
                "principal_ref",
                "credential_ref",
                "permission_profile_revision",
                "model_platform",
                "model_type",
                "thinking_effort",
                "session_mode",
                "tool_authorizations",
            )
        }
        result.update(
            configuration_revision=self.configuration_revision,
            workspace_policy_version="isolated-v1",
        )
        return result

    def require_request(self, request):
        actual = {
            key: value
            for key, value in request.envelope.items()
            if key not in {"project_id", "prompt"}
        }
        if (
            request.project_id != self.snapshot["project_id"]
            or actual != self.configuration
        ):
            raise ExecutionForbidden("agent configuration differs from intent")

    def credential(self):
        snapshot = self.snapshot
        try:
            value = self._credential_resolver(
                snapshot["credential_ref"], snapshot["principal_ref"]
            )
        except Exception:
            raise AgentConfigurationUnavailable(
                "credential_unavailable"
            ) from None
        if (
            not isinstance(value, ResolvedCredential)
            or value.ref != snapshot["credential_ref"]
            or value.principal_ref != snapshot["principal_ref"]
            or not isinstance(value.api_key, str)
            or not value.api_key.strip()
        ):
            raise AgentConfigurationUnavailable("credential_unavailable")
        return value

    def persist_environment(self, journal, request, workspace):
        self.require_request(request)
        snapshot = self.snapshot
        revision = snapshot["permission_profile_revision"]
        profile = next(
            (
                profile
                for profile in PRESET_PROFILES.values()
                if profile.revision == revision
            ),
            None,
        )
        if profile is None:
            record = journal.get_space_permission_profile_revision(revision)
            if record is None or record.space_id != snapshot["space_id"]:
                raise AgentConfigurationUnavailable(
                    "permission_revision_unavailable"
                )
            profile_name = PermissionProfileName(record.profile_name)
        else:
            profile_name = profile.name
        self.credential()
        manifest = WorkspaceBundleManifest.model_validate(
            json.loads(self._manifest_json)
        )
        local_level = {
            PermissionProfileName.READ_ONLY: -1,
            PermissionProfileName.REQUEST_APPROVAL: 0,
            PermissionProfileName.AUTO_REVIEWER: 1,
            PermissionProfileName.FULL_ACCESS: 2,
        }[profile_name]
        bundle_level = {
            "request_approval": 0,
            "auto_review": 1,
            "workspace_write": 1,
            "full_access": 2,
        }[manifest.spec.permissions.profile]
        if local_level > bundle_level:
            raise AgentConfigurationUnavailable(
                "permission_profile_exceeds_bundle"
            )
        journal.put_workspace_config_revision(
            revision_id=manifest.revision_id,
            bundle_id=manifest.metadata.id,
            revision_number=manifest.metadata.revision,
            manifest=manifest.canonical_payload(),
            created_by=snapshot["principal_ref"],
        )
        spec = EnvironmentConfigResolver().resolve(
            manifest=manifest,
            owner_type="run",
            owner_id=request.request_id,
            local_materialization=LocalMaterialization(
                worktree=WorktreeMaterialization(
                    repository_id=workspace.workspace_id,
                    logical_worktree_role="execution",
                    absolute_path=str(workspace.local_root),
                )
            ),
            provider_capability=self._capability,
            thinking_effort_override=snapshot["thinking_effort"],
            permission_profile_revision_override=revision,
            runtime_capability_manifest={
                "managed_agent": snapshot,
                "configuration_revision": self.configuration_revision,
            },
        )
        journal.put_effective_environment_spec(spec)
        return AttemptEnvironmentBinding(
            spec.spec_id,
            spec.digest,
            spec.bundle_revision_id,
            spec.permission_profile_revision,
            spec.thinking_effort_requested.value,
            spec.thinking_effort_effective.value,
            spec.provider_capability_revision,
        )

    def resolve_options(self, request, workspace, *, prompt):
        from app.model.chat import Chat

        self.require_request(request)
        snapshot = self.snapshot
        credential = self.credential()
        return Chat(
            task_id=request.request_id,
            run_id=request.request_id,
            project_id=request.project_id,
            space_id=snapshot["space_id"],
            space_root_path=str(workspace.local_root),
            workdir_mode="copy",
            question=prompt,
            email="managed@local.invalid",
            user_id=None,
            model_platform=snapshot["model_platform"],
            model_type=snapshot["model_type"],
            api_url=snapshot["api_url"],
            api_key=credential.api_key,
            model_config_dict=snapshot["model_config_dict"],
            extra_params=snapshot["extra_params"],
            thinking_effort=snapshot["thinking_effort"],
            session_mode=snapshot["session_mode"],
            allow_local_system=False,
        )
