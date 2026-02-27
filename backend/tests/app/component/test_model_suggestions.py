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
    "grok-3",
    "grok-4-0709",
    "mistral-large-latest",
    "open-mistral-7b",
    "open-mixtral-8x7b",
    "mistralai/Mistral-7B",
    "llama3.3-70b",
    "Meta-Llama-3.1-8B-Instruct",
    "glm-4.7",
    "zai-org/glm-4.7",
    "doubao/Doubao-1.5-pro",
    "yi-large",
    "LLM-Research/Llama-3.3-70B-Instruct",
    "PaddlePaddle/ERNIE-4.5-VL-28B-A3B-Thinking",
]


def _make_mock_enum(values: list[str]):
    mocks = []
    for v in values:
        m = MagicMock()
        m.value = v
        mocks.append(m)
    return mocks


@pytest.fixture(autouse=True)
def patch_model_type(request):
    if request.node.get_closest_marker("integration"):
        yield
        return
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
    assert "tongyi-qianwen" in MODEL_PREFIXES


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
    result = get_model_type_suggestions("tongyi-qianwen")
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


# --- grok ---


def test_model_prefixes_contains_grok():
    assert "grok" in MODEL_PREFIXES
    assert MODEL_PREFIXES["grok"] != [], (
        "grok should have non-empty prefix list"
    )


def test_grok_platform_includes_grok_models():
    result = get_model_type_suggestions("grok")
    assert "grok-3" in result
    assert "grok-4-0709" in result


def test_grok_platform_excludes_non_grok_models():
    result = get_model_type_suggestions("grok")
    assert "gpt-4o" not in result
    assert "claude-3-opus" not in result
    assert "mistral-large-latest" not in result
    assert "llama3.3-70b" not in result


def test_grok_case_insensitive():
    assert get_model_type_suggestions("GROK") == get_model_type_suggestions(
        "grok"
    )


def test_grok_filtered_result_is_subset_of_all():
    all_models = set(get_model_type_suggestions(None))
    assert set(get_model_type_suggestions("grok")).issubset(all_models)


# --- mistral ---


def test_model_prefixes_contains_mistral():
    assert "mistral" in MODEL_PREFIXES
    assert MODEL_PREFIXES["mistral"] != [], (
        "mistral should have non-empty prefix list"
    )


def test_mistral_platform_includes_mistral_prefix():
    result = get_model_type_suggestions("mistral")
    assert "mistral-large-latest" in result


def test_mistral_platform_includes_open_mistral_prefix():
    result = get_model_type_suggestions("mistral")
    assert "open-mistral-7b" in result


def test_mistral_platform_includes_open_mixtral_prefix():
    result = get_model_type_suggestions("mistral")
    assert "open-mixtral-8x7b" in result


def test_mistral_platform_includes_mistralai_slash_prefix():
    result = get_model_type_suggestions("mistral")
    assert "mistralai/Mistral-7B" in result


def test_mistral_platform_excludes_non_mistral_models():
    result = get_model_type_suggestions("mistral")
    assert "gpt-4o" not in result
    assert "claude-3-opus" not in result
    assert "grok-3" not in result
    assert "llama3.3-70b" not in result


def test_mistral_case_insensitive():
    assert get_model_type_suggestions("MISTRAL") == get_model_type_suggestions(
        "mistral"
    )


def test_mistral_filtered_result_is_subset_of_all():
    all_models = set(get_model_type_suggestions(None))
    assert set(get_model_type_suggestions("mistral")).issubset(all_models)


# --- samba-nova ---


def test_model_prefixes_contains_samba_nova():
    assert "samba-nova" in MODEL_PREFIXES
    assert MODEL_PREFIXES["samba-nova"] != [], (
        "samba-nova should have non-empty prefix list"
    )


def test_samba_nova_platform_includes_llama3_models():
    result = get_model_type_suggestions("samba-nova")
    assert "llama3.3-70b" in result


def test_samba_nova_platform_includes_meta_llama_models():
    result = get_model_type_suggestions("samba-nova")
    assert "Meta-Llama-3.1-8B-Instruct" in result


def test_samba_nova_platform_excludes_non_llama_models():
    result = get_model_type_suggestions("samba-nova")
    assert "gpt-4o" not in result
    assert "claude-3-opus" not in result
    assert "grok-3" not in result
    assert "mistral-large-latest" not in result


