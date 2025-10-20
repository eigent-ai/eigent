import os
from typing import List, Literal
from camel.toolkits import PyAutoGUIToolkit as BasePyAutoGUIToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BasePyAutoGUIToolkit)
class PyAutoGUIToolkit(BasePyAutoGUIToolkit, AbstractToolkit):
    agent_name: str = Agents.search_agent

    def __init__(
        self,
        api_task_id: str,
        timeout: float | None = None,
        screenshots_dir: str | None = None,
    ):
        if screenshots_dir is None:
            screenshots_dir = env("file_save_path", os.path.expanduser("~/Downloads"))
        super().__init__(timeout, screenshots_dir)
        self.api_task_id = api_task_id
