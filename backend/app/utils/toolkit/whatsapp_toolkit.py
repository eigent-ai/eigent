from typing import Any, Dict, List
from camel.toolkits import WhatsAppToolkit as BaseWhatsAppToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseWhatsAppToolkit)
class WhatsAppToolkit(BaseWhatsAppToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        super().__init__(timeout)
        self.api_task_id = api_task_id

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        if env("WHATSAPP_ACCESS_TOKEN") and env("WHATSAPP_PHONE_NUMBER_ID"):
            return WhatsAppToolkit(api_task_id).get_tools()
        else:
            return []
