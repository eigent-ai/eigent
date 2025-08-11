import os
from camel.toolkits import ScreenshotToolkit as BaseScreenshotToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class ScreenshotToolkit(BaseScreenshotToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent

    def __init__(self, api_task_id, working_directory: str | None = None, timeout: float | None = None):
        self.api_task_id = api_task_id
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(working_directory, timeout)

    @listen_toolkit(BaseScreenshotToolkit.take_screenshot_and_read_image)
    def take_screenshot_and_read_image(
        self, filename: str, save_to_file: bool = True, read_image: bool = True, instruction: str | None = None
    ) -> str:
        return super().take_screenshot_and_read_image(filename, save_to_file, read_image, instruction)

    @listen_toolkit(BaseScreenshotToolkit.read_image)
    def read_image(self, image_path: str, instruction: str = "") -> str:
        return super().read_image(image_path, instruction)
