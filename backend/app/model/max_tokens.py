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

"""Shared ``max_tokens`` normalization for the runtime and validation paths.

Anthropic requires ``max_tokens`` to be an int. In practice it reaches us as a
string whenever it originates from an environment variable or a settings blob
that was stored as JSON, and the CAMEL model constructor then rejects it with a
raw pydantic validation error.

Both consumers need the same treatment:

* the runtime agent factory, in :mod:`app.agent.agent_model`
* the model settings validation flow, in :mod:`app.component.model_validation`

Keeping one implementation here stops the two paths from drifting apart, which
is what allowed the validation flow to keep failing after the runtime path had
been fixed.

Invalid values are reported rather than replaced. The usable output-token limit
differs between Anthropic models, so silently substituting a large constant
turns a clear configuration error into a truncation bug that surfaces much later
and far from its cause. Callers decide what to do: the validation flow surfaces
the error to the user, and the runtime path logs it and falls back to a
deliberately conservative value.
"""

from __future__ import annotations

from typing import Any, Final

#: Fallback used only when a caller supplies an unusable value. Deliberately
#: small: every current Anthropic model supports at least this many output
#: tokens, so falling back can truncate a response but cannot itself 4xx.
DEFAULT_ANTHROPIC_MAX_TOKENS: Final = 4096


class InvalidMaxTokensError(ValueError):
    """Raised when a supplied ``max_tokens`` is not a usable positive integer."""


def normalize_max_tokens(value: Any) -> int | None:
    """Interpret a user-supplied ``max_tokens`` as a positive integer.

    Accepts ints and integral floats, and strings holding either (``"4096"``).
    A blank string is treated as absent, because form fields and environment
    variables routinely arrive empty.

    Args:
        value: The raw value, of any type.

    Returns:
        The value as an ``int``, or ``None`` when it is absent or blank.

    Raises:
        InvalidMaxTokensError: If the value is present but cannot be read as a
            positive integer. The message names the offending value so it can
            be shown to the user directly.
    """
    if value is None:
        return None

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            value = int(stripped)
        except ValueError:
            raise InvalidMaxTokensError(
                f"max_tokens must be a whole number, got {value!r}."
            ) from None
    elif isinstance(value, bool):
        # bool is an int subclass; True would otherwise coerce to 1 token.
        raise InvalidMaxTokensError(
            f"max_tokens must be a whole number, got {value!r}."
        )
    elif isinstance(value, float):
        if not value.is_integer():
            raise InvalidMaxTokensError(
                f"max_tokens must be a whole number, got {value!r}."
            )
        value = int(value)
    elif not isinstance(value, int):
        raise InvalidMaxTokensError(
            f"max_tokens must be a whole number, got {value!r}."
        )

    if value <= 0:
        raise InvalidMaxTokensError(
            f"max_tokens must be greater than 0, got {value!r}."
        )
    return value


def ensure_anthropic_max_tokens(
    model_config: dict[str, Any] | None,
) -> dict[str, Any]:
    """Apply the Anthropic ``max_tokens`` requirement to a model config.

    Coerces ``max_tokens`` to ``int`` when present, and supplies
    :data:`DEFAULT_ANTHROPIC_MAX_TOKENS` when it is absent. Anthropic has no
    default output limit of its own, so leaving it unset fails the request.

    Args:
        model_config: The model config to normalize. ``None`` is accepted.

    Returns:
        A new dict, normalized. The input is not mutated.

    Raises:
        InvalidMaxTokensError: If ``max_tokens`` is present but unusable.
    """
    normalized = dict(model_config or {})
    value = normalize_max_tokens(normalized.get("max_tokens"))
    normalized["max_tokens"] = (
        value if value is not None else DEFAULT_ANTHROPIC_MAX_TOKENS
    )
    return normalized
