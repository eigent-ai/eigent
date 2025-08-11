from camel.models import BaseModelBackend
from camel.toolkits import ImageAnalysisToolkit as BaseImageAnalysisToolkit

from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class ImageAnalysisToolkit(BaseImageAnalysisToolkit, AbstractToolkit):
    agent_name: str = Agents.multi_modal_agent

    def __init__(
        self,
        api_task_id: str,
        model: BaseModelBackend | None = None,
        timeout: float | None = None,
    ):
        super().__init__(model, timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseImageAnalysisToolkit.image_to_text,
        lambda _,
        image_path,
        sys_prompt: f"transcribe image from {image_path} and ask sys_prompt: {sys_prompt}",
    )
    def image_to_text(self, image_path: str, sys_prompt: str | None = None) -> str:
        return super().image_to_text(image_path, sys_prompt)

    @listen_toolkit(
        BaseImageAnalysisToolkit.ask_question_about_image,
        lambda _,
        image_path,
        question,
        sys_prompt: f"transcribe image from {image_path} and ask question: {question} with sys_prompt: {sys_prompt}",
    )
    def ask_question_about_image(
        self, image_path: str, question: str, sys_prompt: str | None = None
    ) -> str:
        return super().ask_question_about_image(image_path, question, sys_prompt)
