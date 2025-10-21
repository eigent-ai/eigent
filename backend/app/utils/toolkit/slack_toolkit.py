from camel.toolkits import SlackToolkit as BaseSlackToolkit
from camel.toolkits.function_tool import FunctionTool
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("slack_toolkit")


@auto_listen_toolkit(BaseSlackToolkit)
class SlackToolkit(BaseSlackToolkit, AbstractToolkit):
    agent_name: str = Agents.social_medium_agent

    def __init__(self, api_task_id: str, timeout: float | None = None):
        super().__init__(timeout)
        self.api_task_id = api_task_id

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        logger.debug(f"slack===={env('SLACK_BOT_TOKEN')}")
        if env("SLACK_BOT_TOKEN") or env("SLACK_USER_TOKEN"):
            return SlackToolkit(api_task_id).get_tools()
        else:
            return []
