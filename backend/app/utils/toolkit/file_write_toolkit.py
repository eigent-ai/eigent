import asyncio
import os
from typing import List
from camel.toolkits import FileToolkit as BaseFileToolkit
from app.component.environment import env
from app.service.task import process_task
from app.service.task import ActionWriteFileData, Agents, get_task_lock
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseFileToolkit)
class FileToolkit(BaseFileToolkit, AbstractToolkit):
    agent_name: str = Agents.document_agent

    def __init__(
        self,
        api_task_id: str,
        working_directory: str | None = None,
        timeout: float | None = None,
        default_encoding: str = "utf-8",
        backup_enabled: bool = True,
    ) -> None:
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(working_directory, timeout, default_encoding, backup_enabled)
        self.api_task_id = api_task_id

    @listen_toolkit(
        BaseFileToolkit.write_to_file,
        lambda _,
        title,
        content,
        filename,
        encoding=None,
        use_latex=False: f"write content to file: {filename} with encoding: {encoding} and use_latex: {use_latex}",
    )
    def write_to_file(
        self,
        title: str,
        content: str | List[List[str]],
        filename: str,
        encoding: str | None = None,
        use_latex: bool = False,
    ) -> str:
        res = super().write_to_file(title, content, filename, encoding, use_latex)
        if "Content successfully written to file: " in res:
            task_lock = get_task_lock(self.api_task_id)
            asyncio.create_task(
                task_lock.put_queue(
                    ActionWriteFileData(
                        process_task_id=process_task.get(),
                        data=res.replace("Content successfully written to file: ", ""),
                    )
                )
            )
        return res
