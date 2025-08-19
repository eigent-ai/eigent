import os
from camel.toolkits import NoteTakingToolkit as BaseNoteTakingToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from typing import Optional


class NoteTakingToolkit(BaseNoteTakingToolkit, AbstractToolkit):
    agent_name: str = Agents.document_agent

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        working_directory: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        if working_directory is None:
            working_directory = env("file_save_path", os.path.expanduser("~/.eigent/notes")) + "/note.md"
        super().__init__(working_directory=working_directory, timeout=timeout)

    @listen_toolkit(BaseNoteTakingToolkit.append_note)
    def append_note(self, note_name: str, content: str) -> str:
        return super().append_note(note_name=note_name, content=content)

    @listen_toolkit(BaseNoteTakingToolkit.read_note)
    def read_note(self, note_name: Optional[str] = "all_notes") -> str:
        return super().read_note(note_name=note_name)

    @listen_toolkit(BaseNoteTakingToolkit.create_note)
    def create_note(self, note_name: str, content: str = "") -> str:
        return super().create_note(note_name, content)

    @listen_toolkit(BaseNoteTakingToolkit.list_note)
    def list_note(self) -> str:
        return super().list_note()
