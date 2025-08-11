import os
from camel.models import BaseModelBackend
from camel.toolkits import VideoAnalysisToolkit as BaseVideoAnalysisToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


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

    @listen_toolkit(
        BaseVideoAnalysisToolkit.ask_question_about_video,
        lambda _, video_path, question: f"transcribe video from {video_path} and ask question: {question}",
    )
    def ask_question_about_video(self, video_path: str, question: str) -> str:
        return super().ask_question_about_video(video_path, question)
