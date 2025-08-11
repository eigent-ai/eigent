from typing import Any, Dict, List
from camel.toolkits import WhatsAppToolkit as BaseWhatsAppToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class WhatsAppToolkit(BaseWhatsAppToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        super().__init__(timeout)
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseWhatsAppToolkit.send_message,
        lambda _, to, message: f"send message to {to}: {message}",
        lambda result: f"message sent result: {result}",
    )
    def send_message(self, to: str, message: str) -> Dict[str, Any] | str:
        return super().send_message(to, message)

    @listen_toolkit(
        BaseWhatsAppToolkit.get_message_templates,
        lambda _: "get message templates",
        lambda result: f"message templates: {result}",
    )
    def get_message_templates(self) -> List[Dict[str, Any]] | str:
        return super().get_message_templates()

    @listen_toolkit(
        BaseWhatsAppToolkit.get_business_profile,
        lambda _: "get business profile",
        lambda result: f"business profile: {result}",
    )
    def get_business_profile(self) -> Dict[str, Any] | str:
        return super().get_business_profile()

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        if env("WHATSAPP_ACCESS_TOKEN") and env("WHATSAPP_PHONE_NUMBER_ID"):
            return WhatsAppToolkit(api_task_id).get_tools()
        else:
            return []
