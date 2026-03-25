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

from typing import Annotated, Final

from pydantic import BeforeValidator

PLATFORM_ALIAS_MAPPING: Final[dict[str, str]] = {
    "z.ai": "zhipu",
    "ModelArk": "openai-compatible-model",
    "grok": "openai-compatible-model",
    "ernie": "qianfan",
    "llama.cpp": "openai-compatible-model",
}

# Bedrock Converse requires a region during model initialization.
BEDROCK_CONVERSE_REGION: Final[str] = "us-west-2"


def patch_bedrock_cloud_config(
    api_url: str, extra_params: dict
) -> tuple[str, dict]:
    """Patch API URL and extra_params for Bedrock Converse in cloud mode.

    Appends '/bedrock' to the proxy URL and defaults the region.
    Returns the updated (api_url, extra_params).
    """
    extra_params = dict(extra_params)
    extra_params.setdefault("region_name", BEDROCK_CONVERSE_REGION)
    return api_url + "/bedrock", extra_params


def normalize_model_platform(platform: str) -> str:
    """Normalize provider aliases to supported model platform names."""
    return PLATFORM_ALIAS_MAPPING.get(platform, platform)


def normalize_optional_model_platform(platform: str | None) -> str | None:
    """Optional variant of normalize_model_platform."""
    if platform is None:
        return None
    return normalize_model_platform(platform)


NormalizedModelPlatform = Annotated[
    str, BeforeValidator(normalize_model_platform)
]
NormalizedOptionalModelPlatform = Annotated[
    str | None, BeforeValidator(normalize_optional_model_platform)
]
