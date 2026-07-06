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

import pytest

from app.model.chat import Chat
from app.model.subscription_runtime import codex


def test_codex_subscription_runtime_is_noop_for_legacy_model(
    sample_chat_data,
):
    chat = Chat(**sample_chat_data)
    effective_config = {
        "model_platform": "openai",
        "model_type": "gpt-4.1",
        "api_key": "legacy-key",
        "api_url": "https://example.test/v1",
    }
    extra_params = {"temperature": 0}

    updated_config, updated_extra = codex.apply_codex_subscription_runtime(
        chat, effective_config, extra_params
    )

    assert updated_config is effective_config
    assert updated_extra is extra_params


def test_codex_subscription_runtime_resolves_local_token(
    monkeypatch,
    sample_chat_data,
):
    chat = Chat(
        **{
            **sample_chat_data,
            "api_key": "",
            "api_url": "",
            "auth_source": "codex_subscription",
        }
    )
    monkeypatch.setenv("CODEX_RESOLVER_URL", "http://127.0.0.1:12345")
    monkeypatch.setenv("CODEX_RESOLVER_SECRET", "resolver-secret")
    monkeypatch.setenv("CODEX_MODEL_API_URL", "https://codex.example/v1")
    monkeypatch.setenv(
        "CODEX_MODEL_DEFAULT_HEADERS_JSON",
        '{"x-provider-feature": "codex"}',
    )

    class Response:
        status_code = 200

        def json(self):
            return {
                "access_token": "fresh-local-token",
                "token_type": "Bearer",
                "status": "connected",
            }

    def fake_post(url, headers, json, timeout):
        assert url == "http://127.0.0.1:12345/codex/token"
        assert headers == {"x-eigent-resolver-secret": "resolver-secret"}
        assert json == {"email": chat.email, "force_refresh": False}
        assert timeout == 5.0
        return Response()

    monkeypatch.setattr(codex.httpx, "post", fake_post)

    updated_config, updated_extra = codex.apply_codex_subscription_runtime(
        chat,
        {
            "model_platform": "openai",
            "model_type": "gpt-4.1",
            "api_key": "",
            "api_url": "",
        },
        {"temperature": 0, "stream": False, "store": True},
    )

    assert updated_config["api_key"] == "fresh-local-token"
    assert updated_config["api_url"] == "https://codex.example/v1"
    assert updated_extra["temperature"] == 0
    assert updated_extra["api_mode"] == "responses"
    assert updated_extra["stream"] is True
    assert updated_extra["store"] is False
    assert updated_extra["default_headers"] == {
        "User-Agent": "codex_cli_rs/0.0.0 (Eigent)",
        "originator": "codex_cli_rs",
        "x-provider-feature": "codex",
    }


def test_codex_subscription_runtime_can_force_refresh(
    monkeypatch,
    sample_chat_data,
):
    chat = Chat(
        **{
            **sample_chat_data,
            "api_key": "",
            "auth_source": "codex_subscription",
        }
    )
    monkeypatch.setenv("CODEX_RESOLVER_URL", "http://127.0.0.1:12345")
    monkeypatch.setenv("CODEX_RESOLVER_SECRET", "resolver-secret")

    class Response:
        status_code = 200

        def json(self):
            return {
                "access_token": "refreshed-local-token",
                "token_type": "Bearer",
                "status": "connected",
            }

    def fake_post(url, headers, json, timeout):
        assert json == {"email": chat.email, "force_refresh": True}
        return Response()

    monkeypatch.setattr(codex.httpx, "post", fake_post)

    updated_config, _updated_extra = codex.apply_codex_subscription_runtime(
        chat,
        {
            "model_platform": "openai",
            "model_type": "gpt-4.1",
            "api_key": "",
            "api_url": "",
        },
        {},
        force_refresh=True,
    )

    assert updated_config["api_key"] == "refreshed-local-token"


def test_codex_subscription_runtime_defaults_to_chatgpt_backend_and_account_header(
    monkeypatch,
    sample_chat_data,
):
    chat = Chat(
        **{
            **sample_chat_data,
            "api_key": "",
            "api_url": "",
            "auth_source": "codex_subscription",
        }
    )
    monkeypatch.setenv("CODEX_RESOLVER_URL", "http://127.0.0.1:12345")
    monkeypatch.setenv("CODEX_RESOLVER_SECRET", "resolver-secret")
    monkeypatch.delenv("CODEX_MODEL_API_URL", raising=False)
    monkeypatch.delenv("CODEX_MODEL_DEFAULT_HEADERS_JSON", raising=False)

    token = (
        "h."
        "eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOns"
        "iY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdF8xMjMifX0"
        ".s"
    )

    class Response:
        status_code = 200

        def json(self):
            return {
                "access_token": token,
                "token_type": "Bearer",
                "status": "connected",
            }

    monkeypatch.setattr(
        codex.httpx, "post", lambda *args, **kwargs: Response()
    )

    updated_config, updated_extra = codex.apply_codex_subscription_runtime(
        chat,
        {
            "model_platform": "openai",
            "model_type": "gpt-4.1",
            "api_key": "",
            "api_url": "",
        },
        {},
    )

    assert updated_config["api_url"] == "https://chatgpt.com/backend-api/codex"
    assert updated_extra["api_mode"] == "responses"
    assert updated_extra["stream"] is True
    assert updated_extra["store"] is False
    assert updated_extra["default_headers"] == {
        "User-Agent": "codex_cli_rs/0.0.0 (Eigent)",
        "originator": "codex_cli_rs",
        "ChatGPT-Account-ID": "acct_123",
    }


def test_codex_responses_multimodal_content_is_normalized():
    input_items = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "verify this chart"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,abc",
                        "detail": "high",
                    },
                },
            ],
        },
        {"type": "function_call_output", "call_id": "call_1", "output": "ok"},
    ]

    normalized = codex._normalize_responses_multimodal_content(input_items)

    assert normalized == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "verify this chart"},
                {
                    "type": "input_image",
                    "image_url": "data:image/png;base64,abc",
                    "detail": "high",
                },
            ],
        },
        {"type": "function_call_output", "call_id": "call_1", "output": "ok"},
    ]


def test_codex_installs_camel_responses_multimodal_patch():
    from camel.models.openai_model import OpenAIModel

    codex._install_camel_responses_multimodal_patch()

    converted = OpenAIModel._convert_messages_to_responses_input(
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "what is in this image?"},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/png;base64,abc",
                            "detail": "auto",
                        },
                    },
                ],
            }
        ]
    )

    assert converted == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "what is in this image?"},
                {
                    "type": "input_image",
                    "image_url": "data:image/png;base64,abc",
                    "detail": "auto",
                },
            ],
        }
    ]


def test_codex_subscription_runtime_requires_resolver_env(
    monkeypatch,
    sample_chat_data,
):
    chat = Chat(
        **{
            **sample_chat_data,
            "api_key": "",
            "auth_source": "codex_subscription",
        }
    )
    monkeypatch.delenv("CODEX_RESOLVER_URL", raising=False)
    monkeypatch.delenv("CODEX_RESOLVER_SECRET", raising=False)

    with pytest.raises(codex.CodexSubscriptionAuthError) as exc_info:
        codex.apply_codex_subscription_runtime(
            chat,
            {
                "model_platform": "openai",
                "model_type": "gpt-4.1",
                "api_key": "",
                "api_url": "",
            },
            {},
        )

    assert "fresh-local-token" not in str(exc_info.value)
    assert "resolver is not available" in str(exc_info.value)
