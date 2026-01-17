from camel.toolkits import LarkToolkit as BaseLarkToolkit
from camel.toolkits.function_tool import FunctionTool

from app.component.environment import env
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseLarkToolkit)
class LarkToolkit(BaseLarkToolkit, AbstractToolkit):

    def __init__(self, api_project_id: str, timeout: float | None = None):
        super().__init__(timeout=timeout)
        self.api_project_id = api_project_id

    @classmethod
    def get_can_use_tools(cls, api_project_id: str) -> list[FunctionTool]:
        if env("LARK_APP_ID") and env("LARK_APP_SECRET"):
            return LarkToolkit(api_project_id).get_tools()
        return []
