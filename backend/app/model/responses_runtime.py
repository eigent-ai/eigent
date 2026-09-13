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

from typing import Any

_CAMEL_RESPONSES_MULTIMODAL_PATCHED = False


def to_responses_content_part(part: Any) -> Any:
    """Rewrite chat-completions content parts for the Responses API."""
    if not isinstance(part, dict):
        return part

    part_type = part.get("type")
    if part_type == "text":
        return {
            **part,
            "type": "input_text",
        }
    if part_type == "image_url":
        image_url = part.get("image_url")
        if isinstance(image_url, dict):
            converted = {
                "type": "input_image",
                "image_url": image_url.get("url"),
            }
            detail = image_url.get("detail")
            if detail in {"low", "high", "auto"}:
                converted["detail"] = detail
            return converted
        return {
            "type": "input_image",
            "image_url": image_url,
        }

    return part


def normalize_responses_multimodal_content(
    input_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convert chat-completions image/text parts to Responses input types.

    CAMEL's Responses converter copies list content as-is. Azure and LiteLLM
    then reject ``type: "text"`` / ``type: "image_url"`` on
    ``input[].content[].type``.
    """
    normalized_items: list[dict[str, Any]] = []
    for item in input_items:
        if not isinstance(item, dict):
            normalized_items.append(item)
            continue

        content = item.get("content")
        if not isinstance(content, list):
            normalized_items.append(item)
            continue

        normalized_items.append(
            {
                **item,
                "content": [
                    to_responses_content_part(part) for part in content
                ],
            }
        )

    return normalized_items


def install_camel_responses_multimodal_patch() -> None:
    """Patch CAMEL Responses converters so image inspection can run."""
    global _CAMEL_RESPONSES_MULTIMODAL_PATCHED
    if _CAMEL_RESPONSES_MULTIMODAL_PATCHED:
        return

    from camel.models.openai_compatible_model import OpenAICompatibleModel
    from camel.models.openai_model import OpenAIModel

    for model_class in (OpenAIModel, OpenAICompatibleModel):
        original_converter = model_class._convert_messages_to_responses_input

        def patched_converter(
            messages,
            _original_converter=original_converter,
        ):
            return normalize_responses_multimodal_content(
                _original_converter(messages)
            )

        model_class._convert_messages_to_responses_input = staticmethod(
            patched_converter
        )

    _CAMEL_RESPONSES_MULTIMODAL_PATCHED = True
