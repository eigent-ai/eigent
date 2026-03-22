# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import os
from camel.toolkits import NoteTakingToolkit as BaseNoteTakingToolkit

from typing import Optional

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BaseNoteTakingToolkit)
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
