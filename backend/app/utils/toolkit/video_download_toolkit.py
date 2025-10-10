import os
from typing import List
from PIL.Image import Image
from camel.toolkits import VideoDownloaderToolkit as BaseVideoDownloaderToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseVideoDownloaderToolkit)
class VideoDownloaderToolkit(BaseVideoDownloaderToolkit, AbstractToolkit):
    agent_name: str = Agents.multi_modal_agent

    def __init__(
        self,
        api_task_id: str,
        working_directory: str | None = None,
        cookies_path: str | None = None,
        timeout: float | None = None,
    ) -> None:
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(working_directory, cookies_path, timeout)
        self.api_task_id = api_task_id
