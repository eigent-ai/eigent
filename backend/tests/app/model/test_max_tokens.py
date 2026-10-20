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

"""Regression tests for ``max_tokens`` normalization on Anthropic models.

Anthropic requires ``max_tokens`` to be an int. It reaches the backend as a
string whenever it comes from an environment variable or a stored settings blob,
which made the CAMEL constructor raise a raw pydantic validation error.

The bug had two halves. The runtime agent factory and the model settings
validation flow each applied their own ``max_tokens`` handling, so fixing one
left the other failing. These tests pin both paths, and pin the policy split
between them: the validation flow reports a bad value to the user, the runtime
path falls back conservatively.
"""

import sys
from unittest.mock import MagicMock, patch

import pytest

from app.model.max_tokens import (
    DEFAULT_ANTHROPIC_MAX_TOKENS,
    InvalidMaxTokensError,
    ensure_anthropic_max_tokens,
    normalize_max_tokens,
)

pytestmark = pytest.mark.unit


class TestNormalizeMaxTokens:
    """The shared coercion helper."""

    @pytest.mark.parametrize(
        "value,expected",
        [
            (4096, 4096),
            ("4096", 4096),
            ("  4096  ", 4096),
            (4096.0, 4096),
            (1, 1),
        ],
    )
    def test_accepts_usable_values(self, value, expected):
        assert normalize_max_tokens(value) == expected

    @pytest.mark.parametrize("value", [None, "", "   "])
    def test_absent_and_blank_are_absent(self, value):
        assert normalize_max_tokens(value) is None

    @pytest.mark.parametrize(
        "value",
        [
            "abc",
            "4096.5",
            "-1",
            "0",
            0,
            -4096,
            4096.5,
            True,
            False,
            [],
            {},
            object(),
        ],
    )
    def test_rejects_unusable_values(self, value):
        with pytest.raises(InvalidMaxTokensError):
            normalize_max_tokens(value)

    def test_error_message_names_the_field(self):
        """The message is shown to the user, so it must identify the field."""
        with pytest.raises(InvalidMaxTokensError) as excinfo:
            normalize_max_tokens("not-a-number")
        assert "max_tokens" in str(excinfo.value)
        assert "not-a-number" in str(excinfo.value)


class TestEnsureAnthropicMaxTokens:
    """The shared config-level helper."""

    def test_supplies_default_when_absent(self):
        assert ensure_anthropic_max_tokens({})["max_tokens"] == (
            DEFAULT_ANTHROPIC_MAX_TOKENS
        )

    def test_accepts_none_config(self):
        assert ensure_anthropic_max_tokens(None)["max_tokens"] == (
            DEFAULT_ANTHROPIC_MAX_TOKENS
        )

    def test_coerces_string_to_int(self):
        result = ensure_anthropic_max_tokens({"max_tokens": "8192"})
        assert result["max_tokens"] == 8192
        assert isinstance(result["max_tokens"], int)

    def test_preserves_usable_value(self):
        assert ensure_anthropic_max_tokens({"max_tokens": 2048})[
            "max_tokens"
        ] == (2048)

    def test_preserves_other_keys(self):
        result = ensure_anthropic_max_tokens(
            {"temperature": 0.5, "max_tokens": "99"}
        )
        assert result["temperature"] == 0.5
        assert result["max_tokens"] == 99

    def test_does_not_mutate_input(self):
        original = {"max_tokens": "4096"}
        ensure_anthropic_max_tokens(original)
        assert original == {"max_tokens": "4096"}

    def test_raises_on_invalid_value(self):
        with pytest.raises(InvalidMaxTokensError):
            ensure_anthropic_max_tokens({"max_tokens": "banana"})

    def test_default_is_conservative(self):
        """The fallback must not be a large constant.

        Anthropic output limits differ per model, so a large default would turn
        a config mistake into unexplained truncation far from its cause.
        """
        assert DEFAULT_ANTHROPIC_MAX_TOKENS <= 8192


