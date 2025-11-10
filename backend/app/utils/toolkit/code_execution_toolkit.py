from typing import List, Literal
from camel.toolkits import CodeExecutionToolkit as BaseCodeExecutionToolkit, FunctionTool
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseCodeExecutionToolkit)
class CodeExecutionToolkit(BaseCodeExecutionToolkit, AbstractToolkit):
    agent_name: str = Agents.developer_agent

    def __init__(
        self,
        api_task_id: str,
        sandbox: Literal["internal_python", "jupyter", "docker", "subprocess", "e2b"] = "subprocess",
        verbose: bool = False,
        unsafe_mode: bool = False,
        import_white_list: List[str] | None = None,
        require_confirm: bool = False,
        timeout: float | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        super().__init__(sandbox, verbose, unsafe_mode, import_white_list, require_confirm, timeout)

    def get_tools(self) -> List[FunctionTool]:
        return [
            FunctionTool(self.execute_code),
        ]
