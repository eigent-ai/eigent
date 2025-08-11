import os
from camel.toolkits import ExcelToolkit as BaseExcelToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


class ExcelToolkit(BaseExcelToolkit, AbstractToolkit):
    agent_name: str = Agents.document_agent

    def __init__(
        self,
        api_task_id: str,
        timeout: float | None = None,
        working_directory: str | None = None,
    ):
        self.api_task_id = api_task_id
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(timeout=timeout, working_directory=working_directory)

    @listen_toolkit(BaseExcelToolkit.extract_excel_content)
    def extract_excel_content(self, document_path: str) -> str:
        return super().extract_excel_content(document_path)
