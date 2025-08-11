import os
from camel.models import BaseAudioModel, BaseModelBackend
from camel.toolkits import AudioAnalysisToolkit as BaseAudioAnalysisToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class AudioAnalysisToolkit(BaseAudioAnalysisToolkit, AbstractToolkit):
    agent_name: str = Agents.multi_modal_agent

    def __init__(
        self,
        api_task_id: str,
        cache_dir: str | None = None,
        transcribe_model: BaseAudioModel | None = None,
        audio_reasoning_model: BaseModelBackend | None = None,
        timeout: float | None = None,
    ):
        if cache_dir is None:
            cache_dir = env("file_save_path", os.path.expanduser("~/.eigent/tmp/"))
        super().__init__(cache_dir, transcribe_model, audio_reasoning_model, timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseAudioAnalysisToolkit.audio2text,
        lambda _, audio_path, question: f"transcribe audio from {audio_path} and ask question: {question}",
    )
    def ask_question_about_audio(self, audio_path: str, question: str) -> str:
        return super().ask_question_about_audio(audio_path, question)

    @listen_toolkit(BaseAudioAnalysisToolkit.audio2text)
    def audio2text(self, audio_path: str) -> str:
        return super().audio2text(audio_path)
