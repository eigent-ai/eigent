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

import logging

from camel.societies.workforce.single_agent_worker import (
    SingleAgentWorker as BaseSingleAgentWorker,
)
from camel.tasks.task import Task, TaskState
from camel.utils.context_utils import ContextUtility

from app.agent.listen_chat_agent import ListenChatAgent

logger = logging.getLogger("single_agent_worker")


class SingleAgentWorker(BaseSingleAgentWorker):
    def __init__(
        self,
        description: str,
        worker: ListenChatAgent,
        use_agent_pool: bool = True,
        pool_initial_size: int = 0,
        pool_max_size: int = 10,
        auto_scale_pool: bool = True,
        use_structured_output_handler: bool = True,
        context_utility: ContextUtility | None = None,
        enable_workflow_memory: bool = False,
    ) -> None:
        logger.info(
            "Initializing SingleAgentWorker",
            extra={
                "description": description,
                "worker_agent_name": worker.agent_name,
                "use_agent_pool": use_agent_pool,
                "pool_max_size": pool_max_size,
                "enable_workflow_memory": enable_workflow_memory,
            },
        )
        super().__init__(
            description=description,
            worker=worker,
            use_agent_pool=use_agent_pool,
            pool_initial_size=pool_initial_size,
            pool_max_size=pool_max_size,
            auto_scale_pool=auto_scale_pool,
            use_structured_output_handler=use_structured_output_handler,
            context_utility=context_utility,
            enable_workflow_memory=enable_workflow_memory,
        )
        self.worker = worker  # narrow type hint
        # Track current task id for process_task_id injection
        self._current_task_id: str | None = None

    async def _process_task(
        self, task: Task, dependencies: list[Task], stream_callback=None
    ) -> TaskState:
        task_content_preview = (
            task.content[:100] + "..."
            if len(task.content) > 100
            else task.content
        )
        logger.debug(
            f"[TASK REQUEST] task_id={task.id}, "
            f"content_preview='{task_content_preview}'"
        )
        # Store task id so _get_worker_agent can inject process_task_id
        self._current_task_id = task.id
        try:
            return await super()._process_task(
                task, dependencies, stream_callback
            )
        finally:
            self._current_task_id = None

    async def _get_worker_agent(self):
        agent = await super()._get_worker_agent()
        # Inject eigent-specific process_task_id
        if self._current_task_id and hasattr(agent, "process_task_id"):
            agent.process_task_id = self._current_task_id
        logger.info(
            "Starting task processing",
            extra={
                "task_id": self._current_task_id,
                "worker_agent_id": agent.agent_id,
            },
        )
        return agent
