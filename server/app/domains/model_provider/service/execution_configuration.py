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

"""Authenticated projection of existing Project, Space and Provider records.

This is not a second configuration or credential store. Resolving a pinned
provider requires its exact database-owned revision and a currently authorized
account/device. Values are returned only by the private credential operation.
"""

import copy
import math
import re
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlmodel import select

from app.domains.remote_control.service.command_control_service import CommandControlService
from app.model.project import Project
from app.model.provider.provider import Provider, VaildStatus
from app.model.remote_control.command_control import DesktopDevice
from app.model.space import Space


def unavailable():
    raise HTTPException(status_code=409, detail={"code": "execution_configuration_unavailable"})


def provider_projection(provider):
    """Project only the supported non-secret schema, never arbitrary JSON."""
    if (
        provider.provider_name != "openai"
        or provider.is_valid != VaildStatus.is_valid
        or not re.fullmatch(r"[0-9a-f]{32}", provider.execution_revision or "")
        or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}", provider.model_type or "")
        or provider.model_type.lower().startswith(("sk-", "sk_"))
    ):
        unavailable()
    endpoint = urlsplit(provider.endpoint_url)
    if (
        endpoint.scheme != "https"
        or not endpoint.hostname
        or endpoint.username
        or endpoint.password
        or endpoint.query
        or endpoint.fragment
        or len(provider.endpoint_url) > 512
    ):
        unavailable()
    config = provider.encrypted_config
    if config is None:
        config = {}
    if not isinstance(config, dict) or set(config) - {"model_config_dict", "api_mode", "timeout", "max_retries"}:
        unavailable()
    parameters = config.get("model_config_dict", {})
    numeric = {
        "temperature",
        "top_p",
        "max_tokens",
        "max_completion_tokens",
        "seed",
        "frequency_penalty",
        "presence_penalty",
    }
    if not isinstance(parameters, dict) or set(parameters) - numeric - {"stream", "n", "reasoning_effort"}:
        unavailable()
    for key, value in parameters.items():
        if key in numeric and (type(value) not in (int, float) or not math.isfinite(value)):
            unavailable()
    if (
        parameters.get("stream", False) is not False
        or type(parameters.get("n", 1)) is not int
        or parameters.get("n", 1) != 1
    ):
        unavailable()
    if "reasoning_effort" in parameters and parameters["reasoning_effort"] not in {
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
    }:
        unavailable()
    constructor = {key: value for key, value in config.items() if key != "model_config_dict"}
    timeout = constructor.get("timeout", 60)
    retries = constructor.get("max_retries", 0)
    if (
        constructor.get("api_mode", "chat_completions") != "chat_completions"
        or type(timeout) not in (int, float)
        or not math.isfinite(timeout)
        or not 0 < timeout <= 600
        or type(retries) is not int
        or not 0 <= retries <= 3
    ):
        unavailable()
    # Never derive a durable fingerprint from a secret, including a secret
    # accidentally copied into an otherwise non-secret string field.
    if provider.api_key and any(provider.api_key in value for value in (provider.model_type, provider.endpoint_url)):
        unavailable()
    return {
        "provider_ref": f"provider:{provider.id}:{provider.execution_revision}",
        "model_platform": provider.provider_name,
        "model_type": provider.model_type,
        "api_url": provider.endpoint_url,
        "model_config_dict": parameters,
        "extra_params": constructor,
    }


class ExecutionConfigurationSource:
    @staticmethod
    def identity(db, principal):
        device = CommandControlService.require_device(principal.desktop_instance_id, principal.user_id, db)
        return {
            "account_owner_id": str(principal.user_id),
            "desktop_instance_id": device.id,
            "device_credential_version": device.credential_version,
        }

    @classmethod
    def read(cls, db, principal, project_id, *, exact=None):
        identity = cls.identity(db, principal)
        owner = identity["account_owner_id"]
        # First select intent; the joined read below rechecks that intent and
        # returns current membership, device and provider in one DB snapshot.
        project = db.exec(select(Project).where(Project.id == project_id, Project.user_id == owner)).first()
        if project is None or project.status != "active" or project.mode not in {"single-agent", "workforce"}:
            unavailable()
        space = db.exec(select(Space).where(Space.id == project.space_id, Space.user_id == owner)).first()
        if space is None or space.status != "active" or not space.root_path:
            unavailable()
        metadata = copy.deepcopy(project.metadata_json or {})
        if not isinstance(metadata, dict):
            unavailable()
        effort = metadata.get("thinkingEffort")
        if effort is not None and effort not in {"minimal", "low", "medium", "high", "xhigh", "max", "ultra"}:
            unavailable()
        providers = select(Provider).where(Provider.user_id == principal.user_id, Provider.no_delete())
        selection = metadata.get("modelSelection")
        if exact is not None:
            if exact.space_id != project.space_id or exact.session_mode != project.mode:
                unavailable()
            _, provider_id, revision = exact.provider_ref.split(":")
            providers = providers.where(Provider.id == int(provider_id), Provider.execution_revision == revision)
        elif selection is not None:
            if (
                not isinstance(selection, dict)
                or set(selection) - {"modelType", "provider_id", "model_platform", "model_type"}
                or selection.get("modelType") not in {"custom", "local"}
                or type(selection.get("provider_id")) is not int
            ):
                unavailable()
            providers = providers.where(Provider.id == selection["provider_id"])
        else:
            providers = providers.where(Provider.prefer == True)
        candidates = db.exec(
            select(Project, Space, Provider)
            .join(Space, Space.id == Project.space_id)
            .join(Provider, Provider.user_id == principal.user_id)
            .join(DesktopDevice, DesktopDevice.id == principal.desktop_instance_id)
            .where(
                Project.id == project_id,
                Project.user_id == owner,
                Project.status == "active",
                Space.user_id == owner,
                Space.status == "active",
                DesktopDevice.user_id == principal.user_id,
                DesktopDevice.revoked_at.is_(None),
                DesktopDevice.credential_version == identity["device_credential_version"],
                Provider.id.in_(providers.with_only_columns(Provider.id)),
            )
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
        if len(candidates) != 1:
            unavailable()
        project, space, provider = candidates[0]
        if not space.root_path or project.mode not in {"single-agent", "workforce"}:
            unavailable()
        if exact is not None:
            if (project.space_id, project.mode) != (exact.space_id, exact.session_mode):
                unavailable()
        elif (project.metadata_json or {}) != metadata:
            unavailable()
        projection = provider_projection(provider)
        if exact is None and selection:
            for field in ("model_platform", "model_type"):
                if field in selection and selection[field] != projection[field]:
                    unavailable()
        result = {
            **identity,
            "project_id": project.id,
            "space_id": space.id,
            "space_source_type": "legacy" if (space.metadata_json or {}).get("legacy") is True else space.source_type,
            "session_mode": project.mode,
            "space_root": space.root_path,
            "thinking_effort": effort,
            "provider": projection,
        }
        if exact is not None:
            if not isinstance(provider.api_key, str) or not provider.api_key.strip():
                unavailable()
            # Never log, hash or persist this response in the Brain.
            result["api_key"] = provider.api_key
        return result