def test_samba_nova_case_insensitive():
    assert get_model_type_suggestions(
        "SAMBA-NOVA"
    ) == get_model_type_suggestions("samba-nova")


def test_samba_nova_filtered_result_is_subset_of_all():
    all_models = set(get_model_type_suggestions(None))
    assert set(get_model_type_suggestions("samba-nova")).issubset(all_models)


# --- z.ai ---


def test_model_prefixes_contains_zai():
    assert "z.ai" in MODEL_PREFIXES
    assert MODEL_PREFIXES["z.ai"] != [], (
        "z.ai should have non-empty prefix list"
    )


def test_zai_platform_includes_glm_models():
    result = get_model_type_suggestions("z.ai")
    assert "glm-4.7" in result


def test_zai_platform_includes_zai_org_models():
    result = get_model_type_suggestions("z.ai")
    assert "zai-org/glm-4.7" in result


def test_zai_platform_excludes_non_glm_models():
    result = get_model_type_suggestions("z.ai")
    assert "gpt-4o" not in result
    assert "claude-3-opus" not in result
    assert "grok-3" not in result


def test_zai_case_insensitive():
    assert get_model_type_suggestions("Z.AI") == get_model_type_suggestions(
        "z.ai"
    )


def test_zai_filtered_result_is_subset_of_all():
    all_models = set(get_model_type_suggestions(None))
    assert set(get_model_type_suggestions("z.ai")).issubset(all_models)


# --- tongyi-qianwen (Qwen) ---


def test_model_prefixes_contains_tongyi_qianwen():
    assert "tongyi-qianwen" in MODEL_PREFIXES
    assert MODEL_PREFIXES["tongyi-qianwen"] != [], (
        "tongyi-qianwen should have non-empty prefix list"
    )


def test_tongyi_qianwen_platform_includes_qwen_models():
    result = get_model_type_suggestions("tongyi-qianwen")
    assert "qwen-turbo" in result


def test_tongyi_qianwen_platform_excludes_non_qwen_models():
    result = get_model_type_suggestions("tongyi-qianwen")
    assert "gpt-4o" not in result
    assert "grok-3" not in result
    assert "glm-4.7" not in result


def test_tongyi_qianwen_case_insensitive():
    assert get_model_type_suggestions(
        "TONGYI-QIANWEN"
    ) == get_model_type_suggestions("tongyi-qianwen")


def test_tongyi_qianwen_filtered_result_is_subset_of_all():
    all_models = set(get_model_type_suggestions(None))
    assert set(get_model_type_suggestions("tongyi-qianwen")).issubset(
        all_models
    )


# --- modelark ---


def test_model_prefixes_contains_modelark():
    assert "modelark" in MODEL_PREFIXES
    assert MODEL_PREFIXES["modelark"] != [], (
        "modelark should have non-empty prefix list"
    )


def test_modelark_platform_includes_doubao_models():
    result = get_model_type_suggestions("modelark")
    assert "doubao/Doubao-1.5-pro" in result


def test_modelark_platform_includes_yi_models():
    result = get_model_type_suggestions("modelark")
    assert "yi-large" in result


def test_modelark_platform_includes_llm_research_models():
    result = get_model_type_suggestions("modelark")
    assert "LLM-Research/Llama-3.3-70B-Instruct" in result


def test_modelark_platform_includes_paddlepaddle_models():
    result = get_model_type_suggestions("modelark")
    assert "PaddlePaddle/ERNIE-4.5-VL-28B-A3B-Thinking" in result


def test_modelark_platform_excludes_non_ark_models():
    result = get_model_type_suggestions("modelark")
    assert "gpt-4o" not in result
    assert "claude-3-opus" not in result
    assert "grok-3" not in result


def test_modelark_case_insensitive():
    assert get_model_type_suggestions(
        "MODELARK"
    ) == get_model_type_suggestions("modelark")


def test_modelark_filtered_result_is_subset_of_all():
    all_models = set(get_model_type_suggestions(None))
    assert set(get_model_type_suggestions("modelark")).issubset(all_models)


# ===========================================================================
# Integration tests — real CAMEL ModelType, no mocking.
# Verifies MODEL_PREFIXES stays aligned with actual CAMEL model names.
# If a test fails after a CAMEL upgrade, update MODEL_PREFIXES accordingly.
# ===========================================================================


# --- sanity ---


