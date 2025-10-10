from camel.models import BaseModelBackend
from camel.toolkits import ImageAnalysisToolkit as BaseImageAnalysisToolkit

from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseImageAnalysisToolkit)
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
