from typing import List, Literal
from camel.toolkits import CodeExecutionToolkit as BaseCodeExecutionToolkit, FunctionTool
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


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

    @listen_toolkit(
        BaseCodeExecutionToolkit.execute_code,
    )
    def execute_code(self, code: str, code_type: str = "python") -> str:
        return super().execute_code(code, code_type)

    @listen_toolkit(
        BaseCodeExecutionToolkit.execute_command,
    )
    def execute_command(self, command: str) -> str | tuple[str, str]:
        return super().execute_command(command)

    def get_tools(self) -> List[FunctionTool]:
        return [
            FunctionTool(self.execute_code),
        ]
