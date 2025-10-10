from typing import Dict, List
from camel.toolkits import MarkItDownToolkit as BaseMarkItDownToolkit

from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseMarkItDownToolkit)
class MarkItDownToolkit(BaseMarkItDownToolkit, AbstractToolkit):
    agent_name: str = Agents.document_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        self.api_task_id = api_task_id
        super().__init__(timeout)
