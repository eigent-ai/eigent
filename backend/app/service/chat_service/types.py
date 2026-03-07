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

import asyncio
from dataclasses import dataclass, field
from enum import Enum

from camel.tasks import Task
from fastapi import Request

from app.agent.listen_chat_agent import ListenChatAgent
from app.model.chat import Chat
from app.service.task import TaskLock
from app.utils.workforce import Workforce


class LoopControl(Enum):
    NORMAL = "normal"
    CONTINUE = "continue"
    BREAK = "break"


@dataclass
class StepSolveState:
    options: Chat
    request: Request
    task_lock: TaskLock
    workforce: Workforce | None = None
    camel_task: Task | None = None
    mcp: ListenChatAgent | None = None
    sub_tasks: list[Task] = field(default_factory=list)
    summary_task_content: str = ""
    last_completed_task_result: str = ""
    start_event_loop: bool = True
    event_loop: asyncio.AbstractEventLoop | None = None
