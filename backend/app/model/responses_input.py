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

"""Instance-scoped message adaptation for CAMEL's Responses transports."""

from inspect import isawaitable
from typing import Any


def _check_response_event(event: Any) -> None:
    # The SDK preserves flat ResponseErrorEvent objects, but CAMEL's pinned
    # chunk converter ignores them and may synthesize a successful stop.
    if getattr(event, "type", None) == "error":
        raise RuntimeError(f"Responses API stream error: {event.message}")


def _checked_response_stream(stream):
    with stream:
        for event in stream:
            _check_response_event(event)
            yield event


async def _checked_async_response_stream(stream):
    async with stream:
        async for event in stream:
            _check_response_event(event)
            yield event


async def _await_checked_response_stream(response):
    return _checked_async_response_stream(await response)


class _ResponsesResource:
    def __init__(self, resource):
        self._resource = resource

    def __getattr__(self, name):
        return getattr(self._resource, name)

    def create(self, *args, **kwargs):
        response = self._resource.create(*args, **kwargs)
        if not kwargs.get("stream"):
            return response
        if isawaitable(response):
            return _await_checked_response_stream(response)
        return _checked_response_stream(response)


class _ResponsesClient:
    """Expose a guarded Responses resource without mutating a shared SDK client."""

    def __init__(self, client):
        self._client = client
        self.responses = _ResponsesResource(client.responses)

    def __getattr__(self, name):
        return getattr(self._client, name)


def _content_part(part: Any) -> Any:
    if not isinstance(part, dict):
        return part
    if part.get("type") == "text":
        return {**part, "type": "input_text"}
    if part.get("type") == "image_url":
        image_url = part.get("image_url")
        converted = {**part, "type": "input_image"}
        if isinstance(image_url, dict):
            converted["image_url"] = image_url.get("url")
            if "detail" in image_url:
                # Preserve newer native detail levels too. Serialization
                # must not decide which values a model supports.
                converted["detail"] = image_url["detail"]
        return converted
    return part


def normalize_responses_content(item: dict[str, Any]) -> dict[str, Any]:
    """Convert only message text/image parts; native tool items are opaque."""
    if (
        item.get("type", "message") != "message"
        or item.get("role") not in {"user", "assistant", "system", "developer"}
        or not isinstance(item.get("content"), list)
    ):
        return item
    return {
        **item,
        "content": [_content_part(part) for part in item["content"]],
    }


def configure_responses_input(model_backend: Any) -> None:
    """Adapt one backend without modifying CAMEL classes or transport config.

    OpenAIModel, AzureOpenAIModel (which inherits it), and
    OpenAICompatibleModel call this converter after selecting a chain delta
    in every sync/async, streaming/non-streaming Responses entry point.
    Keep their distinct chaining and request configuration implementations.
    """
    if getattr(model_backend, "_api_mode", None) != "responses" or getattr(
        model_backend, "_eigent_responses_input_configured", False
    ):
        return
    convert = getattr(
        model_backend, "_convert_messages_to_responses_input", None
    )
    if not callable(convert):
        return

    def convert_messages(messages):
        items = []
        for message in messages:
            if "type" in message:
                # CAMEL's Chat converter drops native item fields (including
                # call_id, output, status, id, encrypted_content). Typed
                # Responses items must bypass that lossy conversion.
                items.append(normalize_responses_content(message))
            else:
                items.extend(
                    normalize_responses_content(item)
                    for item in convert([message])
                )
        return items

    model_backend._convert_messages_to_responses_input = convert_messages  # noqa: SLF001
    # Guard raw SDK events before CAMEL converts them to Chat chunks. Delegate
    # requests unchanged; the original clients/resources may be shared by
    # other backends and must remain untouched.
    for attribute in ("_client", "_async_client"):
        client = getattr(model_backend, attribute, None)
        if client is not None and not isinstance(client, _ResponsesClient):
            setattr(model_backend, attribute, _ResponsesClient(client))
    model_backend._eigent_responses_input_configured = True  # noqa: SLF001
