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
"""Monkey-patch: strip <think> tags from structured-output responses.

Reasoning models (e.g. DeepSeek R1) may prepend ``<think>…</think>`` blocks
to their output.  The OpenAI SDK's ``beta.chat.completions.parse()`` tries to
JSON-parse the raw content *before* we can touch it, which causes a
``ValidationError``.

Importing this module patches ``OpenAIModel._request_parse`` and
``OpenAIModel._arequest_parse`` so they fall back to a plain completion with
tag-stripping when that happens.
"""

import logging
import re

from camel.models.openai_model import OpenAIModel

logger = logging.getLogger(__name__)

_THINK_RE = re.compile(r"<think>.*?</think>\s*", re.DOTALL)

_orig_request_parse = OpenAIModel._request_parse
_orig_arequest_parse = OpenAIModel._arequest_parse


def _strip(text: str) -> str:
    return _THINK_RE.sub("", text).strip()


def _patched_request_parse(self, messages, response_format, tools=None):
    try:
        return _orig_request_parse(self, messages, response_format, tools)
    except Exception as exc:
        if "<think>" not in str(exc):
            raise
        logger.warning(
            "Structured output parse failed (<think> tags), "
            "retrying with plain completion."
        )
        response = self._request_chat_completion(messages, tools)
        for choice in response.choices:
            if choice.message and choice.message.content:
                choice.message.content = _strip(choice.message.content)
        return response


async def _patched_arequest_parse(self, messages, response_format, tools=None):
    try:
        return await _orig_arequest_parse(
            self, messages, response_format, tools
        )
    except Exception as exc:
        if "<think>" not in str(exc):
            raise
        logger.warning(
            "Structured output parse failed (<think> tags), "
            "retrying with plain completion."
        )
        response = await self._arequest_chat_completion(messages, tools)
        for choice in response.choices:
            if choice.message and choice.message.content:
                choice.message.content = _strip(choice.message.content)
        return response


OpenAIModel._request_parse = _patched_request_parse
OpenAIModel._arequest_parse = _patched_arequest_parse
