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

import httpx
import pytest
from camel.models import ModelFactory
from camel.models.openai_compatible_model import OpenAICompatibleModel
from openai import AsyncOpenAI, BadRequestError
from pydantic import BaseModel

from app.model.model_platform import (
    NormalizedModelPlatform,
    NormalizedOptionalModelPlatform,
    is_eigent_cloud_model_endpoint,
    normalize_model_platform,
    normalize_optional_model_platform,
    resolve_cloud_model_runtime_platform,
)


def test_normalize_model_platform_maps_known_aliases():
    assert normalize_model_platform("grok") == "openai-compatible-model"
    assert normalize_model_platform("z.ai") == "zhipuai"
    assert normalize_model_platform("ModelArk") == "openai-compatible-model"
    assert normalize_model_platform("ernie") == "qianfan"
    assert normalize_model_platform("llama.cpp") == "openai-compatible-model"
    assert normalize_model_platform("nebius") == "openai-compatible-model"


def test_normalize_model_platform_keeps_non_alias_unchanged():
    assert normalize_model_platform("openai") == "openai"
    assert normalize_model_platform("mistral") == "mistral"


def test_normalize_optional_model_platform_handles_none():
    assert normalize_optional_model_platform(None) is None


def test_normalized_model_platform_type_applies_in_pydantic_model():
    class _Model(BaseModel):
        model_platform: NormalizedModelPlatform
        optional_model_platform: NormalizedOptionalModelPlatform = None

    item = _Model(
        model_platform="ernie",
        optional_model_platform="ModelArk",
    )

    assert item.model_platform == "qianfan"
    assert item.optional_model_platform == "openai-compatible-model"


def test_eigent_cloud_azure_responses_use_openai_compatible_transport():
    assert is_eigent_cloud_model_endpoint("https://proxy.eigent.ai")
    assert (
        resolve_cloud_model_runtime_platform(
            model_platform="azure",
            api_url="https://proxy.eigent.ai",
            api_mode="responses",
        )
        == "openai-compatible-model"
    )


def test_cloud_chat_and_direct_azure_responses_keep_azure_transport():
    assert (
        resolve_cloud_model_runtime_platform(
            model_platform="azure",
            api_url="https://proxy.eigent.ai",
            api_mode="chat_completions",
        )
        == "azure"
    )
    assert (
        resolve_cloud_model_runtime_platform(
            model_platform="azure",
            api_url="https://customer-resource.openai.azure.com",
            api_mode="responses",
        )
        == "azure"
    )


@pytest.mark.asyncio
async def test_cloud_responses_runtime_calls_standard_responses_route():
    runtime_platform = resolve_cloud_model_runtime_platform(
        model_platform="azure",
        api_url="https://proxy.eigent.ai",
        api_mode="responses",
    )
    requested_paths: list[str] = []

    async def reject_after_recording(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        return httpx.Response(
            400,
            request=request,
            json={"error": {"message": "test stop", "type": "test_error"}},
        )

    http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(reject_after_recording)
    )
    responses_client = AsyncOpenAI(
        api_key="test-key",
        base_url="https://proxy.eigent.ai",
        max_retries=0,
        http_client=http_client,
    )

    backend = ModelFactory.create(
        model_platform=runtime_platform,
        model_type="gpt-5.7-future",
        api_key="test-key",
        url="https://proxy.eigent.ai",
        api_mode="responses",
        async_client=responses_client,
    )

    assert isinstance(backend, OpenAICompatibleModel)
    assert backend._api_mode == "responses"
    with pytest.raises(BadRequestError, match="test stop"):
        await backend._async_client.responses.create(
            model="gpt-5.7-future",
            input="hello",
        )

    assert requested_paths == ["/responses"]
    await responses_client.close()
