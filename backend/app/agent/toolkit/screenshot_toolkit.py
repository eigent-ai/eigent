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

import os
from pathlib import Path

from camel.agents import ChatAgent
from camel.messages import BaseMessage
from camel.toolkits import ScreenshotToolkit as BaseScreenshotToolkit
from PIL import Image

from app.agent.listen_chat_agent import default_step_timeout
from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.run_policy import ToolSafetyClass
from app.run_runtime.tool_checkpoint import (
    ToolInvocationNotDispatchedError,
    declare_tool_safety,
)
from app.utils.listen.toolkit_listen import auto_listen_toolkit


@auto_listen_toolkit(BaseScreenshotToolkit)
class ScreenshotToolkit(BaseScreenshotToolkit, AbstractToolkit):
    agent_name: str

    def __init__(
        self,
        api_task_id,
        agent_name: str,
        working_directory: str | None = None,
        timeout: float | None = None,
        enable_desktop_capture: bool = False,
    ):
        self.api_task_id = api_task_id
        self.agent_name = agent_name
        self.enable_desktop_capture = enable_desktop_capture
        if working_directory is None:
            working_directory = env(
                "file_save_path", os.path.expanduser("~/Downloads")
            )
        super().__init__(working_directory, timeout)

    def read_image(
        self,
        image_path: str,
        instruction: str = "",
    ) -> str:
        """Analyze an image without recursively calling the current agent.

        CAMEL's base ScreenshotToolkit uses `self.agent.step(...)` directly.
        When this toolkit itself is being invoked through a tool call, that
        creates a nested step on the same agent and can corrupt tool-call
        memory (`tool_call_id` mismatch). Use a short-lived vision agent with
        the same model backend instead.
        """
        if self.agent is None:
            raise RuntimeError(
                "Error: No agent registered. Please pass this toolkit to "
                "ChatAgent via toolkits_to_register_agent parameter."
            )

        try:
            image_path = str(Path(image_path).absolute())
            if not os.path.exists(image_path):
                raise FileNotFoundError(
                    f"Screenshot file not found: {image_path}"
                )

            with Image.open(image_path) as source:
                img = source.copy()
                img.format = source.format
            message = BaseMessage.make_user_message(
                role_name="User",
                content=instruction,
                image_list=[img],
            )

            vision_agent = ChatAgent(
                system_message=(
                    "You are a careful visual assistant. Answer only from the "
                    "provided image and user instruction."
                ),
                model=self.agent.model_backend,
                tools=[],
                toolkits_to_register_agent=None,
                external_tools=None,
                # Preserve an explicitly unbounded parent step. Avoid using
                # ``getattr(..., default_step_timeout())`` here because its
                # default expression is evaluated eagerly and can silently
                # reintroduce a cumulative cap for nested image review.
                step_timeout=(
                    self.agent.step_timeout
                    if hasattr(self.agent, "step_timeout")
                    else default_step_timeout()
                ),
            )
            response = vision_agent.step(message)
            # CAMEL can return streaming model exceptions as a terminated
            # response with info.error instead of raising them.
            info = getattr(response, "info", None)
            if isinstance(info, dict) and info.get("error"):
                raise RuntimeError(str(info["error"]))
            messages = getattr(response, "msgs", None)
            message = (
                messages[0] if messages else getattr(response, "msg", None)
            )
            content = getattr(message, "content", None)
            if isinstance(content, str) and content.strip():
                return content
            raise RuntimeError("empty image response")
        except Exception as e:
            raise RuntimeError(f"Error reading screenshot: {e}") from e

    def take_screenshot_and_read_image(
        self,
        filename: str,
        save_to_file: bool = True,
        read_image: bool = True,
        instruction: str | None = None,
    ) -> str:
        if not self.enable_desktop_capture:
            raise ToolInvocationNotDispatchedError(
                "Error: Desktop screenshot capture is disabled for this agent. "
                "Use read_image with an existing image file path instead."
            )

        result = super().take_screenshot_and_read_image(
            filename=filename,
            save_to_file=save_to_file,
            read_image=read_image,
            instruction=instruction,
        )
        # CAMEL catches capture/analysis exceptions and adds this prefix.
        # Its successful result always starts with "Screenshot captured";
        # inspect only this trusted adapter envelope, never model text.
        if result.startswith("Error taking screenshot:"):
            # A file may already have been saved. Do not mark this as a
            # known pre-dispatch failure or weaken the write checkpoint.
            raise RuntimeError(result)
        return result

    def get_tools(self):
        tools = super().get_tools()
        for tool in tools:
            if tool.get_function_name() == "read_image":
                # This specific implementation only reads an existing image.
                # Capture/write tools and unknown tools stay conservative.
                declare_tool_safety(tool, ToolSafetyClass.SAFE_READ)
        if self.enable_desktop_capture:
            return tools

        return [
            tool for tool in tools if tool.get_function_name() == "read_image"
        ]
