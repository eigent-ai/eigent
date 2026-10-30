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

"""Versioned, transport-specific model capability registration.

Precedence: explicit scoped provider override, exact catalog entry, legacy
adapter mapping, unknown/provider-default. No network or credentials are read.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    model_validator,
)

from app.model.model_platform import (
    azure_reasoning_tools_require_responses_api,
)
from app.workspace_config.models import (
    ModelCapabilityConfigError,
    ProviderModelCapability,
    ThinkingEffort,
    canonical_digest,
)

Transport = Literal["chat_completions", "responses"]
_PARAMETER_BY_TRANSPORT = {
    "chat_completions": "reasoning_effort",
    "responses": "reasoning.effort",
}
# Compatibility only. New registrations belong in the catalog, never here.
_OPENAI_REASONING_MODEL_PREFIXES = ("codex", "gpt-5", "o1", "o3", "o4")


class ModelCapabilityMetadata(BaseModel):
    """A complete, explicitly scoped declaration; never forwarded to the SDK."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[1]
    revision: str = Field(
        min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9._-]+$"
    )
    model_platform: str = Field(min_length=1, max_length=128)
    model_type: str = Field(min_length=1, max_length=256)
    supported_efforts: tuple[ThinkingEffort, ...] = Field(min_length=1)
    default_effort: ThinkingEffort = ThinkingEffort.MEDIUM
    provider_mapping: dict[ThinkingEffort, str]
    transport_parameters: dict[Transport, str]
    default_transport: Transport = "chat_completions"
    tools_transport: Transport | None = None

    @model_validator(mode="after")
    def validate_contract(self) -> ModelCapabilityMetadata:
        efforts = set(self.supported_efforts)
        if len(efforts) != len(self.supported_efforts):
            raise ValueError("duplicate supported efforts")
        if self.default_effort not in efforts:
            raise ValueError("default effort must be supported")
        if set(self.provider_mapping) != efforts:
            raise ValueError("provider mapping must match supported efforts")
        # The current adapters support OpenAI effort strings. Product aliases
        # (including historical ultra -> max) are not provider API values.
        if any(
            value not in {item.value for item in ThinkingEffort}
            for value in self.provider_mapping.values()
        ):
            raise ValueError("invalid provider effort value")
        if self.default_transport not in self.transport_parameters:
            raise ValueError("default transport must have a parameter mapping")
        if (
            self.tools_transport
            and self.tools_transport not in self.transport_parameters
        ):
            raise ValueError("tools transport must have a parameter mapping")
        for transport, parameter in self.transport_parameters.items():
            if parameter != _PARAMETER_BY_TRANSPORT[transport]:
                raise ValueError("effort parameter does not match transport")
        return self


class ModelCapabilityCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[1]
    revision: str = Field(
        min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9._-]+$"
    )
    models: tuple[ModelCapabilityMetadata, ...]

    @model_validator(mode="after")
    def validate_unique_models(self) -> ModelCapabilityCatalog:
        keys = [
            (
                item.model_platform.strip().lower(),
                item.model_type.strip().lower(),
            )
            for item in self.models
        ]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate catalog model registration")
        return self


