import asyncio
import os
from camel.toolkits import PPTXToolkit as BasePPTXToolkit

from app.component.environment import env
from app.service.task import ActionWriteFileData, Agents, get_task_lock
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import process_task


@auto_listen_toolkit(BasePPTXToolkit)
class PPTXToolkit(BasePPTXToolkit, AbstractToolkit):
    agent_name: str = Agents.document_agent

    def __init__(
        self,
        api_task_id: str,
        working_directory: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(working_directory, timeout)

    @listen_toolkit(
        BasePPTXToolkit.create_presentation,
        lambda _,
        content,
        filename,
        template=None: f"create presentation with content: {content}, filename: {filename}, template: {template}",
    )
    def create_presentation(self, content: str, filename: str, template: str | None = None) -> str:
        if not filename.lower().endswith(".pptx"):
            filename += ".pptx"

        file_path = self._resolve_filepath(filename)
        res = super().create_presentation(content, filename, template)
        if "PowerPoint presentation successfully created" in res:
            task_lock = get_task_lock(self.api_task_id)
            asyncio.create_task(
                task_lock.put_queue(ActionWriteFileData(process_task_id=process_task.get(), data=str(file_path)))
            )
        return res