class TestRuntimePath:
    """The agent factory must hand CAMEL an int, and never a large fallback."""

    def _build(self, sample_chat_data, max_tokens):
        from app.agent.agent_model import agent_model
        from app.model.chat import Chat

        data = {
            **sample_chat_data,
            "model_platform": "anthropic",
            "model_type": "claude-sonnet-4-5",
        }
        if max_tokens is not _UNSET:
            data["extra_params"] = {"max_tokens": max_tokens}
        options = Chat(**data)
        lock = MagicMock()
        lock.put_queue = MagicMock(return_value=None)
        module = sys.modules["app.agent.agent_model"]
        with (
            patch.object(module, "ListenChatAgent"),
            patch.object(module, "ModelFactory") as factory,
            patch.object(module, "get_task_lock", return_value=lock),
            patch.object(module, "_schedule_async_task"),
        ):
            agent_model("FixtureAgent", "fixture", options, [])
        return factory.create.call_args.kwargs["model_config_dict"]

    def test_string_max_tokens_reaches_camel_as_int(self, sample_chat_data):
        """The reported bug: a string max_tokens broke the Anthropic model."""
        model_config = self._build(sample_chat_data, "4096")
        assert model_config["max_tokens"] == 4096
        assert isinstance(model_config["max_tokens"], int)

    def test_absent_max_tokens_uses_shared_default(self, sample_chat_data):
        model_config = self._build(sample_chat_data, _UNSET)
        assert model_config["max_tokens"] == DEFAULT_ANTHROPIC_MAX_TOKENS

    def test_invalid_max_tokens_falls_back_conservatively(
        self, sample_chat_data
    ):
        """Runtime must keep working, and must not invent a huge limit."""
        model_config = self._build(sample_chat_data, "banana")
        assert model_config["max_tokens"] == DEFAULT_ANTHROPIC_MAX_TOKENS
        assert model_config["max_tokens"] != 128000

    def test_invalid_max_tokens_is_logged(self, sample_chat_data):
        """A silent fallback is what made this hard to diagnose in the first place."""
        module = sys.modules["app.agent.agent_model"]
        with patch.object(module, "logger") as logger:
            self._build(sample_chat_data, "banana")
        logged = " ".join(str(c) for c in logger.warning.call_args_list)
        assert "max_tokens" in logged

    def test_non_anthropic_platform_is_untouched(self, sample_chat_data):
        """The normalization is Anthropic-specific; other platforms pass through."""
        from app.agent.agent_model import agent_model
        from app.model.chat import Chat

        options = Chat(**{**sample_chat_data, "model_platform": "openai"})
        lock = MagicMock()
        lock.put_queue = MagicMock(return_value=None)
        module = sys.modules["app.agent.agent_model"]
        with (
            patch.object(module, "ListenChatAgent"),
            patch.object(module, "ModelFactory") as factory,
            patch.object(module, "get_task_lock", return_value=lock),
            patch.object(module, "_schedule_async_task"),
        ):
            agent_model("FixtureAgent", "fixture", options, [])
        assert (
            "max_tokens"
            not in factory.create.call_args.kwargs["model_config_dict"]
        )


class TestValidationPath:
    """The settings flow must report problems, not fall back."""

    def test_string_max_tokens_passes_validation(self):
        from app.component.model_validation import validate_model_with_details

        result = validate_model_with_details(
            model_platform="anthropic",
            model_type="claude-sonnet-4-5",
            api_key="test-key",
            model_config_dict={"max_tokens": "4096"},
        )
        assert result.validation_stages["model_creation"] is True

    def test_invalid_max_tokens_reports_configuration_error(self):
        """An invalid value must be named, not replaced behind the user's back."""
        from app.component.model_validation import validate_model_with_details

        result = validate_model_with_details(
            model_platform="anthropic",
            model_type="claude-sonnet-4-5",
            api_key="test-key",
            model_config_dict={"max_tokens": "banana"},
        )
        assert result.validation_stages["model_creation"] is False
        assert result.error_type.value == "invalid_configuration"
        assert result.error_details["field"] == "max_tokens"
        assert "max_tokens" in result.error_message

    def test_invalid_max_tokens_is_not_reported_as_credentials(self):
        """A bad config value must not send the user checking their API key."""
        from app.component.model_validation import validate_model_with_details

        result = validate_model_with_details(
            model_platform="anthropic",
            model_type="claude-sonnet-4-5",
            api_key="test-key",
            model_config_dict={"max_tokens": "banana"},
        )
        assert result.error_type.value not in {
            "invalid_api_key",
            "authentication_error",
        }

    def test_absent_max_tokens_gets_shared_default(self):
        from app.component.model_validation import create_agent

        captured = {}

        def fake_create(**kwargs):
            captured.update(kwargs)
            raise RuntimeError("stop after capture")

        with patch(
            "app.component.model_validation.ModelFactory.create", fake_create
        ):
            with pytest.raises(RuntimeError):
                create_agent(
                    model_platform="anthropic",
                    model_type="claude-sonnet-4-5",
                    api_key="test-key",
                )
        assert captured["model_config_dict"]["max_tokens"] == (
            DEFAULT_ANTHROPIC_MAX_TOKENS
        )

    def test_create_agent_coerces_string_max_tokens(self):
        from app.component.model_validation import create_agent

        captured = {}

        def fake_create(**kwargs):
            captured.update(kwargs)
            raise RuntimeError("stop after capture")

        with patch(
            "app.component.model_validation.ModelFactory.create", fake_create
        ):
            with pytest.raises(RuntimeError):
                create_agent(
                    model_platform="anthropic",
                    model_type="claude-sonnet-4-5",
                    api_key="test-key",
                    model_config_dict={"max_tokens": "8192"},
                )
        assert captured["model_config_dict"]["max_tokens"] == 8192

    def test_create_agent_rejects_invalid_max_tokens(self):
        from app.component.model_validation import create_agent

        with pytest.raises(InvalidMaxTokensError):
            create_agent(
                model_platform="anthropic",
                model_type="claude-sonnet-4-5",
                api_key="test-key",
                model_config_dict={"max_tokens": "banana"},
            )


class _Unset:
    """Sentinel distinguishing "no extra_params" from "max_tokens=None"."""


_UNSET = _Unset()
