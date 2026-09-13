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

from app.model import responses_runtime


def test_responses_multimodal_content_is_normalized():
    input_items = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe this prototype"},
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

    normalized = responses_runtime.normalize_responses_multimodal_content(
        input_items
    )

    assert normalized == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "describe this prototype"},
                {
                    "type": "input_image",
                    "image_url": "data:image/png;base64,abc",
                    "detail": "high",
                },
            ],
        },
        {"type": "function_call_output", "call_id": "call_1", "output": "ok"},
    ]


def test_installs_camel_responses_multimodal_patch():
    from camel.models.openai_compatible_model import OpenAICompatibleModel
    from camel.models.openai_model import OpenAIModel

    responses_runtime.install_camel_responses_multimodal_patch()

    messages = [
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
    expected = [
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

    converted_openai = OpenAIModel._convert_messages_to_responses_input(
        messages
    )
    converted_compatible = (
        OpenAICompatibleModel._convert_messages_to_responses_input(messages)
    )
    assert converted_openai == expected
    assert converted_compatible == expected
