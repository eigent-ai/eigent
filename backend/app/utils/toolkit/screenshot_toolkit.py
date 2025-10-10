import os
from camel.toolkits import ScreenshotToolkit as BaseScreenshotToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseScreenshotToolkit)
class ScreenshotToolkit(BaseScreenshotToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent

    def __init__(self, api_task_id, working_directory: str | None = None, timeout: float | None = None):
        self.api_task_id = api_task_id
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(working_directory, timeout)
