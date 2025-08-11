import os
from typing import List
from PIL.Image import Image
from camel.toolkits import VideoDownloaderToolkit as BaseVideoDownloaderToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


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

    @listen_toolkit(BaseVideoDownloaderToolkit.download_video)
    def download_video(self, url: str) -> str:
        return super().download_video(url)

    @listen_toolkit(
        BaseVideoDownloaderToolkit.get_video_bytes,
        lambda _, video_path: f"get video bytes from {video_path}",
        lambda _: "get video bytes",
    )
    def get_video_bytes(self, video_path: str) -> bytes:
        return super().get_video_bytes(video_path)

    @listen_toolkit(
        BaseVideoDownloaderToolkit.get_video_screenshots,
        lambda _, video_path, amount: f"get video screenshots from {video_path}, amount: {amount}",
        lambda results: f"get video screenshots {len(results)}",
    )
    def get_video_screenshots(self, video_path: str, amount: int) -> List[Image]:
        return super().get_video_screenshots(video_path, amount)
