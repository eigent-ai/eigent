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

from camel.types import ModelType

# Maps platform name (lowercase) to model-name prefixes for filtering.
# An empty list means the platform accepts any model.
MODEL_PREFIXES: dict[str, list[str]] = {
    "openai": ["gpt-", "o1", "o3", "o4", "chatgpt-"],
    "anthropic": ["claude-"],
    "gemini": ["gemini-"],
    "deepseek": ["deepseek"],
    "qwen": ["qwen"],
    "minimax": ["minimax"],
    "moonshot": ["moonshot", "kimi"],
    "azure": ["gpt-", "o1", "o3", "o4"],
    "openai-compatible-model": [],
    "openrouter": [],
    "bedrock": [],
    "ollama": [],
    "vllm": [],
    "sglang": [],
    "lmstudio": [],
    "modelark": [],
    "zai": [],
}


def get_model_type_suggestions(platform: str | None) -> list[str]:
    """Return CAMEL model names for the given platform, newest first.

    Filters by platform prefix when known; returns all models otherwise.

    Args:
        platform (str | None): Platform name (e.g. 'openai', 'anthropic').
            Case-insensitive. None or empty returns all models.

    Returns:
        list[str]: Model name strings, newest (by CAMEL enum order) first.
    """
    platform_key = (platform or "").lower()
    # Reversed enum order puts newer models (defined later in CAMEL) first
    all_camel = list(reversed([mt.value for mt in ModelType]))
    prefixes = MODEL_PREFIXES.get(platform_key)
    if prefixes:
        return [
            m
            for m in all_camel
            if any(m.lower().startswith(p) for p in prefixes)
        ]
    return all_camel
