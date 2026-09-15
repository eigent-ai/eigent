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

"""Pure effort/transport configuration, separate from Responses input adapters."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.workspace_config.capabilities import ModelCapabilityRegistry
from app.workspace_config.models import (
    ModelCapabilityConfigError,
    ThinkingEffort,
    UnsupportedThinkingEffortError,
)


def resolve_model_effort_config(
    *,
    model_platform: str,
    model_type: str,
    model_config: dict[str, Any],
    api_mode: str | None = None,
    provider_override: dict[str, Any] | None = None,
    auth_source: str | None = None,
    requested_effort: ThinkingEffort | None = None,
    pinned_parameter: str | None = None,
    pinned_value: str | None = None,
    pinned_transport: str | None = None,
    has_function_tools: bool = False,
    is_cloud: bool = False,
) -> tuple[dict[str, Any], str]:
    """Return a copied request config and the selected CAMEL api_mode.

    An admitted parameter/value wins over provider JSON. A custom agent must
    resolve its own model, without the task's pin. Metadata is initializer-side
    only; messages, tools, and Responses input conversion are untouched.
    """
    config = deepcopy(model_config)
    extra_body = config.get("extra_body")
    if extra_body is not None and not isinstance(extra_body, dict):
        raise ModelCapabilityConfigError("extra_body must be an object")
    extra_body = extra_body or {}
    if "model" in extra_body:
        raise ModelCapabilityConfigError(
            "extra_body cannot override the selected model"
        )
    if "model_capability" in config or "model_capability" in extra_body:
        raise ModelCapabilityConfigError(
            "model_capability belongs in extra_params"
        )
    reasoning = config.pop("reasoning", None)
    if reasoning is not None and not isinstance(reasoning, dict):
        raise ModelCapabilityConfigError("reasoning must be an object")
    reasoning = reasoning or {}
    candidates = [
        config.pop("reasoning_effort", None),
        config.pop("reasoning.effort", None),
        config.pop("thinking_effort", None),
        reasoning.pop("effort", None),
    ]
    # SDK extra_body is merged after typed parameters. Normalize its effort
    # fields too, or it could silently replace the admitted value on the wire.
    extra_reasoning = extra_body.pop("reasoning", None)
    if extra_reasoning is not None and not isinstance(extra_reasoning, dict):
        raise ModelCapabilityConfigError(
            "extra_body reasoning must be an object"
        )
    if extra_reasoning:
        candidates.append(extra_reasoning.pop("effort", None))
        reasoning.update(extra_reasoning)
    candidates.extend(
        extra_body.pop(key, None)
        for key in ("reasoning_effort", "reasoning.effort", "thinking_effort")
    )
    supplied = [value for value in candidates if value is not None]
    pinned = pinned_value is not None
    capability = ModelCapabilityRegistry().resolve(
        model_platform=model_platform,
        model_type=model_type,
        auth_source=auth_source,
        api_mode=pinned_transport or api_mode,
        has_function_tools=has_function_tools,
        provider_override=provider_override,
        is_cloud=is_cloud,
        has_reasoning_effort=(
            (pinned and pinned_value != "provider_default")
            or requested_effort is not None
            or bool(supplied)
        ),
    )
    transport = capability.transport
    if pinned_transport and pinned_transport != transport:
        raise ModelCapabilityConfigError("admitted_model_transport_mismatch")

    value = None
    if pinned:
        if pinned_value == "provider_default":
            if supplied:
                raise UnsupportedThinkingEffortError(
                    "effort_not_admitted: explicit provider effort conflicts "
                    "with the admitted provider default"
                )
        else:
            if pinned_parameter not in {
                "reasoning_effort",
                "reasoning.effort",
            }:
                raise ModelCapabilityConfigError(
                    "unsupported_effort_parameter"
                )
            value = pinned_value
    elif requested_effort is not None:
        value = capability.resolve(requested_effort).provider_value
    elif supplied:
        if any(not isinstance(item, str) for item in supplied):
            raise UnsupportedThinkingEffortError("invalid_provider_effort")
        if len(set(supplied)) > 1:
            raise UnsupportedThinkingEffortError(
                "conflicting_provider_efforts"
            )
        value = supplied[0]
        if not capability.supported_efforts:
            raise UnsupportedThinkingEffortError(capability.diagnostic)
        if value not in capability.provider_mapping.values():
            raise UnsupportedThinkingEffortError("unsupported_provider_effort")

    if transport == "responses":
        if value is not None:
            reasoning["effort"] = value
        if reasoning:
            config["reasoning"] = reasoning
        config.pop("stream_options", None)
        extra_body.pop("stream_options", None)
    else:
        if reasoning:
            raise ModelCapabilityConfigError(
                "Responses reasoning options require api_mode=responses"
            )
        if value is not None:
            config["reasoning_effort"] = value
    if "extra_body" in config:
        if extra_body:
            config["extra_body"] = extra_body
        else:
            config.pop("extra_body")
    return config, transport
