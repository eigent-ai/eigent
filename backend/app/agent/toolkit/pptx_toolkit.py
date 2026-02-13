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

from camel.toolkits import PPTXToolkit as BasePPTXToolkit

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.service.task import (
    ActionWriteFileData,
    Agents,
    get_task_lock,
    process_task,
)
from app.utils.listen.toolkit_listen import (
    _safe_put_queue,
    auto_listen_toolkit,
    listen_toolkit,
)


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
            working_directory = env(
                "file_save_path", os.path.expanduser("~/Downloads")
            )
        os.makedirs(working_directory, exist_ok=True)
        super().__init__(working_directory, timeout)

    @listen_toolkit(
        BasePPTXToolkit.create_presentation,
        lambda _,
        content,
        filename,
        template=None: f"create presentation with content: {content}, filename: {filename}, template: {template}",
    )
    def create_presentation(
        self, content: str, filename: str, template: str | None = None
    ) -> str:
        if not filename.lower().endswith(".pptx"):
            filename += ".pptx"

        file_path = self._resolve_filepath(filename)
        res = super().create_presentation(content, filename, template)
        if "PowerPoint presentation successfully created" in res:
            task_lock = get_task_lock(self.api_task_id)
            # Capture ContextVar value before creating async task
            current_process_task_id = process_task.get("")

            # Use _safe_put_queue to handle both sync and async contexts
            _safe_put_queue(
                task_lock,
                ActionWriteFileData(
                    process_task_id=current_process_task_id,
                    data=str(file_path),
                ),
            )
        return res
