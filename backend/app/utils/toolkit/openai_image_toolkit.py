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

from typing import Literal

from camel.toolkits import OpenAIImageToolkit as BaseOpenAIImageToolkit

from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseOpenAIImageToolkit)
class OpenAIImageToolkit(BaseOpenAIImageToolkit, AbstractToolkit):
    agent_name: str = Agents.multi_modal_agent

    def __init__(
        self,
        api_task_id: str,
        model: None
        | Literal["gpt-image-1"]
        | Literal["dall-e-3"]
        | Literal["dall-e-2"] = "gpt-image-1",
        timeout: float | None = None,
        api_key: str | None = None,
        url: str | None = None,
        size: None
        | Literal["256x256"]
        | Literal["512x512"]
        | Literal["1024x1024"]
        | Literal["1536x1024"]
        | Literal["1024x1536"]
        | Literal["1792x1024"]
        | Literal["1024x1792"]
        | Literal["auto"] = "1024x1024",
        quality: None
        | Literal["auto"]
        | Literal["low"]
        | Literal["medium"]
        | Literal["high"]
        | Literal["standard"]
        | Literal["hd"] = "standard",
        response_format: None
        | Literal["url"]
        | Literal["b64_json"] = "b64_json",
        background: None
        | Literal["transparent"]
        | Literal["opaque"]
        | Literal["auto"] = "auto",
        style: None | Literal["vivid"] | Literal["natural"] = None,
        working_directory: str | None = None,
    ):
        self.api_task_id = api_task_id
        super().__init__(
            model,
            timeout,
            api_key,
            url,
            size,
            quality,
            response_format,
            background,
            style,
            working_directory,
        )

    @listen_toolkit(BaseOpenAIImageToolkit.generate_image)
    def generate_image(
        self,
        prompt: str,
        image_name: str | list[str] = "image.png",
        n: int = 1,
    ) -> str:
        # Validate image_name ends with .png
        if isinstance(image_name, str):
            if not image_name.endswith(".png"):
                return (
                    f"Error: Image name must end with .png, got: {image_name}"
                )
        elif isinstance(image_name, list):
            for name in image_name:
                if not name.endswith(".png"):
                    return f"Error: All image names must end with .png, got: {name}"

        return super().generate_image(prompt, image_name, n)

    def _build_base_params(self, prompt: str, n: int | None = None) -> dict:
        params = super()._build_base_params(prompt, n)
        params["user"] = self.api_task_id  # support cloud key billing
        return params
