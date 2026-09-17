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

import json
import traceback
from copy import deepcopy

import pytest

from app.workspace_config.capabilities import ModelCapabilityRegistry
from app.workspace_config.models import (
    ThinkingEffort,
    UnsupportedThinkingEffortError,
    WorkspaceConfigError,
)


@pytest.mark.parametrize("effort", tuple(ThinkingEffort))
def test_astra_preserves_all_efforts(effort):
    capability = ModelCapabilityRegistry().resolve(
        model_platform="azure", model_type="gpt-6-astra"
    )
    resolution = capability.resolve(effort, allow_dynamic_remap=True)
    assert resolution.requested is effort
    assert resolution.effective is effort
    assert resolution.provider_value == effort.value
    assert resolution.provider_parameter_name == "reasoning_effort"
    assert not resolution.remapped


@pytest.mark.parametrize("effort", tuple(ThinkingEffort))
def test_unknown_never_accepts_explicit_effort(effort):
    capability = ModelCapabilityRegistry().resolve(
        model_platform="azure", model_type="unregistered-deployment"
    )
    with pytest.raises(UnsupportedThinkingEffortError, match="unknown_model"):
        capability.resolve(effort, allow_dynamic_remap=True)


def _metadata(model_type="nebula-2027", platform="azure"):
    return {
        "schema_version": 1,
        "revision": "fixture-v1",
        "model_platform": platform,
        "model_type": model_type,
        "supported_efforts": ["low", "medium", "high", "xhigh", "max"],
        "default_effort": "medium",
        "provider_mapping": {
            effort.value: effort.value for effort in ThinkingEffort
        },
        "transport_parameters": {
            "chat_completions": "reasoning_effort",
            "responses": "reasoning.effort",
        },
        "default_transport": "chat_completions",
        "tools_transport": "responses",
    }


@pytest.mark.parametrize("platform", ["openai", "azure"])
@pytest.mark.parametrize("transport", ["responses", "chat_completions"])
def test_catalog_future_model_without_known_prefix(
    tmp_path, monkeypatch, platform, transport
):
    catalog = {
        "schema_version": 1,
        "revision": "fixture-v1",
        "models": [_metadata(platform=platform)],
    }
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(json.dumps(catalog))
    monkeypatch.setenv("EIGENT_MODEL_CAPABILITY_CATALOG", str(catalog_path))
    capability = ModelCapabilityRegistry().resolve(
        model_platform=platform, model_type="nebula-2027", api_mode=transport
    )
    resolution = capability.resolve("max")
    assert resolution.provider_value == "max"
    assert capability.source == "catalog"
    assert capability.transport == transport
    assert resolution.provider_parameter_name == (
        "reasoning.effort" if transport == "responses" else "reasoning_effort"
    )


def test_provider_override_precedes_catalog_and_is_scoped():
    metadata = _metadata("gpt-6-astra")
    metadata["provider_mapping"]["max"] = "xhigh"
    capability = ModelCapabilityRegistry().resolve(
        model_platform="azure",
        model_type="gpt-6-astra",
        provider_override=metadata,
    )
    assert capability.resolve("max").provider_value == "xhigh"
    assert capability.source == "provider_override"
    with pytest.raises(WorkspaceConfigError, match="scope_mismatch"):
        ModelCapabilityRegistry().resolve(
            model_platform="azure",
            model_type="other-deployment",
            provider_override=metadata,
        )


@pytest.mark.parametrize(
    "mutation",
    [
        {"schema_version": 2},
        {"revision": ""},
        {"supported_efforts": ["low"]},
        {"provider_mapping": {"max": "ultra"}},
        {"transport_parameters": {"responses": "reasoning_effort"}},
        {"transport_parameters": {"chat_completions": "reasoning.effort"}},
        {"api_key": "must-never-appear-in-error"},
    ],
)
def test_invalid_override_fails_closed_without_echoing_config(mutation):
    with pytest.raises(
        WorkspaceConfigError, match="invalid_model_capability_override"
    ) as error:
        ModelCapabilityRegistry().resolve(
            model_platform="azure",
            model_type="nebula-2027",
            provider_override={**_metadata(), **mutation},
        )
    assert "must-never-appear" not in str(error.value)
    assert "must-never-appear" not in "".join(
        traceback.format_exception(error.value)
    )


@pytest.mark.parametrize("api_mode", [[], {}, 1, "invalid"])
def test_invalid_transport_is_a_capability_error(api_mode):
    with pytest.raises(
        WorkspaceConfigError, match="unsupported_model_transport"
    ):
        ModelCapabilityRegistry().resolve(
            model_platform="azure", model_type="gpt-6-astra", api_mode=api_mode
        )


def test_revision_pins_mapping_transport_and_metadata():
    metadata = _metadata()

    def resolve(value, mode="responses"):
        return (
            ModelCapabilityRegistry()
            .resolve(
                model_platform="azure",
                model_type="nebula-2027",
                provider_override=value,
                api_mode=mode,
            )
            .capability_revision
        )

    initial = resolve(metadata)
    assert initial == resolve(deepcopy(metadata))
    assert initial != resolve(metadata, "chat_completions")
    assert initial != resolve({**metadata, "revision": "fixture-v2"})
    changed = deepcopy(metadata)
    changed["provider_mapping"]["max"] = "xhigh"
    assert initial != resolve(changed)


@pytest.mark.parametrize(
    "model", ["gpt-6-astra-future", "gpt-6-astra-alias", "gpt-7"]
)
def test_unregistered_astra_like_aliases_are_unknown(model):
    capability = ModelCapabilityRegistry().resolve(
        model_platform="azure", model_type=model
    )
    assert capability.supported_efforts == ()
    with pytest.raises(UnsupportedThinkingEffortError):
        capability.resolve("max")


def test_invalid_catalog_does_not_fall_back_to_prefixes():
    with pytest.raises(
        WorkspaceConfigError, match="invalid_model_capability_catalog"
    ):
        ModelCapabilityRegistry(
            {"schema_version": 2, "revision": "v2", "models": []}
        )
    with pytest.raises(
        WorkspaceConfigError, match="invalid_model_capability_catalog"
    ):
        ModelCapabilityRegistry(
            {
                "schema_version": 1,
                "revision": "v1",
                "models": [_metadata(), _metadata()],
            }
        )
