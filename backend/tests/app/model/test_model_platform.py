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

from pydantic import BaseModel

from app.model.model_platform import (
    NormalizedModelPlatform,
    NormalizedOptionalModelPlatform,
    normalize_model_platform,
    normalize_optional_model_platform,
)


def test_normalize_model_platform_maps_known_aliases():
    assert normalize_model_platform("grok") == "openai-compatible-model"
    assert normalize_model_platform("z.ai") == "openai-compatible-model"
    assert normalize_model_platform("ModelArk") == "openai-compatible-model"
    assert normalize_model_platform("llama.cpp") == "openai-compatible-model"


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
        model_platform="llama.cpp",
        optional_model_platform="ModelArk",
    )

    assert item.model_platform == "openai-compatible-model"
    assert item.optional_model_platform == "openai-compatible-model"
