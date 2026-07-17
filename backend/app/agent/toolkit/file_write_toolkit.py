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
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from camel.toolkits import FileToolkit as BaseFileToolkit

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.run_context import RunContext
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
from app.utils.space_overlay_client import (
    path_write_lock,
    post_overlay_write,
    relative_to_workdir,
    run_context_for_task,
    sha256_of_file,
    should_record_overlay,
)


@dataclass(frozen=True)
class OverlayWriteContext:
    run_context: RunContext
    rel_path: str
    target_path: Path


@dataclass(frozen=True)
class PendingOverlayWrite:
    run_context: RunContext
    rel_path: str
    target_path: Path
    base_hash: str | None
    status: Literal["added", "modified"]
    file_hash: str | None
    size: int
    mode: int


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

    def _overlay_write_context(
        self, filename: str
    ) -> OverlayWriteContext | None:
        context = run_context_for_task(self.api_task_id)
        if context is None:
            return None
        resolved = relative_to_workdir(context, filename)
        if resolved is None:
            return None
        rel_path, target_path = resolved
        if not should_record_overlay(context, target_path):
            return None
        return OverlayWriteContext(context, rel_path, target_path)

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
        overlay_context = self._overlay_write_context(filename)
        if overlay_context is None:
            res = super().write_to_file(
                title, content, filename, encoding, use_latex
            )
        else:
            pending_overlay_write: PendingOverlayWrite | None = None
            with path_write_lock(
                overlay_context.run_context.space_id,
                overlay_context.run_context.project_id,
                overlay_context.run_context.run_id,
                overlay_context.rel_path,
            ):
                existed = overlay_context.target_path.exists()
                base_hash = sha256_of_file(overlay_context.target_path)
                res = super().write_to_file(
                    title, content, filename, encoding, use_latex
                )
                if "Content successfully written to file: " in res:
                    written_path = Path(
                        res.replace(
                            "Content successfully written to file: ", ""
                        )
                    )
                    if not written_path.is_absolute():
                        written_path = (
                            Path(self.working_directory) / written_path
                        )
                    written_hash = sha256_of_file(written_path)
                    written_stat = written_path.stat()
                    pending_overlay_write = PendingOverlayWrite(
                        run_context=overlay_context.run_context,
                        rel_path=overlay_context.rel_path,
                        target_path=written_path,
                        base_hash=base_hash,
                        status="modified" if existed else "added",
                        file_hash=written_hash,
                        size=written_stat.st_size,
                        mode=written_stat.st_mode,
                    )
            if pending_overlay_write is not None:
                post_overlay_write(
                    pending_overlay_write.run_context,
                    pending_overlay_write.rel_path,
                    pending_overlay_write.target_path,
                    base_hash=pending_overlay_write.base_hash,
                    status=pending_overlay_write.status,
                    file_hash=pending_overlay_write.file_hash,
                    size=pending_overlay_write.size,
                    mode=pending_overlay_write.mode,
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
