import os
from camel.models import BaseModelBackend
from camel.toolkits import VideoAnalysisToolkit as BaseVideoAnalysisToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseVideoAnalysisToolkit)
class VideoAnalysisToolkit(BaseVideoAnalysisToolkit, AbstractToolkit):
    agent_name: str = Agents.multi_modal_agent

    def __init__(
        self,
        api_task_id: str,
        working_directory: str | None = None,
        model: BaseModelBackend | None = None,
        use_audio_transcription: bool = False,
        use_ocr: bool = False,
        frame_interval: float = 4,
        output_language: str = "English",
        cookies_path: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(
            working_directory,
            model,
            use_audio_transcription,
            use_ocr,
            frame_interval,
            output_language,
            cookies_path,
            timeout,
        )
