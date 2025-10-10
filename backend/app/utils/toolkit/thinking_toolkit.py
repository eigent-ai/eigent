from camel.toolkits import ThinkingToolkit as BaseThinkingToolkit

from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseThinkingToolkit)
class ThinkingToolkit(BaseThinkingToolkit, AbstractToolkit):

    def __init__(self, api_task_id: str, agent_name: str, timeout: float | None = None):
        super().__init__(timeout)
        self.api_task_id = api_task_id
        self.agent_name = agent_name
