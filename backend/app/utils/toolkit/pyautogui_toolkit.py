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
from typing import List, Literal
from camel.toolkits import PyAutoGUIToolkit as BasePyAutoGUIToolkit

from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.toolkit.abstract_toolkit import AbstractToolkit


@auto_listen_toolkit(BasePyAutoGUIToolkit)
class PyAutoGUIToolkit(BasePyAutoGUIToolkit, AbstractToolkit):
    agent_name: str = Agents.browser_agent

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