@pytest.mark.integration
@pytest.mark.parametrize(
    "platform",
    [
        "openai",
        "anthropic",
        "gemini",
        "deepseek",
        "tongyi-qianwen",
        "minimax",
        "moonshot",
        "azure",
        "grok",
        "mistral",
        "samba-nova",
        "z.ai",
        "modelark",
    ],
)
def test_integration_each_platform_returns_at_least_one_model(platform):
    assert len(get_model_type_suggestions(platform)) > 0


@pytest.mark.integration
@pytest.mark.parametrize(
    "platform",
    [
        "openai",
        "anthropic",
        "gemini",
        "deepseek",
        "tongyi-qianwen",
        "minimax",
        "moonshot",
        "azure",
        "grok",
        "mistral",
        "samba-nova",
        "z.ai",
        "modelark",
    ],
)
def test_integration_filtered_results_are_subsets_of_all(platform):
    all_models = set(get_model_type_suggestions(None))
    assert set(get_model_type_suggestions(platform)).issubset(all_models)


@pytest.mark.integration
@pytest.mark.parametrize(
    "platform",
    ["openai-compatible-model", "openrouter", "ollama", "vllm", "bedrock"],
)
def test_integration_open_platforms_return_all_models(platform):
    assert set(get_model_type_suggestions(platform)) == set(
        get_model_type_suggestions(None)
    )


# --- openai ---


@pytest.mark.integration
def test_integration_openai_includes_gpt_and_o_series():
    result = set(get_model_type_suggestions("openai"))
    assert "gpt-4o" in result
    assert "gpt-4o-mini" in result
    assert "chatgpt-4o-latest" in result
    assert "o1" in result
    assert "o3" in result
    assert "o3-mini" in result


@pytest.mark.integration
def test_integration_openai_excludes_other_platforms():
    result = set(get_model_type_suggestions("openai"))
    assert "claude-opus-4-6" not in result
    assert "gemini-2.5-pro" not in result
    assert "grok-3" not in result


# --- anthropic ---


@pytest.mark.integration
def test_integration_anthropic_includes_claude_models():
    result = set(get_model_type_suggestions("anthropic"))
    assert "claude-opus-4-6" in result
    assert "claude-3-5-haiku-latest" in result
    assert "claude-sonnet-4-5" in result


@pytest.mark.integration
def test_integration_anthropic_excludes_other_platforms():
    result = set(get_model_type_suggestions("anthropic"))
    assert "gpt-4o" not in result
    assert "grok-3" not in result


# --- gemini ---


@pytest.mark.integration
def test_integration_gemini_includes_gemini_models():
    result = set(get_model_type_suggestions("gemini"))
    assert "gemini-2.5-pro" in result
    assert "gemini-2.0-flash" in result


@pytest.mark.integration
def test_integration_gemini_excludes_other_platforms():
    result = set(get_model_type_suggestions("gemini"))
    assert "gpt-4o" not in result
    assert "claude-opus-4-6" not in result


# --- deepseek ---


@pytest.mark.integration
def test_integration_deepseek_includes_deepseek_models():
    result = set(get_model_type_suggestions("deepseek"))
    assert "deepseek-chat" in result
    assert "deepseek-r1" in result


@pytest.mark.integration
def test_integration_deepseek_excludes_other_platforms():
    result = set(get_model_type_suggestions("deepseek"))
    assert "gpt-4o" not in result
    assert "grok-3" not in result


# --- qwen ---


@pytest.mark.integration
def test_integration_qwen_includes_qwen_models():
    result = set(get_model_type_suggestions("tongyi-qianwen"))
    assert "qwen-turbo" in result
    assert "qwen-max" in result


@pytest.mark.integration
def test_integration_qwen_excludes_other_platforms():
    result = set(get_model_type_suggestions("tongyi-qianwen"))
    assert "gpt-4o" not in result
    assert "grok-3" not in result


# --- minimax ---


@pytest.mark.integration
def test_integration_minimax_includes_minimax_models():
    result = set(get_model_type_suggestions("minimax"))
    assert "MiniMax-M2" in result
    assert "MiniMax-M2.5" in result


@pytest.mark.integration
def test_integration_minimax_excludes_other_platforms():
    result = set(get_model_type_suggestions("minimax"))
    assert "gpt-4o" not in result
    assert "grok-3" not in result


# --- moonshot ---


