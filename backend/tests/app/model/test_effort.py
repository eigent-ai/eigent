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
from copy import deepcopy

import httpx
import pytest
from camel.models import ModelFactory
from openai import AzureOpenAI, OpenAI

from app.model.effort import resolve_model_effort_config
from app.workspace_config.models import (
    ThinkingEffort,
    UnsupportedThinkingEffortError,
    WorkspaceConfigError,
)


@pytest.mark.parametrize("effort", tuple(ThinkingEffort))
@pytest.mark.parametrize("transport", ["responses", "chat_completions"])
def test_transport_shapes_preserve_exact_effort(effort, transport):
    config, selected = resolve_model_effort_config(
        model_platform="azure",
        model_type="gpt-6-astra",
        model_config={"stream_options": {"include_usage": True}},
        api_mode=transport,
        requested_effort=effort,
    )
    assert selected == transport
    if transport == "responses":
        assert config == {"reasoning": {"effort": effort.value}}
    else:
        assert config["reasoning_effort"] == effort.value
        assert "reasoning" not in config


def test_pin_wins_preserving_responses_summary_and_input_config():
    config = {
        "reasoning": {"effort": "low", "summary": "auto"},
        "reasoning_effort": "high",
        "thinking_effort": "medium",
    }
    before = deepcopy(config)
    result, transport = resolve_model_effort_config(
        model_platform="azure",
        model_type="gpt-6-astra",
        model_config=config,
        api_mode="responses",
        pinned_parameter="reasoning.effort",
        pinned_value="max",
        pinned_transport="responses",
    )
    assert config == before
    assert result == {"reasoning": {"effort": "max", "summary": "auto"}}


def test_conflicting_unpinned_efforts_are_rejected():
    with pytest.raises(
        UnsupportedThinkingEffortError, match="conflicting_provider_efforts"
    ):
        resolve_model_effort_config(
            model_platform="azure",
            model_type="gpt-6-astra",
            model_config={
                "reasoning_effort": "high",
                "reasoning": {"effort": "max"},
            },
        )


@pytest.mark.parametrize("value", ["ultra", "none", "minimal", "", 2, ["max"]])
def test_invalid_provider_values_never_reach_sdk(value):
    with pytest.raises(UnsupportedThinkingEffortError):
        resolve_model_effort_config(
            model_platform="azure",
            model_type="gpt-6-astra",
            model_config={"reasoning_effort": value},
        )


def test_responses_summary_is_not_forwarded_to_chat():
    with pytest.raises(
        WorkspaceConfigError, match="require api_mode=responses"
    ):
        resolve_model_effort_config(
            model_platform="openai",
            model_type="gpt-6-astra",
            model_config={"reasoning": {"effort": "high", "summary": "auto"}},
            api_mode="chat_completions",
        )


def test_nested_effort_can_translate_back_to_chat():
    config, _ = resolve_model_effort_config(
        model_platform="openai",
        model_type="gpt-6-astra",
        model_config={"reasoning": {"effort": "high"}},
        api_mode="chat_completions",
    )
    assert config == {"reasoning_effort": "high"}


def test_legacy_azure_without_explicit_effort_retains_chat():
    config, mode = resolve_model_effort_config(
        model_platform="azure",
        model_type="gpt-5.6-sol",
        model_config={},
        has_function_tools=True,
    )
    assert mode == "chat_completions"
    assert config == {}


@pytest.mark.parametrize("pinned", [None, "provider_default"])
def test_unknown_model_cannot_sneak_effort_through_provider_json(pinned):
    with pytest.raises(UnsupportedThinkingEffortError):
        resolve_model_effort_config(
            model_platform="azure",
            model_type="unregistered-deployment",
            model_config={"reasoning_effort": "max"},
            pinned_value=pinned,
        )


@pytest.mark.parametrize("platform", ["openai", "azure"])
def test_astra_tools_select_responses_even_without_explicit_effort(platform):
    config, transport = resolve_model_effort_config(
        model_platform=platform,
        model_type="gpt-6-astra",
        model_config={},
        api_mode="chat_completions",
        has_function_tools=True,
    )
    assert transport == "responses"
    assert config == {}


def test_pinned_incompatible_transport_fails_before_dispatch():
    with pytest.raises(
        WorkspaceConfigError, match="admitted_model_transport_mismatch"
    ):
        resolve_model_effort_config(
            model_platform="azure",
            model_type="gpt-6-astra",
            model_config={},
            pinned_transport="chat_completions",
            has_function_tools=True,
        )


@pytest.mark.parametrize("platform", ["azure", "openai"])
@pytest.mark.parametrize("transport", ["responses", "chat_completions"])
def test_sdk_serializes_only_the_selected_transport_effort(
    platform, transport
):
    requests = []

    def handle(request):
        requests.append((request.url.path, json.loads(request.content)))
        if transport == "responses":
            body = {
                "id": "resp-fixture",
                "object": "response",
                "created_at": 1,
                "status": "completed",
                "model": "gpt-6-astra",
                "output": [],
            }
        else:
            body = {
                "id": "chat-fixture",
                "object": "chat.completion",
                "created": 1,
                "model": "gpt-6-astra",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "fixture"},
                    }
                ],
            }
        return httpx.Response(200, json=body)

    extra = {"api_version": "2024-10-21"} if platform == "azure" else {}
    sdk_type = AzureOpenAI if platform == "azure" else OpenAI
    endpoint = "https://provider.invalid"
    sdk_endpoint = (
        {"azure_endpoint": endpoint}
        if platform == "azure"
        else {"base_url": endpoint}
    )
    with sdk_type(
        api_key="fixture-key",
        max_retries=0,
        **extra,
        **sdk_endpoint,
        http_client=httpx.Client(transport=httpx.MockTransport(handle)),
    ) as client:
        config, selected = resolve_model_effort_config(
            model_platform=platform,
            model_type="gpt-6-astra",
            model_config={"stream": False, "reasoning": {"effort": "max"}},
            api_mode=transport,
        )
        model = ModelFactory.create(
            model_platform=platform,
            model_type="gpt-6-astra",
            api_key="fixture-key",
            url=endpoint,
            model_config_dict=config,
            api_mode=selected,
            client=client,
            async_client=object(),
            **extra,
        )
        model.run([{"role": "user", "content": "fixture"}])
    path, body = requests[0]
    if transport == "responses":
        assert path.endswith("/responses")
        assert body["reasoning"] == {"effort": "max"}
        assert "reasoning_effort" not in body
    else:
        assert path.endswith("/chat/completions")
        assert body["reasoning_effort"] == "max"
        assert "reasoning" not in body
    assert "reasoning.effort" not in body