class ModelCapabilityRegistry:
    def __init__(self, catalog: dict[str, Any] | None = None) -> None:
        try:
            if catalog is None:
                catalog_path = Path(
                    os.environ.get(
                        "EIGENT_MODEL_CAPABILITY_CATALOG",
                        str(
                            Path(__file__).with_name("model_capabilities.json")
                        ),
                    )
                )
                catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            self.catalog = ModelCapabilityCatalog.model_validate(catalog)
        except (OSError, ValueError):
            # Do not echo arbitrary config values or device-local paths.
            raise ModelCapabilityConfigError(
                "invalid_model_capability_catalog"
            ) from None

    def resolve(
        self,
        *,
        model_platform: str,
        model_type: str,
        auth_source: str | None = None,
        api_mode: str | None = None,
        has_function_tools: bool = False,
        provider_override: dict[str, Any] | None = None,
        is_cloud: bool = False,
        has_reasoning_effort: bool = True,
    ) -> ProviderModelCapability:
        platform = model_platform.strip().lower()
        model = model_type.strip().lower()
        if api_mode is not None and (
            not isinstance(api_mode, str)
            or api_mode not in _PARAMETER_BY_TRANSPORT
        ):
            raise ModelCapabilityConfigError("unsupported_model_transport")
        metadata = None
        source = "legacy_adapter"
        if provider_override is not None:
            try:
                metadata = ModelCapabilityMetadata.model_validate(
                    provider_override
                )
            except ValidationError:
                raise ModelCapabilityConfigError(
                    "invalid_model_capability_override"
                ) from None
            if (
                metadata.model_platform.strip().lower(),
                metadata.model_type.strip().lower(),
            ) != (platform, model):
                raise ModelCapabilityConfigError(
                    "model_capability_override_scope_mismatch"
                )
            source = "provider_override"
        elif auth_source != "codex_subscription":
            metadata = next(
                (
                    item
                    for item in self.catalog.models
                    if (
                        item.model_platform.strip().lower(),
                        item.model_type.strip().lower(),
                    )
                    == (platform, model)
                ),
                None,
            )
            if metadata is not None:
                source = "catalog"

        transport = api_mode or "chat_completions"
        diagnostic = None
        if metadata is not None:
            transport = api_mode or metadata.default_transport
            if has_function_tools and metadata.tools_transport:
                transport = metadata.tools_transport
            if transport not in metadata.transport_parameters:
                raise ModelCapabilityConfigError("unsupported_model_transport")
            supported = metadata.supported_efforts
            mapping = metadata.provider_mapping
            default = metadata.default_effort
            parameter = metadata.transport_parameters[transport]
        elif auth_source == "codex_subscription":
            supported = tuple(ThinkingEffort)
            mapping = {effort: effort.value for effort in supported}
            mapping[ThinkingEffort.MAX] = "xhigh"
            default = ThinkingEffort.MEDIUM
            transport = "responses"
            parameter = _PARAMETER_BY_TRANSPORT[transport]
            source = "codex_subscription"
        elif platform in {"openai", "azure"} and model.startswith(
            _OPENAI_REASONING_MODEL_PREFIXES
        ):
            supported = (
                ThinkingEffort.LOW,
                ThinkingEffort.MEDIUM,
                ThinkingEffort.HIGH,
            )
            mapping = {effort: effort.value for effort in supported}
            default = ThinkingEffort.MEDIUM
            # Preserve the existing direct-Azure compatibility rule. Cloud
            # deployments use their configured transport instead.
            if (
                azure_reasoning_tools_require_responses_api(
                    model_platform=platform, model_type=model
                )
                and has_function_tools
                and has_reasoning_effort
                and not is_cloud
            ):
                transport = "responses"
            parameter = _PARAMETER_BY_TRANSPORT[transport]
        else:
            supported = ()
            mapping = {}
            default = ThinkingEffort.MEDIUM
            parameter = None
            source = "unknown_model"
            diagnostic = "unknown_model: thinking effort capabilities are not registered"

        revision_payload = {
            "schema_version": 2,
            "source": source,
            "model_platform": platform,
            "model_type": model,
            "auth_source": auth_source,
            "supported_efforts": [item.value for item in supported],
            "provider_mapping": {
                item.value: mapping[item] for item in supported
            },
            "default_effort": default.value,
            "transport": transport,
            "provider_parameter_name": parameter,
            # Pin the selected entry, including mappings for other transports.
            "metadata": metadata.model_dump(mode="json") if metadata else None,
            "catalog_revision": self.catalog.revision
            if source == "catalog"
            else None,
        }
        return ProviderModelCapability(
            supported_efforts=supported,
            default_effort=default,
            provider_mapping=mapping,
            capability_revision="modelcap_"
            + canonical_digest(revision_payload),
            dynamic_model=source == "legacy_adapter",
            provider_parameter_name=parameter,
            transport=transport,
            source=source,
            diagnostic=diagnostic,
        )
