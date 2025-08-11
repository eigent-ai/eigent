from camel.toolkits.function_tool import FunctionTool
from inflection import titleize


class AbstractToolkit:
    api_task_id: str
    agent_name: str

    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        """default return all tools, subclass can override this method to filter tools"""
        return cls(api_task_id).get_tools()  # type: ignore

    @classmethod
    def toolkit_name(cls) -> str:
        return titleize(cls.__name__)