@pytest.mark.integration
def test_integration_moonshot_includes_moonshot_and_kimi_models():
    result = set(get_model_type_suggestions("moonshot"))
    assert "moonshot-v1-8k" in result
    assert "moonshot-v1-128k" in result
    assert "kimi-k2-turbo-preview" in result


@pytest.mark.integration
def test_integration_moonshot_excludes_other_platforms():
    result = set(get_model_type_suggestions("moonshot"))
    assert "gpt-4o" not in result
    assert "grok-3" not in result


# --- grok ---


@pytest.mark.integration
def test_integration_grok_includes_all_grok_models():
    result = set(get_model_type_suggestions("grok"))
    assert "grok-4-0709" in result
    assert "grok-3" in result
    assert "grok-3-mini" in result
    assert "grok-2-image-1212" in result


@pytest.mark.integration
def test_integration_grok_excludes_other_platforms():
    result = set(get_model_type_suggestions("grok"))
    assert "gpt-4o" not in result
    assert "claude-opus-4-6" not in result
    assert "mistral-large-latest" not in result
    assert "llama3.3-70b" not in result


# --- mistral ---


@pytest.mark.integration
def test_integration_mistral_includes_all_naming_variants():
    result = set(get_model_type_suggestions("mistral"))
    assert "mistral-large-latest" in result  # mistral- prefix
    assert "open-mistral-7b" in result  # open-mistral- prefix
    assert "open-mixtral-8x7b" in result  # open-mixtral- prefix
    assert "mistralai/Mistral-7B-Instruct-v0.3" in result  # mistralai/ prefix


@pytest.mark.integration
def test_integration_mistral_excludes_other_platforms():
    result = set(get_model_type_suggestions("mistral"))
    assert "gpt-4o" not in result
    assert "claude-opus-4-6" not in result
    assert "grok-3" not in result
    assert "llama3.3-70b" not in result


# --- samba-nova ---


@pytest.mark.integration
def test_integration_samba_nova_includes_llama3_and_meta_llama_models():
    result = set(get_model_type_suggestions("samba-nova"))
    assert "llama3.1-8b" in result
    assert "llama3.3-70b" in result
    assert "Meta-Llama-3.1-8B-Instruct" in result
    assert "Meta-Llama-3.1-405B-Instruct" in result


@pytest.mark.integration
def test_integration_samba_nova_excludes_other_platforms():
    result = set(get_model_type_suggestions("samba-nova"))
    assert "gpt-4o" not in result
    assert "claude-opus-4-6" not in result
    assert "grok-3" not in result
    assert "mistral-large-latest" not in result


# --- z.ai ---


@pytest.mark.integration
def test_integration_zai_includes_glm_and_zai_org_models():
    result = set(get_model_type_suggestions("z.ai"))
    assert "glm-4.7" in result
    assert "glm-5" in result
    assert "zai-org/glm-4.7" in result


@pytest.mark.integration
def test_integration_zai_excludes_other_platforms():
    result = set(get_model_type_suggestions("z.ai"))
    assert "gpt-4o" not in result
    assert "claude-opus-4-6" not in result
    assert "grok-3" not in result
    assert "mistral-large-latest" not in result


# --- tongyi-qianwen (Qwen) ---


@pytest.mark.integration
def test_integration_tongyi_qianwen_includes_qwen_models():
    result = set(get_model_type_suggestions("tongyi-qianwen"))
    assert "qwen-turbo" in result
    assert "qwen-max" in result
    assert "qwen-plus" in result


@pytest.mark.integration
def test_integration_tongyi_qianwen_excludes_other_platforms():
    result = set(get_model_type_suggestions("tongyi-qianwen"))
    assert "gpt-4o" not in result
    assert "grok-3" not in result
    assert "glm-4.7" not in result


# --- modelark ---


@pytest.mark.integration
def test_integration_modelark_includes_doubao_and_yi_models():
    result = set(get_model_type_suggestions("modelark"))
    assert "doubao/Doubao-1.5-pro" in result
    assert "yi-large" in result
    assert "LLM-Research/Llama-3.3-70B-Instruct" in result
    assert "PaddlePaddle/ERNIE-4.5-VL-28B-A3B-Thinking" in result


@pytest.mark.integration
def test_integration_modelark_excludes_other_platforms():
    result = set(get_model_type_suggestions("modelark"))
    assert "gpt-4o" not in result
    assert "claude-opus-4-6" not in result
    assert "grok-3" not in result
    assert "glm-4.7" not in result
