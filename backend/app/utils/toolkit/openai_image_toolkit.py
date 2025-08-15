import os
from camel.toolkits import OpenAIImageToolkit as BaseOpenAIImageToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from typing import Literal


class OpenAIImageToolkit(BaseOpenAIImageToolkit, AbstractToolkit):
    agent_name: str = Agents.multi_modal_agent

    def __init__(
        self,
        api_task_id: str,
        model: None | Literal["gpt-image-1"] | Literal["dall-e-3"] | Literal["dall-e-2"] = "gpt-image-1",
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
        response_format: None | Literal["url"] | Literal["b64_json"] = "b64_json",
        background: None | Literal["transparent"] | Literal["opaque"] | Literal["auto"] = "auto",
        style: None | Literal["vivid"] | Literal["natural"] = None,
        working_directory: str | None = None,
    ):
        self.api_task_id = api_task_id
        super().__init__(
            model, timeout, api_key, url, size, quality, response_format, background, style, working_directory
        )

    @listen_toolkit(BaseOpenAIImageToolkit.generate_image)
    def generate_image(self, prompt: str, image_name: str = "image") -> str:
        return super().generate_image(prompt, image_name)

    def _build_base_params(self, prompt: str) -> dict:
        params = super()._build_base_params(prompt)
        params["user"] = self.api_task_id  # support cloud key billing
        return params
