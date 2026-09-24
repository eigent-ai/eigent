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

"""Handle an explicit rejection of strict tools by an Anthropic endpoint."""

import json
import logging
import re
from functools import wraps
from typing import Any

from anthropic import BadRequestError
from camel.models.anthropic_model import AnthropicModel

logger = logging.getLogger(__name__)
_STRICT_REJECTION = re.compile(
    r"\btools\.(\d+)\.(?:custom\.)?strict: "
    r"Extra inputs are not permitted\b"
)


def _request_tools(request: dict[str, Any]) -> Any:
    extra_body = request.get("extra_body")
    if isinstance(extra_body, dict) and "tools" in extra_body:
        return extra_body["tools"]
    return request.get("tools")


def _without_tool_strict(request: dict[str, Any]) -> dict[str, Any]:
    """Copy tool declarations, leaving argument schemas and other fields intact."""
    tools = _request_tools(request)
    if not isinstance(tools, list):
        return request
    compatible_tools = [
        {key: value for key, value in tool.items() if key != "strict"}
        if isinstance(tool, dict) and "input_schema" in tool
        else tool
        for tool in tools
    ]
    extra_body = request.get("extra_body")
    if isinstance(extra_body, dict) and "tools" in extra_body:
        return {
            **request,
            "extra_body": {**extra_body, "tools": compatible_tools},
        }
    return {**request, "tools": compatible_tools}


def _rejects_tool_strict(
    error: BadRequestError, request: dict[str, Any]
) -> bool:
    if error.status_code != 400:
        return False
    # LiteLLM can wrap the upstream error JSON inside error.message. Inspect
    # only the SDK's error body, never tool schemas or exception tracebacks.
    body = error.body
    text = body if isinstance(body, str) else json.dumps(body)
    match = _STRICT_REJECTION.search(text)
    tools = _request_tools(request)
    if match is None or not isinstance(tools, list):
        return False
    index = int(match[1])
    return (
        index < len(tools)
        and isinstance(tools[index], dict)
        and "input_schema" in tools[index]
        and "strict" in tools[index]
    )


def configure_anthropic_tool_compatibility(model_backend: Any) -> None:
    """Retry one rejected request without unsupported tool-level strict flags.

    Native Anthropic supports strict tools; some Messages-compatible routes
    reject the field entirely, including strict=false. Learn that limitation
    only from an explicit HTTP 400 before a response/stream is returned. Never
    retry stream iteration, unrelated errors, or structured-output failures.
    The successful downgrade belongs to this model instance, not a global
    model-name cache or a shared SDK client.
    """
    if not isinstance(model_backend, AnthropicModel) or getattr(
        model_backend, "_eigent_anthropic_tools_configured", False
    ):
        return

    omit_strict = False
    original_call = model_backend._call_client
    original_async_call = model_backend._acall_client

    def remember_compatibility() -> None:
        nonlocal omit_strict
        if not omit_strict:
            logger.warning(
                "Anthropic endpoint rejected tool-level strict; continuing "
                "without strict tool constraints for this model instance"
            )
        omit_strict = True

    @wraps(original_call)
    def call_with_compatible_tools(call, *args, **kwargs):
        request = _without_tool_strict(kwargs) if omit_strict else kwargs
        try:
            return original_call(call, *args, **request)
        except BadRequestError as error:
            if not _rejects_tool_strict(error, request):
                raise
        response = original_call(call, *args, **_without_tool_strict(request))
        remember_compatibility()
        return response

    @wraps(original_async_call)
    async def async_call_with_compatible_tools(call, *args, **kwargs):
        request = _without_tool_strict(kwargs) if omit_strict else kwargs
        try:
            return await original_async_call(call, *args, **request)
        except BadRequestError as error:
            if not _rejects_tool_strict(error, request):
                raise
        response = await original_async_call(
            call, *args, **_without_tool_strict(request)
        )
        remember_compatibility()
        return response

    model_backend._call_client = call_with_compatible_tools
    model_backend._acall_client = async_call_with_compatible_tools
    model_backend._eigent_anthropic_tools_configured = True
