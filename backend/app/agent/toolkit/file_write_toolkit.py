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

from camel.toolkits import FileToolkit as BaseFileToolkit

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
            working_directory = env(
                "file_save_path", os.path.expanduser("~/Downloads")
            )
        super().__init__(
            working_directory, timeout, default_encoding, backup_enabled
        )
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
        content: str | list[list[str]],
        filename: str,
        encoding: str | None = None,
        use_latex: bool = False,
    ) -> str:
        res = super().write_to_file(
            title, content, filename, encoding, use_latex
        )
        if "Content successfully written to file: " in res:
            task_lock = get_task_lock(self.api_task_id)
            # Capture ContextVar value before creating async task
            current_process_task_id = process_task.get("")

            # Use _safe_put_queue to handle both sync and async contexts
            _safe_put_queue(
                task_lock,
                ActionWriteFileData(
                    process_task_id=current_process_task_id,
                    data=res.replace(
                        "Content successfully written to file: ", ""
                    ),
                ),
            )
        return res
