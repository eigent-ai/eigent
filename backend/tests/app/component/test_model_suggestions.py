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

from unittest.mock import MagicMock, patch

import pytest

from app.component.model_suggestions import (
    MODEL_PREFIXES,
    get_model_type_suggestions,
)

# Controlled model list (oldest → newest, matching CAMEL enum definition order)
_MOCK_MODELS = [
    "gpt-3.5-turbo",
    "gpt-4o",
    "claude-3-opus",
    "gemini-pro",
    "deepseek-chat",
    "qwen-turbo",
]


def _make_mock_enum(values: list[str]):
    mocks = []
    for v in values:
        m = MagicMock()
        m.value = v
        mocks.append(m)
    return mocks


@pytest.fixture(autouse=True)
def patch_model_type():
    with patch(
        "app.component.model_suggestions.ModelType",
        new=_make_mock_enum(_MOCK_MODELS),
    ):
        yield


def test_model_prefixes_contains_known_platforms():
    assert "openai" in MODEL_PREFIXES
    assert "anthropic" in MODEL_PREFIXES
    assert "gemini" in MODEL_PREFIXES
    assert "deepseek" in MODEL_PREFIXES
    assert "qwen" in MODEL_PREFIXES


def test_model_prefixes_empty_list_for_open_platforms():
    for platform in (
        "openai-compatible-model",
        "openrouter",
        "ollama",
        "vllm",
    ):
        assert MODEL_PREFIXES[platform] == [], (
            f"{platform} should have empty prefix list"
        )


def test_returns_list():
    assert isinstance(get_model_type_suggestions(None), list)


def test_all_entries_are_strings():
    result = get_model_type_suggestions(None)
    assert all(isinstance(m, str) for m in result)


def test_no_duplicates():
    result = get_model_type_suggestions(None)
    assert len(result) == len(set(result))


def test_none_platform_returns_all_models():
    result = get_model_type_suggestions(None)
    assert set(result) == set(_MOCK_MODELS)


def test_empty_string_platform_returns_all_models():
    result = get_model_type_suggestions("")
    assert set(result) == set(_MOCK_MODELS)


def test_unknown_platform_returns_all_models():
    result = get_model_type_suggestions("totally-unknown-xyz")
    assert set(result) == set(_MOCK_MODELS)


def test_newest_first_ordering():
    result = get_model_type_suggestions(None)
    assert result == list(reversed(_MOCK_MODELS))


def test_openai_platform_includes_gpt_models():
    result = get_model_type_suggestions("openai")
    assert "gpt-3.5-turbo" in result
    assert "gpt-4o" in result


def test_openai_platform_excludes_other_models():
    result = get_model_type_suggestions("openai")
    assert "claude-3-opus" not in result
    assert "gemini-pro" not in result
    assert "deepseek-chat" not in result


def test_anthropic_platform_includes_claude_models():
    result = get_model_type_suggestions("anthropic")
    assert "claude-3-opus" in result


def test_anthropic_platform_excludes_other_models():
    result = get_model_type_suggestions("anthropic")
    assert "gpt-4o" not in result
    assert "gemini-pro" not in result


def test_gemini_platform_includes_gemini_models():
    result = get_model_type_suggestions("gemini")
    assert "gemini-pro" in result


def test_gemini_platform_excludes_other_models():
    result = get_model_type_suggestions("gemini")
    assert "gpt-4o" not in result


def test_deepseek_platform_includes_deepseek_models():
    result = get_model_type_suggestions("deepseek")
    assert "deepseek-chat" in result


def test_qwen_platform_includes_qwen_models():
    result = get_model_type_suggestions("qwen")
    assert "qwen-turbo" in result


def test_platform_lookup_is_case_insensitive():
    assert get_model_type_suggestions("OPENAI") == get_model_type_suggestions(
        "openai"
    )
    assert get_model_type_suggestions(
        "Anthropic"
    ) == get_model_type_suggestions("anthropic")


def test_openai_compatible_model_returns_all_models():
    result = get_model_type_suggestions("openai-compatible-model")
    assert set(result) == set(_MOCK_MODELS)


def test_ollama_returns_all_models():
    result = get_model_type_suggestions("ollama")
    assert set(result) == set(_MOCK_MODELS)


def test_vllm_returns_all_models():
    result = get_model_type_suggestions("vllm")
    assert set(result) == set(_MOCK_MODELS)


def test_filtered_result_is_subset_of_all():
    all_models = set(get_model_type_suggestions(None))
    openai_models = set(get_model_type_suggestions("openai"))
    assert openai_models.issubset(all_models)
