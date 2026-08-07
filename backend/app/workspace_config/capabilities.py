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

"""Versioned provider/model capability resolution for Thinking Effort."""

from __future__ import annotations

from app.workspace_config.models import (
    ProviderModelCapability,
    ThinkingEffort,
    canonical_digest,
)

_REGISTRY_SCHEMA_VERSION = 1
_OPENAI_REASONING_MODEL_PREFIXES = (
    "codex",
    "gpt-5",
    "o1",
    "o3",
    "o4",
)


class ModelCapabilityRegistry:
    """Resolve an honest capability snapshot from the active adapter.

    Unknown providers deliberately expose only their provider default. This
    keeps all five product choices available while making any remap visible in
    requested/effective Run facts instead of blindly forwarding unsupported
    strings.
    """

    def resolve(
        self,
        *,
        model_platform: str,
        model_type: str,
        auth_source: str | None = None,
    ) -> ProviderModelCapability:
        platform = model_platform.strip().lower()
        model = model_type.strip().lower()

        if auth_source == "codex_subscription":
            supported = tuple(ThinkingEffort)
            mapping = {
                ThinkingEffort.LOW: "low",
                ThinkingEffort.MEDIUM: "medium",
                ThinkingEffort.HIGH: "high",
                ThinkingEffort.XHIGH: "xhigh",
                ThinkingEffort.MAX: "xhigh",
            }
            parameter = "reasoning_effort"
            adapter = "codex_subscription"
        elif platform in {"openai", "azure"} and model.startswith(
            _OPENAI_REASONING_MODEL_PREFIXES
        ):
            supported = (
                ThinkingEffort.LOW,
                ThinkingEffort.MEDIUM,
                ThinkingEffort.HIGH,
            )
            mapping = {effort: effort.value for effort in supported}
            parameter = "reasoning_effort"
            adapter = "openai_reasoning"
        else:
            supported = (ThinkingEffort.MEDIUM,)
            mapping = {ThinkingEffort.MEDIUM: "provider_default"}
            parameter = None
            adapter = "provider_default"

        revision_payload = {
            "schema_version": _REGISTRY_SCHEMA_VERSION,
            "adapter": adapter,
            "model_platform": platform,
            "model_type": model,
            "supported_efforts": [item.value for item in supported],
            "provider_mapping": {
                item.value: mapping[item] for item in supported
            },
            "provider_parameter_name": parameter,
        }
        return ProviderModelCapability(
            supported_efforts=supported,
            default_effort=ThinkingEffort.MEDIUM,
            provider_mapping=mapping,
            capability_revision=(
                "modelcap_" + canonical_digest(revision_payload)
            ),
            dynamic_model=True,
            provider_parameter_name=parameter,
        )
